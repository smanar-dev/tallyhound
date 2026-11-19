// Round 3 audit: real-world CSVs, client time zones, silence on files that are not active, the firm's own clock.
const test = require("node:test");
const assert = require("node:assert/strict");
const { firm, started, out, last, item } = require("./helpers");
const { wallTime } = require("../packages/core/pipeline");

test("the importer reads quoted commas, +1 numbers, semicolons, tabs, a byte order mark and blank lines", () => {
  const { T } = firm(); const imp = (t) => T.importRows(T.parseCSV(t));
  assert.equal(imp('First,Last,Email,Mobile\n"Smith, Jr.",Lee,"a@b.example","(615) 555-0142"').ok, 1);
  assert.equal(imp("First,Last,Mobile\nAna,Diaz,+1 615-555-0143").ok, 1);
  assert.equal(imp("First;Last;Email\nCy;Dunn;cy@d.example").ok, 1);
  assert.equal(imp("First\tLast\tEmail\tState\nEd\tFox\ted@f.example\tCA").ok, 1);
  assert.equal(imp("﻿First Name,Last Name,E-mail,Cell\r\n\r\nBo,Chan,bo@c.example,615.555.0144\r\n,,,\r\n").ok, 1);
  const by = (l) => T.S.clients.find((c) => c.last === l);
  assert.equal(by("Lee").first, "Smith, Jr."); assert.equal(by("Diaz").mobile, "6155550143"); assert.equal(by("Fox").tz, "PT");
});
test("one Name column is split, in either order", () => {
  const { T } = firm();
  T.importRows(T.parseCSV('Client Name,Email\nGia Hart,gia@h.example\n"Ito, Jun",jun@i.example'));
  assert.ok(T.S.clients.find((c) => c.first === "Gia" && c.last === "Hart")); assert.ok(T.S.clients.find((c) => c.first === "Jun" && c.last === "Ito"));
});
test("names are stripped of markup and spreadsheet formula characters on import", () => {
  const { T } = firm();
  T.importRows(T.parseCSV("First,Last,Email\n<img src=x onerror=alert(1)>,=cmd|x,x@y.example"));
  const c = T.S.clients[T.S.clients.length - 1]; assert.doesNotMatch(c.first + c.last, /[<>]/); assert.doesNotMatch(c.last, /^=/);
});
test("garbage, empty and half-quoted files never throw", () => {
  const { T } = firm();
  for (const t of ["", "garbage", 'a,b\n"unclosed', ",,,\n,,,", null]) assert.doesNotThrow(() => T.importRows(T.parseCSV(t)));
});
test("a Pacific client of a Central firm is not texted before 8 am Pacific", () => {
  const { T, c, e } = firm(); T.setZone(c.id, "PT"); e.confirmed = true; T.start(e.id); T.giveConsent(c.id, "page");
  T.advance(4 * T.DAY);
  const pro = out(T, e).filter((m) => ["M3", "M5", "M6", "M10"].includes(m.tpl)); assert.ok(pro.length >= 2);
  for (const m of pro) { const h = new Date(m.at.getTime() + T.tzOff(c) * T.HOUR).getHours(); assert.ok(h >= T.S.firm.quietStart && h < T.S.firm.quietEnd, m.tpl + " at Pacific hour " + h); }
  assert.ok(pro.every((m) => m.at.getHours() >= 10), "nothing before 10 am Central");
});
test("an Eastern client is not texted after 8 pm Eastern", () => {
  const { T, c, e } = started(); T.setZone(c.id, "ET");
  T.inboundText(c.id, "I don't have that"); const task = T.S.tasks.find((t) => t.kind === "says_none" && t.status === "open");
  T.setNow(new Date(2027, 0, 25, 19, 30)); const n = out(T, e).length;   // 7:30 pm Central is 8:30 pm Eastern
  T.decideTask(task.id, "ask_again", {}); assert.equal(out(T, e).length, n);
});
test("a document sent before outreach starts is checked and thanked, but nothing else is requested", () => {
  const { T, c, e } = firm(); c.textConsent = "given";
  const d = T.inboundDoc(c.id, { form: "W2", year: 2026, payer: "Acme Logistics" }, "text");
  assert.equal(d.state, "accepted"); assert.equal(e.status, "not_started"); assert.equal(last(T, e).tpl, "M27");
  assert.equal(out(T, e).filter((m) => ["M3", "M4", "M5"].includes(m.tpl)).length, 0);
});
test("a document sent after a file is closed goes to staff and the client is not chased", () => {
  const { T, c, e } = started();
  T.inboundDoc(c.id, { form: "W2", year: 2026, payer: "Acme Logistics" }, "text");
  T.closeEng(e.id); const n = out(T, e).length;
  const d = T.inboundDoc(c.id, { form: "1099INT", year: 2026, payer: "First Bank" }, "text");
  assert.equal(d.state, "in_review"); assert.ok(T.S.tasks.some((t) => t.docId === d.id && t.status === "open"));
  const after = out(T, e).slice(n); assert.deepEqual(after.map((m) => m.tpl), ["M12"]);
  T.advance(5 * T.DAY); assert.equal(out(T, e).length, n + 1);
});
test("the firm's wall clock is used whatever zone the server runs in", () => {
  const utc = new Date(Date.UTC(2027, 0, 25, 15, 30, 0));
  assert.equal(wallTime(utc, "America/Chicago").getHours(), 9); assert.equal(wallTime(utc, "America/Los_Angeles").getHours(), 7);
  assert.equal(wallTime(new Date(Date.UTC(2027, 0, 25, 3, 0, 0)), "America/Chicago").getDay(), 0, "still Sunday evening in Chicago");
});
test("one action on a large firm does not walk every file", () => {
  const { T } = firm(); let csv = "First,Last,Email\n"; for (let i = 0; i < 1500; i++) csv += "C" + i + ",T" + i + ",c" + i + "@s.example\n";
  T.importRows(T.parseCSV(csv)); const c = T.S.clients[900]; c.textConsent = "given";
  const t0 = process.hrtime.bigint(); for (let i = 0; i < 20; i++) T.inboundText(c.id, "thanks"); const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  assert.ok(ms < 400, "20 texts took " + Math.round(ms) + " ms");
});
