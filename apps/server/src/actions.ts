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
  // The file is parsed again here, by the engine, from the text. The browser may say how to use each column and nothing else:
  // a column the engine marked sensitive (SSN, date of birth, fees) stays unread whatever the browser sends.
  importCsv: { role: "staff", n: 2, run: (T, [text, map]) => {
    const p = T.parseCSV(String(text || "")), FIELDS = ["", "first", "last", "email", "mobile", "preparer", "lang", "name", "tz", "ref", "docs", "entity", "rtype"];
    if (Array.isArray(map) && map.length === p.head.length) p.map = p.map.map((was: string, i: number) => ((p.sensitive || [])[i] ? "" : FIELDS.includes(map[i]) ? map[i] : was));
    return T.importRows(p); } },
  // checklist
  setItem: staff(3), addItem: staff(4), addRecommended: staff(2), dismissRec: staff(2), addFromPrior: staff(2), setCustomEs: staff(2),
  saveTemplate: staff(1), removeTemplate: staff(1), applyTemplate: staff(3), sendCheckin: staff(1), applyCheckin: staff(2), skipQuestions: staff(2), customSuggest: staff(3),
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
  // The Hound's schedule and memory, as the demo's Coming up list and client panel change them.
  sendNow: { role: "staff", n: 1, run: (T, [eid]) => { const e = T.eng(eid); if (!e || !e.next) return "Nothing is planned for this client"; if (!T.allowed(T.S.now)) return "It is outside sending hours. The Hound waits until they begin."; e.lastAutoDay = null; e.next = new Date(T.S.now); T.step(e); T.hlog(e, "decide", T.S.user.name + " sent the next message now", "A person asked for it from Coming up", "Rules"); return null; } },
  snooze: { role: "staff", n: 1, run: (T, [eid]) => { const e = T.eng(eid); if (!e || !e.next) return "Nothing is planned for this client"; e.next = T.nextAllowed(new Date(new Date(e.next).getTime() + T.DAY)); T.hlog(e, "decide", T.S.user.name + " put the next message off by a day", "A person asked for it from Coming up", "Rules"); return null; } },
  rememberNote: { role: "staff", n: 2, run: (T, [eid, text]) => { const e = T.eng(eid), t = String(text || "").replace(/[<>]/g, "").trim().slice(0, 200); if (!e || !t) return "Write a few words first"; T.remember(e, t, T.S.user.name); return null; } },
  setTarget: { role: "staff", n: 2, run: (T, [eid, day]) => { const e = T.eng(eid), m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(day || "")); if (!e) return "No such client"; e.target = m ? new Date(+m[1]!, +m[2]! - 1, +m[3]!, 17) : null; T.hlog(e, "decide", "Date the documents are needed by " + (e.target ? "set" : "cleared"), "The Hound follows up more often as the date gets close", "Rules"); return null; } },
  // How much the Hound does on its own. Owner only; every change is in the audit trail.
  setHound: { role: "owner", n: 1, run: (T, [v]) => {
    const H = T.S.firm.hound, x = (v && typeof v === "object" ? v : {}) as Record<string, unknown>, pick = <V,>(k: string, allowed: V[]) => { if (allowed.includes(x[k] as V) && H[k] !== x[k]) { H[k] = x[k]; changed.push(k); } }, changed: string[] = [];
    pick("mode", ["copilot", "autopilot"]); pick("tone", ["warm", "brief", "formal"]); pick("emailAfter", [1, 2, 3, 99]); pick("slaHours", [2, 4, 8, 24]); pick("pauseDays", [1, 2, 3, 5, 7]); pick("callTask", [true, false]); pick("aiWrite", [true, false]);
    if (changed.length) T.audit("settings.hound", "Changed: " + changed.join(", ") + (changed.includes("mode") ? ". Now on " + H.mode : "")); return changed; } },
  // check
  // Correcting what was read on a document that is already accepted, as the demo's viewer does: the old reading is kept as a version.
  correctDoc: { role: "staff", n: 2, run: (T, [id, v]) => {
    const d = T.S.docs.find((x: { id: string }) => x.id === id), f = (v && typeof v === "object" ? v : {}) as Record<string, unknown>; if (!d) return "No such document"; if (d.state !== "accepted") return "Only an accepted document can be corrected here";
    const form = String(f.form || ""); if (!Object.hasOwn(T.FORMS, form)) return "Choose a form from the list";
    Object.assign(d, { form, year: +(f.year as number) || d.year, payer: String(f.payer ?? "").replace(/[<>]/g, "").trim().slice(0, 80) });
    (d.versions = d.versions || []).push({ v: d.versions.length + 1, by: T.S.user.name, form: d.form, year: d.year, payer: d.payer }); T.audit("document.correct", d.form); return null; } },
  decideTask: staff(3), deliver: staff(1), closeEng: staff(1),
  // Unknown senders: a person says whose it is, and it is then checked exactly as if that client had sent it (the demo's assign).
  assignUnknown: { role: "staff", n: 2, run: (T, [yid, cid]) => {
    const S = T.S, y = S.tray.find((x: { id: string }) => x.id === yid), c = T.client(cid), e = c && T.engOf(c.id); if (!y) return { ok: false, why: "That message has already been dealt with" }; if (!c || !e) return { ok: false, why: "Choose a client" };
    if (!y.docId && !y.spec && (y.why === "Could not be processed" || y.why === "Blocked by the virus scan")) return { ok: false, why: "There is nothing in this notice to assign" };
    S.tray.splice(S.tray.indexOf(y), 1); let doc = null;
    if (y.docId) { doc = S.docs.find((d: { id: string }) => d.id === y.docId); if (doc) { doc.clientId = c.id; doc.engId = e.id; T.check(doc); T.decide(doc, e, c); } }
    else if (y.spec) doc = T.inboundDoc(c.id, y.spec, y.channel || "text"); else if (y.text) T.inboundText(c.id, y.text);
    T.audit("unknown.assigned", c.last); return { ok: true, first: c.first, state: doc ? doc.state : null }; } },
  // Discarding forgets the message. A file that came with it is marked discarded so it is deleted on the short schedule.
  discardUnknown: { role: "staff", n: 1, run: (T, [yid]) => { const S = T.S, y = S.tray.find((x: { id: string }) => x.id === yid); if (!y) return false; S.tray = S.tray.filter((x: { id: string }) => x.id !== yid); const d = y.docId && S.docs.find((x: { id: string }) => x.id === y.docId); if (d && !d.engId) d.state = "discarded"; T.audit("unknown.discarded", ""); return true; } },
  // alerts: read marks, exactly as the demo's bell sets them
  alertRead: { role: "staff", n: 1, run: (T, [id]) => { const a = (T.S.alerts || []).find((x: { id: string }) => x.id === id); if (a) a.read = true; return !!a; } },
  alertsRead: { role: "staff", n: 0, run: (T) => { (T.S.alerts || []).forEach((a: { read?: boolean }) => { a.read = true; }); return true; } },
  // the emergency stop is lifted by an owner
  resumeAll: { role: "owner", n: 0, run: (T) => { T.S.firm.stopped = false; T.audit("emergency.resume", "Messages resumed"); return true; } },
  // The firm's own details. The Tallyhound address is not editable: mail to it is how the firm is found.
  saveFirm: { role: "owner", n: 1, run: (T, [v]) => {
    const f = T.S.firm, x = (v && typeof v === "object" ? v : {}) as Record<string, unknown>, str = (k: string, max: number) => String(x[k] ?? "").replace(/[<>]/g, "").replace(/\s+/g, " ").trim().slice(0, max);
    f.name = str("name", 80) || f.name; f.sender = str("sender", 30) || f.sender; f.phone = str("phone", 20);
    const y = +(x.taxYear as number); if ([2025, 2026, 2027].includes(y)) f.taxYear = y;
    T.audit("settings.firm", "Firm details changed"); return null; } },
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
