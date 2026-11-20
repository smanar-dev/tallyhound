// A firm signs itself up (T-76, T-79), and a very large firm asks for a price (T-98). Public pages, plain forms, no script.
//   /signup          five fields. Nothing is created yet: a confirmation link is emailed.
//   /signup/confirm  the link opens a page with one button. Pressing it creates the firm on a 14-day trial and emails the
//                    owner their sign-in link. (A button, because mail scanners open links, and a scanner must not start a trial.)
//   /quote           a client count in, a monthly price out, by the engine's own rule.
// A firm made this way is unchecked like any other (T-116): it can set up, and sends nothing until a person at Tallyhound has
// confirmed it is a real firm. Text number registration is not started by itself: it needs the firm's legal details, which the
// owner enters under Settings, Text number.
import { createHash, randomBytes } from "node:crypto";
import { createElement as h, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { createEngine, type App, type Engine } from "./kit.ts";
import type { AuthStore } from "./authstore.ts";
import type { Firms } from "./firms.ts";

export const SIGNUP_MINUTES = 60, PER_ADDRESS_AN_HOUR = 5, PER_EMAIL_AN_HOUR = 3;
export const ZONES: [string, string][] = [["America/New_York", "Eastern"], ["America/Chicago", "Central"], ["America/Denver", "Mountain"], ["America/Phoenix", "Arizona"], ["America/Los_Angeles", "Pacific"], ["America/Anchorage", "Alaska"], ["Pacific/Honolulu", "Hawaii"]];
export interface SignupRow { tokenHash: string; email: string; payload: { firm: string; name: string; email: string; iana: string; clients: number }; createdAt: Date; expiresAt: Date }
export interface SignupStore { put(r: SignupRow): Promise<void>; /** Takes the request out, once. */ take(tokenHash: string, now: Date): Promise<SignupRow | null>; peek(tokenHash: string, now: Date): Promise<SignupRow | null>; countSince(email: string, since: Date): Promise<number>; sweep(now: Date): Promise<void> }
export function memorySignupStore(): SignupStore { const m = new Map<string, SignupRow>(); return {
  async put(r) { m.set(r.tokenHash, { ...r }); }, async peek(k, now) { const r = m.get(k); return r && r.expiresAt > now ? r : null; }, async take(k, now) { const r = m.get(k); m.delete(k); return r && r.expiresAt > now ? r : null; },
  async countSince(email, since) { return [...m.values()].filter((r) => r.email === email && r.createdAt >= since).length; }, async sweep(now) { for (const [k, r] of m) if (r.expiresAt <= now) m.delete(k); } }; }
interface Db { query(sql: string, args?: unknown[]): Promise<{ rows: Record<string, unknown>[] }> }
export function postgresSignupStore(pool: Db): SignupStore {
  const row = (r: Record<string, unknown> | undefined): SignupRow | null => (r ? { tokenHash: r.token_hash as string, email: r.email as string, payload: r.payload as SignupRow["payload"], createdAt: r.created_at as Date, expiresAt: r.expires_at as Date } : null);
  return {
    async put(r) { await pool.query("insert into signup_requests (token_hash, email, payload, created_at, expires_at) values ($1, $2, $3, $4, $5)", [r.tokenHash, r.email, JSON.stringify(r.payload), r.createdAt, r.expiresAt]); },
    async peek(k, now) { return row((await pool.query("select * from signup_requests where token_hash = $1 and expires_at > $2", [k, now])).rows[0]); },
    async take(k, now) { return row((await pool.query("delete from signup_requests where token_hash = $1 and expires_at > $2 returning *", [k, now])).rows[0]); },
    async countSince(email, since) { return Number((await pool.query("select count(*)::int as n from signup_requests where email = $1 and created_at >= $2", [email, since])).rows[0]!.n); },
    async sweep(now) { await pool.query("delete from signup_requests where expires_at <= $1", [now]); }
  };
}

export interface SignupDeps { store: SignupStore; auth: AuthStore; firms: Firms; app: App; inboxTaken(address: string): Promise<boolean>; requestSignInLink(email: string): Promise<void>; mail(to: string, subject: string, body: string): Promise<void>; /** Tells Tallyhound a firm is waiting for its check, or a large firm wants a price. */ tell?: (subject: string, body: string) => Promise<void>; appUrl: string; inboxDomain: string; clock: () => Date; priceBook?: "A" | "B"; open: boolean; log?: (event: string, ...ids: unknown[]) => void }

const page = (title: string, body: ReactNode): string => "<!doctype html>" + renderToStaticMarkup(h("html", { lang: "en" },
  h("head", null, h("meta", { charSet: "utf-8" }), h("meta", { name: "viewport", content: "width=device-width, initial-scale=1" }), h("title", null, title + " · Tallyhound"), h("link", { rel: "stylesheet", href: "/client.css" })),
  h("body", null, h("main", null, h("p", { className: "firm" }, "Tallyhound"), body, h("footer", null, "Tallyhound collects tax documents for accounting firms by text and email.")))));
const field = (id: string, label: string, props: Record<string, unknown>) => h("div", { className: "field", key: id }, h("label", { htmlFor: id }, label), h("input", { id, name: id, ...props }));
const clean = (v: unknown, max: number) => String(v ?? "").replace(/[<>\u0000-\u001f]/g, "").replace(/\s+/g, " ").trim().slice(0, max);   // eslint-disable-line no-control-regex
const hash = (t: string) => createHash("sha256").update(t).digest("hex");
const money = (n: number) => "$" + n.toLocaleString("en-US");

export function registerSignup(f: FastifyInstance, d: SignupDeps): void {
  const html = (reply: FastifyReply, body: string, status = 200) => reply.code(status).header("x-robots-tag", "noindex").header("cache-control", "no-store").type("text/html; charset=utf-8").send(body);
  const fields = (req: FastifyRequest) => (req.body && typeof req.body === "object" ? req.body : {}) as Record<string, string>;
  if (!f.hasContentTypeParser("application/x-www-form-urlencoded")) f.addContentTypeParser("application/x-www-form-urlencoded", { parseAs: "string" }, (_req, body, done) => { done(null, Object.fromEntries(new URLSearchParams(body as string))); });
  const hits = new Map<string, { n: number; until: number }>();
  const slow = (key: string, max: number) => { const now = Date.now(), x = hits.get(key); if (hits.size > 20000) hits.clear(); if (!x || x.until < now) { hits.set(key, { n: 1, until: now + 3600000 }); return false; } return ++x.n > max; };
  const base = d.appUrl.replace(/\/$/, ""), say = d.log || (() => {});

  // ---- the price for a firm of any size (T-98) ----
  const quoteView = (o: { n?: number; error?: string; sent?: boolean; v?: Record<string, string> } = {}) => {
    const T = createEngine(); T.blank({}); if (d.priceBook === "B") T.S.firm.priceBook = "B"; const q = o.n ? T.quoteFor(o.n) : null, v = o.v || {};
    return page("What Tallyhound costs", [h("h1", { key: 1 }, "What Tallyhound costs"), h("p", { key: 2 }, "One flat monthly price by how many clients you have. No charge per return, per document or per message."),
      o.error ? h("p", { key: 3, className: "err", role: "alert" }, o.error) : null, o.sent ? h("p", { key: 4, className: "ok", role: "status" }, "Thank you. Someone from Tallyhound will write to you within one business day.") : null,
      h("form", { key: 5, method: "post", action: "/quote" }, field("clients", "How many clients do you prepare returns for?", { type: "number", min: 1, max: 100000, required: true, defaultValue: o.n || "", inputMode: "numeric" }), h("button", { className: "btn pri" }, "Show the price")),
      q ? h("div", { key: 6, className: "card" }, h("p", { className: "muted small" }, "For " + o.n!.toLocaleString("en-US") + " clients"), h("p", { className: "ask" }, money(q.monthly) + " a month"),
        h("p", { className: "muted" }, q.blocks ? "The " + q.plan + " plan (" + (T.plans() as [string, number, number][]).at(-1)![2].toLocaleString("en-US") + " clients) plus " + q.blocks + " block" + (q.blocks === 1 ? "" : "s") + " of 1,000 clients. Covers up to " + q.clients.toLocaleString("en-US") + "." : "The " + q.plan + " plan, for up to " + q.clients.toLocaleString("en-US") + " clients.")) : null,
      q && q.blocks ? h("form", { key: 7, method: "post", action: "/quote" }, h("input", { type: "hidden", name: "clients", value: String(o.n) }), h("input", { type: "hidden", name: "ask", value: "1" }), h("p", null, "A firm this size is set up with us directly. Tell us who to write to."),
        field("firm", "Firm name", { type: "text", required: true, maxLength: 80, defaultValue: v.firm || "" }), field("name", "Your name", { type: "text", required: true, maxLength: 80, defaultValue: v.name || "" }), field("email", "Work email", { type: "email", required: true, maxLength: 254, defaultValue: v.email || "" }), h("button", { className: "btn pri" }, "Ask for this price")) : null,
      q && !q.blocks && d.open ? h("p", { key: 8 }, h("a", { className: "btn", href: "/signup" }, "Start a 14-day free trial")) : null]);
  };
  f.get("/quote", async (_req, reply) => html(reply, quoteView()));
  f.post("/quote", async (req, reply) => {
    const b = fields(req), n = Math.floor(+b.clients!); if (!(n >= 1) || n > 100000) return html(reply, quoteView({ error: "Enter how many clients you have, as a number." }), 400);
    if (b.ask !== "1") return html(reply, quoteView({ n }));
    const v = { firm: clean(b.firm, 80), name: clean(b.name, 80), email: clean(b.email, 254).toLowerCase() };
    if (!v.firm || !v.name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.email)) return html(reply, quoteView({ n, v, error: "Fill in your firm, your name and a work email address." }), 400);
    if (slow("q:" + req.ip, PER_ADDRESS_AN_HOUR)) return html(reply, quoteView({ n, v, error: "Please wait a while before asking again." }), 429);
    const T = createEngine(); T.blank({}); const q = T.quoteFor(n)!;
    if (d.tell) await d.tell("A firm of " + n.toLocaleString("en-US") + " clients asked for a price", v.firm + "\n" + v.name + ", " + v.email + "\n" + n + " clients: " + money(q.monthly) + " a month (" + q.plan + " plus " + q.blocks + " blocks)").catch(() => {});
    say("quote_asked", n); return html(reply, quoteView({ n, sent: true }));
  });
  if (!d.open) { f.get("/signup", async (_req, reply) => html(reply, page("Sign up", [h("h1", { key: 1 }, "Tallyhound is opening to new firms soon"), h("p", { key: 2 }, "For now, firms are set up by hand. Write to us and we will get you started.")]), 404)); return; }

  // ---- sign up ----
  const form = (v: Record<string, string> = {}, error?: string) => page("Start your free trial", [h("h1", { key: 1 }, "Start your free trial"), h("p", { key: 2 }, "14 days, no card. Collect documents from up to 10 clients and see it work."), error ? h("p", { key: 3, className: "err", role: "alert" }, error) : null,
    h("form", { key: 4, method: "post", action: "/signup" }, field("firm", "Firm name", { type: "text", required: true, maxLength: 80, defaultValue: v.firm || "", autoComplete: "organization" }), field("name", "Your name", { type: "text", required: true, maxLength: 80, defaultValue: v.name || "", autoComplete: "name" }),
      field("email", "Work email", { type: "email", required: true, maxLength: 254, defaultValue: v.email || "", autoComplete: "email" }),
      h("div", { className: "field" }, h("label", { htmlFor: "iana" }, "Your time zone"), h("select", { id: "iana", name: "iana", defaultValue: v.iana || "America/Chicago", style: { width: "100%", font: "inherit", padding: 12, minHeight: 48, borderRadius: 12 } }, ZONES.map((z) => h("option", { key: z[0], value: z[0] }, z[1])))),
      field("clients", "About how many clients do you prepare returns for?", { type: "number", min: 1, max: 100000, required: true, defaultValue: v.clients || "", inputMode: "numeric" }),
      // A field people never see. Programs that fill in every field give themselves away.
      h("div", { style: { position: "absolute", left: -9999 }, "aria-hidden": true }, h("label", { htmlFor: "website" }, "Leave this empty"), h("input", { id: "website", name: "website", type: "text", tabIndex: -1, autoComplete: "off" })),
      h("p", { className: "muted small" }, "Before anything is sent to your clients, Tallyhound confirms you are a tax or accounting firm. This usually takes one business day and you can set everything up in the meantime."), h("button", { className: "btn pri" }, "Email me a link to start"))]);
  const sent = (email: string) => page("Check your email", [h("h1", { key: 1 }, "Check your email"), h("p", { key: 2 }, "If " + email + " can be used to start a trial, a link is on its way. It works for " + SIGNUP_MINUTES + " minutes."), h("p", { key: 3, className: "muted" }, "Nothing has been created yet. The link does that.")]);
  f.get("/signup", async (_req, reply) => html(reply, form()));
  f.post("/signup", async (req, reply) => {
    const b = fields(req), v = { firm: clean(b.firm, 80), name: clean(b.name, 80), email: clean(b.email, 254).toLowerCase(), iana: clean(b.iana, 40), clients: String(Math.floor(+b.clients!) || "") };
    if (b.website) return html(reply, sent(v.email || "that address"));   // a program, not a person: told the same thing, nothing done
    if (!v.firm || !v.name) return html(reply, form(v, "Enter your firm's name and your own."), 400);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.email)) return html(reply, form(v, "Enter your work email address."), 400);
    if (!ZONES.some((z) => z[0] === v.iana)) return html(reply, form(v, "Choose your time zone."), 400);
    if (!(+v.clients >= 1) || +v.clients > 100000) return html(reply, form(v, "Enter about how many clients you have, as a number."), 400);
    if (slow("s:" + req.ip, PER_ADDRESS_AN_HOUR)) return html(reply, form(v, "Please wait a while before trying again."), 429);
    const now = d.clock(); await d.store.sweep(now);
    // The same answer whether or not the address already has an account, so this form cannot be used to find out who is a customer.
    if (!(await d.auth.userByEmail(v.email)) && (await d.store.countSince(v.email, new Date(now.getTime() - 3600000))) < PER_EMAIL_AN_HOUR) {
      const token = randomBytes(24).toString("base64url");
      await d.store.put({ tokenHash: hash(token), email: v.email, payload: { firm: v.firm, name: v.name, email: v.email, iana: v.iana, clients: +v.clients }, createdAt: now, expiresAt: new Date(now.getTime() + SIGNUP_MINUTES * 60000) });
      await d.mail(v.email, "Confirm your email to start with Tallyhound", "Hello " + v.name.split(" ")[0] + ",\n\nOpen this link to start " + v.firm + "'s free trial of Tallyhound. It works once and for " + SIGNUP_MINUTES + " minutes.\n\n" + base + "/signup/confirm?t=" + token + "\n\nIf you did not ask for this, ignore this email and nothing will be created.").catch((err: Error) => say("signup_mail_failed", err.message));
      say("signup_requested");
    }
    return html(reply, sent(v.email));
  });
  const stale = () => page("That link has expired", [h("h1", { key: 1 }, "That link has expired"), h("p", { key: 2 }, "It works once, for " + SIGNUP_MINUTES + " minutes. "), h("p", { key: 3 }, h("a", { className: "btn", href: "/signup" }, "Start again"))]);
  f.get("/signup/confirm", async (req, reply) => {
    const t = String((req.query as { t?: string }).t || ""), r = t ? await d.store.peek(hash(t), d.clock()) : null; if (!r) return html(reply, stale(), 404);
    return html(reply, page("Start your trial", [h("h1", { key: 1 }, "Start " + r.payload.firm + "'s trial"), h("p", { key: 2 }, "Your email address is confirmed. One more press and your firm is set up."), h("form", { key: 3, method: "post", action: "/signup/confirm" }, h("input", { type: "hidden", name: "t", value: t }), h("button", { className: "btn pri" }, "Start my 14-day trial"))]));
  });
  f.post("/signup/confirm", async (req, reply) => {
    const t = String(fields(req).t || ""), r = t ? await d.store.take(hash(t), d.clock()) : null; if (!r) return html(reply, stale(), 404);
    const p = r.payload; if (await d.auth.userByEmail(p.email)) return html(reply, page("You already have an account", [h("h1", { key: 1 }, "You already have an account"), h("p", { key: 2 }, h("a", { className: "btn pri", href: "/signin" }, "Sign in"))]));
    // The firm's Tallyhound address comes from its name, with a number added when another firm has it.
    const stem = p.firm.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "").slice(0, 24) || "firm"; let inbox = stem + "@" + d.inboxDomain; for (let i = 2; await d.inboxTaken(inbox); i++) { if (i > 500) return html(reply, stale(), 500); inbox = stem + i + "@" + d.inboxDomain; }
    const made = await d.firms.create({ name: p.firm, inbox, iana: p.iana, ownerName: p.name, ownerEmail: p.email, verified: false });
    await d.app.withFirm(made.firmId, (T: Engine) => { if (d.priceBook === "B") T.S.firm.priceBook = "B"; T.S.firm.signup = { at: new Date(T.S.now), clients: p.clients }; T.audit("firm.signup", "Signed up for a trial. About " + p.clients + " clients", p.name); });
    await d.requestSignInLink(p.email).catch((err: Error) => say("signup_link_failed", made.firmId, err.message));
    if (d.tell) await d.tell("A new firm signed up and is waiting for its check", "Firm id: " + made.firmId + "\nAbout " + p.clients + " clients\n\nFollow docs/FIRM_CHECK.md, then: npm run admin -- firm-check --firm " + made.firmId + " --by \"Your name\"").catch(() => {});
    say("signup_done", made.firmId);
    return html(reply, page("You're in", [h("h1", { key: 1 }, "You're in"), h("p", { key: 2 }, "We have emailed your sign-in link to " + p.email + ". The first time, you will set up two-step sign-in with an authenticator app."), h("p", { key: 3, className: "muted" }, "Your trial lasts 14 days. Nothing is sent to your clients until Tallyhound has confirmed your firm, usually within one business day. You can add clients and build checklists straight away.")]));
  });
}
