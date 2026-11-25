// Tallyhound v2 (docs/V2.md): email-first. Letters by email from the firm, documents through the upload link, no texting.
// The acceptance scenarios of the v2 spec, section 11, that the engine decides. The mail layer's own tests are in apps/server/test.
const test = require("node:test");
const assert = require("node:assert/strict");
const { createEngine } = require("../packages/engine");

const MON = () => new Date(2027, 0, 25, 10, 5, 0);   // Monday, January 25, 2027
// Maple & Pine Tax Co., one client (Maria Garcia) with a W-2, a 1099-INT and a 1098. Sends on its own unless told otherwise.
function lfirm(opt) {
  const T = createEngine();
  T.blank(Object.assign({ letters: true, plan: "Practice", name: "Maple & Pine Tax Co.", email: "docs@mapleandpine.example", mode: "autopilot", confirmAll: false, now: MON(), users: [{ id: "u1", first: "Dana", name: "Dana Whitfield", role: "owner", email: "dana@mapleandpine.example" }, { id: "u2", first: "Alex", name: "Alex Reyes", role: "staff", email: "alex@mapleandpine.example" }] }, opt));
  T.S.firm.linkBase = "send.tallyhound.example"; T.S.firm.slug = "maple";
  T.importRows(T.parseCSV("First,Last,Email,Preparer\nMaria,Garcia,maria@x.example,Dana"));
  const c = T.S.clients[0], e = T.engOf(c.id);
  T.itemsOf(e.id).find((i) => i.form === "W2").payer = "Acme Logistics"; T.itemsOf(e.id).find((i) => i.form === "1098").payer = "Hillcrest Mortgage"; T.addItem(e.id, "1099INT", "First Farmers Bank");
  return { T, c, e };
}
const go = (opt) => { const x = lfirm(opt); x.e.confirmed = true; assert.equal(x.T.start(x.e.id), null); x.T.advance(5 * x.T.MIN); return x; };
const out = (T, e) => T.S.msgs.filter((m) => m.engId === e.id && m.dir === "out" && m.status !== "discarded");
const letters = (T, e) => out(T, e).filter((m) => /^L\d$/.test(m.tpl));
const item = (T, e, form) => T.itemsOf(e.id).find((i) => i.form === form);
const open = (T, e, kind) => T.S.tasks.filter((t) => t.status === "open" && t.engId === e.id && (!kind || t.kind === kind));
const md = (d) => (d.getMonth() + 1) + "/" + d.getDate();

test("scenario 2: Go fetch sends one letter listing all three documents with the link; follow-ups go on working days 2, 5, 9 and the last on 14", () => {
  const { T, c, e } = go(); const L = letters(T, e); assert.equal(L.length, 1); const m = L[0];
  assert.equal(m.channel, "email"); assert.equal(m.tpl, "L1"); assert.equal(m.subject, "3 documents for your 2026 tax return");
  assert.equal(m.body, "Hi Maria,\n\nTo prepare your 2026 return we still need:\n\n  - W-2 from Acme Logistics\n  - 1099-INT from First Farmers Bank\n  - 1098 from Hillcrest Mortgage\n\nUpload them here. No account or password needed:\nhttps://send.tallyhound.example/u/maple-" + e.link.key + "\n\nA phone photo or a PDF both work.\n\nThank you,\nDana Whitfield\nMaple & Pine Tax Co.");
  assert.deepEqual(m.letterItems.length, 3); assert.equal(T.S.msgs.filter((x) => x.channel === "text").length, 0);
  T.advance(40 * T.DAY); const all = letters(T, e);
  // Working days from Monday January 25: 2 is Wed 1/27, 5 is Mon 2/1, 9 is Fri 2/5, 14 is Fri 2/12.
  assert.deepEqual(all.map((x) => md(x.at)), ["1/25", "1/27", "2/1", "2/5", "2/12"]); assert.deepEqual(all.map((x) => x.tpl), ["L1", "L2", "L2", "L2", "L3"]);
  assert.ok(all.slice(1).every((x) => x.at.getHours() === 9), "follow-ups go in the morning"); assert.ok(all.every((x) => x.body.includes("/u/maple-" + e.link.key)), "every letter carries the same link");
  // Scenario 16: after the last one the client has gone quiet, a person is told, and nothing more is sent.
  assert.equal(e.status, "stuck"); assert.equal(open(T, e, "gone_quiet").length, 1); T.advance(30 * T.DAY); assert.equal(letters(T, e).length, 5);
});
test("TH-EML-3: for any start day and pace, a client who never replies gets exactly the preset's letters, each on a working day, never two in a day", () => {
  for (let k = 0; k < 120; k++) {
    const preset = ["gentle", "steady", "persistent"][k % 3], start = new Date(2027, 0, 4 + (k * 7) % 90, 8 + (k % 9), 15);
    const { T, e } = lfirm({ now: start }); T.S.firm.hound.intensity = preset; if (k % 5 === 0) T.setClosedDays([T.dayKey ? T.dayKey(new Date(+start + 3 * T.DAY)) : ""].filter(Boolean));
    e.confirmed = true; assert.equal(T.start(e.id), null); T.advance(60 * T.DAY);
    const L = letters(T, e), P = T.CADENCE_PRESETS[preset]; assert.equal(L.length, P.days.length + 2, preset + " from " + start.toDateString());
    assert.equal(new Set(L.map((m) => m.at.toDateString())).size, L.length); assert.ok(L.every((m) => T.isWorkDay(m.at)), "a letter went on a day off");
    // Counted in working days from the first letter.
    const d0 = L[0].at, wd = (d) => { let n = 0; for (let x = new Date(d0.getFullYear(), d0.getMonth(), d0.getDate() + 1); x <= d; x = new Date(x.getFullYear(), x.getMonth(), x.getDate() + 1)) if (T.isWorkDay(x)) n++; return n; };
    assert.deepEqual(L.slice(1).map((m) => wd(m.at)), P.days.concat([P.final])); assert.equal(e.status, "stuck");
  }
});

test("scenario 3: a clean W-2 through the link is checked and counted; the next letter lists two documents and says nothing about the W-2", () => {
  const { T, c, e } = go(); const n = out(T, e).length;
  const d = T.inboundDoc(c.id, { form: "W2", year: 2026, payer: "Acme Logistics" }, "portal"); assert.equal(d.state, "accepted"); assert.equal(item(T, e, "W2").state, "received");
  assert.equal(out(T, e).length, n, "the page says Got it; no email repeats it"); assert.deepEqual(T.uploadResult(d, "en"), { ok: true, text: "Got it: W-2 from Acme Logistics." });
  T.advance(4 * T.DAY); const L = letters(T, e); assert.equal(L.length, 2); assert.equal(md(L[1].at), "1/27", "the reminders start over from the day the document came");
  assert.equal(L[1].subject, "2 documents for your 2026 tax return"); assert.ok(!/W-2/.test(L[1].body)); assert.match(L[1].body, /1099-INT from First Farmers Bank\n {2}- 1098 from Hillcrest Mortgage/);
});
test("scenario 4: last year's W-2 gets the fix sentence on the page, is not counted, and the next letter says what was wrong", () => {
  const { T, c, e } = go(); const n = out(T, e).length, d = T.inboundDoc(c.id, { form: "W2", year: 2025, payer: "Acme Logistics" }, "portal");
  assert.equal(d.state, "rejected"); assert.equal(item(T, e, "W2").state, "requested"); assert.equal(out(T, e).length, n);
  assert.deepEqual(T.uploadResult(d, "en"), { ok: false, text: "That one is for 2025. We need the 2026 version. It usually arrives by January 31." });
  T.advance(3 * T.DAY); assert.match(letters(T, e)[1].body, /- W-2 from Acme Logistics \(the copy you sent was for 2025\)/);
  // By email instead, the fix goes back by email at once, with the link.
  const y = go(), n2 = out(y.T, y.e).length; y.T.inboundEmail(y.c.id, "here you go", [{ form: "W2", year: 2025, payer: "Acme Logistics" }], null);
  const reply = out(y.T, y.e).slice(n2); assert.equal(reply.length, 1); assert.equal(reply[0].channel, "email");
});
test("scenario 5: \"sent it\" with nothing uploaded sends the link again once; the second time it is a question for a person", () => {
  const { T, c, e } = go(); T.setUser("u1"); T.advance(T.DAY);
  assert.equal(T.inboundReply(c.id, "I already sent that last week", { intent: "already_sent", confidence: "high", legacy_intent: "other_update", item_id: item(T, e, "W2").id }), "already_sent");
  const m = out(T, e).slice(-1)[0]; assert.equal(m.tpl, "M35R"); assert.match(m.body, /upload it here\? https:\/\/send\.tallyhound\.example\/u\/maple-/); assert.equal(open(T, e, "question").length, 0);
  T.advance(T.DAY); const n = out(T, e).length; T.inboundReply(c.id, "I sent it already!", { intent: "already_sent", confidence: "high", legacy_intent: "other_update", item_id: item(T, e, "W2").id });
  assert.equal(out(T, e).length, n, "the link is sent again only once"); assert.equal(open(T, e, "question").length, 1);
});
test("scenario 7: \"after the 15th\" opens a suggested step and changes nothing until a person clicks", () => {
  const { T, c, e } = go(); T.setUser("u1"); T.advance(2 * T.DAY); const n = out(T, e).length;
  T.inboundReply(c.id, "Can I send the W-2 after the 15th?"); const w2 = item(T, e, "W2");
  assert.equal(T.holdOf(w2, e), null, "the reply paused a document by itself"); assert.equal(out(T, e).length, n, "nothing is sent back");
  const t = open(T, e, "step")[0]; assert.ok(t, "no suggested step"); assert.equal(t.step.type, "hold"); assert.equal(md(new Date(t.step.until)), "2/16");
  assert.equal(T.decideTask(t.id, "apply_step", null), null); assert.equal(T.holdOf(w2, e).reason, "client_date"); assert.equal(md(new Date(T.holdOf(w2, e).until)), "2/16");
  T.advance(5 * T.DAY); const L = letters(T, e).slice(-1)[0]; assert.ok(!/W-2/.test(L.body), "a held document was named in a letter"); assert.match(L.body, /1099-INT/);
  // Dismissing leaves everything as it was.
  const y = go(); y.T.setUser("u1"); y.T.inboundReply(y.c.id, "I'll send the mortgage statement after the 20th"); const t2 = open(y.T, y.e, "step")[0]; assert.equal(y.T.decideTask(t2.id, "dismiss_step", null), null); assert.equal(y.T.holdOf(item(y.T, y.e, "1098"), y.e), null);
});
test("scenario 8: a tax question is passed to the preparer and the reply gives no advice", () => {
  const { T, c, e } = go(); T.inboundReply(c.id, "can I deduct my home office?");
  assert.equal(open(T, e, "question").length, 1); const m = out(T, e).slice(-1)[0]; assert.equal(m.tpl, "M14"); assert.equal(m.channel, "email"); assert.ok(!/deduct|you can|you should/i.test(m.body));
});
test("scenario 9: unsubscribe stops every letter and opens a can't-reach item, by the link or by a reply", () => {
  for (const how of ["link", "reply"]) {
    const { T, c, e } = go(); if (how === "link") T.stopEmail(c.id, "link"); else assert.equal(T.inboundReply(c.id, "Please unsubscribe me from these"), "stop");
    assert.equal(c.emailOff, true); assert.equal(open(T, e, "cant_reach").length, 1, how); const n = out(T, e).length; T.advance(30 * T.DAY); assert.equal(out(T, e).length, n, "a letter went to an unsubscribed address");
  }
});
test("scenario 10: a K-1 on the checklist in January is in no letter before its usual issue date, and is in the one after", () => {
  const { T, c, e } = lfirm(); T.addItem(e.id, "K1", "Okafor Family Trust"); e.confirmed = true; T.start(e.id); T.advance(5 * T.MIN);
  const k1 = item(T, e, "K1"), until = T.holdOf(k1, e); assert.ok(until && until.reason === "catalogue_date");
  assert.ok(!/K-1|Okafor/.test(letters(T, e)[0].body)); assert.equal(letters(T, e)[0].subject, "3 documents for your 2026 tax return");
  for (const f of ["W2", "1099INT", "1098"]) T.inboundDoc(c.id, { form: f, year: 2026, payer: item(T, e, f).payer }, "portal");
  assert.equal(e.status, "in_progress"); const n = letters(T, e).length; T.advance((+new Date(until.until) - +T.S.now) - T.DAY); assert.equal(letters(T, e).length, n, "the K-1 was asked for before its date");
  T.advance(4 * T.DAY); const L = letters(T, e).slice(-1)[0]; assert.match(L.body, /K-1 from Okafor Family Trust/); assert.equal(L.subject, "1 document for your 2026 tax return");
});
test("TH-EML-4, 5: in approve mode nothing leaves without a click, for the firm or for one client; a letter whose list changed is not sent", () => {
  const { T, c, e } = lfirm({ mode: "copilot" }); T.setUser("u1"); e.confirmed = true; T.start(e.id); T.advance(5 * T.MIN);
  const d = letters(T, e)[0]; assert.equal(d.status, "approval"); T.advance(3 * T.DAY); assert.ok(letters(T, e).every((m) => m.status === "approval"), "a draft went out by itself");
  // The W-2 arrives while the draft waits. Approving the old draft does not send a letter that still asks for it.
  T.inboundDoc(c.id, { form: "W2", year: 2026, payer: "Acme Logistics" }, "portal"); const draft = letters(T, e).slice(-1)[0];
  assert.match(String(T.approveMsg(draft.id, draft.body)), /list changed/); assert.equal(draft.status, "discarded");
  T.advance(4 * T.DAY); const fresh = letters(T, e).slice(-1)[0]; assert.equal(fresh.status, "approval"); assert.ok(!/W-2/.test(fresh.body)); assert.equal(T.approveMsg(fresh.id, fresh.body), null); assert.equal(fresh.status, "delivered");
  // One client set to send on its own in a firm that approves each letter, and the other way round.
  const y = lfirm({ mode: "copilot" }); y.T.setUser("u1"); assert.equal(y.T.setClientSendMode(y.c.id, "auto"), null); y.e.confirmed = true; y.T.start(y.e.id); y.T.advance(5 * y.T.MIN); assert.equal(letters(y.T, y.e)[0].status, "delivered");
  const z = lfirm(); z.T.setUser("u1"); z.T.setClientSendMode(z.c.id, "approve"); z.e.confirmed = true; z.T.start(z.e.id); z.T.advance(5 * z.T.MIN); assert.equal(letters(z.T, z.e)[0].status, "approval");
});
test("TH-EML-10, 12: the thank-you goes once; a firm-wide stop halts every letter and resuming picks up", () => {
  const { T, c, e } = go(); T.setUser("u1"); for (const f of ["W2", "1099INT", "1098"]) T.inboundDoc(c.id, { form: f, year: 2026, payer: item(T, e, f).payer }, "portal");
  assert.equal(e.status, "complete"); assert.equal(out(T, e).filter((m) => m.tpl === "M13").length, 1); T.advance(20 * T.DAY); assert.equal(out(T, e).filter((m) => m.tpl === "M13").length, 1); assert.equal(letters(T, e).length, 1);
  const y = go(); y.T.setUser("u1"); y.T.S.firm.stopped = true; y.T.advance(20 * y.T.DAY); assert.equal(letters(y.T, y.e).length, 1, "a letter left while the firm was stopped");
});
test("TH-EML-11: a 1,000-client start never sends more in a day than half the mailbox provider's limit, and everyone is reached within days", () => {
  const T = createEngine(); T.blank({ letters: true, mail: "mailbox", plan: "Large", name: "Big Firm", email: "docs@big.example", mode: "autopilot", confirmAll: false, now: MON(), users: [{ id: "u1", first: "Dana", name: "Dana Whitfield", role: "owner", email: "dana@big.example" }] });
  T.S.firm.linkBase = "send.tallyhound.example"; T.S.firm.slug = "big"; T.setMailbox("u1", { provider: "google", address: "dana@big.example" });
  T.importRows(T.parseCSV("First,Last,Email\n" + Array.from({ length: 1000 }, (_, i) => "C" + i + ",Client,c" + i + "@x.example").join("\n")));
  T.S.engs.forEach((e) => { e.confirmed = true; }); const r = T.startMany(T.S.engs.map((e) => e.id)); assert.equal(r.started, 1000);
  T.advance(3 * T.DAY); const byDay = {}; T.S.msgs.filter((m) => m.tpl === "L1").forEach((m) => { const k = m.at.toDateString(); byDay[k] = (byDay[k] || 0) + 1; });
  assert.ok(Object.values(byDay).every((n) => n <= T.MAIL_CAP.google), JSON.stringify(byDay)); assert.equal(T.S.msgs.filter((m) => m.tpl === "L1").length, 1000); assert.ok(Object.keys(byDay).length >= 1);
  assert.equal(T.MAIL_CAP.google, 1000);
});
test("TH-MBX: with the mail layer, a client whose preparer has no mailbox cannot be started; a disconnect stops their letters and a reconnect picks them up", () => {
  const { T, c, e } = lfirm({ mail: "mailbox" }); T.setUser("u1"); e.confirmed = true; assert.match(T.start(e.id), /Dana Whitfield has not connected a mailbox yet/);
  T.setMailbox("u1", { provider: "microsoft", address: "dana@mapleandpine.example" }); assert.equal(T.start(e.id), null); T.advance(5 * T.MIN); assert.equal(letters(T, e).length, 1); assert.equal(letters(T, e)[0].sender, "u1");
  T.setMailbox("u1", null); T.advance(10 * T.DAY); assert.equal(letters(T, e).length, 1, "a letter was written with no mailbox to send it"); assert.ok(T.S.alerts.some((a) => a.kind === "mailbox"));
  T.setMailbox("u1", { provider: "microsoft", address: "dana@mapleandpine.example" }); T.advance(T.DAY); assert.equal(letters(T, e).length, 2, "one letter on reconnecting, not one for every day missed");
});
test("section 6: in the pilot every document the sniff test decides also goes to a person, the file is not finished until they confirm, and agreement is counted by form", () => {
  const { T, c, e } = go({ confirmAll: true }); T.setUser("u1");
  const d = T.inboundDoc(c.id, { form: "W2", year: 2026, payer: "Acme Logistics" }, "portal"); assert.equal(d.state, "accepted"); assert.equal(d.unconfirmed, true);
  const t = open(T, e, "document")[0]; assert.ok(t && t.confirm); assert.equal(item(T, e, "W2").state, "received", "the client is not asked again for a document that passed");
  assert.equal(T.decideTask(t.id, "agree", null), null); assert.equal(d.unconfirmed, undefined); assert.deepEqual([T.agreement("W2").n, T.agreement("W2").ok], [1, 1]);
  // The person overrules a pass: it is asked for again and counted as a disagreement.
  const d2 = T.inboundDoc(c.id, { form: "1099INT", year: 2026, payer: "First Farmers Bank" }, "portal"), t2 = open(T, e, "document")[0]; assert.equal(T.decideTask(t2.id, "reask", { reason: "illegible" }), null);
  assert.equal(d2.state, "rejected"); assert.equal(item(T, e, "1099INT").state, "requested"); assert.deepEqual([T.agreement("1099INT").n, T.agreement("1099INT").ok], [1, 0]);
  // The last documents arrive and pass. No thank-you until a person has confirmed them.
  T.inboundDoc(c.id, { form: "1099INT", year: 2026, payer: "First Farmers Bank" }, "portal"); T.inboundDoc(c.id, { form: "1098", year: 2026, payer: "Hillcrest Mortgage" }, "portal");
  assert.notEqual(e.status, "complete"); assert.equal(out(T, e).filter((m) => m.tpl === "M13").length, 0);
  open(T, e, "document").forEach((x) => assert.equal(T.decideTask(x.id, "agree", null), null)); assert.equal(e.status, "complete"); assert.equal(out(T, e).filter((m) => m.tpl === "M13").length, 1);
  // 200 confirmed with 98% agreement: that form stops going to the queue.
  T.S.firm.agree.W2 = { n: 200, ok: 196 }; assert.equal(T.agreement("W2").auto, true); T.S.firm.agree["1098"] = { n: 200, ok: 195 }; assert.equal(T.agreement("1098").auto, false);
  const y = go({ confirmAll: true }); y.T.S.firm.agree = { W2: { n: 200, ok: 199 } }; const d3 = y.T.inboundDoc(y.c.id, { form: "W2", year: 2026, payer: "Acme Logistics" }, "portal"); assert.equal(d3.unconfirmed, undefined); assert.equal(open(y.T, y.e, "document").length, 0);
});
test("TH-UPL-1, 7: one link a season; staff can replace it or switch it off; it stops 30 days after the file is closed", () => {
  const { T, c, e } = go(); T.setUser("u1"); const k = e.link.key; assert.ok(/^[a-z]{28}$/.test(k)); assert.equal(T.linkFind(k).state, "live"); assert.equal(T.linkFind(k).e.id, e.id); assert.equal(T.linkFind("nobodyhasthiskeynobodyhasthis"), null);
  T.advance(40 * T.DAY); assert.equal(T.linkFind(k).state, "live", "the link lasts the season");
  assert.equal(T.rotateLink(e.id), null); assert.notEqual(e.link.key, k); assert.equal(T.linkFind(k).state, "revoked"); assert.equal(T.linkFind(e.link.key).state, "live");
  assert.equal(T.revokeLink(e.id), null); assert.equal(T.linkFind(e.link.key).state, "revoked"); assert.equal(T.rotateLink(e.id), null); assert.equal(T.linkFind(e.link.key).state, "live");
  T.closeEng(e.id); T.advance(29 * T.DAY); assert.equal(T.linkFind(e.link.key).state, "live"); T.advance(2 * T.DAY); assert.equal(T.linkFind(e.link.key).state, "expired");
});
test("the wording of every letter, in every voice, passes the output check and has no texting words", () => {
  for (const voice of ["professional", "warm", "brief"]) { const { T, c, e } = lfirm(); T.S.firm.hound.voice = voice; e.confirmed = true; T.start(e.id); T.advance(60 * T.DAY);
    const L = letters(T, e); assert.equal(L.length, 5); for (const m of L) { assert.deepEqual(T.outputCheck(m.body, "email", { year: 2026 }), []); assert.ok(!/text|reply with a photo|STOP|\{|¶|§/i.test(m.body), voice + ": " + m.body); assert.match(m.body, /Dana Whitfield\nMaple & Pine Tax Co\.$/); } }
  const { T } = lfirm(); for (const v of ["professional", "warm", "brief"]) for (const code of Object.keys(T.LETTER[v].en)) assert.ok(!/reply with a photo|photo by reply|YES or NO|by text/i.test(T.LETTER[v].en[code]), v + " " + code);
});
test("a document with no issuer named reads as its own name: W-2 wage statement, never W-2 (W-2 wage statement)", () => {
  const { T, e } = lfirm(); const w2 = item(T, e, "W2"); w2.payer = ""; assert.equal(T.itemTitle(w2, "en"), "W-2 wage statement"); assert.equal(T.itemTitle(item(T, e, "1098"), "en"), "1098 from Hillcrest Mortgage"); item(T, e, "1098").payer = ""; assert.equal(T.itemTitle(item(T, e, "1098"), "en"), "1098 (mortgage interest statement)");
});
test("TH-EML-2: the next letter can be read before it goes, word for word, without the client's link and without changing anything", () => {
  const { T, c, e } = lfirm(); e.confirmed = true; const before = JSON.stringify(T.dump()), p0 = T.letterPreview(e.id);
  assert.equal(p0.code, "L1"); assert.equal(p0.subject, "3 documents for your 2026 tax return"); assert.match(p0.body, /\(Maria's private upload link\)/); assert.equal(JSON.stringify(T.dump()), before, "reading the preview changed the firm");
  T.start(e.id); T.advance(5 * T.MIN); const sent = letters(T, e)[0], p1 = T.letterPreview(e.id); assert.equal(p0.body.replace("(Maria's private upload link)", "https://send.tallyhound.example/u/maple-" + e.link.key), sent.body, "the preview is not what was sent");
  assert.equal(p1.code, "L2"); assert.equal(md(new Date(p1.when)), "1/27"); assert.equal(p1.from, "docs@mapleandpine.example"); T.inboundDoc(c.id, { form: "W2", year: 2026, payer: "Acme Logistics" }, "portal"); assert.ok(!/W-2/.test(T.letterPreview(e.id).body));
  T.setUser("u1"); assert.equal(T.setWorkDays([1, 2, 3, 4]), null); assert.equal(T.isWorkDay(new Date(2027, 0, 29)), false, "Friday is no longer a working day"); assert.equal(T.setWorkDays([]), "Choose at least one working day"); assert.equal(T.setMailCap(5), "Choose a number from 10 to 5,000");
});
test("approving a letter someone edited in the browser sends the client's real link, never the words that stand in for it, and never a letter with the link cut out", () => {
  const { T, c, e } = lfirm({ mode: "copilot" }); T.setUser("u1"); e.confirmed = true; T.start(e.id); T.advance(5 * T.MIN); const d = letters(T, e)[0], real = "https://send.tallyhound.example/u/maple-" + e.link.key;
  const shown = d.body.split(e.link.key).join("(private link)"); assert.ok(!shown.includes(e.link.key));   // what the browser is given
  assert.match(T.approveMsg(d.id, shown.replace("Hi Maria,", "Dear Maria,").replace(/https:\S+/, "")), /Keep the client's link/); assert.equal(d.status, "approval");
  assert.equal(T.approveMsg(d.id, shown.replace("Hi Maria,", "Dear Maria,")), null); assert.equal(d.status, "delivered"); assert.ok(d.body.startsWith("Dear Maria,")); assert.ok(d.body.includes(real)); assert.ok(!d.body.includes("(private link)"));
});
test("section 11: the pilot's measures are worked out from the record, each against its target and its stop line, and say when there are too few cases", () => {
  const { T } = lfirm(); T.setUser("u1"); let M = T.pilotMeasures(); assert.equal(M.clients, 0); assert.ok(M.rows.every((r) => r.state === "early" && r.display === "No cases yet")); assert.equal(M.rows.length, 6);
  // Ten clients: letters go; six complete within a fortnight through the link, one sends a document by email, one unsubscribes.
  T.importRows(T.parseCSV("First,Last,Email\n" + Array.from({ length: 9 }, (_, i) => "C" + i + ",Client,c" + i + "@x.example").join("\n"))); T.S.engs.forEach((e) => { e.confirmed = true; T.itemsOf(e.id).forEach((i, k) => { if (k) i.state = "removed"; }); }); T.startMany(T.S.engs.map((e) => e.id)); T.advance(T.HOUR);
  const engs = T.S.engs.slice(); T.advance(3 * T.DAY);
  engs.slice(0, 6).forEach((e) => { const it = T.itemsOf(e.id)[0]; T.inboundDoc(e.clientId, { form: it.form, year: 2026, payer: it.payer }, "portal"); });
  const e7 = engs[6], it7 = T.itemsOf(e7.id)[0]; T.inboundEmail(e7.clientId, "", [{ form: it7.form, year: 2026, payer: it7.payer }], null); T.stopEmail(engs[7].clientId, "link");
  T.inboundReply(engs[8].clientId, "Can I send it after the 15th?", { intent: "send_after_date", confidence: "high", legacy_intent: "will_send_later", date: "2027-02-15", item_id: T.itemsOf(engs[8].id)[0].id }); const st = T.S.tasks.find((t) => t.kind === "step" && t.status === "open"); T.decideTask(st.id, "apply_step", null);
  T.advance(22 * T.DAY); M = T.pilotMeasures(); const r = Object.fromEntries(M.rows.map((x) => [x.key, x]));
  assert.equal(M.clients, 10); assert.equal(r.complete21.of, "7 of 10"); assert.equal(r.complete21.display, "70%"); assert.equal(r.complete21.state, "on_track"); assert.equal(r.complete21.target, "60% or more"); assert.equal(r.complete21.stopAt, "under 40%");
  assert.equal(r.byLink.of, "6 of 7"); assert.equal(r.byLink.state, "early", "seven documents are too few to judge");
  assert.equal(r.unsub.of, "1 of 10"); assert.equal(r.unsub.state, "early"); assert.equal(r.touches.of, "1 touches for 10 clients"); assert.equal(r.touches.display, "0.1"); assert.equal(r.touches.state, "on_track"); assert.equal(r.steps.of, "1 of 1");
  // The person checking documents: 100 agreed of 104 is under the 95% stop line.
  T.S.firm.agree = { W2: { n: 104, ok: 98 } }; assert.equal(Object.fromEntries(T.pilotMeasures().rows.map((x) => [x.key, x])).agree.state, "stop");
});
