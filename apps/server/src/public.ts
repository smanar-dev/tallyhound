// The client's pages: /c/<link> to agree to texts, /u/<link> to send documents, /e/<link> to stop emails, and /f/<firm>, the firm's
// public page that carriers and wary clients read. No login and no cookie: the private link is the only credential (decided
// November 19, as the specification says). A link shows the firm's name and what is still being asked for, never a document,
// never anything already received, and nothing about any other client.
import multipart from "@fastify/multipart";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { createEngine, kitRegistration, wallTime, type App, type Engine, type KitStore } from "./kit.ts";
import type { AuthStore } from "./authstore.ts";
import type { Inbox } from "./queue.ts";
import * as pages from "./clientpages.ts";

const CSS = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../assets/client.css")), JS = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../assets/client.js"));
export const MAX_FILE = 25 * 1024 * 1024, MAX_FILES = 10, PER_LINK_A_MINUTE = 30, PER_ADDRESS_A_MINUTE = 60;
export interface PublicDeps { lookup?: { lineType(mobile10: string): Promise<string> } | null; app: App; store: KitStore; auth: AuthStore; inbox: Inbox; clock: () => Date; log?: (event: string, ...ids: unknown[]) => void }
/* eslint-disable @typescript-eslint/no-explicit-any */
type Found = { firmId: string; firm: pages.FirmView; T: Engine; c: any | null; e: any | null };

export async function registerPublic(f: FastifyInstance, d: PublicDeps): Promise<void> {
  const say = d.log || (() => {});
  await f.register(multipart, { limits: { fileSize: MAX_FILE, files: MAX_FILES, fields: 5 } });
  if (!f.hasContentTypeParser("application/x-www-form-urlencoded")) f.addContentTypeParser("application/x-www-form-urlencoded", { parseAs: "string" }, (_req, body, done) => { done(null, Object.fromEntries(new URLSearchParams(body as string))); });

  // Whose link is this? The firm is found by its short name; the client by their key inside that firm's own sealed state.
  async function find(token: string, kind: "c" | "u" | "e"): Promise<Found | null> {
    const m = /^([a-z]{1,40})-([a-z]{28})$/.exec(String(token || "")); if (!m) return null;
    const firmId = await d.auth.firmIdBySlug(m[1]!), json = firmId && (await d.store.readState(firmId)); if (!firmId || !json) return null;
    const T = createEngine(); T.load(json); T.setNow(T.S.firm.iana ? wallTime(d.clock(), T.S.firm.iana) : d.clock());
    const c = T.S.clients.find((x: any) => (kind === "e" ? x.ekey === m[2] : x.key === m[2] && T.linkLive(x))) || null;
    return { firmId, firm: { name: T.S.firm.name, phone: T.S.firm.phone || "", page: "/f/" + m[1] }, T, c, e: c ? T.engOf(c.id) : null };
  }
  const html = (reply: FastifyReply, body: string, status = 200) => reply.code(status).header("x-robots-tag", "noindex, nofollow").type("text/html; charset=utf-8").send(body);
  const gone = (reply: FastifyReply, x: Found | null) => html(reply, x ? pages.expiredPage(x.firm) : pages.unknownPage(), 404);
  // A brake on guessing and on flooding: so many requests a minute per link, and per address.
  const hits = new Map<string, { n: number; until: number }>();
  const brake = async (req: FastifyRequest, reply: FastifyReply) => {
    const now = Date.now(), t = (req.params as { t?: string }).t || ""; if (hits.size > 20000) hits.clear();
    for (const [key, max] of [["ip:" + req.ip, PER_ADDRESS_A_MINUTE], [req.method === "GET" ? "" : "t:" + t, PER_LINK_A_MINUTE]] as [string, number][]) {
      if (!key) continue; const h = hits.get(key); if (!h || h.until < now) { hits.set(key, { n: 1, until: now + 60000 }); continue; }
      if (++h.n > max) return html(reply, pages.unknownPage().replace("This link has expired", "Please wait a minute and try again").replace("This link has expired", "Please wait a minute"), 429);
    }
  };
  const params = (req: FastifyRequest) => req.params as { t: string };
  const fields = (req: FastifyRequest) => (req.body && typeof req.body === "object" ? req.body : {}) as Record<string, string>;

  f.get("/client.js", async (_req, reply) => reply.header("cache-control", "public, max-age=3600").type("text/javascript; charset=utf-8").send(JS));
  f.get("/client.css", async (_req, reply) => reply.header("cache-control", "public, max-age=3600").type("text/css; charset=utf-8").send(CSS));

  // ---- /c: agree to texts ----
  const consentView = (x: Found, t: string, error?: string) => pages.consentPage(x.firm, { action: "/c/" + t, wording: String(x.T.CONSENT_WORDING.text).replace("{firm}", x.firm.name), onFile: x.c.mobile && x.c.mobile.length === 10 && !x.c.mobileBad ? x.c.mobile.slice(6) : "", error });
  f.get("/c/:t", { preHandler: brake }, async (req, reply) => {
    const x = await find(params(req).t, "c"); if (!x || !x.c) return gone(reply, x);
    return html(reply, x.c.textConsent === "given" ? pages.consentDone(x.firm) : consentView(x, params(req).t));
  });
  f.post("/c/:t", { preHandler: brake }, async (req, reply) => {
    const t = params(req).t, x = await find(t, "c"), b = fields(req); if (!x || !x.c) return gone(reply, x);
    if (b.choice === "email") { await d.app.withFirm(x.firmId, (T: Engine) => T.declineTexts(x.c.id)); return html(reply, pages.emailInstead(x.firm)); }
    const mobile = String(b.mobile || "").trim() || (x.c.mobileBad ? "" : x.c.mobile) || "";
    // A number we have not asked about yet is asked about now, before it can be agreed for (T-119). No answer changes nothing.
    const ten = mobile.replace(/\D/g, "").replace(/^1(\d{10})$/, "$1"), line = d.lookup && ten.length === 10 && x.c.lineFor !== ten ? await d.lookup.lineType(ten) : null;
    const r = (await d.app.withFirm(x.firmId, (T: Engine) => { const c = T.client(x.c.id); if (line === "landline" && c && c.mobile !== ten) return { ok: false, why: "That number is a landline, which cannot get texts. Enter a mobile number" }; if (line && c && c.mobile === ten) T.setLine(c.id, line); const out = T.consentFromPage(x.c.id, { mobile, ip: req.ip, agent: String(req.headers["user-agent"] || "") }); if (out.ok && line && line !== "landline") T.setLine(x.c.id, line); return out; })) as { ok: boolean; why?: string };
    if (!r.ok) return html(reply, consentView(x, t, (r.why || "That did not work") + "."), 400);
    return reply.redirect("/c/" + t, 303);   // a reload shows "You're set", and cannot agree twice
  });

  // ---- /u: send documents ----
  const uploadView = (x: Found, t: string, o: { error?: string; sent?: number } = {}) => {
    const done = !x.e || ["complete", "closed"].includes(x.e.status), it = done ? null : x.T.nextItem(x.e) || x.T.openItems(x.e.id)[0], open = done ? 0 : x.T.openItems(x.e.id).length;
    const ask = it ? "your " + (it.custom || (x.T.FORMS[it.form] || x.T.FORMS.OTHER).plain) + (it.payer ? " from " + it.payer : "") : null;
    return pages.uploadPage(x.firm, { action: "/u/" + t, ask, others: Math.max(0, open - (it ? 1 : 0)), done: done || (!it && open === 0), ...o });
  };
  // While a check-in is out and unanswered, the client's link opens the check-in, not the upload page.
  const checkinOpen = (x: Found) => !!(x.e && x.e.checkin && x.e.checkin.sentAt && !x.e.checkin.doneAt && !["complete", "closed"].includes(x.e.status));
  const checkinView = (x: Found, t: string, changed: boolean, error?: string) => { const p = x.T.checkinPrefill(x.e.id), name = (i: { form: string; payer: string }) => (x.T.FORMS[i.form] || x.T.FORMS.OTHER).plain + (i.payer ? " from " + i.payer : "");
    return pages.checkinPage(x.firm, { action: "/u/" + t, year: x.e.year, choices: x.T.CHECKQ.map((q: string[]) => [q[0], q[1]]), ticked: p.facts, employers: p.w2, last: p.last.map(name), returning: !!p.returning && p.last.length > 0, changed, error }); };
  f.get("/u/:t", { preHandler: brake }, async (req, reply) => {
    const x = await find(params(req).t, "u"); if (!x || !x.c) return gone(reply, x);
    if (checkinOpen(x)) return html(reply, checkinView(x, params(req).t, !!(req.query as { changed?: string }).changed));
    const sent = Math.min(MAX_FILES, Math.max(0, +(req.query as { sent?: string }).sent! || 0)); return html(reply, uploadView(x, params(req).t, { sent: sent || undefined }));
  });
  f.post("/u/:t", { preHandler: brake }, async (req, reply) => {
    // The page's own script sends one file at a time and wants a short answer, not a page.
    const t = params(req).t, x = await find(t, "u"), script = req.headers["x-tallyhound-client"] === "1", no = (status: number, error: string) => reply.code(status).header("cache-control", "no-store").send({ error });
    if (!x || !x.c) return script ? no(404, "This link has expired. Ask " + (x ? x.firm.name : "your accounting firm") + " for a new one.") : gone(reply, x);
    if (!req.isMultipart() && fields(req).form === "checkin") {
      if (!checkinOpen(x)) return reply.redirect("/u/" + t, 303);   // answered already, or never sent: nothing to take
      const b = fields(req), facts: Record<string, boolean> = {}; for (const q of x.T.CHECKQ as string[][]) facts[q[0]!] = b["f_" + q[0]] === "1";
      // Only taps, a count and a short note cross over. What the note means is read by the model on the server, never taken from the browser.
      await d.app.checkinAnswers(x.firmId, x.c.id, b.same === "1" ? { same: true, facts: {}, counts: {} } : { facts, counts: { w2: Math.min(9, Math.max(1, Math.round(+b.w2!) || 1)) }, note: String(b.note || "").slice(0, 300) });
      return html(reply, pages.checkinDone(x.firm));
    }
    if (!req.isMultipart()) return script ? no(400, "Choose a photo or a PDF first.") : html(reply, uploadView(x, t, { error: "Choose a photo or a PDF first." }), 400);
    const files: { name: string; type: string; b64: string }[] = []; let tooBig = false;
    try { for await (const part of req.files()) { const buf = await part.toBuffer(); if (buf.length) files.push({ name: String(part.filename || "").slice(0, 120), type: part.mimetype, b64: buf.toString("base64") }); } }
    catch (err) { if ((err as { code?: string }).code === "FST_REQ_FILE_TOO_LARGE" || (err as { code?: string }).code === "FST_FILES_LIMIT") tooBig = true; else throw err; }
    if (tooBig) return script ? no(413, "Too large. The limit is 25 MB.") : html(reply, uploadView(x, t, { error: "Too large. The limit is 25 MB a file, and " + MAX_FILES + " files at a time." }), 413);
    if (!files.length) return script ? no(400, "Choose a photo or a PDF first.") : html(reply, uploadView(x, t, { error: "Choose a photo or a PDF first." }), 400);
    // Stored sealed and answered at once; the worker reads it. A failure here tells the client to try again, and nothing is half kept.
    const id = randomBytes(12).toString("hex");
    await d.inbox.accept("upload", id, x.firmId, "upload", Buffer.from(JSON.stringify({ id, clientId: x.c.id, files }))); void d.inbox.drain(); say("upload_received", x.firmId, files.length);
    return script ? reply.header("cache-control", "no-store").send({ ok: true, sent: files.length }) : reply.redirect("/u/" + t + "?sent=" + files.length, 303);
  });

  // ---- /e: stop emails. A POST with no page is the one-click request mail programs send. ----
  f.get("/e/:t", { preHandler: brake }, async (req, reply) => {
    const t = params(req).t, x = await find(t, "e"); if (!x || !x.c) return gone(reply, x);
    if ((req.query as { keep?: string }).keep) return html(reply, pages.keptPage(x.firm));
    return html(reply, pages.unsubscribePage(x.firm, { action: "/e/" + t, keep: "/e/" + t + "?keep=1", done: !!x.c.emailOff }));
  });
  f.post("/e/:t", { preHandler: brake }, async (req, reply) => {
    const t = params(req).t, x = await find(t, "e"); if (!x || !x.c) return gone(reply, x);
    await d.app.withFirm(x.firmId, (T: Engine) => T.stopEmail(x.c.id, fields(req)["List-Unsubscribe"] === "One-Click" ? "one click" : "link"));
    return html(reply, pages.unsubscribePage(x.firm, { action: "/e/" + t, keep: "", done: true }));
  });

  // ---- /f: the firm's public page (who they are, what the texts are, how to stop, privacy). Fixed wording from the kit, escaped there. ----
  f.get("/f/:slug", { preHandler: brake }, async (req, reply) => {
    const slug = String((req.params as { slug: string }).slug || ""), firmId = /^[a-z]{1,40}$/.test(slug) ? await d.auth.firmIdBySlug(slug) : null, json = firmId && (await d.store.readState(firmId));
    if (!json) return html(reply, pages.unknownPage().replace(/This link has expired/g, "There is no firm page at this address").replace("Ask your accounting firm for a new one, or call their office.", "Check the address, or call your accounting firm's office."), 404);
    const S = JSON.parse(json).state, n = String(S.firm.smsNumber || "").replace(/\D/g, "").slice(-10);
    // This one page carries its own small inline styles, so it is served with a policy that allows styles and still no script at all.
    return reply.header("content-security-policy", "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'").type("text/html; charset=utf-8")
      .send(kitRegistration.firmPage({ name: S.firm.name, phone: S.firm.phone }, { number: S.firm.senderStatus === "approved" && n ? "(" + n.slice(0, 3) + ") " + n.slice(3, 6) + "-" + n.slice(6) : undefined, address: S.firm.email || undefined }));
  });
}
