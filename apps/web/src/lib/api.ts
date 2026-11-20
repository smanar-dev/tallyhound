// Every call the browser makes to the web service. The header marks the request as coming from our own pages; the server refuses changes without it.
export class ApiError extends Error {
  status: number; code: string;
  constructor(status: number, code: string, message: string) { super(message); this.status = status; this.code = code; }
}
async function call<T>(method: "GET" | "POST" | "DELETE", path: string, body?: unknown, key?: string): Promise<T> {
  let res: Response;
  try { res = await fetch(path, { method, credentials: "same-origin", headers: { "content-type": "application/json", "x-tallyhound": "1", ...(key ? { "idempotency-key": key } : {}) }, body: method === "GET" ? undefined : JSON.stringify(body ?? {}) }); }
  catch { throw new ApiError(0, "offline", "Tallyhound could not be reached. Check your connection and try again."); }
  const text = await res.text(); let json: unknown = null; try { json = text ? JSON.parse(text) : null; } catch { /* a page, not JSON */ }
  if (!res.ok) { const j = (json || {}) as { error?: string; message?: string }; throw new ApiError(res.status, j.error || "error", j.message || "Something went wrong. Try again."); }
  return json as T;
}
const newKey = () => { const b = new Uint8Array(18); crypto.getRandomValues(b); return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join(""); };
async function once<T>(body: unknown): Promise<T> {
  const key = newKey();
  try { return await call<T>("POST", "/api/act", body, key); }
  catch (err) { if (!(err instanceof ApiError) || err.status !== 0) throw err; await new Promise((r) => setTimeout(r, 1200)); return call<T>("POST", "/api/act", body, key); }
}
export interface Me { id: string; name: string; email: string; role: "owner" | "staff" | "read_only"; firmId: string }
export const api = {
  me: () => call<Me>("GET", "/api/me"),
  /** The firm's workspace exactly as the engine saved it, as text, ready for the engine to load. */
  async stateText(): Promise<string> {
    let res: Response;
    try { res = await fetch("/api/state", { credentials: "same-origin", headers: { "x-tallyhound": "1" } }); } catch { throw new ApiError(0, "offline", "Tallyhound could not be reached. Check your connection and try again."); }
    if (!res.ok) { const j = (await res.json().catch(() => ({}))) as { error?: string; message?: string }; throw new ApiError(res.status, j.error || "error", j.message || "Something went wrong. Try again."); }
    return res.text();
  },
  // Every change carries a key made once per click. If the answer is lost on the way back, the same request is sent once more
  // with the same key, and the server runs it once.
  act: (fn: string, args: unknown[]) => once<{ ok: true; result: unknown }>({ fn, args }),
  actMany: (calls: { fn: string; args: unknown[] }[]) => once<{ ok: true; results: unknown[] }>({ calls }),
  /** A staff member adds a document they received some other way. The file goes up as it is; the server identifies and checks it. */
  async upload(clientId: string, file: File): Promise<{ ok: true; docs: (string | null)[] }> {
    let res: Response;
    try { res = await fetch("/api/clients/" + encodeURIComponent(clientId) + "/documents", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/octet-stream", "x-tallyhound": "1" }, body: file }); }
    catch { throw new ApiError(0, "offline", "Tallyhound could not be reached. Check your connection and try again."); }
    const j = (await res.json().catch(() => ({}))) as { error?: string; message?: string; docs?: (string | null)[] };
    if (!res.ok) throw new ApiError(res.status, j.error || "error", j.message || "That file could not be added.");
    return { ok: true, docs: j.docs || [] };
  },
  /** A question for the Hound, with the conversation so far. It only reads. */
  ask: (messages: { role: "user" | "assistant"; text: string }[]) => call<{ text: string }>("POST", "/api/hound/ask", { messages }),
  /** An owner takes a copy of the firm's consent records or its audit trail, as a spreadsheet. */
  async exportCsv(what: "consent" | "audit"): Promise<void> {
    let res: Response;
    try { res = await fetch("/api/export/" + what, { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json", "x-tallyhound": "1" }, body: "{}" }); }
    catch { throw new ApiError(0, "offline", "Tallyhound could not be reached. Check your connection and try again."); }
    if (!res.ok) { const j = (await res.json().catch(() => ({}))) as { error?: string; message?: string }; throw new ApiError(res.status, j.error || "error", j.message || "That could not be downloaded."); }
    const blob = await res.blob(), name = /filename="([^"]+)"/.exec(res.headers.get("content-disposition") || "")?.[1] || what + ".csv", url = URL.createObjectURL(blob), a = document.createElement("a");
    a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 10000);
  },
  /** Hands off one client's finished files as a zip and saves it. Resolves with how many files it held and how many documents are still missing. */
  async handOffZip(engId: string): Promise<{ files: number; missing: number }> {
    let res: Response;
    try { res = await fetch("/api/clients/" + encodeURIComponent(engId) + "/files.zip", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json", "x-tallyhound": "1" }, body: "{}" }); }
    catch { throw new ApiError(0, "offline", "Tallyhound could not be reached. Check your connection and try again."); }
    if (!res.ok) { const j = (await res.json().catch(() => ({}))) as { error?: string; message?: string }; throw new ApiError(res.status, j.error || "error", j.message || "The files could not be handed off."); }
    const blob = await res.blob(), name = /filename="([^"]+)"/.exec(res.headers.get("content-disposition") || "")?.[1] || "files.zip", url = URL.createObjectURL(blob), a = document.createElement("a");
    a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 10000);
    return { files: +(res.headers.get("x-tallyhound-files") || 0), missing: +(res.headers.get("x-tallyhound-missing") || 0) };
  },
  post: <T,>(path: string, body?: unknown) => call<T>("POST", path, body),
  get: <T,>(path: string) => call<T>("GET", path),
  del: <T,>(path: string) => call<T>("DELETE", path)
};
