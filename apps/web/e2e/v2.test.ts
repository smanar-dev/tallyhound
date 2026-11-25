// Tallyhound v2 (docs/V2.md): the staff screens of an email-first firm. Letters by email, documents through the upload link, a
// suggested step for each reply, a person confirming each document, and each preparer's own mailbox. No texting anywhere
// (the sweep over every screen is in rules.test.ts).
import { after } from "node:test";
import assert from "node:assert/strict";
import { closeBrowser, emailFirm, INBOX, JPEG, scene } from "./world.ts";
import type { Engine } from "../../server/src/kit.ts";

after(closeBrowser);
const text = (s: string | null) => (s || "").replace(/\s+/g, " ").trim();
/* eslint-disable @typescript-eslint/no-explicit-any */

scene("v2: in approve mode Go fetch drafts one letter listing every document; Approve sends it by email and nothing goes by any other way", async (W) => {
  const { firmId } = await emailFirm(W, { mode: "copilot" }); let T: Engine = await W.state(firmId); const sam = T.S.engs[1], mails = W.email.sent.length;
  const page = await W.signIn("pat1@firm1.test"); await page.goto(W.url + "/clients/" + sam.id);
  // Before anything is sent, the card on the right shows the letter word for word, and never the client's link.
  const card = page.locator(".card", { has: page.getByRole("heading", { name: "Next letter" }) }); await card.waitFor(); const before = text(await card.textContent());
  assert.match(before, /What Sam gets when you say go fetch/); assert.match(before, /Subject\s*2 documents for your 2026 tax return/); assert.match(before, /To prepare your 2026 return we still need:/); assert.match(before, /\(Sam's private upload link\)/); assert.match(before, /Waits for approval/);
  await page.getByRole("button", { name: "Go fetch" }).click(); await page.getByText(/^Off it goes\. The first letter goes by email/).waitFor();
  await page.getByRole("tab", { name: /Conversation/ }).click(); const draft = page.getByLabel(/^Draft: The first letter/); await draft.waitFor();
  assert.equal(W.email.sent.length, mails, "the first letter is a draft, not an email"); const body = await draft.inputValue();
  assert.match(body, /^Hi Sam,\n\nTo prepare your 2026 return we still need:\n\n {2}- W-2 from each employer\n {2}- 1098 from your mortgage lender\n\nUpload them here\. No account or password needed:\n/); assert.match(text(await page.locator(".convo").textContent()), /Subject: 2 documents for your 2026 tax return/);
  await page.getByRole("button", { name: "Approve and send" }).first().click(); await page.getByText("Approved. It goes out now.").waitFor(); await draft.waitFor({ state: "detached" });
  const sent = W.email.sent.at(-1)! as any; assert.equal(W.email.sent.length, mails + 1); assert.equal(sent.to, "sam@x.example"); assert.equal(sent.subject, "2 documents for your 2026 tax return"); assert.match(sent.body, /https:\/\/go\.tallyhound\.test\/u\/[a-z]+-[a-z]{28}\n/); assert.equal(W.sms.sent.length, 0);
  // The letter keeps its lines on screen, and one client can be set to send on its own.
  const bub = page.locator(".convo .bub.letter").last(); assert.equal(await bub.evaluate((el) => getComputedStyle(el).whiteSpace), "pre-wrap");
  await page.getByLabel("Letters for Sam").selectOption("auto"); await page.getByText("Saved.", { exact: true }).first().waitFor(); T = await W.state(firmId); assert.equal(T.S.clients[1].sendMode, "auto");
}, { letters: true });

scene("v2: the Next letter card is the letter that will go, and a document that arrives comes off it; staff can replace or switch off the upload link", async (W) => {
  const { firmId } = await emailFirm(W); let T: Engine = await W.state(firmId); const maria = T.S.engs[0], key = maria.link.key;
  const page = await W.signIn("pat1@firm1.test"); await page.goto(W.url + "/clients/" + maria.id);
  const card = page.locator(".card", { has: page.getByRole("heading", { name: "Next letter" }) }); await card.waitFor(); let t = text(await card.textContent());
  assert.match(t, /Sends on its own/); assert.match(t, /Subject\s*2 documents for your 2026 tax return/); assert.match(t, /A reminder for your 2026 return\. We still need: - W-2 from Acme Logistics - 1098 from Hillcrest Mortgage/); assert.match(t, /From\s*Test CPAs 1 <test1@docs\.tallyhound\.test>/);
  assert.ok(!(await page.content()).includes(key), "the client's link reached the browser");
  await W.app.clientUpload({ firmId, clientId: T.S.clients[0].id, files: [{ bytes: JPEG, contentType: "image/jpeg" }], providerId: "up-" + "b".repeat(24) });
  await page.reload(); await card.waitFor(); t = text(await card.textContent()); assert.match(t, /Subject\s*1 document for your 2026 tax return/); assert.ok(!/W-2/.test(t), "a document that arrived is still in the next letter");
  // The upload link: a new one stops the old one; switched off, nobody gets in.
  assert.match(t, /Upload link\. Made Jan 25/); await card.getByRole("button", { name: "Make a new link" }).click(); await card.getByText(/The link in earlier letters stops working/).waitFor(); await card.getByRole("button", { name: "Make it" }).click(); await page.getByText("A new link is made. The old one no longer works.").waitFor();
  T = await W.state(firmId); assert.notEqual(T.S.engs[0].link.key, key); assert.equal(T.linkFind(key).state, "revoked");
  await card.getByRole("button", { name: "Switch the link off" }).click(); await page.getByText("The link is switched off.").waitFor(); T = await W.state(firmId); assert.equal(T.linkFind(T.S.engs[0].link.key).state, "revoked"); await card.getByText(/Switched off Jan 25/).waitFor();
  // No tab for the week-by-week plan, and the contact details say nothing about a mobile agreement.
  // The Plan tab: the letters still to come, each in the row of every document it names, worded as they will go.
  await page.getByRole("tab", { name: "Plan" }).click(); await page.getByRole("heading", { name: "Follow-up plan" }).waitFor(); const grid = page.getByRole("table", { name: /^Follow-up plan for / }); assert.ok((await grid.locator(".pm.planned").count()) >= 2, "no letters are planned");
  await grid.locator(".pm.planned").first().click(); assert.match(await page.locator(".planpreview").innerText(), /in the morning/); assert.equal(await page.getByRole("group", { name: "Preview by" }).count(), 0, "a letter offers a text preview");
  await page.getByRole("tab", { name: "Details" }).click(); await page.getByLabel("Phone, for calls").waitFor(); assert.equal(await page.getByRole("heading", { name: "OK to text" }).count(), 0);
}, { letters: true });

scene("v2: a reply that names a later day waits in the review queue as a suggested step; nothing changes until Do it", async (W) => {
  const { firmId } = await emailFirm(W); let T: Engine = await W.state(firmId); const maria = T.S.engs[0], w2 = T.itemsOf(maria.id).find((i: any) => i.form === "W2"), mails = W.email.sent.length;
  W.reading.text = { intent: "send_after_date", confidence: "high", legacy_intent: "will_send_later", date: "2027-02-15", person: null, change: null, also_document: false, item_id: w2.id, later_days: null };
  await W.app.inboundEmail({ to: INBOX, from: "maria@x.example", body: "Can I send the W-2 after the 15th?", attachments: [], providerId: "s1", trusted: true });
  T = await W.state(firmId); assert.equal(T.holdOf(T.itemsOf(maria.id).find((i: any) => i.form === "W2"), T.eng(maria.id)), null); assert.equal(W.email.sent.length, mails, "something was sent back before a person decided");
  const page = await W.signIn("pat1@firm1.test"); await page.goto(W.url + "/needs-you"); await page.getByRole("button", { name: /^Suggested steps\s*1$/ }).click();
  const pane = page.locator(".rq > div").nth(1); await pane.getByText("One click will pause the W-2 from Acme Logistics until Tuesday, February 16.").waitFor();
  const seen = text(await pane.textContent()); assert.match(seen, /Maria will send the W-2 wage statement from Acme Logistics after February 15/); assert.match(seen, /Suggested: pause the W-2 from Acme Logistics until Tuesday, February 16/); assert.match(seen, /Nothing changes until you say so/);
  await pane.getByRole("button", { name: "Do it" }).click(); await page.getByText("Done.", { exact: true }).waitFor();
  T = await W.state(firmId); const h = T.holdOf(T.itemsOf(maria.id).find((i: any) => i.form === "W2"), T.eng(maria.id)); assert.equal(h.reason, "client_date"); assert.equal(new Date(h.until).getDate(), 16);
  // On the client's page the reply shows what was understood, and the next letter no longer asks for the W-2.
  await page.goto(W.url + "/clients/" + maria.id + "?tab=conversation"); await page.locator(".meta.line", { hasText: /Understood: will send the W-2 wage statement from Acme Logistics after February 15\. Suggested: pause until February 16/ }).waitFor();
  const card = page.locator(".card", { has: page.getByRole("heading", { name: "Next letter" }) }); assert.ok(!/W-2/.test(text(await card.textContent()))); assert.match(text(await card.textContent()), /1098 from Hillcrest Mortgage/);
}, { letters: true });

scene("v2: while a person confirms every document, an upload that passed waits in the queue with the result filled in, and Agree confirms it", async (W) => {
  const { firmId } = await emailFirm(W, { confirmAll: true }); let T: Engine = await W.state(firmId); const maria = T.S.engs[0];
  await W.app.clientUpload({ firmId, clientId: T.S.clients[0].id, files: [{ bytes: JPEG, contentType: "image/jpeg" }], providerId: "up-" + "c".repeat(24) });
  T = await W.state(firmId); const d = T.S.docs[0]; assert.equal(d.state, "accepted"); assert.equal(d.unconfirmed, true);
  const page = await W.signIn("pat1@firm1.test"); await page.goto(W.url + "/needs-you?show=document"); const pane = page.locator(".rq > div").nth(1); await pane.getByText("Passed the sniff test.").waitFor();
  assert.match(text(await pane.textContent()), /The sniff test: passed/); assert.match(text(await pane.textContent()), /Look at it and agree, or overrule the sniff test\./);
  await pane.getByRole("button", { name: "Accept", exact: true }).click(); await page.getByText("Confirmed.", { exact: true }).waitFor();
  T = await W.state(firmId); assert.equal(T.S.docs[0].unconfirmed, undefined); assert.equal(T.agreement("W2").n, 1); assert.equal(T.agreement("W2").ok, 1); assert.equal(T.S.tasks.filter((t: any) => t.status === "open" && t.engId === maria.id).length, 0);
  // The count shows under Settings, Mailbox, where an owner can switch the check off.
  await page.goto(W.url + "/settings?tab=mailbox"); const row = page.locator("tr", { hasText: "W-2 wage statement" }); await row.waitFor(); assert.match(text(await row.textContent()), /1\s*100%\s*A person confirms each one/);
}, { letters: true });

scene("v2: Settings for an email-first firm: letters from the Tallyhound address, working days, the daily limit and the confirm switch all save", async (W) => {
  const { firmId } = await emailFirm(W, { confirmAll: true }), page = await W.signIn("pat1@firm1.test");
  await page.goto(W.url + "/settings?tab=mailbox"); await page.getByText(/Letters to your clients go from your firm's Tallyhound address, test1@docs\.tallyhound\.test/).waitFor(); assert.equal(await page.getByRole("link", { name: /^Connect / }).count(), 0);
  assert.equal(await page.getByRole("tab", { name: "Text number" }).count(), 0); assert.equal(await page.getByRole("tab", { name: "Sending hours" }).count(), 0);
  await page.locator(".toggle", { has: page.getByLabel("A person confirms every document") }).click(); await page.getByText("Saved. Documents that pass the sniff test are accepted without a person.").waitFor();
  let T: Engine = await W.state(firmId); assert.equal(T.S.firm.confirmAll, false);
  await page.getByLabel(/^Letters a day/).fill("200"); await page.getByRole("button", { name: "Save", exact: true }).click(); await page.getByText("Saved.", { exact: true }).first().waitFor(); T = await W.state(firmId); assert.equal(T.S.firm.mailCap, 200); await page.getByText(/Now: 200 a day/).waitFor();
  await page.getByLabel(/^Letters a day/).fill("5"); await page.getByRole("button", { name: "Save", exact: true }).click(); await page.getByText("Choose a number from 10 to 5,000.").waitFor();
  await page.getByRole("tab", { name: "Working days" }).click(); await page.getByRole("heading", { name: "Working days and letters" }).waitFor(); assert.equal(await page.getByLabel("Monday").isChecked(), true); assert.equal(await page.getByLabel("Sunday").isChecked(), false);
  await page.getByLabel("Friday").click({ force: true, noWaitAfter: true }); await page.getByRole("button", { name: "Save working days" }).click(); await page.getByText(/^Saved\. Letters already planned move/).waitFor(); T = await W.state(firmId); assert.deepEqual(T.S.firm.workDays, [1, 2, 3, 4]);
  assert.match(text(await page.locator("ol.rhythm").textContent()), /Day 0\s*First letter\s*Working day 2\s*Follow-up\s*Working day 5\s*Follow-up\s*Working day 9\s*Follow-up\s*Working day 14\s*Last reminder/);
  // The wording page shows each letter as it is sent, by voice, and does not offer to edit it.
  await page.getByRole("tab", { name: "Message wording" }).click(); await page.getByRole("heading", { name: "The first letter" }).waitFor(); assert.match(text(await page.locator(".bub.letter").textContent()), /Hi Maria, To prepare your 2026 return we still need: - W-2 from Acme Health - 1099-INT from First Farmers Bank/); const box = page.getByLabel(/^Wording: /); await box.fill((await box.inputValue()).replace("Thank you,", "With thanks,")); await page.getByRole("button", { name: "Save", exact: true }).click(); await page.getByText(/^Saved\. Clients get the new wording/).waitFor(); await page.getByRole("button", { name: "Back to the standard wording" }).waitFor();
  await box.fill((await box.inputValue()).replace("{link}", "")); await page.getByRole("button", { name: "Save", exact: true }).click(); await page.getByText("It must keep {link}.").waitFor();
  await page.getByLabel("Voice").selectOption("brief"); await page.locator(".bub.letter").getByText(/Upload here, no account needed:/).waitFor();
}, { letters: true });

scene("v2: with the mail service, a preparer connects their own mailbox in one visit to Google; until then letters wait; disconnecting stops them", async (W) => {
  const { firmId, ownerId } = await W.newFirm();
  await W.app.staff(firmId, ownerId, (T: Engine) => { T.S.firm.hound.mode = "autopilot"; T.S.firm.confirmAll = false; T.importRows(T.parseCSV("First,Last,Email\nMaria,Garcia,maria@x.example")); T.S.engs[0].confirmed = true; });
  let T: Engine = await W.state(firmId); const maria = T.S.engs[0], page = await W.signIn("pat1@firm1.test");
  await page.goto(W.url + "/"); await page.getByText("Connect your mailbox so letters to your clients can go out.").first().waitFor();
  await page.goto(W.url + "/clients/" + maria.id); await page.getByRole("button", { name: "Go fetch" }).click(); await page.getByText(/Pat Owner has not connected a mailbox yet/).waitFor(); assert.equal(W.layer.letters.length, 0);
  await page.goto(W.url + "/settings?tab=mailbox"); await page.getByText("Your mailbox is not connected").waitFor(); const link = page.getByRole("link", { name: "Connect Google" }); assert.equal(await link.getAttribute("href"), "/api/mailbox/google/start"); await page.getByRole("link", { name: "Connect Microsoft" }).waitFor();
  // The link leads to Google's own page, asking for the two mail permissions. Google is stood in for: it sends the browser back with a good code, as it does after a yes.
  const go = await page.request.get(W.url + "/api/mailbox/google/start", { maxRedirects: 0 }), at = new URL(go.headers().location!); assert.equal(at.host, "accounts.google.com"); assert.match(at.searchParams.get("scope")!, /gmail\.send .*gmail\.readonly$/);
  await page.goto(at.searchParams.get("redirect_uri") + "?code=good-code&state=" + encodeURIComponent(at.searchParams.get("state")!)); await page.waitForURL("**/settings?tab=mailbox&connected=1"); await page.getByText("pat@mapleandpine.example is connected. Letters to your clients go from it from now on.").waitFor();
  assert.equal(W.layer.assistants.size, 1); T = await W.state(firmId); assert.equal(T.S.users[0].mailbox.status, "active"); assert.equal(await page.getByText("Connect your mailbox so letters to your clients can go out.").count(), 0);
  await page.goto(W.url + "/clients/" + maria.id); const card = page.locator(".card", { has: page.getByRole("heading", { name: "Next letter" }) }); await card.getByText(/Pat Owner <pat@mapleandpine\.example>/).waitFor();
  await page.getByRole("button", { name: "Go fetch" }).click(); await page.getByText(/^Off it goes/).waitFor(); await W.worker.pass(); assert.equal(W.layer.letters.length, 1); assert.equal(W.email.sent.filter((m: any) => m.to === "maria@x.example").length, 0, "the letter went through Tallyhound's own mail service, not the preparer's mailbox");
  await page.goto(W.url + "/settings?tab=mailbox"); await page.getByRole("button", { name: "Disconnect" }).click(); await page.getByText(/^Disconnected\. No more letters go from that mailbox/).waitFor(); assert.equal(W.layer.assistants.size, 0); await page.getByText("Your mailbox is not connected").waitFor();
  assert.equal(await page.getByText(/problem|went wrong/i).count(), 0);
}, { layer: true });
