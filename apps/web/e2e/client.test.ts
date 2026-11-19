// One client's page: checklist, suggested, documents, conversation, details (T-16, T-18, T-90, docs/UX.md rule 9).
import { after } from "node:test";
import assert from "node:assert/strict";
import { busyFirm, closeBrowser, JPEG, scene } from "./world.ts";
import type { Engine } from "../../server/src/kit.ts";

after(closeBrowser);
const text = (s: string | null) => (s || "").replace(/\s+/g, " ").trim();
type E = { id: string; clientId: string; status: string; confirmed?: boolean };
const engOf = (T: Engine, first: string): E => T.S.engs.find((e: E) => T.client(e.clientId).first === first);

scene("T-18: in Copilot nothing reaches a phone until Approve is pressed, and what is approved is what goes", async (W) => {
  const { firmId, ownerId } = await W.newFirm();
  await W.app.staff(firmId, ownerId, (T: Engine) => { T.S.firm.senderStatus = "approved"; T.importRows(T.parseCSV("First,Last,Email,Mobile\nJo,Day,jo@x.example,6155550111")); const e = T.S.engs[0]; e.confirmed = true; T.giveConsent(T.S.clients[0].id, "page"); });
  const page = await W.signIn("pat1@firm1.test"), T0: Engine = await W.state(firmId), jo = T0.S.engs[0]; assert.equal(T0.S.firm.hound.mode, "copilot");
  const before = W.sms.sent.length; await page.goto(W.url + "/clients/" + jo.id); await page.getByRole("button", { name: "Start collecting" }).click(); await page.getByText(/^Collecting started/).waitFor();
  await page.getByRole("tab", { name: /Conversation/ }).click(); const draft = page.getByLabel(/^Draft:/); await draft.waitFor();
  assert.equal(W.sms.sent.length, before, "the first request is a draft, not a text"); assert.match(text(await page.locator(".convo").textContent()), /Draft waiting for you/);
  const body = await draft.inputValue(); assert.match(body, /Jo/); await draft.fill(body.replace("Hi Jo", "Hello Jo")); await page.getByRole("button", { name: "Approve and send" }).click(); await draft.waitFor({ state: "detached" });
  assert.equal(W.sms.sent.length, before + 1); assert.ok(W.sms.sent.at(-1)!.body.startsWith("Hello Jo"), "the edited wording is what was sent"); assert.equal(W.sms.sent.at(-1)!.to, "6155550111");
  // A staff message with an advice word is stopped before Send, by the engine's own check.
  const box = page.getByLabel("Write to Jo"); await box.fill("You will get a big refund this year"); assert.match(text(await page.locator(".warnline").textContent()), /Will not send: blocked word "refund"/); assert.equal(await page.getByRole("button", { name: "Send", exact: true }).isDisabled(), true);
  await box.fill("Thanks Jo, call the office if you get stuck."); await page.getByRole("button", { name: "Send", exact: true }).click(); await page.getByText("Sent.", { exact: true }).waitFor();
  assert.equal(W.sms.sent.length, before + 2, "a message a person writes goes at once"); assert.match(text(await page.locator(".bub.man").last().textContent()), /Thanks Jo/);
  // A second draft can be thrown away, and then nothing goes.
  await W.app.inboundSms({ to: "+16155550101", from: "+16155550111", body: "I don't have a mortgage statement", media: [], providerId: "c1" }); await page.reload(); await page.getByRole("tab", { name: /Conversation/ }).click();
  const n = W.sms.sent.length; if (await page.getByRole("button", { name: "Discard" }).count()) { await page.getByRole("button", { name: "Discard" }).first().click(); await page.getByText("Draft discarded.").waitFor(); assert.equal(W.sms.sent.length, n); }
});

scene("the checklist can be changed the ways a preparer needs, and every change is the engine's", async (W) => {
  const { firmId } = await busyFirm(W), page = await W.signIn("pat1@firm1.test"); let T: Engine = await W.state(firmId); const ana = engOf(T, "Ana");
  await page.goto(W.url + "/clients/" + ana.id); await page.locator(".tabs").waitFor();
  assert.match(text(await page.locator("h1").textContent()), /Ana Ruiz/); assert.match(text(await page.locator(".note").first().textContent()), /has not been confirmed/);
  const before = T.itemsOf(ana.id).length;
  await page.getByLabel("Document", { exact: true }).selectOption("1099INT"); await page.getByLabel("Who it comes from").fill("First Farmers Bank"); await page.getByRole("button", { name: "Add to checklist" }).click(); await page.getByText("First Farmers Bank").waitFor();
  T = await W.state(firmId); assert.equal(T.itemsOf(ana.id).length, before + 1);
  // Waive it with a reason (docs/UX.md rule 9: it says what it affects), then restore it.
  const row = page.locator(".li", { hasText: "First Farmers Bank" }); await row.getByRole("button", { name: /^Actions for/ }).click(); await page.getByRole("button", { name: "Not needed this year" }).click();
  const dlg = page.getByRole("dialog", { name: "Not needed this year" }); assert.match(text(await dlg.textContent()), /comes off what Ana is asked for/); await dlg.getByLabel("Reason, for the file").fill("Account closed in 2025"); await dlg.getByRole("button", { name: "Waive" }).click();
  await row.getByText(/Not needed · .*Account closed in 2025/).waitFor(); T = await W.state(firmId); assert.equal(T.itemsOf(ana.id).find((i: { payer: string }) => i.payer === "First Farmers Bank").state, "waived");
  await row.getByRole("button", { name: /^Actions for/ }).click(); await page.getByRole("button", { name: "Restore" }).click(); await row.getByText(/Not requested yet/).waitFor();
  await row.getByRole("button", { name: /^Actions for/ }).click(); await page.getByRole("button", { name: "Remove from checklist" }).click(); await row.waitFor({ state: "detached" });
  // Confirm, then start from the card beside the checklist.
  await page.getByRole("button", { name: "Confirm checklist" }).first().click(); await page.getByRole("button", { name: "Start collecting" }).waitFor(); await page.getByRole("button", { name: "Start collecting" }).click(); await page.getByText(/^Collecting started/).waitFor();
  T = await W.state(firmId); assert.equal(engOf(T, "Ana").confirmed, true); assert.notEqual(engOf(T, "Ana").status, "not_started");
  await page.getByRole("tab", { name: "Activity" }).click(); await page.locator(".split .li", { hasText: "Checklist confirmed" }).waitFor(); await page.locator(".split .li", { hasText: "Collecting started" }).waitFor();
  await page.goto(W.url + "/clients/nobody"); await page.getByText("That client is not on your list.").waitFor();
});

scene("T-90: a document added by staff is checked like any other, shown with its three checks, and the client hears nothing", async (W) => {
  const { firmId } = await busyFirm(W), page = await W.signIn("pat1@firm1.test"), T0: Engine = await W.state(firmId), jo = engOf(T0, "Jo"), sent = W.sms.sent.length + W.email.sent.length;
  await page.goto(W.url + "/clients/" + jo.id + "?tab=documents"); await page.locator(".dcard").first().waitFor(); assert.equal(await page.locator(".dcard").count(), 1);
  const first = page.locator(".dcard").first(); assert.match(text(await first.textContent()), /W-2.*Accepted.*Acme Logistics · 2026.*Right document.*Right information.*Clear to read/);
  const v = T0.verdict(T0.S.docs.find((d: { engId: string }) => d.engId === jo.id)); assert.equal(await first.locator(".dots3 i.ok").count(), [v.doc, v.info, v.clear].filter((x: { ok: boolean }) => x.ok === true).length, "the dots are T.verdict's answers");
  await page.locator('input[type="file"]').setInputFiles({ name: "paper-w2.jpg", mimeType: "image/jpeg", buffer: JPEG }); await page.getByText(/1 document added and checked\. Jo was not messaged\./).waitFor();
  assert.equal(await page.locator(".dcard").count(), 2); assert.equal(W.sms.sent.length + W.email.sent.length, sent);
  const T: Engine = await W.state(firmId); assert.ok(T.S.docs.some((d: { channel: string }) => d.channel === "staff"));
  // The file itself opens for this firm's staff, in a response that cannot run anything.
  const r = await page.request.get(W.url + "/api/documents/" + T0.S.docs.find((d: { engId: string }) => d.engId === jo.id).id + "/file"); assert.equal(r.status(), 200); assert.equal(r.headers()["content-type"], "image/jpeg"); assert.match(r.headers()["content-security-policy"]!, /sandbox/);
  await page.locator('input[type="file"]').setInputFiles({ name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("hello") }); await page.getByText(/Not added: notes\.txt/).waitFor();
});

scene("details: a changed mobile number turns texts off until the client agrees again, and deleting documents asks for the last name", async (W) => {
  const { firmId } = await busyFirm(W), page = await W.signIn("pat1@firm1.test"); let T: Engine = await W.state(firmId); const jo = engOf(T, "Jo");
  await page.goto(W.url + "/clients/" + jo.id + "?tab=details"); assert.match(text(await page.locator(".card", { hasText: "OK to text" }).last().textContent()), /Given \(page\)/);
  await page.getByLabel("Mobile").fill("(615) 555-0199"); await page.getByText(/turns texts off for Jo until they agree again/).waitFor(); await page.getByLabel(/Private staff notes/).fill("Prefers mornings"); await page.getByRole("button", { name: "Save changes" }).click(); await page.getByText("Saved.", { exact: true }).waitFor();
  T = await W.state(firmId); const c = T.S.clients[0]; assert.equal(c.mobile, "6155550199"); assert.equal(c.textConsent, "none"); assert.equal(c.notes, "Prefers mornings"); assert.ok(c.consentLog.some((l: { what: string }) => /Reset/.test(l.what)));
  await page.getByText("Not OK to text yet").waitFor();
  // docs/UX.md rule 9: nothing irreversible without a clear warning.
  await page.getByRole("button", { name: "More actions" }).click(); await page.getByRole("button", { name: "Delete this client's documents" }).click(); const dlg = page.getByRole("dialog"); assert.match(text(await dlg.textContent()), /This cannot be undone/);
  const go = dlg.getByRole("button", { name: "Delete for good" }); assert.equal(await go.isDisabled(), true); await dlg.getByLabel(/last name/).fill("Smith"); assert.equal(await go.isDisabled(), true); await dlg.getByLabel(/last name/).fill("day"); await go.click(); await page.getByText("Documents deleted.").waitFor();
  T = await W.state(firmId); assert.ok(T.S.docs.filter((d: { engId: string }) => d.engId === jo.id).every((d: { state: string; fileKey?: string }) => d.state === "purged" || !d.fileKey));
});
