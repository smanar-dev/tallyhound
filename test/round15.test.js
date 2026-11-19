// Round 15: the original goes to the firm first, a second independent reading, every return type, a fast and legal texting start, sign-in.
const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto"), { EventEmitter } = require("node:events");
const { firm, started, last, out } = require("./helpers");
const { createApp, nameMatch, MAX_PAGES } = require("../packages/core/pipeline");
const { memoryStore, fakeSender, fakeAI, memoryFiles } = require("../packages/core/memory");
const { createEngine } = require("../packages/engine");
const precheck = require("../packages/core/precheck"), reg = require("../packages/core/registration"), auth = require("../packages/core/auth");
const prep = require("../packages/adapters/prepare"), { postmark, bounceEvent } = require("../packages/adapters/email-out"), { googleDrive } = require("../packages/adapters/drive"), { voiceForward } = require("../packages/adapters/twilio");
const NOW = () => new Date(2027, 0, 25, 10, 5), W2 = (o) => Object.assign({ form: "W2", year: 2026, payer: "Acme Logistics", recipient: "self", read: { legible: 0.95, conf: 0.97, note: "", missing: [] } }, o);
const blank = (opt) => { const T = createEngine(); T.blank(Object.assign({ plan: "Practice", name: "Test CPAs", phone: "(615) 555-0100", now: NOW(), senderStatus: "approved", users: [{ id: "u1", first: "Pat", name: "Pat Owner", role: "owner", email: "pat@test.example" }] }, opt)); T.setUser("u1"); return T; };

// ---- the original goes to the firm first ------------------------------------------------------------------------------
test("engine: with storage connected and 'on arrival' chosen, an accepted document is delivered the moment it is accepted", () => {
  const { T, c, e } = started(); T.S.firm.delivery = { provider: "Google Drive", folder: "Client Tax Docs", auto: "on", when: "arrival" };
  const d = T.inboundDoc(c.id, W2(), "text"); assert.equal(d.state, "accepted"); assert.ok(d.master && d.master.place === "incoming"); assert.ok(d.deliveredAt, "accepted but not delivered");
  const bad = T.inboundDoc(c.id, W2({ payer: "Other Co", read: { legible: 0.2, conf: 0.9, note: "", missing: [] } }), "text"); assert.ok(bad.master, "a rejected original still goes to the firm"); assert.ok(!bad.deliveredAt);
  assert.equal(T.retain().afterDelivery, 7, "the default keep-for time is a week now");
});
const FIRM_NO = "+16155550100", JO = "+16155550111", big = Buffer.alloc(80000, 7);
async function setup(answer, opt) {
  let t = NOW(); const ai = answer === null ? null : fakeAI((prompt, o) => { if (prompt.startsWith("You read photos") || prompt.startsWith("The images are the pages")) return typeof answer === "function" ? answer(prompt, o) : Object.assign({ is_tax_document: true, form: "W2", tax_year: 2026, payer: "Acme Logistics", recipient_name: "JO DAY", legibility: 0.95, confidence: 0.97, missing_parts: [], note: "A W-2" }, answer);
    if (prompt.startsWith("You read text messages")) return { intent: "thanks", item_id: null, later_days: null, summary: "Says thanks", scope: "documents", sentiment: "calm", memory: null, staff_reply: null };
    if (prompt.startsWith("You read emails")) return { items: [], question: false, summary: "Sent documents" }; if (prompt.startsWith("You write one message")) return { text: null }; return null; });
  const store = memoryStore(), sms = fakeSender(), email = fakeSender(), files = memoryFiles(), app = createApp({ store, sms, email, ai, files, clock: () => t });
  await app.createFirm("f1", { plan: "Practice", name: "Test CPAs", email: "office@test.example", inbox: "t@docs.tallyhound.example", smsNumber: FIRM_NO, senderStatus: "approved", mode: "autopilot", users: [{ id: "u1", first: "Pat", name: "Pat Owner", role: "owner", email: "pat@test.example" }] });
  await app.staff("f1", "u1", (T) => { T.importRows(T.parseCSV("First,Last,Email,Mobile\nJo,Day,jo@x.example,6155550111")); const e = T.S.engs[0]; T.itemsOf(e.id).find((i) => i.form === "W2").payer = "Acme Logistics"; e.confirmed = true; T.start(e.id); T.giveConsent(T.S.clients[0].id, "page");
    T.S.firm.delivery = Object.assign({ provider: "Google Drive", folder: "Client Tax Docs", auto: "on", when: "arrival" }, opt); });
  const state = async () => { const T = createEngine(); T.load(await store.readState("f1")); return T; };
  return { app, store, sms, files, ai, state, tickTime: (ms) => { t = new Date(t.getTime() + ms); } };
}
const photo = (x, id) => x.app.inboundSms({ to: FIRM_NO, from: JO, body: "", media: [{ bytes: big, contentType: "image/jpeg" }], providerId: id || "s1" });
test("pipeline: an accepted document is in the firm's own storage, under its final name, within the same event", async () => {
  const x = await setup(); await photo(x); const f = [...x.files.items.values()];
  assert.equal(f.length, 1); assert.equal(f[0].folder, "Client Tax Docs/2026/Day, Jo"); assert.match(f[0].name, /2026.*W-?2.*Acme/i); assert.ok(f[0].bytes.equals(big), "the firm must get the original bytes, unchanged");
  const T = await x.state(), d = T.S.docs[0]; assert.equal(d.master.place, "final"); assert.equal(d.hold, null);
  x.tickTime(8 * 86400000); await x.app.tick("f1"); await x.app.tick("f1"); assert.equal(x.store.files.size, 0, "our copy should be gone a week after delivery"); assert.equal(x.files.items.size, 1, "the firm's copy stays");
});
test("pipeline: a document that needs a person waits in '_To check' and is renamed into place when staff accept it", async () => {
  const x = await setup({ confidence: 0.6 }); await photo(x); let f = [...x.files.items.values()][0];
  assert.equal(f.folder, "Client Tax Docs/2026/Day, Jo/_To check"); assert.match(f.name, /^arrived 2027-01-25/);
  await x.app.staff("f1", "u1", (T) => { const t = T.S.tasks.find((k) => k.status === "open" && k.kind === "document"); assert.ok(t, "expected a review task"); T.decideTask(t.id, "accept", {}); });
  await x.app.tick("f1"); f = [...x.files.items.values()][0]; assert.equal(f.folder, "Client Tax Docs/2026/Day, Jo"); assert.match(f.name, /W-?2/i); assert.equal(x.files.items.size, 1, "moved, not copied");
});
test("pipeline: an unreadable photo is kept for the firm under '_Not used', never mixed with accepted documents", async () => {
  const x = await setup({ legibility: 0.1 }); await photo(x); const f = [...x.files.items.values()][0]; assert.equal(f.folder, "Client Tax Docs/2026/Day, Jo/_Not used");
});
test("pipeline: while the firm's storage is failing, Tallyhound keeps its copy past the keep-for time and says so", async () => {
  const x = await setup(); x.files.failNext(99); await photo(x); assert.equal(x.files.items.size, 0);
  x.tickTime(10 * 86400000); for (let i = 0; i < 4; i++) { x.tickTime(3 * 60000); await x.app.tick("f1"); }
  let T = await x.state(); assert.equal(x.store.files.size, 1, "our copy was deleted before the firm had its own"); assert.ok(T.hasContent(T.S.docs[0])); assert.ok(T.S.alerts.some((a) => a.kind === "storage_failed"));
  x.files.failNext(0); x.tickTime(3 * 60000); await x.app.tick("f1"); assert.equal(x.files.items.size, 1);
  x.tickTime(20 * 60000); await x.app.tick("f1"); await x.app.tick("f1"); assert.equal(x.store.files.size, 0, "once the firm has it and the time has passed, ours goes");
});

// ---- a second, independent reading ----------------------------------------------------------------------------------
const W2TEXT = "2026 Form W-2 Wage and Tax Statement Copy B To Be Filed With Employee's FEDERAL Tax Return. Employer: Acme Logistics Inc. Employee: Jo Day. Department of the Treasury Internal Revenue Service";
test("precheck: the form and year are read from a PDF's own text by plain rules", () => {
  assert.deepEqual([precheck.fromText(W2TEXT).form, precheck.fromText(W2TEXT).year], ["W2", 2026]);
  assert.equal(precheck.fromText("Charles Schwab 2026 Tax Reporting Statement. Consolidated Form 1099. Includes 1099-DIV, 1099-INT and 1099-B proceeds from broker transactions for tax year 2026").form, "1099CONS");
  assert.equal(precheck.fromText("Form 1098 Mortgage Interest Statement for calendar year 2025 Regions Mortgage lender borrower").year, 2025);
  assert.equal(precheck.fromText("hello").form, null); assert.equal(precheck.fromText("Thank you for your payment. Invoice 20261 for landscaping services rendered in the spring season.").form, null);
  assert.equal(precheck.photoOk({ width: 320, height: 240 }).why, "small"); assert.equal(precheck.photoOk({ width: 2000, height: 1500, mean: 20 }).why, "dark"); assert.equal(precheck.photoOk({ width: 2000, height: 1500, mean: 140, sharp: 12 }).why, "blurry"); assert.ok(precheck.photoOk({ width: 2000, height: 1500, mean: 140, sharp: 300 }).ok);
});
test("pipeline: when the model and the file's own text disagree, nobody is trusted and a person looks", async () => {
  const x = await setup({ tax_year: 2025 });   // the model misreads the year; the text says 2026
  const r = await x.app.inboundEmail({ to: "t@docs.tallyhound.example", from: "jo@x.example", body: "W-2 attached", attachments: [{ bytes: big, contentType: "application/pdf", text: W2TEXT }], providerId: "e1", trusted: true });
  const T = await x.state(), d = T.S.docs[0]; assert.notEqual(d.state, "accepted"); assert.match(d.read.note, /Two readings disagree on the tax year/); assert.ok(T.S.tasks.some((t) => t.kind === "document" && t.status === "open"), "expected a person to be asked");
  const y = await setup(); await y.app.inboundEmail({ to: "t@docs.tallyhound.example", from: "jo@x.example", body: "", attachments: [{ bytes: big, contentType: "application/pdf", text: W2TEXT }], providerId: "e1", trusted: true });
  const d2 = (await y.state()).S.docs[0]; assert.equal(d2.state, "accepted"); assert.equal(d2.read.by, "both");
});
test("pipeline: with the model unavailable, a PDF with its own text is still identified", async () => {
  const x = await setup(null); await x.app.inboundEmail({ to: "t@docs.tallyhound.example", from: "jo@x.example", body: "", attachments: [{ bytes: big, contentType: "application/pdf", text: W2TEXT }], providerId: "e1", trusted: true });
  const d = (await x.state()).S.docs[0]; assert.equal(d.form, "W2"); assert.equal(d.year, 2026); assert.equal(d.read.by, "text");
});
test("pipeline: a very long PDF is read from its first pages only, and says so", async () => {
  let seen = 0; const x = await setup((p, o) => { seen = o.images.length; return { documents: [{ is_tax_document: true, form: "1099CONS", tax_year: 2026, payer: "Fidelity", recipient_name: "JO DAY", legibility: 0.95, confidence: 0.95, missing_parts: [], note: "Brokerage statement", pages: [1, 2, 3] }] }; });
  await x.app.inboundEmail({ to: "t@docs.tallyhound.example", from: "jo@x.example", body: "", attachments: [{ bytes: big, contentType: "application/pdf", pages: Array.from({ length: 140 }, () => big) }], providerId: "e1", trusted: true });
  assert.equal(seen, MAX_PAGES); assert.match((await x.state()).S.docs[0].read.note, /Only the first 90 of 140 pages/);
});

// ---- corrected forms -------------------------------------------------------------------------------------------------
test("a corrected form replaces the earlier copy and the preparer is told", () => {
  const { T, c, e } = started(); const a = T.inboundDoc(c.id, W2(), "text"); assert.equal(a.state, "accepted");
  const b = T.inboundDoc(c.id, W2({ corrected: true }), "text");
  assert.equal(b.state, "accepted"); assert.equal(a.state, "duplicate"); assert.equal(a.supersededBy, b.id); assert.ok(T.S.alerts.some((x) => x.kind === "corrected"));
  assert.equal(T.itemsOf(e.id).find((i) => i.form === "W2").docId, b.id);
  const again = T.inboundDoc(c.id, W2(), "text"); assert.equal(again.state, "duplicate", "the same form again, not marked corrected, is still a duplicate");
});

// ---- every kind of return --------------------------------------------------------------------------------------------
test("import: a business, a trust and a nonprofit each get the right return type and starting list", () => {
  const T = blank(); T.importRows(T.parseCSV("First,Last,Email,Business name,Return type\nDana,Fox,dana@x.example,Fox Plumbing LLC,1120-S\n,,books@x.example,Riverbend Partners,Partnership\nLee,Park,lee@x.example,Park Family Trust,1041\nAmi,Roe,ami@x.example,Helping Hands,non-profit\nJo,Day,jo@x.example,,"));
  const by = (n) => { const c = T.S.clients.find((x) => (x.entity || x.first) === n), e = T.engOf(c.id); return { c, e, forms: T.itemsOf(e.id).map((i) => i.form) }; };
  assert.equal(by("Fox Plumbing LLC").e.type, "1120S"); assert.ok(by("Fox Plumbing LLC").forms.includes("PNL") && by("Fox Plumbing LLC").forms.includes("PAYROLL_REPORT"));
  assert.equal(by("Riverbend Partners").e.type, "1065"); assert.equal(by("Riverbend Partners").c.first, "Riverbend Partners", "a business with no contact name is addressed by its own name");
  assert.equal(by("Park Family Trust").e.type, "1041"); assert.ok(by("Park Family Trust").forms.includes("K1")); assert.equal(by("Helping Hands").e.type, "990"); assert.equal(by("Jo").e.type, "1040"); assert.deepEqual(by("Jo").forms.sort(), ["1098", "W2"]);
  assert.equal(Object.keys(T.RETURNS).length, 6); assert.ok(T.templates().some((t) => t.id === "t_scorp"));
});
test("a business client's request names the business, and a long report is asked for as a PDF by email", () => {
  const T = blank(); T.importRows(T.parseCSV("First,Last,Email,Business name,Return type\nDana,Fox,dana@x.example,Fox Plumbing LLC,S corp")); const e = T.S.engs[0]; e.confirmed = true; T.start(e.id); T.advance(10 * T.MIN);
  const m = T.S.msgs.filter((x) => x.dir === "out" && x.tpl === "M3")[0]; assert.ok(m, "no first request"); assert.match(m.body, /for your 2026 return for Fox Plumbing LLC/); assert.match(m.body, /PDF by email works best/); assert.ok(!/Reply with a photo/.test(m.body));
  assert.equal(nameMatch({ first: "Dana", last: "Fox", entity: "Fox Plumbing LLC" }, "FOX PLUMBING LLC"), "self"); assert.equal(nameMatch({ first: "Dana", last: "Roe", entity: "The Riverbend Group Inc" }, "Riverbend Group"), "self"); assert.equal(nameMatch({ first: "Dana", last: "Roe", entity: "Riverbend Group" }, "ACME CORP"), "other");
  T.rollSeason(2027); const next = T.S.engs.find((x) => x.year === 2027); if (next) assert.equal(next.type, "1120S", "the return type must carry into next season");
});

// ---- a fast and legal start to texting -------------------------------------------------------------------------------
test("text registration can be filed during the trial once the firm check has passed, and bad details are caught before filing", () => {
  const T = createEngine(); T.blank({ name: "New Firm", now: NOW(), verified: false, users: [{ id: "u1", first: "Pat", name: "Pat Owner", role: "owner", email: "p@x.example" }] }); T.setUser("u1");
  const good = { legalName: "New Firm LLC", ein: "62-1234567", street: "12 Main St", city: "Franklin", state: "tn", zip: "37064", contact: "Pat Owner" };
  assert.match(T.registerSender(good), /still being checked/); T.setVerified(true);
  assert.match(T.registerSender(Object.assign({}, good, { ein: "123" })), /9-digit EIN/); assert.match(T.registerSender(Object.assign({}, good, { zip: "" })), /full address/);
  assert.equal(T.registerSender(good), null); assert.equal(T.S.firm.senderStatus, "submitted"); assert.equal(T.S.firm.reg.ein, "621234567"); assert.equal(T.billing().state, "trial", "no plan was needed");
  assert.match(T.registerSender({ legalName: "Sam Solo", soleProp: true, street: "1 A St", city: "Franklin", state: "TN", zip: "37064", contact: "Sam Solo" }), /owner's own mobile/);
});
test("registration kit: one tested submission for every firm, and a public page that says what the carriers look for", () => {
  const f = { name: "Larkin & Poe CPAs", email: "office@larkinpoe.example", phone: "(615) 555-0100" }, r = { legalName: "Larkin & Poe CPAs PLLC", ein: "621234567", street: "12 Main St", city: "Franklin", state: "TN", zip: "37064", contact: "Morgan Larkin" };
  assert.deepEqual(reg.problems(r), []); assert.match(reg.problems(Object.assign({}, r, { street: "PO Box 12" })).join(" "), /PO box/); assert.match(reg.problems(Object.assign({}, r, { ein: "001234567" })).join(" "), /prefix/);
  const b = reg.brand(f, r); assert.equal(b.type, "LOW_VOLUME_STANDARD"); assert.equal(b.reseller, "Tallyhound"); assert.equal(b.legalName, "Larkin & Poe CPAs PLLC"); assert.equal(reg.brand(f, Object.assign({}, r, { soleProp: true, ein: "", ownerMobile: "6155550199" })).type, "SOLE_PROPRIETOR");
  assert.throws(() => reg.brand(f, { legalName: "x" }));
  const c = reg.campaign(f, r); for (const need of [/unticked box/, /Message and data rates may apply/, /STOP/, /HELP/, /never a condition/, /not shared with or sold/]) assert.match(c.messageFlow, need);
  assert.ok(c.sampleMessages.length >= 3 && c.sampleMessages.every((m) => m.includes("Larkin & Poe CPAs"))); assert.ok(c.sampleMessages.some((m) => /STOP/.test(m)));
  const page = reg.firmPage(f, { number: "(615) 555-0142", address: "larkin-poe@docs.tallyhound.com" }); for (const need of [/Larkin &amp; Poe CPAs/, /\(615\) 555-0142/, /never ask you to text or email a Social Security number/, /Reply <b>STOP<\/b>/, /never sold, rented or shared/, /Message and data rates may apply/, /id="privacy"/, /id="terms"/]) assert.match(page, need);
  assert.ok(!/<script/i.test(reg.firmPage({ name: "<script>alert(1)</script>" }, {})));
  const h = reg.headsUp(f, { number: "(615) 555-0142", address: "larkin-poe@docs.tallyhound.com" }); assert.match(h.email, /texts from \(615\) 555-0142 and emails from larkin-poe@docs/); assert.match(h.email, /never ask you to send a Social Security number/); assert.match(h.letter, /Reply STOP to stop/); assert.match(h.letter, /not a condition/);
  const w = reg.readyBy(NOW()); assert.equal(Math.round((w.latest - w.earliest) / 86400000), 14);
});
test("the invitation tells the client how to check it is genuine", () => {
  const T = blank({ senderStatus: "approved" }); T.importRows(T.parseCSV("First,Last,Email,Mobile\nJo,Day,jo@x.example,6155550111")); const e = T.S.engs[0]; e.confirmed = true; T.start(e.id); T.advance(10 * T.MIN);
  const m = T.S.msgs.find((x) => x.tpl === "M1"); assert.ok(m, "no invitation"); assert.match(m.body, /To check this message is really from us, call the office at \(615\) 555-0100\./);
  T.markHeadsUp(); assert.ok(T.S.firm.headsUpAt);
});

// ---- sign-in ---------------------------------------------------------------------------------------------------------
test("sign-in: the one-time code matches the published standard, and a used code or link is refused", () => {
  const raw = Buffer.from("12345678901234567890"); assert.equal(auth.totp(raw, 59000), "287082"); assert.equal(auth.totp(raw, 1111111109000), "081804"); assert.equal(auth.base32(Buffer.from("foobar")), "MZXW6YTBOI");
  const now = 1800000000000, code = auth.totp(raw, now), v = auth.verifyTotp(raw, code, now); assert.ok(v.ok); assert.ok(auth.verifyTotp(raw, auth.totp(raw, now - 30000), now).ok, "the previous half-minute should pass");
  assert.equal(auth.verifyTotp(raw, code, now, v.step).ok, false, "the same code twice"); assert.equal(auth.verifyTotp(raw, "000000", now).ok, false); assert.equal(auth.verifyTotp(raw, auth.totp(raw, now - 120000), now).ok, false);
  const used = new Set(), t = auth.issueLink("s3cret", "Pat@Test.example", now); assert.deepEqual(auth.checkLink("s3cret", t, now + 60000, used).email, "pat@test.example");
  assert.equal(auth.checkLink("s3cret", t, now + 60000, used).why, "used"); assert.equal(auth.checkLink("s3cret", t, now + 16 * 60000, new Set()).why, "expired"); assert.equal(auth.checkLink("other", t, now, new Set()).why, "invalid"); assert.equal(auth.checkLink("s3cret", t.replace(/.$/, "x"), now, new Set()).why, "invalid");
  const s = auth.newSession(now); assert.equal(auth.hashToken(s.token), s.hash); assert.ok(!s.hash.includes(s.token)); const rc = auth.recoveryCodes(); assert.equal(rc.codes.length, 10); assert.equal(new Set(rc.codes).size, 10); assert.equal(auth.hashToken(rc.codes[3]), rc.hashes[3]);
});

// ---- file preparation ------------------------------------------------------------------------------------------------
test("files are identified by their first bytes, never by what the sender calls them", async () => {
  const jpg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(40)]), pdf = Buffer.from("%PDF-1.7\n1 0 obj << /Type /Page >> endobj 2 0 obj << /Type /Pages >> endobj 3 0 obj << /Type /Page /Parent 2 0 R >> endobj trailer << /Root 1 0 R >>"), locked = Buffer.from("%PDF-1.7\n1 0 obj << /Type /Page >> endobj trailer << /Encrypt 9 0 R >>"), heic = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from("ftypheic"), Buffer.alloc(40)]), docx = Buffer.concat([Buffer.from("PK\x03\x04"), Buffer.alloc(40)]), exe = Buffer.concat([Buffer.from("MZ"), Buffer.alloc(40)]);
  assert.deepEqual([jpg, pdf, heic, docx, exe].map(prep.sniff), ["image/jpeg", "application/pdf", "image/heic", "application/zip", "application/x-executable"]);
  assert.equal((await prep.prepare({ bytes: exe, contentType: "image/jpeg" })).contentType, "application/x-executable", "a program renamed to .jpg must not pass as a photo");
  const p = await prep.prepare({ bytes: pdf, contentType: "application/pdf" }); assert.equal(p.pageCount, 2); assert.equal(p.locked, false); assert.equal((await prep.prepare({ bytes: locked })).locked, true); assert.equal(p.fingerprint.length, 64);
  assert.equal((await prep.prepare({ bytes: heic })).refused, "heic"); const conv = await prep.prepare({ bytes: heic }, { heic: async () => jpg }); assert.equal(conv.contentType, "image/jpeg"); assert.equal(conv.convertedFrom, "image/heic");
  assert.equal((await prep.prepare({ bytes: jpg }, { scan: async () => ({ clean: false, name: "Eicar" }) })).refused, "infected");
  const sock = new EventEmitter(), sent = []; sock.write = (b) => { sent.push(Buffer.from(b)); if (Buffer.from(b).equals(Buffer.alloc(4))) setImmediate(() => { sock.emit("data", Buffer.from("stream: Win.Test.EICAR_HDB-1 FOUND\0")); sock.emit("end"); }); };
  const v = await prep.clamav({ connect: () => sock })(Buffer.from("X5O!P")); assert.equal(v.clean, false); assert.equal(v.name, "Win.Test.EICAR_HDB-1"); assert.equal(sent[0].toString(), "zINSTREAM\0");
});

// ---- adapters written against the published APIs (stand-ins here; none has run live) --------------------------------
test("outbound email: sent in the firm's name from its Tallyhound address, and a bounced address is reported as such", async () => {
  const calls = []; let reply = { ok: true, status: 200, json: async () => ({ MessageID: "pm-1" }) }; const pm = postmark({ serverToken: "tok", fetchImpl: async (u, o) => { calls.push({ u, o }); return reply; } });
  assert.equal(await pm.send({ from: "larkin-poe@docs.tallyhound.com", fromName: 'Larkin "&" Poe', to: "jo@x.example", subject: "s", body: "b", idempotencyKey: "m1" }), "pm-1");
  const sent = JSON.parse(calls[0].o.body); assert.equal(sent.From, '"Larkin & Poe" <larkin-poe@docs.tallyhound.com>'); assert.equal(sent.ReplyTo, "larkin-poe@docs.tallyhound.com"); assert.equal(sent.TrackOpens, false); assert.equal(calls[0].o.headers["x-postmark-server-token"], "tok");
  reply = { ok: false, status: 422, json: async () => ({ ErrorCode: 406, Message: "Inactive recipient" }) }; await assert.rejects(pm.send({ from: "a@b.c", to: "x@y.z", subject: "s", body: "b" }), (e) => e.code === "bounced");
  assert.deepEqual(bounceEvent({ RecordType: "Bounce", Type: "HardBounce", Email: "Jo@X.example", MessageID: "pm-1" }), { email: "jo@x.example", hard: true, kind: "bounce", id: "pm-1" }); assert.equal(bounceEvent({ RecordType: "Bounce", Type: "SoftBounce", Email: "a@b.c" }).hard, false);
});
test("Google Drive: folders are made as needed, the upload carries the original bytes, and a rename is a move, not a copy", async () => {
  const log = []; let n = 0; const drive = googleDrive({ token: async () => "tok", rootId: async () => "ROOT", fetchImpl: async (u, o) => { o = o || {}; log.push((o.method || "GET") + " " + u.split("?")[0].replace("https://www.googleapis.com", ""));
    assert.equal(o.headers.authorization, "Bearer tok"); let j = {}; if (!o.method && u.includes("q=")) j = { files: [] }; else if (o.method === "POST" && u.includes("/upload/")) { assert.ok(Buffer.from(o.body).includes(big)); j = { id: "FILE1" }; } else if (o.method === "POST") j = { id: "F" + ++n }; else if (!o.method) j = { parents: ["F4"] };
    return { ok: true, status: 200, json: async () => j }; } });
  const id = await drive.put({ firmId: "f1", folder: "Client Tax Docs/2026/Day, Jo/_To check", name: "arrived.jpg", bytes: big, contentType: "image/jpeg" }); assert.equal(id, "FILE1");
  assert.equal(log.filter((l) => l.startsWith("POST /drive/v3/files")).length, 4, "four folders created"); assert.equal(log.filter((l) => l.includes("/upload/")).length, 1);
  log.length = 0; await drive.move({ firmId: "f1", id: "FILE1", folder: "Client Tax Docs/2026/Day, Jo", name: "2026 W-2 Acme.pdf" }); assert.ok(log.some((l) => l.startsWith("PATCH /drive/v3/files/FILE1"))); assert.ok(!log.some((l) => l.includes("/upload/")));
});
test("a call to the text number rings the firm's office", () => { assert.match(voiceForward("(615) 555-0100"), /<Dial>\+16155550100<\/Dial>/); assert.match(voiceForward(""), /only receives text messages/); assert.ok(!/<Dial>/.test(voiceForward("12"))); });
