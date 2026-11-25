// Everything waiting for a person at a firm, worked out from the engine's state. A list, never a rule. The staff screens and the
// morning email both read it from here, so they can never disagree. Ported from the demo (reference/artifact/ui.js).
type Engine = any;   // eslint-disable-line @typescript-eslint/no-explicit-any
/* eslint-disable @typescript-eslint/no-explicit-any */
export type Row = any;
export const openTasks = (T: Engine): Row[] => T.S.tasks.filter((t: Row) => t.status === "open" && !(t.snoozedUntil && +new Date(t.snoozedUntil) > +new Date(T.S.now)));   // a call to try again on a later day is off the list until that morning

export interface Need { at: Date; c: Row; e: Row; t?: Row; stuck?: string; checkin?: boolean; suggest?: boolean; custom?: boolean }
/** Everything waiting for a person, oldest first: one list, as docs/UX.md rule 3 asks. */
export function needsYou(T: Engine): Need[] {
  const s = T.S, out: Need[] = [], open = openTasks(T);
  open.forEach((t) => { const e = T.eng(t.engId), c = e ? T.client(e.clientId) : null; if (c) out.push({ at: t.at, c, e, t }); });
  s.engs.filter((e: Row) => e.status === "stuck" && !open.some((t) => t.engId === e.id)).forEach((e: Row) => out.push({ at: e.lastOut || e.startedAt || s.now, c: T.client(e.clientId), e, stuck: e.stuck }));
  s.engs.filter((e: Row) => e.status === "opted_out").forEach((e: Row) => out.push({ at: e.lastIn || s.now, c: T.client(e.clientId), e, stuck: "opted_out" }));
  s.engs.filter((e: Row) => e.checkin && e.checkin.doneAt && !e.checkin.reviewedAt && ["not_started", "in_progress", "stuck"].includes(e.status)).forEach((e: Row) => out.push({ at: e.checkin.doneAt, c: T.client(e.clientId), e, checkin: true }));
  s.engs.filter((e: Row) => e.suggestAt && !["closed", "opted_out"].includes(e.status) && (T.recommend(e.id).add.length || (e.suggestCustom || []).length)).forEach((e: Row) => out.push({ at: e.suggestAt, c: T.client(e.clientId), e, suggest: true, custom: (e.suggestCustom || []).length > 0 }));
  return out.filter((x) => x.c).sort((a, b) => +a.at - +b.at);
}

/** TH-BRK-9: what Tallyhound already knows about an item in the review queue. Facts from the firm's own state, never a model's words. */
export function knows(T: Engine, t: Row): string[] {
  const s = T.S, e = T.eng(t.engId), c = e ? T.client(e.clientId) : null, out: string[] = []; if (!e || !c) return out;
  const name = (i: Row) => (i.custom || T.FORMS[i.form].plain) + (i.payer ? " from " + i.payer : ""), times = (n: number) => (n === 1 ? "once" : n + " times");
  const asked = (i: Row) => s.msgs.filter((m: Row) => m.engId === e.id && m.dir === "out" && m.itemId === i.id && !["discarded", "approval", "writing"].includes(m.status)).length;
  const it = t.itemId ? s.items.find((i: Row) => i.id === t.itemId) : null, d = t.docId ? s.docs.find((x: Row) => x.id === t.docId) : null;
  if (t.kind === "gone_quiet") for (const m of (t.context && t.context.missing) || []) { const i = s.items.find((x: Row) => x.id === m.itemId); if (i && T.OPEN.includes(i.state)) out.push("Still missing: " + name(i) + ", asked " + times(asked(i) || m.asked || 0)); }
  // v2: a suggested step from a reply, and the pilot's confirm-each-document item (docs/V2.md).
  if (t.kind === "step" && t.step) out.push("Suggested: " + stepWords(T, t));
  if (t.confirm && d && d.sniff) out.push("The sniff test: " + (d.sniff.state === "accepted" ? "passed" : d.sniff.state === "incomplete" ? "part of it is missing, and the client was asked for the rest" : "did not pass, and the client was asked again"));
  if (t.kind === "cant_reach") for (const f of (t.context && t.context.failed) || []) { if (!(T.S.firm.letters === true && /^Texts:/.test(String(f)))) out.push(String(f)); }   // an email-first firm sends no texts, so those lines say nothing useful
  for (const k of t.calls || []) out.push("Call " + new Date(k.at).toLocaleDateString("en-US", { month: "short", day: "numeric" }) + " by " + k.by + ": " + String(T.CALL_OUTCOMES[k.outcome] || "").toLowerCase());
  if (it) out.push("About: " + name(it) + (asked(it) ? ", asked " + times(asked(it)) : ""));
  if (d) out.push("Read as: " + T.FORMS[d.form].plain + (d.year ? ", " + d.year : "") + (d.payer ? ", from " + d.payer : ""));
  if (t.kind === "change_noted" && t.change) out.push("The client said: " + T.CHANGE_WORDS[t.change.reason]);
  if (e.lastOut) out.push("Last asked: " + new Date(e.lastOut).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" }));
  const last = s.msgs.filter((m: Row) => m.engId === e.id && m.dir === "in" && m.kind === "client").slice(-1)[0];
  if (last) { out.push(c.first + "'s last message: \u201c" + String(last.body || "").slice(0, 140) + (String(last.body || "").length > 140 ? "..." : "") + "\u201d"); if (last.line || last.understood) out.push(last.line || "Understood: " + String(last.understood).toLowerCase()); }
  else out.push(c.first + " has not replied this season");
  return out;
}
/** What one click on a suggested step will do, in words. */
export function stepWords(T: Engine, t: Row): string {
  const st = t.step || {}, it = st.itemId ? T.S.items.find((i: Row) => i.id === st.itemId) : null, day = st.until ? new Date(st.until).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" }) : "";
  if (st.type === "hold") return "pause " + (it ? "the " + T.itemTitle(it, "en") : "every document still owed") + " until " + day;
  if (st.type === "ask_spouse") { const sp = T.client(st.spouseId); return "ask " + (sp ? sp.first : "the spouse") + " for " + (it ? "the " + T.itemTitle(it, "en") : "it"); }
  return "nothing";
}
/** TH-BRK-9: the suggested next step, picked by fixed rules from the kind of item and its state. [what to do, the decision it maps to]. */
export function nextStep(T: Engine, t: Row): [string, string] {
  const e = T.eng(t.engId), c = e ? T.client(e.clientId) : null, first = c ? c.first : "the client";
  if (t.kind === "step") return ["Do it if it is right: " + stepWords(T, t) + ". Nothing changes until you say so.", "apply_step"];
  if (t.kind === "document" && t.confirm) return ["Look at it and agree, or overrule the sniff test.", "agree"];
  if (t.kind === "document") return ["Look at it. Accept it if it is the right document, or ask " + first + " again.", "accept"];
  if (t.kind === "question" && t.urgent) return ["Check the number and the email address with " + first + " by phone. Nothing automatic is sent until you resume.", "handled"];
  if (t.kind === "question") return ["Reply to " + first + ", or mark it handled if you dealt with it another way.", "reply"];
  if (t.kind === "says_none") return ["Confirm it is not needed this year, or ask again if it should exist.", "waive"];
  if (t.kind === "change_noted") return [t.change ? "Apply the change if it is right: " + t.change.kind + " " + T.FORMS[t.change.form].plain + "." : "Decide whether the checklist should change.", "apply_change"];
  if (t.kind === "gone_quiet") return t.why === "no_reply" || t.why === "no_consent" ? ["Call " + first + " and log what happened.", "log_call"] : t.why === "opted_out" ? [first + " asked for no more messages. Reach them another way, or close the file.", "close"] : ["Check the number and the email address, then restart fetching.", "restart"];
  if (t.kind === "cant_reach") return [(T.S.firm.letters === true ? "Call " + first + " for an email address that works" : "Get a working mobile number or email address for " + first) + " and save it on their Details tab. Fetching picks up again by itself.", "handled"];
  if (t.kind === "call") return ["Call " + first + ". The script is ready.", "called"];
  return ["A message was blocked by the safety check. Message " + first + " yourself.", "handled"];
}
