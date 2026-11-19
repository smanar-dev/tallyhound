// Checks that run over every screen the app has, so a new screen is covered the day it is added to ROUTES.
//   T-52  nothing stored is ever treated as markup
//   T-65  the vocabulary in docs/UX.md, and no screen that starts empty and silent
import { after } from "node:test";
import assert from "node:assert/strict";
import { busyFirmWithDoubt as busyFirm, closeBrowser, scene, type World } from "./world.ts";
import type { Engine } from "../../server/src/kit.ts";

after(closeBrowser);
export const ROUTES = ["/", "/clients", "/needs-you", "/hound", "/add-clients", "/messages", "/progress", "/settings"];
// Every screen for a firm with clients: the fixed ones plus each tab of one client's page.
const TABS = ["", "?tab=suggested", "?tab=documents", "?tab=conversation", "?tab=activity", "?tab=details"];
const routesFor = async (W: World, firmId: string) => { const T: Engine = await W.state(firmId); return ROUTES.concat(TABS.map((t) => "/clients/" + T.S.engs[0].id + t), ["/clients?do=add", "/clients?do=start", "/clients/nobody", "/messages?show=unknown", "/add-clients", "/hound?tab=next", "/hound?tab=drafts", "/hound?tab=rules", "/settings?tab=people", "/settings?tab=checklists", "/settings?tab=wording", "/settings?tab=hours", "/settings?tab=security", "/progress", "/needs-you?show=says_none", "/needs-you?show=document", "/clients/" + T.S.engs[0].id + "?tab=documents&doc=" + T.S.docs[0].id]); };
const PAYLOAD = '"><img src=x onerror="window.__pwned=1"><script>window.__pwned=2</script><b>bold</b>';

scene("T-52: an HTML payload planted in every stored text field shows as text on every screen and never runs", async (W) => {
  const { firmId, ownerId } = await busyFirm(W);
  // Every free-text field a firm, a client, a model or a stranger can fill.
  await W.app.staff(firmId, ownerId, (T: Engine) => {
    const S = T.S, P = PAYLOAD; S.firm.name = "Firm " + P; S.firm.sender = "Sender " + P; S.firm.email = "x" + P + "@docs.test";
    for (const u of S.users) { u.name = "Pat " + P; u.first = "Pat" + P; }
    for (const c of S.clients) { c.first = "Jo" + P; c.last = "Day" + P; c.email = "jo" + P + "@x.example"; c.notes = P; c.entity = P; }
    for (const i of S.items) { i.payer = "Payer " + P; if (i.custom) i.custom = P; i.reason = P; }
    for (const m of S.msgs) { m.body = "Body " + P; m.understood = P; m.by = P; m.why = P; }
    for (const d of S.docs) { d.payer = "Doc " + P; if (d.read) d.read.note = P; }
    for (const t of S.tasks) { t.reason = "Reason " + P; }
    for (const y of S.tray) { y.text = "Tray " + P; y.from = P; y.why = P; }
    for (const a of S.alerts) a.text = "Alert " + P; T.alertx(S.engs[0], "high", "send_failed", "Alert " + P, "inj");
    for (const h of S.hlog) { h.text = P; h.why = P; }
    for (const a of S.audit) { a.detail = P; a.actor = P; }
  });
  await W.auth.setRole(ownerId, "owner");
  const page = await W.signIn("pat1@firm1.test");
  for (const route of await routesFor(W, firmId)) {
    await page.goto(W.url + route); await page.locator(".side .firm").waitFor(); await page.waitForTimeout(50);
    if (route === "/") { await page.getByLabel(/Alerts/).click(); await page.locator(".menu-pop").waitFor(); await page.getByLabel("Find a client").fill("Jo"); await page.locator(".sres").waitFor(); }
    const r = await page.evaluate(() => ({ pwned: (window as unknown as { __pwned?: number }).__pwned, imgs: document.querySelectorAll('img[src="x"]').length, scripts: [...document.querySelectorAll("script")].filter((s) => !s.src).length, bold: [...document.querySelectorAll("b")].filter((b) => b.textContent === "bold").length, text: document.body.innerText }));
    assert.equal(r.pwned, undefined, route + ": the payload ran"); assert.equal(r.imgs, 0, route + ": the payload became an image"); assert.equal(r.scripts, 0, route + ": an inline script is on the page"); assert.equal(r.bold, 0, route + ": the payload became markup");
    if (route === "/") assert.ok(r.text.includes("<img src=x onerror="), "the payload is on screen, as the text it is");
  }
});

// The left column of docs/UX.md's vocabulary table: words that must not come back. "Approvals" and "Handoffs" are retired as names
// for a list; "approval" in a sentence about the carriers is ordinary English and stays.
const BANNED = ["start outreach", "review queue", "review", "inbox", "unmatched tray", "unmatched", "stuck", "waiting on consent", "handoffs", "approvals", "queue", "playbook", "live log", "requirements", "deliver", "latest reasoning", "engagements?"];
for (const busy of [true, false]) scene("T-65: no screen uses a word the vocabulary table retired (" + (busy ? "a busy firm" : "an empty firm") + ")", async (W) => {
  const firmId = busy ? (await busyFirm(W)).firmId : (await W.newFirm()).firmId, page = await W.signIn("pat1@firm1.test");
  for (const route of busy ? await routesFor(W, firmId) : ROUTES) {
    await page.goto(W.url + route); await page.locator(".side .firm").waitFor();
    const seen = (await page.evaluate(() => document.body.innerText + " " + [...document.querySelectorAll("[aria-label],[title],[placeholder]")].map((e) => (e.getAttribute("aria-label") || "") + " " + (e.getAttribute("title") || "") + " " + (e.getAttribute("placeholder") || "")).join(" "))).toLowerCase();
    for (const w of BANNED) assert.ok(!new RegExp("\\b" + w + "\\b").test(seen), route + ' says "' + w + '"');
  }
});

scene("T-65: no screen starts empty and silent: an empty firm sees a sentence on every screen and a way forward", async (W) => {
  await W.newFirm(); const page = await W.signIn("pat1@firm1.test");
  for (const route of ROUTES) {
    await page.goto(W.url + route); await page.locator(".side .firm").waitFor();
    const r = await page.evaluate(() => { const p = document.querySelector(".page")!; return { words: (p as HTMLElement).innerText.trim().split(/\s+/).length, ways: p.querySelectorAll("a[href], button").length }; });
    assert.ok(r.words >= 8, route + " says almost nothing"); assert.ok(r.ways >= 1, route + " offers no way forward");
  }
});
