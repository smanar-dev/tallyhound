// A firm's own storage (T-25, T-111): Google Drive, Microsoft OneDrive, SharePoint or Dropbox. One at a time per firm.
// The firm's owner signs in to the service once and lets Tallyhound add files. The narrowest permission each service offers
// is the one asked for:
//   Google Drive   drive.file                    only folders and files Tallyhound makes itself
//   OneDrive       Files.ReadWrite.AppFolder     only Tallyhound's own folder (Apps/Tallyhound)
//   Dropbox        an "App folder" app           only Tallyhound's own folder (Apps/Tallyhound)
//   SharePoint     Sites.ReadWrite.All           Microsoft offers nothing narrower to a signed-in person. Tallyhound touches
//                                                only the folder the owner names, in the one site they name. The page says so.
// The long-lived token is sealed with the firm's own key before it is stored and is never sent to a browser. What goes where,
// and when, is the engine's and the pipeline's business (packages/core/pipeline.js fileJobs).
// Written from each service's API reference and tested against stand-ins. None has been run against a real account.
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { createRequire } from "node:module";
import type { Secrets } from "./signin.ts";
const require = createRequire(import.meta.url);
const { googleDrive } = require("../../../packages/adapters/drive.js") as { googleDrive(o: { token(firmId: string): Promise<string>; rootId(firmId: string): Promise<string | null>; fetchImpl?: typeof fetch }): FilesAdapter };

export const GOOGLE = "Google Drive", ONEDRIVE = "Microsoft OneDrive", SHAREPOINT = "SharePoint", DROPBOX = "Dropbox", SCOPE = "https://www.googleapis.com/auth/drive.file", STATE_MINUTES = 10;
export const SLUG: Record<string, string> = { google: GOOGLE, onedrive: ONEDRIVE, sharepoint: SHAREPOINT, dropbox: DROPBOX };
export interface FilesAdapter { put(o: { firmId: string; provider?: string; folder: string; name: string; bytes: Buffer; contentType?: string }): Promise<string>; move(o: { firmId: string; provider?: string; id: string; folder: string; name: string }): Promise<void> }
export interface StorageRow { firmId: string; provider: string; sealedToken: Buffer; connectedAt: Date; connectedBy: string; config?: Record<string, string> | null }
export interface StorageStore { get(firmId: string): Promise<StorageRow | null>; put(r: StorageRow): Promise<void>; remove(firmId: string): Promise<void> }

export function memoryStorageStore(): StorageStore { const m = new Map<string, StorageRow>(); return { async get(id) { return m.get(id) || null; }, async put(r) { m.set(r.firmId, { ...r }); }, async remove(id) { m.delete(id); } }; }
interface Db { query(sql: string, args?: unknown[]): Promise<{ rows: Record<string, unknown>[] }> }
export function postgresStorageStore(pool: Db): StorageStore {
  return {
    async get(id) { const r = (await pool.query("select * from firm_storage where firm_id = $1", [id])).rows[0]; return r ? { firmId: r.firm_id as string, provider: r.provider as string, sealedToken: Buffer.from(r.sealed_token as Buffer), connectedAt: r.connected_at as Date, connectedBy: r.connected_by as string, config: (r.config as Record<string, string>) || null } : null; },
    async put(r) { await pool.query("insert into firm_storage (firm_id, provider, sealed_token, connected_at, connected_by, config) values ($1, $2, $3, $4, $5, $6) on conflict (firm_id) do update set provider = excluded.provider, sealed_token = excluded.sealed_token, connected_at = excluded.connected_at, connected_by = excluded.connected_by, config = excluded.config", [r.firmId, r.provider, r.sealedToken, r.connectedAt, r.connectedBy, r.config ? JSON.stringify(r.config) : null]); },
    async remove(id) { await pool.query("delete from firm_storage where firm_id = $1", [id]); }
  };
}

export class StorageError extends Error { code: string; constructor(code: string, message: string) { super(message); this.code = code; } }
export interface AppKeys { clientId: string; clientSecret: string }
export interface StorageDeps { store: StorageStore; secrets: Secrets; google?: AppKeys; microsoft?: AppKeys; dropbox?: AppKeys; appUrl: string; stateSecret: string; clock: () => Date; fetch?: typeof fetch; log?: (event: string, ...ids: unknown[]) => void }
type Tokens = { access_token?: string; refresh_token?: string; expires_in?: number; scope?: string; error?: string };
// What differs between services: where the owner signs in, where a code becomes a token, and how a permission is given up.
interface Service { name: string; keys: AppKeys; authorize: string; tokenUrl: string; scope: string; extra: Record<string, string>; needsScope?: string; revoke?: (f: typeof fetch, refresh: string, access: string | null) => Promise<void> }

const enc = (path: string) => path.split("/").filter(Boolean).map(encodeURIComponent).join("/");
async function okJson(r: Response, what: string): Promise<Record<string, any>> { const j = (await r.json().catch(() => ({}))) as Record<string, any>; if (!r.ok) throw Object.assign(new Error(what + " " + r.status), { code: r.status }); return j; }   // eslint-disable-line @typescript-eslint/no-explicit-any

/** OneDrive and SharePoint, through Microsoft Graph. `base` is the folder everything goes under; `items` is where an item is addressed by id. */
export function graphFiles(o: { token(firmId: string): Promise<string>; place(firmId: string): Promise<{ base: string; items: string }>; fetchImpl?: typeof fetch }): FilesAdapter {
  const f = o.fetchImpl || fetch, G = "https://graph.microsoft.com/v1.0", CHUNK = 16 * 327680, known = new Map<string, string>();
  const call = async (firmId: string, url: string, init: RequestInit = {}) => f(url, { ...init, headers: { ...(init.headers as Record<string, string>), authorization: "Bearer " + (await o.token(firmId)) } });
  // Finds a folder by its path, making each missing part. Returns its id.
  async function folderId(firmId: string, path: string): Promise<string> {
    const { base } = await o.place(firmId), parts = path.split("/").filter(Boolean); let at = "", id = "";
    for (const part of parts) {
      const parent = at; at = at ? at + "/" + part : part; const key = firmId + "|" + base + "|" + at; if (known.has(key)) { id = known.get(key)!; continue; }
      const got = await call(firmId, G + base + ":/" + enc(at));
      if (got.ok) id = String((await got.json() as { id: string }).id);
      else { const made = await call(firmId, G + base + (parent ? ":/" + enc(parent) + ":" : "") + "/children", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: part, folder: {}, "@microsoft.graph.conflictBehavior": "fail" }) }); id = String((await okJson(made, "Could not make the folder")).id); }
      known.set(key, id); if (known.size > 5000) known.clear();
    }
    return id;
  }
  return {
    async put({ firmId, folder, name, bytes }) {
      await folderId(firmId, folder); const { base } = await o.place(firmId), at = G + base + ":/" + enc(folder + "/" + name) + ":";
      if (bytes.length <= 4 * 1024 * 1024) return String((await okJson(await call(firmId, at + "/content?@microsoft.graph.conflictBehavior=rename", { method: "PUT", headers: { "content-type": "application/octet-stream" }, body: new Uint8Array(bytes) }), "Upload failed")).id);
      // Larger files go up in pieces through an upload session. The session's address carries its own permission.
      const s = await okJson(await call(firmId, at + "/createUploadSession", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ item: { "@microsoft.graph.conflictBehavior": "rename" } }) }), "Upload could not start"); let last: Record<string, any> = {};   // eslint-disable-line @typescript-eslint/no-explicit-any
      for (let from = 0; from < bytes.length; from += CHUNK) { const to = Math.min(bytes.length, from + CHUNK); last = await okJson(await f(String(s.uploadUrl), { method: "PUT", headers: { "content-length": String(to - from), "content-range": "bytes " + from + "-" + (to - 1) + "/" + bytes.length }, body: new Uint8Array(bytes.subarray(from, to)) }), "Upload failed"); }
      if (!last.id) throw new Error("Upload did not finish"); return String(last.id);
    },
    async move({ firmId, id, folder, name }) {
      const parent = await folderId(firmId, folder), { items } = await o.place(firmId);
      await okJson(await call(firmId, G + items + "/" + encodeURIComponent(id), { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ name, parentReference: { id: parent } }) }), "Could not move the file");
    }
  };
}

/** Dropbox. Paths are inside Tallyhound's own app folder. A file keeps its id when it is moved or renamed. */
export function dropboxFiles(o: { token(firmId: string): Promise<string>; fetchImpl?: typeof fetch }): FilesAdapter {
  const f = o.fetchImpl || fetch, arg = (v: unknown) => JSON.stringify(v).replace(/[\u007f-￿]/g, (c) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"));   // the header must be plain ASCII
  const path = (folder: string, name: string) => "/" + folder.split("/").filter(Boolean).concat(name).join("/");
  return {
    async put({ firmId, folder, name, bytes }) { return String((await okJson(await f("https://content.dropboxapi.com/2/files/upload", { method: "POST", headers: { authorization: "Bearer " + (await o.token(firmId)), "content-type": "application/octet-stream", "dropbox-api-arg": arg({ path: path(folder, name), mode: "add", autorename: true, mute: true }) }, body: new Uint8Array(bytes) }), "Upload failed")).id); },
    async move({ firmId, id, folder, name }) { await okJson(await f("https://api.dropboxapi.com/2/files/move_v2", { method: "POST", headers: { authorization: "Bearer " + (await o.token(firmId)), "content-type": "application/json" }, body: JSON.stringify({ from_path: id, to_path: path(folder, name), autorename: true }) }), "Could not move the file"); }
  };
}

export function createStorage(d: StorageDeps) {
  const f = d.fetch || fetch, base = d.appUrl.replace(/\/$/, ""), fresh = new Map<string, { token: string; until: number }>(), label = (name: string) => "storage:" + name;
  const form = (v: Record<string, string>) => ({ method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(v).toString(), signal: AbortSignal.timeout(15000) });
  const MS = "https://login.microsoftonline.com/common/oauth2/v2.0", services: Record<string, Service> = {};
  if (d.google) services[GOOGLE] = { name: GOOGLE, keys: d.google, authorize: "https://accounts.google.com/o/oauth2/v2/auth", tokenUrl: "https://oauth2.googleapis.com/token", scope: SCOPE, needsScope: SCOPE, extra: { access_type: "offline", prompt: "consent", include_granted_scopes: "false" }, revoke: async (ff, refresh) => { await ff("https://oauth2.googleapis.com/revoke", form({ token: refresh })); } };
  // Microsoft has no address for an app to give its own permission back: disconnecting forgets the token here, and the page tells the owner where to remove Tallyhound in their Microsoft account.
  if (d.microsoft) { services[ONEDRIVE] = { name: ONEDRIVE, keys: d.microsoft, authorize: MS + "/authorize", tokenUrl: MS + "/token", scope: "Files.ReadWrite.AppFolder offline_access", extra: { prompt: "select_account" } }; services[SHAREPOINT] = { name: SHAREPOINT, keys: d.microsoft, authorize: MS + "/authorize", tokenUrl: MS + "/token", scope: "Sites.ReadWrite.All offline_access", extra: { prompt: "select_account" } }; }
  if (d.dropbox) services[DROPBOX] = { name: DROPBOX, keys: d.dropbox, authorize: "https://www.dropbox.com/oauth2/authorize", tokenUrl: "https://api.dropboxapi.com/oauth2/token", scope: "", extra: { token_access_type: "offline" }, revoke: async (ff, _refresh, access) => { if (access) await ff("https://api.dropboxapi.com/2/auth/token/revoke", { method: "POST", headers: { authorization: "Bearer " + access }, signal: AbortSignal.timeout(10000) }); } };
  const slugOf = (name: string) => Object.keys(SLUG).find((k) => SLUG[k] === name)!, redirect = (name: string) => base + "/api/storage/" + slugOf(name) + "/callback";

  const sign = (body: string) => createHmac("sha256", d.stateSecret).update("storage-state\n" + body).digest("base64url");
  // The value that travels to the service and back. It names the firm, the person and the service, expires, and cannot be made by anyone else.
  const stateFor = (firmId: string, userId: string, name: string, site: string) => { const body = Buffer.from(JSON.stringify({ f: firmId, u: userId, p: name, s: site, t: d.clock().getTime(), n: randomBytes(8).toString("hex") })).toString("base64url"); return body + "." + sign(body); };
  function readState(state: string, firmId: string, userId: string, name: string): { site: string } | null {
    const [body, mac] = String(state || "").split("."); if (!body || !mac) return null; const want = Buffer.from(sign(body)), got = Buffer.from(mac); if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
    try { const j = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as { f: string; u: string; p: string; s: string; t: number }; return j.f === firmId && j.u === userId && j.p === name && d.clock().getTime() - j.t < STATE_MINUTES * 60000 && d.clock().getTime() >= j.t ? { site: String(j.s || "") } : null; } catch { return null; }
  }
  async function tokenCall(s: Service, params: Record<string, string>): Promise<Tokens> {
    const r = await f(s.tokenUrl, form({ client_id: s.keys.clientId, client_secret: s.keys.clientSecret, ...params }));
    const j = (await r.json().catch(() => ({}))) as Record<string, unknown>; return r.ok ? j : { error: String(j.error || "http_" + r.status) };
  }
  const keep = (firmId: string, r: Tokens) => { if (r.access_token) { fresh.set(firmId, { token: r.access_token, until: d.clock().getTime() + Math.max(60, Number(r.expires_in) || 3000) * 1000 }); if (fresh.size > 2000) fresh.clear(); } };
  async function token(firmId: string): Promise<string> {
    const have = fresh.get(firmId); if (have && have.until > d.clock().getTime() + 60000) return have.token;
    const row = await d.store.get(firmId), s = row && services[row.provider]; if (!row || !s) throw new StorageError("not_connected", "This firm's storage is not connected");
    const r = await tokenCall(s, { grant_type: "refresh_token", refresh_token: (await d.secrets.open(firmId, row.sealedToken, label(row.provider))).toString("utf8"), ...(s.scope && s.name !== GOOGLE ? { scope: s.scope } : {}) });
    // invalid_grant: the owner took the permission away, or the token aged out. The connection is over until they reconnect.
    if (!r.access_token) { if (d.log) d.log("storage_token_failed", firmId, r.error || "no token"); throw new StorageError(r.error === "invalid_grant" ? "revoked" : "token", r.error === "invalid_grant" ? row.provider + " says Tallyhound no longer has permission. Connect it again in Settings" : row.provider + " did not give a token"); }
    // Microsoft and Dropbox may hand back a new long-lived token with each refresh. The newest one is the one kept.
    if (r.refresh_token) await d.store.put({ ...row, sealedToken: await d.secrets.seal(firmId, Buffer.from(r.refresh_token, "utf8"), label(row.provider)) });
    keep(firmId, r); return r.access_token;
  }
  // A SharePoint site address becomes the ids Graph needs. Only an address on sharepoint.com is ever asked about.
  async function sharePointPlace(access: string, site: string): Promise<Record<string, string>> {
    let u: URL; try { u = new URL(site); } catch { throw new StorageError("site", "Give the address of your SharePoint site, like https://yourfirm.sharepoint.com/sites/Tax"); }
    if (u.protocol !== "https:" || !/^[a-z0-9-]+\.sharepoint\.com$/i.test(u.hostname)) throw new StorageError("site", "Give the address of your SharePoint site, like https://yourfirm.sharepoint.com/sites/Tax");
    const path = u.pathname.replace(/\/+$/, ""), h = { authorization: "Bearer " + access };
    const s = await f("https://graph.microsoft.com/v1.0/sites/" + u.hostname + (path ? ":" + path.split("/").map(encodeURIComponent).join("/") : ""), { headers: h }); if (!s.ok) throw new StorageError("site", "Microsoft could not find that SharePoint site, or you cannot open it");
    const siteId = String(((await s.json()) as { id: string }).id), dr = await f("https://graph.microsoft.com/v1.0/sites/" + encodeURIComponent(siteId) + "/drive", { headers: h }); if (!dr.ok) throw new StorageError("site", "That SharePoint site has no document library Tallyhound can use");
    return { driveId: String(((await dr.json()) as { id: string }).id), site: u.origin + path };
  }
  const drive = googleDrive({ token, rootId: async () => null, fetchImpl: f });
  const graph = graphFiles({ token, fetchImpl: f, place: async (firmId) => { const row = await d.store.get(firmId); if (row && row.provider === SHAREPOINT && row.config && row.config.driveId) { const p = "/drives/" + encodeURIComponent(row.config.driveId); return { base: p + "/root", items: p + "/items" }; } return { base: "/me/drive/special/approot", items: "/me/drive/items" }; } });
  const box = dropboxFiles({ token, fetchImpl: f });
  const adapterOf = async (firmId: string, provider: string | undefined): Promise<FilesAdapter> => {
    const row = await d.store.get(firmId); if (!provider || !services[provider]) throw new StorageError("provider", (provider || "That storage") + " is not connected");
    if (!row || row.provider !== provider) throw new StorageError("not_connected", "This firm's storage is not connected");
    return provider === GOOGLE ? drive : provider === DROPBOX ? box : graph;
  };
  return {
    /** The services this installation can connect, by name. */
    offered: () => Object.keys(services),
    /** Where the owner's browser is sent to sign in and say yes. `site` is the SharePoint site address, for SharePoint only. */
    startUrl(firmId: string, userId: string, name: string = GOOGLE, site = ""): string {
      const s = services[name]; if (!s) throw new StorageError("unavailable", name + " cannot be connected yet");
      return s.authorize + "?" + new URLSearchParams({ client_id: s.keys.clientId, redirect_uri: redirect(name), response_type: "code", ...(s.scope ? { scope: s.scope } : {}), ...s.extra, state: stateFor(firmId, userId, name, site) }).toString();
    },
    /** The service sent the owner back. Trades the one-time code for the long-lived token and stores it sealed. */
    async finish(firmId: string, userId: string, q: { code?: string; state?: string; error?: string }, name: string = GOOGLE): Promise<void> {
      const s = services[name]; if (!s) throw new StorageError("unavailable", name + " cannot be connected yet");
      const st = readState(String(q.state || ""), firmId, userId, name); if (!st) throw new StorageError("state", "That did not come from a sign-in you started here. Try connecting again");
      if (q.error || !q.code) throw new StorageError("declined", name + " was not given permission, so nothing was connected");
      const r = await tokenCall(s, { grant_type: "authorization_code", code: q.code, redirect_uri: redirect(name), ...(s.scope && s.name !== GOOGLE ? { scope: s.scope } : {}) });
      if (!r.refresh_token || !r.access_token) throw new StorageError("token", name + " did not finish the connection. Try again");
      if (s.needsScope && !String(r.scope || "").split(" ").includes(s.needsScope)) throw new StorageError("scope", "Tallyhound needs the permission to add files. Connect again and leave that box ticked");
      const config = name === SHAREPOINT ? await sharePointPlace(r.access_token, st.site) : null;
      // One connection per firm. Whatever was connected before is given up first.
      const was = await d.store.get(firmId); if (was && was.provider !== name) await this.disconnect(firmId);
      await d.store.put({ firmId, provider: name, sealedToken: await d.secrets.seal(firmId, Buffer.from(r.refresh_token, "utf8"), label(name)), connectedAt: d.clock(), connectedBy: userId, config });
      fresh.delete(firmId); keep(firmId, r);
    },
    /** Gives the permission up at the service where it can be, and forgets the token. Forgetting happens even if the service cannot be reached. */
    async disconnect(firmId: string): Promise<void> {
      const row = await d.store.get(firmId), access = fresh.get(firmId)?.token || null; fresh.delete(firmId); if (!row) return; const s = services[row.provider];
      try { if (s && s.revoke) await s.revoke(f, (await d.secrets.open(firmId, row.sealedToken, label(row.provider))).toString("utf8"), access); } catch { /* forgotten here all the same */ }
      await d.store.remove(firmId);
    },
    async status(firmId: string): Promise<{ connected: boolean; provider: string | null; since: Date | null; site: string | null }> { const r = await d.store.get(firmId); return { connected: !!r, provider: r ? r.provider : null, since: r ? r.connectedAt : null, site: r && r.config ? r.config.site || null : null }; },
    /** What the pipeline files with. A service that is not the one this firm connected is refused, never guessed at. */
    files: {
      async put(o) { return (await adapterOf(o.firmId, o.provider)).put(o); },
      async move(o) { return (await adapterOf(o.firmId, o.provider)).move(o); }
    } as FilesAdapter
  };
}
export type Storage = ReturnType<typeof createStorage>;
