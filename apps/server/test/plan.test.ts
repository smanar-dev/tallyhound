// The follow-up plan (TH-PLN): the website's own examples as fixtures (Website Feature Delta, section 10, scenarios 1 to 6), and
// the property that matters most: what the plan says will be sent next is exactly what the scheduler then sends.
import test from "node:test";
import assert from "node:assert/strict";
import { createEngine, type Engine } from "../src/kit.ts";
import { planFor, channelState, PLAN_HORIZON_DAYS, type PlanEvent } from "../src/plan.ts";

/* eslint-disable @typescript-eslint/no-explicit-any */
// Maple & Pine Tax Co., one client in Chicago time, fetching from Monday, January 25, 2027.
function firm(opt: { start?: Date; items?: [string, string][]; preset?: string; consent?: boolean; first?: string; last?: string } = {}) {
  const T: Engine = createEngine(); T.blank({ plan: "Practice", name: "Maple & Pine Tax Co.", email: "docs@maplepine.example", phone: "(615) 555-0100", senderStatus: "approved", mode: "autopilot", now: opt.start || new Date(2027, 0, 25, 10, 5), users: [{ id: "u1", first: "Dana", name: "Dana Pine", role: "owner", email: "dana@maplepine.example" }] });
  T.setUser("u1"); T.importRows(T.parseCSV("First,Last,Email,Mobile\n" + (opt.first || "Maria") + "," + (opt.last || "Garcia") + ",maria@x.example,6155550111")); const c = T.S.clients[0], e = T.engOf(c.id);
  T.S.items = T.S.items.filter((i: any) => i.engId !== e.id); for (const [form, payer] of opt.items || [["W2", "Acme Logistics"]]) T.addItem(e.id, form, payer);
  if (opt.preset) T.setIntensity(opt.preset); e.confirmed = true; T.start(e.id); if (opt.consent !== false) T.giveConsent(c.id, "page"); T.advance(5 * T.MIN);
  return { T, c, e, plan: () => planFor(T, e.id, createEngine) };
}
const md = (d: Date) => ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.getDay()] + " " + (d.getMonth() + 1) + "/" + d.getDate();
const asks = (ev: PlanEvent[]) => ev.filter((x) => ["request", "reminder", "final"].includes(x.kind));
const line = (ev: PlanEvent[]) => ev.map((x) => x.kind + (x.reason ? "(" + x.reason + ")" : "") + " " + md(x.date));

test("scenario 1: Maria on Steady with one W-2: request Mon Jan 25, reminder Wed Jan 27, it arrives Fri Jan 29, and Sat Jan 30, Wed Feb 3 and Mon Feb 8 are cancelled because it arrived", () => {
  const x = firm(); let P = x.plan(); assert.equal(P.preset, "steady");
  assert.deepEqual(line(asks(P.events)), ["request Mon 1/25", "reminder Wed 1/27", "reminder Sat 1/30", "reminder Wed 2/3", "final Mon 2/8"]); assert.equal(P.events.filter((e) => e.kind === "quiet").length, 1);
  assert.deepEqual(asks(P.events).map((e) => e.status), ["sent", "planned", "planned", "planned", "planned"]); assert.deepEqual(asks(P.events).map((e) => e.day), [0, 2, 5, 9, 14]);
  x.T.advance(4 * x.T.DAY); x.T.inboundDoc(x.c.id, { form: "W2", year: 2026, payer: "Acme Logistics" }, "text"); P = x.plan();
  assert.deepEqual(line(P.events), ["request Mon 1/25", "reminder Wed 1/27", "arrived Fri 1/29", "cancelled(arrived) Sat 1/30", "cancelled(arrived) Wed 2/3", "cancelled(arrived) Mon 2/8"]);
  assert.equal(P.events.filter((e) => e.status === "planned").length, 0, "something is still planned after everything arrived");
});
test("scenario 2: Gentle asks on days 0, 3, 7, 12 and a last time on 18, never on a Sunday; a start that puts day 18 on a Sunday moves it to the Monday", () => {
  let P = firm({ preset: "gentle" }).plan(); assert.deepEqual(asks(P.events).map((e) => e.day), [0, 3, 7, 12, 18]); assert.ok(asks(P.events).every((e) => e.date.getDay() !== 0));
  P = firm({ preset: "gentle", start: new Date(2027, 0, 27, 10, 5) }).plan(); const last = asks(P.events).slice(-1)[0]!; assert.equal(md(last.date), "Tue 2/16", "day 18 is Sunday, February 14; Monday the 15th is Presidents' Day, so it goes on the Tuesday"); assert.equal(last.kind, "final"); assert.ok(asks(P.events).every((e) => e.date.getDay() !== 0));
});
test("scenario 3: Okafor Family Trust on Persistent, two items, never replies: seven asks for the first item, then one quiet event and one gone-quiet card", () => {
  const x = firm({ preset: "persistent", first: "Okafor", last: "Trust", items: [["K1", "Chen & Park LLC"], ["1099INT", "First Farmers Bank"]] }); x.T.S.items.forEach((i: any) => { i.holdOff = true; });
  const P = x.plan(), A = asks(P.events), first = A[0]!.item_id; assert.equal(A.length, 7); assert.ok(A.slice(0, 6).every((e) => e.item_id === first)); assert.deepEqual(A.map((e) => e.day), [0, 1, 3, 5, 7, 10, 12]); assert.equal(A[6]!.kind, "final");
  const quiet = P.events.filter((e) => e.kind === "quiet"); assert.equal(quiet.length, 1); assert.equal(quiet[0]!.reason, "no_reply"); assert.ok(+quiet[0]!.date >= +A[6]!.date); assert.equal(P.events.indexOf(quiet[0]!), P.events.length - 1, "something is planned after the client goes quiet");
  x.T.advance(14 * x.T.DAY); assert.equal(x.T.S.tasks.filter((t: any) => t.kind === "gone_quiet" && t.status === "open").length, 1);
});
test("scenario 4: Luis's K-1 has a catalogue date of March 15; staff hold it until March 1: one held span, and no K-1 ask before Monday, March 1", () => {
  const x = firm({ first: "Luis", last: "Ortega", items: [["K1", "Chen & Park LLC"]] }); const k1 = x.T.S.items.find((i: any) => i.form === "K1");
  let P = x.plan(), held = P.events.filter((e) => e.kind === "held"); assert.equal(held.length, 1); assert.equal(held[0]!.reason, "catalogue_date"); assert.equal(md(held[0]!.until!), "Mon 3/15");
  assert.equal(x.T.setHold(k1.id, "2027-03-01"), null); P = x.plan(); held = P.events.filter((e) => e.kind === "held"); assert.equal(held[0]!.reason, "staff_date"); assert.equal(md(held[0]!.until!), "Mon 3/1");
  const A = asks(P.events).filter((e) => e.status === "planned"); assert.ok(A.length >= 1, "nothing is planned after the hold"); assert.equal(md(A[0]!.date), "Mon 3/1"); assert.ok(A.every((e) => +e.date >= +new Date(2027, 2, 1)));
});
test("scenario 5: a hold date in the past is refused and the plan does not change", () => {
  const x = firm({ items: [["W2", "Acme Logistics"], ["1098", "Hillcrest Mortgage"]] }), before = JSON.stringify(line(x.plan().events)); assert.match(x.T.setHold(x.T.S.items[1].id, "2027-01-24"), /has passed/); assert.equal(JSON.stringify(line(x.plan().events)), before);
});
test("scenario 6: with no text consent the text preview is greyed out with the reason, and the email preview is the email later sent, byte for byte", () => {
  const x = firm({ consent: false }); x.T.declineTexts(x.c.id); x.T.advance(x.T.HOUR); const P = x.plan(), next = asks(P.events).find((e) => e.status === "planned")!;
  assert.ok(next && next.preview && next.preview.preview === true); assert.deepEqual(next.preview.channels.text, { available: false, unavailable_reason: "No text consent" }); assert.deepEqual(next.preview.channels.email, { available: true, unavailable_reason: null }); assert.equal(next.channel, "email");
  const n = x.T.S.msgs.length; x.T.advance(+next.date - +x.T.S.now + x.T.HOUR); const sent = x.T.S.msgs.slice(n).find((m: any) => m.dir === "out" && m.tpl === next.template)!; assert.ok(sent, "the planned ask never went"); assert.equal(sent.channel, "email"); assert.equal(sent.body, next.preview.body);
  assert.equal(channelState(x.T, x.c).text.unavailable_reason, "No text consent");
});

test("TH-PLN-1, 2: over 500 generated files, the first planned ask in the plan is exactly the next message the scheduler sends: same day, same template, same item, same words", () => {
  let seed = 20270125; const r = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648), pick = <X,>(L: X[]) => L[Math.floor(r() * L.length)]!;
  const FORMS: [string, string][] = [["W2", "Acme Logistics"], ["1098", "Hillcrest Mortgage"], ["1099INT", "First Farmers Bank"], ["1099DIV", "Fidelity"], ["1099NEC", "Brightline Media"]]; let checked = 0, nothing = 0;
  for (let k = 0; k < 500; k++) {
    const items = FORMS.filter(() => r() < 0.5); if (!items.length) items.push(FORMS[0]!);
    const x = firm({ start: new Date(2027, 0, 25 + Math.floor(r() * 7), 8 + Math.floor(r() * 9), 5), preset: pick(["gentle", "steady", "persistent"]), items, consent: r() < 0.8 });
    if (x.c.textConsent !== "given" && r() < 0.6) x.T.declineTexts(x.c.id);
    // Some days pass, with the odd document or "later" along the way.
    for (let d = Math.floor(r() * 9); d > 0; d--) { x.T.advance(x.T.DAY); const open = x.T.openItems(x.e.id); if (open.length && r() < 0.15) x.T.inboundDoc(x.c.id, { form: open[0].form, year: 2026, payer: open[0].payer }, "text"); else if (r() < 0.1 && x.c.textConsent === "given") x.T.inboundText(x.c.id, "I'll send it next week"); }
    const P = x.plan(), next = P.events.find((e) => e.status === "planned" && ["request", "reminder", "final"].includes(e.kind));
    for (const e of P.events.filter((y) => y.status === "planned" && y.preview)) { assert.notEqual(e.date.getDay(), 0, "an ask is planned for a Sunday"); assert.ok(e.date.getHours() >= x.T.S.firm.quietStart && e.date.getHours() < x.T.S.firm.quietEnd, "an ask is planned outside sending hours"); assert.ok(!/\$\d|\d{5,}/.test(e.preview!.body), "a preview carries a figure"); }
    const days = P.events.filter((y) => y.status === "planned" && y.preview).map((y) => y.date.toDateString() + y.channel); assert.equal(new Set(days).size, days.length, "two asks planned by one channel on one day");
    if (!next) { nothing++; continue; }
    const n = x.T.S.msgs.length; x.T.advance(+next.date - +x.T.S.now + 30 * x.T.MIN);
    const sent = x.T.S.msgs.slice(n).find((m: any) => m.dir === "out" && m.kind === "auto" && ["M3", "M4", "M19", "M5", "M22R", "M6"].includes(m.tpl));
    assert.ok(sent, "case " + k + ": the plan said " + next.template + " on " + md(next.date) + " and nothing went"); assert.equal(sent.tpl, next.template, "case " + k); assert.equal(sent.itemId || null, next.item_id, "case " + k); assert.equal(sent.body, next.preview!.body, "case " + k); assert.equal(new Date(sent.at).toDateString(), next.date.toDateString(), "case " + k); checked++;
  }
  assert.ok(checked > 350, "only " + checked + " files had a next ask to check (" + nothing + " had none)");
});
test("TH-PLN-3, 8: a plan for 40 items comes back fast, stops at the horizon, and holds no amount or identifier", () => {
  const forms = ["W2", "1098", "1099INT", "1099DIV", "1099NEC", "1099K", "1099R", "1098T", "1098E", "1095A"], items: [string, string][] = Array.from({ length: 40 }, (_, i) => [forms[i % forms.length]!, "Payer " + String.fromCharCode(65 + (i % 26)) + " Co"]);
  const x = firm({ items }); x.plan(); const t0 = Date.now(), P = x.plan(), ms = Date.now() - t0; assert.ok(ms < 300, "the plan took " + ms + " ms");
  assert.ok(P.events.every((e) => +e.date <= +P.horizon_end + 21 * 86400000)); assert.equal(Math.round((+P.horizon_end - +P.day0!) / 86400000), PLAN_HORIZON_DAYS); assert.ok(!/\$\d|\d{3}-\d{2}-\d{4}/.test(JSON.stringify(P)));
});
test("TH-PLN: a paused file, a client nobody can reach, and a file not yet started each say why nothing is planned", () => {
  let x = firm(); x.T.pause(x.e.id); assert.match(x.plan().note!, /paused/); assert.equal(x.plan().events.filter((e) => e.status === "planned").length, 0);
  x = firm(); x.c.email = ""; x.c.emailOk = false; x.T.inboundText(x.c.id, "STOP"); assert.match(x.plan().note!, /No way to reach/);
  const T: Engine = createEngine(); T.blank({ plan: "Practice", name: "Maple & Pine Tax Co.", email: "d@m.example", now: new Date(2027, 0, 25, 10, 5), users: [{ id: "u1", first: "Dana", name: "Dana Pine", role: "owner", email: "dana@m.example" }] }); T.setUser("u1"); T.importRows(T.parseCSV("First,Last,Email\nMaria,Garcia,maria@x.example")); assert.match(planFor(T, T.S.engs[0].id, createEngine).note!, /until you say go fetch/);
});

test("an email-first firm's plan: the letters that will go, each in the row of every document it names; a document that arrives leaves the next letters; the bark after the last", () => {
  const T: Engine = createEngine(); T.blank({ letters: true, plan: "Practice", name: "Maple & Pine Tax Co.", email: "docs@maplepine.example", mode: "copilot", confirmAll: false, now: new Date(2027, 0, 25, 10, 5), users: [{ id: "u1", first: "Dana", name: "Dana Whitfield", role: "owner", email: "dana@maplepine.example" }] });
  T.S.firm.linkBase = "send.tallyhound.example"; T.S.firm.slug = "maple"; T.importRows(T.parseCSV("First,Last,Email\nMaria,Garcia,maria@x.example")); const c = T.S.clients[0], e = T.engOf(c.id); T.itemsOf(e.id).find((i: any) => i.form === "W2").payer = "Acme Logistics"; e.confirmed = true; T.start(e.id); T.advance(5 * T.MIN);
  const [w2, m] = T.itemsOf(e.id), P = planFor(T, e.id, createEngine), asks = P.events.filter((x) => ["request", "reminder", "final"].includes(x.kind));
  assert.equal(asks[0]!.template, "L1"); assert.equal(asks[0]!.status, "queued", "the first letter waits for approval"); assert.deepEqual(asks[0]!.item_ids!.sort(), [w2.id, m.id].sort());
  const planned = asks.filter((x) => x.status === "planned"); assert.deepEqual(planned.map((x) => x.template), ["L2", "L2", "L2", "L3"]); assert.ok(planned.every((x) => x.preview && /Upload them here|Upload here/.test(x.preview.body) && x.window!.start === "09:00"));
  assert.equal(P.events.filter((x) => x.kind === "quiet").length, 1); assert.deepEqual(channelState(T, c).text, { available: false, unavailable_reason: "Letters go by email" });
  // The W-2 arrives: the letters after it name only the mortgage statement, and the plan changed nothing.
  const before = JSON.stringify(T.dump()); planFor(T, e.id, createEngine); assert.equal(JSON.stringify(T.dump()), before, "working out the plan changed the firm");
  T.inboundDoc(c.id, { form: "W2", year: 2026, payer: "Acme Logistics" }, "portal"); const P2 = planFor(T, e.id, createEngine);
  assert.ok(P2.events.filter((x) => x.status === "planned" && x.item_ids).every((x) => !x.item_ids!.includes(w2.id) && x.item_ids!.includes(m.id))); assert.ok(P2.events.some((x) => x.kind === "arrived" && x.item_id === w2.id));
  // With the mail layer and no mailbox, nothing is planned and the plan says why.
  const U: Engine = createEngine(); U.blank({ letters: true, mail: "mailbox", plan: "Practice", name: "F", email: "f@f.example", mode: "autopilot", now: new Date(2027, 0, 25, 10, 5), users: [{ id: "u1", first: "Dana", name: "Dana Whitfield", role: "owner", email: "d@f.example" }] });
  U.importRows(U.parseCSV("First,Last,Email\nMaria,Garcia,maria@x.example")); const ue = U.S.engs[0]; U.setMailbox("u1", { provider: "google", address: "d@f.example" }); ue.confirmed = true; U.start(ue.id); U.setMailbox("u1", null);
  assert.match(String(planFor(U, ue.id, createEngine).note), /Dana Whitfield has no mailbox connected/);
});
