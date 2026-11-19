const { createEngine } = require("../packages/engine");
const MON = () => new Date(2027, 0, 25, 10, 5, 0); // a Monday morning, inside sending hours
// A blank firm with one client (Jo Day) whose checklist is a W-2 and a mortgage statement, texting switched on.
function firm(opt) {
  const T = createEngine();
  T.blank(Object.assign({ plan: "Practice", name: "Test CPAs", email: "docs@test.example", senderStatus: "approved", mode: "autopilot", now: MON(), users: [{ id: "u1", first: "Pat", name: "Pat Owner", role: "owner", email: "pat@test.example" }, { id: "u2", first: "Alex", name: "Alex Staff", role: "staff", email: "alex@test.example" }] }, opt));
  T.importRows(T.parseCSV("First,Last,Email,Mobile,Preparer\nJo,Day,jo@x.example,6155550111,Alex"));
  const c = T.S.clients[0], e = T.engOf(c.id);
  T.itemsOf(e.id).find((i) => i.form === "W2").payer = "Acme Logistics";
  T.itemsOf(e.id).find((i) => i.form === "1098").payer = "Regions Mortgage";
  return { T, c, e };
}
// The same firm with outreach started and text consent given, first request already sent.
function started(opt) {
  const x = firm(opt); x.e.confirmed = true; x.T.start(x.e.id); x.T.giveConsent(x.c.id, "page"); x.T.advance(5 * x.T.MIN); return x;
}
const out = (T, e) => T.S.msgs.filter((m) => m.engId === e.id && m.dir === "out");
const last = (T, e) => out(T, e).slice(-1)[0];
const item = (T, e, form) => T.itemsOf(e.id).find((i) => i.form === form);
module.exports = { firm, started, out, last, item, MON };
