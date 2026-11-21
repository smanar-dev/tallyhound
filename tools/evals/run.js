// Scores the reply reading against a labelled set. node tools/evals/run.js [file]
// With no model it scores the engine's own patterns (what a firm gets when Claude is not connected, and the floor under the model).
// The spec's gates (docs/REBRAND.md): precision of 0.95 or better on "high" for every new intent; recall of 0.98 or better for
// "not mine"; no old intent worse by more than a point. They are meant for the pilot set, not this synthetic one.
const fs = require("node:fs"), path = require("node:path");
const { createEngine } = require("../../packages/engine");
function score(replies, read) {
  const intents = [...new Set(replies.map((r) => r[0]))].filter((k) => k !== "none"), out = {};
  for (const k of intents) out[k] = { tp: 0, fp: 0, fn: 0, missed: [], wrong: [] };
  for (const [want, lang, text] of replies) {
    const got = read(text, lang) || "none";
    if (got !== "none" && out[got]) { if (got === want) out[got].tp++; else { out[got].fp++; out[got].wrong.push(text); } }
    if (want !== "none" && got !== want) { out[want].fn++; out[want].missed.push(text); }
  }
  for (const k of intents) { const o = out[k]; o.precision = o.tp + o.fp ? o.tp / (o.tp + o.fp) : 1; o.recall = o.tp + o.fn ? o.tp / (o.tp + o.fn) : 1; }
  return out;
}
// The engine's own reading, with no model: one firm, one client with a W-2 and a mortgage statement on the list.
function rulesReader() {
  const T = createEngine(); T.blank({ plan: "Practice", name: "Maple & Pine Tax Co.", email: "docs@maplepine.example", senderStatus: "approved", mode: "autopilot", replyV2: "on", now: new Date(2027, 0, 25, 10, 5), users: [{ id: "u1", first: "Dana", name: "Dana Owner", role: "owner", email: "dana@maplepine.example" }] });
  T.importRows(T.parseCSV("First,Last,Email,Mobile\nMaria,Garcia,maria@x.example,6155550111")); const e = T.S.engs[0];
  return (text, lang) => { T.S.clients[0].lang = lang; const r = T.replyV2(text, null, e); return r && !r.low && T.V2.includes(r.intent) ? r.intent : "none"; };
}
module.exports = { score, rulesReader };
if (require.main === module) {
  const file = process.argv[2] || path.join(__dirname, "replies.json"), set = JSON.parse(fs.readFileSync(file, "utf8")).replies, res = score(set, rulesReader());
  console.log(set.length + " replies, read by the engine's patterns (no model)\n");
  for (const k of Object.keys(res)) { const o = res[k]; console.log(k.padEnd(22) + "precision " + o.precision.toFixed(2) + "  recall " + o.recall.toFixed(2) + (o.wrong.length ? "\n  wrongly read as this: " + o.wrong.join(" | ") : "") + (o.missed.length ? "\n  missed: " + o.missed.join(" | ") : "")); }
  const bad = Object.keys(res).filter((k) => res[k].precision < 0.95 || (k === "not_mine" && res[k].recall < 0.98));
  console.log(bad.length ? "\nBelow the gate: " + bad.join(", ") : "\nEvery gate met on this set."); process.exitCode = bad.length ? 1 : 0;
}
