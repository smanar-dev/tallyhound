// Bugs found in the November 18 audit. Each test fails on the engine as it was before the fix.
const test = require("node:test");
const assert = require("node:assert/strict");
const { firm, started, out, last, item } = require("./helpers");

test("waiving or removing the last outstanding item completes the file and tells the client", () => {
  const { T, c, e } = started();
  T.inboundDoc(c.id, { form: "W2", year: 2026, payer: "Acme Logistics" }, "text");
  T.setItem(item(T, e, "1098").id, "waived", "Paid off");
  assert.equal(e.status, "complete"); assert.equal(last(T, e).tpl, "M13");
});
test("an incomplete document arriving on a complete file reopens it", () => {
  const { T, c, e } = started();
  T.inboundDoc(c.id, { form: "W2", year: 2026, payer: "Acme Logistics" }, "text");
  T.inboundDoc(c.id, { form: "1098", year: 2026, payer: "Regions Mortgage" }, "text");
  assert.equal(e.status, "complete");
  T.inboundDoc(c.id, { form: "1099INT", year: 2026, payer: "First Bank", missing: [T.ELEMENTS["1099INT"][0][0]] }, "text");
  assert.equal(e.status, "in_progress"); assert.equal(T.openItems(e.id).length, 1);
});
test("a staff 'ask again' at night waits for sending hours", () => {
  const { T, c, e } = started();
  T.inboundText(c.id, "I don't have that");
  const task = T.S.tasks.find((t) => t.kind === "says_none" && t.status === "open"); assert.ok(task);
  T.setNow(new Date(2027, 0, 25, 22, 30)); const n = out(T, e).length;
  T.decideTask(task.id, "ask_again", {});
  assert.equal(out(T, e).length, n, "nothing is sent at 10:30 pm");
  T.advance(13 * T.HOUR);
  const m = last(T, e); assert.equal(m.tpl, "M5"); assert.ok(m.at.getHours() >= T.S.firm.quietStart && m.at.getHours() < T.S.firm.quietEnd);
});
test("after a text opt-out, a staff message never goes by text", () => {
  const { T, c, e } = started();
  T.inboundText(c.id, "STOP");
  const r = T.manual(e.id, "Following up by email as you asked.");
  if (r === null || r === undefined) assert.equal(last(T, e).channel, "email"); else assert.match(r, /opted out|No working/);
  assert.equal(out(T, e).filter((m) => m.channel === "text" && m.kind === "manual").length, 0);
  assert.match(T.manual(e.id, "   "), /empty/);
});
test("'what else do you need?' gets the open list, not a handoff", () => {
  const { T, c, e } = started();
  assert.equal(T.inboundText(c.id, "what else do you need from me?"), "status");
  const m = last(T, e); assert.equal(m.tpl, "M26"); assert.match(m.body, /W-2/); assert.match(m.body, /mortgage/i);
  assert.equal(T.S.tasks.filter((t) => t.kind === "question" && t.status === "open").length, 0);
});
test("asking where to find a form already received says we have it", () => {
  const { T, c, e } = started();
  T.inboundDoc(c.id, { form: "W2", year: 2026, payer: "Acme Logistics" }, "text");
  T.inboundText(c.id, "where do I find my W-2?");
  assert.equal(last(T, e).tpl, "M11");
});
test("messages read correctly with no office phone and with one document", () => {
  const { T, c, e } = firm(); T.S.firm.phone = "";
  for (const code of ["M6", "M16H", "M21"]) { const b = T.fill(code, c, e, {}); assert.doesNotMatch(b, /\{|\s\.|on \.|undefined/, code + ": " + b); }
  T.setItem(item(T, e, "1098").id, "removed");
  assert.match(T.fill("M3", c, e, { item: item(T, e, "W2") }), /We need 1 document for/);
});
test("the tax year for new clients follows the firm setting", () => {
  const { T } = firm(); T.S.firm.taxYear = 2027;
  const r = T.addClient({ first: "New", last: "Year", email: "n@y.example" });
  assert.equal(T.eng(r.engId).year, 2027);
});
test("items from last year's return are added once, with payers, and bad codes are dropped", () => {
  const { T, e } = firm();
  const n = T.addFromPrior(e.id, [{ form: "W2", payer: "Acme Logistics" }, { form: "W2", payer: "Second Job LLC" }, { form: "K1", payer: "Poe Family LP" }, { form: "K1", payer: "Poe Family LP" }, { form: "NOPE" }]);
  assert.equal(n, 2); assert.equal(T.itemsOf(e.id).filter((i) => i.form === "W2").length, 2);
});
test("bulk template assignment can leave complete files alone", () => {
  const { T, c, e } = started();
  T.inboundDoc(c.id, { form: "W2", year: 2026, payer: "Acme Logistics" }, "text");
  T.inboundDoc(c.id, { form: "1098", year: 2026, payer: "Regions Mortgage" }, "text");
  assert.equal(T.applyTemplate(e.id, "t_family", { skipComplete: true }), 0); assert.equal(e.status, "complete");
});
