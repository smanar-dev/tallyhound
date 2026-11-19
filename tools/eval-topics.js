// Scores how well new topics are spotted, on the sixty-message set in reference/artifact/evalset.js.
//   node tools/eval-topics.js            the phrase list alone (no model)
//   ANTHROPIC_API_KEY=... node tools/eval-topics.js --model     the live model, through packages/adapters/anthropic.js
// Targets (ticket T-71): at least 9 in 10 real changes found, under 1 in 20 false alarms.
const path = require("node:path"), fs = require("node:fs");
const { createEngine } = require("../packages/engine"), prompts = require("../packages/core/prompts");
const win = {}; new Function("window", fs.readFileSync(path.join(__dirname, "../reference/artifact/evalset.js"), "utf8"))(win); const E = win.TH_EVAL;
async function main() {
  const T = createEngine(), e = T.S.engs.find((x) => x.status === "in_progress") || T.S.engs[0], live = process.argv.includes("--model");
  let ai = null; if (live) { const { anthropic } = require("../packages/adapters/anthropic"); ai = anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }); }
  const rows = [];
  for (const [text, want] of E) {
    let topics = T.topicsIn(text), odd = false;
    if (ai) { const r = await ai.json(prompts.readText(T, e, text), {}); topics = [].concat((r && r.topics) || []).filter((k) => T.CHECKQ.some((q) => q[0] === k)); odd = !!(r && r.new_document); }
    rows.push({ text, want, topics, odd, ok: want === null ? !topics.length && !odd : want === "other" ? odd || topics.length > 0 : topics.includes(want) });
  }
  const pos = rows.filter((r) => r.want), neg = rows.filter((r) => !r.want), found = pos.filter((r) => r.ok).length, fa = neg.filter((r) => !r.ok).length;
  console.log((live ? "Live model" : "Phrase list alone") + ": " + found + " of " + pos.length + " real changes found (" + Math.round((100 * found) / pos.length) + "%), " + fa + " of " + neg.length + " false alarms (" + Math.round((100 * fa) / neg.length) + "%)");
  rows.filter((r) => !r.ok).forEach((r) => console.log("  wrong: " + r.text + "  [expected " + (r.want || "nothing") + ", got " + (r.topics.join(",") || (r.odd ? "unusual" : "nothing")) + "]"));
  const pass = found / pos.length >= 0.9 && fa / neg.length < 0.05; console.log(pass ? "PASS" : "BELOW TARGET"); if (live && !pass) process.exitCode = 1;
}
main().catch((err) => { console.error(String(err && err.message || err)); process.exitCode = 1; });
