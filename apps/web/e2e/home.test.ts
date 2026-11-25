// The staff web app in a real browser, against the real web service: sign-in, the shell, Home.
import { after } from "node:test";
import assert from "node:assert/strict";
import { busyFirm, closeBrowser, scene } from "./world.ts";
import type { Engine } from "../../server/src/kit.ts";

after(closeBrowser);
const text = (s: string | null) => (s || "").replace(/\s+/g, " ").trim();

scene("web: a new owner signs in through the screens and lands on a Home that says what to do first", async (W) => {
  await W.newFirm(1, false); const page = await W.signIn("pat1@firm1.test");
  assert.match(text(await page.locator("h1").textContent()), /^Good (morning|afternoon|evening), Pat$/);
  assert.equal(text(await page.locator(".side .firm b").textContent()), "Test CPAs 1");
  assert.match(text(await page.locator(".banner.info").textContent()), /Nothing is sent to clients until it is done/, "an unchecked firm is told why nothing sends");
  // docs/UX.md rule 2: three numbered steps, and only the current one has a button. Rule 6: no primary button that cannot do anything.
  const steps = page.locator(".gs"); assert.equal(await steps.count(), 3); assert.equal(await page.locator(".gs.cur").count(), 1);
  assert.equal(await page.locator(".gs:not(.cur) .btn").count(), 0); assert.deepEqual((await page.locator(".gs.cur .btn").allTextContents()).map(text), ["Add clients", "Add one client"]);
  assert.equal(await page.getByRole("button", { name: /Go fetch/ }).count(), 0);
  assert.equal(await page.locator(".pipe").count(), 0, "no counts for a firm with no clients");
  // The menu: four things, then More (rule 4). Settings is the owner's.
  assert.deepEqual((await page.locator(".side nav .nav").allTextContents()).map(text), ["Home", "Clients", "Review queue", "The hound", "Add clients", "All messages", "Progress", "How it works", "Settings"]);
  await page.locator(".side").getByRole("link", { name: "Add clients" }).click(); await page.getByText("Where is your client list today?").waitFor(); assert.equal(await page.title(), "Add clients · Tallyhound");
  await page.locator(".side").getByRole("link", { name: "Progress" }).click(); await page.getByText("Nothing to measure yet.").waitFor();
  await page.getByRole("button", { name: "Sign out" }).click(); await page.waitForURL("**/signin"); await page.goto(W.url + "/"); await page.waitForURL("**/signin");
});

scene("web: Home shows what the engine holds, and waiving from Home changes the engine, not just the screen", async (W) => {
  const { firmId } = await busyFirm(W), page = await W.signIn("pat1@firm1.test"), T: Engine = await W.state(firmId);
  // T-41: the five counts are the engine's own, each a link.
  const want = T.pipeline().map((p: { n: number; label: string }) => p.n + " " + p.label), got = await page.locator(".pstep").evaluateAll((els) => els.map((e) => e.querySelector("b")!.textContent + " " + e.querySelector("span:not(.pn)")!.textContent));
  assert.deepEqual(got, want); assert.equal(await page.locator("a.pstep").count(), 5);
  assert.match(text(await page.locator(".side .firm span").textContent()), /3 clients/);
  // Needs you: Jo said she has no mortgage statement.
  const row = page.locator(".card", { hasText: "Review queue" }).first().locator(".li", { hasText: "Jo Day" }); assert.match(text(await row.textContent()), /Says they don't have a document/);
  assert.equal(text(await page.locator(".side .nav", { hasText: "Review queue" }).locator(".n").textContent()), "1");
  assert.match(text(await page.locator(".feed").textContent()), /Jo Day sent a W-2 wage statement from Acme Logistics Passed the sniff test/);
  assert.match(text(await page.locator(".card", { hasText: "from an unknown sender" }).last().textContent()), /1 message from an unknown sender/);
  await row.getByRole("button", { name: "Not needed this year" }).click(); await row.waitFor({ state: "detached" });
  const after = await W.state(firmId); assert.equal(after.S.tasks.filter((t: { status: string }) => t.status === "open").length, 0); assert.equal(after.S.items.find((i: { form: string }) => i.form === "1098").state, "waived");
  assert.ok(after.S.audit.some((a: { actor: string }) => a.actor === "Pat Owner"), "and the audit trail names who did it");
  // Client search finds by name and by phone.
  await page.getByLabel("Find a client").fill("0122"); assert.match(text(await page.locator(".sres").textContent()), /Sam Lee/);
  await page.getByLabel("Find a client").fill("zzz"); assert.match(text(await page.locator(".sres").textContent()), /No client matches/);
});

scene("web: a read-only person can look at Home and is offered nothing that changes anything", async (W) => {
  const { firmId, ownerId } = await busyFirm(W); await W.firms.addUser(firmId, (await W.auth.userById(ownerId))!, { name: "Sam Reader", email: "reader@firm1.test", role: "read_only" });
  const page = await W.signIn("reader@firm1.test");
  const row = page.locator(".card", { hasText: "Review queue" }).first().locator(".li", { hasText: "Jo Day" }); await row.waitFor();
  assert.equal(await row.locator("button.btn.sm").count(), 0, "no Waive or Ask again"); assert.equal(await page.locator(".side .nav", { hasText: "Settings" }).count(), 0); assert.equal(await page.locator(".gs").count(), 0);
  assert.match(text(await page.locator(".who").textContent()), /Sam Reader ?Read-only/);
});

scene("web: the layout holds on a phone-width screen, with the menu behind a button", async (W) => {
  await busyFirm(W); const page = await W.signIn("pat1@firm1.test", { width: 390, height: 800 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, "nothing pushes the page wider than the screen");
  await page.getByRole("button", { name: "Menu" }).click(); await page.locator(".side.open").waitFor(); await page.locator(".side").getByRole("link", { name: "Clients", exact: true }).click(); await page.locator("table.ctbl").waitFor();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, "the client list scrolls inside its card, not the page");
  assert.equal(await page.locator(".side.open").count(), 0, "choosing a screen closes the menu");
});
