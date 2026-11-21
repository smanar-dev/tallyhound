// What the screens show, worked out from the engine's state. These are lists and counts, never rules: a status, a check or a
// "may this be sent" always comes from an engine function. Ported from the demo (reference/artifact/ui.js) line for line.
import type { Engine } from "virtual:engine";

// The one list of what is waiting for a person lives beside the server, which uses the same list for the morning email.
import { needsYou, openTasks, type Need, type Row } from "../../../server/src/needs";
export { needsYou, openTasks, type Need, type Row };
export const draftsToApprove = (T: Engine): Row[] => T.S.msgs.filter((m: Row) => m.status === "approval");

// Why something is waiting, in the words a preparer would use.
const WHY: Record<string, string> = { "Low confidence": "Tallyhound was not sure what this is", "Client says none": "Says they don't have it", Question: "Asked a question", "Call the client": "A call to make", "Arrived after close": "Arrived after the file was closed", "Email after close": "Emailed after the file was closed", "File after close": "Sent a file after the file was closed" };
export const why = (t: Row): string => WHY[t.reason] || t.reason || "";
export function needReason(T: Engine, x: Need): string {
  if (x.t) return ({ document: "A document to check: " + why(x.t).toLowerCase(), question: "Asked a " + (x.t.category && x.t.category !== "other" ? String(T.SCOPE[x.t.category]).toLowerCase() : "question") + " that needs a person", says_none: "Says they don't have a document", gone_quiet: "Gone quiet: " + String(x.t.reason || "").replace(/^./, (ch) => ch.toLowerCase()), output_check: x.t.reason, call: "No reply to 4 reminders: call script ready" } as Record<string, string>)[x.t.kind] || why(x.t);
  if (x.checkin) return "Finished the check-in: " + x.e.checkin.adds.length + " to add, " + x.e.checkin.drops.length + " may no longer apply";
  if (x.suggest) return "Mentioned something new: a suggested document is waiting";
  return T.STUCK[x.stuck!][0];
}

const SENT: Record<string, string> = { M3: "a first request", M4: "the next request", M5: "a reminder", M6: "a final reminder", M13: "a thank-you: file complete", M7: "a wrong-year re-ask", M8: "a retake request", M22: "a request for the missing part", M22R: "a reminder for the missing part", M23: "one reply covering every attachment" };
export type Event =
  | { kind: "doc"; at: Date; c: Row; e: Row; d: Row }
  | { kind: "attachments"; at: Date; c: Row; e: Row; d?: Row; n: number; understood: string }
  | { kind: "reply"; at: Date; c: Row; e: Row; portal: boolean; quote: string }
  | { kind: "auto"; at: Date; c: Row; e: Row; g: string; tail: string; names: Row[] }
  | { kind: "manual"; at: Date; c: Row; e: Row; by: string };
/** The firm-wide feed, newest first. A burst of the same message to many clients becomes one line. */
export function activity(T: Engine, limit: number, engId?: string): Event[] {
  const s = T.S, ev: Event[] = [], docOf = (id: string) => s.docs.find((d: Row) => d.id === id);
  s.msgs.filter((m: Row) => !engId || m.engId === engId).forEach((m: Row) => {
    const e = m.engId ? T.eng(m.engId) : null, c = e ? T.client(e.clientId) : null; if (!c) return;
    if (m.dir === "in" && m.docId) { const d = docOf(m.docId); if (d) ev.push({ kind: "doc", at: m.at, c, e, d }); }
    else if (m.dir === "in" && (m.attachments || []).length) ev.push({ kind: "attachments", at: m.at, c, e, d: docOf(m.attachments[0]), n: m.attachments.length, understood: m.understood || "" });
    else if (m.dir === "in") ev.push({ kind: "reply", at: m.at, c, e, portal: m.channel === "portal", quote: String(m.body || "").slice(0, 80) });
    else if (m.kind === "auto" && SENT[m.tpl]) ev.push({ kind: "auto", at: m.at, c, e, g: m.tpl + m.channel, tail: SENT[m.tpl] + " by " + m.channel, names: [c] });
    else if (m.kind === "manual") ev.push({ kind: "manual", at: m.at, c, e, by: m.by || "Staff" });
  });
  ev.sort((a, b) => +b.at - +a.at);
  if (engId) return ev.slice(0, limit);
  const out: Event[] = [];
  for (const x of ev) { const p = out[out.length - 1]; if (x.kind === "auto" && p && p.kind === "auto" && p.g === x.g && Math.abs(+p.at - +x.at) < 30 * 60000) { p.names.push(x.c); continue; } out.push(x); }
  return out.slice(0, limit);
}
export const countBy = (T: Engine, status: string): number => T.S.engs.filter((e: Row) => e.status === status).length;

// The filters above the client list. "Needs you" is anyone waiting on a person, whatever their status.
export const PILLS: [string, string][] = [["all", "All"], ["attention", "Needs you"], ["in_progress", "Fetching"], ["awaiting_consent", "Waiting for OK to text"], ["not_started", "Ready to fetch"], ["complete", "All fetched"], ["other", "Paused or opted out"]];
export function inPill(T: Engine, e: Row, p: string, open: Row[] = openTasks(T)): boolean {
  return p === "all" || (p === "attention" ? e.status === "stuck" || open.some((t) => t.engId === e.id) : p === "other" ? ["paused", "opted_out", "closed"].includes(e.status) : e.status === p);
}
export const readyToStart = (T: Engine): Row[] => T.S.engs.filter((e: Row) => e.status === "not_started" && e.confirmed);
