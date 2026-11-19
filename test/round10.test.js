// Round 10: the product checks documents, it does not extract what is on them.
const test = require("node:test");
const assert = require("node:assert/strict");
const prompts = require("../packages/core/prompts");
const { createEngine } = require("../packages/engine");
const { started, out } = require("./helpers");

test("the document prompts never ask the model for a dollar amount", () => {
  const T = createEngine();
  for (const p of [prompts.readDocument(T), prompts.readBundle(T)]) { assert.doesNotMatch(p, /key_amount/); assert.match(p, /dollar amounts/); assert.match(p, /does not extract/); }
});
test("every message a firm can edit has a plain name, with no internal wording", () => {
  const T = createEngine();
  for (const k of Object.keys(T.TPL.en)) { assert.ok(T.TPL_USE[k], "no name for " + k); assert.doesNotMatch(T.TPL_USE[k], /handoff|illegible|escalat/i, k); assert.ok(T.TPL.es[k], "no Spanish for " + k); }
});
test("the step shown on Home counts clients waiting on staff in the same words as the rest of the app", () => {
  const { T } = started(); const p = T.pipeline().find((x) => x.key === "chasing"); assert.match(p.hint, /waiting on you$/);
});
test("the activity log never uses the word escalated", () => {
  const { T, e } = started(); T.advance(20 * T.DAY); assert.ok(out(T, e).length > 1);
  assert.ok(T.S.hlog.every((h) => !/escalat/i.test(h.text)));
});
