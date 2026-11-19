// A whole Tallyhound for one browser test: the real web service on a local port (in memory), the built web app, and a real browser.
import net from "node:net";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import assert from "node:assert/strict";
import { chromium, type Browser, type Page } from "playwright";
import { build } from "../../server/test/harness.ts";
import { createEngine, kitAuth, kitMemory, type Engine } from "../../server/src/kit.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
if (!existsSync(join(HERE, "../dist/index.html"))) throw new Error("Build the web app first: npm run build");
const freePort = () => new Promise<number>((ok, fail) => { const s = net.createServer(); s.on("error", fail); s.listen(0, "127.0.0.1", () => { const p = (s.address() as net.AddressInfo).port; s.close(() => ok(p)); }); });
let browser: Browser | null = null;
export const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(4000, 7)]);
// The kit's stand-in model: a clean W-2 for Jo Day, and plain readings of texts and emails.
const model = () => kitMemory.fakeAI((p: string) => p.startsWith("You read photos") ? { is_tax_document: true, form: "W2", tax_year: 2026, payer: "Acme Logistics", recipient_name: "JO DAY", legibility: 0.95, confidence: 0.97, missing_parts: [], note: "A W-2" }
  : p.startsWith("You read text messages") ? { intent: "says_none", item_id: null, summary: "does not have it", scope: "documents", sentiment: "calm", topics: [] } : null);

export async function world() {
  const port = await freePort(), url = "http://127.0.0.1:" + port, H = await build("memory", { ai: model(), appUrl: url });
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
  return Object.assign(H, { url, signIn, state, errors, async end() { for (const p of pages) await p.context().close(); await H.close(); } });
}
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

// One browser test. Whatever happens, the server and the browser pages are closed, so a failure is reported instead of hanging the run;
// and every test ends by checking that the browser logged no error (a blocked script or style would show up there).
export function scene(title: string, fn: (W: World) => Promise<void>) {
  test(title, { timeout: 180000 }, async () => { const W = await world(); try { await fn(W); assert.deepEqual(W.errors, [], "the browser reported errors"); } finally { await W.end(); } });
}
