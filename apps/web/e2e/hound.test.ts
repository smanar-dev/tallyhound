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
  await page.getByLabel("Tone").selectOption("brief"); await page.getByText("Saved.", { exact: true }).waitFor(); assert.equal((await W.state(firmId)).S.firm.hound.tone, "brief");
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
