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
  // Editing a client's details, as the demo's Details tab does it. A changed mobile number is a new number: any OK to text is reset
  // and a wrong-number flag is cleared (spec TH-CON-9). The language is not editable here while Spanish is off for pilots.
  saveClient: { role: "staff", n: 2, run: (T, [cid, v]) => {
    const c = T.client(cid), f = (v && typeof v === "object" ? v : {}) as Record<string, unknown>, str = (k: string, max: number) => String(f[k] ?? "").replace(/[<>]/g, "").trim().slice(0, max); if (!c) return "No such client";
    c.first = str("first", 60) || c.first; c.last = str("last", 60) || c.last;
    const mobile = String(f.mobile ?? "").replace(/\D/g, "").slice(-10);
    if (mobile !== c.mobile) { c.mobileBad = false; if (c.textConsent === "given") { c.textConsent = "none"; c.consentLog.push({ at: new Date(T.S.now), what: "Reset: the mobile number was changed", channel: "text" }); } }
    c.mobile = mobile; c.email = str("email", 254); c.notes = String(f.notes ?? "").slice(0, 4000);
    if (T.S.users.some((u: { id: string; role: string }) => u.id === f.preparer && u.role !== "read_only")) c.preparer = f.preparer;
    const tz = String(f.tz ?? ""); if ((c.tz || "") !== tz && (tz === "" || Object.hasOwn(T.ZNAME, tz))) T.setZone(c.id, tz);
    T.audit("client.edit", c.last); return null; } },
  // Confirming a checklist is the firm saying "this list is right". The demo sets the same flag and writes the same two records.
  confirmChecklist: { role: "staff", n: 1, run: (T, [eid]) => { const e = T.eng(eid); if (!e) return "No such client"; if (e.confirmed) return "Already confirmed"; e.confirmed = true; T.timeline(e, "Checklist confirmed", T.S.user.name); T.audit("checklist.confirm", T.client(e.clientId).last); return null; } },
  // Start collecting for many clients in one turn, then let the first messages go, as the demo's wizard does.
  startMany: { role: "staff", n: 1, run: (T, [ids]) => { let started = 0, capped = 0; const refused: string[] = []; for (const id of Array.isArray(ids) ? ids.slice(0, 5000) : []) { if (!T.eng(id)) continue; const r = T.start(id); if (!r) started++; else if (/free trial/.test(r)) capped++; else refused.push(r); } T.tick(); return { started, capped, refused: [...new Set(refused)] }; } },
  // chase
  start: staff(1), pause: staff(1), resume: staff(1), takeover: staff(2), handback: staff(2), approveMsg: staff(2), rejectMsg: staff(1), manual: staff(2), markHeadsUp: staff(1),
  // check
  decideTask: staff(3), deliver: staff(1), closeEng: staff(1),
  // alerts: read marks, exactly as the demo's bell sets them
  alertRead: { role: "staff", n: 1, run: (T, [id]) => { const a = (T.S.alerts || []).find((x: { id: string }) => x.id === id); if (a) a.read = true; return !!a; } },
  alertsRead: { role: "staff", n: 0, run: (T) => { (T.S.alerts || []).forEach((a: { read?: boolean }) => { a.read = true; }); return true; } },
  // the emergency stop is lifted by an owner
  resumeAll: { role: "owner", n: 0, run: (T) => { T.S.firm.stopped = false; T.audit("emergency.resume", "Messages resumed"); return true; } },
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
