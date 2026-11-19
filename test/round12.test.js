// Round 12: the questions (check-in) as a one-time text after opt-in. Automatic if the firm chooses, by hand otherwise,
// and skippable for one client or for everyone.
const test = require("node:test");
const assert = require("node:assert/strict");
const { firm, out, last } = require("./helpers");

function optedIn(mode, before) { const x = firm(); x.T.S.firm.checkinMode = mode; x.e.confirmed = true; x.T.start(x.e.id); if (before) before(x); x.T.giveConsent(x.c.id, "page"); return x; }
const tpls = (T, e) => out(T, e).map((m) => m.tpl);

test("by default nothing extra is sent after opt-in: the first document request follows", () => {
  const { T, e } = optedIn(undefined); T.advance(10 * T.MIN); assert.deepEqual(tpls(T, e), ["M1", "M2", "M3"]);
});
test("automatic: the questions go by text right after opt-in, once, and document requests wait for the answers", () => {
  const { T, e } = optedIn("auto"); assert.deepEqual(tpls(T, e), ["M1", "M2", "M28"]); assert.equal(last(T, e).channel, "text");
  T.advance(T.DAY); assert.deepEqual(tpls(T, e), ["M1", "M2", "M28"], "requests should wait");
});
test("automatic: no answer in two days and the requests go out with the checklist on file, with no reminder", () => {
  const { T, e } = optedIn("auto"); T.advance(3 * T.DAY); const t = tpls(T, e); assert.ok(t.includes("M3")); assert.ok(!t.includes("M28R")); assert.equal(t.filter((x) => x === "M28").length, 1);
  T.advance(10 * T.DAY); assert.equal(tpls(T, e).filter((x) => x === "M28" || x === "M28R").length, 1);
});
test("answers that change nothing are applied without bothering anyone, and collecting carries on", () => {
  const { T, c, e } = optedIn("auto"); const r = T.checkinDone(c.id, { same: true }); assert.equal(r.adds + r.drops, 0);
  assert.ok(e.checkin.reviewedAt, "applied on its own"); T.advance(2 * T.HOUR); assert.ok(tpls(T, e).includes("M3"));
});
test("answers that change the checklist wait for a person, then collecting carries on with the corrected list", () => {
  const { T, c, e } = optedIn("auto"); const r = T.checkinDone(c.id, { facts: { w2: true, homeowner: true, retire: true }, counts: { w2: 1 } });
  assert.ok(r.adds > 0); assert.equal(e.checkin.reviewedAt, null); assert.ok(T.S.alerts.some((a) => /answered the questions/.test(a.text)));
  T.advance(T.DAY); assert.ok(!tpls(T, e).includes("M3"), "should hold while the review is open");
  const a = T.applyCheckin(e.id, {}); assert.ok(a.added > 0); assert.equal(e.status, "in_progress"); T.advance(2 * T.HOUR); assert.ok(tpls(T, e).includes("M3"));
});
test("a review nobody opens does not block collecting for ever", () => {
  const { T, c, e } = optedIn("auto"); T.checkinDone(c.id, { facts: { w2: true, retire: true }, counts: { w2: 1 } }); T.advance(4 * T.DAY); assert.ok(tpls(T, e).includes("M3"));
});
test("by hand: staff can text the questions once to a client who is already collecting", () => {
  const { T, e } = optedIn("manual"); T.advance(10 * T.MIN); assert.equal(T.sendCheckin(e.id), null); assert.equal(last(T, e).tpl, "M28"); assert.equal(last(T, e).channel, "text");
  assert.match(String(T.sendCheckin(e.id)), /already sent/);
});
test("by hand: not before the client has turned texting on", () => {
  const x = firm(); x.e.confirmed = true; x.T.start(x.e.id); x.e.status = "in_progress"; assert.match(String(x.T.sendCheckin(x.e.id)), /not turned texting on/);
});
test("skip for one client: with automatic sending on, that client goes straight to document requests", () => {
  const { T, e } = optedIn("auto", (x) => x.T.skipQuestions(x.e.id)); T.advance(10 * T.MIN); assert.deepEqual(tpls(T, e), ["M1", "M2", "M3"]);
});
test("skip for everyone is the default setting, and one client can still be sent the questions", () => {
  const { T, e } = optedIn("manual"); T.advance(10 * T.MIN); assert.ok(!tpls(T, e).includes("M28")); assert.equal(T.sendCheckin(e.id), null);
});
test("the questions wait for sending hours and are cancelled if the firm skips the client first", () => {
  const x = firm(); x.T.S.firm.checkinMode = "auto"; x.e.confirmed = true; x.T.start(x.e.id); x.T.setNow(new Date(2027, 0, 25, 23, 0)); x.T.giveConsent(x.c.id, "page");
  assert.ok(!tpls(x.T, x.e).includes("M28")); assert.equal(x.e.checkin.pending, "text"); x.T.skipQuestions(x.e.id); assert.equal(x.e.checkin, null);
  x.T.advance(14 * x.T.HOUR); assert.ok(!tpls(x.T, x.e).includes("M28")); assert.ok(tpls(x.T, x.e).includes("M3"));
});
test("the questions are never sent while a person has the conversation, or to a client without consent", () => {
  const { T, e } = optedIn("auto", (x) => x.T.takeover(x.e.id, "test")); assert.ok(!tpls(T, e).includes("M28"));
});
