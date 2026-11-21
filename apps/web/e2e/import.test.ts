// Bringing in a client list (T-24): upload, match columns, check rows, done. What "check rows" promises is what the import does.
import { after } from "node:test";
import assert from "node:assert/strict";
import { busyFirm, closeBrowser, scene } from "./world.ts";
import type { Engine } from "../../server/src/kit.ts";

after(closeBrowser);
const text = (s: string | null) => (s || "").replace(/\s+/g, " ").trim();
const CSV = ["Client Name First,Surname,E-mail Address,Cell,SSN,Fee,Staff", "Ana,Ruiz,ana@x.example,(615) 555-0133,123-45-6789,450,Pat", "No,Contact,,,987-65-4321,300,Pat", "BEN,OKAFOR,ben@x.example,615.555.0144,111-22-3333,275,Pat", ",,nobody@x.example,,,,"].join("\n");

scene("T-24: a firm's export is imported in four steps, sensitive columns are never read, and the preview is what happens", async (W) => {
  const { firmId } = await W.newFirm(), page = await W.signIn("pat1@firm1.test"); await page.locator(".gs.cur").getByRole("link", { name: "Import a list" }).click(); await page.getByText("Where is your client list today?").waitFor();
  await page.getByRole("button", { name: "Drake Tax" }).click(); assert.match(text(await page.locator(".steps-list").textContent()), /Report Manager/);
  await page.locator('input[type="file"]').setInputFiles({ name: "clients.xlsx", mimeType: "application/vnd.ms-excel", buffer: Buffer.from("PK") }); await page.getByText(/Save it as CSV first/).waitFor();
  await page.locator('input[type="file"]').setInputFiles({ name: "clients.csv", mimeType: "text/csv", buffer: Buffer.from(CSV) });
  // Step 2: the guesses, and the two columns that are never read.
  await page.getByText("Tallyhound guessed each column.").waitFor(); const rows = page.locator("tbody tr");
  assert.equal(await rows.count(), 7); assert.match(text(await rows.nth(4).textContent()), /SSN ?hidden ?Never imported/); assert.match(text(await rows.nth(5).textContent()), /Fee ?hidden ?Never imported/);
  assert.equal(await page.getByLabel("Use Surname as").inputValue(), "last"); assert.equal(await page.getByLabel("Use Cell as").inputValue(), "mobile");
  assert.ok(!(await page.locator(".page").textContent())!.includes("123-45-6789"), "a Social Security number is never shown");
  await page.getByLabel("Use Staff as").selectOption("preparer"); await page.getByRole("button", { name: "Check 4 rows" }).click();
  // Step 3: a dry run of the engine's own import.
  await page.getByText("2 new").waitFor(); assert.match(text(await page.locator(".chip.bad").first().textContent()), /2 will be left out/);
  const results = (await page.locator("tbody tr td:nth-child(3)").allTextContents()).map(text); assert.deepEqual(results, ["Ready", "Needs an email or a mobile number", "Ready", "Name missing"]);
  assert.equal((await W.state(firmId)).S.clients.length, 0, "checking rows saves nothing");
  await page.getByRole("button", { name: "Import 2 clients" }).click(); await page.getByRole("heading", { name: "2 clients imported" }).waitFor();
  assert.match(text(await page.locator(".empty").textContent()), /2 rows were left out\. Never imported: SSN, Fee\./);
  const T: Engine = await W.state(firmId); assert.deepEqual(T.S.clients.map((c: { first: string; last: string; mobile: string }) => [c.first, c.last, c.mobile]), [["Ana", "Ruiz", "6155550133"], ["Ben", "Okafor", "6155550144"]], "names in capitals are tidied");
  assert.ok(!JSON.stringify(T.S).match(/123-45-6789|111-22-3333|"450"|987-65/), "nothing from the sensitive columns reached the firm's state"); assert.equal(T.S.clients[0].preparer, T.S.users[0].id);
  await page.getByRole("link", { name: "See new clients" }).click(); await page.locator("table.ctbl").waitFor(); assert.equal(await page.locator("tbody tr").count(), 2);
});

scene("importing the same list again updates what changed and adds only who is new; 200 rows go in at once", async (W) => {
  const { firmId } = await busyFirm(W), page = await W.signIn("pat1@firm1.test"); await page.goto(W.url + "/add-clients"); await page.getByRole("button", { name: "Or paste the rows instead" }).click();
  const many = Array.from({ length: 200 }, (_, i) => "Pat" + i + ",Tester" + i + ",t" + i + "@bulk.example,615556" + String(1000 + i)).join("\n");
  await page.getByLabel("Paste your client list here").fill("First,Last,Email,Mobile\nJo,Day,jo@x.example,6155550111\n" + many); await page.getByRole("button", { name: "Continue" }).click(); await page.getByRole("button", { name: "Check 201 rows" }).click();
  await page.getByText("200 new").waitFor(); assert.match(text(await page.locator(".card.pad").textContent()), /1 already here, unchanged|1 will be left out/);
  const t0 = Date.now(); await page.getByRole("button", { name: /^Import 200 clients/ }).click(); await page.getByRole("heading", { name: /^200 clients imported/ }).waitFor(); const ms = Date.now() - t0;
  const T: Engine = await W.state(firmId); assert.equal(T.S.clients.length, 203); assert.ok(ms < 5000, "200 clients took " + ms + " ms");
  await page.getByRole("link", { name: "See new clients" }).click(); await page.locator("table.ctbl").waitFor(); assert.equal(await page.locator("tbody tr").count(), 200, "the list shows 200 at a time"); assert.match(text(await page.locator(".card").last().textContent()), /Showing 200 of 201/);
});

scene("unknown senders: a person says whose it is and it is checked as that client's, or it is discarded; every message in is listed", async (W) => {
  const { firmId } = await busyFirm(W);
  // A spouse texts a W-2 from a number nobody has on file.
  W.reading.doc = { ...W.CLEAN_W2, payer: "Bluebird Cafe", recipient_name: "SAM LEE" }; await W.app.inboundSms({ to: "+16155550101", from: "+16155550177", body: "", media: [{ bytes: Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(3000, 3)]), contentType: "image/jpeg" }], providerId: "u1" });
  const page = await W.signIn("pat1@firm1.test"); await page.locator(".side").getByRole("link", { name: /All messages/ }).click(); await page.getByText("Every text, email and upload from clients").waitFor();
  assert.match(text(await page.locator(".card .list").textContent()), /Jo Day.*Text.*I don't have a mortgage statement this year/); assert.match(text(await page.locator(".card .list").textContent()), /Read as: /);
  await page.getByRole("tab", { name: /Unknown senders/ }).click(); const cards = page.locator(".card.pad"); await cards.nth(1).waitFor(); assert.equal(await cards.count(), 2, "the stranger's email and the unmatched photo");
  const photo = cards.filter({ hasText: "W-2" }); assert.match(text(await photo.textContent()), /From \(615\) 555-0177/, "the number it really came from");
  await photo.getByLabel("Whose is this?").selectOption({ label: "Sam Lee" }); await photo.getByLabel(/Remember this sender/).check(); await photo.getByRole("button", { name: "Assign and check" }).click(); await page.getByText(/^Assigned to Sam and checked.*remembered as Sam's second contact/).waitFor();
  let T: Engine = await W.state(firmId); assert.deepEqual(T.S.clients.find((c: { first: string }) => c.first === "Sam").also.map((x: { kind: string; value: string }) => [x.kind, x.value]), [["mobile", "6155550177"]]); const sam = T.S.engs.find((e: { clientId: string }) => T.client(e.clientId).first === "Sam"); assert.equal(T.S.docs.filter((d: { engId: string }) => d.engId === sam.id).length, 1, "the document is now in Sam's file"); assert.equal(T.S.tray.length, 1);
  await cards.first().getByRole("button", { name: "Discard" }).click(); await page.getByText("Everything that arrived was matched to a client.").waitFor(); T = await W.state(firmId); assert.equal(T.S.tray.length, 0); assert.ok(T.S.audit.some((a: { action: string }) => a.action === "unknown.assigned"));
});

scene("settings: an owner changes the firm's details and manages who can sign in; staff cannot open it", async (W) => {
  const { firmId } = await busyFirm(W), page = await W.signIn("pat1@firm1.test"); await page.locator(".side").getByRole("link", { name: "Settings" }).click(); await page.getByRole("heading", { name: "Your firm" }).waitFor();
  await page.getByLabel("Office phone").fill("(615) 555-0100"); await page.getByLabel("Name at the start of every text").fill("Test CPAs"); await page.getByRole("button", { name: "Save" }).click(); await page.getByText("Saved.", { exact: true }).waitFor();
  let T: Engine = await W.state(firmId); assert.equal(T.S.firm.sender, "Test CPAs"); assert.equal(T.S.firm.email, "test1@docs.tallyhound.test", "the Tallyhound address is not changed"); assert.match(text(await page.locator(".note.info").textContent()), /Clients see: “Hi Maria, Test CPAs here\./);
  await page.getByRole("tab", { name: "People" }).click(); await page.getByText("You are the only owner.").waitFor();
  await page.getByRole("button", { name: "Add a person" }).click(); const dlg = page.getByRole("dialog"); await dlg.getByLabel("Name").fill("Alex Staff"); await dlg.getByLabel("Work email").fill("pat1@firm1.test"); await dlg.getByRole("button", { name: "Add", exact: true }).click();
  await dlg.getByRole("alert").waitFor(); assert.match(text(await dlg.getByRole("alert").textContent()), /already has an account/); await dlg.getByLabel("Work email").fill("alex@firm1.test"); await dlg.getByRole("button", { name: "Add", exact: true }).click(); await dlg.waitFor({ state: "detached" });
  await page.getByLabel("What Alex Staff can do").waitFor(); T = await W.state(firmId); assert.ok(T.S.users.some((u: { name: string; role: string }) => u.name === "Alex Staff" && u.role === "staff"));
  assert.equal(await page.getByLabel("What Pat Owner can do").isDisabled(), true, "an owner cannot demote themselves by accident");
  // Alex signs in, cannot reach Settings, and is signed out when their role changes.
  const alex = await W.signIn("alex@firm1.test"); assert.equal(await alex.locator(".side .nav", { hasText: "Settings" }).count(), 0); await alex.goto(W.url + "/settings"); await alex.getByText("Settings are for owners.").waitFor();
  await page.getByLabel("What Alex Staff can do").selectOption("read_only"); await page.getByText(/Alex Staff is now read-only and has been signed out everywhere/).waitFor();
  await alex.goto(W.url + "/clients"); await alex.waitForURL("**/signin");
  await page.locator("tr", { hasText: "Alex Staff" }).getByRole("button", { name: "Remove" }).click(); await page.getByRole("dialog").getByRole("button", { name: "Remove" }).click(); await page.getByText("Alex Staff can no longer sign in.").waitFor();
  const us = await W.auth.usersOfFirm(firmId); assert.equal(us.filter((u) => !u.leftAt).length, 1); assert.equal(us.length, 2, "switched off, not deleted");
  // T-107: the owner lets one named support person look for a set time, sees until when, and ends it.
  await page.getByRole("button", { name: "Let support in" }).click(); const sd = page.getByRole("dialog"); await sd.getByLabel("Support person's name").fill("Sam Help"); await sd.getByLabel("Their Tallyhound email").fill("sam@tallyhound.test"); await sd.getByLabel("For how long").selectOption("24");
  await sd.getByRole("button", { name: "Let them in" }).click(); await sd.waitFor({ state: "detached" }); const row = page.locator("tr", { hasText: "Sam Help (Tallyhound support)" }); await row.getByText("Can look only").waitFor(); assert.match(text(await row.textContent()), /Until .*Every visit is written in the audit trail/);
  const sam = (await W.auth.usersOfFirm(firmId)).find((u) => u.email === "sam@tallyhound.test")!; assert.equal(sam.role, "read_only"); assert.ok(sam.supportUntil);
  await row.getByRole("button", { name: "End now" }).click(); await page.getByRole("dialog").getByRole("button", { name: "Remove" }).click(); await page.getByText("Sam Help (Tallyhound support) can no longer sign in.").waitFor();
  await page.getByText(/No longer here: Alex Staff/).waitFor(); assert.equal(await page.locator("tr", { hasText: "Alex Staff" }).count(), 0);
});
