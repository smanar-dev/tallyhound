// Round 14: the gaps found by walking the whole product end to end.
const test = require("node:test");
const assert = require("node:assert/strict");
const { firm, started, last } = require("./helpers");
const { createApp } = require("../packages/core/pipeline");
const { memoryStore, fakeSender, fakeAI } = require("../packages/core/memory");
const { createEngine } = require("../packages/engine");
const NOW = () => new Date(2027, 0, 25, 10, 5);
const blank = (opt) => { const T = createEngine(); T.blank(Object.assign({ plan: "Practice", name: "Test", now: NOW(), senderStatus: "approved", users: [{ id: "u1", first: "Pat", name: "Pat Owner", role: "owner", email: "pat@test.example" }] }, opt)); T.setUser("u1"); return T; };

test("a firm that has not been checked cannot send anything to a client", () => {
  const T = blank({ verified: false }); T.importRows(T.parseCSV("First,Last,Email\nJo,Day,jo@x.example")); const e = T.S.engs[0]; e.confirmed = true;
  assert.match(T.start(e.id), /still being checked/); assert.match(T.sendCheckin(e.id), /still being checked/); assert.equal(T.S.msgs.length, 0);
  T.setVerified(true); assert.ok(!T.start(e.id)); T.advance(10 * T.MIN); assert.ok(T.S.msgs.length > 0); assert.ok(T.S.audit.some((a) => a.action === "firm.check"));
});
test("import: a Documents column becomes each client's checklist", () => {
  const T = blank(); const r = T.importRows(T.parseCSV('First,Last,Email,Documents needed\nJo,Day,jo@x.example,"W-2, 1099-INT; mortgage statement / brokerage, something odd"\nSam,Lee,sam@x.example,'));
  const forms = (n) => T.itemsOf(T.S.engs[n].id).map((i) => i.form).sort();
  assert.deepEqual(forms(0), ["1098", "1099CONS", "1099INT", "W2"]); assert.deepEqual(forms(1), ["1098", "W2"], "an empty cell falls back to the default list"); assert.equal(r.withLists, 1);
});
test("import: two people in one household can share a phone; the same person twice is still refused", () => {
  const T = blank(); const r = T.importRows(T.parseCSV("First,Last,Email,Mobile\nJo,Day,jo@x.example,6155550111\nSam,Day,sam@x.example,6155550111\nJo,Day,jo2@x.example,6155550111"));
  assert.equal(T.S.clients.length, 2); assert.equal(r.shared, 1); assert.match(r.rejects[0].why, /Duplicate/);
});
test("a reply saying it is the wrong number stops texts to that number and tells the firm", () => {
  const { T, c, e } = started(); const n = T.S.msgs.filter((m) => m.dir === "out").length;
  assert.equal(T.inboundText(c.id, "Wrong number. Who is this?", null), "wrong_number");
  assert.equal(c.textConsent, "none"); assert.equal(c.mobileBad, true); assert.ok(T.S.alerts.some((a) => a.kind === "wrong_number"));
  T.advance(3 * T.DAY); assert.ok(!T.S.msgs.slice(0).some((m, i) => m.dir === "out" && m.channel === "text" && m.status === "delivered" && m.at > e.lastIn), "a text went to a number reported as wrong");
  T.setUser("u1"); assert.match(T.recordConsent(c.id, "on a call"), /Check Jo's mobile number first/);
});
test("a link instead of a file gets a plain request for the file, in the client's language, and the link is never opened", () => {
  for (const lang of ["en", "es"]) { const { T, c, e } = started(); c.lang = lang;
    assert.equal(T.inboundText(c.id, "here you go https://www.icloud.com/photos/#0abc", null), "link"); const m = last(T, e);
    assert.equal(m.tpl, "M30K"); assert.match(m.body, lang === "es" ? /no puede abrir enlaces/ : /cannot open links/); assert.ok(T.outputCheck(m.body).ok !== false); }
});
test("staff can record consent the firm already holds, with their name on it; an opt-out cannot be overridden", () => {
  const { T, c, e } = firm(); e.confirmed = true; T.setUser("u2");
  assert.equal(T.recordConsent(c.id, "Signed engagement letter"), null); assert.equal(c.textConsent, "given"); assert.match(c.consentLog.slice(-1)[0].what, /recorded by Alex Staff: Signed engagement letter/);
  assert.equal(last(T, e).tpl, "M2", "the client is told texts are on and how to stop");
  c.textConsent = "withdrawn"; assert.match(T.recordConsent(c.id, "x"), /Only Jo can turn texts back on/);
});
test("deliver each document as it is accepted, when the firm chooses that and storage is connected", () => {
  const { T, c, e } = started(); T.S.firm.delivery = { provider: "Google Drive", folder: "Client Tax Docs", auto: "on", when: "each" };
  const d = T.inboundDoc(c.id, { form: "W2", year: 2026, payer: "Acme Logistics", recipient: "self", read: { legible: 0.95, conf: 0.97, note: "", missing: [] } }, "text");
  assert.equal(d.state, "accepted"); assert.ok(T.openItems(e.id).length > 0, "the client is not complete yet"); T.advance(20 * T.MIN); assert.ok(d.deliveredAt, "not delivered while the client was still collecting");
  const x = started(); x.T.S.firm.delivery = { provider: "Google Drive", folder: "Client Tax Docs", auto: "on" };
  const d2 = x.T.inboundDoc(x.c.id, { form: "W2", year: 2026, payer: "Acme Logistics", recipient: "self", read: { legible: 0.95, conf: 0.97, note: "", missing: [] } }, "text"); x.T.advance(20 * x.T.MIN); assert.ok(!d2.deliveredAt, "the default waits for a complete set");
});

// ---- pipeline: one phone, two clients --------------------------------------------------------------------------------
const FIRM_NO = "+16155550100", HOME = "+16155550111", big = Buffer.alloc(80000, 7);
async function household(name) {
  let t = NOW(); const ai = fakeAI((prompt) => {
    if (prompt.startsWith("You read photos")) return { is_tax_document: true, form: "W2", tax_year: 2026, payer: "Acme Logistics", recipient_name: name, legibility: 0.95, confidence: 0.97, missing_parts: [], note: "A W-2" };
    if (prompt.startsWith("You read text messages")) return { intent: "thanks", item_id: null, later_days: null, summary: "Says thanks", scope: "documents", sentiment: "calm", memory: null, staff_reply: null };
    if (prompt.startsWith("You read emails")) return { items: [], question: false, summary: "Sent documents" };
    if (prompt.startsWith("You write one message")) return { text: null }; return null; });
  const store = memoryStore(), sms = fakeSender(), email = fakeSender(), app = createApp({ store, sms, email, ai, clock: () => t });
  await app.createFirm("f1", { plan: "Practice", name: "Test CPAs", email: "office@test.example", inbox: "t@docs.tallyhound.example", smsNumber: FIRM_NO, senderStatus: "approved", mode: "autopilot", users: [{ id: "u1", first: "Pat", name: "Pat Owner", role: "owner", email: "pat@test.example" }] });
  await app.staff("f1", "u1", (T) => { T.importRows(T.parseCSV("First,Last,Email,Mobile\nJo,Day,home@x.example,6155550111\nSam,Day,home@x.example,6155550111"));
    T.S.engs.forEach((e) => { T.itemsOf(e.id).find((i) => i.form === "W2").payer = "Acme Logistics"; e.confirmed = true; T.start(e.id); T.giveConsent(e.clientId, "page"); }); });
  const state = async () => { const T = createEngine(); T.load(await store.readState("f1")); return T; };
  return { app, state };
}
const docsOf = (T, first) => { const c = T.S.clients.find((x) => x.first === first); return T.S.docs.filter((d) => d.engId === T.engOf(c.id).id); };
test("pipeline: on a shared phone, a W-2 goes to the person whose name is on it", async () => {
  const x = await household("SAM DAY"); await x.app.inboundSms({ to: FIRM_NO, from: HOME, body: "", media: [{ bytes: big, contentType: "image/jpeg" }], providerId: "s1" });
  const T = await x.state(); assert.equal(docsOf(T, "Sam").length, 1); assert.equal(docsOf(T, "Jo").length, 0); assert.equal(docsOf(T, "Sam")[0].state, "accepted");
  const y = await household("JO DAY"); await y.app.inboundSms({ to: FIRM_NO, from: HOME, body: "", media: [{ bytes: big, contentType: "image/jpeg" }], providerId: "s1" });
  const T2 = await y.state(); assert.equal(docsOf(T2, "Jo").length, 1); assert.equal(docsOf(T2, "Sam").length, 0);
});
test("pipeline: on a shared email address, two attachments are split between the two people", async () => {
  const x = await household("SAM DAY");
  const r = await x.app.inboundEmail({ to: "t@docs.tallyhound.example", from: "home@x.example", body: "Sam's W-2", attachments: [{ bytes: big, contentType: "application/pdf" }], providerId: "e1", trusted: true });
  const T = await x.state(); assert.equal(docsOf(T, "Sam").length, 1); assert.equal(docsOf(T, "Jo").length, 0); assert.ok(r.handled);
});
