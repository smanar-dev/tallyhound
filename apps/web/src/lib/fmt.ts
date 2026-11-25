// Small wording helpers, the same ones the demo uses, so dates and names read the same everywhere.
import type { Engine } from "virtual:engine";
export const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"], MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const tm = (d: Date) => { let h = d.getHours(); const m = d.getMinutes(), ap = h >= 12 ? "pm" : "am"; h = h % 12 || 12; return h + ":" + String(m).padStart(2, "0") + " " + ap; };
export const dshort = (d: Date) => MON[d.getMonth()] + " " + d.getDate();
export const dt = (d?: Date | null) => (d ? DOW[d.getDay()] + " " + dshort(d) + ", " + tm(d) : "");
const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();
export function when(T: Engine, d?: Date | null): string { if (!d) return ""; const n: Date = T.S.now; if (sameDay(d, n)) return "Today " + tm(d); if (sameDay(d, new Date(n.getTime() - T.DAY))) return "Yesterday " + tm(d); return dt(d); }
export function rel(T: Engine, d?: Date | null): string {
  if (!d) return "never"; const x = (T.S.now.getTime() - d.getTime()) / 36e5;
  if (x < 0) { const f = -x; return f < 1 ? "in " + Math.max(1, Math.round(f * 60)) + " min" : f < 24 ? "in " + Math.round(f) + " h" : dt(d); }
  if (x < 1) return Math.max(1, Math.round(x * 60)) + " min ago"; if (x < 24) return Math.round(x) + " h ago"; return Math.round(x / 24) + " d ago";
}
export const fmtDay = (d: Date) => MON[d.getMonth()] + " " + d.getDate();
export const plural = (n: number, one: string, many = one + "s") => n + " " + (n === 1 ? one : many);
export const phone = (m: unknown) => { const s = String(m || "").replace(/\D/g, ""); return s.length === 10 ? "(" + s.slice(0, 3) + ") " + s.slice(3, 6) + "-" + s.slice(6) : s; };
export const cname = (c: { first: string; last: string }) => c.first + " " + c.last;
export const fname = (T: Engine, form: string): string => (T.FORMS[form] || T.FORMS.OTHER).plain;
export const iname = (T: Engine, i: { custom?: string; form: string }) => i.custom || fname(T, i.form);
// The demo's avatar colours: the same person always gets the same colour.
const COLORS = ["#1E4637", "#4F5F57", "#7A4700", "#33485F", "#2C5A47", "#8A4A1E", "#3A5A4C", "#5E6C64"];   // brand darks: Paper initials pass on every one
const hash = (s: string) => { let x = 2166136261; for (const ch of String(s)) { x ^= ch.charCodeAt(0); x = Math.imul(x, 16777619); } return x >>> 0; };
export const colorOf = (first: string, last: string) => COLORS[hash(first + last) % COLORS.length]!;
// Status words, from docs/UX.md's vocabulary. Do not bring the old words back.
export const STAT: Record<string, [string, string]> = { not_started: ["Ready to fetch", ""], awaiting_consent: ["Waiting for OK to text", "info"], in_progress: ["Fetching", "info"], stuck: ["Needs you", "warn"], paused: ["Paused", ""], opted_out: ["Opted out", "bad"], complete: ["All fetched", "good"], closed: ["Closed", ""], off_season: ["Not this season", ""] };
export const DSTATE: Record<string, [string, string]> = { accepted: ["Passed the sniff test", "good"], rejected: ["Asked again", "bad"], in_review: ["Needs you", "warn"], duplicate: ["Duplicate", ""], discarded: ["Discarded", ""], tray: ["Unknown senders", "warn"], incomplete: ["Incomplete", "warn"], purged: ["Deleted", ""], classified: ["Sniffing", "info"], stored: ["Sniffing", "info"] };
export const ISTATE: Record<string, string> = { expected: "Not requested yet", requested: "Requested", partial: "Part received, chasing the rest", in_review: "Received, waiting for you", says_none: "Client says they don't have it", received: "Received", waived: "Not needed" };
/** v2 (docs/V2.md): an email-first firm. Letters by email, documents through the upload link, no texting on any screen. */
export const emailFirst = (T: Engine): boolean => !!(T && T.S && T.S.firm && T.S.firm.letters === true);
/** What to send when a draft is approved: the edited words, or nothing when it was left as written, so the engine sends its own
 *  copy. That matters for a letter: the copy in the browser has "(private link)" where the client's real link is. */
export const changed = (edit: string | undefined, body: string): string => (edit !== undefined && edit.trim() !== String(body || "").trim() ? edit.trim() : "");
/** The engine's log lines were first written for texting. For an email-first firm the few words that differ are said the email way. */
export const emWords = (t: string): string => String(t || "").replace(/\btexted\b/g, "wrote").replace(/\b(sending|quiet) hours\b/gi, "working days").replace(/\bby portal\b/g, "through the upload link").replace(/\ba text\b/g, "a message").replace(/\bby text\b/g, "by email").replace(/\btexts\b/g, "messages");
/** Where a firm's text number really stands. "With the carriers" is only true once the firm's legal details have been entered:
 *  choosing a plan marks a number as wanted, and that alone has filed nothing. */
export const senderState = (f: { senderStatus?: string; reg?: unknown }): "approved" | "filed" | "todo" => (f.senderStatus === "approved" ? "approved" : f.senderStatus === "submitted" && f.reg ? "filed" : "todo");
