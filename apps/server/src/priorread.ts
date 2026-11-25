// The two cases the reader's rules cannot settle (docs/FETCH.md, "Reading prior-year data", steps 2 and 7):
//   a file with no text layer (a scan), and a readable file where the rules found nothing.
// The page pictures go to the model, which may answer only with names from fixed lists: a catalog form code with a payer name, a
// schedule from the reader's list, and the recipient's name. Anything else in its answer is thrown away, every number is stripped,
// and the record is marked for a person to confirm before it can shape a fetch list. The file itself is never stored.
import { stripNumbers, type Finding, type ReadResult } from "./reader.ts";

export const MODEL_MAX_PAGES = 12;
export const SCHEDULE_NAMES = ["Schedule A", "Schedule B", "Schedule C", "Schedule D", "Form 8949", "Schedule E", "Form 8863", "Form 2441", "Form 8962", "Form 8889", "Form 4797", "Schedule SE", "Schedule 1-A"];
export const LINE_NAMES = ["wages", "estimated payments", "car loan interest", "tips", "overtime", "senior deduction"];
export interface ModelReadDeps { render(pdf: Buffer): Promise<Buffer[] | null>; ask(firmId: string, prompt: string, images: Buffer[]): Promise<Record<string, unknown> | null>; forms: string[] }

export function findingsPrompt(forms: string[]): string {
  return "The images are pages of last year's tax records for one household: an organizer, a return, or source documents such as W-2s and 1099s. " +
    "Say only which forms, schedules and payers appear. Never write a number, an amount, an account number or an identification number. " +
    'Answer with JSON only: {"kind": "organizer" | "return" | "source_doc" | "unknown", "payers": [{"form": one of ' + JSON.stringify(forms) + ', "payer": the issuer\'s name in words, "page": page number}], ' +
    '"schedules": [one of ' + JSON.stringify(SCHEDULE_NAMES) + '], "lines": [one of ' + JSON.stringify(LINE_NAMES) + ' that has an entry], "recipient": the taxpayer\'s name in words or null}.';
}
const name = (v: unknown) => stripNumbers(String(v ?? "")).replace(/[^A-Za-z0-9&.,' -]/g, " ").replace(/\s+/g, " ").trim().slice(0, 60);

/** Reads a scan or an unread file with the model. The result is a record "by model" or "by ocr": a person must confirm it. */
export async function readWithModel(d: ModelReadDeps, firmId: string, pdf: Buffer, why: "unreadable" | "nothing_found"): Promise<ReadResult & { by: "ocr" | "model" }> {
  const none = { kind: "unknown" as const, status: why === "unreadable" ? ("unreadable" as const) : ("nothing_found" as const), findings: [], pages: 0, by: why === "unreadable" ? ("ocr" as const) : ("model" as const) };
  const pages = ((await d.render(pdf)) || [pdf]).filter((p) => p.length).slice(0, MODEL_MAX_PAGES); if (!pages.length) return none;
  const out = await d.ask(firmId, findingsPrompt(d.forms), pages); if (!out) return none;
  const f: Finding[] = [], kind = ["organizer", "return", "source_doc"].includes(String(out.kind)) ? (out.kind as ReadResult["kind"]) : "unknown", src = kind === "organizer" ? "organizer" : kind === "return" ? "return" : "doc";
  for (const p of Array.isArray(out.payers) ? out.payers.slice(0, 60) : []) { const x = (p && typeof p === "object" ? p : {}) as Record<string, unknown>, form = String(x.form || ""); if (!d.forms.includes(form) || form === "OTHER") continue; f.push({ kind: "payer", src, form, payer: name(x.payer) || undefined, page: Number.isInteger(x.page) ? (x.page as number) : undefined, text: "Read by the model" }); }
  for (const s of Array.isArray(out.schedules) ? out.schedules : []) if (SCHEDULE_NAMES.includes(String(s))) f.push({ kind: "schedule", src: "return", value: String(s), text: "Read by the model" });
  for (const s of Array.isArray(out.lines) ? out.lines : []) if (LINE_NAMES.includes(String(s))) f.push({ kind: "line", src: "return", value: String(s), text: "Read by the model" });
  const who = name(out.recipient); if (who) f.push({ kind: "recipient", src, recipient: who });
  return { kind, status: "read", findings: f, pages: pages.length, by: why === "unreadable" ? "ocr" : "model" };
}
