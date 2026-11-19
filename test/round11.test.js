// Round 11: pricing rules. Trial caps, the optional 3-month pause, the reply clients get while a firm is paused,
// the fair-use allowance, and the usage meter that the cost model rests on.
const test = require("node:test");
const assert = require("node:assert/strict");
const { firm, started, out, last } = require("./helpers");
const { createEngine } = require("../packages/engine");

const addMany = (T, n) => { for (let i = 0; i < n; i++) T.addClient({ first: "A" + i, last: "B" + i, email: "a" + i + "@x.example", template: T.templates()[0].id }); };

test("a trial collects from 10 clients and no more, by start or by check-in", () => {
  const { T } = firm({ plan: undefined }); addMany(T, 14);
  const res = T.S.engs.map((e) => { e.confirmed = true; return T.start(e.id) || "ok"; });
  assert.equal(res.filter((r) => r === "ok").length, 10); assert.match(res[10], /free trial collects from 10 clients/);
  assert.equal(T.access().clientsLeft, 0);
  const waiting = T.S.engs.find((e) => e.status === "not_started"); assert.match(String(T.sendCheckin(waiting.id)), /free trial/);
  assert.equal(T.choosePlan("Solo"), null); assert.equal(T.start(waiting.id) || "ok", "ok");
});
test("the whole client list can be imported during a trial", () => {
  const { T } = firm({ plan: undefined }); addMany(T, 60); assert.equal(T.S.clients.length, 61);
});
test("a client who opts out before being contacted does not use up a trial place", () => {
  const { T, c } = firm({ plan: undefined }); T.inboundText(c.id, "STOP"); assert.equal(T.access().clientsLeft, 10);
});
test("a trial stops reading documents after 100, and a paid firm never stops", () => {
  const { T, c } = started({ plan: undefined }); assert.equal(T.canRead(), true);
  for (let i = 0; i < 100; i++) T.meter("docRead"); assert.equal(T.canRead(), false);
  T.choosePlan("Solo"); assert.equal(T.canRead(), true); for (let i = 0; i < 9000; i++) T.meter("docRead"); assert.equal(T.canRead(), true); assert.ok(c);
});
test("a pause is never automatic", () => {
  const { T } = started(); T.advance(200 * T.DAY); assert.equal(T.access().state, "active");
});
test("pausing is capped at 90 days in any 12 months, in one stretch or several", () => {
  const { T } = firm(), day = (n) => new Date(T.S.now.getTime() + n * T.DAY);
  assert.match(String(T.pauseSeason(day(91))), /3 months/);
  assert.equal(T.pauseSeason(day(60)), null); T.advance(61 * T.DAY); assert.equal(T.access().state, "active"); assert.equal(T.pauseLeft(), 30);
  assert.match(String(T.pauseSeason(day(40))), /30 days left/); assert.equal(T.pauseSeason(day(30)), null); T.advance(31 * T.DAY);
  assert.match(String(T.pauseSeason(day(5))), /used your 3 months/);
  T.advance(300 * T.DAY); assert.ok(T.pauseLeft() > 0, "the allowance comes back after a year");
});
test("resuming early gives the unused days back", () => {
  const { T } = firm(); T.pauseSeason(new Date(T.S.now.getTime() + 90 * T.DAY)); T.advance(10 * T.DAY); T.resumeNow(); assert.equal(T.pauseLeft(), 80);
});
test("while paused, a client who writes in is told to contact the firm directly, once a week at most", () => {
  const { T, c, e } = started(); T.pauseSeason(new Date(T.S.now.getTime() + 60 * T.DAY));
  const n = out(T, e).length; assert.equal(T.inboundText(c.id, "here is my W-2"), "away");
  assert.equal(last(T, e).tpl, "M31"); assert.match(last(T, e).body, /contact Test CPAs directly/); assert.match(last(T, e).body, /docs@test\.example/);
  T.inboundText(c.id, "hello?"); T.inboundDoc(c.id, { form: "W2", year: 2026, payer: "Acme Logistics" }, "text"); assert.equal(out(T, e).length, n + 1);
  T.advance(8 * T.DAY); T.inboundEmail(c.id, "Anyone there?", [], null); assert.equal(out(T, e).length, n + 2);
});
test("the paused reply exists in Spanish and names no date or promise", () => {
  const { T, c, e } = started(); c.lang = "es"; T.pauseSeason(new Date(T.S.now.getTime() + 30 * T.DAY)); T.inboundText(c.id, "hola");
  assert.match(last(T, e).body, /directamente/); assert.doesNotMatch(last(T, e).body, /\d{4}|enero|January/);
});
test("a document that arrives while paused is stored and not checked", () => {
  const { T, c } = started(); T.pauseSeason(new Date(T.S.now.getTime() + 30 * T.DAY));
  const d = T.inboundDoc(c.id, { form: "W2", year: 2026, payer: "Acme Logistics" }, "text"); assert.equal(d.state, "stored");
});
test("STOP still works while paused, and a stopped firm sends no away reply", () => {
  const { T, c, e } = started(); T.pauseSeason(new Date(T.S.now.getTime() + 30 * T.DAY)); T.inboundText(c.id, "STOP"); assert.equal(last(T, e).tpl, "M16");
});
test("text segments are counted the way carriers bill them", () => {
  const T = createEngine();
  assert.equal(T.segs("Hi Dana"), 1); assert.equal(T.segs("x".repeat(160)), 1); assert.equal(T.segs("x".repeat(161)), 2); assert.equal(T.segs("x".repeat(307)), 3);
  assert.equal(T.segs("Envíe una foto"), 1, "short accented text is still one segment"); assert.equal(T.segs("í" + "x".repeat(70)), 2, "one accent drops the limit to 70");
  assert.equal(T.segs(""), 0);
});
test("usage is metered as messages and documents move", () => {
  const { T, c } = started(); const a = T.usage().totals;
  T.inboundText(c.id, "thanks"); T.inboundDoc(c.id, { form: "W2", year: 2026, payer: "Acme Logistics" }, "text");
  const b = T.usage().totals; assert.ok(b.segIn > a.segIn); assert.equal(b.docRead, a.docRead + 1); assert.equal(b.mmsIn, a.mmsIn + 1); assert.ok(b.segOut > a.segOut);
  assert.ok(T.usage().cost > 0); const U = createEngine(); U.load(T.dump()); assert.deepEqual(U.usage().totals, b);
});
test("the allowance is the plan's client limit times a fixed amount per client", () => {
  const { T } = firm({ plan: "Solo" }); const u = T.usage(); assert.equal(u.allow.segs, 150 * T.FAIR.segs); assert.equal(u.allow.docs, 150 * T.FAIR.docs);
});
test("past the text allowance nothing stops: reminders move to email and the owner is told once", () => {
  const { T, c, e } = started({ plan: "Solo" }); T.meter("segOut", 150 * T.FAIR.segs);
  const n = out(T, e).length; T.advance(6 * T.DAY);
  const sent = out(T, e).slice(n); assert.ok(sent.length > 0, "collecting carries on"); assert.ok(sent.filter((m) => ["M5", "M6"].includes(m.tpl)).every((m) => m.channel === "email"));
  assert.equal(T.S.alerts.filter((a) => a.kind === "fair_use" && /allowance of text messages/.test(a.text) && a.level === "medium").length, 1); assert.ok(c);
});
test("plans go up by client count, and a list past the largest plan is sent to us for a price", () => {
  const T = createEngine(); assert.equal(T.planFor(120), "Solo"); assert.equal(T.planFor(400), "Practice"); assert.equal(T.planFor(900), "Firm"); assert.equal(T.planFor(2400), "Large");
  const price = Object.fromEntries(T.PLANS.map((p) => [p[0], p[1] / p[2]])); assert.ok(T.PLANS.every((p) => (p[1] * 9) / p[2] >= 3.5), "every plan earns at least $3.50 a client over a 9-month year");
  assert.ok(price.Solo > price.Large);
});
