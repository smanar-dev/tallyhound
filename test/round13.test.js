// Round 13: what is kept, for how long, how it is locked up, and how mail and client lists get in.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const { firm, started } = require("./helpers");
const { createApp, UNKNOWN_FILES_PER_DAY } = require("../packages/core/pipeline");
const { memoryStore, fakeSender, fakeAI } = require("../packages/core/memory");
const { seal, open, localKeyring, encryptedStore } = require("../packages/core/crypto");
const { createEngine } = require("../packages/engine");
const mail = require("../packages/adapters/email-inbound");
const imp = require("../packages/adapters/importers");
const { postgresStore, memoryBucket } = require("../packages/adapters/postgres");

const W2 = { form: "W2", year: 2026, payer: "Acme Logistics", recipient: "self", read: { legible: 0.95, conf: 0.97, note: "", missing: [] } };
const SSN = /\b\d{3}-\d{2}-\d{4}\b/;

// ---- what is never kept --------------------------------------------------------------------------------------------
test("a Social Security number in a text is removed before the message is stored", () => {
  const { T, c, e } = started();
  T.inboundText(c.id, "my ssn is 123-45-6789 if you need it, W-2 coming friday", null);
  const m = T.S.msgs.filter((x) => x.engId === e.id && x.dir === "in").slice(-1)[0];
  assert.ok(!SSN.test(m.body), m.body); assert.match(m.body, /SSN removed/); assert.match(m.body, /friday/);
  assert.ok(!SSN.test(T.dump()), "the number is somewhere in the saved state");
});
test("card and bank numbers are removed; phone numbers, amounts and years are left alone", () => {
  const T = createEngine();
  assert.match(T.scrub("card 4111 1111 1111 1111 exp 04/29").text, /card number removed\] exp/);
  assert.match(T.scrub("routing 021000021 account 000123456789").text, /account number removed/);
  assert.match(T.scrub("SSN: 123456789").text, /SSN removed/);
  for (const ok of ["call me at 615-555-0111", "box 1 says $52,310.00 for 2026", "order 1234567890123456 shipped", "my zip is 37064-1234"]) assert.equal(T.scrub(ok).text, ok);
  assert.deepEqual(T.scrub("nothing here").hit, []);
});
test("an email body is scrubbed the same way", () => {
  const { T, c, e } = started();
  T.inboundEmail(c.id, "Attached. Spouse SSN 987-65-4321.", [], null);
  assert.ok(!SSN.test(T.dump()));
});

// ---- how long a copy is kept -----------------------------------------------------------------------------------------
test("a delivered document is deleted from Tallyhound after the keep-for time, and the record of it stays", () => {
  const { T, c, e } = started();
  const d = T.inboundDoc(c.id, Object.assign({}, W2), "text"); d.fileKey = "f1/1"; assert.equal(d.state, "accepted");
  T.deliver(e.id, "Pat Owner"); assert.ok(d.deliveredAt);
  T.advance(6 * T.DAY); assert.ok(T.hasContent(d), "deleted too early");
  T.advance(2 * T.DAY); assert.ok(!T.hasContent(d)); assert.equal(d.fileKey, null); assert.deepEqual(T.S.purgeFiles, ["f1/1"]);
  assert.equal(d.form, "W2"); assert.equal(d.state, "accepted"); assert.equal(d.read, null);
  assert.ok(T.S.audit.some((a) => a.action === "retention.sweep"));
  const item = T.itemsOf(e.id).find((i) => i.form === "W2"); assert.notEqual(item.state, "open", "the checklist forgot the document was received");
});
test("a rejected photo is deleted after a week, and nothing is kept past the outer limit", () => {
  const { T, c } = started();
  const bad = T.inboundDoc(c.id, { form: "W2", year: 2026, payer: "Acme Logistics", recipient: "self", read: { legible: 0.2, conf: 0.9, note: "", missing: [] } }, "text"); bad.fileKey = "f1/2";
  assert.notEqual(bad.state, "accepted");
  T.advance(8 * T.DAY); if (["rejected", "duplicate", "discarded"].includes(bad.state)) assert.ok(!T.hasContent(bad));
  const good = T.inboundDoc(c.id, Object.assign({}, W2), "text"); good.fileKey = "f1/3";
  T.advance(401 * T.DAY); assert.ok(!T.hasContent(good), "an undelivered copy outlived the outer limit"); assert.ok(!T.hasContent(bad));
});
test("only an owner can change how long copies are kept, and the limits hold", () => {
  const { T } = firm();
  T.setUser("u2"); T.setRetain("afterDelivery", 5); assert.equal(T.retain().afterDelivery, 7);
  T.setUser("u1"); T.setRetain("afterDelivery", 5); assert.equal(T.retain().afterDelivery, 5);
  T.setRetain("afterDelivery", 9999); assert.equal(T.retain().afterDelivery, 365);
  T.setRetain("max", 1); assert.equal(T.retain().max, 30);
  T.setRetain("afterDelivery", 0); assert.equal(T.retain().afterDelivery, 0);
});
test("delete now removes every copy for a client at once and says so in the log", () => {
  const { T, c, e } = started();
  const d = T.inboundDoc(c.id, Object.assign({}, W2), "text"); d.fileKey = "f1/9";
  T.setUser("u1"); T.deleteDocsNow(e.id);
  assert.ok(!T.hasContent(d)); assert.deepEqual(T.S.purgeFiles, ["f1/9"]);
  const m = T.dataMap(); assert.equal(m.docsHeld, 0); assert.equal(m.docsDeleted, 1);
});
test("messages and documents from an unknown sender are removed after 30 days", () => {
  const { T } = started();
  T.inboundText(null, "who is this", null); const d = T.inboundDoc(null, Object.assign({}, W2), "text"); d.fileKey = "f1/7";
  assert.equal(T.S.tray.length, 2); T.advance(31 * T.DAY); assert.equal(T.S.tray.length, 0); assert.deepEqual(T.S.purgeFiles, ["f1/7"]);
});

test("scheduled deletion keeps running while a firm is paused or its trial has ended", () => {
  const { T, c, e } = started();
  const d = T.inboundDoc(c.id, Object.assign({}, W2), "text"); d.fileKey = "f1/4"; T.deliver(e.id, "Pat Owner");
  T.inboundText(null, "wrong number?", null);
  T.setUser("u1"); assert.equal(T.pauseSeason(new Date(+T.S.now + 80 * T.DAY)), null); assert.equal(T.access().ok, false);
  T.advance(40 * T.DAY); assert.ok(!T.hasContent(d), "a paused firm kept a delivered copy past its time"); assert.equal(T.S.tray.length, 0);
});

// ---- bringing a client list in ---------------------------------------------------------------------------------------
test("import: SSN, birth date, fee and bank columns are never read into Tallyhound", () => {
  const T = createEngine(); T.blank({ plan: "Practice", name: "Test", now: new Date(2027, 0, 25, 10, 5) });
  const p = T.parseCSV("Client ID,Taxpayer First Name,Taxpayer Last Name,SSN,Date of Birth,Email,Cell Phone,Prep Fee,Bank Account\n1001,MARIA,GARCIA,123-45-6789,04/02/1980,maria@x.example,(615) 555-0142,450,000123456789");
  assert.deepEqual(p.sensitive.map(Boolean), [false, false, false, true, true, false, false, true, true]);
  const r = T.importRows(p); assert.equal(T.S.clients.length, 1);
  const c = T.S.clients[0]; assert.equal(c.first, "Maria"); assert.equal(c.last, "Garcia"); assert.equal(c.ref, "1001");
  const dump = T.dump(); for (const bad of ["123-45-6789", "04/02/1980", "000123456789"]) assert.ok(!dump.includes(bad), bad + " was stored");
  assert.ok(r.skippedColumns && r.skippedColumns.length === 4);
});
test("import: a second file with the same client number updates the contact details and adds nobody", () => {
  const T = createEngine(); T.blank({ plan: "Practice", name: "Test", now: new Date(2027, 0, 25, 10, 5) });
  T.importRows(T.parseCSV("Client ID,First,Last,Email,Mobile\n1001,Maria,Garcia,maria@x.example,6155550142"));
  const r = T.importRows(T.parseCSV("Client ID,First,Last,Email,Mobile\n1001,Maria,Garcia,maria.new@x.example,6155550142\n1002,Sam,Lee,sam@x.example,6155550143"));
  assert.equal(T.S.clients.length, 2); assert.equal(T.S.clients[0].email, "maria.new@x.example"); assert.equal(r.updated, 1);
});
test("import: a home phone is not used when a cell number is present, and a spouse column is not taken as the client", () => {
  const T = createEngine(); T.blank({ plan: "Practice", name: "Test", now: new Date(2027, 0, 25, 10, 5) });
  const p = T.parseCSV("Spouse First Name,First Name,Last Name,Home Phone,Cell Phone,Email\nRob,Dana,Fox,6155550001,6155550002,dana@x.example");
  T.importRows(p); const c = T.S.clients[0]; assert.equal(c.first, "Dana"); assert.match(c.mobile.replace(/\D/g, ""), /6155550002$/);
});
test("texting registration starts when a plan is chosen, not at sign-up", () => {
  const T = createEngine(); T.blank({ name: "New Firm", now: new Date(2027, 0, 25, 10, 5), users: [{ id: "u1", first: "Pat", name: "Pat Owner", role: "owner", email: "p@x.example" }] });
  assert.equal(T.S.firm.senderStatus, "none"); T.setUser("u1"); T.choosePlan("Solo"); assert.equal(T.S.firm.senderStatus, "submitted"); assert.ok(T.S.firm.senderSubmittedAt);
});

// ---- encryption ------------------------------------------------------------------------------------------------------
test("crypto: sealed data opens with the right key and label, and with nothing else", () => {
  const k = crypto.randomBytes(32), s = seal(k, Buffer.from("W-2 for Jo Day"), "file:f1");
  assert.equal(open(k, s, "file:f1").toString(), "W-2 for Jo Day");
  assert.ok(!s.toString("latin1").includes("Jo Day"));
  assert.throws(() => open(crypto.randomBytes(32), s, "file:f1"));               // another key
  assert.throws(() => open(k, s, "file:f2"));                                    // moved to another firm
  const t = Buffer.from(s); t[t.length - 1] ^= 1; assert.throws(() => open(k, t, "file:f1"));   // one bit changed
  assert.notDeepEqual(seal(k, Buffer.from("x"), "a"), seal(k, Buffer.from("x"), "a"), "the same input sealed twice must differ");
});
const model = () => fakeAI((prompt) => {
  if (prompt.startsWith("You read photos")) return { is_tax_document: true, form: "W2", tax_year: 2026, payer: "Acme Logistics", recipient_name: "JO DAY", legibility: 0.95, confidence: 0.97, missing_parts: [], note: "A W-2" };
  if (prompt.startsWith("You read text messages")) return { intent: "thanks", item_id: null, later_days: null, summary: "Says thanks", scope: "documents", sentiment: "calm", memory: null, staff_reply: null };
  if (prompt.startsWith("You read emails")) return { items: [], question: false, summary: "Sent documents" };
  if (prompt.startsWith("You write one message")) return { text: null };
  return null;
});
const FIRM_NO = "+16155550100", JO = "+16155550111", big = Buffer.alloc(80000, 7);
async function setup(store, opt) {
  let t = new Date(2027, 0, 25, 10, 5, 0); const sms = fakeSender(), email = fakeSender(), app = createApp({ store, sms, email, ai: model(), clock: () => t });
  await app.createFirm("f1", Object.assign({ plan: "Practice", name: "Test CPAs", email: "office@test.example", inbox: "test-cpas@docs.tallyhound.example", smsNumber: FIRM_NO, senderStatus: "approved", mode: "autopilot", users: [{ id: "u1", first: "Pat", name: "Pat Owner", role: "owner", email: "pat@test.example" }] }, opt));
  await app.staff("f1", "u1", (T) => { T.importRows(T.parseCSV("First,Last,Email,Mobile\nJo,Day,jo@x.example,6155550111")); const e = T.S.engs[0]; T.itemsOf(e.id).find((i) => i.form === "W2").payer = "Acme Logistics"; e.confirmed = true; T.start(e.id); T.giveConsent(T.S.clients[0].id, "page"); });
  const state = async () => { const T = createEngine(); T.load(await store.readState("f1")); return T; };
  return { app, store, sms, email, state, tickTime: (ms) => { t = new Date(t.getTime() + ms); } };
}
const INBOX = "test-cpas@docs.tallyhound.example";
test("encrypted store: nothing readable reaches the database or the file store, and the product works unchanged", async () => {
  const inner = memoryStore(), x = await setup(encryptedStore(inner, localKeyring(crypto.randomBytes(32))));
  const r = await x.app.inboundSms({ to: FIRM_NO, from: JO, body: "here is my w2", media: [{ bytes: big, contentType: "image/jpeg" }], providerId: "s1" });
  assert.deepEqual(r.docs, ["accepted"]);
  const raw = Buffer.from(inner.firms.get("f1"), "base64").toString("latin1"); for (const word of ["jo@x.example", "6155550111", "Acme Logistics", "\"clients\""]) assert.ok(!raw.includes(word), word + " is readable in the stored state");
  const f = [...inner.files.values()][0]; assert.ok(!Buffer.from(f.bytes).equals(big)); assert.equal(Buffer.from(f.bytes).subarray(0, 3).toString(), "th1");
  const T = await x.state(); assert.equal(T.S.clients[0].first, "Jo");
  const got = await x.app.openFile("f1", "u1", T.S.docs[0].id); assert.ok(got.bytes.equals(big));
  assert.ok((await x.state()).S.audit.some((a) => a.action === "doc.view"), "opening a document was not logged");
});
test("encrypted store: one firm's key cannot open another firm's data, and destroying the key ends access", async () => {
  const inner = memoryStore(), ring = localKeyring(crypto.randomBytes(32)), es = encryptedStore(inner, ring);
  await es.create("a", JSON.stringify({ who: "firm a" }), {}); await es.create("b", JSON.stringify({ who: "firm b" }), {});
  const ka = await ring.unwrap(inner.keys.get("a"), "a"); assert.throws(() => open(ka, Buffer.from(inner.firms.get("b"), "base64"), "state:b"));
  await assert.rejects(ring.unwrap(inner.keys.get("a"), "b"), "a wrapped key was accepted under another firm's name");
  assert.equal(JSON.parse(await es.readState("a")).who, "firm a");
  const sealedCopy = inner.firms.get("a"); await es.destroyFirm("a"); inner.firms.set("a", sealedCopy);   // a backup is restored after the key is gone
  await assert.rejects(es.readState("a"));
});
test("encrypted store: compression keeps the sealed state far smaller than the JSON", async () => {
  const inner = memoryStore(), x = await setup(encryptedStore(inner, localKeyring(crypto.randomBytes(32))));
  const plain = (await x.store.readState("f1")).length, sealed = inner.firms.get("f1").length; assert.ok(sealed < plain / 2, sealed + " vs " + plain);
});

// ---- the bytes really go ---------------------------------------------------------------------------------------------
test("pipeline: after delivery and the keep-for time, the stored file itself is deleted", async () => {
  const store = memoryStore(), x = await setup(store);
  await x.app.inboundSms({ to: FIRM_NO, from: JO, body: "", media: [{ bytes: big, contentType: "image/jpeg" }], providerId: "s1" });
  assert.equal(store.files.size, 1);
  await x.app.staff("f1", "u1", (T) => { T.deliver(T.S.engs[0].id, "Pat Owner"); });
  x.tickTime(31 * 86400000); await x.app.tick("f1");      // the sweep lets go of the copy and saves that
  assert.equal(store.files.size, 1, "bytes must not go before the state that forgets them is saved");
  await x.app.tick("f1"); assert.equal(store.files.size, 0);
  const T = await x.state(); assert.deepEqual(T.S.purgeFiles, []); assert.equal(await x.app.openFile("f1", "u1", T.S.docs[0].id), null);
});
test("pipeline: a failed delete is kept on the list and tried again", async () => {
  const store = memoryStore(), x = await setup(store); let fail = true; const del = store.deleteFile.bind(store); store.deleteFile = async (f, k) => { if (fail) throw new Error("storage is down"); return del(f, k); };
  await x.app.inboundSms({ to: FIRM_NO, from: JO, body: "", media: [{ bytes: big, contentType: "image/jpeg" }], providerId: "s1" });
  await x.app.staff("f1", "u1", (T) => { T.deleteDocsNow(T.S.engs[0].id); });
  await x.app.tick("f1"); assert.equal(store.files.size, 1); assert.equal((await x.state()).S.purgeFiles.length, 1);
  fail = false; await x.app.tick("f1"); assert.equal(store.files.size, 0); assert.equal((await x.state()).S.purgeFiles.length, 0);
});

// ---- email in --------------------------------------------------------------------------------------------------------
test("email: mail that claims to be from a client but fails the sender check waits for a person", async () => {
  const x = await setup(memoryStore()), sent = x.email.sent.length + x.sms.sent.length;
  const r = await x.app.inboundEmail({ to: INBOX, from: "Jo Day <jo@x.example>", body: "new bank details attached", attachments: [{ bytes: big, contentType: "image/jpeg" }], providerId: "e1", trusted: false });
  assert.equal(r.client, null); assert.equal(r.unverified, true);
  const T = await x.state(); assert.equal(T.S.docs.filter((d) => d.engId).length, 0, "an unverified file reached the client's checklist");
  assert.ok(T.S.tray.some((y) => /could not be confirmed/.test(y.why || "") && y.claims === T.S.clients[0].id));
  assert.equal(x.email.sent.length + x.sms.sent.length, sent, "something was sent in answer to unverified mail");
});
test("email: an attachment from an address nobody knows is kept for a person to file, and capped per day", async () => {
  const x = await setup(memoryStore());
  const r = await x.app.inboundEmail({ to: INBOX, from: "spouse@other.example", body: "Jo asked me to send this. SSN 123-45-6789", attachments: [{ bytes: big, contentType: "application/pdf" }], providerId: "e1", trusted: true });
  assert.equal(r.client, null); assert.equal(r.docs.length, 1);
  let T = await x.state(); assert.ok(T.S.tray.some((y) => y.docId)); assert.ok(T.S.docs[0].fileKey); assert.ok(!SSN.test(T.dump()));
  const many = Array.from({ length: UNKNOWN_FILES_PER_DAY + 5 }, () => ({ bytes: big, contentType: "image/jpeg" }));
  await x.app.inboundEmail({ to: INBOX, from: "noise@spam.example", body: "", attachments: many, providerId: "e2", trusted: true });
  T = await x.state(); assert.equal(T.S.docs.length, UNKNOWN_FILES_PER_DAY); assert.ok(T.S.tray.some((y) => /not kept/.test(y.text || "")));
});
test("email: a staff member forwards a client's email and it is filed to that client", async () => {
  const x = await setup(memoryStore());
  const m = mail.toPipeline({ messageId: "e9", to: INBOX, from: "Pat Owner <pat@test.example>", subject: "Fwd: my W-2", headers: { "authentication-results": "mx.tallyhound.example; dkim=pass header.d=test.example; spf=pass smtp.mailfrom=pat@test.example; dmarc=pass" },
    text: "fyi\n\n---------- Forwarded message ---------\nFrom: Jo Day <jo@x.example>\nDate: Mon, Jan 25, 2027\nSubject: my W-2\nTo: pat@test.example\n\nHere is my W-2.\n\nSent from my iPhone", attachments: [{ bytes: big, contentType: "image/jpeg", name: "w2.jpg" }] });
  assert.equal(m.trusted, true); assert.equal(m.forwarded.from, "jo@x.example"); assert.equal(m.forwarded.body, "Here is my W-2.");
  const r = await x.app.inboundEmail(m); const T = await x.state();
  assert.equal(r.client, T.S.clients[0].id); assert.deepEqual(r.docs, ["accepted"]); assert.equal(r.forwardedBy, "pat@test.example");
});
test("email: a stranger cannot file documents by writing 'Forwarded message' in the body", async () => {
  const x = await setup(memoryStore());
  const m = mail.toPipeline({ messageId: "e10", to: INBOX, from: "x@evil.example", subject: "Fwd: docs", headers: { "authentication-results": "mx; dmarc=pass" }, text: "---------- Forwarded message ---------\nFrom: Jo Day <jo@x.example>\n\nsee attached", attachments: [{ bytes: big, contentType: "image/jpeg" }] });
  const r = await x.app.inboundEmail(m); assert.equal(r.client, null);
});
test("email adapter: the sender check", () => {
  const A = mail.parseAuthResults, ok = (h, from) => mail.isTrusted(A(h), from);
  assert.equal(ok("mx; spf=pass smtp.mailfrom=jo@gmail.com; dkim=pass header.d=gmail.com; dmarc=pass", "jo@gmail.com"), true);
  assert.equal(ok("mx; spf=pass smtp.mailfrom=evil.example; dkim=none; dmarc=fail", "jo@gmail.com"), false);
  assert.equal(ok("mx; spf=fail; dkim=pass header.d=mail.smallfirm.com; dmarc=none", "jo@smallfirm.com"), true, "aligned DKIM without a DMARC record");
  assert.equal(ok("mx; spf=pass smtp.mailfrom=bounce@sender.example; dkim=pass header.d=sender.example; dmarc=none", "jo@smallfirm.com"), false, "someone else's signature");
  assert.equal(ok("mx; spf=pass smtp.mailfrom=jo@smallfirm.co.uk; dmarc=none", "jo@smallfirm.co.uk"), true);
  assert.equal(ok("", "jo@gmail.com"), false, "no result at all is not a pass");
  assert.equal(mail.orgDomain("a.b.acme.co.uk"), "acme.co.uk"); assert.equal(mail.orgDomain("mail.acme.com"), "acme.com");
});
test("email adapter: the quoted thread and signature are dropped, and an oversized file is flagged instead of vanishing", () => {
  assert.equal(mail.stripReply("Here you go\n\nOn Mon, Jan 25, 2027 at 9:00 AM Test CPAs <docs@x> wrote:\n> Please send your W-2\n> SSN 123-45-6789"), "Here you go");
  assert.equal(mail.stripReply("Thanks!\n-- \nJo Day\n615-555-0111"), "Thanks!");
  const m = mail.toPipeline({ to: "A <A@Docs.Example>", from: "Jo <JO@x.example>", text: "hi", attachments: [{ bytes: Buffer.alloc(mail.MAX_FILE + 1), contentType: "application/pdf", name: "huge.pdf" }, { bytes: Buffer.alloc(0), contentType: "image/png" }] });
  assert.equal(m.to, "a@docs.example"); assert.equal(m.from, "jo@x.example"); assert.equal(m.attachments.length, 1); assert.equal(m.attachments[0].contentType, "application/x-too-large"); assert.equal(m.trusted, false);
});
test("email adapter: Postmark and SES payloads map to the same input", () => {
  const p = mail.fromPostmark({ MessageID: "pm1", OriginalRecipient: INBOX, From: "Jo Day <jo@x.example>", Subject: "W-2", TextBody: "Here", Headers: [{ Name: "Authentication-Results", Value: "mx; dmarc=pass" }], Attachments: [{ Name: "w2.pdf", ContentType: "application/pdf", Content: Buffer.from("pdf").toString("base64") }] });
  assert.equal(p.providerId, "pm1"); assert.equal(p.trusted, true); assert.equal(p.attachments[0].bytes.toString(), "pdf");
  const s = mail.fromSes({ spfVerdict: { status: "PASS" }, dkimVerdict: { status: "PASS" }, dmarcVerdict: { status: "FAIL" } }, { messageId: "ses1", to: INBOX, from: { address: "jo@x.example" }, text: "Here", attachments: [] });
  assert.equal(s.trusted, false); assert.equal(s.providerId, "ses1");
});

// ---- texts in ----------------------------------------------------------------------------------------------------------
test("Twilio: a webhook with a wrong or missing signature is refused, and photos are fetched then deleted at Twilio", async () => {
  const { twilio, verifySignature } = require("../packages/adapters/twilio");
  const params = { To: "+16155550100", From: "+16155550111", Body: "here", NumMedia: "1", MediaUrl0: "https://api.twilio.com/2010-04-01/Accounts/AC1/Messages/MM1/Media/ME1", MediaContentType0: "image/jpeg", MessageSid: "MM1" }, url = "https://app.tallyhound.example/hooks/twilio";
  const sig = crypto.createHmac("sha1", "secret").update(url + Object.keys(params).sort().map((k) => k + params[k]).join("")).digest("base64");
  assert.equal(verifySignature("secret", url, params, sig), true);
  assert.equal(verifySignature("secret", url, Object.assign({}, params, { From: "+16155550999" }), sig), false);
  assert.equal(verifySignature("other", url, params, sig), false); assert.equal(verifySignature("secret", url, params, ""), false); assert.equal(verifySignature("secret", url, params, undefined), false);
  const calls = [], tw = twilio({ accountSid: "AC1", authToken: "secret", messagingServiceSid: "MG1", fetchImpl: async (u, o) => { calls.push((o.method || "GET") + " " + u); return { ok: true, arrayBuffer: async () => big, headers: new Map() }; } });
  const m = await tw.inbound(Object.assign({}, params, { NumMedia: "2", MediaUrl1: "https://evil.example/x.jpg" }));
  assert.equal(m.media.length, 1, "a media address outside Twilio was fetched"); assert.equal(m.providerId, "MM1"); assert.deepEqual(calls, ["GET " + params.MediaUrl0, "DELETE " + params.MediaUrl0]);
});

// ---- client list from Karbon -----------------------------------------------------------------------------------------
test("Karbon contacts become ordinary import rows, with nothing sensitive carried over", async () => {
  const pages = [{ value: [{ ContactKey: "K1", FirstName: "Maria", LastName: "Garcia", EmailAddress: "maria@x.example", PhoneNumber: "6155550142", SSN: "123-45-6789", DateOfBirth: "1980-04-02" }], "@odata.nextLink": "https://api.karbonhq.com/v3/Contacts?$skip=100" },
    { value: [{ ContactKey: "K2", FullName: "Sam Lee", BusinessCards: [{ IsPrimaryCard: true, EmailAddresses: ["sam@x.example"], PhoneNumbers: [{ Label: "Work", Number: "6155550001" }, { Label: "Mobile", Number: "6155550143" }] }] }] }];
  const seenHeaders = []; let n = 0; const fetchFake = async (url, o) => { seenHeaders.push(o.headers); const j = pages[n++]; return { ok: true, status: 200, json: async () => j, headers: new Map() }; };
  const rows = await imp.karbonContacts({ accessKey: "ak", bearer: "tok" }, { fetch: fetchFake });
  assert.equal(rows.length, 2); assert.equal(seenHeaders[0].AccessKey, "ak"); assert.equal(seenHeaders[0].Authorization, "Bearer tok");
  assert.deepEqual(Object.keys(rows[0]).sort(), ["email", "first", "last", "mobile", "preparer", "ref"]);
  assert.equal(rows[1].first, "Sam"); assert.equal(rows[1].mobile, "6155550143");
  const T = createEngine(); T.blank({ plan: "Practice", name: "Test", now: new Date(2027, 0, 25, 10, 5) }); T.importRows(imp.toParsed(rows));
  assert.equal(T.S.clients.length, 2); assert.equal(T.S.clients[0].ref, "K1"); assert.ok(!SSN.test(T.dump()));
  T.importRows(imp.toParsed(rows)); assert.equal(T.S.clients.length, 2, "a second sync duplicated clients");
});

// ---- Postgres --------------------------------------------------------------------------------------------------------
let pgmem = null; try { pgmem = require("pg-mem"); } catch (e) { /* optional: npm install pg-mem */ }
test("postgres store: the schema loads and the whole pipeline runs on it, sealed", { skip: pgmem ? false : "pg-mem is not installed" }, async () => {
  const db = pgmem.newDb(), sql = fs.readFileSync(path.join(__dirname, "../db/schema.sql"), "utf8"); db.public.none(sql);
  const { Pool } = db.adapters.createPg(), pool = new Pool(), bucket = memoryBucket(), store = encryptedStore(postgresStore(pool, bucket), localKeyring(crypto.randomBytes(32)));
  const x = await setup(store);
  const r = await x.app.inboundSms({ to: FIRM_NO, from: JO, body: "w2", media: [{ bytes: big, contentType: "image/jpeg" }], providerId: "s1" }); assert.deepEqual(r.docs, ["accepted"]);
  assert.equal(await store.firmIdByInbox(INBOX), "f1"); assert.equal(await store.firmIdByNumber("6155550100"), "f1");
  const row = (await pool.query("select sealed, version from firm_state where firm_id = 'f1'")).rows[0]; assert.ok(!Buffer.from(row.sealed, "base64").toString("latin1").includes("jo@x.example")); assert.ok(+row.version > 1);
  assert.equal(bucket.m.size, 1); assert.equal([...bucket.m.values()][0].subarray(0, 3).toString(), "th1");
  const T = await x.state(), got = await x.app.openFile("f1", "u1", T.S.docs[0].id); assert.ok(got.bytes.equals(big)); assert.equal(got.contentType, "image/jpeg");
  await x.app.staff("f1", "u1", (T2) => { T2.deleteDocsNow(T2.S.engs[0].id); }); await x.app.tick("f1");
  assert.equal(bucket.m.size, 0); const f = (await pool.query("select deleted_at, bytes from files")).rows[0]; assert.ok(f.deleted_at, "the file row should record the deletion");
  assert.equal(await store.inner.firstTime("twilio", "SM1", "f1"), true); assert.equal(await store.inner.firstTime("twilio", "SM1", "f1"), false);
  await store.inner.audit("f1", "Pat Owner", "test", null); assert.equal((await pool.query("select count(*) as n from audit_log")).rows[0].n > 0, true);
  await x.app.destroyFirm("f1", "u1"); assert.equal(await store.firmIdByInbox(INBOX), null); await assert.rejects(store.readState("f1"));
});
