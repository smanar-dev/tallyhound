// The one job: client list, checklist, chase, verify. These tests pin the parts added for it.
const test = require("node:test");
const assert = require("node:assert/strict");
const { firm, started, item } = require("./helpers");

test("a single client can be added by hand with a checklist template", () => {
  const { T } = firm();
  const r = T.addClient({ first: "Priya", last: "Raman", mobile: "615 555 0142", template: "t_self" });
  assert.equal(r.ok, true);
  assert.deepEqual(T.itemsOf(r.engId).map((i) => i.form).sort(), ["1095A", "1099K", "1099NEC", "ESTPAY", "PRIOR"]);
  assert.equal(T.eng(r.engId).status, "not_started");
});
test("adding a client with no way to reach them, or twice, is refused with a reason", () => {
  const { T } = firm();
  assert.equal(T.addClient({ first: "No", last: "Contact" }).why, "Needs an email or a mobile number");
  assert.equal(T.addClient({ first: "Jo", last: "Day", email: "jo@x.example" }).why, "Duplicate of an existing client");
});
test("applying a template only adds what is missing and never removes an item", () => {
  const { T, e } = firm();
  const before = T.itemsOf(e.id).length;
  const added = T.applyTemplate(e.id, "t_family", { confirm: true });
  assert.equal(added, 4); assert.equal(T.itemsOf(e.id).length, before + 4); assert.equal(e.confirmed, true);
  assert.equal(T.applyTemplate(e.id, "t_family"), 0);
  assert.equal(item(T, e, "W2").payer, "Acme Logistics");
});
test("a firm can save its own template, and unknown forms are dropped", () => {
  const { T } = firm();
  const t = T.saveTemplate({ name: "Gig driver", items: ["1099K", "1099NEC", "NOT_A_FORM"] });
  assert.deepEqual(t.items, ["1099K", "1099NEC"]);
  assert.equal(T.saveTemplate({ name: "", items: ["W2"] }), null);
  T.load(T.dump()); assert.ok(T.templates().some((x) => x.name === "Gig driver"));
});
test("a good document passes all three checks", () => {
  const { T, c } = started();
  const d = T.inboundDoc(c.id, { form: "W2", year: 2026, payer: "Acme Logistics" }, "text"), v = T.verdict(d);
  assert.equal(d.state, "accepted"); assert.equal(v.pass, true);
  assert.deepEqual([v.doc.ok, v.info.ok, v.clear.ok], [true, true, true]);
});
test("a blurry photo fails 'clear' and the other two checks wait", () => {
  const { T, c } = started();
  const v = T.verdict(T.inboundDoc(c.id, { form: "W2", year: 2026, payer: "Acme Logistics", quality: "blurry" }, "text"));
  assert.equal(v.clear.ok, false); assert.equal(v.doc.ok, null); assert.equal(v.info.ok, null); assert.equal(v.fail, true);
});
test("last year's form fails 'right document'", () => {
  const { T, c } = started();
  const v = T.verdict(T.inboundDoc(c.id, { form: "W2", year: 2025, payer: "Acme Logistics" }, "text"));
  assert.equal(v.doc.ok, false); assert.match(v.doc.why, /2025/); assert.equal(v.clear.ok, true);
});
test("a missing part or someone else's name fails 'right information'", () => {
  const { T, c } = started();
  const key = T.ELEMENTS.W2[0][0];
  const a = T.verdict(T.inboundDoc(c.id, { form: "W2", year: 2026, payer: "Acme Logistics", missing: [key] }, "text"));
  assert.equal(a.info.ok, false); assert.equal(a.doc.ok, true);
  const b = T.verdict(T.inboundDoc(c.id, { form: "1098", year: 2026, payer: "Regions Mortgage", recipient: "other" }, "text"));
  assert.equal(b.info.ok, false); assert.match(b.info.why, /nobody on this return/);
});
test("the pipeline counts each client once per stage", () => {
  const { T, c } = started();
  const p = Object.fromEntries(T.pipeline().map((x) => [x.key, x.n]));
  assert.deepEqual(p, { clients: 1, checklist: 1, chasing: 1, check: 0, complete: 0 });
  T.inboundDoc(c.id, { form: "W2", year: 2026, payer: "Acme Logistics" }, "text");
  T.inboundDoc(c.id, { form: "1098", year: 2026, payer: "Regions Mortgage" }, "text");
  assert.equal(Object.fromEntries(T.pipeline().map((x) => [x.key, x.n])).complete, 1);
});
