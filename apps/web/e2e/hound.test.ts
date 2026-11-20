// The Hound screen and the Hound panel on a client's page (T-20).
import { after } from "node:test";
import assert from "node:assert/strict";
import { busyFirm, closeBrowser, scene } from "./world.ts";
import type { Engine } from "../../server/src/kit.ts";

after(closeBrowser);
const text = (s: string | null) => (s || "").replace(/\s+/g, " ").trim();

scene("the Hound shows what it did and why, what is coming up, and lets an owner choose how much it does on its own", async (W) => {
  const { firmId } = await busyFirm(W), page = await W.signIn("pat1@firm1.test"); await page.locator(".side").getByRole("link", { name: /The Hound/ }).click(); await page.locator(".stat").first().waitFor();
  let T: Engine = await W.state(firmId); assert.match(text(await page.locator(".topbar .chip").textContent()), /Autopilot: it sends on its own/);
  // What it did: the engine's log, newest first, each with its reason.
  const rows = page.locator(".card .list .li"); assert.equal(await rows.count(), Math.min(80, T.S.hlog.length)); assert.ok((await page.locator(".card .list").textContent())!.includes("Why: "));
  await page.getByRole("button", { name: "Messages", exact: true }).click(); await page.waitForFunction((n) => document.querySelectorAll(".card .list .li").length === n, T.S.hlog.filter((h: { kind: string }) => h.kind === "message").length);
  // Coming up: Sam's invitation reminder is planned; put it off a day.
  await page.getByRole("tab", { name: "Coming up" }).click(); await page.getByRole("heading", { name: "Next 3 days" }).waitFor(); const sam = page.locator(".li", { hasText: "Sam Lee" }); await sam.waitFor(); assert.match(text(await sam.textContent()), /Invitation reminder by email/);
  const was = +new Date(T.S.engs.find((e: { clientId: string }) => T.client(e.clientId).first === "Sam").next); await sam.getByRole("button", { name: "Put off a day" }).click(); await page.getByText("Put off by a day.").waitFor();
  T = await W.state(firmId); assert.ok(+new Date(T.S.engs.find((e: { clientId: string }) => T.client(e.clientId).first === "Sam").next) > was);
  // Rules it follows: switch to Copilot. It is saved, audited, and the next message is a draft.
  await page.getByRole("tab", { name: "Rules it follows" }).click(); await page.getByLabel(/^Copilot/).click(); await page.getByText("Saved.", { exact: true }).waitFor();
  T = await W.state(firmId); assert.equal(T.S.firm.hound.mode, "copilot"); assert.ok(T.S.audit.some((a: { action: string; detail: string }) => a.action === "settings.hound" && /Now on copilot/.test(a.detail)));
  // The "Saved." from the change before may still be on screen, so wait for the saved state itself, not for the words.
  await page.getByLabel("Tone").selectOption("brief"); for (let i = 0; i < 100 && (await W.state(firmId)).S.firm.hound.tone !== "brief"; i++) await new Promise((r) => setTimeout(r, 50)); assert.equal((await W.state(firmId)).S.firm.hound.tone, "brief");
  await page.getByRole("tab", { name: "Drafts to approve" }).click(); await page.getByText("No drafts waiting.").waitFor();
});

scene("staff can see the rules but not change them; a person takes a conversation over and hands it back from the client page", async (W) => {
  const { firmId, ownerId } = await busyFirm(W); await W.firms.addUser(firmId, (await W.auth.userById(ownerId))!, { name: "Alex Staff", email: "alex@firm1.test", role: "staff" });
  const page = await W.signIn("alex@firm1.test"); await page.goto(W.url + "/hound?tab=rules"); await page.getByText("Only an owner can change these.").waitFor(); assert.equal(await page.getByLabel(/^Copilot/).isDisabled(), true); assert.equal(await page.getByLabel("Tone").isDisabled(), true);
  let T: Engine = await W.state(firmId); const jo = T.S.engs[0]; await page.goto(W.url + "/clients/" + jo.id); const card = page.locator(".card", { hasText: "What it knows about Jo" }); await card.waitFor();
  await card.getByRole("button", { name: "Take over the conversation" }).click(); await page.getByText(/^You have the conversation/).waitFor(); await page.waitForURL("**tab=conversation"); assert.match(text(await card.textContent()), /A person has it.*Alex Staff took over/);
  T = await W.state(firmId); assert.equal(T.S.engs[0].takeover.by, "Alex Staff");
  await card.getByLabel(/Tell the Hound something about Jo/).fill("Travels for work, best reached on Fridays"); await card.getByRole("button", { name: "Add", exact: true }).click(); await card.getByText("Travels for work, best reached on Fridays").first().waitFor();
  await card.getByLabel("Documents needed by").fill("2027-03-01"); await page.getByText(/^Saved\. The Hound follows up more often/).waitFor(); T = await W.state(firmId); assert.equal(new Date(T.S.engs[0].target).getMonth(), 2);
  await card.getByLabel("Note for the Hound").fill("Spoke to Jo, W-2 coming Friday"); await card.getByRole("button", { name: "Hand back to the Hound" }).click(); await page.getByText(/^Handed back/).waitFor();
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
  await page.goto(W.url + "/settings?tab=checklists"); await page.locator(".li", { hasText: "Retired couple" }).getByRole("button", { name: "Remove" }).click(); assert.match(text(await page.getByRole("dialog").textContent()), /No client's list came from it/); await page.getByRole("dialog").getByRole("button", { name: "Remove" }).click(); await page.getByText(/^Checklist removed/).waitFor();
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
  await page.goto(W.url + "/hound?tab=ask"); await page.getByRole("heading", { name: "Ask the Hound" }).waitFor(); await page.getByText("It cannot send or change anything.").waitFor();
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
  assert.equal(await page.locator("tbody tr").count(), T.PLANS.length); assert.match(text(await page.locator("tr.sel").textContent()), /Yours/); await page.getByText("Documents checked").waitFor();
  const far = new Date(T.S.now.getTime() + 200 * T.DAY).toISOString().slice(0, 10), near = new Date(T.S.now.getTime() + 30 * T.DAY).toISOString().slice(0, 10);
  await page.getByLabel("Pause until").fill(far); await page.getByRole("button", { name: "Pause", exact: true }).click(); await page.getByRole("alert").getByText(/A pause can last up to 3 months in any 12 months/).waitFor(); assert.equal((await W.state(firmId)).billing().state, "active");
  await page.getByLabel("Pause until").fill(near); await page.getByRole("button", { name: "Pause", exact: true }).click();
  // Paused: every screen but Settings is the lock page, and the plan page offers the way back.
  await page.getByRole("button", { name: "Resume now" }).first().waitFor(); T = await W.state(firmId); assert.equal(T.billing().state, "paused"); assert.equal(T.access().ok, false);
  await page.goto(W.url + "/settings?tab=plan"); await page.getByText(/^Paused until /).waitFor(); await page.getByRole("button", { name: "Resume now" }).click(); await page.getByText("Resumed. Collecting carries on.").waitFor(); assert.equal((await W.state(firmId)).billing().state, "active");
});
