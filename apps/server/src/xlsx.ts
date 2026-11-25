// A spreadsheet (XLSX) client list becomes CSV text on the server (docs/FETCH.md, "Import flow", step 1). Only the first sheet, only
// cell values: no formulas are run and nothing else in the file is read. An XLSX file is a zip of XML parts; fflate opens it.
import { unzipSync, strFromU8 } from "fflate";

export const XLSX_MAX_BYTES = 10 * 1024 * 1024, XLSX_MAX_ROWS = 2001;
const unxml = (s: string) => s.replace(/<[^>]+>/g, "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
const col = (ref: string) => { const m = /^([A-Z]+)/.exec(ref) || ["", "A"]; let n = 0; for (const ch of m[1]!) n = n * 26 + ch.charCodeAt(0) - 64; return n - 1; };
const csvCell = (v: string) => (/[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v);

/** CSV text from the first sheet, or an error in words. */
export function xlsxToCsv(bytes: Uint8Array): { csv?: string; error?: string } {
  if (bytes.length > XLSX_MAX_BYTES) return { error: "That spreadsheet is over 10 MB. Save it as CSV and try again" };
  let z: Record<string, Uint8Array>; try { z = unzipSync(bytes, { filter: (f) => /^xl\/(sharedStrings\.xml|workbook\.xml|worksheets\/sheet\d+\.xml|_rels\/workbook\.xml\.rels)$/.test(f.name) }); } catch { return { error: "That is not a spreadsheet Tallyhound can open. Save it as CSV and try again" }; }
  const shared = z["xl/sharedStrings.xml"] ? [...strFromU8(z["xl/sharedStrings.xml"]).matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => unxml((m[1]!.match(/<t[^>]*>[\s\S]*?<\/t>/g) || []).join(""))) : [];
  const sheets = Object.keys(z).filter((k) => /worksheets\/sheet\d+\.xml$/.test(k)).sort((a, b) => +/sheet(\d+)/.exec(a)![1]! - +/sheet(\d+)/.exec(b)![1]!); if (!sheets.length) return { error: "That spreadsheet has no sheet in it" };
  const rows: string[][] = [];
  for (const r of strFromU8(z[sheets[0]!]!).matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
    if (rows.length >= XLSX_MAX_ROWS) break; const out: string[] = [];
    for (const c of r[1]!.matchAll(/<c\s([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = c[1]!, body = c[2] || "", ref = /r="([A-Z]+\d+)"/.exec(attrs), t = /t="(\w+)"/.exec(attrs), v = /<v>([\s\S]*?)<\/v>/.exec(body), is = /<is>([\s\S]*?)<\/is>/.exec(body);
      const val = t && t[1] === "s" && v ? shared[+v[1]!] || "" : t && t[1] === "inlineStr" && is ? unxml(is[1]!) : v ? unxml(v[1]!) : "";
      const i = ref ? col(ref[1]!) : out.length; while (out.length < i) out.push(""); out[i] = val.trim();
    }
    if (out.some((x) => x)) rows.push(out);
  }
  if (!rows.length) return { error: "That spreadsheet is empty" };
  return { csv: rows.map((r) => r.map(csvCell).join(",")).join("\n") };
}
