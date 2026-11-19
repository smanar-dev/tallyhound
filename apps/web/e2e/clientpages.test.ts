// The client's own pages in a phone-sized browser with scripting switched off: they must work as plain forms.
import { after } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { closeBrowser, PHOTO, scene } from "./world.ts";
import type { Engine } from "../../server/src/kit.ts";

after(closeBrowser);
const text = (s: string | null) => (s || "").replace(/\s+/g, " ").trim();

scene("a client on a phone with no script agrees to texts, then sends a photo from the upload page", async (W) => {
  const { firmId, ownerId } = await W.newFirm();
  await W.app.staff(firmId, ownerId, (T: Engine) => { T.S.firm.hound.mode = "autopilot"; T.S.firm.senderStatus = "approved"; T.S.firm.phone = "(615) 555-0100"; T.importRows(T.parseCSV("First,Last,Email,Mobile\nJo,Day,jo@x.example,6155550111")); const e = T.S.engs[0]; T.itemsOf(e.id).find((i: { form: string }) => i.form === "W2").payer = "Acme Logistics"; e.confirmed = true; T.start(e.id); });
  const link = /go\.tallyhound\.test\/c\/(\S+?)[.\s]/.exec(W.email.sent.find((m: { to: string }) => m.to === "jo@x.example")!.body)![1]!;
  const b = await chromium.launch(), ctx = await b.newContext({ viewport: { width: 360, height: 740 }, javaScriptEnabled: false, deviceScaleFactor: +(process.env.SHOT_SCALE || 1) }), page = await ctx.newPage(), errors: string[] = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  try {
    await page.goto(W.url + "/c/" + link); assert.equal(text(await page.locator("h1").textContent()), "Send your tax documents by text");
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth).catch(() => true), true);
    for (const el of await page.locator("button, input[type=tel]").all()) assert.ok((await el.boundingBox())!.height >= 44, "every tap target is at least 44 px tall");
    if (process.env.SHOT_DIR) await page.screenshot({ path: process.env.SHOT_DIR + "/client-consent.png" });
    const before = W.sms.sent.length; await page.getByRole("button", { name: "Agree" }).click(); await page.getByRole("heading", { name: "You're set" }).waitFor(); assert.equal(W.sms.sent.length, before + 1, "the confirmation text went");
    await page.goto(W.url + "/u/" + link); assert.match(text(await page.locator(".card").textContent()), /We're waiting for ?your W-2 wage statement from Acme Logistics ?and 1 other document\./);
    if (process.env.SHOT_DIR) await page.screenshot({ path: process.env.SHOT_DIR + "/client-upload.png" });
    await page.locator("input[type=file]").setInputFiles({ name: "IMG_0001.jpg", mimeType: "image/jpeg", buffer: PHOTO }); await page.getByRole("button", { name: "Send" }).click();
    await page.getByText(/^Thanks\. We'll check it/).waitFor(); await W.inbox.drain();
    const T: Engine = await W.state(firmId), d = T.S.docs[0]; assert.equal(d.state, "accepted"); assert.equal(d.channel, "portal");
    await page.reload(); assert.match(text(await page.locator(".card").textContent()), /We're waiting for ?your mortgage interest statement/);
    assert.deepEqual(errors, [], "nothing was blocked and nothing failed to load");
  } finally { await b.close(); }
});
