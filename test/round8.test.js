// Round 8: seasons, custom request matching, Spanish wording, safe loading, setup time.
const test = require("node:test");
const assert = require("node:assert/strict");
const { firm, started, out, last, item } = require("./helpers");
const finish = (x) => { x.T.inboundDoc(x.c.id, { form: "W2", year: 2026, payer: "Acme Logistics" }, "text"); x.T.inboundDoc(x.c.id, { form: "1098", year: 2026, payer: "Regions Mortgage" }, "text"); return x; };

test("rolling the season carries a finished client forward with what they actually sent", () => {
  const x = started(); const { T, c } = x; T.addItem(x.e.id, "1099INT", "First Bank"); T.inboundText(c.id, "I don't have the interest statement, that account closed");
  T.decideTask(T.S.tasks.find((t) => t.kind === "says_none" && t.status === "open").id, "waive", {}); T.remember ? T.remember(x.e, "Travels in February", "Alex") : null; finish(x);
  assert.equal(x.e.status, "complete");
  const r = T.rollSeason(2027); assert.deepEqual([r.rolled, r.left, r.year], [1, 0, 2027]);
  const e = T.engOf(c.id); assert.equal(e.year, 2027); assert.equal(e.status, "not_started"); assert.equal(e.returning, true);
  assert.deepEqual(T.itemsOf(e.id).map((i) => i.form + ":" + i.payer + ":" + i.source).sort(), ["1098:Regions Mortgage:prior_year", "W2:Acme Logistics:prior_year"]);
  assert.equal(e.lastSeason.received, 2); assert.match(e.lastSeason.none.join(), /interest statement/); assert.equal(c.textConsent, "given", "consent carries over");
  assert.equal(T.S.engs.length, 1); assert.equal(T.S.msgs.filter((m) => m.engId !== e.id).length, 0, "last season's messages leave the live workspace");
  assert.equal(T.history(c.id)[0].year, 2026); assert.equal(T.history(c.id)[0].items.length, 3);
});
test("a rolled client's check-in is one tap, and last year's form is refused for the new year", () => {
  const x = finish(started()); const { T, c } = x; T.rollSeason(2027); const e = T.engOf(c.id);
  assert.equal(T.checkinPrefill(e.id).returning, true); assert.equal(T.sendCheckin(e.id), null);
  assert.deepEqual([T.checkinDone(c.id, { same: true }).adds, T.applyCheckin(e.id, { start: true }).started], [0, true]);
  T.advance(T.DAY); assert.match(last(T, e).body, /2027/);
  assert.equal(T.inboundDoc(c.id, { form: "W2", year: 2026, payer: "Acme Logistics" }, "text").state, "rejected");
  assert.equal(T.inboundDoc(c.id, { form: "W2", year: 2027, payer: "Acme Logistics" }, "text").state, "accepted");
});
test("clients still collecting stay on the old year, and a season cannot be skipped or repeated", () => {
  const a = started(); assert.deepEqual([a.T.rollSeason(2027).rolled, a.T.rollSeason(2027).error !== undefined], [0, true]); assert.equal(a.T.engOf(a.c.id).year, 2026);
  const b = firm(); assert.ok(b.T.rollSeason(2029).error); assert.ok(b.T.rollSeason(2026).error);
});
test("a pause after a roll still resumes correctly", () => {
  const x = finish(started()); const { T, c } = x; T.rollSeason(2027); const e = T.engOf(c.id); e.confirmed = true; T.start(e.id); T.advance(T.HOUR);
  T.pause(e.id); assert.equal(e.status, "paused"); T.resume(e.id); assert.equal(typeof e.status, "string"); assert.notEqual(e.status, "paused");
});
test("a non-standard document is matched to the right custom request", () => {
  const { T, c, e } = started();
  T.customSuggest(e.id, "Closing statement for the home sale", true); T.customSuggest(e.id, "Statement for the inherited IRA", true);
  const d = T.inboundDoc(c.id, { form: "OTHER", year: 2026, payer: "Fidelity", read: { note: "A year-end statement for an inherited IRA", legible: 0.95, conf: 0.9 } }, "text");
  assert.equal(d.state, "in_review"); assert.equal(T.S.items.find((i) => i.id === d.matchItem).custom, "Statement for the inherited IRA");
  T.decideTask(T.S.tasks.find((t) => t.docId === d.id).id, "accept", {});
  assert.deepEqual(T.itemsOf(e.id).filter((i) => i.custom).map((i) => i.state), ["expected", "received"]);
});
test("staff can override the suggested match, and an unclear document is never matched silently", () => {
  const { T, c, e } = started();
  T.customSuggest(e.id, "Closing statement for the home sale", true); T.customSuggest(e.id, "Statement for the inherited IRA", true);
  const d = T.inboundDoc(c.id, { form: "OTHER", year: 2026, payer: "", read: { note: "A utility bill", legible: 0.95, conf: 0.9 } }, "text");
  assert.equal(d.matchItem, undefined); const home = T.itemsOf(e.id).find((i) => /home sale/.test(i.custom));
  T.decideTask(T.S.tasks.find((t) => t.docId === d.id).id, "accept", { itemId: home.id }); assert.equal(home.state, "received");
});
test("a Spanish-speaking client is asked for a custom request in Spanish once wording exists", () => {
  const { T, c, e } = started(); c.lang = "es"; T.customSuggest(e.id, "Closing statement for the home sale", true); const it = T.itemsOf(e.id).find((i) => i.custom);
  assert.equal(T.needsSpanish().length, 1); assert.match(T.fill("M5", c, e, { item: it }), /closing statement/);
  assert.equal(T.setCustomEs(it.id, "Estado de cierre de la venta de la casa"), true); assert.equal(T.needsSpanish().length, 0);
  const b = T.fill("M5", c, e, { item: it }); assert.match(b, /su estado de cierre de la venta de la casa/); assert.deepEqual(T.outputCheck(b, "text", { year: 2026 }), []);
});
test("a bad saved workspace is refused and leaves the current one untouched", () => {
  const { T } = firm(); const before = T.dump();
  for (const j of ["", "{", "null", '{"v":1,"state":{}}', '{"v":1,"state":{"clients":[],"engs":[],"items":[],"msgs":[],"docs":[],"tasks":[],"users":[]}}']) assert.throws(() => T.load(j));
  assert.equal(T.dump(), before);
});
test("a workspace saved before newer features existed loads with safe defaults", () => {
  const { T } = firm(); const o = JSON.parse(T.dump()); delete o.state.alerts; delete o.state.hlog; delete o.state.archive; delete o.state.firm.hound; delete o.state.firm.templates;
  T.load(JSON.stringify(o)); assert.deepEqual([T.S.alerts.length, T.S.archive.length, T.S.firm.hound.mode], [0, 0, "copilot"]); assert.doesNotThrow(() => { T.advance(T.DAY); T.pipeline(); });
});
test("time from creating a firm to its first message is measured", () => {
  const { T, e } = firm(); assert.equal(T.setupTime(), null); T.advance(20 * T.MIN); T.sendCheckin(e.id); assert.equal(T.setupTime(), 20);
});
test("a new firm with no approved text number still reaches clients, by email", () => {
  const { T, c, e } = firm({ senderStatus: "submitted" }); c.textConsent = "given";
  T.sendCheckin(e.id); assert.equal(last(T, e).channel, "email"); e.confirmed = true; T.start(e.id); T.advance(2 * T.DAY);
  assert.ok(out(T, e).length >= 2); assert.ok(out(T, e).every((m) => m.channel === "email"));
});
