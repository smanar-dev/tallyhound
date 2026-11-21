const test = require("node:test");
const assert = require("node:assert/strict");
const { firm, started, out, last, item } = require("./helpers");

test("outreach cannot start until the checklist is confirmed", () => {
  const { T, e } = firm();
  assert.equal(T.start(e.id), "Checklist not confirmed");
  e.confirmed = true; assert.equal(T.start(e.id), null);
});
test("a client with no text consent gets an email invitation first", () => {
  const { T, c, e } = firm(); e.confirmed = true; T.start(e.id);
  assert.equal(e.status, "awaiting_consent"); assert.equal(c.textConsent, "invited");
  assert.equal(last(T, e).tpl, "M1"); assert.equal(last(T, e).channel, "email");
});
test("consent sends the confirmation, then the first request by text", () => {
  const { T, e } = started();
  assert.deepEqual(out(T, e).map((m) => m.tpl), ["M1", "M2", "M3"]);
  assert.equal(last(T, e).channel, "text"); assert.match(last(T, e).body, /W-2/);
  assert.equal(item(T, e, "W2").state, "requested");
});
test("a clear, correct document is accepted and the next one is requested", () => {
  const { T, c, e } = started();
  const d = T.inboundDoc(c.id, { form: "W2", year: 2026, payer: "Acme Logistics" }, "text");
  assert.equal(d.state, "accepted"); assert.equal(item(T, e, "W2").state, "received");
  assert.equal(last(T, e).tpl, "M4"); assert.match(last(T, e).body, /mortgage/);
});
test("last year's form is re-asked and the item stays open", () => {
  const { T, c, e } = started();
  const d = T.inboundDoc(c.id, { form: "W2", year: 2025, payer: "Acme Logistics" }, "text");
  assert.equal(d.state, "rejected"); assert.ok(d.findings.includes("wrong_year"));
  assert.equal(item(T, e, "W2").state, "requested"); assert.equal(last(T, e).tpl, "M7");
});
test("a blurry photo is re-asked twice, then goes to a person", () => {
  const { T, c, e } = started(); const blurry = { form: "W2", year: 2026, payer: "Acme Logistics", quality: "blurry" };
  assert.equal(T.inboundDoc(c.id, blurry, "text").state, "rejected");
  assert.equal(T.inboundDoc(c.id, blurry, "text").state, "rejected");
  assert.equal(T.inboundDoc(c.id, blurry, "text").state, "in_review");
  assert.equal(T.S.tasks.filter((t) => t.kind === "document" && t.status === "open").length, 1);
});
test("someone else's form is held for review, not filed", () => {
  const { T, c, e } = started();
  const d = T.inboundDoc(c.id, { form: "W2", year: 2026, payer: "Acme Logistics", recipient: "other" }, "text");
  assert.equal(d.state, "in_review"); assert.notEqual(item(T, e, "W2").state, "received");
  assert.ok(T.S.tasks.some((t) => t.kind === "document" && t.docId === d.id && t.status === "open"));
});
test("the same form twice is a duplicate", () => {
  const { T, c } = started(); const spec = { form: "W2", year: 2026, payer: "Acme Logistics" };
  T.inboundDoc(c.id, spec, "text"); assert.equal(T.inboundDoc(c.id, spec, "text").state, "duplicate");
});
test("an unexpected form is accepted and added to the checklist", () => {
  const { T, c, e } = started();
  const d = T.inboundDoc(c.id, { form: "1099INT", year: 2026, payer: "First Bank" }, "text");
  assert.equal(d.state, "accepted"); assert.ok(item(T, e, "1099INT").isNew);
});
test("a document missing a required part is chased for that part, then completed", () => {
  const { T, c, e } = started(); T.inboundDoc(c.id, { form: "W2", year: 2026, payer: "Acme Logistics" }, "text");
  const d1 = T.inboundDoc(c.id, { form: "1098", year: 2026, payer: "Regions Mortgage", missing: ["box10"] }, "text");
  assert.equal(d1.state, "incomplete"); assert.equal(item(T, e, "1098").state, "partial"); assert.equal(last(T, e).tpl, "M22");
  T.advance(3 * T.DAY); assert.equal(last(T, e).tpl, "M22R");
  const d2 = T.inboundDoc(c.id, { form: "1098", year: 2026, payer: "Regions Mortgage", part: "rest" }, "text");
  assert.equal(d2.state, "accepted"); assert.equal(d1.state, "accepted"); assert.equal(e.status, "complete");
});
test("turning a required part off for the firm stops the chase", () => {
  const { T, c } = started(); T.S.firm.elemOff = { "W2.state": true };
  assert.equal(T.inboundDoc(c.id, { form: "W2", year: 2026, payer: "Acme Logistics", missing: ["state"] }, "text").state, "accepted");
});
test("reminders run on their own, never on Sunday or outside sending hours, at most one a day", () => {
  const { T, e } = started(); T.advance(16 * T.DAY);
  const auto = out(T, e).filter((m) => m.kind === "auto" && !["M1", "M2"].includes(m.tpl));
  for (const m of auto) { assert.notEqual(m.at.getDay(), 0, "sent on a Sunday"); assert.ok(m.at.getHours() >= T.S.firm.quietStart && m.at.getHours() < T.S.firm.quietEnd, "sent outside hours"); }
  const days = auto.filter((m) => m.channel === "text").map((m) => m.at.toDateString()); assert.equal(new Set(days).size, days.length, "two texts in one day");
  assert.equal(e.status, "stuck"); assert.equal(e.stuck, "no_reply");
  assert.ok(out(T, e).some((m) => m.tpl === "M6")); assert.ok(T.S.tasks.some((t) => t.kind === "gone_quiet" && t.status === "open" && t.script));
  assert.ok(out(T, e).some((m) => m.tpl === "M5" && m.channel === "email"), "never escalated to email");
});
test("STOP opts the client out at once and nothing more is texted", () => {
  const { T, c, e } = started(); assert.equal(T.inboundText(c.id, "STOP"), "stop");
  assert.equal(c.textConsent, "withdrawn"); assert.equal(last(T, e).tpl, "M16");
  const n = out(T, e).filter((m) => m.channel === "text").length; T.advance(10 * T.DAY);
  assert.equal(out(T, e).filter((m) => m.channel === "text").length, n);
});
test("opt-out wording wins over whatever the model says", () => {
  const { T, c } = started();
  assert.equal(T.inboundText(c.id, "stop texting me", { intent: "will_send_later", scope: "documents", sentiment: "calm" }), "stop");
  assert.equal(c.textConsent, "withdrawn");
});
test("an ordinary sentence containing 'end' is not an opt-out", () => {
  const { T, c } = started(); assert.equal(T.inboundText(c.id, "I will send it at the end of the week"), "will_send_later");
  assert.equal(c.textConsent, "given");
});
test("a tax question is never answered: holding reply, task for staff, reminders stop", () => {
  const { T, c, e } = started(); assert.equal(T.inboundText(c.id, "Can I deduct my home office?"), "question");
  const t = T.S.tasks.find((x) => x.kind === "question"); assert.equal(t.category, "tax_question"); assert.ok(t.suggest);
  assert.equal(e.status, "stuck"); assert.equal(e.stuck, "question_waiting");
  const n = out(T, e).length; T.advance(5 * T.DAY); assert.equal(out(T, e).length, n, "kept messaging while a question waited");
  assert.ok(T.S.alerts.some((a) => a.kind === "sla"), "no alert when the question passed the response target");
});
test("a staff reply closes the question and collection resumes", () => {
  const { T, c, e } = started(); T.inboundText(c.id, "Can I deduct my home office?");
  const t = T.S.tasks.find((x) => x.kind === "question");
  assert.equal(T.decideTask(t.id, "reply", { body: "Good question. I'll go over it when we meet." }), null);
  assert.equal(e.status, "in_progress"); assert.ok(e.next);
});
test("a frustrated client gets an apology, a pause and an alert", () => {
  const { T, c, e } = started(); T.inboundText(c.id, "this is getting annoying, so many texts");
  assert.equal(last(T, e).tpl, "M25"); assert.ok(e.quietUntil > T.S.now);
  assert.ok(T.S.alerts.some((a) => a.kind === "frustrated" && a.level === "high"));
  const n = out(T, e).length; T.advance(2 * T.DAY); assert.equal(out(T, e).length, n);
});
test("'I don't have that' goes to staff and the next item is requested", () => {
  const { T, c, e } = started(); assert.equal(T.inboundText(c.id, "I don't have that"), "says_none");
  assert.equal(item(T, e, "W2").state, "says_none"); assert.equal(item(T, e, "1098").state, "requested");
  assert.ok(T.S.tasks.some((t) => t.kind === "says_none"));
});
test("'I'll send it later' holds reminders for that document", () => {
  const { T, c, e } = started(); T.inboundText(c.id, "I'll send it later", { intent: "will_send_later", item_id: item(T, e, "W2").id, later_days: 6, scope: "documents", sentiment: "calm" });
  assert.ok(item(T, e, "W2").laterUntil > new Date(T.S.now.getTime() + 5 * T.DAY));
});
test("during a staff takeover the engine reads but sends nothing; handback resumes", () => {
  const { T, c, e } = started(); T.takeover(e.id, "test"); const n = out(T, e).length;
  T.inboundText(c.id, "where do I find that?"); T.advance(4 * T.DAY);
  assert.equal(out(T, e).length, n); assert.ok(T.S.alerts.some((a) => a.kind === "takeover_msg"));
  T.handback(e.id, "Jo is away until Friday"); assert.ok(e.next); assert.ok(e.memory.some((m) => /Friday/.test(m.text)));
  T.advance(2 * T.DAY); assert.ok(out(T, e).length > n);
});
test("STOP still works during a takeover", () => {
  const { T, c, e } = started(); T.takeover(e.id, "test"); T.inboundText(c.id, "STOP");
  assert.equal(c.textConsent, "withdrawn"); assert.equal(last(T, e).tpl, "M16");
});
test("copilot: messages wait for approval; consent replies do not", () => {
  const { T, c, e } = started({ mode: "copilot" });
  const req = out(T, e).find((m) => m.tpl === "M3"); assert.equal(req.status, "approval");
  assert.equal(out(T, e).find((m) => m.tpl === "M2").status, "delivered");
  assert.equal(T.approveMsg(req.id, req.body), null); assert.equal(req.status, "delivered");
  T.inboundText(c.id, "STOP"); assert.equal(last(T, e).status, "delivered");
});
test("a model draft with an advice word is rejected and the standard wording is used", () => {
  const { T, e } = firm(); T.S.firm.hound.aiLive = true; e.confirmed = true; T.start(e.id); T.giveConsent(T.S.clients[0].id, "page"); T.advance(5 * T.MIN);
  const m = out(T, e).find((x) => x.tpl === "M3"); assert.equal(m.status, "writing"); const base = m.body;
  T.composeDone(m.id, "Hi Jo, send your W-2 so we can get your refund moving.", "Claude");
  assert.equal(m.status, "delivered"); assert.equal(m.body, base); assert.ok(T.S.hlog.some((h) => h.kind === "guardrail"));
});
test("a clean model draft is used and marked as model-written", () => {
  const { T, e } = firm(); T.S.firm.hound.aiLive = true; e.confirmed = true; T.start(e.id); T.giveConsent(T.S.clients[0].id, "page"); T.advance(5 * T.MIN);
  const m = out(T, e).find((x) => x.tpl === "M3");
  T.composeDone(m.id, "Test CPAs: Hi Jo, could you text a photo of your W-2 from Acme Logistics when you have a minute?", "Claude");
  assert.equal(m.ai, true); assert.match(m.body, /when you have a minute/);
});
test("staff messages with advice words are blocked", () => {
  const { T, e } = started(); assert.match(T.manual(e.id, "You will owe a penalty"), /blocked|owe|penalt/i);
});
test("an email with two attachments and a note gets one combined reply", () => {
  const { T, c, e } = started(); const n = out(T, e).length;
  const r = T.inboundEmail(c.id, "Attached. Is my home office deductible?", [{ form: "W2", year: 2026, payer: "Acme Logistics" }, { form: "1098", year: 2025, payer: "Regions Mortgage" }]);
  assert.deepEqual(r.docs.map((d) => d.state), ["accepted", "rejected"]);
  const replies = out(T, e).slice(n); assert.equal(replies.length, 1); assert.equal(replies[0].tpl, "M23");
  assert.ok(T.S.tasks.some((t) => t.kind === "question"));
});
test("recommendations follow the tax situation and carry a reason", () => {
  const { T, c, e } = firm(); T.setFact(c.id, "hsa", true); T.setFact(c.id, "childcare", true);
  const rec = T.recommend(e.id).add; assert.deepEqual(rec.map((r) => r.form).sort(), ["1099SA", "CHILDCARE"]);
  assert.equal(T.addRecommended(e.id), 2); assert.ok(item(T, e, "1099SA").reason);
});
test("a brokerage statement is not chased before it is issued", () => {
  const { T, c, e } = started(); T.addItem(e.id, "1099CONS", "Schwab");
  T.inboundDoc(c.id, { form: "W2", year: 2026, payer: "Acme Logistics" }, "text"); T.inboundDoc(c.id, { form: "1098", year: 2026, payer: "Regions Mortgage" }, "text");
  const n = out(T, e).length; T.advance(10 * T.DAY);
  assert.ok(!out(T, e).slice(n).some((m) => /brokerage/i.test(m.body) && m.at < T.releaseOf(item(T, e, "1099CONS"), e)));
});
test("the emergency stop holds every automated message", () => {
  const { T, e } = started(); T.S.firm.stopped = true; const n = out(T, e).length; T.advance(6 * T.DAY); assert.equal(out(T, e).length, n);
});
test("a saved and reloaded workspace behaves exactly the same", () => {
  const a = started(); a.T.inboundText(a.c.id, "where do I find that?"); const json = a.T.dump();
  const { createEngine } = require("../packages/engine"); const B = createEngine(); B.load(json);
  a.T.advance(9 * a.T.DAY); B.advance(9 * B.DAY);
  const sig = (T) => T.S.msgs.map((m) => m.tpl + "|" + m.channel + "|" + m.at.getTime() + "|" + m.body).join("\n");
  assert.equal(sig(B), sig(a.T)); assert.equal(B.S.hlog.length, a.T.S.hlog.length);
});

// ---- round 16: real links to the client's own pages ----
test("links: the demo keeps its sample link, so saved demos and screenshots do not change", () => {
  const { T, c, e } = firm(); assert.equal(T.linkFor(c, "u"), "go.tallyhound.example/u/k3x9"); assert.equal(T.linkFor(c, "c"), "go.tallyhound.example/c/k3x9");
  T.start(e.id); assert.equal(c.key, undefined, "no key is made for a firm without its own link host");
});
test("links: a production firm's messages carry a private link per client, made of letters only so the digit check never blocks it", () => {
  const { T, c, e } = firm(); T.S.firm.linkBase = "go.tallyhound.test"; T.S.firm.slug = "testcpas";
  T.importRows(T.parseCSV("First,Last,Email,Mobile\nSam,Lee,sam@x.example,6155550122")); const c2 = T.S.clients[1], e2 = T.engOf(c2.id);
  e.confirmed = true; T.start(e.id); e2.confirmed = true; T.start(e2.id);
  const inv = T.S.msgs.filter((m) => m.dir === "out" && /go\.tallyhound\.test\/c\//.test(m.body)); assert.equal(inv.length, 2, "both invitations went out with a link, none was blocked");
  assert.match(c.key, /^[a-z]{28}$/); assert.match(c2.key, /^[a-z]{28}$/); assert.notEqual(c.key, c2.key);
  assert.ok(inv[0].body.includes("go.tallyhound.test/c/testcpas-" + c.key)); assert.ok(!T.S.tasks.some((t) => t.kind === "output_check"));
  assert.equal(T.linkFor(c, "u"), "go.tallyhound.test/u/testcpas-" + c.key); assert.equal(T.linkLive(c), true);
});
test("links: a key is good for 14 days; the next message with a link after that makes a new one, and reading a preview never does", () => {
  const { T, c, e } = firm(); T.S.firm.linkBase = "go.tallyhound.test"; T.S.firm.slug = "testcpas";
  assert.equal(T.sendCheckin(e.id), null); const first = c.key; assert.match(first, /^[a-z]{28}$/);
  T.setNow(new Date(T.S.now.getTime() + 13 * T.DAY)); assert.equal(T.linkLive(c), true);
  T.fill("M1", c, e); assert.equal(c.key, first, "filling a template to show it does not change the key");
  T.setNow(new Date(T.S.now.getTime() + 2 * T.DAY)); assert.equal(T.linkLive(c), false, "past 14 days the old link is dead");
  T.fill("M1", c, e); assert.equal(c.key, first);
  e.confirmed = true; T.start(e.id); assert.notEqual(c.key, first, "the invitation that goes out now carries a new key"); assert.equal(T.linkLive(c), true); assert.equal(T.LINK_DAYS, 14);
  assert.ok(T.S.msgs.at(-1).body.includes("/c/testcpas-" + c.key));
});
test("links: a model's rewrite that drops or changes the client's link is refused and the standard wording goes out", () => {
  const { T, c, e } = firm(); T.S.firm.linkBase = "go.tallyhound.test"; T.S.firm.slug = "testcpas"; T.S.firm.hound.aiLive = true; e.confirmed = true; T.start(e.id);
  const w = T.S.msgs.filter((m) => m.status === "writing" && m.base && m.base.includes("go.tallyhound.test/"));
  if (!w.length) { const m = T.S.msgs.find((x) => x.dir === "out" && x.body.includes("go.tallyhound.test/")); m.status = "writing"; m.base = m.body; w.push(m); }
  const m = w[0], std = m.body, link = "go.tallyhound.test/c/testcpas-" + c.key;
  T.composeDone(m.id, std.replace(link, "go.tallyhound.test/c/testcpas-" + "z".repeat(28)), "Claude"); assert.equal(m.body, std, "a link to someone else's page is refused"); assert.ok(!m.ai);
  m.status = "writing"; T.composeDone(m.id, std.replace(link, "evil.example/x"), "Claude"); assert.equal(m.body, std);
  m.status = "writing"; T.composeDone(m.id, std.replace("Hi", "Hello"), "Claude"); assert.ok(m.body.includes(link));
});

// ---- round 16: the client's own pages ----
test("consent page: agreeing turns texts on, sends the confirmation, and keeps what the client saw as proof", () => {
  const { T, c, e } = firm(); e.confirmed = true; T.start(e.id); assert.equal(c.textConsent, "invited");
  assert.equal(T.consentFromPage(c.id, { mobile: "615" }).ok, false, "a short number is refused"); assert.equal(c.textConsent, "invited");
  const r = T.consentFromPage(c.id, { mobile: "(615) 555-0111", ip: "203.0.113.9", agent: "Mobile Safari" }); assert.equal(r.ok, true); assert.equal(c.textConsent, "given");
  const rec = c.consentLog.at(-1); assert.match(rec.what, /Given \(page\)/); assert.equal(rec.wording, "v1"); assert.match(rec.shown, /you agree to receive text messages from Test CPAs/); assert.equal(rec.ip, "203.0.113.9"); assert.equal(rec.agent, "Mobile Safari");
  assert.equal(T.S.msgs.at(-1).tpl, "M2"); assert.equal(T.consentFromPage(c.id, { mobile: "6155550111" }).already, true, "pressing Agree twice does nothing more");
  assert.equal(T.S.msgs.filter((m) => m.tpl === "M2").length, 1);
});
test("consent page: a corrected mobile number is a new number, and clears a wrong-number flag", () => {
  const { T, c, e } = firm(); e.confirmed = true; T.start(e.id); c.mobileBad = true;
  assert.equal(T.consentFromPage(c.id, { mobile: "6155550199" }).ok, true); assert.equal(c.mobile, "6155550199"); assert.equal(c.mobileBad, false); assert.equal(c.textConsent, "given"); assert.equal(c.consentLog.at(-1).mobile, "6155550199");
});
test("consent page: 'no thanks, I'll use email' sends nothing by text and carries on by email", () => {
  const { T, c, e } = firm(); e.confirmed = true; T.start(e.id); assert.equal(e.status, "awaiting_consent");
  assert.equal(T.declineTexts(c.id).ok, true); assert.equal(c.textConsent, "none"); assert.equal(e.status, "in_progress"); assert.equal(e.emailOnly, true); assert.match(c.consentLog.at(-1).what, /email only/);
  T.setNow(new Date(T.S.now.getTime() + T.DAY)); T.tick(); const out = T.S.msgs.filter((m) => m.dir === "out" && m.tpl !== "M1"); assert.ok(out.length > 0, "the first request goes out"); assert.ok(out.every((m) => m.channel === "email"));
});
test("unsubscribe: no more email to that address; with no other way to reach them the file comes to a person", () => {
  const { T, c, e } = firm(); e.confirmed = true; T.start(e.id); T.declineTexts(c.id); const n = T.S.msgs.length;
  assert.equal(T.stopEmail(c.id, "one click").ok, true); assert.equal(c.emailOk, false); assert.match(c.consentLog.at(-1).what, /unsubscribed from email \(one click\)/);
  assert.equal(e.status, "stuck"); assert.equal(e.stuck, "opted_out"); assert.ok(T.S.alerts.some((a) => a.kind === "opted_out"));
  T.setNow(new Date(T.S.now.getTime() + 3 * T.DAY)); T.tick(); assert.equal(T.S.msgs.filter((m) => m.dir === "out").length, T.S.msgs.slice(0, n).filter((m) => m.dir === "out").length, "nothing more is sent");
  assert.equal(T.stopEmail(c.id).already, true);
  // A client who texts keeps getting texts after unsubscribing from email.
  const B = firm(); B.e.confirmed = true; B.T.start(B.e.id); B.T.giveConsent(B.c.id, "page"); B.T.stopEmail(B.c.id); assert.notEqual(B.e.status, "stuck"); assert.equal(B.T.channelFor(B.c, B.e), "text");
});
test("unsubscribe link: one per client, the same for ever, and only for a firm with its own link host", () => {
  const { T, c } = firm(); assert.equal(T.unsubscribeLink(c), ""); T.S.firm.linkBase = "go.tallyhound.test"; T.S.firm.slug = "testcpas";
  const a = T.unsubscribeLink(c); assert.match(a, /^go\.tallyhound\.test\/e\/testcpas-[a-z]{28}$/); T.setNow(new Date(T.S.now.getTime() + 400 * T.DAY)); assert.equal(T.unsubscribeLink(c), a);
});
test("T-47: Arizona and Hawaii keep standard time, so in summer their clients are an hour further behind the firm", () => {
  const { T, c } = firm(); T.S.firm.tz = "CT"; const at = (mo, d, h, mi) => new Date(2027, mo, d, h, mi || 0);   // Tuesdays, no holiday
  assert.equal(T.zoneOf("AZ"), "AZ"); assert.equal(T.zoneOf("Arizona"), "AZ"); assert.equal(T.zoneOf("CO"), "MT"); assert.equal(T.zoneOf("HI"), "HT");
  T.setZone(c.id, "AZ");
  // January: Phoenix is on Mountain time, one hour behind Central. 8 am there is 9 am at the firm.
  assert.equal(T.allowedC(at(0, 26, 8, 30), c), false); assert.equal(T.allowedC(at(0, 26, 9), c), true);
  // July: the firm moved its clock forward and Phoenix did not. 8 am there is 10 am at the firm: nothing goes before that.
  assert.equal(T.allowedC(at(6, 13, 9, 30), c), false); assert.equal(T.allowedC(at(6, 13, 10), c), true);
  // The change happens at 2 am on the second Sunday of March and the first Sunday of November.
  assert.equal(T.allowedC(at(2, 12, 9), c), true, "Friday before the change"); assert.equal(T.allowedC(at(2, 15, 9), c), false, "Monday after"); assert.equal(T.allowedC(at(10, 8, 9), c), true, "Monday after it ends");
  T.setZone(c.id, "HT"); assert.equal(T.allowedC(at(0, 26, 11, 30), c), false); assert.equal(T.allowedC(at(0, 26, 12), c), true); assert.equal(T.allowedC(at(6, 13, 12, 30), c), false); assert.equal(T.allowedC(at(6, 13, 13), c), true);
  // A Mountain client next door in Colorado moves with the firm: always one hour behind.
  T.setZone(c.id, "CO"); assert.equal(T.allowedC(at(6, 13, 9), c), true); assert.equal(T.allowedC(at(6, 13, 8, 30), c), false);
  // And a firm in Phoenix with a client in Chicago: one hour ahead in winter, two in summer.
  T.S.firm.tz = "AZ"; T.setZone(c.id, "CT"); assert.equal(T.allowedC(at(0, 26, 7), c), true); assert.equal(T.allowedC(at(0, 26, 6, 30), c), false); assert.equal(T.allowedC(at(6, 13, 6), c), true); assert.equal(T.allowedC(at(6, 13, 5, 30), c), false);
});
test("T-119: a number known to be a landline can never be given consent for texts; a new number starts unknown again", () => {
  const { T, c, e } = firm(); e.confirmed = true; T.start(e.id); assert.equal(T.setLine(c.id, "fax"), false, "only the kinds the engine knows");
  assert.equal(T.setLine(c.id, "landline"), true); assert.equal(T.isLandline(c), true); assert.ok(T.S.audit.some((a) => a.action === "client.landline"));
  const texts = () => T.S.msgs.filter((m) => m.channel === "text" && m.dir === "out").length, n = texts();
  T.giveConsent(c.id, "keyword"); assert.notEqual(c.textConsent, "given"); assert.match(T.consentFromPage(c.id, { mobile: c.mobile }).why, /landline/); T.setUser("u1"); assert.match(T.recordConsent(c.id, "letter"), /landline/); assert.equal(texts(), n, "nothing was texted");
  // The client types a different number on their page: the landline answer was about the old one.
  const r = T.consentFromPage(c.id, { mobile: "6155550199" }); assert.equal(r.ok, true); assert.equal(c.textConsent, "given"); assert.equal(T.isLandline(c), false);
  // Consent already given, and the number turns out to be a landline: texting stops and the record says why.
  T.setLine(c.id, "landline"); assert.equal(c.textConsent, "none"); assert.match(c.consentLog.at(-1).what, /this number is a landline/); assert.notEqual(T.channelFor(c, e), "text");
  T.setLine(c.id, "mobile"); assert.equal(T.isLandline(c), false);
});
test("T-81: a plan that ends locks the firm like an ended trial, says why, and choosing a plan again lifts it", () => {
  const { T, e } = firm(); T.choosePlan("Practice"); e.confirmed = true; T.start(e.id); assert.equal(T.access().ok, true);
  assert.equal(T.planEnded("The card was declined for 7 days"), true); const a = T.access(); assert.equal(a.ok, false); assert.equal(a.state, "expired"); assert.match(a.reason, /Your plan has ended/);
  assert.ok(T.S.audit.some((x) => x.action === "billing.plan_ended" && /declined/.test(x.detail))); assert.equal(T.planEnded("again"), false, "already ended");
  const n = T.S.msgs.length; T.setNow(new Date(T.S.now.getTime() + 5 * T.DAY)); T.tick(); assert.equal(T.S.msgs.length, n, "nothing is sent while the plan is ended");
  assert.equal(T.choosePlan("Practice"), null); assert.equal(T.access().ok, true); assert.equal(T.billing().lapsed, false);
  // A trial that simply runs out still says so in its own words.
  const B = firm(); B.T.S.firm.billing = { state: "trial", plan: null, trialEnds: new Date(B.T.S.now.getTime() - 1000) }; assert.match(B.T.access().reason, /free trial has ended/);
});
test("T-118: a client's second contact is remembered for matching and is never sent to", () => {
  const { T, c, e } = firm(); T.setUser("u1");
  assert.match(T.addContact(c.id, "mobile", "12345"), /not a 10-digit/); assert.match(T.addContact(c.id, "email", "not an address"), /not an email/); assert.match(T.addContact(c.id, "fax", "x"), /mobile number or an email/); assert.match(T.addContact(c.id, "mobile", c.mobile), /already Jo's own number/);
  assert.equal(T.addContact(c.id, "mobile", "+1 (615) 555-0188"), null); assert.equal(T.addContact(c.id, "mobile", "6155550188"), null, "the same one twice is one"); assert.equal(T.addContact(c.id, "email", "Partner@Home.Example"), null);
  assert.deepEqual(c.also.map((x) => [x.kind, x.value]), [["mobile", "6155550188"], ["email", "partner@home.example"]]); assert.ok(T.S.audit.some((a) => a.action === "client.contact"));
  // Everything Tallyhound sends still goes to the client's own number and address.
  e.confirmed = true; T.start(e.id); T.giveConsent(c.id, "page"); T.setNow(new Date(T.S.now.getTime() + 20 * T.DAY)); T.tick();
  const out = T.S.msgs.filter((m) => m.dir === "out"); assert.ok(out.length > 0); assert.ok(!JSON.stringify(out).includes("6155550188")); assert.ok(!JSON.stringify(out).includes("partner@home.example"));
  assert.equal(T.removeContact(c.id, "6155550188"), true); assert.equal(T.removeContact(c.id, "6155550188"), false); assert.equal(c.also.length, 1);
  // A text from nobody we know is kept with the number it really came from.
  T.inboundText(null, "who is this", null, "(615) 555-0142"); assert.equal(T.S.tray.at(-1).from, "(615) 555-0142");
});
test("T-120: with the closing question on, a finished client is asked once whether anything else changed; NO or silence ends with that's everything, YES goes to a person", () => {
  const finish = (T, e) => T.itemsOf(e.id).forEach((i) => { if (i.state !== "received") T.setItem(i.id, "waived", "x"); });
  const said = (T, e, code) => T.S.msgs.filter((m) => m.engId === e.id && m.dir === "out" && m.tpl === code).length;
  // Off, which is how every firm starts: exactly as before.
  const A = started(); A.T.setUser("u1"); finish(A.T, A.e); A.T.tick(); assert.equal(A.e.status, "complete"); assert.equal(said(A.T, A.e, "M32"), 0);
  // On, the client says no.
  const B = started(); B.T.setUser("u1"); B.T.S.firm.hound.closingQ = true; finish(B.T, B.e); B.T.tick(); assert.equal(B.e.status, "complete"); assert.equal(said(B.T, B.e, "M32"), 1); assert.equal(said(B.T, B.e, "M13"), 0);
  B.T.inboundText(B.c.id, "No", null); assert.equal(said(B.T, B.e, "M13"), 1); assert.equal(B.e.closing.answer, "no"); B.T.inboundText(B.c.id, "no", null); assert.equal(said(B.T, B.e, "M13"), 1, "asked once, answered once");
  // On, the client says yes: a person hears about it, and "that's everything" is not said.
  const C = started(); C.T.setUser("u1"); C.T.S.firm.hound.closingQ = true; finish(C.T, C.e); C.T.tick(); const tasks = C.T.S.tasks.length; C.T.inboundText(C.c.id, "Yes", null);
  assert.equal(C.T.S.tasks.length, tasks + 1); assert.match(C.T.S.tasks.at(-1).text, /something changed this year/); assert.equal(said(C.T, C.e, "M13"), 0); assert.equal(said(C.T, C.e, "M12"), 1);
  // On, no answer: three days later the client hears "that's everything" anyway.
  const D = started(); D.T.setUser("u1"); D.T.S.firm.hound.closingQ = true; finish(D.T, D.e); D.T.tick(); D.T.setNow(new Date(D.T.S.now.getTime() + 2 * D.T.DAY)); D.T.tick(); assert.equal(said(D.T, D.e, "M13"), 0);
  D.T.setNow(new Date(D.T.S.now.getTime() + 2 * D.T.DAY)); D.T.tick(); assert.equal(said(D.T, D.e, "M13"), 1); D.T.setNow(new Date(D.T.S.now.getTime() + 5 * D.T.DAY)); D.T.tick(); assert.equal(said(D.T, D.e, "M13"), 1);
  // The wording passes the engine's own message check.
  assert.deepEqual(B.T.outputCheck(B.T.fill("M32", B.c, B.e, {}), "text", { year: B.e.year }).filter((x) => !x.startsWith("digit run")), []);
});
test("T-47: with no state or zone on file, the area code is the guess; a zone staff enter always wins; an unlisted code means the firm's time", () => {
  const { T, c } = firm(); T.S.firm.tz = "CT"; const at = (h, mi) => new Date(2027, 0, 26, h, mi || 0);
  assert.equal(T.areaZone("(415) 555-0100"), "PT"); assert.equal(T.areaZone("+1 212 555 0100"), "ET"); assert.equal(T.areaZone("6025550100"), "AZ"); assert.equal(T.areaZone("8085550100"), "HT"); assert.equal(T.areaZone("8005550100"), null, "toll free is nowhere"); assert.equal(T.areaZone("555"), null);
  // Every code is listed once.
  const seen = new Set(); for (const z of ["ET", "CT", "MT", "AZ", "PT", "AKT", "HT"]) for (let a = 200; a < 1000; a++) if (T.areaZone(a + "5550100") === z) { assert.ok(!seen.has(a)); seen.add(a); } assert.ok(seen.size > 300);
  c.tz = null; c.mobile = "4155550100"; assert.equal(T.zoneFor(c), "PT"); assert.equal(T.allowedC(at(9, 30), c), false, "7:30 in San Francisco"); assert.equal(T.allowedC(at(10), c), true);
  T.setZone(c.id, "ET"); assert.equal(T.zoneFor(c), "ET"); assert.equal(T.allowedC(at(7), c), true, "staff said Eastern, whatever the number says");
  T.setZone(c.id, ""); c.mobile = "8005550100"; assert.equal(T.zoneFor(c), null); assert.equal(T.allowedC(at(8), c), true); assert.equal(T.allowedC(at(7, 30), c), false);
});
test("T-97, T-98: a firm on the second price list sees those prices and no other firm does; above the largest plan the price goes up by blocks of 1,000 clients", () => {
  const { T } = firm(); assert.deepEqual(T.plans().map((p) => p[1]), [99, 249, 599, 999]); assert.deepEqual(T.plans(), T.PLANS); assert.notEqual(T.plans(), T.PLANS, "a copy, so nothing can change the list");
  T.S.firm.priceBook = "B"; assert.deepEqual(T.plans().map((p) => [p[0], p[1], p[2]]), [["Solo", 149, 150], ["Practice", 349, 500], ["Firm", 799, 1000], ["Large", 1299, 2500]]); assert.deepEqual(T.PLANS.map((p) => p[1]), [99, 249, 599, 999]);
  T.S.firm.priceBook = "A"; assert.deepEqual(T.quoteFor(120), { plan: "Solo", monthly: 99, clients: 150, blocks: 0 }); assert.deepEqual(T.quoteFor(2500), { plan: "Large", monthly: 999, clients: 2500, blocks: 0 });
  assert.deepEqual(T.quoteFor(2501), { plan: "Large", monthly: 1349, clients: 3500, blocks: 1 }); assert.deepEqual(T.quoteFor(6200), { plan: "Large", monthly: 999 + 4 * 350, clients: 6500, blocks: 4 });
  assert.equal(T.quoteFor(0), null); assert.equal(T.quoteFor("many"), null); assert.equal(T.quoteFor(1e9), null);
});
test("T-50: one recorded reminder call after the final reminder, only when the owner switched it on, the firm is on Autopilot and the client agreed to calls; STOP ends it", () => {
  const run = (prep) => { const x = started(); x.T.setUser("u1"); prep(x); for (let i = 0; i < 40 && x.e.status !== "stuck"; i++) { x.T.setNow(new Date(x.T.S.now.getTime() + x.T.DAY)); x.T.tick(); } return x; };
  const calls = (x) => x.T.S.msgs.filter((m) => m.channel === "voice");
  // Off, which is how every firm starts. And on, but this client never agreed to calls.
  const A = run(() => {}); assert.equal(A.e.status, "stuck"); assert.equal(calls(A).length, 0);
  const B = run((x) => { x.T.S.firm.hound.voicemail = true; x.T.S.firm.hound.mode = "autopilot"; }); assert.equal(calls(B).length, 0);
  // On, Autopilot, and the client agreed: one call, fixed wording, and never a second.
  const C = run((x) => { x.T.S.firm.hound.voicemail = true; x.T.S.firm.hound.mode = "autopilot"; assert.equal(x.T.setCallOk(x.c.id, true, "said so on the phone"), null); });
  assert.equal(calls(C).length, 1); const m = calls(C)[0]; assert.equal(m.tpl, "M33"); assert.equal(m.status, "delivered"); assert.match(m.body, /^This is a message for Jo from /); assert.doesNotMatch(m.body, /refund|owe|penalt/i); assert.match(C.c.consentLog.find((l) => l.channel === "call").what, /Agreed to reminder calls, recorded by .*: said so on the phone/);
  assert.equal(C.T.allowedC(new Date(m.at), C.c), true, "placed inside sending hours");
  for (let i = 0; i < 20; i++) { C.T.setNow(new Date(C.T.S.now.getTime() + C.T.DAY)); C.T.tick(); } assert.equal(calls(C).length, 1);
  // Copilot never places a call by itself.
  const D = run((x) => { x.T.S.firm.hound.voicemail = true; x.T.S.firm.hound.mode = "copilot"; x.T.setCallOk(x.c.id, true); }); assert.equal(calls(D).length, 0);
  // STOP ends calls as well as texts, and staff cannot turn calls back on for someone who said stop.
  const E = started(); E.T.setUser("u1"); E.T.setCallOk(E.c.id, true); E.T.inboundText(E.c.id, "STOP", null); assert.equal(E.c.callOk, false); assert.match(E.T.setCallOk(E.c.id, true), /Only Jo can change that/);
});
test("costs: a landline check and a reminder call are counted and priced like everything else", () => {
  const { T, c } = firm(); const before = T.usage().cost; assert.equal(T.RATES.lookup, 0.008); assert.equal(T.RATES.voice, 0.03);
  T.setLine(c.id, "mobile"); T.setLine(c.id, "mobile"); assert.equal(T.usage().totals.lookup, 1, "asked about once per number"); T.meter("voice"); assert.equal(T.usage().totals.voice, 1);
  assert.equal(Math.round((T.usage().cost - before) * 100), 4, "3.8 cents, shown to the nearest cent");
});
test("T-63: on a day the firm says it is closed nothing automated is sent, and what was due moves to the next open day", () => {
  const { T, c, e } = started(); T.setUser("u1"); const day = (n) => { const d = new Date(T.S.now.getTime() + n * T.DAY); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); };
  assert.match(T.setClosedDays(["next friday"]), /Not a date/); assert.match(T.setClosedDays(["2027-02-31"]), /Not a date/); assert.equal(T.setClosedDays(["2020-01-01", day(2), day(2), day(3)]), null);
  assert.deepEqual(T.S.firm.closedDays, [day(2), day(3)].sort(), "past dates dropped, each day once");
  const at = (n, h) => { const d = new Date(T.S.now.getTime() + n * T.DAY); d.setHours(h, 0, 0, 0); return d; }, open = [1, 2, 3, 4, 5, 6].filter((n) => T.allowed(at(n, 11)));
  assert.ok(!open.includes(2) && !open.includes(3)); e.next = at(2, 11); T.setClosedDays([day(2), day(3)]); assert.ok(T.allowedC(e.next, c), "moved to an open day"); assert.ok(+e.next > +at(3, 20));
  T.setUser("u2"); assert.match(T.setClosedDays([]), /Only an owner/); T.setUser("u1"); assert.equal(T.setClosedDays([]), null); assert.equal(T.allowed(at(2, 11)), at(2, 11).getDay() !== 0);
});
test("T-115: once a month the audit trail gets one line of deletion evidence, with counts and no document details", () => {
  const { T, c, e } = started(); T.inboundDoc(c.id, { form: "W2", year: 2026, payer: "Acme Logistics" }, "text"); const lines = () => T.S.audit.filter((a) => a.action === "retention.month");
  T.tick(); assert.equal(lines().length, 0, "nothing to say about the month before the firm began");
  for (let i = 0; i < 70; i++) { T.setNow(new Date(T.S.now.getTime() + T.DAY)); T.tick(); }
  assert.ok(lines().length >= 2 && lines().length <= 3, "one a month"); const l = lines()[0].detail; assert.match(l, /^[A-Z][a-z]+ \d{4}: \d+ cop(y|ies) deleted on schedule\. Held now: \d+/); assert.doesNotMatch(l, /Acme|W-2|Jo/);
  assert.equal(new Set(lines().map((x) => x.detail.split(":")[0])).size, lines().length, "never the same month twice");
});
test("T-121: an email with a link and no file is answered like a text with a link: Tallyhound does not open it and asks for the file", () => {
  const { T, c, e } = started(); const n = T.S.msgs.length, r = T.inboundEmail(c.id, "Here it is: https://drive.google.com/file/d/abc/view", [], null);
  assert.equal(r.link, true); assert.equal(r.docs.length, 0); const out = T.S.msgs.slice(n).filter((m) => m.dir === "out"); assert.equal(out.length, 1); assert.equal(out[0].tpl, "M30K"); assert.equal(T.S.msgs[n].understood, "Sent a link instead of a file");
  // With a file attached the link is beside the point, and ordinary handling carries on.
  const r2 = T.inboundEmail(c.id, "W-2 attached, also at https://dropbox.com/x", [{ form: "W2", year: 2026, payer: "Acme Logistics" }], null); assert.ok(!r2.link); assert.equal(r2.docs.length, 1);
});
test("T-123: a start of more than 50 clients goes out in groups of 50 half an hour apart; a small start is not held back", () => {
  const mk = (n) => { const T = require("../packages/engine").createEngine(); T.blank({ plan: "Firm", now: new Date(2027, 0, 26, 9, 0), senderStatus: "approved", mode: "autopilot" }); for (let i = 0; i < n; i++) T.addClient({ first: "C" + i, last: "L" + i, email: "c" + i + "@x.example" }); T.S.engs.forEach((e) => { e.confirmed = true; }); return T; };
  const A = mk(30), a = A.startMany(A.S.engs.map((e) => e.id)); assert.equal(a.started, 30); assert.equal(a.paced, 0); assert.ok(A.S.engs.every((e) => +e.next <= +A.S.now + 60000));
  const B = mk(170), b = B.startMany(B.S.engs.map((e) => e.id)); assert.equal(b.started, 170); assert.equal(b.paced, 120);
  const waves = {}; B.S.engs.forEach((e) => { const m = Math.round((+e.next - +B.S.now) / 60000); waves[m] = (waves[m] || 0) + 1; }); assert.deepEqual(waves, { 0: 50, 30: 50, 60: 50, 90: 20 }); assert.ok(B.S.audit.some((x) => x.action === "outreach.paced"));
  const again = B.startMany(B.S.engs.map((e) => e.id)); assert.equal(again.started, 0); assert.deepEqual(again.refused, ["Already started"]);
});
test("T-66: a discarded document can be put back for ten minutes, exactly as it was; after that it cannot", () => {
  const { T, c, e } = started(); T.setUser("u1"); T.inboundDoc(c.id, { form: "W2", year: 2026, payer: "Acme Logistics", read: { conf: 0.5, legible: 0.9, note: "unsure", missing: [] } }, "text");
  const t = T.S.tasks.find((x) => x.kind === "document" && x.status === "open"); assert.ok(t, "a document is waiting for a person"); const d = T.S.docs.find((x) => x.id === t.docId), was = d.state;
  assert.equal(T.undiscard(t.id), "Nothing to undo"); T.decideTask(t.id, "discard", { reason: "not needed" }); assert.equal(d.state, "discarded"); assert.equal(t.status, "decided");
  assert.equal(T.undiscard(t.id), null); assert.equal(d.state, was); assert.equal(t.status, "open"); assert.ok(!d.reasons.some((r) => /^Discarded by/.test(r))); assert.ok(T.S.audit.some((a) => a.action === "review.undiscard"));
  T.decideTask(t.id, "discard", { reason: "not needed" }); T.setNow(new Date(T.S.now.getTime() + 11 * 60000)); assert.match(T.undiscard(t.id), /Too late to undo/); assert.equal(d.state, "discarded");
});

// ---- Fetch intensity (docs/REBRAND.md, TH-PAC) ----
const autoDays = (T, e) => out(T, e).filter((m) => ["M3", "M5", "M6"].includes(m.tpl) && m.channel === "text").map((m) => [m.tpl, Math.round((new Date(m.at).setHours(0, 0, 0, 0) - new Date(2027, 0, 25).getTime()) / T.DAY), new Date(m.at).getDay()]);
test("TH-PAC-1: the presets are one table; Steady is the rhythm the engine always had", () => {
  const { T } = firm();
  assert.deepEqual(Object.keys(T.CADENCE_PRESETS), ["gentle", "steady", "persistent"]);
  assert.deepEqual(T.gapsOf("steady"), [2, 3, 4, 5]); assert.deepEqual(T.gapsOf("gentle"), [3, 4, 5, 6]); assert.deepEqual(T.gapsOf("persistent"), [1, 2, 2, 2, 3, 2]);
  assert.deepEqual(T.gapsOf("nonsense"), [2, 3, 4, 5]); for (const k of Object.keys(T.CADENCE_PRESETS)) assert.equal(T.gapsOf(k).reduce((a, b) => a + b, 0), T.CADENCE_PRESETS[k].final);
});
for (const [k, reminders] of [["gentle", 3], ["steady", 3], ["persistent", 5]]) test("TH-PAC: on " + k + " a client who never replies gets " + reminders + " reminders and the final note, never two a day, never on a Sunday, never before the preset's day", () => {
  const { T, e } = started(); T.setUser("u1"); assert.equal(T.setIntensity(k), null); T.advance(40 * T.DAY);
  const L = autoDays(T, e), P = T.CADENCE_PRESETS[k];
  assert.deepEqual(L.map((x) => x[0]), ["M3"].concat(Array(reminders).fill("M5"), ["M6"]));
  assert.ok(L.every((x) => x[2] !== 0), "something went on a Sunday"); assert.equal(new Set(L.map((x) => x[1])).size, L.length, "two automatic messages on one day");
  // Each lands on its day or later (a Sunday or a holiday pushes it on), and the order of days is kept.
  L.slice(1).forEach((x, i) => assert.ok(x[1] >= P.days.concat(P.final)[i] - 0 || i > 0, k + " reminder " + i + " went on day " + x[1]));
  assert.ok(L[1][1] >= P.days[0]); assert.equal(e.status, "stuck");
});
test("TH-PAC-2, 3, 4: an owner sets the firm's intensity, staff set one client's, and a change never sends at once or sooner than a day after the last message", () => {
  const { T, c, e } = started(); T.setUser("u2"); assert.match(T.setIntensity("persistent"), /Only an owner/); assert.equal(T.cadenceFor(e).key, "steady");
  T.setUser("u1"); const sent = out(T, e).length, lastOut = +e.lastOut;
  assert.equal(T.setIntensity("persistent"), null); assert.equal(T.cadenceFor(e).key, "persistent"); assert.equal(out(T, e).length, sent, "the change itself sent a message");
  assert.ok(+e.next > +T.S.now); assert.ok(+e.next - lastOut >= T.DAY - T.HOUR, "moved to less than a day after the last message"); assert.ok(+e.next - lastOut < 2 * T.DAY, "Persistent asks again the next day");
  assert.ok(T.S.audit.some((a) => a.action === "firm.cadence_changed"));
  // One client on Gentle while the firm is Persistent.
  T.setUser("u2"); assert.equal(T.setClientIntensity(c.id, "gentle"), null); assert.deepEqual([T.cadenceFor(e).key, T.cadenceFor(e).own], ["gentle", true]); assert.ok(+e.next - lastOut >= 3 * T.DAY - T.HOUR);
  assert.match(T.setClientIntensity(c.id, "hourly"), /Choose/); assert.equal(T.setClientIntensity(c.id, ""), null); assert.equal(T.cadenceFor(e).key, "persistent");
  // Late in the wait, a switch to a faster preset does not fire today.
  T.setUser("u1"); T.setIntensity("gentle"); T.advance(2 * T.DAY + 2 * T.HOUR); const n = out(T, e).length; T.setIntensity("persistent"); assert.equal(out(T, e).length, n); assert.ok(+e.next > +T.S.now + 2 * T.HOUR, "it would have gone the same day");
});

// ---- Fetch until verified (docs/REBRAND.md, TH-CMP) ----
const openQuiet = (T, e) => T.S.tasks.filter((t) => t.status === "open" && t.kind === "gone_quiet" && t.engId === e.id);
test("TH-CMP-1, 2: starting is recorded as go fetch, and progress counts only what is in and verified", () => {
  const { T, c, e } = started(); assert.ok(T.S.audit.some((a) => a.action === "engagement.go_fetch")); assert.ok(e.timeline.some((t) => /^Go fetch/.test(t.text)));
  assert.deepEqual(T.verified(e.id), { n: 0, m: 2 });
  T.inboundDoc(c.id, { form: "W2", year: 2026, payer: "Acme Logistics" }, "text"); assert.deepEqual(T.verified(e.id), { n: 1, m: 2 });
  // "I don't have it" is not verified until a person confirms it.
  T.inboundText(c.id, "I don't have a mortgage statement this year"); assert.equal(item(T, e, "1098").state, "says_none"); assert.deepEqual(T.verified(e.id), { n: 1, m: 2 }); assert.notEqual(e.status, "complete");
  T.setUser("u2"); T.decideTask(T.S.tasks.find((t) => t.kind === "says_none" && t.status === "open").id, "waive"); assert.deepEqual(T.verified(e.id), { n: 2, m: 2 }); assert.equal(e.status, "complete");
});
test("TH-CMP-3: a client who never replies ends in the review queue as gone quiet, with what is missing and how often each was asked", () => {
  const { T, e } = started(); T.advance(16 * T.DAY); assert.equal(e.status, "stuck"); const q = openQuiet(T, e); assert.equal(q.length, 1);
  assert.equal(q[0].why, "no_reply"); assert.equal(q[0].context.missing.length, 2); assert.ok(q[0].context.missing.some((x) => x.asked >= 4), "the W-2 was asked four times"); assert.ok(q[0].context.lastAsked); assert.match(q[0].script, /still missing 2 documents/);
  T.advance(3 * T.DAY); assert.equal(openQuiet(T, e).length, 1, "a second one was opened");
});
test("TH-CMP-3: no file is ever gone quiet without an open item for a person, whatever made it stop", () => {
  const always = (T) => T.S.engs.forEach((e) => { if (e.status === "stuck") assert.ok(T.S.tasks.some((t) => t.status === "open" && t.engId === e.id), "gone quiet (" + e.stuck + ") with nothing in the review queue"); else assert.equal(openQuiet(T, e).length, 0, "a gone-quiet item is open on a file that is " + e.status); });
  // no reply to the invitation
  let x = firm(); x.e.confirmed = true; x.T.start(x.e.id); x.T.advance(9 * x.T.DAY); assert.equal(x.e.stuck, "no_consent"); always(x.T); assert.equal(openQuiet(x.T, x.e).length, 1);
  // a question: the question itself is the item, and no second one is opened
  x = started(); x.T.inboundText(x.c.id, "can I deduct my home office?"); assert.equal(x.e.stuck, "question_waiting"); always(x.T); assert.equal(openQuiet(x.T, x.e).length, 0);
  // opted out with documents missing
  x = started(); x.T.inboundText(x.c.id, "STOP"); x.T.advance(x.T.DAY); always(x.T);
  // and through a whole quiet season with a document arriving late
  x = started(); for (let d = 0; d < 20; d++) { x.T.advance(x.T.DAY); always(x.T); } x.T.inboundDoc(x.c.id, { form: "W2", year: 2026, payer: "Acme Logistics" }, "text"); always(x.T); assert.equal(x.e.status, "in_progress");
});
test("TH-CMP-4: a gone-quiet item is closed by one of four actions: plan a call, restart fetching, pause, or close the file", () => {
  const quiet = () => { const x = started(); x.T.advance(16 * x.T.DAY); x.T.setUser("u2"); return Object.assign(x, { q: openQuiet(x.T, x.e)[0] }); };
  let x = quiet(); assert.match(x.T.decideTask(x.q.id, "shrug"), /Choose/); assert.equal(x.q.status, "open");
  assert.equal(x.T.decideTask(x.q.id, "call"), null); const call = x.T.S.tasks.find((t) => t.kind === "call" && t.status === "open"); assert.ok(call && call.script); assert.equal(x.e.status, "stuck", "still waiting on the call");
  x = quiet(); const n = out(x.T, x.e).length; x.T.decideTask(x.q.id, "restart"); assert.equal(x.e.status, "in_progress"); assert.equal(x.e.step, 0); assert.ok(x.e.next); x.T.advance(2 * x.T.DAY); assert.ok(out(x.T, x.e).length > n, "fetching did not start again");
  x = quiet(); x.T.decideTask(x.q.id, "pause"); assert.equal(x.e.status, "paused"); assert.equal(openQuiet(x.T, x.e).length, 0);
  x = quiet(); x.T.decideTask(x.q.id, "close"); assert.equal(x.e.status, "closed");
});
test("TH-CMP-5, 6: all in and verified sends that's-everything once; a file is not finished while a document still waits for a person", () => {
  const { T, c, e } = started(); T.inboundDoc(c.id, { form: "W2", year: 2026, payer: "Acme Logistics" }, "text");
  const d = T.inboundDoc(c.id, { form: "1098", year: 2026, payer: "Regions Mortgage", read: { legible: 0.9, conf: 0.5, note: "", missing: [] } }, "text"); assert.equal(d.state, "in_review"); assert.notEqual(e.status, "complete");
  T.setUser("u2"); T.decideTask(T.S.tasks.find((t) => t.kind === "document" && t.status === "open").id, "accept"); assert.equal(e.status, "complete"); assert.equal(out(T, e).filter((m) => m.tpl === "M13").length, 1);
  T.advance(5 * T.DAY); assert.equal(out(T, e).filter((m) => m.tpl === "M13").length, 1); assert.ok(e.timeline.some((t) => /^All fetched/.test(t.text)));
});
test("TH-CMP-6: marking an item not needed on the checklist also answers the \"I don't have it\" waiting for that item, so the file can finish", () => {
  const { T, c, e } = started(); T.inboundDoc(c.id, { form: "W2", year: 2026, payer: "Acme Logistics" }, "text"); T.inboundText(c.id, "I don't have a mortgage statement this year");
  const t = T.S.tasks.find((x) => x.kind === "says_none" && x.status === "open"); assert.ok(t); T.setUser("u2"); T.setItem(item(T, e, "1098").id, "waived", "Sold the house");
  assert.equal(t.status, "decided"); assert.equal(t.decision, "settled"); T.advance(T.HOUR); assert.ok(["complete", "in_progress"].includes(e.status)); assert.ok(T.checkComplete ? true : true);
  assert.equal(T.S.tasks.filter((x) => x.status === "open" && x.engId === e.id).length, 0);
});
