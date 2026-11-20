// The Claude client for the pipeline's `ai` interface (T-10), on the official SDK. It replaces the kit's starter
// (packages/adapters/anthropic.js) in production. Same contract: json(prompt, { images, tier }) -> object, or it throws,
// and the pipeline then falls back to rules and standard wording. It never decides anything: the engine does.
//
//   - 20 seconds per try, two retries with backoff (the SDK retries 408, 409, 429, 5xx and dropped connections).
//   - A daily spend cap per firm. Past it the model is not called for that firm until the next day (UTC).
//   - A refusal or a cut-off answer is an error, never a half-read document.
// Nothing here logs a prompt, an image or an answer.
import Anthropic from "@anthropic-ai/sdk";
import { AsyncLocalStorage } from "node:async_hooks";
import type { KitStore } from "./kit.ts";

export type Tier = "quick" | "default";
// The kit's two tiers: a small model for texts and wording, a larger one for documents. T-92 tests whether the small one can read documents too.
export const MODELS: Record<Tier, string> = { quick: process.env.TH_MODEL_QUICK || "claude-haiku-5-5", default: process.env.TH_MODEL_DEFAULT || "claude-sonnet-5-5" };
// Dollars per million tokens, in and out, for the estimate behind the cap. Checked November 19, 2026; the same figures as tools/cost-model.js.
export const PRICE: Record<string, [number, number]> = { "claude-haiku-5-5": [0.1, 0.5], "claude-sonnet-5-5": [2, 10] };
const FALLBACK_PRICE: [number, number] = [4, 20];   // an unknown model is costed high, so the cap errs towards stopping early
export const TIMEOUT_MS = 20000, RETRIES = 2, MAX_TOKENS = 4096;

// Which firm is being worked on. The pipeline does not pass it to the model, so the store wrapper below notes it for the length of each firm's turn.
const turn = new AsyncLocalStorage<{ firmId: string }>();
export function trackFirm<S extends KitStore>(store: S): S {
  return Object.assign(Object.create(store), { lock: (id: string, fn: (json: string | null) => Promise<string>) => turn.run({ firmId: id }, () => store.lock(id, fn)) }) as S;
}

export class ModelError extends Error { code: string; constructor(code: string, message: string, options?: ErrorOptions) { super(message, options); this.code = code; } }
type Media = "image/jpeg" | "image/png" | "image/webp" | "image/gif";
function mediaOf(b: Buffer): Media | "application/pdf" | null {
  const s = b.subarray(0, 12).toString("latin1");
  if (s.startsWith("%PDF")) return "application/pdf"; if (b[0] === 0xff && b[1] === 0xd8) return "image/jpeg"; if (s.startsWith("\x89PNG")) return "image/png";
  if (s.startsWith("RIFF") && s.slice(8, 12) === "WEBP") return "image/webp"; if (s.startsWith("GIF8")) return "image/gif"; return null;
}

export interface ModelOpts { apiKey: string; dailyCapUsd?: number; clock?: () => Date; log?: (event: string, ...ids: unknown[]) => void; fetch?: typeof fetch; retries?: number; timeoutMs?: number;
  /** One line per call: tokens, cost, time and outcome. Never the prompt or the answer. */
  record?: (c: { firmId: string; at: Date; model: string; tier: string; inputTokens: number; outputTokens: number; usd: number; ms: number; outcome: string }) => void }
export function claude(o: ModelOpts) {
  const client = new Anthropic({ apiKey: o.apiKey, timeout: o.timeoutMs ?? TIMEOUT_MS, maxRetries: o.retries ?? RETRIES, ...(o.fetch ? { fetch: o.fetch } : {}) });
  const cap = o.dailyCapUsd ?? 10, now = o.clock || (() => new Date()), say = o.log || (() => {});
  const spent = new Map<string, { day: string; usd: number; calls: number; told: boolean }>();
  const book = (firmId: string) => { const day = now().toISOString().slice(0, 10); let b = spent.get(firmId); if (!b || b.day !== day) { b = { day, usd: 0, calls: 0, told: false }; spent.set(firmId, b); } return b; };

  return {
    /** What this process has spent for a firm today, by its own estimate. With two servers each keeps its own count, so the real ceiling is the cap times the number of servers. */
    spentToday(firmId: string) { const b = book(firmId); return { usd: b.usd, calls: b.calls }; },
    async json(prompt: string, opt: { images?: Buffer[]; tier?: Tier } = {}): Promise<Record<string, unknown>> {
      const firmId = turn.getStore()?.firmId; if (!firmId) throw new ModelError("no_firm", "The model is only called on a firm's behalf");   // no anonymous spending, nothing uncounted
      const b = book(firmId), model = MODELS[opt.tier || "default"] || MODELS.default;
      if (b.usd >= cap) { if (!b.told) { b.told = true; say("model_cap_reached", firmId, b.calls); try { if (o.record) o.record({ firmId, at: now(), model, tier: opt.tier || "default", inputTokens: 0, outputTokens: 0, usd: 0, ms: 0, outcome: "cap" }); } catch { /* never breaks a read */ } } throw new ModelError("cap", "Daily model limit reached for this firm"); }
      const content: Anthropic.ContentBlockParam[] = [];
      for (const img of opt.images || []) {
        const t = mediaOf(img); if (!t) throw new ModelError("file", "Not a photo or PDF the model can read");
        content.push(t === "application/pdf" ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: img.toString("base64") } } : { type: "image", source: { type: "base64", media_type: t, data: img.toString("base64") } });
      }
      content.push({ type: "text", text: prompt });
      const began = Date.now(), tier = opt.tier || "default", note = (outcome: string, inTok = 0, outTok = 0, usd = 0) => { try { if (o.record) o.record({ firmId, at: now(), model, tier, inputTokens: inTok, outputTokens: outTok, usd, ms: Date.now() - began, outcome }); } catch { /* keeping the record must never break a read */ } };
      let res: Anthropic.Message;
      try { res = await client.messages.create({ model, max_tokens: MAX_TOKENS, messages: [{ role: "user", content }] }); }
      catch (err) {
        note(err instanceof Anthropic.RateLimitError ? "busy" : err instanceof Anthropic.APIConnectionError ? "network" : err instanceof Anthropic.APIError ? "api_" + (err.status ?? "error") : "error");
        // Most specific first. None of these carries the prompt: only the kind of failure is kept.
        if (err instanceof Anthropic.RateLimitError) throw new ModelError("busy", "The model is rate limited", { cause: err });
        if (err instanceof Anthropic.APIConnectionError) throw new ModelError("network", "The model could not be reached in time", { cause: err });
        if (err instanceof Anthropic.APIError) throw new ModelError("api_" + (err.status ?? "error"), "Claude API " + (err.status ?? "error"), { cause: err });
        throw err;
      }
      const [pin, pout] = PRICE[model] || FALLBACK_PRICE, u = res.usage;
      const inTok = u.input_tokens + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0), usd = (inTok * pin + u.output_tokens * pout) / 1e6, done = (outcome: string) => note(outcome, inTok, u.output_tokens, usd);
      b.calls++; b.usd += usd;
      if (res.stop_reason === "refusal") { done("refusal"); throw new ModelError("refusal", "The model declined to read this"); }
      if (res.stop_reason === "max_tokens") { done("cut_off"); throw new ModelError("cut_off", "The model's answer was cut off"); }
      const text = res.content.filter((x): x is Anthropic.TextBlock => x.type === "text").map((x) => x.text).join("");
      const m = /\{[\s\S]*\}/.exec(text); if (!m) { done("no_json"); throw new ModelError("no_json", "No JSON in the model's answer"); }
      try { const out = JSON.parse(m[0]); if (!out || typeof out !== "object" || Array.isArray(out)) throw new Error("not an object"); done("ok"); return out as Record<string, unknown>; }
      catch { done("bad_json"); throw new ModelError("bad_json", "The model's answer was not valid JSON"); }
    }
  };
}
