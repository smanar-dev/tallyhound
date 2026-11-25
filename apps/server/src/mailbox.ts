// Mailbox connection (docs/V2.md section 3, TH-MBX-1 to 3). A preparer gives Tallyhound permission to send letters from their own
// Google or Microsoft mailbox and to read replies to them. The sign-in app is Tallyhound's own, so the one consent screen names
// Tallyhound. Behind it the mail layer is told to make that preparer's assistant: there is no second sign-in and no second screen.
//
// The narrowest permissions that allow the job (TH-MBX-2):
//   Google      gmail.send, gmail.readonly     send as the preparer; read mail. Google offers no narrower way to read replies
//   Microsoft   Mail.Send, Mail.Read           the same
// Reading is limited by the layer, not by the permission: only threads Tallyhound started and only senders on the firm's client
// list are ever read, and only those reach Tallyhound (pipeline layerReply drops anyone else).
// The long-lived token is sealed with the firm's own key and never sent to a browser. Disconnecting gives the permission up at
// Google, forgets the token here and removes the assistant, so letters and reading stop at once. Microsoft offers a signed-in app
// no way to withdraw only its own permission: there the token is forgotten everywhere and the page tells the preparer where to
// remove the app. Written from each provider's reference and tested against stand-ins. Not yet run against a real account.
import { createHmac, timingSafeEqual } from "node:crypto";
import type { Secrets } from "./signin.ts";
import { LayerError, type MailLayer, type PipelineLayer } from "./maillayer.ts";

export type Provider = "google" | "microsoft";
export const STATE_MINUTES = 10, LABEL = "mailbox";
export const SCOPES: Record<Provider, string[]> = {
  google: ["openid", "email", "https://www.googleapis.com/auth/gmail.send", "https://www.googleapis.com/auth/gmail.readonly"],
  microsoft: ["openid", "email", "offline_access", "https://graph.microsoft.com/User.Read", "https://graph.microsoft.com/Mail.Send", "https://graph.microsoft.com/Mail.Read"]
};
export interface MailboxRow { firmId: string; userId: string; provider: Provider; address: string; scopes: string[]; status: "active" | "revoked" | "error"; assistantId: string | null; sealedToken: Buffer | null; connectedAt: Date; revokedAt: Date | null; pollCursor?: string | null; linked?: boolean }
export interface MailboxStore {
  get(firmId: string, userId: string): Promise<MailboxRow | null>; list(firmId: string): Promise<MailboxRow[]>; put(r: MailboxRow): Promise<void>; byAssistant(assistantId: string): Promise<MailboxRow | null>;
  key(firmId: string): Promise<{ sealed: Buffer; issuedAt: Date } | null>; putKey(firmId: string, sealed: Buffer, issuedAt: Date): Promise<void>;
}
export function memoryMailboxStore(): MailboxStore {
  const m = new Map<string, MailboxRow>(), keys = new Map<string, { sealed: Buffer; issuedAt: Date }>();
  return { async get(f, u) { return m.get(f + "|" + u) || null; }, async list(f) { return [...m.values()].filter((r) => r.firmId === f); }, async put(r) { m.set(r.firmId + "|" + r.userId, { ...r }); }, async byAssistant(a) { return [...m.values()].find((r) => r.assistantId === a && r.status === "active") || null; },
    async key(f) { return keys.get(f) || null; }, async putKey(f, sealed, issuedAt) { keys.set(f, { sealed, issuedAt }); } };
}
interface Db { query(sql: string, args?: unknown[]): Promise<{ rows: Record<string, unknown>[] }> }
export function postgresMailboxStore(pool: Db): MailboxStore {
  const row = (r: Record<string, unknown>): MailboxRow => ({ firmId: r.firm_id as string, userId: r.user_id as string, provider: r.provider as Provider, address: r.address as string, scopes: (r.scopes as string[]) || [], status: r.status as MailboxRow["status"], assistantId: (r.assistant_id as string) || null, sealedToken: r.sealed_token ? Buffer.from(r.sealed_token as Buffer) : null, connectedAt: r.connected_at as Date, revokedAt: (r.revoked_at as Date) || null, pollCursor: (r.poll_cursor as string) || null, linked: r.linked === true });
  return {
    async get(f, u) { const r = (await pool.query("select * from mailbox_connection where firm_id = $1 and user_id = $2", [f, u])).rows[0]; return r ? row(r) : null; },
    async list(f) { return (await pool.query("select * from mailbox_connection where firm_id = $1 order by connected_at", [f])).rows.map(row); },
    async put(r) { await pool.query("insert into mailbox_connection (firm_id, user_id, provider, address, scopes, status, assistant_id, sealed_token, connected_at, revoked_at, poll_cursor, linked) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) on conflict (firm_id, user_id) do update set provider = excluded.provider, address = excluded.address, scopes = excluded.scopes, status = excluded.status, assistant_id = excluded.assistant_id, sealed_token = excluded.sealed_token, connected_at = excluded.connected_at, revoked_at = excluded.revoked_at, poll_cursor = excluded.poll_cursor, linked = excluded.linked", [r.firmId, r.userId, r.provider, r.address, r.scopes, r.status, r.assistantId, r.sealedToken, r.connectedAt, r.revokedAt, r.pollCursor || null, r.linked === true]); },
    async byAssistant(a) { const r = (await pool.query("select * from mailbox_connection where assistant_id = $1 and status = 'active'", [a])).rows[0]; return r ? row(r) : null; },
    async key(f) { const r = (await pool.query("select sealed_key, issued_at from mail_layer_key where firm_id = $1", [f])).rows[0]; return r ? { sealed: Buffer.from(r.sealed_key as Buffer), issuedAt: r.issued_at as Date } : null; },
    async putKey(f, sealed, issuedAt) { await pool.query("insert into mail_layer_key (firm_id, sealed_key, issued_at) values ($1,$2,$3) on conflict (firm_id) do update set sealed_key = excluded.sealed_key, issued_at = excluded.issued_at", [f, sealed, issuedAt]); }
  };
}

export class MailboxError extends Error { code: string; constructor(code: string, message: string) { super(message); this.code = code; } }
export interface AppKeys { clientId: string; clientSecret: string }
export interface MailboxDeps { store: MailboxStore; secrets: Secrets; layer: MailLayer; google?: AppKeys; microsoft?: AppKeys; appUrl: string; stateSecret: string; clock: () => Date; fetch?: typeof fetch; log?: (event: string, ...ids: unknown[]) => void }
interface Service { keys: AppKeys; authorize: string; tokenUrl: string; extra: Record<string, string>; needs: string[]; who(f: typeof fetch, access: string): Promise<string>; revoke?(f: typeof fetch, refresh: string): Promise<void> }
type Tokens = { access_token?: string; refresh_token?: string; scope?: string; error?: string };

export function createMailboxes(d: MailboxDeps) {
  const f = d.fetch || fetch, say = d.log || (() => {}), services: Partial<Record<Provider, Service>> = {};
  const form = (params: Record<string, string>) => ({ method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(params).toString() });
  if (d.google) services.google = { keys: d.google, authorize: "https://accounts.google.com/o/oauth2/v2/auth", tokenUrl: "https://oauth2.googleapis.com/token", extra: { access_type: "offline", prompt: "consent", include_granted_scopes: "false" }, needs: SCOPES.google.slice(2),
    async who(ff, access) { const r = await ff("https://openidconnect.googleapis.com/v1/userinfo", { headers: { authorization: "Bearer " + access } }), j = (await r.json().catch(() => ({}))) as { email?: string; email_verified?: boolean }; return r.ok && j.email && j.email_verified !== false ? String(j.email).toLowerCase() : ""; },
    async revoke(ff, refresh) { await ff("https://oauth2.googleapis.com/revoke", form({ token: refresh })); } };
  if (d.microsoft) services.microsoft = { keys: d.microsoft, authorize: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize", tokenUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/token", extra: { prompt: "consent" }, needs: [],
    async who(ff, access) { const r = await ff("https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName", { headers: { authorization: "Bearer " + access } }), j = (await r.json().catch(() => ({}))) as { mail?: string; userPrincipalName?: string }; return r.ok ? String(j.mail || j.userPrincipalName || "").toLowerCase() : ""; } };
  const redirect = (p: Provider) => d.appUrl.replace(/\/$/, "") + "/api/mailbox/" + p + "/callback";
  const sign = (body: string) => createHmac("sha256", d.stateSecret).update("mailbox." + body).digest("base64url");
  const stateFor = (firmId: string, userId: string, p: Provider) => { const body = Buffer.from(JSON.stringify({ f: firmId, u: userId, p, t: d.clock().getTime() })).toString("base64url"); return body + "." + sign(body); };
  function stateOk(state: string, firmId: string, userId: string, p: Provider): boolean {
    const [body, mac] = String(state || "").split("."); if (!body || !mac) return false; const want = Buffer.from(sign(body)), got = Buffer.from(mac); if (want.length !== got.length || !timingSafeEqual(want, got)) return false;
    try { const j = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as { f: string; u: string; p: string; t: number }, age = d.clock().getTime() - j.t; return j.f === firmId && j.u === userId && j.p === p && age >= 0 && age < STATE_MINUTES * 60000; } catch { return false; }
  }
  /** Told when a mailbox is connected or gone, so the firm's own record knows who can send (the engine's setMailbox). */
  let changed: (firmId: string, userId: string, info: { provider: Provider; address: string } | null) => Promise<void> = async () => {};
  const view = (r: MailboxRow) => ({ userId: r.userId, provider: r.provider, address: r.address, status: r.status, connectedAt: r.connectedAt });   // never the assistant, never the token
  const api = {
    onChange(fn: typeof changed) { changed = fn; },
    offered: (): Provider[] => Object.keys(services) as Provider[],
    /** Where the preparer's browser goes to say yes. One screen, naming Tallyhound. */
    startUrl(firmId: string, userId: string, p: Provider): string {
      const s = services[p]; if (!s) throw new MailboxError("unavailable", "That kind of mailbox cannot be connected yet");
      return s.authorize + "?" + new URLSearchParams({ client_id: s.keys.clientId, redirect_uri: redirect(p), response_type: "code", scope: SCOPES[p].join(" "), ...s.extra, state: stateFor(firmId, userId, p) }).toString();
    },
    /** The provider sent the preparer back. The code becomes a token, the assistant is made, and the mailbox is recorded as theirs. */
    async finish(firmId: string, userId: string, q: { code?: string; state?: string; error?: string }, p: Provider): Promise<{ address: string }> {
      const s = services[p]; if (!s) throw new MailboxError("unavailable", "That kind of mailbox cannot be connected yet");
      if (!stateOk(String(q.state || ""), firmId, userId, p)) throw new MailboxError("state", "That did not come from a sign-in you started here. Try connecting again");
      if (q.error || !q.code) throw new MailboxError("declined", "Permission was not given, so nothing was connected");
      const r = await f(s.tokenUrl, form({ client_id: s.keys.clientId, client_secret: s.keys.clientSecret, grant_type: "authorization_code", code: q.code, redirect_uri: redirect(p), ...(p === "microsoft" ? { scope: SCOPES.microsoft.join(" ") } : {}) })), t = (r.ok ? await r.json().catch(() => ({})) : {}) as Tokens;
      if (!t.refresh_token || !t.access_token) throw new MailboxError("token", "The connection did not finish. Try again");
      const got = String(t.scope || "").split(/[ ,]+/); if (s.needs.some((x) => !got.includes(x))) throw new MailboxError("scope", "Tallyhound needs both permissions: to send your letters and to read the replies. Connect again and leave both ticked");
      const address = await s.who(f, t.access_token); if (!address) throw new MailboxError("address", "The mailbox's address could not be confirmed. Try again");
      const others = (await d.store.list(firmId)).find((x) => x.userId !== userId && x.status === "active" && x.address === address); if (others) throw new MailboxError("taken", "That mailbox is already connected for someone else at your firm");
      const was = await d.store.get(firmId, userId); if (was && was.status === "active") await api.disconnect(firmId, userId);
      let assistantId: string;
      try { assistantId = (await d.layer.provision({ firmId, userId, provider: p, address, refreshToken: t.refresh_token, scopes: SCOPES[p] })).assistantId; }
      catch (err) { if (s.revoke) await s.revoke(f, t.refresh_token).catch(() => {}); say("mailbox_provision_failed", firmId, err instanceof LayerError ? err.code : "error"); throw new MailboxError("layer", "Your mailbox could not be set up just now. Nothing was connected. Try again in a few minutes"); }
      await d.store.put({ firmId, userId, provider: p, address, scopes: SCOPES[p], status: "active", assistantId, sealedToken: await d.secrets.seal(firmId, Buffer.from(t.refresh_token, "utf8"), LABEL), connectedAt: d.clock(), revokedAt: null });
      await changed(firmId, userId, { provider: p, address }); say("mailbox_connected", firmId, p); return { address };
    },
    /** One click: letters and reading stop at once. Forgetting happens even when a provider or the layer cannot be reached. */
    async disconnect(firmId: string, userId: string): Promise<boolean> {
      const row = await d.store.get(firmId, userId); if (!row || row.status !== "active") return false; const s = services[row.provider];
      await changed(firmId, userId, null);   // first, so nothing more is written for this mailbox
      try { if (s && s.revoke && row.sealedToken) await s.revoke(f, (await d.secrets.open(firmId, row.sealedToken, LABEL)).toString("utf8")); } catch { say("mailbox_revoke_failed", firmId, row.provider); }
      try { if (row.assistantId) await d.layer.remove({ firmId, assistantId: row.assistantId }); } catch { say("mailbox_remove_failed", firmId); }
      await d.store.put({ ...row, status: "revoked", sealedToken: null, assistantId: null, revokedAt: d.clock() }); say("mailbox_disconnected", firmId, row.provider); return true;
    },
    async status(firmId: string) { return (await d.store.list(firmId)).filter((r) => r.status === "active").map(view); },
    /** For the admin command: every mailbox of a firm, with the layer's id, never the token. */
    async adminList(firmId: string) { return (await d.store.list(firmId)).map((r) => ({ ...view(r), assistantId: r.assistantId, linked: r.linked === true, revokedAt: r.revokedAt })); },
    /* If the layer cannot make an assistant from our sign-in (docs/neeter/RUNBOOK.md, "If Neeter cannot provision"), the preparer is set
       up at the layer some other way and Tallyhound is told the assistant's id here. Tallyhound then holds no token of theirs, so a
       disconnect removes the assistant but cannot withdraw the permission at Google: the page says where the preparer does that. */
    async linkExisting(firmId: string, userId: string, a: { assistantId: string; provider: Provider; address: string }): Promise<void> {
      if (!/^[A-Za-z0-9_-]{1,100}$/.test(a.assistantId)) throw new MailboxError("assistant", "That does not look like an assistant id");
      const address = String(a.address || "").trim().toLowerCase(); if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(address)) throw new MailboxError("address", "Give the mailbox's address");
      if (await d.store.byAssistant(a.assistantId)) throw new MailboxError("taken", "That assistant is already linked");
      const was = await d.store.get(firmId, userId); if (was && was.status === "active") await api.disconnect(firmId, userId);
      await d.store.put({ firmId, userId, provider: a.provider, address, scopes: SCOPES[a.provider], status: "active", assistantId: a.assistantId, sealedToken: null, connectedAt: d.clock(), revokedAt: null, linked: true });
      await changed(firmId, userId, { provider: a.provider, address }); say("mailbox_linked", firmId, a.provider);
    },
    /** Closing a firm: every mailbox is disconnected and every assistant removed, before the firm's key is destroyed (the tokens are sealed with it). */
    async removeAll(firmId: string): Promise<number> { let n = 0; for (const r of await d.store.list(firmId)) if (r.status === "active" && (await api.disconnect(firmId, r.userId))) n++; return n; },
    /** Only when the layer cannot call us: fetches what each connected mailbox's assistant has for us and hands each event on. Returns how many. */
    async poll(firmId: string, handle: (e: import("./maillayer.ts").LayerEvent) => Promise<unknown>): Promise<number> {
      if (!d.layer.listEvents) return 0; let n = 0;
      for (const r of await d.store.list(firmId)) {
        if (r.status !== "active" || !r.assistantId) continue;
        try { const got = await d.layer.listEvents({ firmId, assistantId: r.assistantId, cursor: r.pollCursor || null }); for (const e of got.events.slice(0, 200)) { await handle({ ...e, assistant_id: r.assistantId }); n++; } if (got.cursor !== (r.pollCursor || null)) await d.store.put({ ...r, pollCursor: got.cursor }); }
        catch (err) { say("layer_poll_failed", firmId, err instanceof LayerError ? err.code : "error"); }
      }
      return n;
    },
    async maintain(firmId: string): Promise<void> { if (d.layer.maintain && (await d.store.list(firmId)).some((r) => r.status === "active")) await d.layer.maintain(firmId); },
    whoAmI: d.layer.whoAmI ? () => d.layer.whoAmI!() : null,
    async firmOfAssistant(assistantId: string): Promise<{ firmId: string; userId: string } | null> { const r = await d.store.byAssistant(String(assistantId || "")); return r ? { firmId: r.firmId, userId: r.userId } : null; },
    /** The layer as the pipeline uses it: by the staff user whose mailbox it is. */
    pipeline: (() => {
      const as = async (firmId: string, owner: string) => { const r = await d.store.get(firmId, owner); if (!r || r.status !== "active" || !r.assistantId) throw new LayerError("no_mailbox", "That mailbox is not connected"); return r.assistantId; };
      const P: PipelineLayer = {
        async upsertProject(a) { const { owner, ...x } = a; return d.layer.upsertProject({ ...x, assistantId: await as(a.firmId, owner) }); },
        async upsertTask(a) { const { owner, ...x } = a; return d.layer.upsertTask({ ...x, assistantId: await as(a.firmId, owner) }); },
        async forgetProject(a) { const { owner, ...x } = a; return d.layer.forgetProject({ ...x, assistantId: await as(a.firmId, owner) }); },
        async sendLetter(a) { const { owner, ...x } = a; return d.layer.sendLetter({ ...x, assistantId: await as(a.firmId, owner) }); },
        async getProject(a) { const { owner, ...x } = a; return d.layer.getProject({ ...x, assistantId: await as(a.firmId, owner) }); }
      };
      return P;
    })()
  };
  return api;
}
export type Mailboxes = ReturnType<typeof createMailboxes>;

/** Where the firm's layer key is kept: sealed with the firm's own key (TH-NTR-9). */
export function layerKeys(store: MailboxStore, secrets: Secrets) {
  return {
    async get(firmId: string) { const k = await store.key(firmId); return k ? { key: (await secrets.open(firmId, k.sealed, "layer-key")).toString("utf8"), issuedAt: k.issuedAt } : null; },
    async put(firmId: string, key: string, issuedAt: Date) { await store.putKey(firmId, await secrets.seal(firmId, Buffer.from(key, "utf8"), "layer-key"), issuedAt); }
  };
}

/** The layer's calls to us are signed: HMAC-SHA256 over the time and the exact bytes, and not older than five minutes (replay). */
export const HOOK_WINDOW_S = 300;
export function hookSigned(secret: string, header: string, raw: Buffer, now: Date): boolean {
  const m = /^t=(\d{9,12}),v1=([0-9a-f]{64})$/.exec(String(header || "")); if (!m || !secret) return false;
  if (Math.abs(now.getTime() / 1000 - +m[1]!) > HOOK_WINDOW_S) return false;
  const want = Buffer.from(createHmac("sha256", secret).update(m[1] + ".").update(raw).digest("hex")), got = Buffer.from(m[2]!); return want.length === got.length && timingSafeEqual(want, got);
}
export const hookSign = (secret: string, raw: Buffer, now: Date) => { const t = Math.floor(now.getTime() / 1000); return "t=" + t + ",v1=" + createHmac("sha256", secret).update(t + ".").update(raw).digest("hex"); };
