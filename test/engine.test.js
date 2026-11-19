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
  assert.ok(out(T, e).some((m) => m.tpl === "M6")); assert.ok(T.S.tasks.some((t) => t.kind === "call" && t.script));
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
