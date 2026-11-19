// Round 9: billing (trial, plans, off-season pause), staff uploads, several documents in one upload,
// files that cannot be opened, and what happens to incoming files while a firm is paused.
const test = require("node:test");
const assert = require("node:assert/strict");
const { firm, started, out, last, item } = require("./helpers");
const { createApp } = require("../packages/core/pipeline");
const { memoryStore, fakeSender, fakeAI } = require("../packages/core/memory");
const { createEngine } = require("../packages/engine");

test("a new firm starts on a 14-day trial with everything working", () => {
  const { T, e } = firm({ plan: undefined });
  assert.equal(T.access().state, "trial"); assert.equal(T.access().daysLeft, 14); assert.equal(T.access().ok, true);
  e.confirmed = true; assert.equal(T.start(e.id) || null, null); assert.ok(out(T, e).length > 0);
});
test("when the trial ends, nothing is sent and nothing can be started until a plan is chosen", () => {
  const { T, c, e } = firm({ plan: undefined });
  T.advance(15 * T.DAY); assert.equal(T.access().state, "expired"); assert.equal(T.access().ok, false);
  e.confirmed = true; const n = T.S.msgs.length; assert.match(String(T.start(e.id)), /plan|trial/i); T.advance(3 * T.DAY);
  assert.equal(T.S.msgs.slice(n).filter((m) => m.dir === "out").length, 0);
  assert.match(String(T.manual(e.id, "Hi Jo")), /plan|trial/i);
  assert.equal(T.choosePlan("Solo"), null); assert.equal(T.access().ok, true); assert.equal(T.S.firm.plan, "Solo");
  assert.equal(T.start(e.id) || null, null); assert.ok(out(T, e).length > 0); assert.ok(c);
});
test("there is no free plan to choose, and a plan too small for the client list is refused", () => {
  const { T } = firm({ plan: undefined });
  assert.ok(T.choosePlan("Free")); assert.equal(T.access().state, "trial");
  assert.deepEqual(T.PLANS.map((p) => p[0]), ["Solo", "Practice", "Firm", "Large"]); assert.ok(T.PLANS.every((p) => p[1] > 0));
  for (let i = 0; i < 151; i++) T.addClient({ first: "A" + i, last: "B" + i, email: "a" + i + "@x.example" });
  assert.ok(T.choosePlan("Solo"), "Solo should not fit 152 clients"); assert.equal(T.planFor(T.S.clients.length), "Practice"); assert.equal(T.choosePlan("Practice"), null);
});
test("the off-season pause stores everything, sends nothing, still honors STOP, and ends by itself", () => {
  const { T, c, e } = started();
  const items = T.itemsOf(e.id).length, until = new Date(T.S.now.getTime() + 60 * T.DAY);
  assert.equal(T.pauseSeason(until), null); assert.equal(T.access().ok, false); assert.equal(T.access().state, "paused");
  const n = T.S.msgs.length; T.advance(30 * T.DAY);
  assert.equal(T.S.msgs.slice(n).filter((m) => m.dir === "out").length, 0, "sent while paused");
  assert.equal(T.itemsOf(e.id).length, items, "the checklist is kept");
  T.inboundText(c.id, "STOP"); assert.equal(last(T, e).tpl, "M16"); assert.equal(c.textConsent, "withdrawn");
  T.advance(31 * T.DAY); assert.equal(T.access().ok, true); assert.equal(T.access().state, "active");
});
test("a pause needs a paid plan and a future date", () => {
  const a = firm({ plan: undefined }); assert.ok(a.T.pauseSeason(new Date(a.T.S.now.getTime() + 30 * a.T.DAY)), "a trial firm cannot pause");
  const { T } = firm(); assert.ok(T.pauseSeason(new Date(T.S.now.getTime() - T.DAY))); assert.ok(T.pauseSeason(new Date(T.S.now.getTime() + 400 * T.DAY)));
  assert.equal(T.pauseSeason(new Date(T.S.now.getTime() + 80 * T.DAY)), null); assert.equal(T.resumeNow(), null); assert.equal(T.access().ok, true);
});
test("billing state survives save and load", () => {
  const { T } = firm(); T.pauseSeason(new Date(T.S.now.getTime() + 90 * T.DAY));
  const U = createEngine(); U.load(T.dump()); assert.equal(U.access().state, "paused"); assert.equal(U.dump(), T.dump());
});
test("a document added by staff is checked and never messages the client", () => {
  const { T, c, e } = started(); const n = out(T, e).length;
  const d = T.staffDoc(c.id, { form: "W2", year: 2026, payer: "Acme Logistics" });
  assert.equal(d.state, "accepted"); assert.equal(d.channel, "staff"); assert.equal(item(T, e, "W2").state, "received"); assert.equal(out(T, e).length, n);
});
test("several documents in one upload are checked one by one and answered once", () => {
  const { T, c, e } = started(); const n = out(T, e).length;
  const res = T.inboundBundle(c.id, [{ form: "W2", year: 2026, payer: "Acme Logistics" }, { form: "1098", year: 2025, payer: "Regions Mortgage" }], "text");
  assert.deepEqual(res.docs.map((d) => d.state), ["accepted", "rejected"]);
  const sent = out(T, e).slice(n); assert.equal(sent.length, 1); assert.equal(sent[0].tpl, "M23"); assert.ok(sent[0].body.length <= 480);
});
test("a locked PDF gets a plain request for an unlocked copy, and the second one goes to staff", () => {
  const { T, c, e } = started();
  T.inboundUnusable(c.id, "locked", "text"); assert.equal(last(T, e).tpl, "M30L"); assert.match(last(T, e).body, /password/); assert.doesNotMatch(last(T, e).body, /send (us )?the password/i);
  const r = T.inboundUnusable(c.id, "locked", "text"); assert.equal(r.handed, true); assert.equal(last(T, e).tpl, "M12");
  assert.ok(T.S.tasks.some((t) => t.status === "open" && /Locked PDF/.test(t.reason)));
});
test("a where-do-I-find-it question about a custom request goes to a person, not a broken sentence", () => {
  const { T, c, e } = started(); T.customSuggest(e.id, "Closing statement for the home sale", true);
  T.itemsOf(e.id).filter((i) => !i.custom).forEach((i) => T.setItem(i.id, "waived", "test")); T.advance(T.DAY);
  T.inboundText(c.id, "where do I find it?");
  assert.ok(out(T, e).every((m) => !/comes from \./.test(m.body)));
});

// pipeline
const FIRM_NO = "+16155550100", JO = "+16155550111", big = Buffer.alloc(40000, 1);
const doc = (form, payer, pages) => ({ pages, is_tax_document: true, form, tax_year: 2026, payer, recipient_name: "JO DAY", key_amount: "$1.00", legibility: 0.95, confidence: 0.97, missing_parts: [], note: "A form" });
async function setup(opt) {
  let t = new Date(2027, 0, 25, 10, 5, 0); const calls = { bundle: 0, single: 0 };
  const ai = fakeAI((prompt) => {
    if (prompt.startsWith("The images are the pages")) { calls.bundle++; return { documents: [doc("W2", "Acme Logistics", [1, 2]), doc("1098", "Regions Mortgage", [3])] }; }
    if (prompt.startsWith("You read photos")) { calls.single++; return doc("W2", "Acme Logistics"); }
    if (prompt.startsWith("You read emails")) return { items: [], question: false, summary: "Sent documents" };
    if (prompt.startsWith("You write one message")) return { text: null };
    return null;
  });
  const store = memoryStore(), sms = fakeSender(), email = fakeSender(), app = createApp({ store, sms, email, ai, clock: () => t });
  await app.createFirm("f1", Object.assign({ plan: "Practice", name: "Test CPAs", email: "docs@test.example", smsNumber: FIRM_NO, senderStatus: "approved", mode: "autopilot", users: [{ id: "u1", first: "Pat", name: "Pat Owner", role: "owner", email: "pat@test.example" }] }, opt));
  await app.staff("f1", "u1", (T) => { T.importRows(T.parseCSV("First,Last,Email,Mobile\nJo,Day,jo@x.example,6155550111")); const e = T.S.engs[0]; T.itemsOf(e.id).find((i) => i.form === "W2").payer = "Acme Logistics"; e.confirmed = true; T.start(e.id); T.giveConsent(T.S.clients[0].id, "page"); });
  const state = () => { const T = createEngine(); T.load(store.read("f1")); return T; };
  return { app, store, sms, email, calls, state, tickTime: (ms) => { t = new Date(t.getTime() + ms); } };
}
test("pipeline: a three-page PDF with two forms becomes two documents and one reply", async () => {
  const x = await setup(); const n = x.sms.sent.length;
  const r = await x.app.inboundSms({ to: FIRM_NO, from: JO, body: "", media: [{ bytes: big, contentType: "application/pdf", pages: [big, big, big] }], providerId: "p1" });
  assert.equal(x.calls.bundle, 1); assert.equal(r.docs.length, 2); assert.equal(r.docs[0], "accepted");
  assert.equal(x.sms.sent.length - n, 1, "one upload should get one reply");
});
test("pipeline: an email signature logo is ignored and the real attachment is read", async () => {
  const x = await setup();
  const r = await x.app.inboundEmail({ to: "docs@test.example", from: "Jo Day <jo@x.example>", body: "Here you go", attachments: [{ bytes: Buffer.alloc(3000, 1), contentType: "image/png", inline: true }, { bytes: big, contentType: "image/jpeg" }], providerId: "e1" });
  assert.deepEqual(r.docs, ["accepted"]); assert.equal(x.calls.single, 1);
});
test("pipeline: a locked PDF is never sent to the model and the client is asked for an unlocked copy", async () => {
  const x = await setup(); const n = x.sms.sent.length;
  const r = await x.app.inboundSms({ to: FIRM_NO, from: JO, body: "", media: [{ bytes: big, contentType: "application/pdf", locked: true }], providerId: "p2" });
  assert.equal(r.unusable, "locked"); assert.equal(x.calls.single + x.calls.bundle, 0); assert.match(x.sms.sent.slice(n).map((m) => m.body).join(" "), /password/);
});
test("pipeline: a Word file is not read and the client is asked for a photo or PDF", async () => {
  const x = await setup();
  const r = await x.app.inboundEmail({ to: "docs@test.example", from: "jo@x.example", body: "", attachments: [{ bytes: big, contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }], providerId: "e2" });
  assert.equal(r.unusable, "type"); assert.equal(x.calls.single, 0);
});
test("pipeline: a staff upload is checked and sends nothing", async () => {
  const x = await setup(); const n = x.sms.sent.length + x.email.sent.length;
  const r = await x.app.staffUpload("f1", "u1", x.state().S.clients[0].id, { bytes: big, contentType: "image/jpeg" });
  assert.deepEqual(r.docs, ["accepted"]); assert.equal(x.sms.sent.length + x.email.sent.length, n);
});
test("pipeline: while paused, an incoming file is stored, not read, and is read after the firm resumes", async () => {
  const x = await setup(); await x.app.staff("f1", "u1", (T) => T.pauseSeason(new Date(T.S.now.getTime() + 30 * T.DAY)));
  const n = x.sms.sent.length, r = await x.app.inboundSms({ to: FIRM_NO, from: JO, body: "", media: [{ bytes: big, contentType: "image/jpeg" }], providerId: "p3" });
  assert.equal(r.held, true); assert.equal(x.calls.single, 0); assert.equal(x.sms.sent.length, n + 1, "the client is told to contact the firm"); assert.match(x.sms.sent[n].body, /contact Test CPAs directly/); assert.equal(x.state().S.held.length, 1);
  assert.equal(await x.app.readHeld("f1", async () => big), 0, "still paused");
  await x.app.staff("f1", "u1", (T) => T.resumeNow());
  assert.equal(await x.app.readHeld("f1", async () => big), 1); assert.equal(x.calls.single, 1); assert.equal(x.state().S.held.length, 0);
  assert.equal(x.state().S.docs.length, 1);
});
