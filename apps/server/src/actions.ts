// What a signed-in staff member may ask the engine to do, by name. Every entry is an engine function the demo's screens call.
// Anything not listed here cannot be reached from a browser: the demo's clock controls (advance, jumpToNext, reset), the
// client's own actions (giveConsent, checkinDone, portalNone, clientAnswers), and Tallyhound's internal switch (setVerified). An owner may file the firm's details for a text number (registerSender); only Tallyhound can record that the carriers approved it.
//   role: who may call it, as the demo's can() decides.   n: how many arguments are passed through; extra ones are dropped.
import type { Engine, Role } from "./kit.ts";

type Rule = { role: "staff" | "owner"; n: number; run?: (T: Engine, args: unknown[]) => unknown };
const staff = (n: number): Rule => ({ role: "staff", n }), owner = (n: number): Rule => ({ role: "owner", n });

export const ACTIONS: Record<string, Rule> = {
  // client list
  addClient: staff(1), setZone: staff(2), setFact: staff(3),
  // T-46: whether staff may give Tallyhound a client's prior-year return to build a checklist from. Off for every firm. The return is never stored.
  setPriorReturn: { role: "owner", n: 1, run: (T, [on]) => { T.S.firm.priorReturn = on === true; T.audit("settings.prior", on === true ? "Staff may build a checklist from last year's return" : "Building a checklist from last year's return switched off"); return null; } },
  // T-145: staff may record consent the firm already holds (a signed letter, an intake form) only once an owner has switched that on.
  // It is off for every new firm. The switch is not on any screen until counsel has approved its use; an owner's request reaches it here.
  recordConsent: { role: "staff", n: 2, run: (T, [cid, how]) => (T.S.firm.staffConsent === true ? T.recordConsent(cid, String(how ?? "").replace(/[<>]/g, "").trim().slice(0, 200)) : "An owner has not switched on recording consent for clients. The client can agree on their own page.") },
  setStaffConsent: { role: "owner", n: 1, run: (T, [on]) => { T.S.firm.staffConsent = on === true; T.audit("settings.consent", on === true ? "Staff may record consent the firm already holds" : "Staff may no longer record consent"); return null; } },
  // The file is parsed again here, by the engine, from the text. The browser may say how to use each column and nothing else:
  // a column the engine marked sensitive (SSN, date of birth, fees) stays unread whatever the browser sends.
  importCsv: { role: "staff", n: 2, run: (T, [text, map]) => {
    const p = T.parseCSV(String(text || "")), FIELDS = ["", "first", "last", "email", "mobile", "preparer", "lang", "name", "tz", "ref", "docs", "entity", "rtype"];
    if (Array.isArray(map) && map.length === p.head.length) p.map = p.map.map((was: string, i: number) => ((p.sensitive || [])[i] ? "" : FIELDS.includes(map[i]) ? map[i] : was));
    return T.importRows(p); } },
  // Client import and fetch lists (docs/FETCH.md). The browser sends the CSV text, its own reading of last year's files (findings
  // only: the engine strips numbers again), and the firm's decisions. Every one is checked by the engine.
  importBegin: { role: "staff", n: 2, run: (T, [name, text]) => T.importBegin(String(name || "").slice(0, 120), String(text || "").slice(0, 4 * 1024 * 1024)) },
  importMap: { role: "staff", n: 2, run: (T, [bid, map]) => T.importMap(String(bid || ""), Array.isArray(map) ? map.slice(0, 200).map(String) : null) },
  importDecide: { role: "staff", n: 3, run: (T, [bid, n, choice]) => T.importDecide(String(bid || ""), Number(n), String(choice || "")) },
  importRecord: { role: "staff", n: 3, run: (T, [bid, rec, n]) => { const r = (rec && typeof rec === "object" ? rec : {}) as Record<string, unknown>; return T.importRecord(String(bid || ""), { file: String(r.file || "").slice(0, 200), kind: String(r.kind || "unknown"), status: String(r.status || "read"), by: "rules", where: r.where === "server" ? "server" : "browser", findings: Array.isArray(r.findings) ? r.findings.slice(0, 200) : [] }, n ? Number(n) : null); } },
  importPlace: { role: "staff", n: 3, run: (T, [bid, tid, n]) => T.importPlace(String(bid || ""), String(tid || ""), Number(n)) },
  importBuild: { role: "staff", n: 1, run: (T, [bid]) => T.importBuild(String(bid || "")) },
  importApprove: { role: "staff", n: 2, run: (T, [bid, which]) => T.importApprove(String(bid || ""), which === "all" ? "all" : "ready") },
  importView: { role: "staff", n: 1, run: (T, [bid]) => T.importView(String(bid || "")) },
  importsOpen: { role: "staff", n: 0, run: (T) => T.importsOpen() },
  buildList: { role: "staff", n: 1, run: (T, [eid]) => T.buildList(String(eid || "")) },
  tickItem: { role: "staff", n: 2, run: (T, [iid, on]) => T.tickItem(String(iid || ""), on === true) },
  setIssuer: { role: "staff", n: 2, run: (T, [iid, v]) => T.setIssuer(String(iid || ""), String(v ?? "").slice(0, 80)) },
  addCatalogItem: { role: "staff", n: 3, run: (T, [eid, code, v]) => T.addCatalogItem(String(eid || ""), String(code || ""), String(v ?? "").slice(0, 80)) },
  itemNeeded: { role: "staff", n: 3, run: (T, [iid, on, why]) => T.itemNeeded(String(iid || ""), on === true, String(why || "")) },
  approveList: { role: "staff", n: 1, run: (T, [eid]) => T.approveList(String(eid || "")) },
  approveReady: { role: "staff", n: 0, run: (T) => T.approveReady() },
  setSeason: { role: "staff", n: 2, run: (T, [eid, off]) => T.setSeason(String(eid || ""), off === true) },
  noteForPreparer: { role: "staff", n: 2, run: (T, [eid, text]) => T.noteForPreparer(String(eid || ""), String(text ?? "").slice(0, 400)) },
  addContact2: { role: "staff", n: 3, run: (T, [cid, name, email]) => T.addContact2(String(cid || ""), String(name ?? "").slice(0, 80), String(email ?? "").slice(0, 254)) },
  assignItem: { role: "staff", n: 2, run: (T, [iid, pid]) => T.assignItem(String(iid || ""), pid ? String(pid) : "") },
  confirmRecord: { role: "staff", n: 3, run: (T, [eid, rid, f]) => T.confirmRecord(String(eid || ""), String(rid || ""), Array.isArray(f) ? f.slice(0, 200) : undefined) },
  dropRecord: { role: "staff", n: 2, run: (T, [eid, rid]) => T.dropRecord(String(eid || ""), String(rid || "")) },
  attachRecord: { role: "staff", n: 2, run: (T, [eid, rec]) => { const r = (rec && typeof rec === "object" ? rec : {}) as Record<string, unknown>; const x = T.attachRecord(String(eid || ""), { file: String(r.file || "").slice(0, 200), kind: String(r.kind || "unknown"), status: String(r.status || "read"), by: "rules", where: "browser", findings: Array.isArray(r.findings) ? r.findings.slice(0, 200) : [] }); if (x && T.listOf(String(eid)).status !== "approved") T.buildList(String(eid)); return x ? null : "No such client"; } },
  setCatalog: { role: "owner", n: 2, run: (T, [code, p]) => T.setCatalog(String(code || ""), p && typeof p === "object" ? p : {}) },
  setFirmRule: { role: "owner", n: 2, run: (T, [k, on]) => T.setFirmRule(String(k || ""), on === true) },
  setAlias: { role: "staff", n: 2, run: (T, [raw, v]) => T.setAlias(String(raw || "").slice(0, 120), String(v ?? "").slice(0, 80)) },
  // checklist
  setItem: staff(4), addItem: staff(4), addRecommended: staff(2), dismissRec: staff(2), addFromPrior: { role: "staff", n: 2, run: (T, [eid, list]) => (T.S.firm.priorReturn === true ? T.addFromPrior(String(eid || ""), (Array.isArray(list) ? list : []).slice(0, 40).map((x) => { const o = (x && typeof x === "object" ? x : {}) as Record<string, unknown>; return { form: String(o.form || ""), payer: String(o.payer || "").replace(/[<>]/g, "").slice(0, 60), why: String(o.why || "").replace(/[<>]/g, "").slice(0, 140) }; })) : "An owner has not switched this on") }, setCustomEs: staff(2),
  saveTemplate: owner(1), removeTemplate: owner(1), applyTemplate: staff(3), sendCheckin: staff(1), applyCheckin: staff(2), skipQuestions: staff(2), customSuggest: staff(3),
  // Editing a client's details, as the demo's Details tab does it. A changed mobile number is a new number: any OK to text is reset
  // and a wrong-number flag is cleared (spec TH-CON-9). The language is not editable here while Spanish is off for pilots.
  saveClient: { role: "staff", n: 2, run: (T, [cid, v]) => {
    const c = T.client(cid), f = (v && typeof v === "object" ? v : {}) as Record<string, unknown>, str = (k: string, max: number) => String(f[k] ?? "").replace(/[<>]/g, "").trim().slice(0, max); if (!c) return "No such client";
    // The email goes first, through the engine: checked, lower-cased, and a new address after an unsubscribe starts letters again (QA review). A bad one changes nothing.
    const em = T.setEmail(c.id, str("email", 254)); if (em) return em;
    c.first = str("first", 60) || c.first; c.last = str("last", 60) || c.last;
    const mobile = String(f.mobile ?? "").replace(/\D/g, "").slice(-10);
    if (mobile !== c.mobile) { c.mobileBad = false; if (c.textConsent === "given") { c.textConsent = "none"; c.consentLog.push({ at: new Date(T.S.now), what: "Reset: the mobile number was changed", channel: "text" }); } }
    c.mobile = mobile; c.notes = String(f.notes ?? "").slice(0, 4000);
    if (T.S.users.some((u: { id: string; role: string }) => u.id === f.preparer && u.role !== "read_only")) c.preparer = f.preparer;
    const tz = String(f.tz ?? ""); if ((c.tz || "") !== tz && (tz === "" || Object.hasOwn(T.ZNAME, tz))) T.setZone(c.id, tz);
    T.audit("client.edit", c.last); return null; } },
  // Confirming a checklist is the firm saying "this list is right". The demo sets the same flag and writes the same two records.
  // In an email-first firm a return is confirmed only by approving its fetch list (docs/FETCH.md), so the old step goes through it.
  confirmChecklist: { role: "staff", n: 1, run: (T, [eid]) => { const e = T.eng(eid); if (!e) return "No such client"; if (e.confirmed) return "Already confirmed"; if (T.S.firm.letters) return T.approveList(e.id); e.confirmed = true; T.timeline(e, "Checklist confirmed", T.S.user.name); T.audit("checklist.confirm", T.client(e.clientId).last); return null; } },
  // Start collecting for many clients in one turn, then let the first messages go, as the demo's wizard does.
  // Many at once are paced by the engine (T-123): the first 50 now, each further 50 half an hour later.
  startMany: { role: "staff", n: 1, run: (T, [ids]) => { const r = T.startMany((Array.isArray(ids) ? ids : []).slice(0, 5000).map(String)); T.tick(); return { started: r.started, capped: r.capped, refused: r.refused, paced: r.paced, lastAt: r.lastAt }; } },
  undiscard: staff(1),   // T-66: put back a document discarded in the last ten minutes
  // T-63: days the firm itself is closed. The engine checks the dates.
  // Fetch intensity (TH-PAC): the firm's, by an owner; one client's, by staff. The engine checks the role and the value.
  setIntensity: { role: "owner", n: 1, run: (T, [k]) => T.setIntensity(String(k || "")) },
  setClientIntensity: { role: "staff", n: 2, run: (T, [cid, k]) => T.setClientIntensity(String(cid || ""), k ? String(k) : "") },
  // Voice (TH-VOI): the firm's and its sign-off, by an owner; one client's, by staff.
  setVoice: { role: "owner", n: 1, run: (T, [k]) => T.setVoice(String(k || "")) },
  setClientVoice: { role: "staff", n: 2, run: (T, [cid, k]) => T.setClientVoice(String(cid || ""), k ? String(k) : "") },
  setSignOff: { role: "owner", n: 1, run: (T, [text]) => T.setSignOff(String(text == null ? "" : text).slice(0, 80)) },
  // Barks (TH-BRK): who hears about what, staff hours, each person's own choices, and marking a bark read.
  setBarkRules: { role: "owner", n: 1, run: (T, [rules]) => T.setBarkRules(rules && typeof rules === "object" ? rules : {}) },
  setStaffHours: { role: "owner", n: 2, run: (T, [a, b]) => T.setStaffHours(Number(a), Number(b)) },
  setMyBarks: { role: "staff", n: 1, run: (T, [p]) => T.setMyBarks(p && typeof p === "object" ? p : {}) },
  barkRead: { role: "staff", n: 1, run: (T, [id]) => T.barkRead(String(id || "all")) },
  // Season memory (TH-MEM): the switch and clearing one client's are the owner's; settling what last season left off is staff work.
  setMemory: { role: "owner", n: 1, run: (T, [on]) => T.setMemory(on === true) },
  clearMemory: { role: "owner", n: 1, run: (T, [cid]) => T.clearMemory(String(cid || "")) },
  keepRemoved: { role: "staff", n: 2, run: (T, [eid, i]) => T.keepRemoved(String(eid || ""), Number(i)) },
  confirmRemoved: { role: "staff", n: 1, run: (T, [eid]) => T.confirmRemoved(String(eid || "")) },
  setSpouse: { role: "staff", n: 2, run: (T, [cid, other]) => T.setSpouse(String(cid || ""), other ? String(other) : "") },
  setClosedDays: { role: "owner", n: 1, run: (T, [list]) => T.setClosedDays((Array.isArray(list) ? list : []).slice(0, 100).map(String)) },
  // chase
  start: staff(1), pause: staff(1), resume: staff(1), takeover: staff(2), handback: staff(2), approveMsg: staff(2), rejectMsg: staff(1), markHeadsUp: staff(1),
  // TH-CNV-2: staff choose text or email for one reply. The engine refuses a channel the client has not agreed to or that does not work.
  manual: { role: "staff", n: 3, run: (T, [eid, body, via]) => T.manual(eid, body, false, via === "text" || via === "email" ? via : undefined) },
  // TH-PLN-7: hold one document until a date, clear the hold, or ask for it now. Ask now still keeps to sending hours and one automatic message a day.
  setHold: { role: "staff", n: 2, run: (T, [iid, day]) => T.setHold(String(iid || ""), String(day || "")) },
  askNow: { role: "staff", n: 1, run: (T, [iid]) => T.askNow(String(iid || "")) },
  // TH-BRK-14: who is the office manager, for the kinds of bark an owner sends there.
  setDuty: { role: "owner", n: 2, run: (T, [uid, on]) => T.setDuty(String(uid || ""), on === true) },
  // v2, email-first (docs/V2.md). The upload link: a new one, or switched off (TH-UPL-1). Who approves letters, for one client (TH-EML-4).
  rotateLink: { role: "staff", n: 1, run: (T, [eid]) => T.rotateLink(String(eid || "")) },
  revokeLink: { role: "staff", n: 1, run: (T, [eid]) => T.revokeLink(String(eid || "")) },
  setClientSendMode: { role: "staff", n: 2, run: (T, [cid, v]) => T.setClientSendMode(String(cid || ""), v === "approve" || v === "auto" ? v : "") },
  // The firm's working days, the most letters a day from one mailbox (TH-EML-11), and whether a person confirms every document (the pilot's check).
  setWorkDays: { role: "owner", n: 1, run: (T, [list]) => T.setWorkDays((Array.isArray(list) ? list : []).slice(0, 7)) },
  setMailCap: { role: "owner", n: 1, run: (T, [n]) => T.setMailCap(Number(n)) },
  setConfirmAll: { role: "owner", n: 1, run: (T, [on]) => T.setConfirmAll(on === true) },
  // The Hound's schedule and memory, as the demo's Coming up list and client panel change them.
  sendNow: { role: "staff", n: 1, run: (T, [eid]) => { const e = T.eng(eid); if (!e || !e.next) return "Nothing is planned for this client"; if (!T.allowed(T.S.now)) return "It is outside sending hours. The Hound waits until they begin."; e.lastAutoDay = null; e.next = new Date(T.S.now); T.step(e); T.hlog(e, "decide", T.S.user.name + " sent the next message now", "A person asked for it from Coming up", "Rules"); return null; } },
  snooze: { role: "staff", n: 1, run: (T, [eid]) => { const e = T.eng(eid); if (!e || !e.next) return "Nothing is planned for this client"; e.next = T.nextAllowed(new Date(new Date(e.next).getTime() + T.DAY)); T.hlog(e, "decide", T.S.user.name + " put the next message off by a day", "A person asked for it from Coming up", "Rules"); return null; } },
  rememberNote: { role: "staff", n: 2, run: (T, [eid, text]) => { const e = T.eng(eid), t = String(text || "").replace(/[<>]/g, "").trim().slice(0, 200); if (!e || !t) return "Write a few words first"; T.remember(e, t, T.S.user.name); return null; } },
  setTarget: { role: "staff", n: 2, run: (T, [eid, day]) => { const e = T.eng(eid), m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(day || "")); if (!e) return "No such client"; e.target = m ? new Date(+m[1]!, +m[2]! - 1, +m[3]!, 17) : null; T.hlog(e, "decide", "Date the documents are needed by " + (e.target ? "set" : "cleared"), "The Hound follows up more often as the date gets close", "Rules"); return null; } },
  // How much the Hound does on its own. Owner only; every change is in the audit trail.
  setHound: { role: "owner", n: 1, run: (T, [v]) => {
    const H = T.S.firm.hound, x = (v && typeof v === "object" ? v : {}) as Record<string, unknown>, pick = <V,>(k: string, allowed: V[]) => { if (allowed.includes(x[k] as V) && H[k] !== x[k]) { H[k] = x[k]; changed.push(k); } }, changed: string[] = [];
    pick("mode", ["copilot", "autopilot"]); pick("tone", ["warm", "brief", "formal"]); pick("emailAfter", [1, 2, 3, 99]); pick("slaHours", [2, 4, 8, 24]); pick("pauseDays", [1, 2, 3, 5, 7]); pick("callTask", [true, false]); pick("aiWrite", [true, false]); pick("closingQ", [true, false]); pick("voicemail", [true, false]); pick("replyV2", ["on", "shadow"]);
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
  // T-50: staff record that a client said reminder calls are fine, or turn them off. The engine keeps the record and refuses after a STOP.
  setCallOk: { role: "staff", n: 3, run: (T, [cid, on, how]) => T.setCallOk(String(cid || ""), on === true, String(how ?? "").replace(/[<>]/g, "").trim().slice(0, 120)) },
  // A client's second contact (T-118): matched on the way in, never sent to. The engine checks the number or address.
  addContact: { role: "staff", n: 3, run: (T, [cid, kind, value]) => T.addContact(String(cid || ""), String(kind || ""), String(value ?? "").slice(0, 254)) },
  removeContact: staff(2),
  assignUnknown: { role: "staff", n: 3, run: (T, [yid, cid, remember]) => {
    const S = T.S, y = S.tray.find((x: { id: string }) => x.id === yid), c = T.client(cid), e = c && T.engOf(c.id); if (!y) return { ok: false, why: "That message has already been dealt with" }; if (!c || !e) return { ok: false, why: "Choose a client" };
    if (!y.docId && !y.spec && (y.why === "Could not be processed" || y.why === "Blocked by the virus scan")) return { ok: false, why: "There is nothing in this notice to assign" };
    S.tray.splice(S.tray.indexOf(y), 1); let doc = null;
    if (y.docId) { doc = S.docs.find((d: { id: string }) => d.id === y.docId); if (doc) { doc.clientId = c.id; doc.engId = e.id; T.check(doc); T.decide(doc, e, c); } }
    else if (y.spec) doc = T.inboundDoc(c.id, y.spec, y.channel || "text"); else if (y.text && !/^\s*(stop|stopall|unsubscribe|cancel|end|quit|start|unstop|yes|alto|parar|cancelar)\s*[.!]?\s*$/i.test(String(y.text))) T.inboundText(c.id, y.text);   // filing a stray STOP or START to a client must not change that client's consent
    // "Remember this sender": only a real number or address, taken from what arrived and never from the browser.
    let remembered = false; if (remember === true && y.from && !/second contact/.test(String(y.from))) { const from = String(y.from), kind = y.channel === "email" || from.includes("@") ? "email" : "mobile"; remembered = T.addContact(c.id, kind, kind === "email" ? (/<([^>]+)>/.exec(from)?.[1] || from) : from) === null && (c.also || []).length > 0; }
    T.audit("unknown.assigned", c.last); return { ok: true, first: c.first, state: doc ? doc.state : null, remembered }; } },
  // Discarding forgets the message. A file that came with it is marked discarded so it is deleted on the short schedule.
  discardUnknown: { role: "staff", n: 1, run: (T, [yid]) => { const S = T.S, y = S.tray.find((x: { id: string }) => x.id === yid); if (!y) return false; S.tray = S.tray.filter((x: { id: string }) => x.id !== yid); const d = y.docId && S.docs.find((x: { id: string }) => x.id === y.docId); if (d && !d.engId) d.state = "discarded"; T.audit("unknown.discarded", ""); return true; } },
  // alerts: read marks, exactly as the demo's bell sets them
  alertRead: { role: "staff", n: 1, run: (T, [id]) => { const a = (T.S.alerts || []).find((x: { id: string }) => x.id === id); if (a) a.read = true; return !!a; } },
  alertsRead: { role: "staff", n: 0, run: (T) => { (T.S.alerts || []).forEach((a: { read?: boolean }) => { a.read = true; }); return true; } },
  // When messages may go: the earliest and latest hour, and the hour used on a new day. Owner only.
  setSchedule: { role: "owner", n: 1, run: (T, [v]) => { const f = T.S.firm, x = (v && typeof v === "object" ? v : {}) as Record<string, unknown>; if ([8, 9, 10].includes(x.quietStart as number)) f.quietStart = x.quietStart; if ([17, 18, 19, 20].includes(x.quietEnd as number)) f.quietEnd = x.quietEnd; if ([9, 10, 11, 12].includes(x.newDayHour as number)) f.newDayHour = x.newDayHour; T.audit("settings.schedule", "Sends " + f.quietStart + ":00 to " + f.quietEnd + ":00"); return null; } },
  // A firm's own wording for one message. The wording the law requires cannot be changed. New wording must keep every blank the
  // standard wording fills in, use no blank the engine does not know, and pass the engine's own message check when filled in.
  // An owner's own wording for a message, per voice (TH-VOI-8). Editing Warm does not change Professional or Brief. Whatever is saved
  // must keep every blank of the wording it replaces and pass the same check as a message, filled with sample data, never a client.
  saveWording: { role: "owner", n: 3, run: (T, [code, text, v]) => {
    const k = String(code || ""), voice = v && T.VOICES[String(v)] ? String(v) : "professional", pro = voice === "professional";
    // v2: an email-first firm edits its letters and replies as they are sent: the letter wording, with the upload link where one belongs.
    // A letter keeps its line breaks, and must keep the client's name, the list of what is owed and the link.
    const LT = T.LETTERS() ? (T.LETTER[voice] && T.LETTER[voice].en[k]) || T.LETTER.professional.en[k] || null : null, multi = /^L\d$/.test(k);
    if (!Object.hasOwn(T.TPL.en, k) && !LT) return "No such message"; if (T.COMPLIANCE.includes(k) || k === "M31") return "This wording is required by law and cannot be changed";
    if (!pro && T.VOICE_FIXED.includes(k)) return "This message has one wording in every voice";
    const std = String(LT || (pro ? T.TPL.en[k] : T.VOICE_TPL[voice].en[k] || T.TPL.en[k]));
    const body = multi ? String(text ?? "").replace(/\r/g, "").split("\n").map((l) => l.replace(/[<>¶§]/g, "").replace(/\s+/g, " ").trim()).join("¶").replace(/¶{3,}/g, "¶¶").replace(/^¶+|¶+$/g, "") : String(text ?? "").replace(/[<>¶§]/g, "").replace(/\s+/g, " ").trim();
    if (multi ? body.length < 40 || body.length > 1500 : body.length < 10 || body.length > 600) return multi ? "Write between 40 and 1,500 characters" : "Write between 10 and 600 characters"; if (/!/.test(body)) return "No exclamation marks";
    const blanks = (t: string) => [...new Set(t.match(/\{\w+\}/g) || [])], need = multi ? ["{first}", "{items}", "{link}"] : blanks(std).filter((x) => x !== "{sign_off}"), lost = need.filter((x) => !body.includes(x)), odd = blanks(body).filter((x) => !need.includes(x) && !blanks(std).includes(x) && !["{first}", "{firm}", "{preparer}", "{year}", "{sign_off}", "{sign_name}"].includes(x));
    if (lost.length) return "It must keep " + lost.join(", "); if (odd.length) return "Tallyhound does not know " + odd.join(", ");
    // QA review: a client must be able to trust every letter. The only link is their own ({link}), and no letter asks for an SSN, a password, a payment or bank details.
    if (/https?:\/\/|www\.|\b[a-z0-9-]+\.(com|net|org|io|co|us|info|biz|app|link|xyz)\b/i.test(body)) return "The only link in a letter is the client's own upload link, {link}. Take the other one out";
    if (/\b(send|reply with|give|provide|enter|confirm|text|email|include|share|tell)\b[^.¶]{0,40}\b(ssn|social security|password|passcode|pin|bank|routing|account number|card|payment|pay|wire|gift card)/i.test(body) || /\b(pay|payment|wire)\b[^.¶]{0,30}\b(now|today|here|online|fee|invoice)\b/i.test(body)) return "A letter never asks for a Social Security number, a password, a payment or bank details";
    const c = { id: "", first: "Maria", last: "Garcia", lang: "en", voice, preparer: T.S.user ? T.S.user.id : null }, year = T.S.firm.taxYear || 2026;
    const F = T.S.firm, slot: Record<string, string> = pro ? (F.templates.en = F.templates.en || {}) : (((F.templatesBy = F.templatesBy || {})[voice] = F.templatesBy[voice] || {}).en = F.templatesBy[voice].en || {});
    const was = slot[k]; slot[k] = body;
    const errs = T.outputCheck(T.fill(k, c, null, { voice, item: { form: "W2", payer: "Acme Health" }, n: 3, k: 2, question: "Did you start a new job?", doc_year: year - 1, summary: "We have your W-2.", missing: "the second page is missing", fix: "the second page", list: "your W-2", date: "March 1", link: "https://go.tallyhound.example/u/maple-abcdefghijkmnpqrstuvwxyzab", items: "§- W-2 from Acme Health¶§- 1099-INT from First Farmers Bank", usual_issue: "It usually arrives by January 31." }), "email", { year, doc_year: year - 1 }).filter((x: string) => !x.startsWith("digit run"));
    if (errs.length) { if (was === undefined) delete slot[k]; else slot[k] = was; return "It would not pass the message check: " + errs.join(", "); }
    T.audit("settings.wording", k + " changed" + (pro ? "" : " (" + T.VOICES[voice].label + ")")); return null; } },
  resetWording: { role: "owner", n: 2, run: (T, [code, v]) => { const k = String(code || ""), voice = v && T.VOICES[String(v)] ? String(v) : "professional", slot = voice === "professional" ? T.S.firm.templates.en : ((T.S.firm.templatesBy || {})[voice] || {}).en; if (slot && Object.hasOwn(slot, k)) { delete slot[k]; T.audit("settings.wording", k + " back to the standard wording" + (voice === "professional" ? "" : " (" + T.VOICES[voice].label + ")")); } return null; } },
  // The emergency stop: every automated message is held until an owner lifts it. STOP and HELP replies still go (the engine sees to that).
  stopAll: { role: "owner", n: 0, run: (T) => { T.S.firm.stopped = true; T.audit("emergency.stop", "All automated messages held"); return true; } },
  // How long after a file is closed its documents and message text are deleted.
  setCloseRetention: { role: "owner", n: 1, run: (T, [days]) => { T.S.firm.retention = Math.min(730, Math.max(30, Math.round(+(days as number)) || 90)); T.audit("settings.retention", T.S.firm.retention + " days after a file is closed"); return T.S.firm.retention; } },
  // the emergency stop is lifted by an owner
  resumeAll: { role: "owner", n: 0, run: (T) => { T.S.firm.stopped = false; T.audit("emergency.resume", "Messages resumed"); return true; } },
  // The firm's own details. The Tallyhound address is not editable: mail to it is how the firm is found.
  // Starts the next tax year for every client whose file is finished: last year's file becomes a summary and this year's checklist
  // starts from what they sent before (T-73). Clients still being collected stay on the old year. One year forward at a time.
  rollSeason: { role: "owner", n: 1, run: (T, [year]) => { const r = T.rollSeason(+(year as number)); return r.error ? r.error : r; } },
  // The firm's legal details for the carriers, who must approve a business text number. The engine checks them. An employer
  // identification number is a business's, never a person's: a sole proprietor ticks "none" and no personal number is taken.
  registerSender: { role: "owner", n: 1, run: (T, [v]) => { const x = (v && typeof v === "object" ? v : {}) as Record<string, unknown>, t = (k: string, max: number) => String(x[k] ?? "").replace(/[<>]/g, "").replace(/\s+/g, " ").trim().slice(0, max);
    return T.registerSender({ legalName: t("legalName", 120), ein: x.soleProp === true ? "" : t("ein", 12), soleProp: x.soleProp === true, street: t("street", 120), city: t("city", 60), state: t("state", 2), zip: t("zip", 5), contact: t("contact", 80), ownerMobile: t("ownerMobile", 20), website: t("website", 120) }); } },
  // Where finished files go. The folder, whether filing happens by itself, and when. Which storage is connected is not set here:
  // that changes only when an owner signs in to it (apps/server/src/storage.ts), so the state can never claim a connection that does not exist.
  setDelivery: { role: "owner", n: 1, run: (T, [v]) => {
    const dl = T.S.firm.delivery, x = (v && typeof v === "object" ? v : {}) as Record<string, unknown>, connected = !!dl.provider && dl.provider !== "Download";
    const folder = String(x.folder ?? dl.folder).replace(/[<>:"|?*\\]/g, "").replace(/[^\x20-\uffff]/g, "").split("/").map((p) => p.trim()).filter((p) => p && p !== "." && p !== "..").join("/").slice(0, 80); if (!folder) return "Give the folder a name";
    dl.folder = folder; if (["arrival", "each", "complete"].includes(x.when as string)) dl.when = x.when; if (typeof x.auto === "boolean") dl.auto = x.auto && connected ? "on" : "off";
    T.audit("settings.delivery", (connected ? dl.provider : "Download") + ", folder " + dl.folder + (connected ? ", files " + (dl.auto === "on" ? "by itself" : "when asked") : "")); return null; } },
  saveFirm: { role: "owner", n: 1, run: (T, [v]) => {
    const f = T.S.firm, x = (v && typeof v === "object" ? v : {}) as Record<string, unknown>, str = (k: string, max: number) => String(x[k] ?? "").replace(/[<>]/g, "").replace(/\s+/g, " ").trim().slice(0, max);
    f.name = str("name", 80) || f.name; f.sender = str("sender", 30) || f.sender; f.phone = str("phone", 20);
    const y = +(x.taxYear as number); if ([2025, 2026, 2027].includes(y)) f.taxYear = y;
    T.audit("settings.firm", "Firm details changed"); return null; } },
  // owner only: how long data is kept, deleting copies, ending a pause
  setRetain: owner(2), deleteDocsNow: owner(1), purge: owner(1), resumeNow: owner(0),
  // A pause is the firm's own choice: data is kept, nothing runs, nothing is billed. The engine holds the 90-days-a-year limit.
  pauseSeason: { role: "owner", n: 1, run: (T, [until]) => { const d = new Date(String(until || "") + (/^\d{4}-\d{2}-\d{2}$/.test(String(until)) ? "T09:00:00" : "")); return isNaN(+d) ? "Pick a date" : T.pauseSeason(d); } }
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
