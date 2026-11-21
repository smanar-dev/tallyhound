// The reply reading against the synthetic set in tools/evals (TH-RPL). With no model the engine's own patterns must never read a
// reply as one of the five new meanings when it is not (that would act on a client by mistake), and must not miss "this isn't me".
const test = require("node:test");
const assert = require("node:assert/strict");
const { score, rulesReader } = require("../tools/evals/run.js");
const set = require("../tools/evals/replies.json").replies;
test("TH-RPL evals: on the synthetic set the patterns read nothing wrongly as a new meaning, and miss no \"not mine\"", () => {
  assert.ok(set.length >= 80); const res = score(set, rulesReader());
  for (const k of Object.keys(res)) assert.equal(res[k].precision, 1, k + " was read into: " + res[k].wrong.join(" | "));
  assert.equal(res.not_mine.recall, 1, "missed: " + res.not_mine.missed.join(" | "));
  for (const k of Object.keys(res)) assert.ok(res[k].recall >= 0.9, k + " recall " + res[k].recall.toFixed(2) + ", missed: " + res[k].missed.join(" | "));
});
