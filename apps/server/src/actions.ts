// What a signed-in staff member may ask the engine to do, by name. Every entry is an engine function the demo's screens call.
// Anything not listed here cannot be reached from a browser: the demo's clock controls (advance, jumpToNext, reset), the
// client's own actions (giveConsent, checkinDone, portalNone, clientAnswers), and Tallyhound's internal switches (setVerified, registerSender).
//   role: who may call it, as the demo's can() decides.   n: how many arguments are passed through; extra ones are dropped.
import type { Engine, Role } from "./kit.ts";

type Rule = { role: "staff" | "owner"; n: number; run?: (T: Engine, args: unknown[]) => unknown };
const staff = (n: number): Rule => ({ role: "staff", n }), owner = (n: number): Rule => ({ role: "owner", n });

export const ACTIONS: Record<string, Rule> = {
  // client list
  addClient: staff(1), setZone: staff(2), setFact: staff(3), recordConsent: staff(2),
  importCsv: { role: "staff", n: 1, run: (T, [text]) => T.importRows(T.parseCSV(String(text || ""))) },
  // checklist
  setItem: staff(3), addItem: staff(4), addRecommended: staff(2), dismissRec: staff(2), addFromPrior: staff(2), setCustomEs: staff(2),
  saveTemplate: staff(1), removeTemplate: staff(1), applyTemplate: staff(3), sendCheckin: staff(1), applyCheckin: staff(2), skipQuestions: staff(2),
  // chase
  start: staff(1), pause: staff(1), resume: staff(1), takeover: staff(2), handback: staff(2), approveMsg: staff(2), rejectMsg: staff(1), manual: staff(2), markHeadsUp: staff(1),
  // check
  decideTask: staff(3), deliver: staff(1), closeEng: staff(1),
  // owner only: how long data is kept, deleting copies, ending a pause
  setRetain: owner(2), deleteDocsNow: owner(1), purge: owner(1), resumeNow: owner(0)
};

export function allowed(role: Role, name: string): "ok" | "unknown" | "forbidden" {
  const a = Object.hasOwn(ACTIONS, name) ? ACTIONS[name] : undefined; if (!a) return "unknown";
  if (role === "read_only") return "forbidden"; return a.role === "owner" && role !== "owner" ? "forbidden" : "ok";
}
export function run(T: Engine, name: string, args: unknown[]): unknown {
  const a = ACTIONS[name]!, list = (Array.isArray(args) ? args : []).slice(0, a.n);
  const out = a.run ? a.run(T, list) : T[name](...list);
  try { return out === undefined ? null : JSON.parse(JSON.stringify(out)); } catch { return null; }   // some engine results point back into state
}
