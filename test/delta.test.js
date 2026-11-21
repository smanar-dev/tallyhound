// The acceptance scenarios of the Website Feature Delta spec (section 10) that the engine alone decides: 7 and 10 to 17, 21, 22,
// and the spec's property that no trace line, panel string or activity row carries an amount or an identifier.
// Scenarios 1 to 6 (the plan) are in apps/server/test/plan.test.ts; 8, 9, 13, 19 and 20 are with their rules in engine.test.js.
const test = require("node:test");
const assert = require("node:assert/strict");
const { started, last, item } = require("./helpers");
const v2 = (opt) => { const x = started(Object.assign({ replyV2: "on" }, opt)); x.T.setUser("u2"); return x; };
const open = (T, e, kind) => T.S.tasks.filter((t) => t.status === "open" && t.engId === e.id && (!kind || t.kind === kind));
const lastIn = (T, e) => T.S.msgs.filter((m) => m.engId === e.id && m.dir === "in").slice(-1)[0];
const fail = (t) => t.steps.find((x) => x.status === "fail");

test("scenario 7: \"Can I send it after the 15th?\" pauses that document until the 16th and the panel says so", () => {
  const { T, c, e } = v2(); T.advance(2 * T.DAY); T.inboundText(c.id, "Can I send it after the 15th?");
  const m = lastIn(T, e), P = T.panelOf(m); assert.equal(P.intent, "send_after_date");
  const f = P.fields.find((x) => x.label === "Date"); assert.equal(f.display, "February 15"); assert.equal(P.action.code, "pause_item");
  const held = T.itemsOf(e.id).map((i) => T.holdOf(i, e)).find(Boolean); assert.ok(held, "nothing was held"); assert.equal(held.reason, "client_date");
  const u = new Date(held.until); assert.equal(u.getMonth() + "/" + u.getDate(), "1/16"); assert.ok(T.activity(c.id, "decision").some((r) => /wait until February 16/.test(r.summary) && r.actorType === "client"));
  assert.equal(last(T, e).tpl, "M20D");
});
test("scenario 11: a tax question gets no advice, a question for the preparer, and a panel that says it was passed on", () => {
  const { T, c, e } = v2(); T.inboundText(c.id, "can I deduct my home office?");
  assert.equal(open(T, e, "question").length, 1); const P = T.panelOf(lastIn(T, e)); assert.equal(P.intent, "question"); assert.equal(P.team.code, "question");
  const reply = last(T, e); assert.equal(reply.tpl, "M14"); assert.ok(!/deduct|you can|you should/i.test(reply.body), "the reply reads like advice");
  assert.deepEqual(T.barkRoute(open(T, e, "question")[0]), ["u2"], "the question did not go to the client's preparer");
});
test("scenario 12: STOP with a working email stops texts, confirms, notes it, and barks at nobody", () => {
  const { T, c, e } = v2(); const tasks = T.S.tasks.length, barks = (T.S.barks || []).length; T.inboundText(c.id, "STOP");
  assert.equal(c.textConsent, "withdrawn"); assert.equal(last(T, e).tpl, "M16"); assert.equal(T.S.tasks.length, tasks); assert.equal((T.S.barks || []).length, barks);
  assert.ok(T.activity(c.id, "message").some((r) => r.actorType === "client" && /STOP/.test(r.summary))); assert.equal(T.channelFor(c, e), "email");
  assert.equal(T.panelOf(lastIn(T, e)).team.text, "Nothing to do.");
});
test("scenarios 13 and 22: STOP with no email opens one can't-reach item for the office manager, or the owners when nobody is marked", () => {
  const { T, c, e } = v2(); c.email = ""; T.inboundText(c.id, "STOP"); T.inboundText(c.id, "stop");
  const t = open(T, e, "cant_reach"); assert.equal(t.length, 1); assert.deepEqual(T.barkRoute(t[0]), ["u1"], "with no office manager it goes to the owners");
  T.setUser("u1"); assert.equal(T.setDuty("u2", true), null); assert.deepEqual(T.barkRoute(t[0]), ["u2"]);
  assert.match(t[0].context.failed.join(" "), /replied STOP/); assert.match(t[0].context.failed.join(" "), /no address/);
});
test("scenario 14: a clean W-2 passes every step that applies and is filed under the firm's naming", () => {
  const { T, c, e } = v2(); T.S.firm.delivery = { provider: "Google Drive", folder: "Client Tax Docs" };
  const d = T.inboundDoc(c.id, { form: "W2", year: 2026, payer: "Acme Logistics" }, "portal"); d.master = { id: "x1" }; d.contentType = "application/pdf";
  const t = T.traceOf(d); assert.equal(d.state, "accepted"); assert.equal(t.outcome, "passed"); assert.equal(t.steps.length, 8); assert.ok(t.steps.every((x) => x.status === "pass"), JSON.stringify(t.steps.filter((x) => x.status !== "pass")));
  assert.equal(t.filed_path, "Client Tax Docs/2026/Day, Jo/2026 W-2 Acme Logistics.pdf");
});
test("scenario 15: last year's W-2 stops at step 4, the later steps are not reached, the re-ask says when the form usually arrives, and nothing is filed", () => {
  const { T, c, e } = v2(); const d = T.inboundDoc(c.id, { form: "W2", year: 2025, payer: "Acme Logistics" }, "text"), t = T.traceOf(d), i = t.steps.findIndex((x) => x.status === "fail");
  assert.equal(i, 3); assert.equal(t.steps[i].display, "2025, not 2026"); assert.ok(t.steps.slice(4).every((x) => x.status === "skip")); assert.equal(t.filed_path, null);
  assert.equal(last(T, e).tpl, "M7"); assert.match(last(T, e).body, /It usually arrives by January 31\./); assert.equal(item(T, e, "W2").state, "requested");
});
test("scenario 16: a W-2 in a name that is on nobody's return stops at step 5, goes to a person, and the client is told nothing", () => {
  const { T, c, e } = v2(), n = T.S.msgs.filter((m) => m.dir === "out").length; const d = T.inboundDoc(c.id, { form: "W2", year: 2026, payer: "Acme Logistics", recipient: "other" }, "text");
  assert.equal(fail(T.traceOf(d)).step, "recipient"); assert.equal(T.traceOf(d).steps.findIndex((x) => x.status === "fail"), 4); assert.equal(d.state, "in_review"); assert.equal(open(T, e, "document").length, 1);
  assert.equal(T.S.msgs.filter((m) => m.dir === "out" && m.status !== "discarded").length, n, "the client was sent something about another person's document");
});
test("scenario 17 (C6): a blurry photo stops at step 7 and is asked for again; the third goes to a person", () => {
  const { T, c, e } = v2(), blurry = { form: "W2", year: 2026, payer: "Acme Logistics", quality: "blurry" }; const d = T.inboundDoc(c.id, blurry, "text"), t = T.traceOf(d);
  assert.equal(fail(t).step, "legible"); assert.equal(t.steps.findIndex((x) => x.status === "fail"), 6); assert.equal(t.steps[7].status, "skip"); assert.equal(last(T, e).tpl, "M8");
  T.inboundDoc(c.id, blurry, "text"); assert.equal(T.inboundDoc(c.id, blurry, "text").state, "in_review");
});
test("scenarios 10 and 21: the Decisions filter shows the hold and the applied change, newest first, each with who did it", () => {
  const { T, c, e } = v2(); T.inboundText(c.id, "Can I send the W-2 after the 15th?"); T.advance(T.HOUR); T.inboundText(c.id, "We sold the house in June");
  const before = T.itemsOf(e.id).map((i) => i.form + ":" + i.state).join(), t = open(T, e, "change_noted")[0]; assert.ok(t.changes.length >= 2);
  assert.equal(T.itemsOf(e.id).map((i) => i.form + ":" + i.state).join(), before); T.advance(T.HOUR); assert.equal(T.decideTask(t.id, "apply_change", { pick: [0] }), null);
  const rows = T.activity(c.id, "decision"); assert.ok(rows.length >= 2); assert.ok(rows.every((r) => r.kind === "decision" && r.actor));
  for (let i = 1; i < rows.length; i++) assert.ok(+new Date(rows[i - 1].at) >= +new Date(rows[i].at));
  const drop = rows.findIndex((r) => /^Not needed this year: .*sold/i.test(r.summary)), hold = rows.findIndex((r) => /wait until February 16/.test(r.summary));
  assert.ok(drop >= 0, rows.map((r) => r.summary).join(" | ")); assert.equal(rows[drop].actor, "Alex Staff"); assert.equal(rows[drop].actorType, "user"); assert.ok(hold > drop, "the hold is missing or out of order: " + rows.map((r) => r.summary).join(" | "));
});
test("property: no trace line, panel string or activity row for the demo firm holds a dollar amount or a run of five digits", () => {
  const T = require("../packages/engine").createEngine(), bad = /\$\s?\d|\d{5,}/;
  for (const L of ["en", "es"]) { for (const d of T.S.docs) for (const s of T.traceOf(d, L).steps) assert.ok(!bad.test(s.label + s.display), s.display);
    for (const m of T.S.msgs) { const P = T.panelOf(m, L); if (P) assert.ok(!bad.test(P.summary + P.action.text + P.team.text + P.fields.map((f) => f.display).join(" ")), P.summary); } }
  for (const c of T.S.clients) for (const r of T.activity(c.id, "decision").concat(T.activity(c.id, "document"))) assert.ok(!bad.test(r.summary), r.summary);
});
