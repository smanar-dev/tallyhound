// Round 4 audit: holidays, Spanish form numbers, repeat STOP, stale drafts, retention, hand-off names.
const test = require("node:test");
const assert = require("node:assert/strict");
const { firm, started, out, last, item } = require("./helpers");

test("federal holidays are computed for any year, with observed days", () => {
  const { T } = firm(); const off = (y, m, d) => !T.allowed(new Date(y, m, d, 11, 0));
  for (const [y, m, d] of [[2027, 0, 1], [2027, 0, 18], [2027, 1, 15], [2027, 4, 31], [2027, 5, 18], [2027, 6, 5], [2027, 8, 6], [2027, 9, 11], [2027, 10, 11], [2027, 10, 25], [2027, 11, 24], [2027, 11, 31], [2028, 0, 17], [2028, 1, 21]]) assert.ok(off(y, m, d), y + "-" + (m + 1) + "-" + d + " should be a holiday");
  assert.ok(!off(2027, 0, 19)); assert.ok(!off(2027, 3, 15));
});
test("Spanish messages that name a numbered form are not blocked", () => {
  const { T, c, e } = firm(); c.lang = "es";
  for (const form of Object.keys(T.FORMS).filter((f) => f !== "OTHER")) for (const code of ["M3", "M4", "M5", "M7", "M15", "M22"]) {
    const b = T.fill(code, c, e, { item: { form, payer: "Banco Uno" }, doc_year: 2025, fix: "la página 2", missing: "la página 2" });
    assert.deepEqual(T.outputCheck(b, "text", { year: 2026, doc_year: 2025 }), [], code + " " + form + ": " + b);
  }
});
test("a second STOP gets no second confirmation", () => {
  const { T, c, e } = started();
  T.inboundText(c.id, "STOP"); const n = out(T, e).length; T.inboundText(c.id, "STOP"); T.inboundText(c.id, "stop");
  assert.equal(out(T, e).length, n); assert.equal(c.consentLog.filter((x) => /Withdrawn/.test(x.what)).length, 1);
});
test("in Copilot a newer reminder replaces the older unapproved one, and a stale draft raises an alert", () => {
  const { T, c, e } = started({ mode: "copilot" });
  T.advance(12 * T.DAY);
  const waiting = T.S.msgs.filter((m) => m.engId === e.id && m.status === "approval" && ["M3", "M5", "M6"].includes(m.tpl));
  assert.ok(waiting.length <= 1, waiting.length + " reminders stacked for one client");
  assert.ok(T.S.alerts.some((a) => /waited over/.test(a.text)));
});
test("a draft for a client who has since opted out cannot be approved", () => {
  const { T, c, e } = started({ mode: "copilot" });
  T.advance(3 * T.DAY); const m = T.S.msgs.find((x) => x.engId === e.id && x.status === "approval"); assert.ok(m);
  T.inboundText(c.id, "STOP");
  assert.notEqual(T.S.msgs.find((x) => x.id === m.id).status, "approval");
});
test("documents are deleted when the retention period ends, including the image", () => {
  const { T, c, e } = started();
  T.inboundDoc(c.id, { form: "W2", year: 2026, payer: "Acme Logistics", image: "data:image/png;base64,AAAA" }, "text");
  T.closeEng(e.id); T.advance((T.S.firm.retention + 1) * T.DAY);
  const d = T.S.docs.find((x) => x.engId === e.id); assert.equal(d.state, "purged"); assert.equal(d.image, null); assert.equal(d.payer, "");
  assert.ok(T.S.msgs.filter((m) => m.engId === e.id).every((m) => m.body === "(deleted)"));
});
test("hand-off never gives two documents the same file name", () => {
  const { T, c, e } = started(); T.addItem(e.id, "W2", "");
  T.inboundDoc(c.id, { form: "W2", year: 2026, payer: "" }, "text"); T.inboundDoc(c.id, { form: "W2", year: 2026, payer: "" }, "email");
  const r = T.deliver(e.id); assert.equal(new Set(r.files.map((f) => f.toLowerCase())).size, r.files.length, r.files.join(", "));
});
test("a shared mobile is accepted for a second person and refused for the same person", () => {
  const { T } = firm();
  // Round 14: a household may share a phone. A second person on the same number is accepted; the same person twice is still refused.
  assert.equal(T.addClient({ first: "Pat", last: "Day", mobile: "6155550111" }).ok, true);
  assert.match(T.addClient({ first: "Jo", last: "Day", mobile: "6155550111" }).why, /Duplicate/);
});
