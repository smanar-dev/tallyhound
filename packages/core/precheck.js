// Checks that do not depend on the model. Two readers that work differently are far less likely to make the same mistake.
//
// 1. fromText: a PDF made by a payroll company, bank or broker carries its own text. The form number and the tax year can be
//    read from that text with plain rules. (A phone photo has no text layer; this does nothing for those.)
// 2. reconcile: when the rules and the model disagree on the form or the year, nobody is trusted and a person looks.
// 3. photoOk: a photo that is tiny, nearly black or badly blurred is not worth sending to the model at all.
const RULES = [
  ["W2", /\bform\s+w-?2\b|wage and tax statement/i], ["1099NEC", /1099-?nec|nonemployee compensation/i], ["1099MISC", /1099-?misc|miscellaneous information/i],
  ["1099INT", /1099-?int\b|interest income/i], ["1099DIV", /1099-?div\b|dividends and distributions/i], ["1099R", /1099-?r\b|distributions from pensions/i],
  ["1099K", /1099-?k\b|payment card and third party network/i], ["1099G", /1099-?g\b|certain government payments/i], ["SSA1099", /ssa-?1099|social security benefit statement/i],
  ["1098T", /1098-?t\b|tuition statement/i], ["1098E", /1098-?e\b|student loan interest statement/i], ["1098", /\bform\s+1098\b|mortgage interest statement/i],
  ["1095A", /1095-?a\b|health insurance marketplace statement/i], ["K1", /schedule\s+k-?1/i], ["PNL", /profit (and|&) loss|income statement/i], ["BALANCE_SHEET", /balance sheet/i], ["TRIAL_BALANCE", /trial balance|general ledger/i]
];
// A broker's combined statement names several 1099s on one cover page.
const CONSOLIDATED = /consolidated (form )?1099|composite (statement of )?1099|1099 composite|tax reporting statement|1099-?b\b/i;
function fromText(text, FORMS) {
  const t = String(text || "").replace(/\s+/g, " "); if (t.length < 40) return { form: null, year: null, corrected: false, chars: t.length };
  const head = t.slice(0, 6000), hits = RULES.filter((r) => r[1].test(head)).map((r) => r[0]);
  let form = null; if (CONSOLIDATED.test(head) || hits.filter((h) => /^1099(INT|DIV)$/.test(h)).length === 2) form = "1099CONS"; else if (hits.length === 1) form = hits[0]; else if (hits.length > 1) form = hits.includes("W2") && hits.length === 1 ? "W2" : null;
  if (form && FORMS && !FORMS[form]) form = null;
  // The tax year: "2026 Form W-2", "Tax year 2026", "For calendar year 2026". The most frequent plausible year near those words wins.
  const years = {}; (head.match(/(?:tax year|calendar year|for (?:the )?year|form [\w-]+\s*\(?|^|\s)(20[1-4]\d)\b/gi) || []).forEach((m) => { const y = +m.slice(-4); years[y] = (years[y] || 0) + (/(tax|calendar) year|for (the )?year/i.test(m) ? 3 : 1); });
  const best = Object.keys(years).sort((a, b) => years[b] - years[a])[0];
  return { form, year: best ? +best : null, corrected: /\bcorrected\b(?!\s*\(if checked\))|\bamended\b/i.test(head) && /[☒✔✗]|\[x\]|x corrected/i.test(head), chars: t.length, several: hits.length > 1 && !form };
}
// spec is what the model said, in the pipeline's shape. pre is fromText's answer, or null.
function reconcile(spec, pre) {
  if (!pre || (!pre.form && !pre.year)) return spec; const r = spec.read = spec.read || {}, clash = [];
  if (pre.form && spec.form !== "OTHER" && spec.form !== pre.form) clash.push("the form (" + pre.form + " in the file's own text)");
  if (pre.year && spec.year && pre.year !== spec.year) clash.push("the tax year (" + pre.year + " in the file's own text)");
  if (clash.length) { r.conf = Math.min(+r.conf || 0, 0.5); r.note = (r.note ? r.note + " " : "") + "Two readings disagree on " + clash.join(" and ") + ". A person should look."; r.by = "disagree"; return spec; }
  if (pre.form && spec.form === pre.form && (!pre.year || pre.year === spec.year)) r.by = "both";   // two independent readings agree
  if (pre.corrected) spec.corrected = true;
  return spec;
}
// m: { width, height, mean (0..255 average brightness), sharp (variance of the Laplacian, higher is sharper) } from the file preparation step.
function photoOk(m) {
  if (!m) return { ok: true }; if (m.width && m.height && Math.min(m.width, m.height) < 500) return { ok: false, why: "small" };
  if (m.mean != null && m.mean < 35) return { ok: false, why: "dark" }; if (m.mean != null && m.mean > 245) return { ok: false, why: "washed" };
  if (m.sharp != null && m.sharp < 40) return { ok: false, why: "blurry" }; return { ok: true };
}
module.exports = { fromText, reconcile, photoOk };
