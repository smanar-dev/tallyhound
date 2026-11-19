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
