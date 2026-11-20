// What the people who run Tallyhound need to see (T-29, T-91): a status line per firm, usage per firm per month kept outside the
// firm's own state, one record per model call, and an email to the developer when something is going wrong.
// Counts, times and outcomes only. Never a message, a document, a prompt or a client's name.
import type { Engine } from "./kit.ts";

export interface ModelCall { firmId: string; at: Date; model: string; tier: string; inputTokens: number; outputTokens: number; usd: number; ms: number; outcome: string }
export interface Usage { segOut: number; segIn: number; mmsIn: number; email: number; docRead: number; textRead: number; write: number }
export interface FirmSnapshot { day: string; sent: number; failed: number; month: string; usage: Usage }
export interface StatusLine { firmId: string; lastTick: Date | null; lastError: string | null; day: string | null; sent: number; failed: number; modelCalls: number; modelErrors: number; modelUsd: number }
export interface UsageLine { firmId: string; month: string; usage: Usage }
export interface OpsStore {
  noteTick(firmId: string, at: Date, error: string | null, snap: FirmSnapshot | null): Promise<void>;
  modelCall(c: ModelCall): Promise<void>;
  /** One line per firm. Model numbers are for the day that contains `now`. */
  status(now: Date): Promise<StatusLine[]>;
  usage(month: string): Promise<UsageLine[]>;
  sweep(now: Date): Promise<void>;
}
const KEEP_CALLS_DAYS = 400, ZERO: Usage = { segOut: 0, segIn: 0, mmsIn: 0, email: 0, docRead: 0, textRead: 0, write: 0 };
const dayOf = (d: Date) => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");

/** Read with the firm locked, after tick(): today's sending and this month's counters, as the engine holds them. */
export function snapshot(T: Engine): FirmSnapshot {
  const now: Date = new Date(T.S.now), day = dayOf(now), month = day.slice(0, 7); let sent = 0, failed = 0;
  for (const m of T.S.msgs) { if (m.dir !== "out" || !m.at || dayOf(new Date(m.at)) !== day) continue; if (m.status === "failed") failed++; else if (m.status === "sent" || m.status === "delivered" || m.status === "unconfirmed") sent++; }
  return { day, sent, failed, month, usage: { ...ZERO, ...((T.S.usage || {})[month] || {}) } };
}
/** What a month cost us for one firm, from the engine's own rates. */
export function costOf(u: Usage, rates: Record<string, number>): number { return (Object.keys(ZERO) as (keyof Usage)[]).reduce((s, k) => s + (u[k] || 0) * (rates[k] || 0), 0); }

export function memoryOpsStore(): OpsStore & { calls: ModelCall[] } {
  const lines = new Map<string, { lastTick: Date | null; lastError: string | null; day: string | null; sent: number; failed: number }>(), months = new Map<string, Usage>(), calls: ModelCall[] = [];
  return {
    calls,
    async noteTick(firmId, at, error, snap) {
      const was = lines.get(firmId) || { lastTick: null, lastError: null, day: null, sent: 0, failed: 0 };
      lines.set(firmId, error ? { ...was, lastError: error } : { lastTick: at, lastError: null, day: snap ? snap.day : was.day, sent: snap ? snap.sent : was.sent, failed: snap ? snap.failed : was.failed });
      if (snap) months.set(firmId + " " + snap.month, { ...snap.usage });
    },
    async modelCall(c) { calls.push({ ...c }); },
    async status(now) {
      const day = now.toISOString().slice(0, 10);
      return [...lines].map(([firmId, l]) => { const mine = calls.filter((c) => c.firmId === firmId && c.at.toISOString().slice(0, 10) === day); return { firmId, ...l, modelCalls: mine.length, modelErrors: mine.filter((c) => c.outcome !== "ok").length, modelUsd: mine.reduce((s, c) => s + c.usd, 0) }; }).sort((a, b) => a.firmId.localeCompare(b.firmId));
    },
    async usage(month) { return [...months].filter(([k]) => k.endsWith(" " + month)).map(([k, usage]) => ({ firmId: k.split(" ")[0]!, month, usage })).sort((a, b) => a.firmId.localeCompare(b.firmId)); },
    async sweep(now) { const cut = now.getTime() - KEEP_CALLS_DAYS * 86400000; for (let i = calls.length - 1; i >= 0; i--) if (calls[i]!.at.getTime() < cut) calls.splice(i, 1); }
  };
}

interface Db { query(sql: string, args?: unknown[]): Promise<{ rows: Record<string, unknown>[] }> }
export function postgresOpsStore(pool: Db): OpsStore {
  return {
    async noteTick(firmId, at, error, snap) {
      if (error) { await pool.query("insert into firm_status (firm_id, last_error) values ($1, $2) on conflict (firm_id) do update set last_error = excluded.last_error", [firmId, error.slice(0, 300)]); return; }
      await pool.query("insert into firm_status (firm_id, last_tick, last_error, day, sent, failed) values ($1, $2, null, $3, $4, $5) on conflict (firm_id) do update set last_tick = excluded.last_tick, last_error = null, day = coalesce(excluded.day, firm_status.day), sent = excluded.sent, failed = excluded.failed", [firmId, at, snap ? snap.day : null, snap ? snap.sent : 0, snap ? snap.failed : 0]);
      if (!snap) return; const u = snap.usage;
      await pool.query("insert into usage_monthly (firm_id, month, segments, segments_in, mms, emails, docs, texts_read, written, updated_at) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) on conflict (firm_id, month) do update set segments = excluded.segments, segments_in = excluded.segments_in, mms = excluded.mms, emails = excluded.emails, docs = excluded.docs, texts_read = excluded.texts_read, written = excluded.written, updated_at = excluded.updated_at",
        [firmId, snap.month + "-01", u.segOut, u.segIn, u.mmsIn, u.email, u.docRead, u.textRead, u.write, at]);
    },
    async modelCall(c) { await pool.query("insert into model_calls (firm_id, at, model, tier, input_tokens, output_tokens, usd, ms, outcome) values ($1, $2, $3, $4, $5, $6, $7, $8, $9)", [c.firmId, c.at, c.model, c.tier, c.inputTokens, c.outputTokens, c.usd.toFixed(6), Math.round(c.ms), c.outcome.slice(0, 40)]); },
    async status(now) {
      const from = new Date(now.toISOString().slice(0, 10) + "T00:00:00Z"), to = new Date(from.getTime() + 86400000);
      const r = await pool.query("select f.id, s.last_tick, s.last_error, to_char(s.day, 'YYYY-MM-DD') as day, coalesce(s.sent, 0) as sent, coalesce(s.failed, 0) as failed, coalesce(m.n, 0) as calls, coalesce(m.bad, 0) as bad, coalesce(m.usd, 0) as usd from firms f left join firm_status s on s.firm_id = f.id left join (select firm_id, count(*)::int as n, count(*) filter (where outcome <> 'ok')::int as bad, sum(usd) as usd from model_calls where at >= $1 and at < $2 group by firm_id) m on m.firm_id = f.id where s.firm_id is not null order by f.id", [from, to]);
      return r.rows.map((x) => ({ firmId: x.id as string, lastTick: (x.last_tick as Date) || null, lastError: (x.last_error as string) || null, day: (x.day as string) || null, sent: Number(x.sent), failed: Number(x.failed), modelCalls: Number(x.calls), modelErrors: Number(x.bad), modelUsd: Number(x.usd) }));
    },
    async usage(month) {
      const r = await pool.query("select firm_id, segments, segments_in, mms, emails, docs, texts_read, written from usage_monthly where month = $1 order by firm_id", [month + "-01"]);
      return r.rows.map((x) => ({ firmId: x.firm_id as string, month, usage: { segOut: Number(x.segments), segIn: Number(x.segments_in), mmsIn: Number(x.mms), email: Number(x.emails), docRead: Number(x.docs), textRead: Number(x.texts_read), write: Number(x.written) } }));
    },
    async sweep(now) { await pool.query("delete from model_calls where at < $1", [new Date(now.getTime() - KEEP_CALLS_DAYS * 86400000)]); }
  };
}

/** Tells the developer, by email, at most once an hour for each kind of trouble at each firm. */
export function createWatch({ to, send, clock, log }: { to: string; send: (to: string, subject: string, body: string) => Promise<void>; clock: () => Date; log?: (event: string, ...ids: unknown[]) => void }) {
  const last = new Map<string, number>();
  return {
    async tell(kind: string, firmId: string, what: string): Promise<boolean> {
      const key = kind + " " + firmId, now = clock().getTime(); if (now - (last.get(key) || 0) < 3600000) return false; last.set(key, now); if (last.size > 5000) last.clear();
      try { await send(to, "Tallyhound: " + what, what + "\n\nFirm: " + (firmId || "(all)") + "\nWhen: " + clock().toISOString() + "\n\nRun `npm run admin -- status` for the line on every firm. This note is sent at most once an hour for the same trouble."); if (log) log("watch_told", kind, firmId); return true; }
      catch (err) { if (log) log("watch_failed", kind, firmId, (err as Error).message); return false; }
    }
  };
}
export type Watch = ReturnType<typeof createWatch>;
