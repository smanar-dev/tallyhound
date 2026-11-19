// The web service. Sign-in, the firm's state for the web app, and one endpoint per kind of staff action.
// It holds no product rules: every action runs the engine through the pipeline (app.staff), which loads, decides, saves and sends.
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import cookie from "@fastify/cookie";
import QRCode from "qrcode";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { extname, join } from "node:path";
import type { App, Engine, Role } from "./kit.ts";
import type { AuthStore, Session, User } from "./authstore.ts";
import { SignInError, type SignIn } from "./signin.ts";
import { FirmError, type Firms } from "./firms.ts";
import { ACTIONS, allowed, run } from "./actions.ts";
import { registerHooks, type HookDeps } from "./hooks.ts";
import { ready } from "./files.ts";
import type { PrepareOpts } from "./kit.ts";

export interface ServerDeps {
  app: App; auth: AuthStore; signIn: SignIn; firms: Firms;
  readState(firmId: string): Promise<string | null>;
  appUrl: string; secureCookies: boolean; webDir: string; prepare?: PrepareOpts;
  health?: () => Record<string, unknown> | Promise<Record<string, unknown>>;
  hooks?: Omit<HookDeps, "app" | "store" | "publicUrl" | "log"> & { store: HookDeps["store"] };
  log?: (event: string, ...ids: unknown[]) => void;
}
const COOKIE = "th_s";
const TYPES: Record<string, string> = { ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".png": "image/png" };
declare module "fastify" { interface FastifyRequest { who?: { user: User; session: Session } } }

export async function buildServer(d: ServerDeps): Promise<FastifyInstance> {
  const say = d.log || (() => {}), origin = new URL(d.appUrl).origin;
  const f = Fastify({ logger: false, bodyLimit: 6 * 1024 * 1024, trustProxy: true });
  await f.register(cookie);

  f.addHook("onRequest", async (req, reply) => {
    reply.header("content-security-policy", "default-src 'self'; img-src 'self' data: blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    reply.header("x-content-type-options", "nosniff"); reply.header("referrer-policy", "no-referrer"); reply.header("cache-control", "no-store");
    if (d.secureCookies) reply.header("strict-transport-security", "max-age=31536000; includeSubDomains");
    // Anything that changes something must come from our own pages: a header a plain form or another site cannot set, and our own origin.
    if (req.method !== "GET" && req.method !== "HEAD" && (req.url.startsWith("/api/") || req.url.startsWith("/auth/"))) {
      const o = req.headers.origin;
      if (req.headers["x-tallyhound"] !== "1" || (o && o !== origin)) return reply.code(403).send({ error: "forbidden", message: "This request did not come from Tallyhound." });
    }
  });
  f.setErrorHandler((err: Error & { statusCode?: number }, req, reply) => {
    if (err instanceof SignInError) return reply.code(err.status).send({ error: err.code, message: err.message });
    if (err instanceof FirmError) return reply.code(err.status).send({ error: "refused", message: err.message });
    if (err.statusCode && err.statusCode < 500) return reply.code(err.statusCode).send({ error: "bad_request", message: "That request could not be read." });
    say("error", req.method, req.routeOptions?.url || "", err.message);   // the route and the message, never the body
    return reply.code(500).send({ error: "server", message: "Something went wrong on our side. Nothing was changed. Try again." });
  });

  // A small brake on guessing: sign-in calls per address per minute.
  const hits = new Map<string, { n: number; until: number }>();
  const brake = async (req: FastifyRequest, reply: FastifyReply) => {
    const now = Date.now(), h = hits.get(req.ip); if (hits.size > 5000) hits.clear();
    if (!h || h.until < now) { hits.set(req.ip, { n: 1, until: now + 60000 }); return; }
    if (++h.n > 30) return reply.code(429).send({ error: "slow_down", message: "Too many tries. Wait a minute and try again." });
  };
  const setCookie = (reply: FastifyReply, token: string) => reply.setCookie(COOKIE, token, { httpOnly: true, secure: d.secureCookies, sameSite: "lax", path: "/", maxAge: 12 * 3600 });
  const who = async (req: FastifyRequest) => (req.who = (await d.signIn.whoIs(req.cookies[COOKIE])) || undefined);
  // Half signed in: the link was opened, the code is still owed.
  const half = async (req: FastifyRequest, reply: FastifyReply) => { if (!(await who(req))) return reply.code(401).send({ error: "signin", message: "Open a sign-in link first." }); };
  const full = async (req: FastifyRequest, reply: FastifyReply) => { const w = await who(req); if (!w || w.session.stage !== "full") return reply.code(401).send({ error: "signin", message: "Sign in to continue." }); };
  const body = (req: FastifyRequest) => (req.body && typeof req.body === "object" ? req.body : {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" ? v : "");

  f.get("/healthz", async () => ({ ok: true, ...(d.health ? await d.health() : {}) }));
  if (d.hooks) registerHooks(f, { ...d.hooks, app: d.app, publicUrl: d.appUrl, log: d.log });

  // ---- sign-in ----
  f.post("/auth/link", { preHandler: brake }, async (req) => { await d.signIn.requestLink(str(body(req).email)); return { ok: true }; });
  f.post("/auth/open", { preHandler: brake }, async (req, reply) => { const r = await d.signIn.openLink(str(body(req).token)); setCookie(reply, r.sessionToken); return { next: r.next }; });
  f.post("/auth/setup/start", { preHandler: [brake, half] }, async (req) => { const r = await d.signIn.setupStart(req.who!.user, req.who!.session); return { secret: r.secret, qr: "data:image/svg+xml;base64," + Buffer.from(await QRCode.toString(r.uri, { type: "svg", margin: 1 })).toString("base64") }; });
  f.post("/auth/setup/finish", { preHandler: [brake, half] }, async (req) => d.signIn.setupFinish(req.who!.user, req.who!.session, str(body(req).code)));
  f.post("/auth/code", { preHandler: [brake, half] }, async (req) => { await d.signIn.code(req.who!.user, req.who!.session, str(body(req).code)); return { ok: true }; });
  f.post("/auth/recovery", { preHandler: [brake, half] }, async (req) => d.signIn.recovery(req.who!.user, req.who!.session, str(body(req).code)));
  f.post("/auth/signout", async (req, reply) => { await d.signIn.signOut(req.cookies[COOKIE]); reply.clearCookie(COOKIE, { path: "/" }); return { ok: true }; });

  // ---- the web app ----
  const me = (u: User) => ({ id: u.id, name: u.name, email: u.email, role: u.role, firmId: u.firmId });
  f.get("/api/me", { preHandler: full }, async (req) => me(req.who!.user));
  // The firm's whole workspace, as the engine saves it. File bytes are never in it, only their keys.
  f.get("/api/state", { preHandler: full }, async (req, reply) => {
    const u = req.who!.user, json = await d.readState(u.firmId); if (!json) return reply.code(404).send({ error: "no_firm", message: "This firm's workspace could not be found." });
    const s = JSON.parse(json); s.userId = u.id;
    // A client's link key opens that client's own pages. No screen needs it, so it never leaves the server.
    // The same goes for the copy of the link inside a sent message: staff see that a link was sent, not the link.
    const keys: string[] = []; for (const c of s.state.clients || []) { if (c.key) keys.push(c.key); delete c.key; delete c.keyAt; delete c.code; }
    if (u.role !== "owner") s.state.audit = [];   // the audit trail is the owner's to read (spec section 3)
    let out = JSON.stringify(s); for (const k of keys) out = out.split(k).join("(private link)");
    return reply.type("application/json").send(out);
  });
  // One staff action: { fn, args }. The role is checked here, the rules are the engine's.
  f.post("/api/act", { preHandler: full }, async (req, reply) => {
    const u = req.who!.user, b = body(req), fn = str(b.fn), ok = allowed(u.role, fn);
    if (ok === "unknown") return reply.code(404).send({ error: "unknown_action", message: "Tallyhound does not know that action." });
    if (ok === "forbidden") return reply.code(403).send({ error: "role", message: u.role === "read_only" ? "Your account can look but not change things. Ask an owner to change your role." : "Only an owner can do that." });
    try { return { ok: true, result: await d.app.staff(u.firmId, u.id, (T: Engine) => run(T, fn, b.args as unknown[])) }; }
    catch (err) { say("act_failed", u.firmId, fn, (err as Error).message); return reply.code(400).send({ error: "refused", message: (err as Error).message }); }
  });
  f.get("/api/actions", { preHandler: full }, async () => Object.fromEntries(Object.entries(ACTIONS).map(([k, v]) => [k, v.role])));

  // ---- documents ----
  const MAX_UPLOAD = 25 * 1024 * 1024, SHOWN = ["image/jpeg", "image/png", "image/webp", "application/pdf"];
  f.addContentTypeParser(["application/octet-stream", "application/pdf", "image/jpeg", "image/png", "image/heic", "image/heif", "image/webp", "image/tiff"], { parseAs: "buffer", bodyLimit: MAX_UPLOAD }, (_req, b, done) => done(null, b));
  // T-90: a staff member adds a document they received some other way. It is prepared and checked like any other; the client is not messaged.
  f.post("/api/clients/:id/documents", { preHandler: full, bodyLimit: MAX_UPLOAD }, async (req, reply) => {
    const u = req.who!.user; if (u.role === "read_only") return reply.code(403).send({ error: "role", message: "Your account can look but not change things. Ask an owner to change your role." });
    if (!Buffer.isBuffer(req.body) || !req.body.length) return reply.code(400).send({ error: "no_file", message: "Choose a photo or a PDF to add." });
    const file = await ready({ bytes: req.body, contentType: String(req.headers["content-type"] || "") }, d.prepare || {});
    try { const r = await d.app.staffUpload(u.firmId, u.id, (req.params as { id: string }).id, file);
      if (r.error) return reply.code(400).send({ error: "unusable", message: r.error === "locked" ? "That PDF is password-protected. Add an unlocked copy." : "That file is not a photo or a PDF Tallyhound can read." });
      return { ok: true, docs: r.docs }; }
    catch (err) { return reply.code(400).send({ error: "refused", message: (err as Error).message }); }
  });
  // T-11: a document is shown only to signed-in staff of the firm that holds it. Another firm's id simply does not exist here. Every view is logged by the pipeline.
  f.get("/api/documents/:id/file", { preHandler: full }, async (req, reply) => {
    const u = req.who!.user, file = await d.app.openFile(u.firmId, u.id, (req.params as { id: string }).id);
    if (!file) return reply.code(404).send({ error: "no_file", message: "Tallyhound no longer holds a copy of that document." });
    const shown = SHOWN.includes(file.contentType);
    return reply.header("content-security-policy", "default-src 'none'; sandbox").header("content-disposition", shown ? "inline" : "attachment").type(shown ? file.contentType : "application/octet-stream").send(file.bytes);
  });

  // ---- people at the firm (owner only for changes) ----
  f.get("/api/users", { preHandler: full }, async (req, reply) => req.who!.user.role !== "owner" ? reply.code(403).send({ error: "role", message: "Only an owner can see who has access." }) : (await d.auth.usersOfFirm(req.who!.user.firmId)).map((u) => ({ ...me(u), twoStep: !!u.mfaSecret })));
  f.post("/api/users", { preHandler: full }, async (req) => { const b = body(req), u = req.who!.user; return { id: await d.firms.addUser(u.firmId, u, { email: str(b.email), name: str(b.name), role: str(b.role) as Role }) }; });
  f.post("/api/users/:id/role", { preHandler: full }, async (req) => { const u = req.who!.user; await d.firms.setRole(u.firmId, u, (req.params as { id: string }).id, str(body(req).role) as Role); return { ok: true }; });
  f.delete("/api/users/:id", { preHandler: full }, async (req) => { const u = req.who!.user; await d.firms.removeUser(u.firmId, u, (req.params as { id: string }).id); return { ok: true }; });

  // ---- the staff web app (apps/web, built by `npm run build`) ----
  // Files under /assets carry a fingerprint in their name, so a browser may keep them. Every other address gets the app's one page,
  // which works out what to show and asks /api/me who is signed in. Nothing here is built from data: it is the same file for everyone.
  const assets = join(d.webDir, "assets"), files = new Map<string, { type: string; bytes: Buffer }>(), index = existsSync(join(d.webDir, "index.html")) ? readFileSync(join(d.webDir, "index.html")) : null;
  if (existsSync(assets)) for (const name of readdirSync(assets)) if (TYPES[extname(name)]) files.set(name, { type: TYPES[extname(name)]!, bytes: readFileSync(join(assets, name)) });
  f.get("/assets/:name", async (req, reply) => { const a = files.get((req.params as { name: string }).name); if (!a) return reply.code(404).send("Not found"); return reply.header("cache-control", "public, max-age=31536000, immutable").type(a.type).send(a.bytes); });
  f.setNotFoundHandler(async (req, reply) => {
    if (req.method !== "GET" || /^\/(api|auth|hooks|assets)\//.test(req.url)) return reply.code(404).send({ error: "not_found", message: "There is nothing at that address." });
    if (!index) return reply.code(503).type("text/plain").send("The web app has not been built. Run: npm run build");
    return reply.type("text/html; charset=utf-8").send(index);
  });
  return f;
}
