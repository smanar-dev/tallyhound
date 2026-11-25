// The Neeter adapter (docs/V2.md section 4, TH-NTR-1). The only place in Tallyhound that knows Neeter exists.
//
// IMPORTANT: Neeter has not published the operations of its agent interface. The addresses and field names below are the contract
// Tallyhound has asked for (docs/V2.md, "What Tallyhound needs from the layer"), not something read from Neeter's documentation,
// and none of it has been run against Neeter. When Neeter confirms its interface, this file is the one that changes; the interface
// in ../../maillayer.ts and everything that uses it stay as they are. Four of these operations need Neeter to build something it
// does not have today: provision without its own sign-in, send a letter on demand in Tallyhound's words, send without a click,
// and deliver replies (POST /hooks/neeter).
//
// Each firm has its own key, limited to that firm's mailboxes, sealed with the firm's key, replaced every 90 days (TH-NTR-9).
// Nothing here logs a body, an address or a key. With trace on, each call is logged as its method, its path with every id taken
// out, its status and how long it took.
//
// Two answers Neeter may give are settings here, not code (docs/neeter/RUNBOOK.md):
//   send: "letters"   Neeter sends Tallyhound's letter when asked (the design).
//   send: "due_date"  Neeter can only send its own follow-up the morning before a task's due date. The letter is not sent by us;
//                     the project's due date is set to tomorrow and Neeter's own wording goes. A stopgap for the pilot only.
//   Replies: pushed to POST /hooks/neeter, or fetched with listEvents when Neeter cannot call us (the worker's layerPoll).
// The paths and fields below must match docs/neeter/contract.json; apps/server/test/neeter.test.ts checks that they do.
import { LayerError, type LayerEvent, type LayerProject, type MailLayer, type TaskStatus } from "../../maillayer.ts";

export const KEY_DAYS = 90;
export interface KeyStore { get(firmId: string): Promise<{ key: string; issuedAt: Date } | null>; put(firmId: string, key: string, issuedAt: Date): Promise<void> }
export interface NeeterDeps { baseUrl: string; partnerKey: string; keys: KeyStore; clock: () => Date; fetch?: typeof fetch; log?: (event: string, ...ids: unknown[]) => void; timeoutMs?: number; send?: "letters" | "due_date"; trace?: boolean }
export const template = (path: string) => path.replace(/\?.*$/, "").replace(/\/(assistants|projects|tasks|letters|keys)\/[^/]+/g, "/$1/{id}");

export function neeter(d: NeeterDeps): MailLayer & { rotateKey(firmId: string): Promise<void>; keyAge(firmId: string): Promise<number | null> } {
  const f = d.fetch || fetch, base = d.baseUrl.replace(/\/+$/, ""), say = d.log || (() => {});
  async function raw(key: string, method: string, path: string, body?: unknown, idem?: string): Promise<Record<string, unknown>> {
    let r: Response; const t0 = Date.now(), trace = (st: number | string) => { if (d.trace) say("layer_call", method, template(path), st, Date.now() - t0); };
    try { r = await f(base + path, { method, headers: { authorization: "Bearer " + key, "content-type": "application/json", ...(idem ? { "idempotency-key": idem } : {}) }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(d.timeoutMs || 15000) }); }
    catch { trace("no answer"); throw new LayerError("unreachable", "The email service could not be reached"); }
    trace(r.status);
    if (r.status >= 500 || r.status === 429 || r.status === 408) throw new LayerError("unreachable", "The email service is not answering (" + r.status + ")");
    if (r.status === 404 && method === "GET") return { missing: true };
    if (!r.ok) throw new LayerError("refused", "The email service refused the request (" + r.status + ")");
    return r.status === 204 ? {} : ((await r.json().catch(() => ({}))) as Record<string, unknown>);
  }
  // The firm's own key. Made with the partner key the first time, and again when it is 90 days old; the old one is then given up.
  async function mint(firmId: string, was?: string): Promise<string> {
    const j = await raw(d.partnerKey, "POST", "/v1/keys", { account: firmId, scope: "account" }, "key:" + firmId + ":" + d.clock().toISOString().slice(0, 10)), key = String(j.key || ""); if (!key) throw new LayerError("refused", "The email service gave no key");
    await d.keys.put(firmId, key, d.clock()); if (was) await raw(d.partnerKey, "POST", "/v1/keys/revoke", { key: was }).catch(() => say("layer_key_revoke_failed", firmId)); say("layer_key_made", firmId); return key;
  }
  async function keyOf(firmId: string): Promise<string> { const k = await d.keys.get(firmId); if (!k) return mint(firmId); if (d.clock().getTime() - k.issuedAt.getTime() > KEY_DAYS * 86400000) return mint(firmId, k.key).catch(() => k.key); return k.key; }
  const call = async (firmId: string, method: string, path: string, body?: unknown, idem?: string) => raw(await keyOf(firmId), method, path, body, idem);
  const A = (id: string) => "/v1/assistants/" + encodeURIComponent(id), P = (a: string, p: string) => A(a) + "/projects/" + encodeURIComponent(p);
  return {
    async rotateKey(firmId) { const k = await d.keys.get(firmId); await mint(firmId, k ? k.key : undefined); },
    async keyAge(firmId) { const k = await d.keys.get(firmId); return k ? Math.floor((d.clock().getTime() - k.issuedAt.getTime()) / 86400000) : null; },
    async provision(a) { const j = await call(a.firmId, "POST", "/v1/assistants", { external_id: a.userId, provider: a.provider, address: a.address, refresh_token: a.refreshToken, scopes: a.scopes, white_label: true, signature: false, auto_send: true }, "assistant:" + a.firmId + ":" + a.userId + ":" + a.address); const id = String(j.id || ""); if (!id) throw new LayerError("refused", "The email service made no assistant"); return { assistantId: id }; },
    async remove(a) { await call(a.firmId, "DELETE", A(a.assistantId)); },
    async upsertProject(a) { const j = await call(a.firmId, a.remoteId ? "PUT" : "POST", a.remoteId ? P(a.assistantId, a.remoteId) : A(a.assistantId) + "/projects", { external_id: a.key.split(":")[0], name: a.name, contact_email: a.email, closed: a.closed, due_date: a.due }, a.key); return { id: String(j.id || a.remoteId || "") }; },
    async upsertTask(a) { const path = P(a.assistantId, a.projectId) + "/tasks" + (a.remoteId ? "/" + encodeURIComponent(a.remoteId) : ""), j = await call(a.firmId, a.remoteId ? "PUT" : "POST", path, { external_id: a.key.split(":")[0], title: a.title, owed_by: "client", status: a.status, note: a.note }, a.key); return { id: String(j.id || a.remoteId || "") }; },
    async forgetProject(a) { await call(a.firmId, "DELETE", P(a.assistantId, a.projectId), undefined, a.key); },
    async sendLetter(a) {
      if (d.send === "due_date") { const due = new Date(d.clock().getTime() + 86400000).toISOString().slice(0, 10); await call(a.firmId, "PATCH", P(a.assistantId, a.projectId), { due_date: due }, a.key + ":due"); return { id: "due:" + a.key, thread: a.thread || "" }; }
      const j = await call(a.firmId, "POST", P(a.assistantId, a.projectId) + "/letters", { to: a.to, subject: a.subject, body: a.body, thread_id: a.thread || null, list_unsubscribe: a.unsubscribe || null, send_now: true, add_signature: false }, a.key); return { id: String(j.id || ""), thread: String(j.thread_id || a.thread || "") }; },
    async listEvents(a) { const j = await call(a.firmId, "GET", A(a.assistantId) + "/events" + (a.cursor ? "?cursor=" + encodeURIComponent(a.cursor) : "")), list = (Array.isArray(j.events) ? j.events : []) as LayerEvent[]; return { events: list.map((x) => ({ ...x, assistant_id: x.assistant_id || a.assistantId })), cursor: j.cursor == null ? a.cursor : String(j.cursor) }; },
    async whoAmI() { const j = await raw(d.partnerKey, "GET", "/v1/partner"); return String(j.name || j.id || "an account with no name"); },
    async maintain(firmId) { const k = await d.keys.get(firmId); if (k && d.clock().getTime() - k.issuedAt.getTime() >= KEY_DAYS * 86400000) await mint(firmId, k.key); },
    async getProject(a) {
      const j = await call(a.firmId, "GET", P(a.assistantId, a.projectId) + "?include=tasks,history"); if (j.missing) return null;
      const tasks = (Array.isArray(j.tasks) ? j.tasks : []) as Record<string, unknown>[], history = (Array.isArray(j.history) ? j.history : []) as Record<string, unknown>[];
      return { name: String(j.name || ""), closed: !!j.closed, tasks: tasks.map((t) => ({ id: String(t.id), title: String(t.title || ""), status: String(t.status) as TaskStatus })), history: history.map((h) => ({ taskId: String(h.task_id), at: String(h.at), from: h.from == null ? null : String(h.from), to: String(h.to), by: String(h.by || "") })) } satisfies LayerProject;
    }
  };
}
