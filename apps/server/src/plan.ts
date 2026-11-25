// The follow-up plan (TH-PLN, Website Feature Delta section 3): every ask for one client, with its date, channel and exact wording,
// and anything cancelled, held or handed to staff.
//
// It is a projection, never a second scheduler. What has happened is read from the client's own messages and documents. What is
// still to come is found by loading that one client's file into a second engine and letting the real scheduler run ahead, with
// nobody replying. So the plan cannot drift from what is sent: it is the same code, run early. Nothing here sends anything, and a
// preview is the body the engine itself wrote, marked as a preview.
//
// Pure: no clock, no network, no storage. The staff screens run it in the browser against the state they already hold.
/* eslint-disable @typescript-eslint/no-explicit-any */
type Engine = any;
export const PLAN_HORIZON_DAYS = 60;
export const PLAN_SEND_WINDOW = { start: "10:00", end: "12:00" };   // shown before a message exists; the exact time shows once it is sent

export type PlanKind = "request" | "reminder" | "final" | "cancelled" | "held" | "arrived" | "quiet";
export interface PlanEvent {
  id: string; kind: PlanKind; item_id: string | null; /** A letter names several documents at once (email-first firms). */ item_ids?: string[]; day: number; date: Date; until?: Date; window: { start: string; end: string } | null; sent_at: Date | null;
  channel: "text" | "email" | "voice" | null; fallback_channel: "email" | null; template: string | null;
  status: "planned" | "queued" | "sent" | "delivered" | "failed" | "cancelled"; reason: string | null;
  /** Planned asks only: the exact wording, marked as a preview. It can never be sent from here. */
  preview?: { preview: true; body: string; channels: Record<"text" | "email", { available: boolean; unavailable_reason: string | null }> };
}
export interface Plan { events: PlanEvent[]; horizon_end: Date; preset: string; preset_label: string; generated_at: Date; day0: Date | null; note: string | null }

const ASK: Record<string, PlanKind> = { M3: "request", M4: "request", M19: "request", M5: "reminder", M22R: "reminder", M6: "final", L1: "request", L2: "reminder", L3: "final" };
const DAY = 86400000;
const noon = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12);
const dayNo = (d: Date, d0: Date) => Math.round((+noon(d) - +noon(d0)) / DAY);

/** Why a channel cannot be used for this client, or null when it can. The same facts the engine's own channel choice reads. */
export function channelState(T: Engine, c: any): Record<"text" | "email", { available: boolean; unavailable_reason: string | null }> {
  if (T.LETTERS && T.LETTERS()) { const email = c.emailOff ? "Unsubscribed from email" : !c.email ? "No email address" : c.emailOk === false ? "The address did not accept a letter" : null; return { text: { available: false, unavailable_reason: "Letters go by email" }, email: { available: !email, unavailable_reason: email } }; }
  const text = c.textConsent === "withdrawn" ? "Replied STOP" : !c.mobile ? "No mobile on file" : c.mobileBad ? "The number is wrong or not a mobile" : c.textConsent !== "given" ? "No text consent" : T.S.firm.senderStatus !== "approved" ? "Texting number not approved yet" : null;
  const email = c.emailOff ? "Unsubscribed from email" : !c.email ? "No email address" : c.emailOk === false ? "The address bounced" : null;
  return { text: { available: !text, unavailable_reason: text }, email: { available: !email, unavailable_reason: email } };
}

export function planFor(T: Engine, eid: string, createEngine: () => Engine): Plan {
  const LET = !!(T.LETTERS && T.LETTERS()), S = T.S, e = T.eng(eid), c = e ? T.client(e.clientId) : null, now: Date = new Date(S.now), cad = T.cadenceFor(e), P = T.CADENCE_PRESETS[cad.key];
  const out: PlanEvent[] = []; let n = 0; const id = () => "evt_" + (++n);
  const asks: any[] = S.msgs.filter((m: any) => m.engId === eid && m.dir === "out" && m.kind === "auto" && ASK[m.tpl]).sort((a: any, b: any) => +new Date(a.at) - +new Date(b.at));
  const day0: Date | null = e && e.startedAt ? new Date(e.startedAt) : asks[0] ? new Date(asks[0].at) : null, base = day0 || now;
  const chans = c ? channelState(T, c) : { text: { available: false, unavailable_reason: "No client" }, email: { available: false, unavailable_reason: "No client" } };

  // 1. What has gone out. A reminder that also went by email at the same moment is one ask with a fallback channel.
  for (const m of asks) {
    const prev = out[out.length - 1];
    if (prev && prev.template === m.tpl && prev.item_id === (m.itemId || null) && Math.abs(+prev.date - +new Date(m.at)) < 120000 && m.channel === "email" && prev.channel === "text") { prev.fallback_channel = "email"; continue; }
    const st = m.failed ? "failed" : m.status === "discarded" ? "cancelled" : m.status === "approval" || m.status === "approved" || m.status === "writing" ? "queued" : m.sentAt ? "delivered" : "sent";
    out.push({ id: id(), kind: st === "cancelled" ? "cancelled" : ASK[m.tpl]!, item_id: m.itemId || null, ...(m.letterItems ? { item_ids: m.letterItems.slice() } : {}), day: dayNo(new Date(m.at), base), date: new Date(m.at), window: null, sent_at: st === "sent" || st === "delivered" ? new Date(m.sentAt || m.at) : null, channel: m.channel, fallback_channel: null, template: m.tpl, status: st as PlanEvent["status"], reason: st === "cancelled" ? "paused" : null });
  }
  // 2. What arrived, and the asks it made unnecessary: the rest of that item's preset days, each moved off a day nothing is sent on.
  const allowedDay = (d: Date) => { let x = new Date(d.getFullYear(), d.getMonth(), d.getDate(), S.firm.newDayHour || 10); for (let i = 0; i < 14 && !T.allowed(x); i++) x = new Date(x.getTime() + DAY); return x; };
  for (const it of T.itemsOf(eid)) {
    const d = it.docId ? S.docs.find((x: any) => x.id === it.docId) : null, first = asks.find((m) => m.itemId === it.id);
    if (it.state === "received" && d) {
      out.push({ id: id(), kind: "arrived", item_id: it.id, day: dayNo(new Date(d.at), base), date: new Date(d.at), window: null, sent_at: null, channel: d.channel === "text" || d.channel === "email" ? d.channel : null, fallback_channel: null, template: null, status: "delivered", reason: null });
      if (first && !LET) for (const k of [...P.days, P.final] as number[]) { const when = allowedDay(new Date(+new Date(first.at) + k * DAY)); if (+noon(when) > +noon(new Date(d.at)) && !asks.some((m) => m.itemId === it.id && +noon(new Date(m.at)) === +noon(when))) out.push({ id: id(), kind: "cancelled", item_id: it.id, day: dayNo(when, base), date: when, window: null, sent_at: null, channel: null, fallback_channel: null, template: k === P.final ? "M6" : "M5", status: "cancelled", reason: "arrived" }); }
    }
    if (it.state === "waived" && first) out.push({ id: id(), kind: "cancelled", item_id: it.id, day: dayNo(now, base), date: now, window: null, sent_at: null, channel: null, fallback_channel: null, template: null, status: "cancelled", reason: "item_waived" });
    // 3. Holds: one span with no asks, and why.
    const h = T.OPEN.includes(it.state) ? T.holdOf(it, e) : null;
    if (h) out.push({ id: id(), kind: "held", item_id: it.id, day: dayNo(now, base), date: now, until: new Date(h.until), window: null, sent_at: null, channel: null, fallback_channel: null, template: null, status: "planned", reason: h.reason });
  }
  // 4. What is still to come: the real scheduler, run ahead on a copy of this one client's file.
  let note: string | null = null; const horizon = new Date(+base + PLAN_HORIZON_DAYS * DAY);
  if (!e || !c) note = "No file for this client";
  else if (e.status === "paused") note = "Fetching is paused. Nothing is planned until someone resumes";
  else if (e.status === "opted_out" || (!chans.text.available && !chans.email.available)) note = "No way to reach this client, so nothing is planned";
  else if (LET && e.status === "in_progress" && !T.senderFor(c).ok) note = T.senderFor(c).who + " has no mailbox connected, so nothing goes until they connect one";
  else if (e.takeover) note = e.takeover.by + " is handling this conversation. Nothing automatic is planned";
  else if (e.status === "stuck" && !S.tasks.some((t: any) => t.status === "open" && t.engId === eid && t.kind === "gone_quiet")) note = "Something for this client is waiting in the review queue. Nothing more is sent until it is dealt with";
  else if (e.status === "stuck") { const q = (e.timeline || []).find((t: any) => /^Gone quiet/.test(t.text)); out.push({ id: id(), kind: "quiet", item_id: null, day: dayNo(q ? new Date(q.at) : now, base), date: q ? new Date(q.at) : now, window: null, sent_at: null, channel: null, fallback_channel: null, template: null, status: "delivered", reason: e.stuck === "no_reply" ? "no_reply" : String(e.stuck || "") }); }
  else if (["complete", "closed", "not_started"].includes(e.status)) note = e.status === "not_started" ? "Nothing is planned until you say go fetch" : null;
  else if (!T.access().ok) note = "Nothing is sent while the firm is not collecting";
  else {
    const U: Engine = createEngine(); U.load(T.dumpOne(eid)); const H = U.S.firm.hound; H.mode = "autopilot"; for (const uc of U.S.clients) delete uc.sendMode;   // a letter waiting for approval is still the letter that will go H.aiLive = false; H.voicemail = false; U.S.firm.stopped = false; U.S.firm.billing = { state: "active", plan: U.S.firm.plan || "Practice" };
    const ue = U.eng(eid), seen = new Set<string>(U.S.msgs.map((m: any) => m.id)), start = +new Date(U.S.now);
    for (let i = 0; i < PLAN_HORIZON_DAYS * 2 && +new Date(U.S.now) < Math.max(+horizon, start + 21 * DAY); i++) {
      U.advance(DAY / 2);
      for (const m of U.S.msgs as any[]) {
        if (seen.has(m.id)) continue; seen.add(m.id); if (m.dir !== "out" || m.kind !== "auto" || !ASK[m.tpl]) continue;
        const prev = out[out.length - 1];
        if (prev && prev.status === "planned" && prev.template === m.tpl && prev.item_id === (m.itemId || null) && Math.abs(+prev.date - +new Date(m.at)) < 120000 && m.channel === "email") { prev.fallback_channel = "email"; continue; }
        out.push({ id: id(), kind: ASK[m.tpl]!, item_id: m.itemId || null, ...(m.letterItems ? { item_ids: m.letterItems.slice() } : {}), day: dayNo(new Date(m.at), base), date: new Date(m.at), window: LET ? { start: "09:00", end: "10:00" } : { ...PLAN_SEND_WINDOW }, sent_at: null, channel: m.channel, fallback_channel: null, template: m.tpl, status: "planned", reason: null, preview: { preview: true, body: String(m.body), channels: chans } });
      }
      if (ue.status === "stuck") { out.push({ id: id(), kind: "quiet", item_id: null, day: dayNo(new Date(U.S.now), base), date: new Date(U.S.now), window: null, sent_at: null, channel: null, fallback_channel: null, template: null, status: "planned", reason: ue.stuck === "no_reply" ? "no_reply" : String(ue.stuck || "") }); break; }
      if (["complete", "closed", "paused", "opted_out"].includes(ue.status)) break;
    }
  }
  out.sort((a, b) => +a.date - +b.date || a.id.localeCompare(b.id, undefined, { numeric: true }));
  return { events: out, horizon_end: horizon, preset: cad.key, preset_label: cad.label, generated_at: now, day0, note };
}
