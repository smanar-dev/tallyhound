// Fetch lists (docs/FETCH.md) in the staff app of an email-first firm: the three-step import (client list, last year's records read
// in the browser, the lists sorted into Ready and Needs a look), the list on a client's page before and after approval, the
// Documents settings, and the "New this year" item in the review queue. Every client and every file here is synthetic.
import { after } from "node:test";
import assert from "node:assert/strict";
import type { Page } from "playwright";
import { closeBrowser, emailFirm, scene } from "./world.ts";
import { pdfPagesWith } from "../../server/test/harness.ts";
import type { Engine } from "../../server/src/kit.ts";

after(closeBrowser);
/* eslint-disable @typescript-eslint/no-explicit-any */
const text = (s: string | null) => (s || "").replace(/\s+/g, " ").trim();
const CSV = "Client ID,First name,Last name,Email,SSN,Returning\n2001,Maria,Garcia,maria@x.example,123-45-6789,yes\n2002,Luis,Ortega,luis@x.example,234-56-7890,yes\n2003,Ana,Ruiz,ana@x.example,345-67-8901,no\n";
const organizer = (who: string, lines: string[]) => pdfPagesWith([["2025 Tax Organizer", "Prior Year Summary for " + who, ...lines]]);
const pdf = (name: string, buffer: Buffer) => ({ name, mimeType: "application/pdf", buffer });
// Every request the page makes, so a test can say what never left the browser.
function watch(page: Page) {
  const seen: { url: string; body: Buffer | null }[] = []; page.on("request", (r) => seen.push({ url: r.url(), body: r.postDataBuffer() })); return seen;
}
// The state as saved, once it says what the test waits for. A controlled checkbox changes only when the saved state does.
async function until(W: any, firmId: string, ok: (T: Engine) => boolean, what: string): Promise<Engine> {
  for (let i = 0; i < 100; i++) { const T: Engine = await W.state(firmId); if (ok(T)) return T; await new Promise((r) => setTimeout(r, 50)); } throw new Error("never happened: " + what);
}
const noHorizontalScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

scene("fetch lists: the import keeps SSNs out, reads last year's files in the browser, sorts the lists, and approves the ready ones; a list that needs a look is edited and approved; Not this season and back", async (W) => {
  const { firmId, ownerId } = await W.newFirm(); await W.app.staff(firmId, ownerId, (T: Engine) => { T.S.firm.hound.mode = "autopilot"; T.S.firm.confirmAll = false; });
  const page = await W.signIn("pat1@firm1.test"), seen = watch(page), mails = W.email.sent.length;
  await page.goto(W.url + "/add-clients"); await page.getByRole("heading", { name: "Bring in your client list" }).waitFor();
  assert.match(text(await page.locator(".page").textContent()), /Nothing is sent to anyone until you approve their list\./);
  await page.locator('input[type=file]').setInputFiles({ name: "clients.csv", mimeType: "text/csv", buffer: Buffer.from(CSV) });

  // The columns: the SSN column is locked out, and the example shows nothing of it.
  await page.getByRole("heading", { name: "Match the columns" }).waitFor();
  const ssn = page.locator("tr", { hasText: "SSN" }); assert.match(text(await ssn.textContent()), /SSN\s*hidden\s*Never imported/); assert.equal(await page.getByLabel("Use SSN as").count(), 0, "the SSN column can be chosen");
  assert.ok(!(await page.content()).includes("123-45-6789"), "an SSN reached the screen");
  assert.equal(await page.getByLabel("Use Returning as").inputValue(), "returning");
  await page.getByRole("button", { name: "Bring them in" }).click();
  await page.getByRole("heading", { name: "3 new clients from clients.csv" }).waitFor(); assert.match(text(await page.locator(".page").textContent()), /Never imported: SSN\./);

  // Last year's records, read on this computer. One file names nobody on the list and waits under "Whose is this?".
  await page.getByRole("button", { name: "Next: last year's records" }).click(); await page.getByRole("heading", { name: "Add last year's records" }).waitFor();
  await page.locator('input[type=file]').setInputFiles([
    pdf("2001 Garcia organizer.pdf", organizer("Garcia, Maria", ["W-2   Midtown Transit Authority   52,310.00", "1099-INT   First Farmers Bank   212.00"])),
    pdf("2002 Ortega organizer.pdf", organizer("Ortega, Luis", ["W-2   Ortega Plumbing   41,000.00", "Schedule C Profit or Loss From Business"])),
    pdf("scan-0001.pdf", organizer("Nobody, Known", ["W-2   Ruiz Bakery   30,000.00"]))]);
  await page.getByText(/2001 Garcia organizer\.pdf: Organizer: 2 things found\. Filed to Maria Garcia/).waitFor();
  await page.getByText(/2002 Ortega organizer\.pdf: Organizer: 2 things found\. Filed to Luis Ortega/).waitFor();
  await page.getByText(/scan-0001\.pdf: Organizer: 1 thing found\. Whose is this\? See below/).waitFor();
  await page.getByLabel("Whose is scan-0001.pdf").selectOption({ label: "Ana Ruiz" }); await page.getByText("Filed to Ana Ruiz.").waitFor();
  assert.ok(!seen.some((r) => r.body && r.body.includes("%PDF")), "a PDF left the browser"); assert.ok(!seen.some((r) => /\/api\/imports\/[^/]+\/read/.test(r.url)), "a file was read on the server");

  // The lists: three numbers, from the engine.
  await page.getByRole("button", { name: "Build the fetch lists" }).click(); await page.locator(".stat[data-n=ready]").waitFor();
  const n = async (k: string) => text(await page.locator(".stat[data-n=" + k + "] b").textContent());
  assert.deepEqual([await n("read"), await n("ready"), await n("look")], ["3", "1", "2"]);
  let T: Engine = await W.state(firmId); const st = (await W.store.readState(firmId))!; assert.ok(!/123-45-6789|234-56-7890|345-67-8901/.test(st), "an SSN was stored"); assert.ok(!st.includes("52,310"), "a figure from a file was stored");
  assert.equal(W.email.sent.length, mails, "a letter went before any list was approved");
  const [maria, luis, ana] = T.S.engs; assert.equal(T.listOf(maria.id).group, "ready"); assert.equal(T.listOf(luis.id).group, "look"); assert.equal(T.listOf(ana.id).group, "look");

  // Approve the ready one: its season starts.
  await page.getByRole("button", { name: "Approve all 1 ready list" }).click(); await page.getByText("Approved 1 list.", { exact: true }).first().waitFor();
  T = await W.state(firmId); assert.equal(T.listOf(maria.id).status, "approved"); assert.equal(T.eng(maria.id).status, "in_progress"); assert.equal(T.listOf(luis.id).status, "proposed");

  // Needs a look, one at a time: Luis. Untick what the return proposed, add a document with its issuer, approve.
  await page.getByRole("heading", { name: "Needs a look: Luis Ortega" }).waitFor(); const card = page.locator(".fetchlist");
  assert.match(text(await card.textContent()), /Why it needs a look:/);
  await card.locator('input[type=checkbox]').last().click(); await until(W, firmId, (X) => X.S.items.some((i: any) => i.engId === luis.id && i.state === "off"), "an item unticked");
  await card.getByLabel("Document to add").selectOption("1099INT"); await card.getByLabel("Who issues it").fill("First Farmers Bank"); await card.getByRole("button", { name: "Add", exact: true }).click(); await page.getByText("Added to the list.").waitFor();
  await card.getByRole("button", { name: "Approve list" }).click(); await page.getByText("Approved. Luis's first letter is on its way.").waitFor();
  T = await W.state(firmId); assert.equal(T.listOf(luis.id).status, "approved"); const its = T.S.items.filter((i: any) => i.engId === luis.id && i.state !== "removed");
  assert.ok(its.some((i: any) => i.form === "1099INT" && i.payer === "First Farmers Bank")); assert.ok(T.S.items.some((i: any) => i.engId === luis.id && i.state === "removed"), "the unticked item stayed on the list");

  // Then Ana: not this season. She stays on the client list, and comes back in one click.
  await page.getByRole("heading", { name: "Needs a look: Ana Ruiz" }).waitFor(); await page.locator(".fetchlist").getByRole("button", { name: "Not this season" }).click(); await page.getByText("Not this season. No letters go to Ana.").waitFor();
  T = await W.state(firmId); assert.equal(T.eng(ana.id).status, "off_season");
  await page.goto(W.url + "/clients?show=off_season"); await page.getByRole("button", { name: /^Not this season/ }).waitFor(); assert.match(text(await page.locator("table").textContent()), /Ana Ruiz.*Not this season/);
  await page.goto(W.url + "/clients/" + ana.id); await page.getByRole("button", { name: "Bring back" }).click(); await page.getByText("Ana is back on for this season.").waitFor();
  T = await W.state(firmId); assert.equal(T.eng(ana.id).status, "not_started");
  await page.goto(W.url + "/clients"); assert.match(text(await page.locator("table").textContent()), /Ana Ruiz.*Ready to fetch\s*Needs a look/);
}, { letters: true });

scene("fetch lists: an approved list on the client's page (assign to a new contact, not needed and back, add a document, a note, a file read in the browser); Documents settings save; a New this year item adds to the list", async (W) => {
  const { firmId, ownerId } = await W.newFirm(); let eid = "";
  await W.app.staff(firmId, ownerId, (T: Engine) => { T.S.firm.hound.mode = "copilot"; T.S.firm.confirmAll = false; T.importRows(T.parseCSV("First,Last,Email\nMaria,Garcia,maria@x.example")); const e = T.S.engs[0]; eid = e.id; c0(T, e); T.S.firm.ruleStats = { "R-ORG": { kept: 3, unticked: 1, ticked: 0, removedLater: 0 } }; });
  function c0(T: Engine, e: any) { T.S.items.filter((i: any) => i.engId === e.id).forEach((i: any) => { i.state = "removed"; }); T.addCatalogItem(e.id, "W2", "Midtown Transit Authority"); T.addCatalogItem(e.id, "1099B", "Schwab"); assert.equal(T.approveList(e.id), null); }
  const page = await W.signIn("pat1@firm1.test"), seen = watch(page); await page.goto(W.url + "/clients/" + eid);
  const card = page.locator(".fetchlist"); await card.waitFor(); assert.match(text(await page.getByRole("tab", { name: /Fetch list/ }).textContent()), /Fetch list/); assert.match(text(await card.textContent()), /Approved by .*Version 1\./);

  // The 1099-B goes to someone new, in their own letter.
  await card.getByLabel(/^Who is asked for the 1099-B/).selectOption("+"); const dlg = page.getByRole("dialog", { name: "Someone else who has documents" });
  await dlg.getByLabel("Their name").fill("Arjun Garcia"); await dlg.getByLabel("Their email").fill("arjun@x.example"); await dlg.getByRole("button", { name: "Add", exact: true }).click(); await page.getByText("It goes to them in their own letter, with their own link.").waitFor();
  let T: Engine = await W.state(firmId); const c = T.S.clients[0], p = c.contacts.find((x: any) => x.email === "arjun@x.example"); assert.ok(p); assert.equal(T.S.items.find((i: any) => i.engId === eid && i.form === "1099B" && i.state !== "removed").assignee, p.id);
  assert.match(text(await card.textContent()), /Asked of Arjun Garcia/);

  // Not needed, then asked for again.
  await card.locator(".fl", { hasText: "Midtown Transit Authority" }).getByRole("button", { name: "Not needed" }).click(); const nd = page.getByRole("dialog", { name: "Not needed this year" }); await nd.getByLabel("Why").selectOption("no_longer_employed"); await nd.getByRole("button", { name: "Not needed this year" }).click(); await page.getByText("Marked not needed.").waitFor();
  T = await W.state(firmId); const w2 = () => T.S.items.find((i: any) => i.engId === eid && i.form === "W2" && i.state !== "removed"); assert.equal(w2().state, "waived");
  await card.locator(".fl", { hasText: "Midtown Transit Authority" }).getByRole("button", { name: "Ask again" }).click(); await page.getByText("Asked for again.").waitFor(); T = await W.state(firmId); assert.equal(w2().state, "expected");
  assert.equal(T.listOf(eid).version, 4, "each change after approval is a new version");

  // A document from the catalog, with its issuer; a note for the preparer; last year's file read on this computer.
  await card.getByLabel("Document to add").selectOption("1099DIV"); await card.getByLabel("Who issues it").fill("Vanguard"); await card.getByRole("button", { name: "Add", exact: true }).click(); await page.getByText("Added. It is asked for in the next letter.").waitFor();
  await page.getByLabel("A note for the preparer").fill("Ask about the rental in Knoxville"); await page.getByRole("button", { name: "Add note" }).click(); await page.getByText("Note saved.").waitFor();
  await page.locator(".card", { has: page.getByRole("heading", { name: "Last year's records" }) }).locator('input[type=file]').setInputFiles(pdf("Garcia 2025 organizer.pdf", organizer("Garcia, Maria", ["1099-INT   First Farmers Bank   212.00"])));
  await page.getByText(/Read on this computer: the file was not sent\./).waitFor();
  T = await W.state(firmId); const e = T.eng(eid); assert.ok(T.S.items.some((i: any) => i.engId === eid && i.form === "1099DIV" && i.payer === "Vanguard" && i.state === "expected")); assert.equal(e.notes.at(-1).text, "Ask about the rental in Knoxville");
  assert.equal(e.records.length, 1); assert.equal(e.records[0].where, "browser"); assert.ok(!seen.some((r) => r.body && r.body.includes("%PDF")), "a PDF left the browser");
  await page.getByRole("tab", { name: "Details" }).click(); assert.match(text(await page.locator(".card", { has: page.getByRole("heading", { name: "Household and contacts" }) }).textContent()), /Arjun Garcia arjun@x\.example/);

  // Settings, Documents: offer, wording, the firm's rules and a payer name.
  await page.goto(W.url + "/settings?tab=documents"); await page.getByRole("heading", { name: "Documents Tallyhound asks for" }).waitFor();
  await page.getByLabel("Offer the W-2G").click(); await page.getByText("No longer offered or proposed.").waitFor();
  await page.getByLabel("Asked as, for the 1099-INT").fill("1099-INT from every bank you use"); await page.locator("tr", { has: page.getByLabel("Asked as, for the 1099-INT") }).getByRole("button", { name: "Save" }).click(); await page.getByText("Saved. The next letter uses it.").waitFor();
  T = await W.state(firmId); assert.equal(T.S.firm.catalog.W2G.hidden, true); assert.equal(T.S.firm.catalog["1099INT"].ask, "1099-INT from every bank you use");
  await page.locator("tr", { has: page.getByLabel("Asked as, for the 1099-INT") }).getByRole("button", { name: "Reset" }).click(); await page.getByText("Back to the standard wording.").waitFor();
  await page.getByLabel(/Ask every client what's new this year/).click(); await until(W, firmId, (X) => X.firmRule("ask_news") === false, "the rule switched off");
  await page.getByLabel("As it appears").fill("JPMORGAN CHASE BANK NA"); await page.getByLabel("Shown as").fill("Chase"); await page.locator(".card", { has: page.getByRole("heading", { name: "Payer names in letters" }) }).getByRole("button", { name: "Save" }).click(); await page.getByText("Saved. Letters use it from now on.").waitFor();
  T = await W.state(firmId); assert.ok(!T.S.firm.catalog["1099INT"].ask); assert.equal(T.firmRule("ask_news"), false); assert.equal(T.S.firm.aliases["JPMORGAN CHASE BANK NA"], "Chase");
  assert.match(text(await page.locator(".card", { has: page.getByRole("heading", { name: "How often each rule is right" }) }).textContent()), /Listed in last year's organizer\s*3\s*1\s*0\s*0\s*75%/);

  // What Maria said is new this year: a suggestion waits in the review queue, and one click adds it.
  await W.app.staff(firmId, ownerId, (X: Engine) => { X.clientNews(eid, ["sold_stocks"], ""); });
  await page.goto(W.url + "/needs-you"); await page.getByRole("button", { name: /^New this year/ }).click();
  await page.getByText("Said what is new this year").first().waitFor(); assert.match(text(await page.locator(".knows").textContent()), /Suggested: 1099-DA/);
  await page.getByRole("button", { name: "Add to the list" }).click(); await page.getByText("Added to the list. The next letter asks for them.").waitFor();
  T = await W.state(firmId); assert.ok(T.S.items.some((i: any) => i.engId === eid && i.form === "1099DA" && i.state === "expected")); assert.ok(!T.S.tasks.some((t: any) => t.kind === "news" && t.status === "open"));
}, { letters: true });

scene("fetch lists: on a 360 px phone the import's steps and the client's upload page never scroll sideways", async (W) => {
  const { firmId } = await emailFirm(W), T: Engine = await W.state(firmId), page = await W.signIn("pat1@firm1.test", { width: 360, height: 800 });
  await page.goto(W.url + "/add-clients"); await page.getByRole("heading", { name: "Bring in your client list" }).waitFor(); assert.ok(await noHorizontalScroll(page), "the first step scrolls sideways");
  await page.locator('input[type=file]').setInputFiles({ name: "clients.csv", mimeType: "text/csv", buffer: Buffer.from(CSV.replace(/Maria|Luis|Ana/g, (m) => m + "x").replace(/@/g, "2@")) });
  await page.getByRole("heading", { name: "Match the columns" }).waitFor(); assert.ok(await noHorizontalScroll(page), "the columns step scrolls sideways");
  await page.getByRole("button", { name: "Bring them in" }).click(); await page.getByRole("button", { name: "Next: last year's records" }).waitFor(); assert.ok(await noHorizontalScroll(page), "the results scroll sideways");
  await page.getByRole("button", { name: "Next: last year's records" }).click(); await page.getByRole("heading", { name: "Add last year's records" }).waitFor(); assert.ok(await noHorizontalScroll(page), "the records step scrolls sideways");
  await page.getByRole("button", { name: "Skip" }).click(); await page.locator(".stat[data-n=look]").waitFor(); assert.ok(await noHorizontalScroll(page), "the lists step scrolls sideways");
  const sent = W.email.sent.find((m: any) => m.to === "maria@x.example")! as any, link = /\/u\/([A-Za-z0-9_-]+)/.exec(sent.body)![1]!; assert.ok(T.S.engs[0]);
  await page.goto(W.url + "/u/" + link); await page.waitForLoadState("load"); assert.ok(await noHorizontalScroll(page), "the upload page scrolls sideways");
}, { letters: true });
