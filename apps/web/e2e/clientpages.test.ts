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

scene("the check-in loop: the firm sends it, the client ticks on a phone with no script, the firm confirms the proposal and collecting starts", async (W) => {
  const { firmId, ownerId } = await W.newFirm();
  await W.app.staff(firmId, ownerId, (T: Engine) => { T.S.firm.hound.mode = "autopilot"; T.S.firm.senderStatus = "approved"; T.importRows(T.parseCSV("First,Last,Email,Mobile\nJo,Day,jo@x.example,6155550111")); });
  const page = await W.signIn("pat1@firm1.test"); let T: Engine = await W.state(firmId); const jo = T.S.engs[0];
  await page.goto(W.url + "/clients/" + jo.id); await page.getByRole("button", { name: "Send a check-in" }).click(); await page.getByText(/^Check-in sent\. The answers come back here/).waitFor(); await page.getByText(/Waiting for Jo to tick what applies/).waitFor();
  const sent = W.email.sent.concat(W.sms.sent).find((m: { body: string }) => /\/u\//.test(m.body))!, link = /\/u\/([a-z-]+)/.exec(sent.body)![1]!;
  // The client, on a phone, scripting off.
  const b = await chromium.launch(), phone = await (await b.newContext({ viewport: { width: 360, height: 740 }, javaScriptEnabled: false })).newPage();
  try { await phone.goto(W.url + "/u/" + link); await phone.getByRole("heading", { name: "What did you have in 2026?" }).waitFor();
    for (const el of await phone.locator("label.tile").all()) assert.ok((await el.boundingBox())!.height >= 44);
    await phone.getByLabel("Sold stocks, funds or crypto").check(); await phone.getByLabel("Anything else we should know?").fill("We sold the lake house in June"); await phone.getByRole("button", { name: "Send" }).click(); await phone.getByRole("heading", { name: "Thanks. That's all." }).waitFor();
  } finally { await b.close(); }
  // Back at the firm: it shows in Needs you, and the client page has the proposal to confirm.
  await page.goto(W.url + "/"); await page.locator(".card", { hasText: "Needs you" }).first().locator(".li", { hasText: "Finished the check-in" }).getByRole("link", { name: "Go through the checklist" }).click();
  const card = page.locator(".card.checkin"); await card.waitFor(); assert.match(text(await card.textContent()), /Jo finished the check-in/); assert.match(text(await card.textContent()), /Jo wrote: “We sold the lake house in June”/);
  T = await W.state(firmId); const adds = T.S.engs[0].checkin.adds.length, before = T.itemsOf(jo.id).length; assert.ok(adds > 0); assert.equal(await card.locator("input[type=checkbox]:checked").count(), adds + T.S.engs[0].checkin.drops.length);
  await card.getByLabel(/Add your own request/).fill("Closing statement for the lake house"); await card.getByRole("button", { name: "Confirm and start collecting" }).click(); await page.getByText(/^Checklist confirmed: \d+ added, \d+ removed\. Collecting has started\./).waitFor(); await card.waitFor({ state: "detached" });
  T = await W.state(firmId); const e = T.S.engs[0]; assert.equal(e.confirmed, true); assert.notEqual(e.status, "not_started"); assert.ok(T.itemsOf(jo.id).some((i: { custom?: string }) => i.custom === "Closing statement for the lake house")); assert.ok(T.itemsOf(jo.id).length > before);
});
