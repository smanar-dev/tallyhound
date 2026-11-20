const test = require("node:test");
const assert = require("node:assert/strict");
const { createApp } = require("../packages/core/pipeline");
const { memoryStore, fakeSender, fakeAI } = require("../packages/core/memory");
const { createEngine } = require("../packages/engine");

const FIRM_NO = "+16155550100", JO = "+16155550111";
// A model stand-in that answers each kind of prompt the way the real one is asked to.
const model = (over) => fakeAI((prompt, opts) => {
  if (over) { const r = over(prompt, opts); if (r !== undefined) return r; }
  if (prompt.startsWith("You read photos")) return { is_tax_document: true, form: "W2", tax_year: 2026, payer: "Acme Logistics", recipient_name: "JO DAY", key_amount: "$52,310.00", legibility: 0.95, confidence: 0.97, missing_parts: [], note: "A W-2 from Acme Logistics" };
  if (prompt.startsWith("You read text messages")) return { intent: "thanks", item_id: null, later_days: null, summary: "Says thanks", scope: "documents", sentiment: "calm", memory: null, staff_reply: null };
  if (prompt.startsWith("You read emails")) return { items: [], question: false, summary: "Sent documents" };
  if (prompt.startsWith("You write one message")) return { text: null };
  return null;
});
async function setup(ai, mode) {
  let t = new Date(2027, 0, 25, 10, 5, 0); const clock = () => t, tickTime = (ms) => { t = new Date(t.getTime() + ms); };
  const store = memoryStore(), sms = fakeSender(), email = fakeSender();
  const app = createApp({ store, sms, email, ai, clock });
  await app.createFirm("f1", { name: "Test CPAs", email: "docs@test.example", smsNumber: FIRM_NO, senderStatus: "approved", mode: mode || "autopilot", users: [{ id: "u1", first: "Pat", name: "Pat Owner", role: "owner", email: "pat@test.example" }] });
  await app.staff("f1", "u1", (T) => { T.importRows(T.parseCSV("First,Last,Email,Mobile\nJo,Day,jo@x.example,6155550111")); const e = T.S.engs[0]; T.itemsOf(e.id)[0].payer = "Acme Logistics"; e.confirmed = true; T.start(e.id); });
  const state = () => { const T = createEngine(); T.load(store.read("f1")); return T; };
  return { app, store, sms, email, tickTime, state };
}

test("starting outreach really sends the invitation email, once", async () => {
  const x = await setup(null); assert.equal(x.email.sent.length, 1); assert.equal(x.email.sent[0].to, "jo@x.example");
  await x.app.tick("f1"); assert.equal(x.email.sent.length, 1, "sent the same message twice");
});
test("consent, then a texted photo: read by the model, accepted, thanked, next item requested", async () => {
  const x = await setup(model());
  await x.app.staff("f1", "u1", (T) => T.giveConsent(T.S.clients[0].id, "page")); x.tickTime(5 * 60000); await x.app.tick("f1");
  assert.ok(x.sms.sent.some((m) => /W-2/.test(m.body) && m.to === "6155550111" && m.from === FIRM_NO));
  const r = await x.app.inboundSms({ to: FIRM_NO, from: JO, body: "", media: [{ bytes: Buffer.from("fake image"), contentType: "image/jpeg" }] });
  assert.deepEqual(r.docs, ["accepted"]); assert.equal(x.store.files.size, 1);
  assert.match(x.sms.sent.slice(-1)[0].body, /mortgage/i);
  const T = x.state(); assert.ok(T.S.docs[0].fileKey); assert.ok(T.S.msgs.filter((m) => m.dir === "out").every((m) => m.sentAt));
});
test("the model's reading of a text drives the engine", async () => {
  const x = await setup(model((p) => (p.startsWith("You read text messages") ? { intent: "question", item_id: null, summary: "Asks about estimated payments", scope: "tax_question", sentiment: "calm", memory: "Away until Feb 8", staff_reply: "Happy to go over that when we meet." } : undefined)));
  await x.app.staff("f1", "u1", (T) => T.giveConsent(T.S.clients[0].id, "page"));
  const r = await x.app.inboundSms({ to: FIRM_NO, from: JO, body: "Do I need to make estimated payments?" });
  assert.equal(r.intent, "question"); const T = x.state(), t = T.S.tasks.find((k) => k.kind === "question");
  assert.equal(t.category, "tax_question"); assert.equal(t.suggest, "Happy to go over that when we meet."); assert.ok(T.S.engs[0].memory.some((m) => /Feb 8/.test(m.text)));
});
test("a model draft that breaks the rules never reaches the client", async () => {
  const x = await setup(model((p) => (p.startsWith("You write one message") ? { text: "Hi Jo! Send your W-2 and we will get you a big refund." } : undefined)));
  await x.app.staff("f1", "u1", (T) => T.giveConsent(T.S.clients[0].id, "page")); x.tickTime(5 * 60000); await x.app.tick("f1");
  assert.ok(x.sms.sent.length > 0); assert.ok(!x.sms.sent.some((m) => /refund/i.test(m.body)));
});
test("if the model is down, the standard wording goes out", async () => {
  const x = await setup(fakeAI(() => { throw new Error("model unavailable"); }));
  await x.app.staff("f1", "u1", (T) => T.giveConsent(T.S.clients[0].id, "page")); x.tickTime(5 * 60000); await x.app.tick("f1");
  assert.ok(x.sms.sent.some((m) => /W-2/.test(m.body)));
});
test("copilot: nothing but consent replies is sent until a person approves", async () => {
  const x = await setup(null, "copilot");
  await x.app.staff("f1", "u1", (T) => T.giveConsent(T.S.clients[0].id, "page")); x.tickTime(5 * 60000); await x.app.tick("f1");
  assert.equal(x.sms.sent.length, 1, "only the consent confirmation should have gone");
  await x.app.staff("f1", "u1", (T) => { const m = T.S.msgs.find((k) => k.status === "approval"); return T.approveMsg(m.id, m.body); });
  assert.equal(x.sms.sent.length, 2);
});
test("a failed send is flagged, not lost and not retried forever", async () => {
  const x = await setup(null); x.sms.send = async () => { throw new Error("carrier rejected"); };
  await x.app.staff("f1", "u1", (T) => T.giveConsent(T.S.clients[0].id, "page"));
  const T = x.state(); assert.ok(T.S.msgs.some((m) => m.status === "failed")); assert.ok(T.S.alerts.some((a) => a.kind === "send_failed"));
});
test("a text from an unknown number goes to the unmatched tray", async () => {
  const x = await setup(null); await x.app.inboundSms({ to: FIRM_NO, from: "+16155559999", body: "here is my w2" });
  assert.equal(x.state().S.tray.length, 1);
});
test("an email with an attachment and a note gets one reply", async () => {
  const x = await setup(model()); const n = x.email.sent.length;
  const r = await x.app.inboundEmail({ to: "docs@test.example", from: "jo@x.example", body: "W-2 attached.", attachments: [{ bytes: Buffer.from("pdf"), contentType: "application/pdf" }] });
  assert.deepEqual(r.docs, ["accepted"]); assert.equal(x.email.sent.length, n + 1);
});
test("two things arriving at once for one firm are handled one after the other", async () => {
  const x = await setup(null); await x.app.staff("f1", "u1", (T) => T.giveConsent(T.S.clients[0].id, "page"));
  await Promise.all([x.app.inboundSms({ to: FIRM_NO, from: JO, body: "where do I find that?" }), x.app.inboundSms({ to: FIRM_NO, from: JO, body: "thanks" }), x.app.tick("f1")]);
  assert.equal(x.state().S.msgs.filter((m) => m.dir === "in").length, 2);
});

// ---- round 4 ----
test("a webhook the provider delivers twice is processed once", async () => {
  const x = await setup(model());
  await x.app.staff("f1", "u1", (T) => T.giveConsent(T.S.clients[0].id, "page")); x.tickTime(5 * 60000); await x.app.tick("f1");
  const msg = { to: FIRM_NO, from: JO, body: "", media: [{ bytes: Buffer.from("fake image"), contentType: "image/jpeg" }], providerId: "SM123" };
  await x.app.inboundSms(msg); const n = x.sms.sent.length, docs = x.state().S.docs.length;
  const again = await x.app.inboundSms(msg);
  assert.equal(again.duplicate, true); assert.equal(x.sms.sent.length, n, "replied twice"); assert.equal(x.state().S.docs.length, docs, "stored the photo twice");
});
test("an email from 'Jo Day <JO@X.EXAMPLE>' is matched to Jo", async () => {
  const x = await setup(model());
  const r = await x.app.inboundEmail({ to: "Docs <docs@test.example>", from: "Jo Day <JO@X.EXAMPLE>", body: "Here you go", attachments: [], providerId: "<m1@mail>" });
  assert.ok(r.client, "not matched"); assert.equal(x.state().S.tray.length, 0);
});
test("when the carrier says the number is unsubscribed, text consent is withdrawn", async () => {
  const x = await setup(null);
  await x.app.staff("f1", "u1", (T) => T.giveConsent(T.S.clients[0].id, "page"));
  x.sms.send = async () => { const e = new Error("Attempt to send to unsubscribed recipient"); e.code = 21610; throw e; };
  x.tickTime(5 * 60000); await x.app.tick("f1");
  const T = x.state(); assert.equal(T.S.clients[0].textConsent, "withdrawn"); assert.ok(T.S.alerts.some((a) => a.kind === "send_failed" || /could not be sent/.test(a.text)));
});
test("in Copilot, a draft approved at night is sent in the morning, not at night", async () => {
  const x = await setup(null, "copilot");
  await x.app.staff("f1", "u1", (T) => T.giveConsent(T.S.clients[0].id, "page")); x.tickTime(2 * 3600000); await x.app.tick("f1");
  const before = x.sms.sent.length; x.tickTime(11 * 3600000);   // 11:05 pm
  await x.app.staff("f1", "u1", (T) => { const m = T.S.msgs.find((q) => q.status === "approval"); assert.ok(m, "no draft waiting"); assert.equal(T.approveMsg(m.id), null); });
  assert.equal(x.sms.sent.length, before, "sent at night");
  x.tickTime(12 * 3600000); await x.app.tick("f1");
  assert.equal(x.sms.sent.length, before + 1);
});

// ---- round 6 ----
test("check-in answers from the client page come back as a proposal and a thank-you is sent", async () => {
  const store = memoryStore(), sms = fakeSender(), email = fakeSender(); let t = new Date(2027, 0, 25, 10, 5, 0);
  const app = createApp({ store, sms, email, ai: null, clock: () => t });
  await app.createFirm("f1", { name: "Test CPAs", email: "docs@test.example", smsNumber: FIRM_NO, senderStatus: "approved", mode: "autopilot", users: [{ id: "u1", first: "Pat", name: "Pat Owner", role: "owner", email: "pat@test.example" }] });
  let cid; await app.staff("f1", "u1", (T) => { T.importRows(T.parseCSV("First,Last,Email\nJo,Day,jo@x.example")); cid = T.S.clients[0].id; assert.equal(T.sendCheckin(T.S.engs[0].id), null); });
  assert.match(email.sent[0].body, /check-in/);
  const r = await app.checkinAnswers("f1", cid, { facts: { w2: true, hsa: true }, counts: { w2: 1 } });
  assert.equal(r.adds, 1); assert.match(email.sent.slice(-1)[0].body, /putting your list together/);
  await assert.rejects(() => app.checkinAnswers("f1", "nobody", {}));
});


// ---- round 7 ----
test("the note on a check-in is read by the model; the browser cannot inject topics or custom requests", async () => {
  const store = memoryStore(), sms = fakeSender(), email = fakeSender(); let t = new Date(2027, 0, 25, 10, 5, 0);
  const ai = fakeAI((prompt) => (prompt.startsWith("A tax client finished a short check-in") ? { topics: ["unemp"], documents: ["Closing statement for the home sale"], summary: "x" } : null));
  const app = createApp({ store, sms, email, ai, clock: () => t });
  await app.createFirm("f1", { name: "Test CPAs", email: "docs@test.example", smsNumber: FIRM_NO, senderStatus: "approved", mode: "autopilot", users: [{ id: "u1", first: "Pat", name: "Pat Owner", role: "owner", email: "pat@test.example" }] });
  let cid; await app.staff("f1", "u1", (T) => { T.importRows(T.parseCSV("First,Last,Email\nJo,Day,jo@x.example")); cid = T.S.clients[0].id; });
  await app.checkinAnswers("f1", cid, { facts: { w2: true, homeowner: true }, counts: { w2: 1 }, note: "sold the house, laid off", topics: ["k1"], custom: ["INJECTED"] });
  const T = createEngine(); T.load(store.read("f1")); const k = T.S.engs[0].checkin;
  assert.deepEqual(k.adds.map((a) => a.form), ["1099G"]); assert.deepEqual(k.customs, ["Closing statement for the home sale"]);
});

// ---- round 8 ----
test("if the save after sending fails, the message is not sent again and a person is told", async () => {
  let t = new Date(2027, 0, 25, 10, 5, 0); const store = memoryStore(), sms = fakeSender(), email = fakeSender();
  const app = createApp({ store, sms, email, ai: null, clock: () => t });
  await app.createFirm("f1", { name: "Test CPAs", email: "docs@test.example", smsNumber: FIRM_NO, senderStatus: "approved", mode: "autopilot", users: [{ id: "u1", first: "Pat", name: "Pat Owner", role: "owner", email: "pat@test.example" }] });
  await app.staff("f1", "u1", (T) => { T.importRows(T.parseCSV("First,Last,Email\nJo,Day,jo@x.example")); });
  await app.staff("f1", "u1", (T) => { const e = T.S.engs[0]; e.confirmed = true; T.start(e.id); }); t = new Date(t.getTime() + 5 * 60000);
  const real = store.lock.bind(store); let calls = 0; store.lock = (id, fn) => (++calls === 2 ? Promise.reject(new Error("database unavailable")) : real(id, fn));
  await assert.rejects(() => app.tick("f1"));
  assert.equal(email.sent.length, 1, "the invitation went out once");
  store.lock = real; await app.tick("f1"); assert.equal(email.sent.length, 1, "not resent straight away");
  t = new Date(t.getTime() + 5 * 60000); await app.tick("f1"); await app.tick("f1");
  assert.equal(email.sent.length, 1, "never resent");
  const T = createEngine(); T.load(store.read("f1")); assert.ok(T.S.alerts.some((a) => a.kind === "send_unconfirmed")); assert.equal(T.S.msgs.filter((m) => m.status === "unconfirmed").length, 1);
});
test("every send carries an idempotency key the provider can use", async () => {
  const x = await setup(null); assert.ok(x.email.sent.every((m) => typeof m.idempotencyKey === "string" && m.idempotencyKey.length > 1));
});
test("custom requests are translated for Spanish-speaking clients, and only an owner can start a season", async () => {
  const x = await setup(fakeAI((p) => (p.startsWith("Translate each") ? { es: ["Estado de cierre de la venta de la casa"] } : null)));
  await x.app.staff("f1", "u1", (T) => { T.S.clients[0].lang = "es"; T.customSuggest(T.S.engs[0].id, "Closing statement for the home sale", true); });
  assert.equal(await x.app.translateCustoms("f1"), 1); assert.match(x.state().S.items.find((i) => i.custom).customEs, /Estado de cierre/);
  await assert.rejects(() => x.app.rollSeason("f1", "nobody", 2027)); assert.equal((await x.app.rollSeason("f1", "u1", 2027)).year, 2027);
});

// ---- round 16: the client's upload page, and the way out of email ----
test("pipeline: a file from the client's upload page is checked like a text, and the same upload twice is one document", async () => {
  const { createApp } = require("../packages/core/pipeline"), { memoryStore, fakeSender, fakeAI } = require("../packages/core/memory");
  const store = memoryStore(), sms = fakeSender(), email = fakeSender(), ai = fakeAI((p) => p.startsWith("You read photos") ? { is_tax_document: true, form: "W2", tax_year: 2026, payer: "Acme Logistics", recipient_name: "JO DAY", legibility: 0.95, confidence: 0.97, missing_parts: [], note: "A W-2" } : null);
  const app = createApp({ store, sms, email, ai, clock: () => new Date(2027, 0, 25, 10, 5) });
  await app.createFirm("f1", { plan: "Practice", name: "Test CPAs", email: "docs@test.example", smsNumber: "+16155550100", senderStatus: "approved", mode: "autopilot", users: [{ id: "u1", first: "Pat", name: "Pat Owner", role: "owner", email: "pat@test.example" }] });
  let cid; await app.staff("f1", "u1", (T) => { T.S.firm.linkBase = "go.tallyhound.test"; T.S.firm.slug = "testcpas"; T.importRows(T.parseCSV("First,Last,Email,Mobile\nJo,Day,jo@x.example,")); const e = T.S.engs[0]; cid = T.S.clients[0].id; T.itemsOf(e.id).find((i) => i.form === "W2").payer = "Acme Logistics"; e.confirmed = true; T.start(e.id); T.tick(); });
  const file = { bytes: Buffer.alloc(5000, 7), contentType: "image/jpeg" }, n = email.sent.length;
  const r = await app.clientUpload({ firmId: "f1", clientId: cid, files: [file], providerId: "up1" }); assert.deepEqual(r.docs, ["accepted"]);
  const again = await app.clientUpload({ firmId: "f1", clientId: cid, files: [file], providerId: "up1" }); assert.equal(again.duplicate, true);
  const { createEngine } = require("../packages/engine"), T = createEngine(); T.load(store.read("f1")); assert.equal(T.S.docs.length, 1); assert.equal(T.S.docs[0].channel, "portal"); assert.ok(T.S.docs[0].fileKey);
  assert.equal(email.sent.length, n + 1, "one reply to the client"); assert.equal((await app.clientUpload({ firmId: "f1", clientId: "nobody", files: [file] })).handled, false);
  assert.equal((await app.clientUpload({ firmId: "f1", clientId: cid, files: [{ bytes: Buffer.from("x"), contentType: "text/plain" }], providerId: "up2" })).unusable, "type");
  // Every email carries the way to stop them, in the body and for the one-click header.
  const m = email.sent.at(-1); assert.match(m.body, /To stop these emails: https:\/\/go\.tallyhound\.test\/e\/testcpas-[a-z]{28}$/); assert.match(m.unsubscribe, /^https:\/\/go\.tallyhound\.test\/e\/testcpas-[a-z]{28}$/); assert.equal(m.fromName, "Test CPAs");
  assert.ok(email.sent.every((x) => x.unsubscribe === m.unsubscribe), "the same link in every email to this client");
});
test("email out: the unsubscribe address becomes the two headers mail programs look for", async () => {
  const { postmark } = require("../packages/adapters/email-out"); let sent = null;
  const pm = postmark({ serverToken: "t", fetchImpl: async (_u, o) => { sent = JSON.parse(o.body); return { ok: true, json: async () => ({ MessageID: "m1" }) }; } });
  await pm.send({ from: "docs@test.example", to: "jo@x.example", subject: "s", body: "b", idempotencyKey: "k", unsubscribe: "https://go.tallyhound.test/e/x-abc" });
  assert.deepEqual(sent.Headers.slice(1), [{ Name: "List-Unsubscribe", Value: "<https://go.tallyhound.test/e/x-abc>" }, { Name: "List-Unsubscribe-Post", Value: "List-Unsubscribe=One-Click" }]);
  await pm.send({ from: "docs@test.example", to: "jo@x.example", subject: "s", body: "b" }); assert.equal(sent.Headers.length, 1);
});

test("T-118: a text from an unknown number is kept with the number it came from; once it is a client's second contact, documents from it are filed and STOP from it is not acted on", async () => {
  const x = await setup(model()); const SPOUSE = "+16155550188";
  await x.app.inboundSms({ to: FIRM_NO, from: SPOUSE, body: "", media: [{ bytes: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]), contentType: "image/jpeg" }], providerId: "s1" });
  let T = x.state(); assert.equal(T.S.tray.length, 1); assert.equal(T.S.tray[0].from, "(615) 555-0188"); assert.equal(T.S.docs.filter((d) => d.engId).length, 0);
  await x.app.staff("f1", "u1", (E) => { assert.equal(E.addContact(E.S.clients[0].id, "mobile", SPOUSE), null); E.giveConsent(E.S.clients[0].id, "page"); });
  const texts = x.sms.sent.length, r = await x.app.inboundSms({ to: FIRM_NO, from: SPOUSE, body: "", media: [{ bytes: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 4, 5, 6]), contentType: "image/jpeg" }], providerId: "s2" });
  assert.deepEqual(r.docs, ["accepted"]); assert.equal(r.client, x.state().S.clients[0].id);
  assert.ok(x.sms.sent.length > texts, "the thank-you goes out"); assert.ok(x.sms.sent.every((m) => m.to !== "6155550188" && !String(m.to).includes("5550188")), "and never to the second number");
  const stop = await x.app.inboundSms({ to: FIRM_NO, from: SPOUSE, body: "STOP", providerId: "s3" }); T = x.state();
  assert.equal(stop.intent, "unknown"); assert.equal(T.S.clients[0].textConsent, "given", "the client's own consent stands"); assert.match(T.S.tray.at(-1).from, /second contact/); assert.equal(T.S.tray.at(-1).text, "STOP");
  // The client's own number still stops texts, as always.
  await x.app.inboundSms({ to: FIRM_NO, from: JO, body: "STOP", providerId: "s4" }); assert.equal(x.state().S.clients[0].textConsent, "withdrawn");
  // An email from a second address is matched too, when the sender can be confirmed, and not when it cannot.
  await x.app.staff("f1", "u1", (E) => { E.addContact(E.S.clients[0].id, "email", "partner@home.example"); });
  const a = await x.app.inboundEmail({ to: "docs@test.example", from: "Partner <PARTNER@home.example>", body: "Here it is.", attachments: [{ bytes: Buffer.from("pdf"), contentType: "application/pdf" }], providerId: "e1" }); assert.equal(a.client, x.state().S.clients[0].id);
  const n = x.state().S.tray.length, b = await x.app.inboundEmail({ to: "docs@test.example", from: "partner@home.example", body: "Again.", trusted: false, attachments: [{ bytes: Buffer.from("pdf2"), contentType: "application/pdf" }], providerId: "e2" }); assert.ok(!b.client); assert.ok(x.state().S.tray.length > n, "it waits for a person");
});

test("T-50: a recorded reminder call is placed once through the voice service, with the fixed wording; with no voice service it fails in the open and nothing is called", async () => {
  const placed = [], voice = { async call(c) { placed.push(c); return "CA" + placed.length; } };
  const mk = async (v) => { let t = new Date(2027, 0, 25, 10, 5, 0); const store = memoryStore(), sms = fakeSender(), email = fakeSender(), app = createApp({ store, sms, email, ai: null, clock: () => t, voice: v });
    await app.createFirm("f1", { name: "Test CPAs", email: "docs@test.example", smsNumber: FIRM_NO, senderStatus: "approved", mode: "autopilot", plan: "Practice", users: [{ id: "u1", first: "Pat", name: "Pat Owner", role: "owner", email: "pat@test.example" }] });
    await app.staff("f1", "u1", (T) => { T.S.firm.hound.voicemail = true; T.importRows(T.parseCSV("First,Last,Email,Mobile\nJo,Day,jo@x.example,6155550111")); const e = T.S.engs[0]; e.confirmed = true; T.start(e.id); T.giveConsent(T.S.clients[0].id, "page"); T.setCallOk(T.S.clients[0].id, true, "asked on intake"); });
    for (let i = 0; i < 40; i++) { t = new Date(t.getTime() + 86400000); await app.tick("f1"); } const T = createEngine(); T.load(store.read("f1")); return T; };
  const T = await mk(voice); assert.equal(placed.length, 1); assert.equal(placed[0].to, "6155550111"); assert.match(placed[0].say, /^This is a message for Jo from Test CPAs/); assert.ok(placed[0].idempotencyKey);
  const m = T.S.msgs.find((x) => x.channel === "voice"); assert.ok(m.sentAt || m.providerId, "recorded as placed");
  placed.length = 0; const U = await mk(undefined), n = U.S.msgs.find((x) => x.channel === "voice"); assert.equal(placed.length, 0); assert.ok(n.failed || n.status === "failed", "marked as failed, for a person to see");
});
