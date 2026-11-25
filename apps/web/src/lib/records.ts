// Reading last year's records (docs/FETCH.md). By default the file is read here, in the firm's browser, with the same reader the
// server uses (apps/server/src/reader.ts), so the file never leaves the firm's computer: only the findings are sent, and those carry
// names and yes-or-no answers, never a number. The reader is loaded only when a file is chosen.
import type { ReadResult } from "../../../server/src/reader";

export type { ReadResult };
export const MAX_PDF = 25 * 1024 * 1024;
export async function readInBrowser(file: File): Promise<ReadResult> {
  const { readPdf } = await import("../../../server/src/reader");
  return readPdf(new Uint8Array(await file.arrayBuffer()));
}
/** What one file gave, in a few words, for the list of files read. */
export function foundWords(r: { kind: string; status: string; findings?: unknown[]; found?: number }): string {
  const n = r.findings ? (r.findings as { kind?: string }[]).filter((f) => f.kind !== "recipient" && f.kind !== "year").length : r.found || 0, kind = KIND[r.kind] || "File";
  if (r.status === "unreadable") return "Could not be read: it may be a scan. A person checks it";
  if (r.status === "nothing_found") return kind + ": nothing the rules know was found. A person checks it";
  if (r.status === "needs_person") return kind + ": read by the model. A person confirms it";
  return kind + ": " + n + (n === 1 ? " thing found" : " things found");
}
export const KIND: Record<string, string> = { organizer: "Organizer", return: "Return", source_doc: "Tax document", unknown: "File" };
export const RECORD_STATUS: Record<string, [string, string]> = { read: ["Read", "good"], confirmed: ["Confirmed", "good"], unreadable: ["Could not be read", "warn"], nothing_found: ["Nothing found", "warn"], needs_person: ["A person confirms it", "warn"] };
