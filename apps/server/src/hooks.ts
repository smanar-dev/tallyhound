// Where the outside world calls in: Twilio (texts, delivery receipts, voice) and Postmark (email in, bounces).
// Every route checks who is calling before it reads a field. Message webhooks only store the event and answer;
// the queue does the work (queue.ts). Nothing here logs a body, a number or an address.
import type { Cleanup } from "./twiliocleanup.ts";
import { timingSafeEqual } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { ready } from "./files.ts";
import { kitEmailIn, kitEmailOut, kitTwilio, type App, type Engine, type KitStore, type PrepareOpts, type TwilioAdapter } from "./kit.ts";
import type { Handler, Inbox, Kind } from "./queue.ts";

const last10 = (v: unknown) => String(v || "").replace(/\D/g, "").slice(-10);
const addr = (v: unknown) => { const s = String(v || ""), m = /<([^>]+)>/.exec(s); return (m ? m[1]! : s).trim().toLowerCase(); };

export function handlers({ app, twilio, prepare, cleanup }: { app: App; twilio: TwilioAdapter | null; prepare?: PrepareOpts; cleanup?: Cleanup }): Record<Kind, Handler | null> {
  const opt = prepare || {};
  // A file the scanner refused is never kept. The firm is told that it happened (spec TH-CAP-14); the client is asked for a photo or PDF as for any unreadable file.
  const infected = async (firmId: string, files: { refused?: string }[], channel: "text" | "email" | "portal") => {
    const n = files.filter((f) => f.refused === "infected").length; if (!n) return;
    await app.withFirm(firmId, (T: Engine) => { T.S.tray.push({ id: "yv" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), text: n + (n === 1 ? " file" : " files") + " that arrived by " + (channel === "portal" ? "a client's upload page" : channel) + " failed the virus scan and " + (n === 1 ? "was" : "were") + " not kept. If you were expecting a document, ask the client to send it again from another device.", from: "Tallyhound", at: new Date(T.S.now), channel, why: "Blocked by the virus scan" }); });
  };
  return {
    // Photos are fetched here, not in the webhook, and Twilio's copies are deleted only once ours is sealed and the result saved.
    sms: twilio && (async (payload, firmId) => {
      const params = JSON.parse(payload.toString("utf8")) as Record<string, string>, m = await twilio.inbound(params, { keep: true }), media = await Promise.all(m.media.map((f) => ready(f, opt)));
      await app.inboundSms({ ...m, media }); await infected(firmId, media, "text");
      // T-108: once ours is saved, Twilio's pictures are deleted and the words of the text are blanked there. What fails is retried by the timer.
      const urls: string[] = []; for (let i = 0; i < Math.min(10, +params.NumMedia! || 0); i++) if (params["MediaUrl" + i]) urls.push(params["MediaUrl" + i]!);
      return { from: m.from, after: async () => { if (cleanup) await cleanup.now({ media: urls, body: params.MessageSid }); else await twilio.forget(params); } };
    }),
    // Files from a client's upload page. The page stored them and answered; here they are prepared and checked.
    upload: async (payload, firmId) => {
      const j = JSON.parse(payload.toString("utf8")) as { id: string; clientId: string; files: { name?: string; type?: string; b64: string }[] }, files = await Promise.all(j.files.map((f) => ready({ bytes: Buffer.from(f.b64, "base64"), contentType: f.type, name: f.name }, opt)));
      await app.clientUpload({ firmId, clientId: j.clientId, files, providerId: "up-" + j.id }); await infected(firmId, files, "portal");
      return { from: "upload page" };
    },
    email: async (payload, firmId) => {
      const m = kitEmailIn.fromPostmark(JSON.parse(payload.toString("utf8"))), attachments = await Promise.all(m.attachments.map((f) => ready(f, opt)));
      await app.inboundEmail({ ...m, attachments }); await infected(firmId, attachments, "email");
      return { from: m.from };
    }
  };
}

export interface HookDeps {
  cleanup?: Cleanup;
  app: App; store: KitStore; inbox: Inbox; publicUrl: string;
  systemNumber?: string; staffStop?: (mobile: string) => Promise<boolean>;   // TH-BRK-10: Tallyhound's own number, for staff texts
  twilioAuthToken?: string;                          // without it the Twilio routes do not exist
  postmarkHook?: { user: string; pass: string };     // the name and password in the webhook address given to Postmark
  log?: (event: string, ...ids: unknown[]) => void;
}

export function registerHooks(f: FastifyInstance, d: HookDeps): void {
  const say = d.log || (() => {}), base = d.publicUrl.replace(/\/$/, "");
  f.addContentTypeParser("application/x-www-form-urlencoded", { parseAs: "string" }, (_req, body, done) => { done(null, Object.fromEntries(new URLSearchParams(body as string))); });
  const xml = (reply: FastifyReply, body = "<Response/>") => reply.type("text/xml").send(body.startsWith("<?xml") ? body : '<?xml version="1.0" encoding="UTF-8"?>' + body);

  if (d.twilioAuthToken) {
    const token = d.twilioAuthToken;
    // Twilio signs the exact public address it called plus every field. Anything else is turned away before a field is read.
    const signed = async (req: FastifyRequest, reply: FastifyReply) => {
      const p = (req.body && typeof req.body === "object" ? req.body : {}) as Record<string, string>;
      if (!kitTwilio.verifySignature(token, base + req.url, p, String(req.headers["x-twilio-signature"] || ""))) { say("hook_rejected", "twilio", req.routeOptions.url); return reply.code(403).send("Forbidden"); }
    };
    const params = (req: FastifyRequest) => req.body as Record<string, string>;
    // A text or picture message. The fallback address does exactly the same: store, answer.
    const text = async (req: FastifyRequest, reply: FastifyReply) => {
      const p = params(req);
      // A reply to Tallyhound's own number is from a member of staff, never a client. STOP removes their number at once; nothing else is read.
      if (d.systemNumber && last10(p.To) === last10(d.systemNumber)) { if (d.staffStop && /^\s*(stop|stopall|unsubscribe|cancel|end|quit)\b/i.test(p.Body || "")) { const done = await d.staffStop(last10(p.From)); say("staff_stop", done ? "removed" : "unknown"); } return xml(reply); }
      const firmId = await d.store.firmIdByNumber(last10(p.To)); if (!firmId) { say("unknown_number"); return xml(reply); }
      const r = await d.inbox.accept("twilio", p.MessageSid || p.SmsSid || null, firmId, "sms", Buffer.from(JSON.stringify(p)));
      if (r === "queued") void d.inbox.drain(); else say("hook_repeat", "twilio", firmId);
      return xml(reply);   // an empty answer: replies are sent by the pipeline, never from here
    };
    f.post("/hooks/twilio", { preHandler: signed }, text);
    f.post("/hooks/twilio/fallback", { preHandler: signed }, text);
    // Delivery receipts (T-60). A text the carrier could not deliver is marked failed and the firm is told, in the pipeline's own words.
    f.post("/hooks/twilio/status", { preHandler: signed }, async (req, reply) => {
      const p = params(req), st = String(p.MessageStatus || p.SmsStatus || "").toLowerCase();
      if ((st === "undelivered" || st === "failed") && p.MessageSid) { const firmId = await d.store.firmIdByNumber(last10(p.From)); if (firmId) await d.app.withFirm(firmId, (T: Engine) => notDelivered(T, p.MessageSid!, p.ErrorCode || "")); }
      if (d.cleanup && p.MessageSid && ["delivered", "undelivered", "failed"].includes(st)) await d.cleanup.later(p.MessageSid);   // T-108: the words of a text we sent are blanked at Twilio once it has arrived or never will
      return reply.code(204).send();
    });
    // Clients call the number that texts them. Ring the firm's office (T-122).
    f.post("/hooks/twilio/voice", { preHandler: signed }, async (req, reply) => {
      const firmId = await d.store.firmIdByNumber(last10(params(req).To)), json = firmId && (await d.store.readState(firmId));
      return xml(reply, kitTwilio.voiceForward(json ? JSON.parse(json).state.firm.phone : ""));
    });
  }

  if (d.postmarkHook) {
    const want = Buffer.from("Basic " + Buffer.from(d.postmarkHook.user + ":" + d.postmarkHook.pass).toString("base64"));
    // Postmark does not sign its webhooks. The address we give it carries a name and password, and only that is accepted.
    const known = async (req: FastifyRequest, reply: FastifyReply) => {
      const got = Buffer.from(String(req.headers.authorization || ""));
      if (got.length !== want.length || !timingSafeEqual(got, want)) { say("hook_rejected", "postmark", req.routeOptions.url); return reply.code(401).send("Unauthorized"); }
    };
    f.post("/hooks/postmark/inbound", { preHandler: known, bodyLimit: 50 * 1024 * 1024 }, async (req) => {
      const j = (req.body || {}) as Record<string, unknown>, firmId = await d.store.firmIdByInbox(addr(j.OriginalRecipient || j.To)); if (!firmId) { say("unknown_inbox"); return { ok: true }; }
      const r = await d.inbox.accept("postmark", (j.MessageID as string) || null, firmId, "email", Buffer.from(JSON.stringify(j)));
      if (r === "queued") void d.inbox.drain(); else say("hook_repeat", "postmark", firmId);
      return { ok: true };
    });
    // A hard bounce or a spam complaint: stop emailing that address and tell the firm (T-60, T-103).
    f.post("/hooks/postmark/bounce", { preHandler: known }, async (req) => {
      const j = (req.body || {}) as Record<string, unknown>, b = kitEmailOut.bounceEvent(j), firmId = b.hard && b.email ? (await d.store.firmIdByInbox(b.inbox || addr(j.From))) || (await d.store.firmIdByInbox(addr(j.From))) : null;   // mail sent from a firm's own domain carries its Tallyhound address with it
      if (firmId) await d.app.withFirm(firmId, (T: Engine) => bounced(T, b.email, b.kind));
      return { ok: true };
    });
  }
}

// The same record the pipeline writes when a send fails at the provider (withFirm in packages/core/pipeline.js), reached later by a receipt.
export function notDelivered(T: Engine, providerId: string, code: string): boolean {
  const m = T.S.msgs.find((x: { providerId?: string; dir: string }) => x.dir === "out" && x.providerId === providerId); if (!m || m.failed) return false;
  const e = T.eng(m.engId), c = e && T.client(e.clientId); m.failed = "The carrier did not deliver it" + (code ? " (code " + String(code).replace(/\D/g, "") + ")" : ""); m.status = "failed";
  if (c && String(code) === "21610" && c.textConsent === "given") { c.textConsent = "withdrawn"; c.consentLog.push({ at: new Date(T.S.now), what: "Withdrawn: carrier reports the number as unsubscribed", channel: "text" }); }
  if (e && c) T.alertx(e, "high", "send_failed", "A " + m.channel + " to " + c.first + " " + c.last + " could not be sent: " + m.failed, "sf" + m.id);
  return true;
}
export function bounced(T: Engine, email: string, kind: string): number {
  let n = 0;
  for (const c of T.S.clients.filter((x: { email?: string; emailOk?: boolean }) => x.email && x.email.toLowerCase() === email && x.emailOk !== false)) {
    c.emailOk = false; n++; const e = T.engOf(c.id);
    if (e) T.alertx(e, "high", "email_bounced", (kind === "complaint" ? "An email to " + c.first + " " + c.last + " was marked as spam." : "Email to " + c.first + " " + c.last + " is bouncing.") + " Tallyhound has stopped emailing that address. Check it on the client's Details tab.", "eb" + c.id);
  }
  return n;
}
