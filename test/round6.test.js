// Round 6: the check-in. Quick taps from the client, a proposed checklist for the firm, one decision to start.
const test = require("node:test");
const assert = require("node:assert/strict");
const { firm, started, out, last, item } = require("./helpers");
const facts = (T, yes) => { const f = {}; T.CHECKQ.forEach((q) => { f[q[0]] = yes.includes(q[0]); }); return f; };

test("a check-in goes out before collecting starts and asks for nothing else", () => {
  const { T, e } = firm();
  assert.equal(T.sendCheckin(e.id), null); assert.equal(last(T, e).tpl, "M28"); assert.equal(last(T, e).channel, "email");
  assert.equal(e.status, "not_started"); assert.equal(out(T, e).filter((m) => ["M3", "M4", "M5"].includes(m.tpl)).length, 0);
});
test("the client's taps become a proposal, not a change", () => {
  const { T, c, e } = firm(); T.sendCheckin(e.id); const before = T.itemsOf(e.id).length;
  const r = T.checkinDone(c.id, { facts: facts(T, ["w2", "brokerage", "childcare"]), counts: { w2: 2 }, note: "We moved in June" });
  assert.deepEqual([r.adds, r.drops, r.auto], [3, 1, false]);
  assert.equal(T.itemsOf(e.id).length, before, "nothing is added until a person confirms");
  assert.deepEqual(e.checkin.adds.map((a) => a.form).sort(), ["1099CONS", "CHILDCARE", "W2"]);
  assert.equal(T.S.items.find((i) => i.id === e.checkin.drops[0]).form, "1098");
  assert.equal(last(T, e).tpl, "M29"); assert.ok(T.S.alerts.some((a) => a.kind === "checkin"));
  assert.ok((e.memory || []).some((m) => /moved in June/.test(m.text)));
});
test("the firm can add and subtract before confirming, then start in one step", () => {
  const { T, c, e } = firm(); T.sendCheckin(e.id);
  T.checkinDone(c.id, { facts: facts(T, ["w2", "brokerage", "childcare"]), counts: { w2: 1 } });
  const r = T.applyCheckin(e.id, { add: [0], drop: [], start: true });
  assert.deepEqual([r.added, r.removed, r.started], [1, 0, true]);
  assert.ok(item(T, e, "1099CONS")); assert.equal(item(T, e, "CHILDCARE"), undefined); assert.equal(item(T, e, "1098").state !== "removed", true);
  assert.equal(e.confirmed, true); assert.notEqual(e.status, "not_started");
});
test("'same as last year' proposes no changes", () => {
  const { T, c, e } = firm(); const p = T.checkinPrefill(e.id);
  const r = T.checkinDone(c.id, { facts: p.facts, counts: { w2: p.w2 }, same: true });
  assert.deepEqual([r.adds, r.drops], [0, 0]);
});
test("with the firm's switch on, a simple check-in starts collecting by itself; anything else waits", () => {
  const a = firm(); a.T.S.firm.checkinAuto = true; const p = a.T.checkinPrefill(a.e.id);
  assert.equal(a.T.checkinDone(a.c.id, { facts: p.facts, counts: { w2: 1 }, same: true }).auto, true); assert.notEqual(a.e.status, "not_started");
  const b = firm(); b.T.S.firm.checkinAuto = true;
  assert.equal(b.T.checkinDone(b.c.id, { facts: facts(b.T, ["w2"]), counts: { w2: 1 } }).auto, false, "the client untapped the mortgage: a person decides"); assert.equal(b.e.status, "not_started");
  const d = firm(); d.T.S.firm.checkinAuto = true; const pd = d.T.checkinPrefill(d.e.id);
  assert.equal(d.T.checkinDone(d.c.id, { facts: pd.facts, counts: { w2: 1 }, note: "Call me first" }).auto, false, "a note always goes to a person");
});
test("a check-in sent at night goes out in the morning, with one reminder after three days", () => {
  const { T, e } = firm(); T.setNow(new Date(2027, 0, 25, 22, 0)); const n = out(T, e).length;
  T.sendCheckin(e.id); assert.equal(out(T, e).length, n);
  T.advance(13 * T.HOUR); assert.equal(last(T, e).tpl, "M28"); assert.ok(last(T, e).at.getHours() >= T.S.firm.quietStart);
  T.advance(4 * T.DAY); assert.equal(out(T, e).filter((m) => m.tpl === "M28R").length, 1);
  T.advance(5 * T.DAY); assert.equal(out(T, e).filter((m) => m.tpl === "M28R").length, 1); assert.ok(T.S.alerts.some((a) => a.kind === "checkin_quiet"));
  assert.notEqual(e.status, "not_started", "after a week with no answer, collecting starts with the checklist on file");
});
test("once collecting has started the questions can be texted once, and never after the client has answered", () => {
  const a = started(); assert.equal(a.T.sendCheckin(a.e.id), null); assert.match(a.T.sendCheckin(a.e.id), /already sent/);
  const b = firm(); b.T.checkinDone(b.c.id, { facts: {} }); assert.match(b.T.sendCheckin(b.e.id), /already answered/);
});
test("mid-collection, a client who mentions something new gets a suggestion raised, never an automatic change", () => {
  const { T, c, e } = started(); const before = T.itemsOf(e.id).length;
  T.inboundText(c.id, "By the way I sold some stock this year and we rented out the basement");
  assert.equal(T.itemsOf(e.id).length, before);
  assert.deepEqual(T.recommend(e.id).add.map((a) => a.form).sort(), ["1099CONS", "RENTAL"]);
  assert.ok(T.S.alerts.some((a) => a.kind === "suggest")); assert.ok(e.suggestAt);
  T.inboundText(c.id, "like I said, sold stock"); assert.equal(T.S.alerts.filter((a) => a.kind === "suggest").length, 1, "the same topic is raised once");
});
test("the check-in survives save and reload", () => {
  const { T, c, e } = firm(); T.sendCheckin(e.id); T.checkinDone(c.id, { facts: facts(T, ["w2", "hsa"]), counts: { w2: 1 } });
  T.load(T.dump()); const e2 = T.S.engs[0]; assert.ok(e2.checkin.doneAt instanceof Date); assert.equal(e2.checkin.adds[0].form, "1099SA");
});
