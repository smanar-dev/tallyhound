// The web service. Sign-in, the firm's state for the web app, and one endpoint per kind of staff action.
// It holds no product rules: every action runs the engine through the pipeline (app.staff), which loads, decides, saves and sends.
import { randomInt } from "node:crypto";
import { PriorError, priorOn, type ReadPrior } from "./prior.ts";
import { DomainError, type Domains } from "./domain.ts";
import { registerSignup, type SignupDeps } from "./signup.ts";
import { kitAuth, kitRegistration } from "./kit.ts";
import { BillingError, type Billing } from "./billing.ts";
import { SLUG, StorageError, type Storage } from "./storage.ts";
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import cookie from "@fastify/cookie";
import QRCode from "qrcode";
import { strToU8, zipSync } from "fflate";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { extname, join } from "node:path";
import { createEngine, type App, type Engine, type Role } from "./kit.ts";
import type { AuthStore, Session, User } from "./authstore.ts";
import { SignInError, type SignIn } from "./signin.ts";
import { FirmError, type Firms } from "./firms.ts";
import { ACTIONS, allowed, run } from "./actions.ts";
import { registerHooks, type HookDeps } from "./hooks.ts";
import { pdfCount, pdfCut, pdfPage, ready } from "./files.ts";
import { registerPublic, type PublicDeps } from "./public.ts";
import type { PrepareOpts } from "./kit.ts";
import { planFor } from "./plan.ts";

export interface ServerDeps {
  app: App; auth: AuthStore; signIn: SignIn; firms: Firms;
  readState(firmId: string): Promise<string | null>;
  getFile(firmId: string, key: string): Promise<{ bytes: Buffer; contentType: string } | null>;
  appUrl: string; secureCookies: boolean; webDir: string; prepare?: PrepareOpts;
  systemSms?: import("./notify.ts").SystemSms;   // TH-BRK-10: without it nobody can add a mobile for text barks
  /** The client's own pages. Present whenever there is a queue to put uploads on. */
  clientPages?: Omit<PublicDeps, "app" | "auth" | "log">;
  /** Gives one firm its turn on the timer now, after a staff action that may have made something due. */
  nudge?: (firmId: string) => void;
  /** Reads a prior-year return and proposes a checklist (T-46). Absent when no model is connected. */
  prior?: ReadPrior;
  /** Whether recorded reminder calls can be placed at all (T-50). */
  voice?: boolean;
  /** Sending from a firm's own domain. Absent until the mail service's account token is set. */
  domains?: Domains;
  /** The public sign-up and price pages. */
  signup?: Omit<SignupDeps, "auth" | "firms" | "app" | "appUrl" | "log" | "requestSignInLink">;
  /** Card billing. Absent until Stripe is set up: plans are then started with the admin command and invoiced by hand. */
  billing?: Billing;
  /** A firm's own storage. Absent when no Google sign-in has been set up for this service. */
  storage?: Storage;
  /** Ask the Hound. Absent when no model is connected. */
  ask?: (firmId: string, who: { name: string; role: string }, turns: { role: "user" | "assistant"; text: string }[]) => Promise<string>;
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

  // 503 when the service says it is not well (the timer has stopped), so an uptime check pages someone.
  f.get("/healthz", async (_req, reply) => { const h = d.health ? await d.health() : {}, ok = h.ok !== false; return reply.code(ok ? 200 : 503).send({ ...h, ok }); });
  if (d.hooks) registerHooks(f, { ...d.hooks, app: d.app, publicUrl: d.appUrl, log: d.log, systemNumber: d.systemSms ? d.systemSms.number : undefined, staffStop: async (mobile) => { const u = await d.auth.userByMobile(mobile); if (!u) return false; await d.auth.clearMobile(u.id); await d.auth.audit(u.firmId, u.id, "mobile.stopped"); return true; } });
  if (d.signup) registerSignup(f, { ...d.signup, auth: d.auth, firms: d.firms, app: d.app, appUrl: d.appUrl, log: d.log, requestSignInLink: (email) => d.signIn.requestLink(email) });
  if (d.clientPages) await registerPublic(f, { ...d.clientPages, app: d.app, auth: d.auth, log: d.log });

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
  f.get("/api/me", { preHandler: full }, async (req) => { const u = req.who!.user; return { ...me(u), notes: { morning: !u.morningOff, urgent: !u.urgentOff }, mobile: u.mobile ? { ends: u.mobile.slice(-4), verified: !!u.mobileVerifiedAt } : null }; });
  // TH-BRK-10: a person adds their own mobile for text barks. A six-digit code goes to it from Tallyhound's number; nothing else is
  // ever texted to it until the code comes back. Only a hash of the code is kept, for ten minutes.
  f.post("/api/me/mobile", { preHandler: full }, async (req, reply) => {
    const u = req.who!.user, m = str(body(req).mobile).replace(/\D/g, "").replace(/^1(\d{10})$/, "$1"); if (!d.systemSms) return reply.code(503).send({ error: "not_connected", message: "Text alerts are not switched on for Tallyhound yet." });
    if (u.role === "read_only") return reply.code(403).send({ error: "role", message: NO.read_only }); if (!/^[2-9]\d{9}$/.test(m)) return reply.code(400).send({ error: "mobile", message: "Enter a ten-digit US mobile number." });
    const code = String(randomInt(0, 1000000)).padStart(6, "0"); await d.auth.setMobilePending(u.id, m, kitAuth.hashToken(u.id + ":" + code), new Date(Date.now() + 10 * 60000));
    try { await d.systemSms.send("+1" + m, "Tallyhound: your code is " + code + ". It lets Tallyhound text you when your review queue needs you. Reply STOP to end."); } catch { await d.auth.clearMobile(u.id); return reply.code(502).send({ error: "send_failed", message: "That number could not be texted. Check it and try again." }); }
    await d.auth.audit(u.firmId, u.id, "mobile.code_sent"); return { ok: true, ends: m.slice(-4) };
  });
  f.post("/api/me/mobile/verify", { preHandler: full }, async (req, reply) => { const u = req.who!.user, code = str(body(req).code).replace(/\D/g, ""); if (!(await d.auth.verifyMobile(u.id, kitAuth.hashToken(u.id + ":" + code), new Date()))) return reply.code(400).send({ error: "code", message: "That code is not right, or it has run out. Send a new one." }); await d.auth.audit(u.firmId, u.id, "mobile.verified"); return { ok: true }; });
  f.delete("/api/me/mobile", { preHandler: full }, async (req) => { const u = req.who!.user; await d.auth.clearMobile(u.id); await d.auth.audit(u.firmId, u.id, "mobile.removed"); return { ok: true }; });
  // Which emails Tallyhound sends this person. Their own choice, for themselves only.
  f.post("/api/me/notes", { preHandler: full }, async (req) => { const u = req.who!.user, b = body(req), next = { morningOff: typeof b.morning === "boolean" ? !b.morning : u.morningOff, urgentOff: typeof b.urgent === "boolean" ? !b.urgent : u.urgentOff }; await d.auth.setNotes(u.id, next); await d.auth.audit(u.firmId, u.id, "me.notes", (next.morningOff ? "no" : "") + "morning " + (next.urgentOff ? "no" : "") + "urgent"); return { notes: { morning: !next.morningOff, urgent: !next.urgentOff } }; });
  // The firm's whole workspace, as the engine saves it. File bytes are never in it, only their keys.
  const looked = new Map<string, number>();
  f.get("/api/state", { preHandler: full }, async (req, reply) => {
    const u = req.who!.user, json = await d.readState(u.firmId); if (!json) return reply.code(404).send({ error: "no_firm", message: "This firm's workspace could not be found." });
    const s = JSON.parse(json); s.userId = u.id;
    // T-107: the firm's history shows when support looked. One line per quarter hour, not one per page.
    if (u.supportUntil) { const t = Date.now(), last = looked.get(u.id) || 0; if (t - last > 15 * 60000) { looked.set(u.id, t); await d.app.withFirm(u.firmId, (T: Engine) => { T.audit("support.view", u.name + " looked at the firm's pages", u.name); }); await d.auth.audit(u.firmId, u.id, "support.view"); } }
    // A client's link key opens that client's own pages. No screen needs it, so it never leaves the server.
    // The same goes for the copy of the link inside a sent message: staff see that a link was sent, not the link.
    const keys: string[] = []; for (const c of s.state.clients || []) { if (c.key) keys.push(c.key); delete c.key; delete c.keyAt; delete c.code; }
    if (u.role !== "owner") s.state.audit = [];   // the audit trail is the owner's to read (spec section 3)
    let out = JSON.stringify(s); for (const k of keys) out = out.split(k).join("(private link)");
    return reply.type("application/json").send(out);
  });
  // One staff action: { fn, args }, or several in one turn: { calls: [{ fn, args }] }. The role is checked here, for every call, before any runs.
  // The rules are the engine's. Several calls load and save the firm once, so "assign a checklist to 500 clients" is one request.
  const WHILE_OFF = ["resumeNow", "saveFirm", "setRetain", "setCloseRetention", "deleteDocsNow", "purge", "alertRead", "alertsRead", "setHound", "stopAll", "resumeAll"];
  const NO: Record<string, string> = { read_only: "Your account can look but not change things. Ask an owner to change your role.", other: "Only an owner can do that." };
  f.post("/api/act", { preHandler: full }, async (req, reply) => {
    const u = req.who!.user, b = body(req), many = Array.isArray(b.calls), calls = (many ? (b.calls as unknown[]) : [b]).map((c) => (c && typeof c === "object" ? c : {}) as { fn?: unknown; args?: unknown });
    if (!calls.length || calls.length > 5000) return reply.code(400).send({ error: "bad_request", message: "That request could not be read." });
    for (const c of calls) {
      const ok = allowed(u.role, str(c.fn));
      if (ok === "unknown") return reply.code(404).send({ error: "unknown_action", message: "Tallyhound does not know that action." });
      if (ok === "forbidden") return reply.code(403).send({ error: "role", message: u.role === "read_only" ? NO.read_only : NO.other });
    }
    // T-147: a request that carries a key runs once. The key is claimed before anything changes, so a retry after a lost answer gets
    // the first answer back, and a retry that arrives while the first is still running is told to wait. Never run twice.
    const key = str(req.headers["idempotency-key"]).slice(0, 80), keyed = /^[A-Za-z0-9_-]{16,80}$/.test(key);
    if (keyed) { const c = await d.auth.claimKey(u.firmId, u.id + ":" + key, new Date()); if (!c.fresh) { const was = c.response as { s: number; b: unknown } | null; return was ? reply.code(was.s).header("idempotent-replay", "true").send(was.b) : reply.code(409).send({ error: "in_progress", message: "That is already being done. Give it a moment, then look again before trying once more." }); } }
    const done = async <R,>(answer: R, status = 200) => { if (keyed) await d.auth.finishKey(u.firmId, u.id + ":" + key, { s: status, b: answer }); return answer; };
    try { const results = await d.app.staff(u.firmId, u.id, (T: Engine) => {
        // T-83: while a firm is paused or its trial has ended, staff can read, change settings and delete, and nothing else.
        const a = T.access(); if (!a.ok && a.state !== "checking") for (const c of calls) if (!WHILE_OFF.includes(str(c.fn))) throw new Error(a.reason);
        return calls.map((c) => run(T, str(c.fn), c.args as unknown[])); }); if (d.nudge) d.nudge(u.firmId); return await done(many ? { ok: true, results } : { ok: true, result: results[0] }); }
    catch (err) { say("act_failed", u.firmId, calls.length === 1 ? str(calls[0]!.fn) : "batch", (err as Error).message); return reply.code(400).send(await done({ error: "refused", message: (err as Error).message }, 400)); }
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

  // TH-PLN-3: one client's follow-up plan. Read only: it is worked out from the saved state by running the engine's own scheduler ahead
  // on a copy, and nothing is saved or sent. The staff app works out the same plan in the browser from the state it already holds.
  f.get("/api/clients/:id/plan", { preHandler: full }, async (req, reply) => {
    const u = req.who!.user, eid = (req.params as { id: string }).id, json = await d.readState(u.firmId), T0 = createEngine(); if (!json) return reply.code(404).send({ error: "no_firm", message: "This firm's workspace could not be found." }); T0.load(json);
    if (!T0.eng(eid)) return reply.code(404).send({ error: "no_client", message: "That client is not on your list." });
    return planFor(T0, eid, createEngine);
  });
  // T-46: a prior-year return in, a proposed checklist out. The file is read in memory and never kept; only the page count is recorded.
  f.post("/api/clients/:id/prior", { preHandler: full, bodyLimit: MAX_UPLOAD }, async (req, reply) => {
    const u = req.who!.user, eid = (req.params as { id: string }).id; if (u.role === "read_only") return reply.code(403).send({ error: "role", message: NO.read_only });
    if (!d.prior) return reply.code(503).send({ error: "not_connected", message: "Reading a return needs Claude, which is not connected yet." });
    const json = await d.readState(u.firmId), T0 = createEngine(); if (!json) return reply.code(404).send({ error: "no_firm", message: "This firm's workspace could not be found." }); T0.load(json);
    if (!priorOn(T0)) return reply.code(403).send({ error: "off", message: "An owner has not switched on building a checklist from last year's return." });
    if (!T0.eng(eid)) return reply.code(404).send({ error: "no_client", message: "That client is not on your list." });
    if (!Buffer.isBuffer(req.body) || !req.body.length) return reply.code(400).send({ error: "bad_request", message: "Choose last year's return as a PDF." });
    try { const p = await d.prior(u.firmId, req.body); await d.app.staff(u.firmId, u.id, (T: Engine) => { T.meter("docRead", p.pages); T.audit("prior.read", "Read " + p.pages + (p.total > p.pages ? " of " + p.total : "") + " pages of a prior-year return. The file was not kept"); }); return reply.header("cache-control", "no-store").send(p); }
    catch (err) { if (err instanceof PriorError) return reply.code(err.status).send({ error: "prior", message: err.message + "." }); say("prior_failed", u.firmId, (err as { code?: string }).code || "error"); return reply.code(502).send({ error: "prior", message: "The return could not be read just now. Try again in a moment." }); }
  });

  // A PDF is shown to staff as pictures of its pages, drawn here, so nothing in the file itself ever runs in their browser.
  f.get("/api/documents/:id/pages", { preHandler: full }, async (req, reply) => {
    const u = req.who!.user, file = await d.app.openFile(u.firmId, u.id, (req.params as { id: string }).id);
    if (!file) return reply.code(404).send({ error: "no_file", message: "Tallyhound no longer holds a copy of that document." });
    return { count: file.contentType === "application/pdf" ? await pdfCount(file.bytes) : 0 };
  });
  f.get("/api/documents/:id/page/:n", { preHandler: full }, async (req, reply) => {
    const u = req.who!.user, p = req.params as { id: string; n: string }, file = await d.app.openFile(u.firmId, u.id, p.id);
    const img = file && file.contentType === "application/pdf" ? await pdfPage(file.bytes, +p.n) : null;
    if (!img) return reply.code(404).send({ error: "no_page", message: "That page cannot be shown." });
    return reply.header("content-security-policy", "default-src 'none'; sandbox").header("cache-control", "private, no-store").type("image/jpeg").send(img);
  });

  // Hand off one client's finished files as a zip, for a firm with no storage connected. Building the zip IS the hand-off: the
  // documents are marked as handed off (which starts the keep-for clock) and the audit trail says who took them. A POST from our
  // own page, never a link, so another site cannot set that clock running.
  f.post("/api/clients/:id/files.zip", { preHandler: full }, async (req, reply) => {
    const u = req.who!.user, eid = (req.params as { id: string }).id; if (u.role === "read_only") return reply.code(403).send({ error: "role", message: NO.read_only });
    const json = await d.readState(u.firmId), T0 = createEngine(); if (!json) return reply.code(404).send({ error: "no_firm", message: "This firm's workspace could not be found." }); T0.load(json);
    if (!T0.eng(eid)) return reply.code(404).send({ error: "no_client", message: "That client is not on your list." });
    // The bytes are read first, while Tallyhound certainly still holds them; then the hand-off is recorded.
    const held: Record<string, Buffer> = {}; for (const x of T0.S.docs.filter((x: { engId: string; state: string; fileKey?: string }) => x.engId === eid && x.state === "accepted" && x.fileKey && T0.hasContent(x)) as { id: string; fileKey: string; pagesOf?: number[] }[]) { const got = await d.getFile(u.firmId, x.fileKey); if (!got) continue; held[x.id] = got.bytes;
      // One form out of a file that held several goes into the zip as a PDF of its own pages (TH-DOC-19).
      if (Array.isArray(x.pagesOf) && x.pagesOf.length && got.contentType === "application/pdf") { const part = await pdfCut(got.bytes, x.pagesOf, T0.S.docs.filter((o: { id: string; fileKey?: string; pagesOf?: number[] }) => o.id !== x.id && o.fileKey === x.fileKey && o.pagesOf && o.pagesOf.length).map((o: { pagesOf: number[] }) => o.pagesOf)); if (part) held[x.id] = part; } }
    const r = await d.app.staff(u.firmId, u.id, (T: Engine) => { const docs = T.S.docs.filter((x: { engId: string; state: string }) => x.engId === eid && x.state === "accepted" && T.hasContent(x)), out = T.deliver(eid); return { ids: docs.map((x: { id: string }) => x.id), files: out.files as string[], manifest: out.manifest as string, missing: out.missing as string[], folder: out.folder as string }; });
    const entries: Record<string, Uint8Array> = {}, lines: string[] = [];
    r.ids.forEach((id: string, i: number) => { const b = held[id]; if (!b) return; const ext = b[0] === 0xff && b[1] === 0xd8 ? ".jpg" : b.subarray(0, 4).toString("latin1") === "\x89PNG" ? ".png" : ".pdf", name = r.files[i]!.replace(/\.pdf$/i, "").replace(/[\\/:*?"<>|]/g, " ").trim() + ext; entries[name] = new Uint8Array(b); lines.push(name); });
    entries["What is in this folder.txt"] = strToU8("Handed off from Tallyhound\n" + r.folder + "\n\nFiles\n" + (lines.length ? lines.map((x) => "  " + x).join("\n") : "  None yet") + "\n\nStill missing\n" + (r.missing.length ? r.missing.map((x) => "  " + x).join("\n") : "  Nothing: every document is in or waived") + "\n");
    entries["manifest.csv"] = strToU8(r.manifest + "\n");
    const zip = Buffer.from(zipSync(entries, { level: 0 })), safe = r.folder.split("/").slice(-2).reverse().join(" ").replace(/[^A-Za-z0-9 ,._-]/g, "").trim() || "files";
    return reply.header("content-disposition", 'attachment; filename="' + safe + '.zip"').header("x-tallyhound-files", String(lines.length)).header("x-tallyhound-missing", String(r.missing.length)).type("application/zip").send(zip);
  });

  // The one thing the sign-in page needs to know before anyone has signed in: whether a firm can sign itself up.
  f.get("/api/site", async () => ({ signup: !!(d.signup && d.signup.open) }));
  // What this installation has connected, so the screens show only what works (T-45): no tab, switch or button for a service that is not set up.
  f.get("/api/features", { preHandler: full }, async () => ({ ask: !!d.ask, prior: !!d.prior, signup: !!(d.signup && d.signup.open), billing: !!d.billing, domain: !!d.domains, voice: !!d.voice, textBarks: !!d.systemSms, storage: d.storage ? d.storage.offered() : [] }));
  // The note a firm sends its own clients before Tallyhound's first message, worded for this firm. Read only.
  f.get("/api/headsup", { preHandler: full }, async (req, reply) => {
    const json = await d.readState(req.who!.user.firmId); if (!json) return reply.code(404).send({ error: "no_firm", message: "This firm's workspace could not be found." });
    const T = createEngine(); T.load(json); const fm = T.S.firm, n = String(fm.smsNumber || "");
    return kitRegistration.headsUp({ name: fm.name }, { number: fm.senderStatus === "approved" && n.length === 10 ? "(" + n.slice(0, 3) + ") " + n.slice(3, 6) + "-" + n.slice(6) : undefined, address: fm.email || undefined });
  });

  // ---- sending from the firm's own domain (owner only, T-110) ----
  const dom = async (req: FastifyRequest, reply: FastifyReply, go: (u: User) => Promise<unknown>) => { const u = req.who!.user; if (u.role !== "owner") return reply.code(403).send({ error: "role", message: NO.other }); if (!d.domains) return reply.code(503).send({ error: "not_connected", message: "Sending from your own domain is not switched on yet." }); try { return { domain: await go(u) }; } catch (err) { if (err instanceof DomainError) return reply.code(err.status).send({ error: "domain", message: err.message + "." }); throw err; } };
  f.get("/api/domain", { preHandler: full }, async (req, reply) => (d.domains ? dom(req, reply, (u) => d.domains!.status(u.firmId)) : { available: false, domain: null }));
  f.post("/api/domain", { preHandler: full }, async (req, reply) => dom(req, reply, (u) => d.domains!.start(u.firmId, u.id, { name: str(body(req).name), local: str(body(req).local) })));
  f.post("/api/domain/check", { preHandler: full }, async (req, reply) => dom(req, reply, (u) => d.domains!.check(u.firmId, u.id)));
  f.delete("/api/domain", { preHandler: full }, async (req, reply) => dom(req, reply, async (u) => { await d.domains!.remove(u.firmId, u.id); return null; }));

  // ---- card billing (owner only). Paying and managing cards happen on Stripe's own pages; these hand the browser their address. ----
  f.get("/api/billing", { preHandler: full }, async (req) => (d.billing ? d.billing.status(req.who!.user.firmId) : { available: false, plans: [], paying: false, pastDue: false, graceEnds: null }));
  const billed = async (reply: FastifyReply, firmId: string, go: () => Promise<string>) => { try { return { url: await go() }; } catch (err) { if (err instanceof BillingError) return reply.code(err.status).send({ error: "billing", message: err.message }); say("billing_failed", firmId, (err as Error).message); return reply.code(502).send({ error: "billing", message: "The payment service could not be reached. Try again in a moment." }); } };
  f.post("/api/billing/checkout", { preHandler: full }, async (req, reply) => { const u = req.who!.user; if (u.role !== "owner") return reply.code(403).send({ error: "role", message: NO.other }); if (!d.billing) return reply.code(503).send({ error: "not_connected", message: "Paying by card is not switched on yet. Write to Tallyhound to start a plan." }); return billed(reply, u.firmId, () => d.billing!.checkout(u.firmId, { id: u.id, email: u.email }, str(body(req).plan))); });
  f.post("/api/billing/portal", { preHandler: full }, async (req, reply) => { const u = req.who!.user; if (u.role !== "owner") return reply.code(403).send({ error: "role", message: NO.other }); if (!d.billing) return reply.code(503).send({ error: "not_connected", message: "Paying by card is not switched on yet." }); return billed(reply, u.firmId, () => d.billing!.portal(u.firmId)); });
  // Stripe's webhook. Its own small scope, because the signature is over the exact bytes sent and so the body must not be parsed first.
  if (d.billing) void f.register(async (s) => { s.addContentTypeParser("application/json", { parseAs: "buffer", bodyLimit: 1024 * 1024 }, (_req, b, done) => done(null, b)); s.post("/hooks/stripe", async (req, reply) => { const r = await d.billing!.webhook(Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0), String(req.headers["stripe-signature"] || "")); return reply.code(r.status).send({ received: r.ok }); }); });

  // ---- the firm's own storage (owner only). Connecting is a visit to Google and back; nothing else can mark a drive as connected. ----
  const ownerOnly = (req: FastifyRequest, reply: FastifyReply) => (req.who!.user.role === "owner" ? null : reply.code(403).send({ error: "role", message: NO.other }));
  const useStorage = async (firmId: string, userId: string, name: string | null) => d.app.staff(firmId, userId, (T: Engine) => { const dl = T.S.firm.delivery; dl.provider = name || "Download"; dl.auto = name ? "on" : "off"; if (name && !dl.when) dl.when = "arrival"; T.audit("settings.delivery", name ? name + " connected" : "Storage disconnected. Finished files are handed off as a zip"); });
  f.get("/api/storage", { preHandler: full }, async (req) => { const st = d.storage ? await d.storage.status(req.who!.user.firmId) : { connected: false, provider: null, since: null, site: null }, offered = d.storage ? d.storage.offered() : []; return { available: offered.length > 0, offered, ...st }; });
  f.get("/api/storage/:service/start", { preHandler: full }, async (req, reply) => {
    if (ownerOnly(req, reply)) return reply; const name = SLUG[(req.params as { service: string }).service]; if (!d.storage || !name || !d.storage.offered().includes(name)) return reply.redirect("/settings?tab=files&problem=unavailable", 303);
    const u = req.who!.user; try { return reply.header("cache-control", "no-store").redirect(d.storage.startUrl(u.firmId, u.id, name, str((req.query as { site?: string }).site).slice(0, 300)), 303); } catch { return reply.redirect("/settings?tab=files&problem=unavailable", 303); }
  });
  f.get("/api/storage/:service/callback", { preHandler: full }, async (req, reply) => {
    if (ownerOnly(req, reply)) return reply; const u = req.who!.user, q = req.query as { code?: string; state?: string; error?: string }, name = SLUG[(req.params as { service: string }).service];
    if (!d.storage || !name) return reply.redirect("/settings?tab=files&problem=unavailable", 303);
    try { await d.storage.finish(u.firmId, u.id, q, name); await useStorage(u.firmId, u.id, name); await d.auth.audit(u.firmId, u.id, "storage.connected", name); return reply.header("cache-control", "no-store").redirect("/settings?tab=files&connected=1", 303); }
    catch (err) { const code = err instanceof StorageError ? err.code : "error"; say("storage_connect_failed", u.firmId, code); return reply.header("cache-control", "no-store").redirect("/settings?tab=files&problem=" + encodeURIComponent(code), 303); }
  });
  f.post("/api/storage/disconnect", { preHandler: full }, async (req, reply) => {
    if (ownerOnly(req, reply)) return reply; const u = req.who!.user; if (d.storage) await d.storage.disconnect(u.firmId);
    await useStorage(u.firmId, u.id, null); await d.auth.audit(u.firmId, u.id, "storage.disconnected"); return { ok: true };
  });

  // Ask the Hound: a question about the firm's own collecting, answered from a read-only copy of its state. Anyone signed in may ask.
  const asked = new Map<string, { n: number; until: number }>();
  f.post("/api/hound/ask", { preHandler: full }, async (req, reply) => {
    const u = req.who!.user, b = body(req); if (!d.ask) return reply.code(503).send({ error: "not_connected", message: "The Hound can answer questions once Claude is connected for your firm." });
    const now = Date.now(), h = asked.get(u.id); if (asked.size > 5000) asked.clear();
    if (!h || h.until < now) asked.set(u.id, { n: 1, until: now + 60000 }); else if (++h.n > 10) return reply.code(429).send({ error: "slow_down", message: "That is a lot of questions. Give it a minute." });
    const turns = (Array.isArray(b.messages) ? b.messages : []).slice(-40).map((m: unknown) => { const x = (m && typeof m === "object" ? m : {}) as { role?: unknown; text?: unknown }; return { role: x.role === "assistant" ? "assistant" as const : "user" as const, text: str(x.text) }; });
    if (!turns.length || !turns.at(-1)!.text.trim() || turns.at(-1)!.role !== "user") return reply.code(400).send({ error: "bad_request", message: "Ask a question first." });
    try { const text = await d.ask(u.firmId, { name: u.name, role: u.role }, turns); await d.auth.audit(u.firmId, u.id, "hound.asked"); return { text }; }
    catch (err) { const code = (err as { code?: string }).code || "error"; say("ask_failed", u.firmId, code); return reply.code(code === "cap" ? 429 : 502).send({ error: "ask_failed", message: code === "cap" ? "The Hound has answered as much as it can today. It will be back tomorrow." : code === "busy" ? "Claude is busy. Try again in a moment." : "The Hound could not answer that just now. Try again." }); }
  });

  // Records an owner can take away (TH-CON-10): proof of consent for every client, with the wording each one saw, and the audit
  // trail. A spreadsheet opened in Excel must never run a formula from a name or a note, so risky first characters are defused.
  f.post("/api/export/:what", { preHandler: full }, async (req, reply) => {
    const u = req.who!.user, what = (req.params as { what: string }).what; if (u.role !== "owner") return reply.code(403).send({ error: "role", message: NO.other });
    if (what !== "consent" && what !== "audit") return reply.code(404).send({ error: "unknown_export", message: "Tallyhound does not have that export." });
    const cell = (v: unknown) => { let t = v == null ? "" : v instanceof Date ? v.toISOString() : String(v); if (/^[=+\-@\t\r]/.test(t)) t = "'" + t; return /[",\n\r]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t; };
    // The audit trail is kept as rows of its own (T-101), so it is read from the store, every line of it, not from the engine.
    const saved = what === "audit" ? await d.readState(u.firmId) : null, trail: { at: { $d?: string } | string; actor: string; action: string; detail?: string }[] = saved ? JSON.parse(saved).state.audit || [] : [];
    const rows = await d.app.staff(u.firmId, u.id, (T: Engine) => {
      const out: unknown[][] = [];
      if (what === "consent") {
        out.push(["Client", "Reference", "Email", "Mobile", "Texts now", "Email now", "When", "Channel", "What happened", "Number agreed for", "Wording version", "Wording the client saw", "IP address", "Browser"]);
        for (const c of T.S.clients) { const L = c.consentLog || [], now = [c.first + " " + c.last, c.ref || "", c.email || "", c.mobile || "", c.textConsent || "none", c.emailOff ? "unsubscribed" : c.emailOk === false ? "not deliverable" : "on"];
          if (!L.length) out.push([...now, "", "", "No record"]);
          // The wording is given only where the record itself holds it: what this client was shown on their page, word for word.
          for (const l of L) out.push([...now, new Date(l.at), l.channel || "", l.what, l.mobile || "", l.wording || "", l.shown || "", l.ip || "", l.agent || ""]); }
        T.audit("export.consent", T.S.clients.length + " clients");
      } else {
        out.push(["When", "Who", "Action", "Detail"]); for (const a of trail) out.push([new Date(typeof a.at === "string" ? a.at : a.at.$d || 0), a.actor, a.action, a.detail || ""]);
        T.audit("export.audit", (out.length - 1) + " lines");
      }
      return out;
    });
    await d.auth.audit(u.firmId, u.id, "export." + what);
    return reply.header("content-disposition", 'attachment; filename="tallyhound-' + what + "-" + new Date().toISOString().slice(0, 10) + '.csv"').header("cache-control", "no-store").type("text/csv; charset=utf-8").send("\ufeff" + rows.map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n");
  });

  // ---- people at the firm (owner only for changes) ----
  f.get("/api/users", { preHandler: full }, async (req, reply) => req.who!.user.role !== "owner" ? reply.code(403).send({ error: "role", message: "Only an owner can see who has access." }) : (await d.auth.usersOfFirm(req.who!.user.firmId)).map((u) => ({ ...me(u), twoStep: !!u.mfaSecret, left: !!u.leftAt, supportUntil: u.supportUntil && !u.leftAt ? u.supportUntil.toISOString() : null })));
  f.post("/api/support", { preHandler: full }, async (req) => { const b = body(req), u = req.who!.user, r = await d.firms.addSupport(u.firmId, u, { email: str(b.email), name: str(b.name), hours: Number(b.hours) }); return { id: r.id, until: r.until.toISOString() }; });
  f.post("/api/users", { preHandler: full }, async (req) => { const b = body(req), u = req.who!.user; return { id: await d.firms.addUser(u.firmId, u, { email: str(b.email), name: str(b.name), role: str(b.role) as Role }) }; });
  f.post("/api/users/:id/role", { preHandler: full }, async (req) => { const u = req.who!.user; await d.firms.setRole(u.firmId, u, (req.params as { id: string }).id, str(body(req).role) as Role); return { ok: true }; });
  f.delete("/api/users/:id", { preHandler: full }, async (req) => { const u = req.who!.user; return { ok: true, ...(await d.firms.removeUser(u.firmId, u, (req.params as { id: string }).id)) }; });

  // ---- the staff web app (apps/web, built by `npm run build`) ----
  // Files under /assets carry a fingerprint in their name, so a browser may keep them. Every other address gets the app's one page,
  // which works out what to show and asks /api/me who is signed in. Nothing here is built from data: it is the same file for everyone.
  const assets = join(d.webDir, "assets"), files = new Map<string, { type: string; bytes: Buffer }>(), index = existsSync(join(d.webDir, "index.html")) ? readFileSync(join(d.webDir, "index.html")) : null;
  if (existsSync(assets)) for (const name of readdirSync(assets)) if (TYPES[extname(name)]) files.set(name, { type: TYPES[extname(name)]!, bytes: readFileSync(join(assets, name)) });
  f.get("/assets/:name", async (req, reply) => { const a = files.get((req.params as { name: string }).name); if (!a) return reply.code(404).send("Not found"); return reply.header("cache-control", "public, max-age=31536000, immutable").type(a.type).send(a.bytes); });
  f.setNotFoundHandler(async (req, reply) => {
    if (req.method !== "GET" || /^\/(api|auth|hooks|assets|c|u|e|f)\//.test(req.url)) return reply.code(404).send({ error: "not_found", message: "There is nothing at that address." });
    if (!index) return reply.code(503).type("text/plain").send("The web app has not been built. Run: npm run build");
    return reply.type("text/html; charset=utf-8").send(index);
  });
  return f;
}
