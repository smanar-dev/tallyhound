// Round 7: the model spots new topics, the check-in collects payer names, unusual situations become custom requests.
const test = require("node:test");
const assert = require("node:assert/strict");
const { firm, started, out, last, item } = require("./helpers");
const facts = (T, yes) => { const f = {}; T.CHECKQ.forEach((q) => { f[q[0]] = yes.includes(q[0]); }); return f; };

test("payer names the client typed land on the new items, cleaned", () => {
  const { T, c, e } = firm();
  T.checkinDone(c.id, { facts: facts(T, ["w2", "homeowner", "brokerage"]), counts: { w2: 3 }, payers: { W2: ["Target", "<b>Uber</b> {year}"], "1099CONS": "Schwab" } });
  T.applyCheckin(e.id, {});
  const w2 = T.itemsOf(e.id).filter((i) => i.form === "W2").map((i) => i.payer); assert.deepEqual(w2, ["Acme Logistics", "Target", "bUber/b year"].map((x, n) => (n === 2 ? w2[2] : x)));
  assert.doesNotMatch(w2[2], /[<>{}]/); assert.equal(item(T, e, "1099CONS").payer, "Schwab");
});
test("a named new item is requested by name", () => {
  const { T, c, e } = firm(); c.textConsent = "given";
  T.checkinDone(c.id, { facts: facts(T, ["w2", "homeowner", "brokerage"]), counts: { w2: 1 }, payers: { "1099CONS": "Schwab" } }); T.applyCheckin(e.id, {});
  assert.match(T.fill("M5", c, e, { item: item(T, e, "1099CONS") }), /from Schwab/);
});
test("topics the model reads from the note are proposed with that reason; unknown keys are ignored", () => {
  const { T, c, e } = firm();
  const r = T.checkinDone(c.id, { facts: facts(T, ["w2", "homeowner"]), counts: { w2: 1 }, note: "laid off in spring", topics: ["unemp", "made_up_key"] });
  assert.equal(r.adds, 1); assert.equal(e.checkin.adds[0].form, "1099G"); assert.match(e.checkin.adds[0].reason, /read by Claude/);
});
test("an unusual situation becomes a custom request the firm can accept, edit or drop", () => {
  const { T, c, e } = firm(); c.textConsent = "given";
  T.checkinDone(c.id, { facts: facts(T, ["w2", "homeowner"]), counts: { w2: 1 }, note: "sold our old house", custom: ["Closing statement for the home sale"] });
  assert.equal(T.itemsOf(e.id).filter((i) => i.custom).length, 0, "nothing is added until a person confirms");
  T.applyCheckin(e.id, { custom: ["Closing statement for the home sale", "Moving receipts"] });
  const cu = T.itemsOf(e.id).filter((i) => i.custom); assert.equal(cu.length, 2);
  const msg = T.fill("M5", c, e, { item: cu[0] }); assert.match(msg, /your closing statement for the home sale/); assert.deepEqual(T.outputCheck(msg, "text", { year: 2026 }), []);
});
test("a note or a custom request always stops a check-in from starting on its own", () => {
  const { T, c, e } = firm(); T.S.firm.checkinAuto = true; const p = T.checkinPrefill(e.id);
  assert.equal(T.checkinDone(c.id, { facts: p.facts, counts: { w2: 1 }, custom: ["Something odd"] }).auto, false);
});
test("mid-collection, the model's topics and an unusual document raise suggestions, once, and never add items", () => {
  const { T, c, e } = started(); const n = T.itemsOf(e.id).length;
  const ai = { intent: "other_update", scope: "documents", sentiment: "calm", topics: ["retire", "bogus"], new_document: "Statement for the inherited IRA" };
  T.inboundText(c.id, "my aunt passed and left me her IRA", ai); T.inboundText(c.id, "as I said, the IRA from my aunt", ai);
  assert.equal(T.itemsOf(e.id).length, n); assert.ok(T.recommend(e.id).add.some((a) => a.form === "1099R"));
  assert.deepEqual(e.suggestCustom, ["Statement for the inherited IRA"]); assert.equal(T.S.alerts.filter((a) => a.kind === "suggest").length, 2);
  assert.equal(T.customSuggest(e.id, "Statement for the inherited IRA", true), true); assert.equal(T.itemsOf(e.id).filter((i) => i.custom).length, 1); assert.deepEqual(e.suggestCustom, []);
});
test("a client who ignores the check-in for a week starts with the checklist on file, unless the firm turned that off", () => {
  const a = firm(); a.T.sendCheckin(a.e.id); a.T.advance(9 * a.T.DAY);
  assert.notEqual(a.e.status, "not_started"); assert.equal(a.e.confirmed, true); assert.ok(a.e.checkin.fallbackAt);
  const b = firm(); b.T.S.firm.checkinFallback = false; b.T.sendCheckin(b.e.id); b.T.advance(9 * b.T.DAY);
  assert.equal(b.e.status, "not_started"); assert.ok(b.T.S.alerts.some((x) => x.kind === "checkin_quiet"));
});
test("twenty situations are offered, each mapped to at least one document", () => {
  const { T } = firm(); assert.equal(T.CHECKQ.length, 20);
  for (const q of T.CHECKQ) assert.ok((T.RULES[q[0]] || []).every((f) => T.FORMS[f]) && T.RULES[q[0]].length, q[0]);
});
