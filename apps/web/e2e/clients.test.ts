// The Clients screen and the three dialogs that get a firm collecting (T-16 list, T-38, T-39, docs/UX.md rules 1 and 6).
import { after } from "node:test";
import assert from "node:assert/strict";
import { busyFirm, closeBrowser, scene } from "./world.ts";
import type { Engine } from "../../server/src/kit.ts";

after(closeBrowser);
const text = (s: string | null) => (s || "").replace(/\s+/g, " ").trim();

scene("first run: from an empty firm to a client being contacted, in twelve clicks or fewer and without a word of help", async (W) => {
  const { firmId } = await W.newFirm(), page = await W.signIn("pat1@firm1.test"); let clicks = 0;
  // A click on whatever is in front: the open dialog if there is one, otherwise the page.
  const click = async (name: string | RegExp, role: "button" | "link" = "button") => { clicks++; const d = page.getByRole("dialog"); await ((await d.count()) ? d : page).getByRole(role, { name }).first().click(); };
  await click("Add one client", "link"); const dlg = page.getByRole("dialog", { name: "Add a client" }); await dlg.waitFor();
  // T-38: a refused add shows the engine's reason in the dialog and saves nothing.
  await dlg.getByLabel("First name").fill("Jo"); await dlg.getByLabel("Last name").fill("Day"); await click("Add client");
  await dlg.getByRole("alert").waitFor(); assert.ok(text(await dlg.getByRole("alert").textContent()).length > 10); assert.equal((await W.state(firmId)).S.clients.length, 0, "nothing was saved");
  await dlg.getByLabel("Email").fill("jo@x.example"); await dlg.getByLabel("Mobile").fill("6155550111"); await click("Add client");
  await page.waitForURL("**/clients/**"); let T: Engine = await W.state(firmId); assert.equal(T.S.clients.length, 1); assert.ok(T.itemsOf(T.S.engs[0].id).length > 0, "the client has a checklist");
  await click("Home", "link"); assert.equal(text(await page.locator(".gs.cur b").first().textContent()), "Give each client a checklist");
  await click(/Choose a checklist for all 1/, "link"); await page.getByRole("dialog").waitFor(); await click("Assign");
  await page.getByRole("dialog").waitFor({ state: "detached" }); T = await W.state(firmId); assert.equal(T.S.engs[0].confirmed, true);
  await click("Home", "link"); assert.equal(text(await page.locator(".gs.cur b").first().textContent()), "Start collecting");
  await click(/Start collecting for 1 client/, "link"); const wiz = page.getByRole("dialog", { name: "Start collecting" }); await wiz.waitFor();
  assert.match(text(await wiz.textContent()), /Jo Day · \d+ documents · email invitation/); await click("Continue");
  assert.match(text(await wiz.locator(".pb").textContent()), /^Hi Jo, it's .* at Test CPAs 1/, "the preview is the engine's own first message");
  await click("Continue"); assert.match(text(await wiz.textContent()), /Tallyhound will contact 1 client/); await click(/^Start 1$/);
  await wiz.waitFor({ state: "detached" }); T = await W.state(firmId);
  assert.notEqual(T.S.engs[0].status, "not_started", "collecting has started"); assert.ok(T.S.msgs.some((m: { dir: string }) => m.dir === "out"), "and the first message exists");
  assert.equal(await page.locator(".gs").count(), 0, "the three steps are gone once someone has been started");
  assert.ok(clicks <= 12, "it took " + clicks + " clicks; docs/UX.md rule 1 allows 12");
});

scene("the client list filters like the engine counts, and one action reaches everyone selected", async (W) => {
  const { firmId } = await busyFirm(W), page = await W.signIn("pat1@firm1.test"), T0: Engine = await W.state(firmId);
  await page.locator(".side").getByRole("link", { name: "Clients", exact: true }).click(); await page.locator("table.ctbl").waitFor();
  const count = (st: string) => T0.S.engs.filter((e: { status: string }) => e.status === st).length;
  const pills = Object.fromEntries((await page.locator(".pills button").evaluateAll((els) => els.map((e) => [e.firstChild!.textContent, +e.querySelector("span")!.textContent!]))) as [string, number][]);
  assert.equal(pills.All, 3); assert.equal(pills["Not started"], count("not_started")); assert.equal(pills["Waiting for OK to text"], count("awaiting_consent")); assert.equal(pills["Needs you"], 1);
  assert.deepEqual((await page.locator("tbody tr td:nth-child(2) b").allTextContents()).map(text), ["Jo Day", "Sam Lee", "Ana Ruiz"], "whoever needs you comes first, then by last name");
  await page.getByRole("button", { name: /^Not started/ }).click(); await page.waitForURL("**show=not_started"); await page.locator("tbody tr").nth(1).waitFor({ state: "detached" }); assert.deepEqual((await page.locator("tbody tr td:nth-child(2) b").allTextContents()).map(text), ["Ana Ruiz"]);
  assert.match(text(await page.locator("tbody tr").textContent()), /Confirm the checklist/);
  await page.getByLabel("Filter clients").fill("zzz"); await page.getByText("No clients match.").waitFor(); await page.getByRole("button", { name: "Clear filters" }).click(); await page.locator("tbody tr").nth(2).waitFor(); assert.equal(await page.locator("tbody tr").count(), 3);
  // Select everyone, give them all one checklist without confirming, in one request.
  await page.getByLabel("Select all shown").check(); assert.match(text(await page.locator(".bulkbar").textContent()), /^3 selected/);
  const acts: string[] = []; page.on("request", (r) => { if (r.url().endsWith("/api/act")) acts.push(r.postData() || ""); });
  await page.getByRole("button", { name: "Choose a checklist" }).click(); const dlg = page.getByRole("dialog"); await dlg.getByLabel(/Confirm the checklists/).uncheck(); await dlg.getByRole("button", { name: "Assign" }).click(); await dlg.waitFor({ state: "detached" });
  assert.equal(acts.length, 1, "three clients, one request"); assert.equal(JSON.parse(acts[0]!).calls.length, 3); assert.equal(await page.locator(".bulkbar").count(), 0, "the selection is cleared");
  // Confirm and start Ana from the list.
  await page.getByLabel("Select Ana Ruiz").check(); await page.getByRole("button", { name: "Confirm checklists" }).click(); await page.getByText(/^Confirmed 1/).waitFor();
  let T: Engine = await W.state(firmId); const ana = T.S.engs.find((e: { clientId: string }) => T.client(e.clientId).first === "Ana"); assert.equal(ana.confirmed, true); assert.ok(T.S.audit.some((a: { action: string }) => a.action === "checklist.confirm"));
  await page.getByRole("button", { name: /Start collecting \(1\)/ }).click(); const wiz = page.getByRole("dialog", { name: "Start collecting" }); await wiz.getByRole("button", { name: "Continue" }).click(); await wiz.getByRole("button", { name: "Continue" }).click(); await wiz.getByRole("button", { name: /^Start 1$/ }).click(); await wiz.waitFor({ state: "detached" });
  T = await W.state(firmId); assert.notEqual(T.S.engs.find((e: { id: string }) => e.id === ana.id).status, "not_started"); assert.equal(await page.getByRole("button", { name: /Start collecting \(/ }).count(), 0, "the button goes when nobody is left to start (rule 6)");
  // Keyboard: Enter on a row opens the client; Escape closes a dialog and gives the focus back.
  await page.locator("tbody tr").first().focus(); await page.keyboard.press("Enter"); await page.waitForURL("**/clients/**"); await page.goBack();
  const add = page.getByRole("button", { name: "Add client" }); await add.click(); await page.getByRole("dialog").waitFor(); assert.equal(await page.evaluate(() => (document.activeElement as HTMLElement).closest("[role=dialog]") !== null), true, "focus is inside the dialog");
  await page.keyboard.press("Escape"); await page.getByRole("dialog").waitFor({ state: "detached" }); assert.equal(await add.evaluate((el) => el === document.activeElement), true, "and returns to the button that opened it");
});

scene("a read-only person sees the list and nothing that changes it", async (W) => {
  const { firmId, ownerId } = await busyFirm(W); await W.firms.addUser(firmId, (await W.auth.userById(ownerId))!, { name: "Sam Reader", email: "reader@firm1.test", role: "read_only" });
  const page = await W.signIn("reader@firm1.test"); await page.goto(W.url + "/clients?do=add"); await page.locator("table.ctbl").waitFor();
  assert.equal(await page.locator("tbody tr").count(), 3); assert.equal(await page.locator("input[type=checkbox]").count(), 0); assert.equal(await page.getByRole("dialog").count(), 0, "the address cannot open a dialog either");
  assert.equal(await page.getByRole("button", { name: /Add client|Start collecting/ }).count(), 0);
});
