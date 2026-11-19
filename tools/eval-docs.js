// Measures document reading on REAL files, through the production prompt, model and rules.
//   ANTHROPIC_API_KEY=... node tools/eval-docs.js ./testset
// ./testset holds the files and a truth.csv with one line per file:
//   file,form,year,recipient,payer,expect        expect is accept, reask or person
//   w2-clean.jpg,W2,2026,Jo Day,Acme Logistics,accept
//   w2-blurry.jpg,W2,2026,Jo Day,Acme Logistics,reask
// Build the set from the founders' own documents with the ID numbers covered, photographed the way clients do it:
// on a kitchen table, at an angle, under a lamp, half out of frame. About 300 files. Never use a client's documents.
// --dry runs without a key: the model's answer is taken from truth.csv, which only proves the harness works.
const fs = require("node:fs"), path = require("node:path");
const { createEngine } = require("../packages/engine"), prompts = require("../packages/core/prompts"), { nameMatch } = require("../packages/core/pipeline"), { sniff } = require("../packages/adapters/prepare");
const dir = process.argv[2], dry = process.argv.includes("--dry"); if (!dir) { console.error("usage: node tools/eval-docs.js <folder> [--dry]"); process.exit(2); }
const rows = fs.readFileSync(path.join(dir, "truth.csv"), "utf8").trim().split(/\r?\n/).slice(1).map((l) => { const [file, form, year, recipient, payer, expect] = l.split(",").map((x) => x.trim()); return { file, form, year: +year, recipient, payer, expect }; });
(async () => {
  let ai = null; if (!dry) { const { anthropic } = require("../packages/adapters/anthropic"); ai = anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }); }
  const out = [];
  for (const r of rows) {
    const T = createEngine(), [first, ...rest] = r.recipient.split(" "); T.blank({ plan: "Practice", name: "Eval", now: new Date(2027, 0, 25, 10, 5), senderStatus: "approved" });
    T.importRows(T.parseCSV("First,Last,Email\nJo,Day,jo@x.example")); const c = T.S.clients[0], e = T.engOf(c.id); T.S.items = T.S.items.filter((i) => i.engId !== e.id); T.addItem(e.id, r.form === "OTHER" ? "W2" : r.form, r.expect === "accept" ? r.payer : ""); e.confirmed = true; T.start(e.id);
    const bytes = dry ? null : fs.readFileSync(path.join(dir, r.file)); let m = null;
    if (dry) m = { is_tax_document: r.form !== "OTHER", form: r.form, tax_year: r.expect === "reask" ? r.year - 1 : r.year, payer: r.payer, recipient_name: r.expect === "person" ? "Someone Else" : "Jo Day", legibility: 0.95, confidence: 0.97, missing_parts: [] };
    else { try { m = await ai.json(prompts.readDocument(T), { images: [bytes], contentType: sniff(bytes), tier: "default" }); } catch (err) { m = null; } }
    const truthName = r.expect === "person" && r.form !== "OTHER" ? r.recipient : "Jo Day";
    const spec = !m ? { form: "OTHER", year: 0, read: { legible: 0.9, conf: 0, note: "no answer", missing: [] } } : { form: m.is_tax_document === false ? "OTHER" : T.FORMS[m.form] ? m.form : "OTHER", year: +m.tax_year || 0, payer: m.payer || "", corrected: !!m.corrected, recipient: nameMatch(c, dry ? m.recipient_name : String(m.recipient_name || "").replace(new RegExp(truthName, "i"), "Jo Day")), read: { legible: +m.legibility || 0, conf: +m.confidence || 0, note: m.note || "", missing: [].concat(m.missing_parts || []) } };
    const d = T.inboundDoc(c.id, spec, "text"), got = d.state === "accepted" ? "accept" : d.state === "in_review" ? "person" : "reask";
    out.push(Object.assign({}, r, { got, readForm: m && m.form, readYear: m && m.tax_year, legible: m && m.legibility, sure: m && m.confidence }));
  }
  const good = out.filter((r) => r.expect === "accept"), bad = out.filter((r) => r.expect !== "accept"), wrong = bad.filter((r) => r.got === "accept"), needless = good.filter((r) => r.got !== "accept");
  console.log(out.length + " files" + (dry ? " (dry run: answers taken from truth.csv)" : ""));
  console.log("Wrong or unreadable documents accepted: " + wrong.length + " of " + bad.length + "   target 0, never above 1 in 100");
  console.log("Good documents not accepted first time: " + needless.length + " of " + good.length + "   target under 1 in 10");
  console.log("Form read correctly:                    " + out.filter((r) => r.readForm === r.form).length + " of " + out.length);
  [...wrong, ...needless].forEach((r) => console.log("  " + (r.expect === "accept" ? "MISSED " : "WRONG ACCEPT ") + r.file + ": expected " + r.expect + ", got " + r.got + " (read " + r.readForm + " " + r.readYear + ", legible " + r.legible + ", sure " + r.sure + ")"));
  fs.writeFileSync(path.join(dir, "results.csv"), "file,expect,got,readForm,readYear,legible,sure\n" + out.map((r) => [r.file, r.expect, r.got, r.readForm, r.readYear, r.legible, r.sure].join(",")).join("\n"));
  process.exit(wrong.length ? 1 : 0);
})();
