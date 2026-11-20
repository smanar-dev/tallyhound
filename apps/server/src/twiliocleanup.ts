// Shortening what Twilio keeps (T-108). Tallyhound takes its own sealed copy of every picture and every message, so Twilio's
// copies are removed as soon as ours is safe:
//   - a picture is deleted at Twilio once the message it came with has been processed and saved;
//   - the words of a text, in or out, are blanked at Twilio (the record of the message stays, its body does not).
// A removal that fails is written down here and tried again by the timer, a few times a day, for up to twelve tries; after that
// the developer is told. Only Twilio's own addresses and message ids are kept in this list, never content.
export interface CleanupItem { id: number; kind: "media" | "body"; ref: string; at: Date; tries: number }
export interface CleanupStore { add(kind: "media" | "body", ref: string, at: Date): Promise<void>; due(limit: number): Promise<CleanupItem[]>; done(id: number): Promise<void>; failed(id: number): Promise<void>; count(): Promise<number> }
export const MAX_TRIES = 12, SWEEP_EVERY_MS = 4 * 3600000;

export function memoryCleanupStore(): CleanupStore { const L: CleanupItem[] = []; let n = 0; return {
  async add(kind, ref, at) { if (!L.some((x) => x.kind === kind && x.ref === ref)) L.push({ id: ++n, kind, ref, at, tries: 0 }); }, async due(limit) { return L.filter((x) => x.tries < MAX_TRIES).slice(0, limit).map((x) => ({ ...x })); },
  async done(id) { const i = L.findIndex((x) => x.id === id); if (i >= 0) L.splice(i, 1); }, async failed(id) { const x = L.find((y) => y.id === id); if (x) x.tries++; }, async count() { return L.length; } }; }
interface Db { query(sql: string, args?: unknown[]): Promise<{ rows: Record<string, unknown>[] }> }
export function postgresCleanupStore(pool: Db): CleanupStore { return {
  async add(kind, ref, at) { await pool.query("insert into twilio_cleanup (kind, ref, at) values ($1, $2, $3) on conflict (kind, ref) do nothing", [kind, ref, at]); },
  async due(limit) { return (await pool.query("select * from twilio_cleanup where tries < $1 order by id limit $2", [MAX_TRIES, limit])).rows.map((r) => ({ id: Number(r.id), kind: r.kind as "media" | "body", ref: r.ref as string, at: r.at as Date, tries: Number(r.tries) })); },
  async done(id) { await pool.query("delete from twilio_cleanup where id = $1", [id]); }, async failed(id) { await pool.query("update twilio_cleanup set tries = tries + 1 where id = $1", [id]); },
  async count() { return Number((await pool.query("select count(*)::int as n from twilio_cleanup")).rows[0]!.n); } }; }

export function createCleanup(d: { store: CleanupStore; accountSid: string; authToken: string; clock: () => Date; fetch?: typeof fetch; log?: (event: string, ...ids: unknown[]) => void; tell?: (what: string) => Promise<unknown> }) {
  const f = d.fetch || fetch, auth = "Basic " + Buffer.from(d.accountSid + ":" + d.authToken).toString("base64"), say = d.log || (() => {}); let last = 0;
  const base = "https://api.twilio.com/2010-04-01/Accounts/" + encodeURIComponent(d.accountSid);
  // Only an address at Twilio's own API, for this account, is ever called. Anything else in the list is dropped.
  const mediaOk = (url: string) => url.startsWith(base + "/Messages/") && /\/Media\/ME[0-9a-zA-Z]+$/.test(url), sidOk = (sid: string) => /^(SM|MM)[0-9a-zA-Z]{6,40}$/.test(sid);
  async function remove(kind: "media" | "body", ref: string): Promise<boolean> {
    try {
      if (kind === "media") { if (!mediaOk(ref)) return true; const r = await f(ref, { method: "DELETE", headers: { authorization: auth }, signal: AbortSignal.timeout(10000) }); return r.ok || r.status === 404; }
      if (!sidOk(ref)) return true; const r = await f(base + "/Messages/" + ref + ".json", { method: "POST", headers: { authorization: auth, "content-type": "application/x-www-form-urlencoded" }, body: "Body=", signal: AbortSignal.timeout(10000) }); return r.ok || r.status === 404;
    } catch { return false; }
  }
  return {
    /** Straight away, once our own copy is saved. What fails is written down for the sweep. */
    async now(o: { media?: string[]; body?: string }): Promise<void> {
      for (const url of o.media || []) if (!(await remove("media", url))) await d.store.add("media", url, d.clock());
      if (o.body && !(await remove("body", o.body))) await d.store.add("body", o.body, d.clock());
    },
    /** The words of a message we sent, once Twilio says it reached the phone or never will. Queued, not done in the webhook. */
    async later(sid: string): Promise<void> { if (sidOk(sid)) await d.store.add("body", sid, d.clock()); },
    /** The timer's part. Runs at most every few hours unless forced. Returns how many were removed. */
    async sweep(force = false): Promise<number> {
      const t = d.clock().getTime(); if (!force && t - last < SWEEP_EVERY_MS) return 0; last = t; let ok = 0, gaveUp = 0;
      for (const it of await d.store.due(200)) { if (await remove(it.kind, it.ref)) { await d.store.done(it.id); ok++; } else { await d.store.failed(it.id); if (it.tries + 1 >= MAX_TRIES) gaveUp++; } }
      if (ok) say("twilio_cleanup", ok); if (gaveUp) { say("twilio_cleanup_gave_up", gaveUp); if (d.tell) await d.tell(gaveUp + (gaveUp === 1 ? " item" : " items") + " could not be removed at Twilio after " + MAX_TRIES + " tries").catch(() => {}); }
      return ok;
    }
  };
}
export type Cleanup = ReturnType<typeof createCleanup>;
