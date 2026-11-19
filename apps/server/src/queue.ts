// The inbound queue (T-128). Webhooks call accept(): the event is sealed, stored and acknowledged at once.
// drain() does the slow part (fetching photos, the model, the reply) with retries. After repeated failure the event is
// handed to a person: it shows under Unknown senders with the reason, and is kept for 30 days like any unmatched message.
// A provider that delivers the same event twice gets the same answer and nothing is processed twice.
import { randomBytes } from "node:crypto";
import type { App, Engine, KitStore } from "./kit.ts";

export type Kind = "sms" | "email";
export interface Job { id: string; provider: string; providerId: string; firmId: string; kind: Kind; fileKey: string | null; attempts: number }
export interface QueueStore {
  /** Null when this provider id has been seen before. */
  add(j: { provider: string; providerId: string; firmId: string; kind: Kind; fileKey: string }, now: Date): Promise<string | null>;
  setPayload(id: string, fileKey: string | null): Promise<void>;
  /** The oldest event that is due, or one a crashed worker left behind. Counts the attempt. */
  claim(now: Date, staleBefore: Date): Promise<Job | null>;
  done(id: string, now: Date): Promise<void>;
  retry(id: string, nextAt: Date, error: string): Promise<void>;
  dead(id: string, now: Date, error: string): Promise<void>;
  counts(): Promise<{ waiting: number; dead: number }>;
  /** Dead events finished before the date that still hold a payload. */
  expired(before: Date): Promise<Job[]>;
}
export const RETRY_AFTER_S = [60, 300, 900, 3600];   // then a person
export const STALE_MIN = 10, DEAD_KEEP_DAYS = 30;

export function memoryQueue(): QueueStore & { rows: (Job & { state: string; nextAt: Date; lockedAt: Date | null; finishedAt: Date | null; error: string | null })[] } {
  const rows: (Job & { state: string; nextAt: Date; lockedAt: Date | null; finishedAt: Date | null; error: string | null })[] = []; let n = 0;
  const get = (id: string) => rows.find((r) => r.id === id);
  return {
    rows,
    async add(j, now) { if (rows.some((r) => r.provider === j.provider && r.providerId === j.providerId)) return null; const id = String(++n); rows.push({ ...j, id, attempts: 0, state: "ready", nextAt: now, lockedAt: null, finishedAt: null, error: null }); return id; },
    async setPayload(id, key) { const r = get(id); if (r) r.fileKey = key; },
    async claim(now, stale) { const r = rows.find((x) => x.fileKey && ((x.state === "ready" && x.nextAt <= now) || (x.state === "working" && x.lockedAt! < stale))); if (!r) return null; r.state = "working"; r.lockedAt = now; r.attempts++; return { ...r }; },
    async done(id, now) { const r = get(id); if (r) { r.state = "done"; r.finishedAt = now; r.fileKey = null; } },
    async retry(id, nextAt, error) { const r = get(id); if (r) { r.state = "ready"; r.nextAt = nextAt; r.error = error; } },
    async dead(id, now, error) { const r = get(id); if (r) { r.state = "dead"; r.finishedAt = now; r.error = error; } },
    async counts() { return { waiting: rows.filter((r) => r.state === "ready" || r.state === "working").length, dead: rows.filter((r) => r.state === "dead").length }; },
    async expired(before) { return rows.filter((r) => r.state === "dead" && r.fileKey && r.finishedAt! < before).map((r) => ({ ...r })); }
  };
}
interface Db { query(sql: string, args?: unknown[]): Promise<{ rows: Record<string, unknown>[]; rowCount: number | null }> }
export function postgresQueue(pool: Db): QueueStore {
  const job = (r: Record<string, unknown>): Job => ({ id: String(r.id), provider: r.provider as string, providerId: r.provider_id as string, firmId: r.firm_id as string, kind: r.kind as Kind, fileKey: (r.file_key as string) || null, attempts: Number(r.attempts) });
  return {
    async add(j, now) { const r = await pool.query("insert into inbound_queue (provider, provider_id, firm_id, kind, file_key, next_at, created_at) values ($1, $2, $3, $4, $5, $6, $6) on conflict (provider, provider_id) do nothing returning id", [j.provider, j.providerId, j.firmId, j.kind, j.fileKey, now]); return r.rows[0] ? String(r.rows[0].id) : null; },
    async setPayload(id, key) { await pool.query("update inbound_queue set file_key = $2 where id = $1", [id, key]); },
    // skip locked: two workers never take the same event, and neither waits for the other.
    async claim(now, stale) {
      const r = await pool.query("update inbound_queue set state = 'working', locked_at = $1, attempts = attempts + 1 where id = (select id from inbound_queue where file_key is not null and ((state = 'ready' and next_at <= $1) or (state = 'working' and locked_at < $2)) order by id limit 1 for update skip locked) returning *", [now, stale]);
      return r.rows[0] ? job(r.rows[0]) : null;
    },
    async done(id, now) { await pool.query("update inbound_queue set state = 'done', finished_at = $2, file_key = null, last_error = null where id = $1", [id, now]); },
    async retry(id, nextAt, error) { await pool.query("update inbound_queue set state = 'ready', next_at = $2, last_error = $3 where id = $1", [id, nextAt, error.slice(0, 300)]); },
    async dead(id, now, error) { await pool.query("update inbound_queue set state = 'dead', finished_at = $2, last_error = $3 where id = $1", [id, now, error.slice(0, 300)]); },
    async counts() { const r = (await pool.query("select count(*) filter (where state in ('ready', 'working'))::int as waiting, count(*) filter (where state = 'dead')::int as dead from inbound_queue")).rows[0]!; return { waiting: Number(r.waiting), dead: Number(r.dead) }; },
    async expired(before) { return (await pool.query("select * from inbound_queue where state = 'dead' and file_key is not null and finished_at < $1", [before])).rows.map(job); }
  };
}

/** Turns a stored event into pipeline input and runs it. Throwing means "try again later". `after` runs once the result is saved. */
export type Handler = (payload: Buffer, firmId: string) => Promise<{ from: string; after?: () => Promise<void> }>;

export function createInbox({ queue, store, app, handlers, clock, log }: { queue: QueueStore; store: KitStore; app: App; handlers: Record<Kind, Handler | null>; clock: () => Date; log?: (event: string, ...ids: unknown[]) => void }) {
  const say = log || (() => {}); let running: Promise<number> | null = null, again = false;

  // Called by a webhook. The sealed event is stored first and the row second, so there is never a row with nothing behind it:
  // if we die in between, the provider gets no answer and delivers again. A repeat costs one stored copy, deleted at once.
  async function accept(provider: string, providerId: string | null, firmId: string, kind: Kind, payload: Buffer): Promise<"queued" | "duplicate"> {
    const key = await store.putFile(firmId, payload, "application/x-tallyhound-event"); let id: string | null;
    try { id = await queue.add({ provider, providerId: providerId || "none-" + randomBytes(12).toString("hex"), firmId, kind, fileKey: key }, clock()); }
    catch (err) { await store.deleteFile(firmId, key).catch(() => {}); throw err; }
    if (!id) { await store.deleteFile(firmId, key).catch(() => say("queue_delete_failed", firmId)); return "duplicate"; }
    return "queued";
  }
  async function one(j: Job): Promise<void> {
    const now = clock(), h = handlers[j.kind];
    try {
      if (!h) throw new Error(j.kind === "sms" ? "Texting is not connected" : "Email is not connected");
      const f = await store.getFile(j.firmId, j.fileKey!); if (!f) throw new Error("The stored event is missing");
      const r = await h(f.bytes, j.firmId);
      await queue.done(j.id, clock()); await store.deleteFile(j.firmId, j.fileKey!).catch(() => say("queue_delete_failed", j.firmId, j.id));
      if (r.after) await r.after().catch(() => say("queue_after_failed", j.firmId, j.id));
    } catch (err) {
      const msg = String((err as Error).message || err), wait = RETRY_AFTER_S[j.attempts - 1];
      if (wait !== undefined) { await queue.retry(j.id, new Date(now.getTime() + wait * 1000), msg); say("queue_retry", j.firmId, j.id, j.attempts, msg); return; }
      await queue.dead(j.id, clock(), msg); say("queue_dead", j.firmId, j.id, msg);
      // Hand it to a person. Nothing about the message itself is known here beyond that it arrived.
      await app.withFirm(j.firmId, (T: Engine) => { T.S.tray.push({ id: "yq" + j.id, text: "A" + (j.kind === "sms" ? " text" : "n email") + " arrived and Tallyhound could not process it after several tries. If you are expecting something from a client, ask them to send it again.", from: "Unknown", at: new Date(T.S.now), channel: j.kind === "sms" ? "text" : "email", why: "Could not be processed" }); }).catch(() => say("queue_handoff_failed", j.firmId, j.id));
    }
  }
  async function run(): Promise<number> {
    let n = 0;
    for (;;) { const now = clock(), j = await queue.claim(now, new Date(now.getTime() - STALE_MIN * 60000)); if (!j) break; await one(j); n++; if (n >= 500) break; }
    return n;
  }
  return {
    accept,
    /** Processes everything that is due. Calls made while it is running are folded into one more pass. */
    drain(): Promise<number> {
      if (running) { again = true; return running; }
      running = (async () => { let n = 0; try { do { again = false; n += await run(); } while (again); } catch (err) { say("queue_failed", String((err as Error).message)); } finally { running = null; } return n; })();
      return running;
    },
    /** Deletes what is left of events nobody could process, after the keep-for time for unmatched messages. */
    async sweep(): Promise<number> { const L = await queue.expired(new Date(clock().getTime() - DEAD_KEEP_DAYS * 86400000)); for (const j of L) { await store.deleteFile(j.firmId, j.fileKey!); await queue.setPayload(j.id, null); } return L.length; },
    counts: () => queue.counts()
  };
}
export type Inbox = ReturnType<typeof createInbox>;
