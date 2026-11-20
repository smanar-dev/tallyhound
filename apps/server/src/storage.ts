// A firm's own storage (T-25, T-111). The firm's owner signs in to Google once and lets Tallyhound add files to their Drive.
// The permission asked for is drive.file: Tallyhound can see and change only the folders and files it makes itself, and nothing
// else in the drive. The long-lived token is sealed with the firm's own key before it is stored and is never sent to a browser.
// What goes where, and when, is the engine's and the pipeline's business (packages/core/pipeline.js fileJobs); this file only
// connects, keeps the token fresh, and hands the pipeline something to put files with.
// Written from Google's OAuth 2.0 and Drive v3 references and tested against a stand-in. Not yet run against a real account.
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { createRequire } from "node:module";
import type { Secrets } from "./signin.ts";
const require = createRequire(import.meta.url);
const { googleDrive } = require("../../../packages/adapters/drive.js") as { googleDrive(o: { token(firmId: string): Promise<string>; rootId(firmId: string): Promise<string | null>; fetchImpl?: typeof fetch }): FilesAdapter };

export const GOOGLE = "Google Drive", SCOPE = "https://www.googleapis.com/auth/drive.file", STATE_MINUTES = 10;
export interface FilesAdapter { put(o: { firmId: string; provider?: string; folder: string; name: string; bytes: Buffer; contentType?: string }): Promise<string>; move(o: { firmId: string; provider?: string; id: string; folder: string; name: string }): Promise<void> }
export interface StorageRow { firmId: string; provider: string; sealedToken: Buffer; connectedAt: Date; connectedBy: string }
export interface StorageStore { get(firmId: string): Promise<StorageRow | null>; put(r: StorageRow): Promise<void>; remove(firmId: string): Promise<void> }

export function memoryStorageStore(): StorageStore { const m = new Map<string, StorageRow>(); return { async get(id) { return m.get(id) || null; }, async put(r) { m.set(r.firmId, { ...r }); }, async remove(id) { m.delete(id); } }; }
interface Db { query(sql: string, args?: unknown[]): Promise<{ rows: Record<string, unknown>[] }> }
export function postgresStorageStore(pool: Db): StorageStore {
  return {
    async get(id) { const r = (await pool.query("select * from firm_storage where firm_id = $1", [id])).rows[0]; return r ? { firmId: r.firm_id as string, provider: r.provider as string, sealedToken: Buffer.from(r.sealed_token as Buffer), connectedAt: r.connected_at as Date, connectedBy: r.connected_by as string } : null; },
    async put(r) { await pool.query("insert into firm_storage (firm_id, provider, sealed_token, connected_at, connected_by) values ($1, $2, $3, $4, $5) on conflict (firm_id) do update set provider = excluded.provider, sealed_token = excluded.sealed_token, connected_at = excluded.connected_at, connected_by = excluded.connected_by", [r.firmId, r.provider, r.sealedToken, r.connectedAt, r.connectedBy]); },
    async remove(id) { await pool.query("delete from firm_storage where firm_id = $1", [id]); }
  };
}

export class StorageError extends Error { code: string; constructor(code: string, message: string) { super(message); this.code = code; } }
export interface StorageDeps { store: StorageStore; secrets: Secrets; clientId: string; clientSecret: string; appUrl: string; stateSecret: string; clock: () => Date; fetch?: typeof fetch; log?: (event: string, ...ids: unknown[]) => void }

export function createStorage(d: StorageDeps) {
  const f = d.fetch || fetch, redirect = d.appUrl.replace(/\/$/, "") + "/api/storage/google/callback", label = "storage:" + GOOGLE, fresh = new Map<string, { token: string; until: number }>();
  const sign = (body: string) => createHmac("sha256", d.stateSecret).update("storage-state\n" + body).digest("base64url");
  // The value that travels to Google and back. It names the firm and the person, expires, and cannot be made by anyone else.
  const stateFor = (firmId: string, userId: string) => { const body = Buffer.from(JSON.stringify({ f: firmId, u: userId, t: d.clock().getTime(), n: randomBytes(8).toString("hex") })).toString("base64url"); return body + "." + sign(body); };
  function readState(state: string, firmId: string, userId: string): boolean {
    const [body, mac] = String(state || "").split("."); if (!body || !mac) return false; const want = Buffer.from(sign(body)), got = Buffer.from(mac); if (want.length !== got.length || !timingSafeEqual(want, got)) return false;
    try { const j = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as { f: string; u: string; t: number }; return j.f === firmId && j.u === userId && d.clock().getTime() - j.t < STATE_MINUTES * 60000 && d.clock().getTime() >= j.t; } catch { return false; }
  }
  async function tokenCall(params: Record<string, string>): Promise<{ access_token?: string; refresh_token?: string; expires_in?: number; scope?: string; error?: string }> {
    const r = await f("https://oauth2.googleapis.com/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: d.clientId, client_secret: d.clientSecret, ...params }).toString(), signal: AbortSignal.timeout(15000) });
    const j = (await r.json().catch(() => ({}))) as Record<string, unknown>; return r.ok ? j : { error: String(j.error || "http_" + r.status) };
  }
  async function token(firmId: string): Promise<string> {
    const have = fresh.get(firmId); if (have && have.until > d.clock().getTime() + 60000) return have.token;
    const row = await d.store.get(firmId); if (!row) throw new StorageError("not_connected", "This firm's storage is not connected");
    const r = await tokenCall({ grant_type: "refresh_token", refresh_token: (await d.secrets.open(firmId, row.sealedToken, label)).toString("utf8") });
    // invalid_grant: the owner took the permission away at Google, or the token aged out. The connection is over until they reconnect.
    if (!r.access_token) { if (d.log) d.log("storage_token_failed", firmId, r.error || "no token"); throw new StorageError(r.error === "invalid_grant" ? "revoked" : "token", r.error === "invalid_grant" ? "Google says Tallyhound no longer has permission. Connect the drive again in Settings" : "Google did not give a token"); }
    fresh.set(firmId, { token: r.access_token, until: d.clock().getTime() + Math.max(60, Number(r.expires_in) || 3000) * 1000 }); if (fresh.size > 2000) fresh.clear();
    return r.access_token;
  }
  const drive = googleDrive({ token, rootId: async () => null, fetchImpl: f });
  return {
    /** Where the owner's browser is sent to sign in to Google and say yes. */
    startUrl(firmId: string, userId: string): string {
      return "https://accounts.google.com/o/oauth2/v2/auth?" + new URLSearchParams({ client_id: d.clientId, redirect_uri: redirect, response_type: "code", scope: SCOPE, access_type: "offline", prompt: "consent", include_granted_scopes: "false", state: stateFor(firmId, userId) }).toString();
    },
    /** Google sent the owner back. Trades the one-time code for the long-lived token and stores it sealed. */
    async finish(firmId: string, userId: string, q: { code?: string; state?: string; error?: string }): Promise<void> {
      if (!readState(String(q.state || ""), firmId, userId)) throw new StorageError("state", "That did not come from a sign-in you started here. Try connecting again");
      if (q.error || !q.code) throw new StorageError("declined", "Google was not given permission, so nothing was connected");
      const r = await tokenCall({ grant_type: "authorization_code", code: q.code, redirect_uri: redirect });
      if (!r.refresh_token) throw new StorageError("token", "Google did not finish the connection. Try again");
      if (!String(r.scope || "").split(" ").includes(SCOPE)) throw new StorageError("scope", "Tallyhound needs the permission to add files. Connect again and leave that box ticked");
      await d.store.put({ firmId, provider: GOOGLE, sealedToken: await d.secrets.seal(firmId, Buffer.from(r.refresh_token, "utf8"), label), connectedAt: d.clock(), connectedBy: userId });
      if (r.access_token) fresh.set(firmId, { token: r.access_token, until: d.clock().getTime() + Math.max(60, Number(r.expires_in) || 3000) * 1000 });
    },
    /** Takes the permission away at Google and forgets the token. Forgetting happens even if Google cannot be reached. */
    async disconnect(firmId: string): Promise<void> {
      const row = await d.store.get(firmId); fresh.delete(firmId); if (!row) return;
      try { await f("https://oauth2.googleapis.com/revoke", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ token: (await d.secrets.open(firmId, row.sealedToken, label)).toString("utf8") }).toString(), signal: AbortSignal.timeout(10000) }); } catch { /* forgotten here all the same */ }
      await d.store.remove(firmId);
    },
    async status(firmId: string): Promise<{ connected: boolean; provider: string | null; since: Date | null }> { const r = await d.store.get(firmId); return { connected: !!r, provider: r ? r.provider : null, since: r ? r.connectedAt : null }; },
    /** What the pipeline files with. Only Google Drive is connected today; any other name is refused, never guessed at. */
    files: {
      async put(o) { if (o.provider !== GOOGLE) throw new StorageError("provider", o.provider + " is not connected"); return drive.put(o); },
      async move(o) { if (o.provider !== GOOGLE) throw new StorageError("provider", o.provider + " is not connected"); return drive.move(o); }
    } as FilesAdapter
  };
}
export type Storage = ReturnType<typeof createStorage>;
