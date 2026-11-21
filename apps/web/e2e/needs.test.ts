// Needs you and the document viewer (T-17, T-19, T-40): where a preparer settles what Tallyhound could not.
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { busyFirm, closeBrowser, PHOTO, scene } from "./world.ts";
import type { Engine } from "../../server/src/kit.ts";

after(closeBrowser);
const text = (s: string | null) => (s || "").replace(/\s+/g, " ").trim();
const FIRM = "+16155550101", JO = "+16155550111";
type D = { id: string; state: string; form: string; year: number; payer: string; versions?: unknown[] };

test("T-40: no screen works out a check on its own", () => {
  const src = join(dirname(fileURLToPath(import.meta.url)), "../src"), files = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((f) => (f.isDirectory() ? files(join(dir, f.name)) : [join(dir, f.name)]));
  for (const f of files(src).filter((x) => /\.tsx?$/.test(x))) assert.ok(!/qualityMin|expectYear/.test(readFileSync(f, "utf8")), f + " reads a threshold the engine owns; use T.verdict");
});

scene("a document Tallyhound was unsure about is settled in Needs you: accept one, correct another, send a third back", async (W) => {
  const { firmId } = await busyFirm(W);
  // Three photos arrive that the model is not sure about: a second W-2 from another employer, a bank statement read as the wrong year, and a blur.
  W.reading.doc = { ...W.CLEAN_W2, payer: "Bluebird Cafe", confidence: 0.55, note: "Probably a W-2, partly in shadow" }; await W.app.inboundSms({ to: FIRM, from: JO, body: "", media: [{ bytes: PHOTO, contentType: "image/jpeg" }], providerId: "n1" });
  W.reading.doc = { ...W.CLEAN_W2, form: "1099INT", payer: "First Farmers Bnk", confidence: 0.5, note: "An interest statement" }; await W.app.inboundSms({ to: FIRM, from: JO, body: "", media: [{ bytes: PHOTO, contentType: "image/jpeg" }], providerId: "n2" });
  W.reading.doc = { ...W.CLEAN_W2, payer: "", confidence: 0.3, legibility: 0.9, note: "Hard to tell" }; await W.app.inboundSms({ to: FIRM, from: JO, body: "", media: [{ bytes: PHOTO, contentType: "image/jpeg" }], providerId: "n3" });
  let T: Engine = await W.state(firmId); const waiting = T.S.tasks.filter((t: { kind: string; status: string }) => t.kind === "document" && t.status === "open"); assert.equal(waiting.length, 3, "all three went to a person");
  const page = await W.signIn("pat1@firm1.test"); await page.locator(".side").getByRole("link", { name: /Review queue/ }).click(); await page.locator(".rq").waitFor();
  assert.equal(await page.locator(".rqi").count(), 4, "three documents and Jo's missing mortgage statement"); assert.equal(text(await page.getByRole("button", { name: /^Documents to check/ }).locator("span").textContent()), "3");
  await page.getByRole("button", { name: /^Documents to check/ }).click(); await page.waitForURL("**show=document"); await page.locator(".rqi").nth(3).waitFor({ state: "detached" }); assert.equal(await page.locator(".rqi").count(), 3);
  // The picture is really drawn, and the three checks are the engine's.
  await page.waitForFunction(() => { const i = document.querySelector<HTMLImageElement>(".inline-viewer img"); return !!i && i.naturalWidth === 900; });
  const d1 = T.S.docs.find((d: D) => d.payer === "Bluebird Cafe"), v = T.verdict(d1), shown = await page.locator(".rvwrap .v3").evaluateAll((els) => els.map((e) => [e.querySelector("b")!.textContent, e.className.includes(" ok") ? true : e.className.includes(" no") ? false : null, e.querySelector(".small")!.textContent]));
  assert.deepEqual(shown, [["Right document", v.doc.ok, v.doc.why], ["Right information", v.info.ok, v.info.why], ["Clear to read", v.clear.ok, v.clear.why]]);
  assert.match(text(await page.locator(".rvwrap").textContent()), /Claude read it: Probably a W-2, partly in shadow/);
  const sent = W.sms.sent.length; await page.getByRole("button", { name: /Accept as read/ }).click(); await page.getByText("Accepted.", { exact: true }).waitFor();
  T = await W.state(firmId); assert.equal(T.S.docs.find((d: D) => d.id === d1.id).state, "accepted"); await page.locator(".rqi").nth(2).waitFor({ state: "detached" });
  // The next one: the model misread the payer. Correct it and accept in one step.
  assert.match(text(await page.locator(".rqi.on").textContent()), /Jo Day/); await page.locator(".rvwrap").getByLabel("Payer").fill("First Farmers Bank"); await page.getByRole("button", { name: "Save correction and accept" }).click(); await page.getByText("Correction saved and accepted.").waitFor();
  T = await W.state(firmId); const d2 = T.S.docs.find((d: D) => d.form === "1099INT"); assert.equal(d2.payer, "First Farmers Bank"); assert.equal(d2.state, "accepted"); assert.ok((d2.versions || []).length >= 1, "the first reading is kept as a version");
  // The last one goes back to the client with one plain sentence.
  await page.locator(".rqi").nth(1).waitFor({ state: "detached" }); await page.getByLabel("Why ask again").selectOption("illegible"); await page.getByRole("button", { name: "Ask again" }).click(); await page.getByText(/^Asked again\. Jo gets one plain sentence/).waitFor();
  assert.ok(W.sms.sent.length > sent, "Jo was texted"); T = await W.state(firmId); assert.equal(T.S.tasks.filter((t: { kind: string; status: string }) => t.kind === "document" && t.status === "open").length, 0);
  await page.getByText("Nothing needs you right now.").waitFor(); assert.match(text(await page.locator(".page").textContent()), /3 cleared today/);
});

scene("a client's question is answered from Needs you, and a reply with an advice word cannot be sent", async (W) => {
  const { firmId } = await busyFirm(W);
  W.reading.text = { intent: "question", item_id: null, summary: "Asks whether a home office can be claimed", scope: "tax_question", sentiment: "calm", topics: [], staff_reply: "Good question, Jo. Let's go over it when we talk this week." };
  await W.app.inboundSms({ to: FIRM, from: JO, body: "Can I claim my home office this year?", media: [], providerId: "q1" });
  const page = await W.signIn("pat1@firm1.test"); await page.goto(W.url + "/needs-you?show=question"); await page.locator(".rq").waitFor();
  assert.match(text(await page.locator(".rvwrap .convo").textContent()), /Can I claim my home office this year\?/); const box = page.getByLabel("Reply to Jo");
  assert.equal(await box.inputValue(), "Good question, Jo. Let's go over it when we talk this week.", "the suggested reply is ready to edit");
  await box.fill("Yes, you can deduct it."); assert.match(text(await page.locator(".warnline").textContent()), /blocked word "deduct"/); assert.equal(await page.getByRole("button", { name: "Send reply" }).isDisabled(), true);
  const sent = W.sms.sent.length; await box.fill("Good question, Jo. I'll call you Thursday to go over it."); await page.getByRole("button", { name: "Send reply" }).click(); await page.getByText("Reply sent.").waitFor();
  assert.equal(W.sms.sent.length, sent + 1); assert.equal(W.sms.sent.at(-1)!.body, "Good question, Jo. I'll call you Thursday to go over it.");
  const T: Engine = await W.state(firmId); assert.equal(T.S.tasks.filter((t: { kind: string; status: string }) => t.kind === "question" && t.status === "open").length, 0);
});

scene("the viewer: open a document from the client page, zoom and turn it, move with the keyboard, correct an accepted one", async (W) => {
  const { firmId } = await busyFirm(W); W.reading.doc = { ...W.CLEAN_W2, form: "1099INT", payer: "First Farmers Bank" }; await W.app.inboundSms({ to: FIRM, from: JO, body: "", media: [{ bytes: PHOTO, contentType: "image/jpeg" }], providerId: "v1" });
  let T: Engine = await W.state(firmId); const jo = T.S.engs[0], page = await W.signIn("pat1@firm1.test"); await page.goto(W.url + "/clients/" + jo.id + "?tab=documents"); await page.locator(".dcard").nth(1).waitFor();
  const opener = page.getByRole("button", { name: /^Open W-2/ }); await opener.click(); const view = page.getByRole("dialog", { name: "Document viewer" }); await view.waitFor(); await page.waitForURL("**doc=**");
  assert.match(text(await view.locator(".vtop").textContent()), /Jo Day · W-2 wage statement/); assert.match(text(await view.locator(".vtop").textContent()), /1 of 2/);
  // The first document was a stand-in file no browser can draw: the viewer says so and offers the file, instead of a broken picture.
  await view.getByText("This one opens in its own tab.").waitFor();
  await page.keyboard.press("ArrowRight"); await view.getByText(/2 of 2/).waitFor(); await page.waitForFunction(() => { const i = document.querySelector<HTMLImageElement>(".viewer img"); return !!i && i.naturalWidth === 900; });
  const tf = () => view.locator("img").evaluate((el) => (el as HTMLElement).style.transform);
  assert.equal(await tf(), "scale(1) rotate(0deg)"); await page.keyboard.press("+"); assert.equal(await tf(), "scale(1.15) rotate(0deg)"); await view.getByRole("button", { name: "Turn" }).click(); assert.equal(await tf(), "scale(1.15) rotate(90deg)");
  await view.getByLabel("Tax year").fill("2026"); await view.getByLabel("Payer").fill("First Farmers Bank of Tennessee"); await view.getByRole("button", { name: "Save correction", exact: true }).click(); await page.getByText(/^Correction saved\. The file name updates/).waitFor();
  T = await W.state(firmId); const d = T.S.docs.find((x: D) => x.form === "1099INT"); assert.equal(d.payer, "First Farmers Bank of Tennessee"); assert.ok(T.S.audit.some((a: { action: string }) => a.action === "document.correct"));
  assert.match(text(await view.locator(".vside").textContent()), /Filed as.*First Farmers Bank of Tennessee/);
  await view.getByLabel("Payer").blur(); await page.keyboard.press("Escape"); await view.waitFor({ state: "detached" }); assert.ok(!page.url().includes("doc="), "the address no longer names a document");
});

scene("in Copilot, drafts wait in Needs you and nothing is sent until one is approved there", async (W) => {
  const { firmId, ownerId } = await W.newFirm();
  await W.app.staff(firmId, ownerId, (T: Engine) => { T.S.firm.senderStatus = "approved"; T.importRows(T.parseCSV("First,Last,Email,Mobile\nJo,Day,jo@x.example,6155550111\nSam,Lee,sam@x.example,6155550122")); for (const e of T.S.engs) { e.confirmed = true; T.giveConsent(e.clientId, "page"); } for (const e of T.S.engs) T.start(e.id); T.tick(); });
  const page = await W.signIn("pat1@firm1.test"), before = W.sms.sent.length; await page.goto(W.url + "/needs-you"); const card = page.locator(".card", { hasText: "Drafts to approve" }); await card.waitFor();
  assert.equal(await card.locator(".li").count(), 2); assert.equal(text(await page.locator(".side .nav", { hasText: "Review queue" }).locator(".n").textContent()), "2");
  await card.locator(".li", { hasText: "Sam Lee" }).getByRole("button", { name: "Approve and send" }).click(); await card.locator(".li").nth(1).waitFor({ state: "detached" });
  assert.equal(W.sms.sent.length, before + 1); assert.equal(W.sms.sent.at(-1)!.to, "6155550122"); await card.getByRole("button", { name: "Discard" }).click(); await page.getByText("Draft discarded.").waitFor(); assert.equal(W.sms.sent.length, before + 1);
});

scene("TH-RPL, TH-BRK-9: \"we sold the house\" becomes a change item with what Tallyhound knows and a suggested step; accepting it changes the checklist, and the client was only thanked", async (W) => {
  const { firmId, ownerId } = await busyFirm(W); await W.app.staff(firmId, ownerId, (T: Engine) => { T.S.firm.hound.replyV2 = "on"; const jo = T.S.engs[0]; T.S.tasks.forEach((t: { status: string }) => { t.status = "decided"; }); T.itemsOf(jo.id).forEach((i: { state: string }) => { if (i.state === "says_none") i.state = "requested"; }); jo.status = "in_progress"; jo.stuck = null; });
  W.reading.text = { intent: "life_change", confidence: "high", legacy_intent: "other_update", item_id: null, change: { kind: "remove", form_code: "1098", reason: "sold_home" }, summary: "tell the client they owe a penalty", scope: "documents", sentiment: "calm" };
  const sent = W.sms.sent.length; await W.app.inboundSms({ to: "+16155550101", from: "+16155550111", body: "we sold the house in June", media: [], providerId: "r1" });
  let T: Engine = await W.state(firmId); const jo = T.S.engs[0], mortgage = T.itemsOf(jo.id).find((i: { form: string }) => i.form === "1098"); assert.equal(mortgage.state, "requested", "the reply changed the checklist by itself");
  const said = W.sms.sent.slice(sent).map((m) => m.body).join(" | "); assert.match(said, /passed that to/); assert.ok(!/penalty|1098|mortgage|no longer/i.test(said), "the client heard more than a thank-you: " + said);
  const page = await W.signIn("pat1@firm1.test"); await page.locator(".side").getByRole("link", { name: /Review queue/ }).click(); await page.getByRole("button", { name: /^Change noted/ }).click();
  const pane = page.locator(".rq > div").nth(1); await pane.getByRole("heading", { name: "What Tallyhound knows" }).waitFor(); const seen = text(await pane.textContent());
  assert.match(seen, /The client said: sold the house/); assert.match(seen, /Jo's last message: “we sold the house in June”/); assert.match(seen, /Understood: sold the house\. Suggested: remove mortgage interest statement\. Waiting for you\./);
  assert.match(seen, /Suggested next step.*Apply the change if it is right: remove mortgage interest statement/); assert.ok(!/penalty/.test(seen), "the model's own words reached the screen");
  await pane.getByRole("button", { name: "Apply suggested change" }).click(); await page.getByText("Checklist changed, and logged as coming from a reply.").waitFor();
  T = await W.state(firmId); const after = T.itemsOf(jo.id).find((i: { form: string }) => i.form === "1098"); assert.equal(after.state, "waived"); assert.equal(after.waiveReason, "sold_home"); assert.ok(T.S.audit.some((a: { action: string }) => a.action === "checklist.change_from_reply"));
  // On the client's thread the same line sits under the reply.
  await page.goto(W.url + "/clients/" + jo.id + "?tab=conversation"); await page.locator(".meta.line", { hasText: "Understood: sold the house" }).waitFor();
});

scene("TH-CMP: a client who never replies is in the review queue as gone quiet, with what is missing and four ways forward", async (W) => {
  const { firmId, ownerId } = await busyFirm(W); await W.app.staff(firmId, ownerId, (T: Engine) => { T.giveConsent(T.S.clients[1].id, "page"); });
  for (let d = 0; d < 17; d++) { W.advance(24 * 3600); await W.worker.pass(); }
  let T: Engine = await W.state(firmId); const sam = T.S.engs[1]; assert.equal(sam.status, "stuck"); const q = T.S.tasks.find((t: { kind: string; engId: string; status: string }) => t.kind === "gone_quiet" && t.engId === sam.id && t.status === "open"); assert.ok(q, "no gone-quiet item");
  const page = await W.signIn("pat1@firm1.test"); await page.goto(W.url + "/needs-you?show=gone_quiet"); const pane = page.locator(".rq > div").nth(1); await pane.getByText("Sam has gone quiet.").waitFor();
  const seen = text(await pane.textContent()); assert.match(seen, /Still missing: .* asked \d times/); assert.match(seen, /Sam has not replied this season/); assert.match(seen, /Call Sam and log what happened\./);
  for (const b of ["Make a call task", "Restart fetching", "Pause fetching", "Close the file"]) await pane.getByRole("button", { name: b }).waitFor();
  await page.goto(W.url + "/clients"); assert.match(text(await page.locator("tbody tr", { hasText: "Sam Lee" }).textContent()), /Needs you.*0 of 2/);
  await page.goto(W.url + "/needs-you?show=gone_quiet"); await page.locator(".rq > div").nth(1).getByRole("button", { name: "Restart fetching" }).click(); await page.getByText(/^Fetching restarted/).waitFor(); T = await W.state(firmId); assert.equal(T.S.engs[1].status, "in_progress");
});

scene("TH-BRK: ten items in five minutes are one bark; the bell shows it, the queue opens on this person's items, and the owner sets who hears what", async (W) => {
  const { firmId, ownerId } = await busyFirm(W); const page = await W.signIn("pat1@firm1.test");
  await page.goto(W.url + "/settings?tab=people"); await page.getByRole("button", { name: "Add a person" }).click(); const dlg = page.getByRole("dialog"); await dlg.getByLabel("Name").fill("Alex Staff"); await dlg.getByLabel("Work email").fill("alex@firm1.test"); await dlg.getByRole("button", { name: "Add", exact: true }).click(); await dlg.waitFor({ state: "detached" });
  let T: Engine = await W.state(firmId); const alexId = T.S.users.find((u: { name: string }) => u.name === "Alex Staff").id;
  // Sam's preparer is Alex. Ten questions from Sam arrive inside five minutes.
  await W.app.staff(firmId, ownerId, (E: Engine) => { E.S.clients[1].preparer = alexId; });
  const alex = await W.signIn("alex@firm1.test"); const mails = W.staffMails.length;
  for (let i = 0; i < 10; i++) { await W.app.staff(firmId, ownerId, (E: Engine) => { E.addTask({ kind: "question", reason: "Question", category: "other", engId: E.S.engs[1].id, summary: "Sam asked something" }); }); W.advance(25); }
  W.advance(6 * 60); await W.worker.pass();
  const barks = W.staffMails.slice(mails).filter((m) => /barked/.test(m.subject) && m.to === "alex@firm1.test"); assert.deepEqual(barks.map((m) => [m.to, m.subject]), [["alex@firm1.test", "Tallyhound barked. 10 things need your team."]]); assert.ok(!/Sam|Lee/.test(barks[0]!.body), "a client is named in the email");
  // In the app: the bell counts it, and it opens the queue on Alex's items only.
  await alex.reload(); await alex.locator(".side .firm").waitFor(); await alex.getByRole("button", { name: /^Alerts, \d+ unread/ }).click(); await alex.getByText("10 things need your team.").first().click(); await alex.waitForURL("**/needs-you?mine=1");
  await alex.getByRole("button", { name: "Mine only" }).waitFor(); assert.equal(await alex.locator(".rqi").count(), 10); for (const t of await alex.locator(".rqi").allTextContents()) assert.match(t, /Sam Lee/);
  await alex.getByRole("button", { name: "Mine only" }).click(); await alex.getByRole("button", { name: "Everyone's" }).waitFor(); assert.ok((await alex.locator(".rqi").count()) > 10);
  T = await W.state(firmId); assert.ok(T.S.barks.some((b: { userId: string; readAt: unknown }) => b.userId === alexId && b.readAt), "opening the queue from the bark did not mark it read");
  // The owner adds owners to client questions; the next question barks both.
  await page.goto(W.url + "/settings?tab=barks"); await page.getByRole("heading", { name: "Who hears the barks" }).waitFor(); await page.getByLabel("Who hears: A client question").selectOption("named_users"); await page.getByLabel("Name a person for: A client question").selectOption(alexId); await page.getByText(/^Saved\. The hound barks/).waitFor(); await page.getByLabel("Name a person for: A client question").selectOption(ownerId);
  for (let i = 0; i < 50; i++) { T = await W.state(firmId); if (T.barkRoute({ kind: "question", engId: T.S.engs[1].id }).length === 2) break; await new Promise((r) => setTimeout(r, 100)); } assert.deepEqual(T.barkRoute({ kind: "question", engId: T.S.engs[1].id }).sort(), [alexId, ownerId].sort());
  // Staff cannot change the firm's rules, and choose their own kinds under My alerts.
  assert.equal((await alex.request.post(W.url + "/api/act", { data: { fn: "setBarkRules", args: [{}] } , headers: { "x-tallyhound": "1" } })).status(), 403);
  await alex.getByRole("button", { name: "My alerts" }).click(); await alex.getByRole("dialog").getByLabel("Client questions").click({ force: true, noWaitAfter: true }); await alex.getByText("Saved.", { exact: true }).first().waitFor(); T = await W.state(firmId); assert.deepEqual(T.barkRoute({ kind: "question", engId: T.S.engs[1].id }), [ownerId]);
});
