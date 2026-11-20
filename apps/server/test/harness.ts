// Builds the whole service for a test: in memory, or on a real Postgres when DATABASE_URL is set (each in its own schema, dropped at the end).
import { createWatch, memoryOpsStore, postgresOpsStore } from "../src/ops.ts";
import { createNotifier } from "../src/notify.ts";
import { randomBytes } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { createHmac } from "node:crypto";
import { createApp, kitAuth, kitCrypto, kitMemory, kitPostgres, kitTwilio, type PrepareOpts } from "../src/kit.ts";
import { createInbox, memoryQueue, postgresQueue, type QueueStore } from "../src/queue.ts";
import { handlers } from "../src/hooks.ts";
import { memoryAuthStore, postgresAuthStore, type AuthStore } from "../src/authstore.ts";
import { createSignIn, firmSecrets } from "../src/signin.ts";
import { createFirms } from "../src/firms.ts";
import { buildServer } from "../src/server.ts";
import { createWorker } from "../src/worker.ts";
import { migrate } from "../src/runtime.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
export const KINDS: ("memory" | "postgres")[] = process.env.DATABASE_URL ? ["memory", "postgres"] : ["memory"];
export const APP_URL = "https://app.tallyhound.test";

export const TWILIO_TOKEN = "twilio-test-token", PM = { user: "postmark", pass: "hook-pass" };

export async function build(kind: "memory" | "postgres" = "memory", opt: { ai?: unknown; prepare?: PrepareOpts; appUrl?: string } = {}) {
  let t = new Date("2027-01-25T16:05:00Z"); const clock = () => t;
  const APP = opt.appUrl || APP_URL, keyring = kitCrypto.localKeyring(randomBytes(32)), schema = "th_test_" + randomBytes(6).toString("hex"); let inner: ReturnType<typeof kitMemory.memoryStore>, queue: QueueStore, auth: AuthStore, pool: pg.Pool | null = null, auditRows: () => Promise<{ action: string; actor: string }[]>;
  if (kind === "postgres") {
    const admin = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
    await admin.query("create schema " + schema); await admin.end();   // its own schema, so test files can run side by side
    pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 5, options: "-c search_path=" + schema });
    await migrate(pool); inner = kitPostgres.postgresStore(pool, kitPostgres.memoryBucket()); auth = postgresAuthStore(pool); queue = postgresQueue(pool);
    auditRows = async () => (await pool!.query("select action, actor from audit_log order by id")).rows as { action: string; actor: string }[];
  } else { inner = kitMemory.memoryStore(); const m = memoryAuthStore(() => [...inner.firms.keys()]); auth = m; queue = memoryQueue(); auditRows = async () => m.auditRows; }
  const store = kitCrypto.encryptedStore(inner, keyring), sms = kitMemory.fakeSender(), email = kitMemory.fakeSender();
  const app = createApp({ store, sms, email, ai: opt.ai || null, clock });
  // A stand-in for Twilio's media store: what it holds, what was asked of it, and a switch to make it fail.
  const media = new Map<string, Buffer>(), mediaCalls: string[] = []; let mediaDown = false;
  const twilio = kitTwilio.twilio({ accountSid: "AC1", authToken: TWILIO_TOKEN, messagingServiceSid: "MG1", fetchImpl: async (url: string, o: { method?: string } = {}) => {
    const method = o.method || "GET"; mediaCalls.push(method + " " + url.split("/").pop());
    if (mediaDown) return { ok: false, status: 503 }; const b = media.get(url);
    if (method === "DELETE") { media.delete(url); return { ok: !!b, status: b ? 204 : 404 }; }
    return b ? { ok: true, status: 200, arrayBuffer: async () => b, headers: { get: () => "image/jpeg" } } : { ok: false, status: 404 };
  } });
  const inbox = createInbox({ queue, store, app, handlers: handlers({ app, twilio, prepare: opt.prepare }), clock });
  const links: { to: string; url: string }[] = [], lockMails: { to: string; minutes: number }[] = [];
  const signIn = createSignIn({ auth, secrets: firmSecrets(store, keyring, kitCrypto), mailer: { async signInLink(to, url) { links.push({ to, url }); }, async locked(to, minutes) { lockMails.push({ to, minutes }); } }, linkSecret: "test-secret", appUrl: APP, clock });
  const firms = createFirms({ app, auth, linkHost: "go.tallyhound.test" }), staffMails: { to: string; subject: string; body: string }[] = [], devMails: { subject: string; body: string }[] = [], ops = pool ? postgresOpsStore(pool) : memoryOpsStore(), watch = createWatch({ to: "dev@tallyhound.test", send: async (_to, subject, body) => { devMails.push({ subject, body }); }, clock }), worker = createWorker({ app, auth, clock, inbox, ops, watch, notify: createNotifier({ appUrl: APP }), mailer: { async staff(to, subject, body) { staffMails.push({ to, subject, body }); } } });
  const server = await buildServer({ app, auth, signIn, firms, readState: (id) => store.readState(id), getFile: (id, key) => store.getFile(id, key), appUrl: APP, secureCookies: APP.startsWith("https:"), webDir: join(HERE, "../../web/dist"), prepare: opt.prepare, clientPages: { store, inbox, clock }, hooks: { store, inbox, twilioAuthToken: TWILIO_TOKEN, postmarkHook: PM } });

  // A browser: keeps its cookie, sends the header our pages send.
  function browser() {
    let cookie = "";
    const call = async (method: "GET" | "POST" | "DELETE", url: string, body?: unknown, headers: Record<string, string> = { "x-tallyhound": "1", origin: APP }) => {
      const r = await server.inject({ method, url, payload: body === undefined ? undefined : JSON.stringify(body), headers: { ...(body === undefined ? {} : { "content-type": "application/json" }), ...headers, ...(cookie ? { cookie } : {}) } });
      const set = r.cookies.find((c) => c.name === "th_s"); if (set) cookie = set.value ? "th_s=" + set.value : "";
      let json: any = null; try { json = r.json(); } catch { /* a page, not JSON */ }   // eslint-disable-line @typescript-eslint/no-explicit-any
      return { status: r.statusCode, json, headers: r.headers, raw: r, setCookie: r.cookies.find((c) => c.name === "th_s") };
    };
    return { get: (u: string) => call("GET", u), post: (u: string, b: unknown = {}, extra?: Record<string, string>) => call("POST", u, b, extra ? { "x-tallyhound": "1", origin: APP, ...extra } : undefined), del: (u: string) => call("DELETE", u), call, cookie: () => cookie };
  }
  // Twilio calling in, signed the way Twilio signs. badSig: a caller who does not hold the token.
  const twilioPost = (path: string, params: Record<string, string>, badSig = false) => {
    const sig = createHmac("sha1", badSig ? "wrong" : TWILIO_TOKEN).update(APP + path + Object.keys(params).sort().map((k) => k + params[k]).join("")).digest("base64");
    return server.inject({ method: "POST", url: path, payload: new URLSearchParams(params).toString(), headers: { "content-type": "application/x-www-form-urlencoded", "x-twilio-signature": sig } });
  };
  const postmarkPost = (path: string, body: unknown, pass = PM.pass) => server.inject({ method: "POST", url: path, payload: JSON.stringify(body), headers: { "content-type": "application/json", authorization: "Basic " + Buffer.from(PM.user + ":" + pass).toString("base64") } });
  const secrets = new Map<string, Buffer>();   // each person's authenticator app
  const token = (url: string) => decodeURIComponent(url.split("#t=")[1]!);
  const unbase32 = (s: string) => { const A = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"; let bits = ""; for (const ch of s) bits += A.indexOf(ch).toString(2).padStart(5, "0"); const out = []; for (let i = 0; i + 8 <= bits.length; i += 8) out.push(parseInt(bits.slice(i, i + 8), 2)); return Buffer.from(out); };
  const codeFor = (emailAddr: string) => kitAuth.totp(secrets.get(emailAddr)!, t);
  // Signs a person all the way in, setting up their authenticator the first time. Returns their browser.
  async function signInAs(emailAddr: string) {
    const b = browser(); await b.post("/auth/link", { email: emailAddr }); const link = links.filter((l) => l.to === emailAddr).pop(); if (!link) throw new Error("No link was sent to " + emailAddr);
    const o = await b.post("/auth/open", { token: token(link.url) }); let recoveryCodes: string[] = [];
    if (o.json.next === "setup") { const s = await b.post("/auth/setup/start"); secrets.set(emailAddr, unbase32(s.json.secret)); const f = await b.post("/auth/setup/finish", { code: codeFor(emailAddr) }); if (f.status !== 200) throw new Error("setup failed: " + f.raw.body); recoveryCodes = f.json.recoveryCodes; }
    else { advance(31); const c = await b.post("/auth/code", { code: codeFor(emailAddr) }); if (c.status !== 200) throw new Error("code failed: " + c.raw.body); }
    return Object.assign(b, { recoveryCodes });
  }
  const advance = (seconds: number) => { t = new Date(t.getTime() + seconds * 1000); };
  const newFirm = (n = 1, verified = true) => firms.create({ name: "Test CPAs " + n, inbox: "test" + n + "@docs.tallyhound.test", smsNumber: "615555010" + n, iana: "America/Chicago", ownerName: "Pat Owner", ownerEmail: "pat" + n + "@firm" + n + ".test", plan: "Practice", verified });
  return { kind, server, app, auth, firms, worker, inbox, queue, inner, media, mediaCalls, mediaDown: (on: boolean) => { mediaDown = on; }, twilioPost, postmarkPost, store, sms, email, links, lockMails, staffMails, devMails, ops, browser, signInAs, codeFor, token, unbase32, secrets, advance, clock, newFirm, auditRows, async close() { await inbox.drain(); await server.close(); if (pool) { await pool.query("drop schema " + schema + " cascade"); await pool.end(); } } };
}
export type Harness = Awaited<ReturnType<typeof build>>;

// A PDF with real text, written by hand so tests need no PDF writer: one page per list of lines.
export function pdfPagesWith(pages: string[][]): Buffer {
  const n = pages.length, objs = ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [" + pages.map((_, i) => 4 + i * 2 + " 0 R").join(" ") + "] /Count " + n + " >>", "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"];
  pages.forEach((lines, i) => { const stream = "BT /F1 28 Tf 50 700 Td " + lines.map((l) => "(" + l.replace(/[()\\]/g, "") + ") Tj 0 -40 Td").join(" ") + " ET"; objs.push("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents " + (5 + i * 2) + " 0 R /Resources << /Font << /F1 3 0 R >> >> >>", "<< /Length " + stream.length + " >>\nstream\n" + stream + "\nendstream"); });
  let out = "%PDF-1.4\n"; const at: number[] = [];
  objs.forEach((o, i) => { at.push(out.length); out += i + 1 + " 0 obj\n" + o + "\nendobj\n"; });
  const xref = out.length; out += "xref\n0 " + (objs.length + 1) + "\n0000000000 65535 f \n" + at.map((x) => String(x).padStart(10, "0") + " 00000 n \n").join("") + "trailer\n<< /Size " + (objs.length + 1) + " /Root 1 0 R >>\nstartxref\n" + xref + "\n%%EOF\n";
  return Buffer.from(out, "latin1");
}
