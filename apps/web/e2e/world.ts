// A whole Tallyhound for one browser test: the real web service on a local port (in memory), the built web app, and a real browser.
import net from "node:net";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import assert from "node:assert/strict";
import { chromium, type Browser, type Page } from "playwright";
import sharp from "sharp";
import { build } from "../../server/test/harness.ts";
import { createEngine, kitAuth, kitMemory, type Engine } from "../../server/src/kit.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
if (!existsSync(join(HERE, "../dist/index.html"))) throw new Error("Build the web app first: npm run build");
const freePort = () => new Promise<number>((ok, fail) => { const s = net.createServer(); s.on("error", fail); s.listen(0, "127.0.0.1", () => { const p = (s.address() as net.AddressInfo).port; s.close(() => ok(p)); }); });
let browser: Browser | null = null;
export const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(4000, 7)]);
// The kit's stand-in model. A test changes `reading.doc` or `reading.text` to decide what the model "sees" next.
const CLEAN_W2 = { is_tax_document: true, form: "W2", tax_year: 2026, payer: "Acme Logistics", recipient_name: "JO DAY", legibility: 0.95, confidence: 0.97, missing_parts: [], note: "A W-2" };
const SAYS_NONE = { intent: "says_none", item_id: null, summary: "does not have it", scope: "documents", sentiment: "calm", topics: [] };
// A real photograph, so the browser can actually draw it: a pale page with a dark band, 900 by 1200.
export const PHOTO: Buffer = await sharp({ create: { width: 900, height: 1200, channels: 3, background: "#f4f1e8" } }).composite([{ input: { create: { width: 700, height: 90, channels: 3, background: "#22324a" } }, top: 120, left: 100 }]).jpeg({ quality: 70 }).toBuffer();

export async function world() {
  const reading: { doc: Record<string, unknown>; text: Record<string, unknown> } = { doc: CLEAN_W2, text: SAYS_NONE };
  const ai = kitMemory.fakeAI((p: string) => (p.startsWith("You read photos") ? reading.doc : p.startsWith("You read text messages") ? reading.text : null));
  const port = await freePort(), url = "http://127.0.0.1:" + port, H = await build("memory", { ai, appUrl: url,
    // A stand-in for the mail service's Domains API: one domain, whose records are "found" once DNS.found is set.
    postmarkAccount: (async (u: unknown, init: RequestInit = {}) => { const p = new URL(String(u)).pathname, ok = (v: unknown, st = 200) => new Response(JSON.stringify(v), { status: st, headers: { "content-type": "application/json" } }); if (p === "/domains" && init.method === "POST") DNS.name = JSON.parse(String(init.body)).Name; if (init.method === "DELETE") return ok({});
      return ok({ ID: 7, Name: DNS.name, DKIMVerified: DNS.found, DKIMPendingHost: "pm._domainkey." + DNS.name, DKIMPendingTextValue: "k=rsa; p=MIGf", ReturnPathDomain: "pm-bounces." + DNS.name, ReturnPathDomainCNAMEValue: "pm.mtasv.net", ReturnPathDomainVerified: DNS.found }); }) as unknown as typeof fetch, dnsTxt: async () => (DNS.found ? [["v=DMARC1; p=none;"]] : []),
    // A stand-in for Stripe: it hands back the address of a payment page, which the tests never visit.
    stripe: (async (u: unknown) => new Response(JSON.stringify({ id: "x_1", url: String(u).includes("portal") ? "https://billing.stripe.com/p/session/x_1" : "https://checkout.stripe.com/c/pay/x_1" }), { status: 200, headers: { "content-type": "application/json" } })) as unknown as typeof fetch,
    // A stand-in for Google's token service, enough to connect and disconnect a drive.
    google: (async (u: unknown, init: RequestInit = {}) => { const p = new URLSearchParams(String(init.body || "")), ok = (v: unknown) => new Response(JSON.stringify(v), { status: 200, headers: { "content-type": "application/json" } }); return String(u).includes("/token") ? ok(p.get("grant_type") === "authorization_code" ? { access_token: "a1", refresh_token: "r1", expires_in: 3600, scope: "https://www.googleapis.com/auth/drive.file" } : { access_token: "a2", expires_in: 3600 }) : ok({}); }) as unknown as typeof fetch,
    // A stand-in for Ask the Hound's model: it uses the real look-up, then answers from what came back.
    converse: { async converse(c) { const q = c.messages.at(-1)!.text; if (/advice/i.test(q)) throw Object.assign(new Error("busy"), { code: "busy" }); const L = c.run("find_clients", {}) as { name: string }[]; return L.length + " on your list: " + L.map((x) => x.name).join(", ") + "."; } } });
  await H.server.listen({ port, host: "127.0.0.1" });
  browser = browser || (await chromium.launch());
  const pages: Page[] = [], errors: string[] = [];
  // A person at their desk: signs in through the real screens, authenticator and all.
  async function signIn(email: string, viewport = { width: 1280, height: 900 }): Promise<Page> {
    const ctx = await browser!.newContext({ viewport, deviceScaleFactor: +(process.env.SHOT_SCALE || 1) }), page = await ctx.newPage(); pages.push(page);
    await page.clock.install({ time: H.clock() });   // the browser's clock agrees with the server's, as it would in real life
    // A refused request (a 4xx) is an answer, not a fault. A blocked script or style is reported differently and is kept.
    page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource: the server responded with a status of 4\d\d/.test(m.text())) errors.push(m.text()); }); page.on("pageerror", (e) => errors.push(String(e)));
    page.on("dialog", (d) => { errors.push("a dialog opened: " + d.message()); void d.dismiss(); });
    await page.goto(url + "/"); await page.waitForURL("**/signin"); await page.fill("#email", email); await page.keyboard.press("Enter"); await page.getByText("Check your email").waitFor();
    await page.goto(H.links.filter((l) => l.to === email).pop()!.url);
    const first = await Promise.race([page.locator("#setup-code").waitFor().then(() => true), page.locator("#code").waitFor().then(() => false)]);
    if (first) { H.secrets.set(email, H.unbase32((await page.locator(".secret").textContent())!.replace(/\s/g, ""))); await page.fill("#setup-code", kitAuth.totp(H.secrets.get(email)!, H.clock())); await page.keyboard.press("Enter"); await page.getByText("Save your recovery codes").waitFor(); await page.getByRole("button", { name: /I have saved them/ }).click(); }
    else { H.advance(31); await page.clock.setFixedTime(H.clock()); await page.fill("#code", H.codeFor(email)); await page.keyboard.press("Enter"); }
    await page.locator(".side .firm").waitFor(); return page;
  }
  const state = async (firmId: string): Promise<Engine> => { const T = createEngine(); T.load(await H.store.readState(firmId)); return T; };
  return Object.assign(H, { url, signIn, state, errors, reading, CLEAN_W2, async end() { for (const p of pages) await p.context().close(); await H.close(); } });
}
export const DNS = { name: "", found: false };
export type World = Awaited<ReturnType<typeof world>>;
export async function closeBrowser() { if (browser) await browser.close(); browser = null; }

// A firm in the middle of its season: three clients on Autopilot. Jo has sent a W-2 and said she has no mortgage statement;
// Sam has been invited; Ana has not been started; and a stranger has written in.
export async function busyFirm(W: World) {
  const { firmId, ownerId } = await W.newFirm();
  await W.app.staff(firmId, ownerId, (T: Engine) => { T.S.firm.hound.mode = "autopilot"; T.S.firm.senderStatus = "approved"; T.S.firm.phone = "(615) 555-0100";
    T.importRows(T.parseCSV("First,Last,Email,Mobile\nJo,Day,jo@x.example,6155550111\nSam,Lee,sam@x.example,6155550122\nAna,Ruiz,ana@x.example,"));
    const [jo, sam] = T.S.engs; T.itemsOf(jo.id).find((i: { form: string }) => i.form === "W2").payer = "Acme Logistics";
    jo.confirmed = true; T.start(jo.id); T.giveConsent(T.S.clients[0].id, "page"); sam.confirmed = true; T.start(sam.id); });
  await W.app.inboundSms({ to: "+16155550101", from: "+16155550111", body: "", media: [{ bytes: JPEG, contentType: "image/jpeg" }], providerId: "e1" });
  await W.app.inboundSms({ to: "+16155550101", from: "+16155550111", body: "I don't have a mortgage statement this year", media: [], providerId: "e2" });
  await W.app.inboundEmail({ to: "test1@docs.tallyhound.test", from: "stranger@example.org", body: "Is this the right address for my forms?", attachments: [], providerId: "e3", trusted: true });
  return { firmId, ownerId };
}
// The same firm with one more photo from Jo that the model was not sure about, so a document is waiting for a person.
export async function busyFirmWithDoubt(W: World) {
  const r = await busyFirm(W); W.reading.doc = { ...W.CLEAN_W2, payer: "Bluebird Cafe", confidence: 0.55, note: "Probably a W-2, partly in shadow" };
  await W.app.inboundSms({ to: "+16155550101", from: "+16155550111", body: "", media: [{ bytes: PHOTO, contentType: "image/jpeg" }], providerId: "doubt1" }); W.reading.doc = W.CLEAN_W2; return r;
}

// One browser test. Whatever happens, the server and the browser pages are closed, so a failure is reported instead of hanging the run;
// and every test ends by checking that the browser logged no error (a blocked script or style would show up there).
export function scene(title: string, fn: (W: World) => Promise<void>) {
  test(title, { timeout: 180000 }, async () => { const W = await world(); try { await fn(W); assert.deepEqual(W.errors, [], "the browser reported errors"); } finally { await W.end(); } });
}
