// The hound screen and the hound panel on a client's page (T-20).
import { after } from "node:test";
import assert from "node:assert/strict";
import { busyFirm, closeBrowser, DNS, scene } from "./world.ts";
import type { Engine } from "../../server/src/kit.ts";

after(closeBrowser);
const text = (s: string | null) => (s || "").replace(/\s+/g, " ").trim();

scene("the hound shows what it did and why, what is coming up, and lets an owner choose how much it does on its own", async (W) => {
  const { firmId } = await busyFirm(W), page = await W.signIn("pat1@firm1.test"); await page.locator(".side").getByRole("link", { name: /The hound/ }).click(); await page.locator(".stat").first().waitFor();
  let T: Engine = await W.state(firmId); assert.match(text(await page.locator(".topbar .chip").textContent()), /It sends on its own/);
  // What it did: the engine's log, newest first, each with its reason.
  const rows = page.locator(".card .list .li"); assert.equal(await rows.count(), Math.min(80, T.S.hlog.length)); assert.ok((await page.locator(".card .list").textContent())!.includes("Why: "));
  await page.getByRole("button", { name: "Messages", exact: true }).click(); await page.waitForFunction((n) => document.querySelectorAll(".card .list .li").length === n, T.S.hlog.filter((h: { kind: string }) => h.kind === "message").length);
  // Coming up: Sam's invitation reminder is planned; put it off a day.
  await page.getByRole("tab", { name: "Coming up" }).click(); await page.getByRole("heading", { name: "Next 3 days" }).waitFor(); const sam = page.locator(".li", { hasText: "Sam Lee" });
  // This step has failed now and then under load without a readable cause, so when it does, say what the page and the clocks held.
  try { await sam.waitFor({ timeout: 15000 }); } catch (err) { const E: Engine = await W.state(firmId), se = E.S.engs.find((e: { clientId: string }) => E.client(e.clientId).first === "Sam"); throw new Error("Sam's reminder is not under Coming up. Page: " + page.url() + " " + text(await page.locator("body").textContent({ timeout: 3000 }).catch(() => "(no body)")).slice(0, 500) + " | server now " + new Date(E.S.now).toISOString() + " | Sam next " + (se.next ? new Date(se.next).toISOString() : "none") + " status " + se.status + " | browser now " + (await page.evaluate(() => new Date().toISOString())), { cause: err }); } assert.match(text(await sam.textContent()), /Invitation reminder by email/);
  const was = +new Date(T.S.engs.find((e: { clientId: string }) => T.client(e.clientId).first === "Sam").next); await sam.getByRole("button", { name: "Put off a day" }).click(); await page.getByText("Put off by a day.").waitFor();
  T = await W.state(firmId); assert.ok(+new Date(T.S.engs.find((e: { clientId: string }) => T.client(e.clientId).first === "Sam").next) > was);
  // Rules it follows: switch to Copilot. It is saved, audited, and the next message is a draft.
  await page.getByRole("tab", { name: "Rules it follows" }).click(); await page.getByLabel(/^Approve each message/).click(); await page.getByText("Saved.", { exact: true }).waitFor();
  T = await W.state(firmId); assert.equal(T.S.firm.hound.mode, "copilot"); assert.ok(T.S.audit.some((a: { action: string; detail: string }) => a.action === "settings.hound" && /Now on copilot/.test(a.detail)));
  // The "Saved." from the change before may still be on screen, so wait for the saved state itself, not for the words.
  await page.getByLabel("Pause after an upset reply").selectOption("5"); for (let i = 0; i < 100 && (await W.state(firmId)).S.firm.hound.pauseDays !== 5; i++) await new Promise((r) => setTimeout(r, 50)); assert.equal((await W.state(firmId)).S.firm.hound.pauseDays, 5);
  await page.getByRole("tab", { name: "Drafts to approve" }).click(); await page.getByText("No drafts waiting.").waitFor();
});

scene("staff can see the rules but not change them; a person takes a conversation over and hands it back from the client page", async (W) => {
  const { firmId, ownerId } = await busyFirm(W); await W.firms.addUser(firmId, (await W.auth.userById(ownerId))!, { name: "Alex Staff", email: "alex@firm1.test", role: "staff" });
  const page = await W.signIn("alex@firm1.test"); await page.goto(W.url + "/hound?tab=rules"); await page.getByText("Only an owner can change these.").first().waitFor(); assert.equal(await page.getByLabel(/^Approve each message/).isDisabled(), true); assert.equal(await page.getByLabel("Pause after an upset reply").isDisabled(), true);
  let T: Engine = await W.state(firmId); const jo = T.S.engs[0]; await page.goto(W.url + "/clients/" + jo.id); const card = page.locator(".card", { hasText: "What it knows about Jo" }); await card.waitFor();
  await card.getByRole("button", { name: /^I'll handle / }).click(); await page.getByText(/^You have the conversation/).waitFor(); await page.waitForURL("**tab=conversation"); assert.match(text(await card.textContent()), /A person has it.*Alex Staff took over/);
  T = await W.state(firmId); assert.equal(T.S.engs[0].takeover.by, "Alex Staff");
  await card.getByLabel(/Tell the hound something about Jo/).fill("Travels for work, best reached on Fridays"); await card.getByRole("button", { name: "Add", exact: true }).click(); await card.getByText("Travels for work, best reached on Fridays").first().waitFor();
  await card.getByLabel("Documents needed by").fill("2027-03-01"); await page.getByText(/^Saved\. The hound follows up more often/).waitFor(); T = await W.state(firmId); assert.equal(new Date(T.S.engs[0].target).getMonth(), 2);
  await card.getByLabel("Note for the hound").fill("Spoke to Jo, W-2 coming Friday"); await card.getByRole("button", { name: "Hand back to the hound" }).click(); await page.getByText(/^Handed back/).waitFor();
  T = await W.state(firmId); assert.equal(T.S.engs[0].takeover, null); assert.ok(T.S.engs[0].memory.some((m: { text: string }) => /W-2 coming Friday/.test(m.text)));
});

scene("Progress counts what happened; a paused firm sees the lock page everywhere but Settings, and the server refuses the same things", async (W) => {
  const { firmId, ownerId } = await busyFirm(W), page = await W.signIn("pat1@firm1.test"); await page.locator(".side").getByRole("link", { name: "Progress" }).click(); await page.locator(".stat").first().waitFor();
  const T: Engine = await W.state(firmId), stats = (await page.locator(".stat").allTextContents()).map(text);
  assert.match(stats[1]!, /^100%Accepted with no staff touch1 documents in$/); assert.match(stats[3]!, /^0Opted out of textsof 3 clients$/); assert.match(text(await page.locator(".card", { hasText: "By preparer" }).last().textContent()), /Pat Owner ?3 ?0 ?1/);
  assert.equal(T.S.engs.length, 3);
  // The owner pauses for the off season (done here through the engine; the plan page is not built yet).
  await W.app.staff(firmId, ownerId, (E: Engine) => { const r = E.pauseSeason(new Date(E.S.now.getTime() + 30 * E.DAY)); if (r && r.ok === false) throw new Error(r.why || "could not pause"); });
  assert.equal((await W.state(firmId)).access().state, "paused");
  for (const route of ["/", "/clients", "/needs-you", "/hound", "/add-clients", "/messages", "/progress"]) { await page.goto(W.url + route); await page.locator(".lockcard h1", { hasText: /^Paused until/ }).waitFor(); }
  await page.goto(W.url + "/settings"); await page.getByRole("heading", { name: "Your firm" }).waitFor();
  const refused = await page.request.post(W.url + "/api/act", { data: { fn: "addClient", args: [{ first: "New", last: "Person", email: "n@x.example" }] }, headers: { "x-tallyhound": "1" } }); assert.equal(refused.status(), 400); assert.match((await refused.json()).message, /Paused/);
  assert.equal((await W.state(firmId)).S.clients.length, 3, "nothing was added while paused");
  await page.goto(W.url + "/"); await page.getByRole("button", { name: "Resume now" }).click(); await page.getByText(/^Resumed/).waitFor(); await page.locator("h1", { hasText: /^Good / }).waitFor(); assert.equal((await W.state(firmId)).access().ok, true);
});

scene("settings: an owner makes a ready-made checklist, sets how long copies are kept, and can hold every message", async (W) => {
  const { firmId } = await busyFirm(W), page = await W.signIn("pat1@firm1.test"); await page.goto(W.url + "/settings?tab=checklists"); await page.getByRole("heading", { name: "Ready-made checklists" }).waitFor();
  let T: Engine = await W.state(firmId); const before = T.templates().length; assert.equal(await page.locator(".card .list .li").count(), before);
  await page.getByRole("button", { name: "New checklist" }).click(); const dlg = page.getByRole("dialog"); await dlg.getByRole("button", { name: "Save" }).click(); await dlg.getByRole("alert").waitFor();
  await dlg.getByLabel("Name").fill("Retired couple"); await dlg.getByLabel("Social Security benefit statement").check(); await dlg.getByLabel(/^1099-R|retirement/i).first().check(); await dlg.getByRole("button", { name: "Save" }).click(); await dlg.waitFor({ state: "detached" });
  T = await W.state(firmId); const made = T.templates().find((t: { name: string }) => t.name === "Retired couple"); assert.ok(made); assert.ok(made.items.includes("SSA1099")); assert.equal(await page.locator(".card .list .li").count(), before + 1);
  // It is offered when choosing a checklist for a client.
  await page.goto(W.url + "/clients?do=assign"); await page.getByRole("dialog").locator("select").first().selectOption({ label: "Retired couple (" + made.items.length + ")" }); await page.keyboard.press("Escape");
  await page.goto(W.url + "/settings?tab=checklists"); await page.locator(".li", { hasText: "Retired couple" }).getByRole("button", { name: "Remove" }).click(); await page.getByText(/^Checklist removed\. No client's list came from it\./).waitFor(); assert.equal(await page.getByRole("dialog").count(), 0, "no question first (T-66)");
  // Undo within ten seconds puts it back; removing it again and leaving it alone removes it for good.
  await page.getByRole("button", { name: "Undo" }).click(); await page.getByText("Put back.").waitFor(); await page.locator(".li", { hasText: "Retired couple" }).waitFor(); await page.locator(".li", { hasText: "Retired couple" }).getByRole("button", { name: "Remove" }).click(); await page.getByText(/^Checklist removed/).waitFor();
  // Security and data: the engine's numbers, and its limits.
  await page.getByRole("tab", { name: "Security and data" }).click(); await page.getByRole("heading", { name: "How long Tallyhound keeps a document" }).waitFor(); const M = (await W.state(firmId)).dataMap();
  assert.match(text(await page.locator(".statgrid").textContent()), new RegExp("^" + M.docsHeld + "document copies held now" + M.docsDeleted + "already deleted"));
  await page.getByLabel("After it reaches your storage").fill("0"); await page.getByLabel("Longest any copy is kept, whatever happens").fill("9999"); await page.getByRole("button", { name: "Save", exact: true }).click(); await page.getByText(/^Saved\. Anything already past/).waitFor();
  T = await W.state(firmId); assert.equal(T.retain().afterDelivery, 0); assert.equal(T.retain().max, 730, "the engine keeps the number inside its limit"); assert.ok(T.S.audit.some((a: { action: string }) => a.action === "settings.retention"));
  assert.ok((await page.locator(".audit tbody tr").count()) > 5); assert.match(text(await page.locator(".plantext").textContent()), /Service provider: Tallyhound/);
  await page.getByRole("button", { name: "Hold all messages" }).click(); await page.getByRole("dialog").getByRole("button", { name: "Hold all messages" }).click(); await page.locator(".banner.bad").waitFor();
  assert.equal((await W.state(firmId)).S.firm.stopped, true); await page.locator(".banner.bad").getByRole("button", { name: "Resume messages" }).click(); await page.locator(".banner.bad").waitFor({ state: "detached" }); assert.equal((await W.state(firmId)).S.firm.stopped, false);
});

scene("settings: an owner rewrites a message within the rules, cannot break it, and sets the sending hours", async (W) => {
  const { firmId } = await busyFirm(W), page = await W.signIn("pat1@firm1.test"); await page.goto(W.url + "/settings?tab=wording"); await page.getByRole("heading", { name: "Messages" }).waitFor();
  let T: Engine = await W.state(firmId); const label = T.TPL_USE.M5; await page.getByRole("button", { name: label, exact: true }).click(); const box = page.getByLabel("Wording"); assert.equal(await box.inputValue(), T.TPL.en.M5);
  // Advice words are refused by the engine's own check; so is dropping a blank Tallyhound fills in.
  await box.fill(T.TPL.en.M5 + " You may get a refund."); await page.getByRole("button", { name: "Save", exact: true }).click(); await page.getByRole("alert").waitFor(); assert.match(text(await page.getByRole("alert").textContent()), /would not pass the message check: blocked word "refund"/);
  await box.fill("Hi, we still need a document from you."); await page.getByRole("button", { name: "Save", exact: true }).click(); await page.getByText(/It must keep \{/).waitFor(); assert.equal((await W.state(firmId)).S.firm.templates.en.M5, undefined, "nothing was saved");
  const mine = T.TPL.en.M5.replace(/\.$/, "") + ". Thank you for your help."; await box.fill(mine); await page.getByRole("button", { name: "Save", exact: true }).click(); await page.getByText(/^Saved\. It is used from the next message/).waitFor();
  T = await W.state(firmId); assert.equal(T.S.firm.templates.en.M5, mine); assert.match(text(await page.locator(".bub.out").textContent()), /Thank you for your help\.$/); assert.match(text(await page.locator(".wpick.on").textContent()), /Yours/);
  await page.getByRole("button", { name: "Use the standard wording" }).click(); await page.getByText("Back to the standard wording.").waitFor(); assert.equal((await W.state(firmId)).S.firm.templates.en.M5, undefined);
  // What the law requires cannot be edited.
  await page.getByRole("button", { name: T.TPL_USE.M16, exact: true }).click(); await page.getByText("This wording is required by law").waitFor(); assert.equal(await page.getByLabel("Wording").isDisabled(), true);
  const refused = await page.request.post(W.url + "/api/act", { data: { fn: "saveWording", args: ["M16", "Texts stopped, sorry to see you go, reply START"] }, headers: { "x-tallyhound": "1" } }); assert.match((await refused.json()).result, /required by law/);
  await page.getByRole("tab", { name: "Sending hours" }).click(); await page.getByLabel("Earliest a message goes").selectOption("9"); await page.getByLabel("Latest a message goes").selectOption("18"); await page.getByRole("button", { name: "Save", exact: true }).click(); await page.getByText("Saved.", { exact: true }).waitFor();
  T = await W.state(firmId); assert.equal(T.S.firm.quietStart, 9); assert.equal(T.S.firm.quietEnd, 18); assert.equal(T.allowed(new Date(2027, 0, 26, 8, 30)), false, "the engine now holds a message at 8:30");
});

scene("Ask: a question gets an answer read from the firm's own work, a failure is said in words, and nothing changes", async (W) => {
  const { firmId } = await busyFirm(W), page = await W.signIn("pat1@firm1.test"), before = JSON.stringify((await W.state(firmId)).S.clients);
  await page.goto(W.url + "/hound?tab=ask"); await page.getByRole("heading", { name: "Ask the hound" }).waitFor(); await page.getByText("It cannot send or change anything.").waitFor();
  await page.getByRole("button", { name: "Who needs me, and why?" }).click(); await page.locator(".bub.in", { hasText: /on your list: / }).waitFor();
  const T: Engine = await W.state(firmId); assert.match(text(await page.locator(".bub.in").last().textContent()), new RegExp("^" + T.S.engs.length + " on your list: ")); assert.match(text(await page.locator(".bub.in").last().textContent()), /Jo Day/);
  await page.getByLabel("Your question").fill("Give me tax advice"); await page.keyboard.press("Enter"); await page.locator(".bub.in", { hasText: "Claude is busy. Try again in a moment." }).waitFor();
  await page.getByRole("button", { name: "Clear" }).click(); await page.getByText("Try one of these, or write your own.").waitFor();
  assert.equal(JSON.stringify((await W.state(firmId)).S.clients), before);
  assert.equal(W.errors.length, 1, "the one failed request, which this test caused on purpose"); assert.match(W.errors[0]!, /502/); W.errors.length = 0;
});

scene("Your plan: an owner sees the plan and what is used, pauses for the quiet months within the yearly limit, and resumes", async (W) => {
  const { firmId } = await busyFirm(W), page = await W.signIn("pat1@firm1.test"); await page.goto(W.url + "/settings?tab=plan"); await page.getByRole("heading", { name: "Your plan", exact: true }).waitFor();
  let T: Engine = await W.state(firmId); const b = T.billing(); assert.equal(b.state, "active"); assert.match(text(await page.locator(".card").first().textContent()), new RegExp(b.plan + ": \\$" + T.PLANS.find((p: [string]) => p[0] === b.plan)[1] + " a month"));
  assert.equal(await page.locator("tbody tr").count(), 2, "the two plans on sale by card here, not all four"); assert.match(text(await page.locator("tr.sel").textContent()), /Yours/); await page.getByText("Documents checked").waitFor();
  const far = new Date(T.S.now.getTime() + 200 * T.DAY).toISOString().slice(0, 10), near = new Date(T.S.now.getTime() + 30 * T.DAY).toISOString().slice(0, 10);
  await page.getByLabel("Pause until").fill(far); await page.getByRole("button", { name: "Pause", exact: true }).click(); await page.getByRole("alert").getByText(/A pause can last up to 3 months in any 12 months/).waitFor(); assert.equal((await W.state(firmId)).billing().state, "active");
  await page.getByLabel("Pause until").fill(near); await page.getByRole("button", { name: "Pause", exact: true }).click();
  // Paused: every screen but Settings is the lock page, and the plan page offers the way back.
  await page.getByRole("button", { name: "Resume now" }).first().waitFor(); T = await W.state(firmId); assert.equal(T.billing().state, "paused"); assert.equal(T.access().ok, false);
  await page.goto(W.url + "/settings?tab=plan"); await page.getByText(/^Paused until /).waitFor(); await page.getByRole("button", { name: "Resume now" }).click(); await page.getByText("Resumed. Fetching carries on.").waitFor(); assert.equal((await W.state(firmId)).billing().state, "active");
});

scene("Finished files: an owner connects Google Drive by a visit to Google and back, sets the folder, and disconnects; a refusal at Google is said in words", async (W) => {
  const { firmId } = await busyFirm(W), page = await W.signIn("pat1@firm1.test"); let answer = "error=access_denied";
  // Google's own pages are stood in for, and never visited: the address Tallyhound would send the owner to is read, and the owner
  // comes straight back with the state they left with.
  await page.route("**/api/storage/google/start", async (route) => { const r = await route.fetch({ maxRedirects: 0 }), u = new URL(r.headers().location!); assert.equal(u.host, "accounts.google.com"); assert.equal(u.searchParams.get("scope"), "https://www.googleapis.com/auth/drive.file"); return route.fulfill({ status: 302, headers: { location: W.url + "/api/storage/google/callback?" + answer + "&state=" + encodeURIComponent(u.searchParams.get("state")!) } }); });
  await page.goto(W.url + "/settings?tab=files"); await page.getByRole("heading", { name: "Where finished files go" }).waitFor(); await page.getByText("In use").waitFor();
  await page.getByRole("link", { name: "Connect Google Drive" }).click(); await page.getByRole("alert").getByText("Permission was not given, so nothing was connected.").waitFor(); assert.equal((await W.state(firmId)).S.firm.delivery.provider, "Download");
  answer = "code=good-code"; await page.getByRole("link", { name: "Connect Google Drive" }).click(); await page.getByRole("status").getByText(/Google Drive is connected/).waitFor();
  let T: Engine = await W.state(firmId); assert.equal(T.S.firm.delivery.provider, "Google Drive"); assert.equal(T.S.firm.delivery.auto, "on");
  await page.getByLabel("Folder").fill("Tax intake"); await page.getByLabel("When").selectOption("each"); await page.getByRole("button", { name: "Save", exact: true }).click(); await page.getByText("Saved.", { exact: true }).waitFor();
  T = await W.state(firmId); assert.equal(T.S.firm.delivery.folder, "Tax intake"); assert.equal(T.S.firm.delivery.when, "each"); assert.match(text(await page.locator(".note.info").textContent()), /Tax intake \/ \d{4} \/ /);
  // All four are offered; SharePoint needs the site's address before it can be started.
  assert.equal(await page.getByRole("link", { name: /^Connect (Microsoft OneDrive|Dropbox)$/ }).count(), 2); assert.equal(await page.getByRole("button", { name: "Connect SharePoint" }).isDisabled(), true); await page.getByLabel("Your SharePoint site's address").fill("https://acme.sharepoint.com/sites/Tax"); assert.match((await page.getByRole("link", { name: "Connect SharePoint" }).getAttribute("href"))!, /sharepoint\/start\?site=https%3A%2F%2Facme\.sharepoint\.com%2Fsites%2FTax$/);
  await page.getByRole("button", { name: "Disconnect" }).click(); await page.getByRole("dialog").getByRole("button", { name: "Disconnect" }).click(); await page.getByText("Disconnected. Finished files are handed off as a zip.").waitFor();
  assert.equal((await W.state(firmId)).S.firm.delivery.provider, "Download"); await page.getByRole("link", { name: "Connect Google Drive" }).waitFor();
});

scene("Your plan with card billing: a trial firm chooses a plan and is sent to the payment page; nothing starts until the payment is confirmed", async (W) => {
  const { firmId } = await W.firms.create({ name: "Trial CPAs", inbox: "trial@docs.tallyhound.test", iana: "America/Chicago", ownerName: "Pat Owner", ownerEmail: "pat@trial.test", verified: true }), page = await W.signIn("pat@trial.test"), left: string[] = [];
  // The payment page belongs to the payment service and is never visited here: the address the browser is sent to is noted, and the visit is cut short.
  await page.route(/https:\/\/(checkout|billing)\.stripe\.com\//, (route) => { left.push(route.request().url()); return route.fulfill({ status: 200, contentType: "text/html", body: "<title>payment page</title>" }); });
  await page.goto(W.url + "/settings?tab=plan"); await page.getByText(/You are on the free trial/).waitFor(); await page.getByText(/Tallyhound never sees or stores your card/).waitFor();
  assert.equal(await page.getByRole("button", { name: /^Choose / }).count(), 2, "the two plans on sale"); await page.getByRole("button", { name: "Choose Practice" }).click(); await page.waitForURL(/checkout\.stripe\.com/);
  assert.deepEqual(left, ["https://checkout.stripe.com/c/pay/x_1"]); assert.equal((await W.state(firmId)).billing().state, "trial", "nothing started yet");
  await page.goto(W.url + "/settings?tab=plan&paid=1"); await page.getByRole("status").getByText(/starts as soon as the payment is confirmed/).waitFor();
});

scene("Text number: an owner sends the firm's details for approval, sees where it stands, and marks the note to clients as sent", async (W) => {
  const { firmId } = await W.firms.create({ name: "Test CPAs 1", inbox: "one@docs.tallyhound.test", iana: "America/Chicago", ownerName: "Pat Owner", ownerEmail: "pat1@firm1.test", verified: true }), page = await W.signIn("pat1@firm1.test"); await page.goto(W.url + "/settings?tab=texting"); await page.getByRole("heading", { name: "Your text number" }).waitFor();
  await page.getByLabel(/Legal name/).fill("Test CPAs One LLC"); await page.getByRole("button", { name: "Send for approval" }).click(); await page.getByRole("alert").getByText(/9-digit EIN/).waitFor(); assert.equal((await W.state(firmId)).S.firm.senderStatus, "none");
  await page.getByLabel(/EIN/).first().fill("12-3456789"); await page.getByLabel(/Street address/).fill("100 Main Street"); await page.getByLabel("City").fill("Nashville"); await page.getByLabel("State").fill("tn"); await page.getByLabel("ZIP").fill("37201"); await page.getByLabel(/carriers can reach/).fill("Pat Owner");
  await page.getByRole("button", { name: "Send for approval" }).click(); await page.getByText(/^With the carriers since /).waitFor();
  let T: Engine = await W.state(firmId); assert.equal(T.S.firm.senderStatus, "submitted"); assert.equal(T.S.firm.reg.ein, "123456789"); assert.equal(T.S.firm.reg.state, "TN");
  // Tallyhound files it by hand from exactly these details, and records the approval.
  const filed = (await W.firms.registration(firmId)) as { brand: { legalName: string; ein: string }; campaign: { sampleMessages: string[] } }; assert.equal(filed.brand.legalName, "Test CPAs One LLC"); assert.ok(filed.campaign.sampleMessages.length >= 3);
  await W.firms.senderApproved(firmId, "(615) 555-0142", "Jordan"); await page.reload(); await page.getByText(/Approved by the carriers\. Your clients text \(615\) 555-0142\./).waitFor(); assert.equal(await W.store.firmIdByNumber("6155550142"), firmId);
  await page.getByText(/How we are collecting your tax documents this year/).waitFor(); await page.getByRole("button", { name: "I have sent it" }).click(); await page.getByText(/^Marked as sent /).waitFor(); T = await W.state(firmId); assert.ok(T.S.firm.headsUpAt);
});

scene("Next season: an owner starts the next tax year; finished clients carry forward with last year summarised, the rest stay", async (W) => {
  const { firmId, ownerId } = await busyFirm(W); await W.app.staff(firmId, ownerId, (T: Engine) => { const jo = T.S.engs[0]; T.itemsOf(jo.id).forEach((i: { state: string; id: string }) => { if (i.state !== "received") T.setItem(i.id, "waived", "Not needed this year"); }); });
  let T: Engine = await W.state(firmId); const jo = T.S.clients[0], year: number = T.S.firm.taxYear; assert.equal(T.engOf(jo.id).status, "complete");
  const page = await W.signIn("pat1@firm1.test"); await page.goto(W.url + "/settings"); await page.getByRole("button", { name: "Start the " + (year + 1) + " season" }).click();
  const box = page.getByRole("dialog"); assert.match(text(await box.textContent()), /1 client will move to tax year/); assert.match(text(await box.textContent()), /This cannot be undone/); await box.getByRole("button", { name: "Start " + (year + 1) }).click(); await page.getByText(new RegExp("^Tax year " + (year + 1) + " started: 1 client carried forward")).waitFor();
  T = await W.state(firmId); assert.equal(T.S.firm.taxYear, year + 1); assert.equal(T.engOf(jo.id).year, year + 1); assert.equal(T.engOf(jo.id).status, "not_started"); assert.equal(T.engOf(T.S.clients[1].id).year, year, "still being collected: stays"); assert.equal(T.history(jo.id).length, 1);
  await page.goto(W.url + "/clients/" + T.engOf(jo.id).id + "?tab=details"); await page.getByRole("heading", { name: "Earlier years" }).waitFor(); assert.match(text(await page.locator(".card", { hasText: "Earlier years" }).textContent()), new RegExp(year + " ?\\d+ of \\d+ documents received"));
  // Staff cannot do this.
  await page.request.post(W.url + "/api/users", { data: { name: "Alex Staff", email: "alex@firm1.test", role: "staff" }, headers: { "x-tallyhound": "1" } }); const alex = await W.signIn("alex@firm1.test"); assert.equal((await alex.request.post(W.url + "/api/act", { data: { fn: "rollSeason", args: [year + 2] }, headers: { "x-tallyhound": "1" } })).status(), 403);
});

scene("Email address: an owner adds the firm's domain, sees the three records, and requests come from it once they are found", async (W) => {
  DNS.found = false; const { firmId } = await busyFirm(W), page = await W.signIn("pat1@firm1.test"); await page.goto(W.url + "/settings?tab=domain"); await page.getByRole("heading", { name: "The address your requests come from" }).waitFor();
  await page.getByLabel("Your firm's domain").fill("gmail.com"); await page.getByRole("button", { name: "Add this domain" }).click(); await page.getByRole("alert").getByText(/not a domain your firm controls/).waitFor();
  await page.getByLabel("Your firm's domain").fill("larkinpoe.example"); await page.getByRole("button", { name: "Add this domain" }).click(); await page.getByText(/Waiting for the records below/).waitFor();
  assert.equal(await page.locator("tbody tr").count(), 3); assert.equal(await page.getByText("Not found yet", { exact: true }).count(), 3); assert.match(text(await page.locator("tbody").textContent()), /DKIM ?TXT ?pm\._domainkey\.larkinpoe\.example/);
  await page.getByRole("button", { name: "Check now" }).click(); await page.getByText("Not found yet. Records can take up to a day to show.").waitFor(); assert.equal((await W.state(firmId)).S.firm.domain.verified, false);
  DNS.found = true; await page.getByRole("button", { name: "Check now" }).click(); await page.getByRole("status").getByText("Requests come from documents@larkinpoe.example.").waitFor(); assert.equal((await W.state(firmId)).S.firm.domain.verified, true);
  await page.getByRole("button", { name: "Remove this domain" }).click(); await page.getByRole("dialog").getByRole("button", { name: "Remove" }).click(); await page.getByLabel("Your firm's domain").waitFor(); assert.equal((await W.state(firmId)).S.firm.domain, null);
});

scene("TH-VOI, TH-PAC: an owner makes the hound theirs: voice with a live sample, a sign-off, fetch intensity; one client can differ; staff can look but not change", async (W) => {
  const { firmId } = await busyFirm(W), page = await W.signIn("pat1@firm1.test"); await page.goto(W.url + "/hound?tab=rules"); await page.getByRole("heading", { name: "Make the hound yours" }).waitFor();
  const sample = page.locator(".bub.out").first(); assert.match(text(await sample.textContent()), /^Hi Maria, it's Test CPAs 1\. We need 3 documents.*Acme Health/);
  // Brief: the sample rewrites itself, and it is saved and audited.
  await page.getByRole("radiogroup", { name: "Voice" }).getByText("Brief", { exact: true }).click(); await page.getByText("Saved. The hound will use this from its next message.").waitFor();
  assert.match(text(await sample.textContent()), /^Test CPAs 1: please send your W-2 wage statement from Acme Health/); let T: Engine = await W.state(firmId); assert.equal(T.S.firm.hound.voice, "brief"); assert.ok(T.S.audit.some((a: { action: string }) => a.action === "firm.voice_changed"));
  // The sample is never a real client.
  for (const c of T.S.clients) assert.ok(!text(await sample.textContent()).includes(c.first + ","), "a real client's name is in the sample");
  await page.getByLabel("Preview language").selectOption("es"); assert.match(text(await sample.textContent()), /^Test CPAs 1: por favor envíe/); await page.getByText(/waiting for review by a fluent speaker/).waitFor();
  // A sign-off with a number is refused in words; a good one is saved.
  await page.getByLabel(/^Sign-off/).fill("Call 5551234"); await page.getByRole("button", { name: "Save sign-off" }).click(); await page.getByRole("alert").filter({ hasText: "No numbers in a sign-off" }).waitFor();
  await page.getByLabel(/^Sign-off/).fill("Pat at Test CPAs"); await page.getByRole("button", { name: "Save sign-off" }).click(); await page.getByRole("alert").waitFor({ state: "detached" }); T = await W.state(firmId); assert.equal(T.S.firm.signOff, "Pat at Test CPAs");
  // Persistent: saved, with the note about counsel, and nothing is sent because of the change.
  const sent = W.sms.sent.length + W.email.sent.length; await page.getByRole("radiogroup", { name: "Fetch intensity" }).getByText("Persistent", { exact: true }).click(); await page.getByText(/Ask your own counsel/).waitFor();
  T = await W.state(firmId); assert.equal(T.S.firm.hound.intensity, "persistent"); assert.equal(W.sms.sent.length + W.email.sent.length, sent);
  // One client on Warm and Gentle: chips on their page, and the list filters find them.
  const jo = T.S.engs[0]; await page.goto(W.url + "/clients/" + jo.id + "?tab=details"); await page.getByLabel("Voice").selectOption("warm"); await page.getByText("Saved. The hound will use this from its next message.").first().waitFor(); await page.getByLabel("Fetch intensity").selectOption("gentle");
  await page.locator(".chip", { hasText: "Voice: Warm" }).waitFor(); await page.locator(".chip", { hasText: "Fetch: Gentle" }).waitFor(); T = await W.state(firmId); assert.equal(T.voiceFor(T.S.clients[0]), "warm"); assert.equal(T.cadenceFor(T.S.engs[0]).key, "gentle"); assert.equal(T.voiceFor(T.S.clients[1]), "brief");
  await page.goto(W.url + "/clients"); await page.getByLabel("Voice").selectOption("warm"); await page.locator("tbody tr").nth(1).waitFor({ state: "detached" }); assert.match(text(await page.locator("tbody tr").textContent()), /Jo Day/);
  await page.getByLabel("Voice").selectOption(""); await page.getByLabel("Fetch intensity").selectOption("persistent"); await page.locator("tbody tr").nth(2).waitFor({ state: "detached" }); assert.equal(await page.locator("tbody tr").count(), 2);
  // Staff see the choices and cannot change the firm's.
  await page.goto(W.url + "/settings?tab=people"); await page.getByRole("button", { name: "Add a person" }).click(); const dlg = page.getByRole("dialog"); await dlg.getByLabel("Name").fill("Alex Staff"); await dlg.getByLabel("Work email").fill("alex@firm1.test"); await dlg.getByRole("button", { name: "Add", exact: true }).click(); await dlg.waitFor({ state: "detached" });
  const alex = await W.signIn("alex@firm1.test"); await alex.goto(W.url + "/hound?tab=rules"); await alex.getByRole("heading", { name: "Make the hound yours" }).waitFor(); assert.equal(await alex.locator("input[name=voice]").first().isDisabled(), true); assert.equal(await alex.locator("input[name=inten]").first().isDisabled(), true);
  assert.equal((await alex.request.post(W.url + "/api/act", { data: { fn: "setVoice", args: ["warm"] } , headers: { "x-tallyhound": "1" } })).status(), 403);
});

scene("TH-MEM: a season closes and the next one starts from it: \"From 2026\" on what came in, the sold-home 1098 under Removed last season, and a Last season panel", async (W) => {
  const { firmId } = await busyFirm(W), page = await W.signIn("pat1@firm1.test"); let T: Engine = await W.state(firmId); const jo = T.S.clients[0], year: number = T.S.firm.taxYear;
  // Not needed this year, with the reason. A lasting reason says what happens next season.
  await page.goto(W.url + "/clients/" + T.engOf(jo.id).id); const row = page.locator(".li", { hasText: "Mortgage interest statement" }).first(); await row.getByRole("button", { name: /More|Actions|…|⋯/ }).or(row.locator("button").last()).first().click(); await page.getByRole("button", { name: "Not needed this year" }).first().click();
  const dlg = page.getByRole("dialog", { name: "Not needed this year" }); await dlg.getByLabel("Why").selectOption("sold_home"); await dlg.getByText(/Next season Tallyhound will leave this off/).waitFor(); await dlg.getByRole("button", { name: "Not needed this year" }).click(); await page.getByText("Marked not needed.").waitFor();
  T = await W.state(firmId); assert.equal(T.engOf(jo.id).status, "complete"); const M = T.memoryOf(jo.id); assert.equal(M.length, 2); assert.equal(M.find((r: { form: string }) => r.form === "1098").waiveReason, "sold_home");
  await page.goto(W.url + "/settings"); await page.getByRole("button", { name: "Start the " + (year + 1) + " season" }).click(); await page.getByRole("dialog").getByRole("button", { name: "Start " + (year + 1) }).click(); await page.getByText(new RegExp("^Tax year " + (year + 1) + " started")).waitFor();
  T = await W.state(firmId); const e = T.engOf(jo.id); await page.goto(W.url + "/clients/" + e.id); await page.locator(".chip", { hasText: "From " + year }).waitFor();
  const off = page.locator(".card", { hasText: "Removed last season" }); assert.match(text(await off.textContent()), /Mortgage interest statement.*Sold the home/); assert.ok(!T.itemsOf(e.id).some((i: { form: string }) => i.form === "1098"));
  await off.getByRole("button", { name: "Confirm all" }).click(); await page.getByText("Confirmed. They stay off this year.").waitFor(); await off.waitFor({ state: "detached" });
  await page.goto(W.url + "/clients/" + e.id + "?tab=details"); const last = page.locator(".card", { hasText: "Last season (" + year + ")" }); assert.match(text(await last.textContent()), /W-2 wage statement from Acme Logistics.*Received by text/); assert.match(text(await last.textContent()), /Not needed: sold the home/);
  await last.getByRole("button", { name: "Clear memory" }).click(); await page.getByText(/^Cleared\./).waitFor(); T = await W.state(firmId); assert.equal(T.memoryOf(jo.id).length, 0);
});
