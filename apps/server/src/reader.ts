// Reading last year's records (docs/FETCH.md, "Reading prior-year data"). One question per file: which forms, schedules and payers
// are there. It returns names and yes-or-no answers, never a number.
//
// It runs in two places with the same code: in the firm's browser (the default), so the file never leaves the firm's computer and
// only the findings are sent; and on the server, where the file is held in memory for the length of the request and then gone.
//
//   1. Text per page (a PDF's own text layer). No text layer: "unreadable", and a person decides (the OCR path).
//   2. Every number longer than four digits, and every token next to a $ sign, is dropped before anything else looks at the text.
//      The one exception is the line check ("has an entry"), which looks only at whether a line carries a figure, and keeps none.
//   3. Each page is classified on its own: a return page, an organizer page, or a source document (a W-2 or 1099 attached to a
//      return is read as the document it is).
//   4. Findings carry their evidence: the page and the few words matched.
// No model is used here. A readable file where the rules find nothing is reported as "nothing_found", for a person or the server's
// model fallback to look at.
export type Src = "organizer" | "doc" | "return";
export interface Finding { kind: "payer" | "schedule" | "line" | "recipient" | "year"; src: Src; form?: string; payer?: string; value?: string; recipient?: string; page?: number; text?: string }
export interface ReadResult { kind: "organizer" | "return" | "source_doc" | "unknown"; status: "read" | "unreadable" | "nothing_found"; findings: Finding[]; pages: number }

/** Drops every token next to a $ sign and every number longer than four digits. What is left can be stored. */
export function stripNumbers(t: string): string {
  // A number split by single spaces, dots or hyphens (an SSN typed "123 45 6789") counts as one number.
  return String(t || "").replace(/\$\s*[\d,.]+|[\d,.]*\d\s*\$/g, " ").replace(/(?<![\d,.])\d{2,}(?:[ .,-]\d+)+/g, (m) => (m.replace(/\D/g, "").length > 4 ? " " : m)).split(/(\s+)/).map((w) => (w.replace(/\D/g, "").length > 4 ? "" : w)).join("").replace(/[ \t]+/g, " ").trim();
}
const clean = (t: string) => stripNumbers(t).replace(/[\s:;,.|_-]+$/, "").replace(/^[\s:;,.|_-]+/, "").replace(/\s{2,}/g, " ").trim();

// The forms, as their own titles name them, and the code each is in the catalog.
const TITLES: [RegExp, string][] = [
  [/\bform\s*w-?2g\b|certain gambling winnings/i, "W2G"], [/\bw-?2\b.*wage and tax statement|wage and tax statement/i, "W2"], [/\b1099-?int\b|interest income/i, "1099INT"], [/\b1099-?div\b|dividends and distributions/i, "1099DIV"],
  [/\b1099-?da\b|digital asset proceeds/i, "1099DA"], [/\b1099-?b\b|proceeds from broker/i, "1099B"], [/\b1099-?r\b|distributions from pensions/i, "1099R"], [/\bssa-?1099\b|social security benefit statement/i, "SSA1099"],
  [/\b1099-?g\b|certain government payments/i, "1099G"], [/\b1099-?nec\b|nonemployee compensation/i, "1099NEC"], [/\b1099-?misc\b|miscellaneous information/i, "1099MISC"], [/\b1099-?k\b|payment card and third party network/i, "1099K"],
  [/\b1099-?s\b|proceeds from real estate/i, "1099S"], [/\b1099-?sa\b|distributions from an hsa/i, "1099SA"], [/\b1098-?vli\b|vehicle loan interest/i, "1098VLI"], [/\b1098-?t\b|tuition statement/i, "1098T"], [/\b1098-?e\b|student loan interest statement/i, "1098E"],
  [/\b1098\b(?!-)|mortgage interest statement/i, "1098"], [/\b1095-?a\b|health insurance marketplace statement/i, "1095A"], [/schedule k-?1\b|\bk-?1\b.*(partner|shareholder|beneficiar)/i, "K1"]
];
// The same codes as an organizer prints them at the start of a payer line.
const CODE = /^(?:form\s+)?(W-?2G|W-?2|1099-?(?:INT|DIV|DA|B|R|G|NEC|MISC|K|S|SA)|SSA-?1099|1098-?(?:VLI|T|E)|1098|1095-?A|(?:schedule\s+)?K-?1)\b[\s:.-]*(.*)$/i;
const codeOf = (raw: string): string | null => { const c = raw.toUpperCase().replace(/^SCHEDULE\s+/, "").replace(/-/g, ""); return c === "W2" || c === "W2G" ? c : c === "SSA1099" ? "SSA1099" : c === "K1" ? "K1" : /^(1099|1098|1095)[A-Z]*$/.test(c) ? c : null; };
// Schedules and forms on a return, by their titles.
const SCHEDULES: [string, RegExp][] = [
  ["Schedule A", /schedule a\b[^\n]{0,30}(itemized deductions)?|itemized deductions/i], ["Schedule B", /schedule b\b[^\n]{0,40}(interest|dividends)|interest and ordinary dividends/i],
  ["Schedule C", /schedule c\b[^\n]{0,40}(profit|loss|business)|profit or loss from business/i], ["Schedule D", /schedule d\b[^\n]{0,40}capital gains|capital gains and losses/i],
  ["Form 8949", /\bform 8949\b|sales and other dispositions of capital assets/i], ["Schedule E", /schedule e\b[^\n]{0,40}supplemental|supplemental income and loss/i],
  ["Form 8863", /\bform 8863\b|education credits/i], ["Form 2441", /\bform 2441\b|child and dependent care expenses/i], ["Form 8962", /\bform 8962\b|premium tax credit/i],
  ["Form 8889", /\bform 8889\b|health savings accounts/i], ["Form 4797", /\bform 4797\b|sales of business property/i], ["Schedule SE", /schedule se\b|self-employment tax/i], ["Schedule 1-A", /schedule 1-?a\b/i]
];
// Lines whose only question is "is anything entered here". The line must carry a figure on the raw page; the figure is not kept.
const LINES: [string, RegExp][] = [["wages", /wages, salaries, tips|total amount from forms? w-?2/i], ["estimated payments", /estimated tax payments/i], ["car loan interest", /(passenger )?vehicle loan interest|car loan interest/i], ["tips", /qualified tips/i], ["overtime", /qualified overtime/i], ["senior deduction", /deduction for seniors|senior deduction/i]];
// A figure is a number with a thousands comma, cents, or three digits or more at the end of the line: "box 1" is not a figure.
const hasFigure = (raw: string) => /(\d{1,3}(,\d{3})+|\d{3,}|\d+\.\d\d)\s*$/.test(raw.trim()) && !/^\s*\d+[a-z]?\s*$/.test(raw.trim());

/** Reads a file from the text of its pages. Pure: the same answer in a browser and on the server. */
export function readPages(pages: string[]): ReadResult {
  const findings: Finding[] = [], kinds = new Set<string>(), seen = new Set<string>();
  const add = (f: Finding) => { const k = [f.kind, f.form, f.payer, f.value, f.recipient].join("|"); if (seen.has(k)) return; seen.add(k); findings.push(f); };
  pages.forEach((raw, i) => {
    const page = i + 1, lines = String(raw || "").split(/\n/), text = stripNumbers(raw), top = lines.slice(0, 6).join(" ");
    if (/tax organizer|organizer\b|prior year (information|summary)/i.test(top)) { kinds.add("organizer"); organizer(lines, page, add); return; }
    const isReturn = /\bform 1040\b|u\.s\. individual income tax return/i.test(text) || SCHEDULES.some(([, re]) => re.test(top) && /\(form 1040\)|attach to form 1040|form 1040/i.test(text));
    const title = !isReturn ? TITLES.find(([re]) => re.test(top) || re.test(text.slice(0, 400))) : null;
    if (title) { kinds.add("source_doc"); sourceDoc(lines, page, title[1], add); return; }
    if (isReturn) { kinds.add("return"); returnPage(lines, raw, page, add); }
  });
  const kind = kinds.has("organizer") ? "organizer" : kinds.has("return") ? "return" : kinds.has("source_doc") ? "source_doc" : "unknown";
  const any = pages.some((p) => String(p || "").replace(/\s/g, "").length > 20);
  return { kind, status: !any ? "unreadable" : findings.some((f) => f.kind !== "recipient" && f.kind !== "year") ? "read" : "nothing_found", findings, pages: pages.length };
}
function organizer(lines: string[], page: number, add: (f: Finding) => void) {
  // Whose organizer: "Prior Year Summary for Garcia, Maria and Daniel", or "Client: Maria Garcia". Used only to find the right client.
  const head = lines.slice(0, 6).map(clean).join(" "), who = /(?:summary for|prepared for|client:?|taxpayer:?)\s+([A-Za-z'][A-Za-z' -]+(?:,\s*[A-Za-z' -]+)?)/i.exec(head);
  if (who) add({ kind: "recipient", src: "organizer", recipient: who[1]!.replace(/\s+(client id|id|ssn)\b.*$/i, "").trim().slice(0, 60), page });
  for (const l of lines) {
    const m = CODE.exec(clean(l)); if (m) { const form = codeOf(m[1]!), payer = clean(m[2] || "").replace(/^(from|payer|employer)\s+/i, ""); if (form && payer && /[A-Za-z]{2}/.test(payer)) add({ kind: "payer", src: "organizer", form, payer: payer.slice(0, 60), page, text: clean(l).slice(0, 80) }); continue; }
    for (const [name, re] of SCHEDULES) if (re.test(l) && /^(schedule|form)\b/i.test(clean(l))) add({ kind: "schedule", src: "organizer", value: name, page, text: clean(l).slice(0, 80) });
  }
}
const LABELS = /employer'?s name|payer'?s name|filer'?s name|lender'?s name|recipient'?s\/lender'?s name|trustee'?s name|issuer'?s name|partnership'?s name|corporation'?s name|transferor'?s name|broker'?s name|filer'?s|payer'?s/i;
const WHO = /employee'?s (first )?name|recipient'?s name|payer'?s\/borrower'?s name|borrower'?s name|student'?s name|partner'?s name|shareholder'?s name|beneficiary'?s name/i;
function nameAfter(lines: string[], re: RegExp): string | null {
  for (let i = 0; i < lines.length; i++) {
    if (!re.test(lines[i]!)) continue; const rest = clean(lines[i]!.replace(new RegExp("^.*?(" + re.source + ")[^A-Za-z]*", "i"), "")).replace(/^(and )?(address|street address|city|including).*$/i, "");
    if (rest && /[A-Za-z]{3}/.test(rest) && !LABELS.test(rest) && !WHO.test(rest) && !/\b(name|initial|address|street|city|zip|town|province|country|telephone)\b/i.test(rest)) return rest.slice(0, 60);
    for (let j = i + 1; j < Math.min(lines.length, i + 4); j++) { const n = clean(lines[j]!); if (n && /[A-Za-z]{3}/.test(n) && !LABELS.test(n) && !WHO.test(n) && !/^(street|city|address|telephone|tin|ein|ssn|box|copy|omb)/i.test(n)) return n.slice(0, 60); }
  }
  return null;
}
function sourceDoc(lines: string[], page: number, form: string, add: (f: Finding) => void) {
  const payer = form === "SSA1099" ? "Social Security Administration" : nameAfter(lines, LABELS), who = nameAfter(lines, WHO), yr = /\b(20\d\d)\b/.exec(lines.slice(0, 8).join(" "));
  add({ kind: "payer", src: "doc", form, payer: payer || undefined, page, text: clean(lines.find((l) => TITLES.some(([re]) => re.test(l))) || lines[0] || "").slice(0, 80) });
  if (who) add({ kind: "recipient", src: "doc", recipient: who, page }); if (yr) add({ kind: "year", src: "doc", value: yr[1], page });
}
function returnPage(lines: string[], raw: string, page: number, add: (f: Finding) => void) {
  const top = lines.slice(0, 8).join(" ");
  for (const [name, re] of SCHEDULES) if (re.test(top) || (name.startsWith("Form") && re.test(raw.slice(0, 600)))) add({ kind: "schedule", src: "return", value: name, page, text: clean((lines.find((l) => re.test(l)) || "")).slice(0, 80) });
  for (const l of lines) for (const [name, re] of LINES) if (re.test(l) && hasFigure(l)) add({ kind: "line", src: "return", value: name, page, text: clean(l.replace(/[\d,.$]+\s*$/, "")).slice(0, 80) });
  // Schedule B names each payer of interest (part I) and dividends (part II) on its own line.
  if (/schedule b\b/i.test(top)) {
    let part: string | null = null;
    for (const l of lines) {
      if (/part i\b(?!i)|interest\b.*list name of payer/i.test(l)) { part = "1099INT"; continue; } if (/part ii\b|ordinary dividends\b.*list name/i.test(l)) { part = "1099DIV"; continue; } if (/part iii|add the amounts|^\s*total/i.test(l)) { if (/part iii/i.test(l)) part = null; continue; }
      const n = clean(l.replace(/[\d,.$]+\s*$/, "")); if (part && hasFigure(l) && /[A-Za-z]{3}/.test(n) && !/list name|amount|note|see instructions|line \d/i.test(n)) add({ kind: "payer", src: "return", form: part, payer: n.slice(0, 60), page, text: n.slice(0, 80) });
    }
  }
}
/** Reads a PDF's text layer and then the pages. Works in a browser and in Node (unpdf bundles pdf.js for both). */
export async function readPdf(bytes: Uint8Array, maxPages = 60): Promise<ReadResult> {
  try {
    const { extractText, getDocumentProxy } = await import("unpdf"), doc = await getDocumentProxy(bytes), r = await extractText(doc, { mergePages: false });
    return readPages((r.text as string[]).slice(0, maxPages));
  } catch { return { kind: "unknown", status: "unreadable", findings: [], pages: 0 }; }
}
/** Guesses whose file this is from its name: a client ID, or a last name, among the import's rows. */
export function matchFile(name: string, rows: { key: string; ref?: string; last?: string; first?: string }[], recipient?: string | null): string | null {
  const n = " " + String(name || "").toLowerCase().replace(/[_.-]+/g, " ") + " ";
  const byRef = rows.filter((r) => r.ref && n.includes(" " + r.ref.toLowerCase() + " ")); if (byRef.length === 1) return byRef[0]!.key;
  if (recipient) { const w = recipient.toLowerCase(); const byName = rows.filter((r) => r.last && w.includes(r.last.toLowerCase()) && (!r.first || w.includes(r.first.toLowerCase()))); if (byName.length === 1) return byName[0]!.key; }
  const byLast = rows.filter((r) => r.last && r.last.length > 2 && n.includes(" " + r.last.toLowerCase() + " ") && (!r.first || n.includes(r.first.toLowerCase()))); return byLast.length === 1 ? byLast[0]!.key : null;
}
