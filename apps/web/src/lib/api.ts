// Every call the browser makes to the web service. The header marks the request as coming from our own pages; the server refuses changes without it.
export class ApiError extends Error {
  status: number; code: string;
  constructor(status: number, code: string, message: string) { super(message); this.status = status; this.code = code; }
}
async function call<T>(method: "GET" | "POST" | "DELETE", path: string, body?: unknown): Promise<T> {
  let res: Response;
  try { res = await fetch(path, { method, credentials: "same-origin", headers: { "content-type": "application/json", "x-tallyhound": "1" }, body: method === "GET" ? undefined : JSON.stringify(body ?? {}) }); }
  catch { throw new ApiError(0, "offline", "Tallyhound could not be reached. Check your connection and try again."); }
  const text = await res.text(); let json: unknown = null; try { json = text ? JSON.parse(text) : null; } catch { /* a page, not JSON */ }
  if (!res.ok) { const j = (json || {}) as { error?: string; message?: string }; throw new ApiError(res.status, j.error || "error", j.message || "Something went wrong. Try again."); }
  return json as T;
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
  act: (fn: string, args: unknown[]) => call<{ ok: true; result: unknown }>("POST", "/api/act", { fn, args }),
  actMany: (calls: { fn: string; args: unknown[] }[]) => call<{ ok: true; results: unknown[] }>("POST", "/api/act", { calls }),
  post: <T,>(path: string, body?: unknown) => call<T>("POST", path, body),
  get: <T,>(path: string) => call<T>("GET", path),
  del: <T,>(path: string) => call<T>("DELETE", path)
};
