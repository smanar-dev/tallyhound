// The screens added by the Website Feature Delta spec: the follow-up plan (TH-PLN), what Tallyhound understood beside a reply
// (TH-CNV), the sniff trace (TH-SNF), the call card (TH-CAL) and the activity filters (TH-LOG).
import { after } from "node:test";
import assert from "node:assert/strict";
import { busyFirm, busyFirmWithDoubt, closeBrowser, scene } from "./world.ts";
import type { Engine } from "../../server/src/kit.ts";

after(closeBrowser);
const text = (s: string | null) => (s || "").replace(/\s+/g, " ").trim();
const ymd = (d: Date) => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");

scene("TH-PLN: the plan shows what is coming with its exact words; a hold changes it and clears; nothing is sent from it", async (W) => {
  const { firmId, ownerId } = await busyFirm(W); await W.app.staff(firmId, ownerId, (T: Engine) => { T.S.firm.hound.replyV2 = "on"; T.giveConsent(T.S.clients[1].id, "page"); }); await W.worker.pass(); W.advance(600); await W.worker.pass();   // the first request has gone
  let T: Engine = await W.state(firmId); const jo = T.S.engs[0], sam = T.S.engs[1], sent = W.sms.sent.length;
  const page = await W.signIn("pat1@firm1.test"); await page.goto(W.url + "/clients/" + sam.id + "?tab=plan"); await page.getByRole("heading", { name: "Follow-up plan" }).waitFor();
  const grid = page.getByRole("table", { name: "Follow-up plan for Sam" }); assert.ok((await grid.locator(".pm.planned").count()) >= 3, "nothing is planned"); assert.match(text(await page.locator(".pg-legend").textContent()), /request.*reminder.*arrived.*cancelled.*held.*bark to your staff/);
  await grid.locator(".pm.planned").first().click(); const words = text(await page.locator(".planpreview .bub.out").textContent()); assert.match(words, /Sam/); assert.match(text(await page.locator(".planpreview").textContent()), /Nothing can be sent from here/);
  assert.equal(await grid.locator(".pm.quiet.planned").count(), 1, "the plan does not end with a bark to your staff");
  // Hold one document until a date: the asks for it move, and the row says so.
  const day = ymd(new Date(+new Date(T.S.now) + 12 * 86400000));
  await grid.getByRole("button", { name: /^Change when/ }).first().click(); await page.getByLabel("Hold until").fill(day); await page.getByRole("button", { name: "Hold", exact: true }).click(); await page.getByText("Saved. The plan is updated.").waitFor();
  T = await W.state(firmId); const held = T.itemsOf(sam.id).find((i: { holdUntil?: unknown }) => i.holdUntil); assert.ok(held, "no item is held"); assert.equal(T.holdOf(held, T.eng(sam.id)).reason, "staff_date"); await grid.getByText(/held until/).first().waitFor();
  await grid.getByRole("button", { name: /^Change when/ }).first().click(); await page.getByRole("button", { name: "Clear hold" }).click(); await page.getByText("Saved. The plan is updated.").waitFor(); T = await W.state(firmId); assert.ok(!T.itemsOf(sam.id).some((i: { holdUntil?: unknown }) => i.holdUntil));
  assert.equal(W.sms.sent.length, sent, "looking at the plan sent a message");
  // A client waiting on the firm has nothing planned, and the plan says why.
  await page.goto(W.url + "/clients/" + jo.id + "?tab=plan"); await page.getByText(/waiting in the review queue\. Nothing more is sent until it is dealt with/).waitFor(); assert.equal(await page.locator(".pm.quiet").count(), 1, "only the legend shows a bark");
  // What was understood from a reply sits beside it, and the log filters by kind.
  W.reading.text = { intent: "send_after_date", confidence: "high", legacy_intent: "will_send_later", date: "2027-02-15", person: null, change: null, also_document: false, item_id: held.id, later_days: null };
  await W.app.inboundSms({ to: "+16155550101", from: "+16155550122", body: "Can I send it after the 15th?", media: [], providerId: "d1" });
  await page.goto(W.url + "/clients/" + sam.id + "?tab=conversation"); const panel = page.getByRole("group", { name: "What Tallyhound understood" }).last(); await panel.waitFor();
  assert.match(text(await panel.textContent()), /Understood: will send .*What Tallyhound did.*What you need to do/); await panel.getByRole("button", { name: "Details" }).click(); assert.match(text(await panel.textContent()), /Read by/);
  await page.getByRole("tab", { name: "Activity" }).click(); await page.getByRole("button", { name: "Decisions" }).click(); await page.locator(".split .li", { hasText: /wait until/ }).first().waitFor(); assert.equal(await page.locator(".split .li", { hasText: "replied by text" }).count(), 0);
  await page.getByRole("button", { name: "Messages" }).click(); await page.locator(".split .li", { hasText: "Sam replied by text" }).first().waitFor(); assert.match(text(await page.locator(".split .li", { hasText: "Sam replied by text" }).first().textContent()), /Sam \(client\)/);
  await page.goto(W.url + "/clients/" + jo.id + "?tab=activity"); await page.getByRole("button", { name: "Documents", exact: true }).click(); await page.locator(".split .li", { hasText: /arrived as a photo by text/ }).first().waitFor();
});

scene("TH-SNF, TH-CAL: a document in the queue shows its sniff trace; a call that reached voicemail needs a day, and the card comes back that morning", async (W) => {
  const { firmId, ownerId } = await busyFirmWithDoubt(W); await W.app.staff(firmId, ownerId, (T: Engine) => { T.giveConsent(T.S.clients[1].id, "page"); });
  const page = await W.signIn("pat1@firm1.test"); await page.goto(W.url + "/needs-you?show=document"); const trace = page.locator("details.trace").first(); await trace.waitFor();
  assert.equal(await trace.locator("li").count(), 8); assert.match(text(await trace.textContent()), /Sniff trace.*1\. Saved as the original.*2\. Which form is it\?.*8\. Second reading/);
  for (let d = 0; d < 17; d++) { W.advance(24 * 3600); await W.worker.pass(); }
  let T: Engine = await W.state(firmId); const sam = T.S.engs[1]; assert.equal(sam.status, "stuck");
  const p2 = await W.signIn("pat1@firm1.test"); await p2.goto(W.url + "/needs-you?show=gone_quiet"); const pane = p2.locator(".rq > div").nth(1); await pane.getByText("Sam has gone quiet.").waitFor();
  assert.match(text(await pane.textContent()), /Who to call\s*Sam Lee.*Still missing.*Already in/); const log = pane.getByRole("button", { name: "Log the call" }); assert.equal(await log.isDisabled(), true);
  await pane.getByLabel("What happened").selectOption("voicemail"); assert.equal(await log.isDisabled(), true, "a voicemail can be logged with no day to try again");
  const again = new Date(+new Date(T.S.now) + 3 * 86400000); await pane.getByLabel("Try again on").fill(ymd(again)); await pane.getByLabel(/^Note/).fill("Left a message with her son"); await log.click(); await p2.getByText(/^Call logged\. The card comes back/).waitFor();
  T = await W.state(firmId); const t = T.S.tasks.find((x: { kind: string; engId: string }) => x.kind === "gone_quiet" && x.engId === sam.id); assert.equal(t.status, "open"); assert.equal(new Date(t.snoozedUntil).getHours(), 9); assert.equal(t.calls.length, 1);
  await p2.goto(W.url + "/needs-you?show=gone_quiet"); await p2.getByRole("button", { name: /^Gone quiet\s*0$/ }).waitFor();
  for (let d = 0; d < 4; d++) { W.advance(24 * 3600); await W.worker.pass(); }
  const p3 = await W.signIn("pat1@firm1.test"); await p3.goto(W.url + "/needs-you?show=gone_quiet"); await p3.locator(".rq > div").nth(1).getByText("Sam has gone quiet.").waitFor(); assert.match(text(await p3.locator(".rq > div").nth(1).textContent()), /left a voicemail\. Left a message with her son/);
});

scene("TH-BRK-13, 14: an owner marks the office manager under People, and gone quiet then goes to them", async (W) => {
  const { firmId, ownerId } = await busyFirm(W); const page = await W.signIn("pat1@firm1.test");
  await page.goto(W.url + "/settings?tab=people"); await page.getByRole("button", { name: "Add a person" }).click(); const dlg = page.getByRole("dialog"); await dlg.getByLabel("Name").fill("Alex Staff"); await dlg.getByLabel("Work email").fill("alex@firm1.test"); await dlg.getByRole("button", { name: "Add", exact: true }).click(); await dlg.waitFor({ state: "detached" });
  let T: Engine = await W.state(firmId); const alexId = T.S.users.find((u: { name: string }) => u.name === "Alex Staff").id;
  await page.goto(W.url + "/settings?tab=barks"); await page.getByText(/Nobody is marked as office manager yet/).waitFor(); assert.deepEqual(T.barkRoute({ kind: "gone_quiet", engId: T.S.engs[0].id }), [ownerId]);
  await page.goto(W.url + "/settings?tab=people"); await page.locator("label.toggle", { has: page.getByLabel("Alex Staff is the office manager") }).click(); await page.getByText("Alex Staff now hears what you send to the office manager.").waitFor();
  T = await W.state(firmId); assert.deepEqual(T.barkRoute({ kind: "gone_quiet", engId: T.S.engs[0].id }), [alexId]); assert.deepEqual(T.barkRoute({ kind: "cant_reach", engId: T.S.engs[0].id }), [alexId]);
  await page.goto(W.url + "/settings?tab=barks"); await page.getByText("Office manager: Alex Staff.").waitFor(); assert.equal(await page.getByLabel("Who hears: Gone quiet").inputValue(), "front_desk");
});
