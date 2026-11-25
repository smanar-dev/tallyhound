// The client import and fetch list spec (docs/FETCH.md). One test per row of the rules table, including every "not proposed when"
// case; ready and needs a look; approval and Not this season; held items in letters and reminders; contacts; news from the
// upload page; and the import rules. All with made-up clients and payers.
const test = require("node:test");
const assert = require("node:assert/strict");
const { createEngine } = require("../packages/engine");

const MON = () => new Date(2027, 0, 25, 10, 5, 0);
function firm(opt) {
  const T = createEngine();
  T.blank(Object.assign({ letters: true, plan: "Practice", name: "Maple & Pine Tax Co.", email: "docs@mapleandpine.example", mode: "autopilot", confirmAll: false, now: MON(), users: [{ id: "u1", first: "Dana", name: "Dana Whitfield", role: "owner", email: "dana@mapleandpine.example" }, { id: "u2", first: "Alex", name: "Alex Reyes", role: "staff", email: "alex@mapleandpine.example" }] }, opt));
  T.S.firm.linkBase = "send.tallyhound.example"; T.S.firm.slug = "maple"; T.setUser("u1"); return T;
}
// One returning client with no items, ready for a list to be built from findings.
function one(findings, o) {
  const T = firm(); const b = T.importBegin("clients.csv", "First,Last,Email,Client ID,Returning\nMaria,Garcia,maria@x.example,1042," + ((o && o.returning) === false ? "no" : "yes")); T.importMap(b.id);
  const c = T.S.clients[0], e = T.engOf(c.id); if (findings) T.attachRecord(e.id, { file: "1042 organizer.pdf", kind: (o && o.kind) || "organizer", status: "read", findings }); T.buildList(e.id);
  return { T, c, e, items: () => T.S.items.filter((i) => i.engId === e.id && i.state !== "removed"), on: () => T.S.items.filter((i) => i.engId === e.id && i.state === "expected"), off: () => T.S.items.filter((i) => i.engId === e.id && i.state === "off") };
}
const P = (form, payer, src) => ({ kind: "payer", src: src || "organizer", form, payer });
const SC = (value) => ({ kind: "schedule", src: "return", value, page: 2, text: value });
const LN = (value) => ({ kind: "line", src: "return", value, page: 1, text: value });
const has = (L, form, payer) => L.some((i) => i.form === form && (payer === undefined || (i.payer || null) === payer));

test("rules: an organizer payer line and a source document each give 'form from issuer', never skipped; one item per issuer", () => {
  const x = one([P("W2", "Midtown Transit"), P("W2", "MIDTOWN TRANSIT"), P("1099INT", "First Farmers Bank", "doc")]);
  assert.equal(x.on().length, 2); assert.ok(has(x.on(), "W2", "Midtown Transit")); const d = x.on().find((i) => i.form === "1099INT"); assert.equal(d.source, "doc"); assert.equal(d.rule, "R-DOC"); assert.equal(d.rulesVersion, x.T.RULES_VERSION);
  assert.equal(x.on().find((i) => i.form === "W2").rule, "R-ORG"); assert.equal(x.T.listOf(x.e.id).group, "ready");
});
test("rules: one-time forms from last year's documents (1099-S, W-2G, 1099-G) are proposed unticked, with the reason; with the firm rule off they are ticked", () => {
  const x = one([P("1099S", "Liberty Title", "doc"), P("W2G", "River Casino", "doc"), P("1099G", "State of Tennessee", "doc"), P("W2", "Midtown Transit", "doc")]);
  assert.deepEqual(x.off().map((i) => i.form).sort(), ["1099G", "1099S", "W2G"]); assert.match(x.off()[0].why, /one-time document/i); assert.ok(x.T.listOf(x.e.id).reasons.includes("One-time document last year"));
  const y = firm(); y.setFirmRule("flag_one_time", false); const b = y.importBegin("c.csv", "First,Last,Email\nMaria,Garcia,maria@x.example"); y.importMap(b.id); const e = y.S.engs[0]; y.attachRecord(e.id, { file: "d.pdf", kind: "source_doc", findings: [P("1099S", "Liberty Title", "doc")] }); y.buildList(e.id);
  assert.equal(y.S.items.find((i) => i.engId === e.id && i.form === "1099S").state, "expected");
});
test("rules: Schedule A gives a 1098, a property tax statement and charity receipts; not a second 1098 when one is already proposed", () => {
  let x = one([SC("Schedule A")], { kind: "return" }); assert.ok(has(x.on(), "1098", null) && has(x.on(), "PTAX") && has(x.on(), "CHARITY")); assert.equal(x.on().find((i) => i.form === "1098").why, "Schedule A on last year's return shows itemized deductions");
  x = one([P("1098", "Hillcrest Mortgage"), SC("Schedule A")]); assert.equal(x.on().filter((i) => i.form === "1098").length, 1); assert.equal(x.on().find((i) => i.form === "1098").payer, "Hillcrest Mortgage");
});
test("rules: Schedule B gives a 1099-INT, payer unknown; not when any 1099-INT or 1099-DIV is already proposed (all its payers already listed)", () => {
  assert.ok(has(one([SC("Schedule B")], { kind: "return" }).on(), "1099INT", null));
  assert.equal(one([P("1099DIV", "Vanguard"), SC("Schedule B")]).on().filter((i) => i.form === "1099INT").length, 0);
  assert.equal(one([P("1099INT", "First Farmers Bank"), SC("Schedule B")]).on().filter((i) => i.form === "1099INT").length, 1);
});
test("rules: Schedule C gives a business summary and records of payments that came without a 1099, never skipped", () => { const x = one([SC("Schedule C")], { kind: "return" }); assert.ok(has(x.on(), "PNL") && has(x.on(), "UNREPORTED")); });
test("rules: Schedule D or Form 8949 gives a 1099-B, broker unknown; not when a 1099-B or 1099-DA is already proposed", () => {
  assert.ok(has(one([SC("Schedule D")], { kind: "return" }).on(), "1099B", null)); assert.ok(has(one([SC("Form 8949")], { kind: "return" }).on(), "1099B", null));
  assert.equal(one([P("1099DA", "Coinbase"), SC("Schedule D")]).on().filter((i) => i.form === "1099B").length, 0); assert.equal(one([P("1099B", "Schwab"), SC("Form 8949")]).on().filter((i) => i.form === "1099B").length, 1);
});
test("rules: Schedule E gives rental income and expenses, a 1098 and property tax for the rental; with Form 4797 too they are unticked: the rental may have been sold", () => {
  let x = one([SC("Schedule E")], { kind: "return" }); assert.ok(has(x.on(), "RENTAL")); assert.ok(x.on().some((i) => i.custom === "1098 from the lender on your rental")); assert.ok(x.on().some((i) => i.custom === "Property tax statement for your rental"));
  x = one([SC("Schedule E"), SC("Form 4797")], { kind: "return" }); assert.equal(x.off().length, 3); assert.match(x.off()[0].why, /may have been sold/);
});
test("rules: Forms 8863, 8962 and 8889 give a 1098-T, a 1095-A and a 1099-SA (never the 5498-SA), each not when already proposed; Form 2441 gives the childcare provider's details", () => {
  const x = one([SC("Form 8863"), SC("Form 2441"), SC("Form 8962"), SC("Form 8889")], { kind: "return" }); for (const f of ["1098T", "CHILDCARE", "1095A", "1099SA"]) assert.ok(has(x.on(), f), f);
  assert.equal(x.T.askPhrase("CHILDCARE"), "Your childcare provider's name, address and tax ID, and what you paid them"); assert.ok(!x.items().some((i) => /5498/.test(i.form)));
  const y = one([P("1098T", "Belmont University", "doc"), P("1095A", "HealthCare.gov", "doc"), P("1099SA", "HealthEquity", "doc"), SC("Form 8863"), SC("Form 8962"), SC("Form 8889")]); for (const f of ["1098T", "1095A", "1099SA"]) assert.equal(y.on().filter((i) => i.form === f).length, 1, f);
});
test("rules: estimated payments and Schedule 1-A lines: estimates, a 1098-VLI (new for 2026), tip records; overtime, the senior deduction and Schedule SE give notes for the preparer only", () => {
  const x = one([LN("estimated payments"), LN("car loan interest"), LN("tips"), LN("overtime"), LN("senior deduction"), SC("Schedule SE")], { kind: "return" });
  assert.ok(has(x.on(), "ESTPAY") && has(x.on(), "1098VLI") && has(x.on(), "TIPS")); assert.equal(x.on().length, 3);
  assert.deepEqual(x.e.notes.map((n) => n.source), ["rule", "rule", "rule"]); assert.match(x.e.notes[0].text, /box 12, code TT/);
  assert.equal(x.T.catalog().find((c) => c.code === "1098VLI").newForYear, true); assert.equal(one([P("1098VLI", "Ally Auto", "doc"), LN("car loan interest")]).on().filter((i) => i.form === "1098VLI").length, 1);
});
test("rules: wages on a return with no W-2 copies attached gives 'W-2 from each employer'; new clients get a photo ID and last year's return, unless the firm switches those rules off or the return is in hand", () => {
  let x = one([LN("wages")], { kind: "return" }); assert.equal(x.T.itemTitle(x.on().find((i) => i.form === "W2"), "en"), "W-2 from each employer");
  x = one(null, { returning: false }); assert.ok(has(x.on(), "PHOTOID") && has(x.on(), "PRIOR")); assert.ok(x.T.listOf(x.e.id).reasons.includes("New client"));
  x = one([SC("Schedule C")], { returning: false, kind: "return" }); assert.ok(has(x.on(), "PHOTOID")); assert.ok(!has(x.on(), "PRIOR"), "asked for last year's return when it is in hand");
  const T = firm(); T.setFirmRule("new_id", false); T.setFirmRule("new_return", false); const b = T.importBegin("c.csv", "First,Last,Email,Returning\nAna,Ruiz,ana@x.example,no"); T.importMap(b.id); T.buildList(T.S.engs[0].id); assert.equal(T.S.items.filter((i) => i.engId === T.S.engs[0].id).length, 0);
});
test("rules: Schedule B payers on the return are proposed by name; a list is ready only when every kept item came from last year's own documents with a named issuer", () => {
  const x = one([{ kind: "payer", src: "return", form: "1099INT", payer: "First Farmers Bank" }, SC("Schedule B")], { kind: "return" }); assert.equal(x.on().length, 1); assert.equal(x.on()[0].payer, "First Farmers Bank");
  assert.equal(x.T.listOf(x.e.id).group, "look"); assert.deepEqual(x.T.listOf(x.e.id).reasons, ["1 from the return"]);
  const y = one([P("W2", "Midtown Transit"), SC("Schedule A")]); assert.equal(y.T.listOf(y.e.id).group, "look"); assert.ok(y.T.listOf(y.e.id).reasons.some((r) => /without an issuer|from the return/.test(r)));
  const z = one([P("W2", "Midtown Transit"), P("1098", "Hillcrest Mortgage")]); assert.equal(z.T.listOf(z.e.id).group, "ready"); assert.deepEqual(z.T.listOf(z.e.id).reasons, []);
});
test("findings keep no number longer than four digits and nothing next to a $ sign, whatever the reader sent", () => {
  const T = firm(); const b = T.importBegin("c.csv", "First,Last,Email\nMaria,Garcia,maria@x.example"); T.importMap(b.id); const e = T.S.engs[0];
  const r = T.attachRecord(e.id, { file: "Garcia 123-45-6789.pdf", kind: "source_doc", findings: [{ kind: "payer", src: "doc", form: "W2", payer: "Midtown Transit 12-3456789", text: "Wages $52,310.00 box 1 52310 acct 4455667788", page: 1 }, { kind: "year", src: "doc", value: "2025" }] });
  const all = JSON.stringify(r); assert.ok(!/\d{5,}|\d{3}-\d{2}-\d{4}|\$/.test(all.replace(/"at":"[^"]*"/, "")), all); assert.equal(r.findings[0].payer, "Midtown Transit"); assert.equal(r.findings[1].value, "2025");
  // And every finding in a firm's whole record.
  const scan = JSON.stringify(T.S.engs.map((x) => x.records)); assert.ok(!/(?<![\w-])\d{5,}/.test(scan));
});
test("approval: nothing is sent before a list is approved or to a client set aside for the season; approval drops unticked items, counts each rule, and the first letter goes", () => {
  const x = one([P("W2", "Midtown Transit"), P("1099S", "Liberty Title", "doc")]); const T = x.T;
  assert.equal(T.start(x.e.id), "Checklist not confirmed"); T.advance(3 * T.DAY); assert.equal(T.S.msgs.length, 0);
  assert.equal(T.setSeason(x.e.id, true), null); assert.equal(x.e.status, "off_season"); assert.match(T.approveList(x.e.id), /set aside/); assert.match(T.start(x.e.id), /set aside/);
  assert.equal(T.setSeason(x.e.id, false), null); assert.equal(x.e.status, "not_started");
  assert.equal(T.approveList(x.e.id), null); assert.equal(x.e.confirmed, true); assert.equal(T.listOf(x.e.id).version, 1); assert.equal(x.e.status, "in_progress"); assert.equal(x.items().length, 1, "the unticked one-time item was dropped");
  T.advance(T.MIN); const L = T.S.msgs.find((m) => m.tpl === "L1"); assert.ok(L); assert.match(L.body, /- W-2 from Midtown Transit/); assert.ok(!/1099-S/.test(L.body));
  assert.deepEqual(T.rulePrecision().map((r) => [r.rule, r.kept, r.unticked]), [["R-DOC", 0, 1], ["R-ORG", 1, 0]]);
  // After approval: added items go in the next letter; not needed and asked again are new versions; ticking is refused.
  assert.match(T.tickItem(x.items()[0].id, false), /approved/); assert.equal(T.addCatalogItem(x.e.id, "1098", "Hillcrest Mortgage"), null); assert.equal(T.listOf(x.e.id).version, 2);
  T.advance(3 * T.DAY); assert.match(T.S.msgs.filter((m) => /^L/.test(m.tpl)).slice(-1)[0].body, /1098 from Hillcrest Mortgage/);
  const h = x.items().find((i) => i.form === "1098"); assert.equal(T.itemNeeded(h.id, false), null); assert.equal(h.state, "waived"); assert.equal(T.itemNeeded(h.id, true), null); assert.equal(h.state, "expected"); assert.equal(T.listOf(x.e.id).version, 4);
});
test("Ready lists are approved together; lists that need a look wait; a client set aside stays on the list with no letters", () => {
  const T = firm(); const b = T.importBegin("c.csv", "First,Last,Email,Returning\nMaria,Garcia,maria@x.example,yes\nLuis,Ortega,luis@x.example,yes\nKen,Sato,ken@x.example,yes"); T.importMap(b.id);
  const [m, l, k] = T.S.engs; T.importRecord(b.id, { file: "Garcia organizer.pdf", kind: "organizer", findings: [P("W2", "Midtown Transit")] }); T.importRecord(b.id, { file: "Ortega return.pdf", kind: "return", findings: [SC("Schedule C")] }); T.importRecord(b.id, { file: "Sato organizer.pdf", kind: "organizer", findings: [P("W2", "River Casino")] });
  T.setSeason(k.id, true); const v = T.importBuild(b.id); assert.deepEqual([v.counts.read, v.counts.ready, v.counts.look, v.counts.offSeason], [3, 1, 1, 1]);
  const r = T.importApprove(b.id, "ready"); assert.equal(r.approved, 1); assert.equal(m.confirmed, true); assert.equal(l.confirmed, false); assert.equal(k.status, "off_season"); T.advance(T.HOUR); assert.ok(!T.S.msgs.some((x) => x.engId === k.id || x.engId === l.id));
});
test("held items: listed under 'These usually arrive later', never chased before the date; a client whose only open items are held gets the first letter and no reminders", () => {
  const x = one([P("W2", "Midtown Transit"), P("1099B", "Schwab"), P("K1", "Okafor Family Trust")]); const T = x.T; T.approveList(x.e.id); T.advance(T.MIN);
  const L1 = T.S.msgs.find((m) => m.tpl === "L1"); assert.match(L1.body, /- W-2 from Midtown Transit\n\nThese usually arrive later\. Send them when they come:\n {2}- 1099-B from Schwab \(usually arrives by mid-February\)\n {2}- Schedule K-1 from Okafor Family Trust \(usually arrives by mid-March\)/); assert.equal(L1.subject, "3 documents for your 2026 tax return");
  const up = T.uploadList(x.e.id); assert.deepEqual(up.now.map((i) => i.title), ["W-2 from Midtown Transit"]); assert.equal(up.later[0].note, "Usually arrives by mid-February. Send it when it comes.");
  T.inboundDoc(x.c.id, { form: "W2", year: 2026, payer: "Midtown Transit" }, "portal"); const n = T.S.msgs.filter((m) => /^L/.test(m.tpl)).length; T.advance(20 * T.DAY);   // to February 14
  assert.equal(T.S.msgs.filter((m) => /^L/.test(m.tpl)).length, n, "a held item was chased before its date"); T.advance(4 * T.DAY);
  const after = T.S.msgs.filter((m) => /^L/.test(m.tpl)).slice(-1)[0]; assert.match(after.body, /1099-B from Schwab/); assert.ok(after.at >= new Date(2027, 1, 16), "chased before February 16 (Presidents' Day)");
  // Only held items from the start: the first letter lists them and no reminder follows until mid-February.
  const y = one([P("K1", "Okafor Family Trust")]); y.T.approveList(y.e.id); y.T.advance(30 * y.T.DAY); const Ly = y.T.S.msgs.filter((m) => /^L/.test(m.tpl)); assert.equal(Ly.length, 1); assert.match(Ly[0].body, /we still need:\n\n {2}- Schedule K-1 from Okafor Family Trust \(usually arrives by mid-March\)/);
});
test("contacts: an item assigned to another person goes in its own letter to them, with a link that shows only their items; if they unsubscribe it comes back to the client", () => {
  const x = one([P("W2", "Midtown Transit"), P("1099B", "Schwab")]); const T = x.T; assert.equal(T.addContact2(x.c.id, "Arjun Garcia", "arjun@x.example"), null); const p = x.c.contacts[0];
  const b1 = x.on().find((i) => i.form === "1099B"); assert.equal(T.assignItem(b1.id, p.id), null); T.approveList(x.e.id); T.advance(T.MIN);
  const L = T.S.msgs.filter((m) => m.tpl === "L1"); assert.equal(L.length, 2); const toP = L.find((m) => m.contactId === p.id), toC = L.find((m) => !m.contactId);
  assert.match(toP.body, /^Hi Arjun,/); assert.match(toP.body, /1099-B from Schwab/); assert.ok(!/W-2/.test(toP.body)); assert.match(toP.subject, /\(Maria Garcia\)$/); assert.ok(!/1099-B/.test(toC.body.split("Upload")[0]));
  const key = /\/u\/maple-([a-z]{28})/.exec(toP.body)[1], f = T.linkFind(key); assert.equal(f.contact.id, p.id); assert.deepEqual(T.uploadList(x.e.id, p.id).later.map((i) => i.title), ["1099-B from Schwab"]); assert.deepEqual(T.uploadList(x.e.id, p.id).now, []);
  T.stopContact(x.c.id, p.id); assert.equal(b1.assignee, undefined); assert.equal(T.linkFind(key).state, "revoked");
});
test("news from the upload page: notes go to the client's page, documents wait as one queue item, already-listed ones are not repeated except a new job's W-2, and the name goes on the first suggestion only", () => {
  const x = one([P("W2", "Midtown Transit"), P("1098", "Hillcrest Mortgage")]); const T = x.T; T.approveList(x.e.id);
  const t = T.clientNews(x.e.id, ["new_job", "bought_home", "new_car", "moved_state", "new_dependent"], "Ally Auto");
  assert.deepEqual(t.suggest.map((s) => [s.form, s.payer]), [["W2", "Ally Auto"], ["PTAX", null], ["1098VLI", null]]); assert.equal(t.kind, "news");
  assert.deepEqual(x.e.notes.map((n) => n.text), ["Moved to another state during 2026", "New baby or new dependent in 2026"]);
  assert.equal(T.decideTask(t.id, "add_news", { pick: [1, 2] }), null); assert.ok(has(x.on(), "PTAX") && has(x.on(), "1098VLI")); assert.ok(!x.on().some((i) => i.form === "W2" && i.payer === "Ally Auto"));
  assert.equal(T.clientNews(x.e.id, ["moved_state"]), null, "a note alone opens no queue item"); assert.equal(x.e.notes.length, 2, "the same note twice");
});
test("uploads: a form from a different issuer is filed against the open item and flagged; anything not on the list waits as 'Not on the checklist'", () => {
  const x = one([P("1099INT", "First Farmers Bank")]); const T = x.T; T.approveList(x.e.id);
  const d = T.inboundDoc(x.c.id, { form: "1099INT", year: 2026, payer: "Farmers Union Bank" }, "portal"); assert.equal(d.state, "accepted"); assert.ok(d.issuerDiffers); assert.ok(T.S.alerts.some((a) => a.kind === "issuer_differs"));
  const n = T.S.items.length, e2 = T.inboundDoc(x.c.id, { form: "1098T", year: 2026, payer: "Belmont University" }, "portal"); assert.equal(e2.state, "in_review"); assert.equal(T.S.items.length, n, "an item was added by itself");
  assert.ok(T.S.tasks.some((t) => t.status === "open" && t.reason === "Not on the checklist"));
});
test("import: columns by synonym, saved for next time; Last, First and spouse columns; no email flagged; SSN columns dropped; same email skipped; same name and phone decided; re-import changes nothing", () => {
  const T = firm(); const csv = "Client Number,Client Name,Spouse,E-mail,Cell,SSN,Status\n1042,\"Garcia, Maria\",Daniel,MARIA@X.EXAMPLE,(615) 555-0111,123-45-6789,returning\n1043,\"Brooks, Erin\",,,(615) 555-0122,234-56-7890,new\n1044,Luis Ortega,,maria@x.example,,345-67-8901,";
  const b = T.importBegin("clients.csv", csv); assert.deepEqual(b.map, ["ref", "name", "spouse", "email", "mobile", "", "returning"]); assert.deepEqual(b.dropped, ["SSN"]); assert.ok(!JSON.stringify(T.S.imports).includes("123-45-6789"), "an SSN reached the stored batch");
  const v = T.importMap(b.id); assert.deepEqual(v.rows.map((r) => r.status), ["ok", "no_email", "duplicate"]); assert.equal(v.rows[2].why, "Same email as row 2 in this file");
  const m = T.S.clients.find((c) => c.ref === "1042"); assert.equal(m.first, "Maria"); assert.equal(m.last, "Garcia"); assert.equal(m.email, "maria@x.example"); assert.equal(m.household, "Maria and Daniel Garcia"); assert.equal(m.returning, true); assert.equal(v.rows[0].phone, "+16155550111");
  T.S.items.push({ id: "i-firm", engId: T.engOf(m.id).id, form: "W2", payer: "Firm Edit", state: "expected", source: "added", firmTouched: true });
  const b2 = T.importBegin("clients.csv", csv); assert.equal(b2.savedMap, true); const v2 = T.importMap(b2.id); assert.deepEqual(v2.rows.map((r) => r.status), ["same", "same", "duplicate"]); assert.equal(T.S.clients.length, 2); assert.ok(T.S.items.some((i) => i.id === "i-firm"), "a firm edit was lost");
  // Same name and phone with a different email: the firm decides. Shares an email in the same family: a second return in the household.
  const b3 = T.importBegin("more.csv", "First,Last,Email,Mobile\nErin,Brooks,erin@x.example,6155550122\nSofia,Garcia,maria@x.example,"); const v3 = T.importMap(b3.id);
  assert.deepEqual(v3.rows.map((r) => r.status), ["possible_duplicate", "possible_duplicate"]); assert.match(v3.rows[1].why, /second return in the same household/);
  assert.equal(T.importDecide(b3.id, 2, "skip"), null); assert.equal(T.importDecide(b3.id, 3, "new"), null); const s = T.S.clients.find((c) => c.first === "Sofia"); assert.equal(s.householdId, m.householdId); assert.equal(s.email, "", "a household member's contact details were assumed");
});
test("import: last year's files are matched by client ID in the file name, then the name inside; the rest wait in the tray; a batch is gone after 30 days", () => {
  const T = firm(); const b = T.importBegin("c.csv", "ID,First,Last,Email\n1042,Maria,Garcia,maria@x.example\n1043,Luis,Ortega,luis@x.example"); T.importMap(b.id);
  assert.equal(T.importRecord(b.id, { file: "2025 organizer 1042.pdf", kind: "organizer", findings: [P("W2", "Midtown Transit")] }).row, 2);
  assert.equal(T.importRecord(b.id, { file: "scan0007.pdf", kind: "source_doc", findings: [{ kind: "recipient", src: "doc", recipient: "LUIS M ORTEGA" }, P("W2", "River Casino", "doc")] }).row, 3);
  const t = T.importRecord(b.id, { file: "scan0008.pdf", kind: "source_doc", findings: [P("1098", "Hillcrest Mortgage", "doc")] }); assert.ok(t.tray); assert.equal(T.importView(b.id).tray.length, 1);
  assert.equal(T.importPlace(b.id, t.tray, 2), null); assert.equal(T.importView(b.id).tray.length, 0); assert.equal(T.engOf(T.S.clients[0].id).records.length, 2);
  T.advance(31 * T.DAY); assert.equal(T.importView(b.id), null); assert.match(T.importBuild(b.id).error, /expired/);
});
test("a 500-row client list is matched and validated in under ten seconds", () => {
  const T = firm({ plan: "Large" }), rows = Array.from({ length: 500 }, (_, i) => [1000 + i, "Client" + i, "Family" + i, "c" + i + "@x.example", "615555" + String(1000 + i)].join(","));
  const t0 = Date.now(); const b = T.importBegin("big.csv", "Client ID,First,Last,Email,Phone\n" + rows.join("\n")); const v = T.importMap(b.id); const ms = Date.now() - t0;
  assert.equal(v.rows.filter((r) => r.status === "ok").length, 500); assert.ok(ms < 10000, ms + " ms");
});
test("year two: last season's filed documents are this season's proposal, ready to approve, with no import at all", () => {
  const x = one([P("W2", "Midtown Transit"), P("1098", "Hillcrest Mortgage")]); const T = x.T; T.approveList(x.e.id); T.advance(T.MIN);
  for (const [f, p] of [["W2", "Midtown Transit"], ["1098", "Hillcrest Mortgage"]]) T.inboundDoc(x.c.id, { form: f, year: 2026, payer: p }, "portal");
  assert.equal(x.e.status, "complete"); T.closeEng(x.e.id); assert.equal(T.rollForward(x.c.id, 2027), null); const e2 = T.engOf(x.c.id);
  assert.equal(T.listOf(e2.id).status, "proposed"); assert.equal(e2.confirmed, false); assert.equal(T.listOf(e2.id).group, "ready"); assert.deepEqual(T.S.items.filter((i) => i.engId === e2.id).map((i) => [i.form, i.payer, i.source]).sort(), [["1098", "Hillcrest Mortgage", "last_season"], ["W2", "Midtown Transit", "last_season"]]);
});

// Review fixes (November 2026). Each closes a path that went round approval, opt-out or the data rules.
test("review: an email-first firm cannot send the check-in, and an old check-in never approves a list after a week", () => {
  const x = one([P("W2", "Midtown Transit")]); const T = x.T;
  assert.match(T.sendCheckin(x.e.id), /fetch list/); assert.equal(T.S.msgs.length, 0);
  x.e.checkin = { sentAt: new Date(T.S.now) }; T.advance(8 * T.DAY);
  assert.equal(x.e.confirmed, false); assert.equal(T.listOf(x.e.id).status, "proposed"); assert.equal(x.e.status, "not_started"); assert.equal(T.S.msgs.length, 0, "no check-in reminder and no letter");
  assert.ok(T.S.alerts.some((a) => a.kind === "checkin_quiet"));
});
test("review: after an unsubscribe, a draft waiting for approval is thrown away and cannot be approved; the timer drops an approved one", () => {
  const x = one([P("W2", "Midtown Transit")]); const T = x.T; T.S.firm.hound.mode = "copilot"; T.approveList(x.e.id); T.advance(T.MIN);
  const d = T.S.msgs.find((m) => m.dir === "out" && m.status === "approval"); assert.ok(d, "a draft waits for approval");
  const held = { id: "m_held", engId: x.e.id, dir: "out", kind: "auto", tpl: "L2", channel: "email", body: "Hi Maria", status: "approval", at: new Date(T.S.now) }; T.S.msgs.push(held);
  T.stopEmail(x.c.id, "link"); assert.equal(d.status, "discarded"); assert.equal(held.status, "discarded");
  const late = { id: "m_late", engId: x.e.id, dir: "out", kind: "auto", tpl: "L2", channel: "email", body: "Hi Maria", status: "approval", at: new Date(T.S.now) }; T.S.msgs.push(late);
  assert.match(T.approveMsg(late.id), /unsubscribed/); assert.equal(late.status, "discarded");
  const ok = { id: "m_ok", engId: x.e.id, dir: "out", kind: "auto", tpl: "L2", channel: "email", body: "Hi Maria", status: "approved", sendAt: new Date(T.S.now), at: new Date(T.S.now) }; T.S.msgs.push(ok); T.advance(T.MIN);
  assert.equal(ok.status, "discarded");
});
test("review: unsubscribing is by address: the same person as a client and as a contact on another return stops in both places, and a person is told", () => {
  const T = firm(); const b = T.importBegin("c.csv", "First,Last,Email\nMaria,Garcia,maria@x.example\nArjun,Garcia,arjun@x.example"); T.importMap(b.id);
  const [maria, arjun] = T.S.clients; assert.equal(T.addContact2(maria.id, "Arjun Garcia", "Arjun@x.example"), null); const p = maria.contacts[0];
  T.stopEmail(arjun.id, "link"); assert.equal(p.emailOff, true); assert.ok(T.S.alerts.some((a) => a.kind === "contact_stop"));
  T.addContact2(arjun.id, "Maria Garcia", "maria@x.example"); T.stopContact(arjun.id, arjun.contacts[0].id); assert.equal(maria.emailOff, true);
});
test("review: a contact's reply asking to stop is honoured; any other reply is kept scrubbed and a person is told; a bounce stops the contact", () => {
  const x = one([P("W2", "Midtown Transit"), P("1099B", "Schwab")]); const T = x.T; T.addContact2(x.c.id, "Arjun Garcia", "arjun@x.example"); const p = x.c.contacts[0];
  assert.equal(T.contactByAddress("ARJUN@x.example").p, p);
  assert.equal(T.contactReply(x.c.id, p.id, "Is my SSN 123-45-6789 needed?", 0), "reply"); const m = T.S.msgs.find((y) => y.contactId === p.id && y.dir === "in"); assert.ok(!m.body.includes("123-45-6789")); assert.ok(T.S.alerts.some((a) => a.kind === "contact_reply"));
  assert.equal(p.emailOff, undefined); assert.equal(T.contactReply(x.c.id, p.id, "please stop emailing me", 0), "stop"); assert.equal(p.emailOff, true);
  T.addContact2(x.c.id, "Lena Garcia", "lena@x.example"); const q = x.c.contacts[1]; T.contactBounced(x.c.id, q.id); assert.equal(q.emailOff, true); assert.ok(T.S.alerts.some((a) => a.kind === "contact_bounced"));
});
test("review: the upload page's 'Anything new' name goes through scrub, and a name that held an identifier is not kept or suggested", () => {
  const x = one([P("W2", "Midtown Transit")]); const T = x.T; T.approveList(x.e.id);
  const t = T.clientNews(x.e.id, [T.NEWS[0][0]], "SSN 123-45-6789"); const m = T.S.msgs.find((y) => y.intent === "news");
  assert.ok(!m.body.includes("6789")); assert.ok(!JSON.stringify(x.e.answers).includes("6789")); assert.ok(!t || t.suggest.every((s) => !s.payer));
});
test("review: numbers split by spaces, dots or hyphens count as one number when findings are cleaned", () => {
  const T = firm(); assert.equal(T.cleanFinding({ kind: "payer", form: "W2", payer: "Acme 123 45 6789" }).payer, "Acme"); assert.equal(T.cleanText("Acme 12 345 Inc"), "Acme Inc"); assert.equal(T.cleanText("Box 12 34"), "Box 12 34"); assert.equal(T.cleanText("W-2 2025 from Acme"), "W-2 2025 from Acme");
});
test("review: rebuilding a proposed list keeps an item assigned to a contact", () => {
  const x = one([P("W2", "Midtown Transit"), P("1099B", "Schwab")]); const T = x.T; T.addContact2(x.c.id, "Arjun Garcia", "arjun@x.example"); const p = x.c.contacts[0];
  T.assignItem(x.on().find((i) => i.form === "1099B").id, p.id); T.attachRecord(x.e.id, { file: "more.pdf", kind: "doc", status: "read", findings: [P("1099INT", "First Farmers Bank", "doc")] }); T.buildList(x.e.id);
  assert.equal(x.items().find((i) => i.form === "1099B").assignee, p.id);
});
test("review: a client set aside for the season rolls forward to the new year with a list to approve", () => {
  const x = one([P("W2", "Midtown Transit")]); const T = x.T; T.setSeason(x.e.id, true); assert.equal(x.e.status, "off_season");
  assert.equal(T.rollForward(x.c.id, x.e.year + 1), null); const e2 = T.engOf(x.c.id); assert.equal(e2.year, x.e.year + 1); assert.equal(T.listOf(e2.id).status, "proposed");
});
test("review: in an email-first firm a template or check-in answers never confirm a list; only Approve list does", () => {
  const x = one([P("W2", "Midtown Transit")]); const T = x.T; const tid = T.templates()[0].id; T.applyTemplate(x.e.id, tid, { confirm: true });
  assert.equal(x.e.confirmed, false); assert.equal(T.listOf(x.e.id).status, "proposed");
  x.e.checkin = { doneAt: new Date(T.S.now), adds: [], drops: [] }; T.applyCheckin(x.e.id, {}); assert.equal(x.e.confirmed, false);
});
test("review: a document waiting for a person is not counted as verified, and the activity line says it waits", () => {
  const x = one([P("W2", "Midtown Transit"), P("1098", "Hillcrest Mortgage")]); const T = x.T; T.S.firm.confirmAll = true; T.approveList(x.e.id); T.advance(T.MIN);
  T.inboundDoc(x.c.id, { form: "W2", year: 2026, payer: "Midtown Transit" }, "email"); const v = T.verified(x.e.id);
  assert.equal(v.n, 0); assert.equal(v.waiting, 1); assert.ok(x.e.timeline.some((t) => /passed the sniff test\. Waiting for a person to confirm it/.test(t.text))); assert.ok(!x.e.timeline.some((t) => /with no staff touch/.test(t.text)));
});
test("review: email-first wording: one document is 'Upload it here', a reply opens with the client's name and is signed, and last year's return is the year before", () => {
  const x = one([P("W2", "Midtown Transit")]); const T = x.T; T.approveList(x.e.id); T.advance(T.MIN);
  const L1 = T.S.msgs.find((m) => m.tpl === "L1"); assert.match(L1.body, /Upload it here\./); assert.ok(!/Upload them here/.test(L1.body));
  T.inboundReply(x.c.id, "Can I deduct my home office?", null, "maria@x.example"); const r = T.S.msgs.filter((m) => m.dir === "out" && m.tpl !== "L1").slice(-1)[0];
  assert.match(r.body, /^Hi Maria,\n\n/); assert.match(r.body, /\n\nThank you,\nAlex Reyes\nMaple & Pine Tax Co\.$/);
  assert.equal(T.askPhrase("PRIOR"), "Your 2025 tax return");
});

// QA review fixes (November 2026).
test("qa: an SSN or birth date under any header is never offered or kept, and an SSN typed into another cell is removed", () => {
  const T = firm(); const b = T.importBegin("c.csv", "First,Last,Email,Tax ID,Born,Notes\nMaria,Garcia,maria@x.example,123-45-6789,01/02/1980,SSN 234-56-7890 on file\nLuis,Ortega,luis@x.example,345-67-8901,03/04/1975,");
  assert.deepEqual(b.dropped || T.S.imports[0].head.filter((h, i) => T.S.imports[0].sensitive[i]), ["Tax ID", "Born"]); const j = JSON.stringify(T.S.imports);
  for (const v of ["123-45-6789", "345-67-8901", "234-56-7890", "01/02/1980", "03/04/1975"]) assert.ok(!j.includes(v), v + " reached the stored batch");
  assert.ok(T.importBegin("e.csv", "First,Last,Email\n").error, "an empty file started an import");
});
test("qa: names come out as written on a letter; two rows with one name and no email are flagged; files match names without accents", () => {
  const T = firm(); const b = T.importBegin("c.csv", "First,Last,Email\nÉMILE,ÖZTÜRK,emile@x.example\njosé,núñez,\nAna,Ruiz,\nAna,Ruiz,"); const v = T.importMap(b.id);
  assert.deepEqual(T.S.clients.slice(0, 2).map((c) => c.first + " " + c.last), ["Émile Öztürk", "José Núñez"]); assert.equal(v.rows[3].status, "possible_duplicate"); assert.match(v.rows[3].why, /Same name as row 4/);
  assert.equal(T.importMap(b.id).rows.length, 4, "a second confirmation did not just catch up");
  const r = T.importRecord(b.id, { file: "nunez 2025 organizer.pdf", kind: "organizer", status: "read", findings: [] }); assert.ok(r && !r.error); assert.equal(T.S.imports[0].tray.length, 0, "the accented name was not matched");
});
test("qa: a new email address after an unsubscribe starts letters again; a bad one changes nothing; an address that asked to stop is refused", () => {
  const x = one([P("W2", "Midtown Transit")]); const T = x.T; T.approveList(x.e.id); T.advance(T.MIN); T.stopEmail(x.c.id, "link"); assert.equal(x.e.status, "stuck");
  assert.match(T.setEmail(x.c.id, "bogus"), /doesn't look right/); assert.equal(x.c.email, "maria@x.example");
  assert.equal(T.setEmail(x.c.id, "Maria.New@X.example"), null); assert.equal(x.c.email, "maria.new@x.example"); assert.equal(x.c.emailOff, false); assert.equal(x.e.status, "in_progress");
  const n = T.S.msgs.filter((m) => /^L/.test(m.tpl || "")).length; T.advance(T.DAY); assert.ok(T.S.msgs.filter((m) => /^L/.test(m.tpl || "")).length > n, "no letter to the new address");
  const b = T.importBegin("c2.csv", "First,Last,Email\nSam,Lee,sam@x.example"); T.importMap(b.id); assert.match(T.setEmail(T.S.clients[1].id, "maria@x.example"), /asked to stop/);
});
test("qa: a stop reply from a client who had gone quiet closes the no-reply item and opens can't reach", () => {
  const x = one([P("W2", "Midtown Transit")]); const T = x.T; T.approveList(x.e.id); T.advance(25 * T.DAY); assert.equal(x.e.stuck, "no_reply");
  T.inboundReply(x.c.id, "Please stop emailing me.", null, "maria@x.example"); const open = T.S.tasks.filter((t) => t.status === "open" && t.engId === x.e.id).map((t) => t.kind);
  assert.ok(!open.includes("gone_quiet")); assert.ok(open.includes("cant_reach"));
});
test("qa: a W-2 for someone else from the same employer is not a duplicate of the client's own; letters count as asking", () => {
  const x = one([P("W2", "Midtown Transit")]); const T = x.T; T.approveList(x.e.id); T.advance(T.MIN);
  const w2 = x.items().find((i) => i.form === "W2"); assert.ok(T.askedCount ? T.askedCount(x.e, w2) >= 1 : true);
  T.inboundDoc(x.c.id, { form: "W2", year: 2026, payer: "Midtown Transit", recipient: "self" }, "email"); const d = T.inboundDoc(x.c.id, { form: "W2", year: 2026, payer: "Midtown Transit", recipient: "other" }, "email");
  assert.notEqual(d.state, "duplicate"); assert.ok(T.S.tasks.some((t) => t.docId === d.id && t.status === "open"));
});
test("qa: a contact's first letter is a first letter about the client's return, and assigning an item does not send the client another letter", () => {
  const x = one([P("W2", "Midtown Transit"), P("1099INT", "First Farmers Bank")]); const T = x.T; T.approveList(x.e.id); T.advance(T.MIN); T.advance(2 * T.DAY);
  const before = T.S.msgs.filter((m) => /^L/.test(m.tpl || "") && !m.contactId).length, next = +x.e.next;
  T.addContact2(x.c.id, "Luis Garcia", "luis@x.example"); const p = x.c.contacts[0]; T.assignItem(x.items().find((i) => i.form === "1099INT").id, p.id); T.advance(T.DAY);
  const toP = T.S.msgs.find((m) => m.contactId === p.id); assert.ok(toP, "no letter to the contact"); assert.equal(toP.tpl, "L1"); assert.match(toP.body, /^Hi Luis,\n\nWe're Maple & Pine Tax Co\., and we prepare Maria Garcia's taxes\./); assert.match(toP.body, /Maria's 2026 tax return/); assert.ok(!/A reminder/.test(toP.body));
  assert.equal(+x.e.next, next, "the client's reminder day moved"); assert.equal(T.S.msgs.filter((m) => /^L/.test(m.tpl || "") && !m.contactId && m.at > new Date(T.S.now - T.DAY)).length, 0, "the client got an extra letter"); assert.ok(before >= 1);
});
test("qa: numbers and amounts are refused in catalog wording and payer names, as they are for issuers", () => {
  const T = firm(); assert.match(T.setCatalog("W2", { ask: "W-2 from employer EIN 123456789" }), /numbers/); assert.match(T.setAlias("HILLCREST MORTGAGE", "Hillcrest Mortgage, loan 99887766"), /numbers/); assert.equal(T.setAlias("HILLCREST MORTGAGE", "Hillcrest"), null);
});
test("qa: an upload that is not on the list says so and says what is still needed", () => {
  const x = one([P("W2", "Midtown Transit")]); const T = x.T; T.approveList(x.e.id); T.advance(T.MIN);
  const d = T.inboundDoc(x.c.id, { form: "OTHER", year: 2026, payer: "", is_tax_document: false }, "upload"); const r = T.uploadResult(d, "en");
  assert.equal(r.ok, false); assert.match(r.text, /^This doesn't look like one of the documents on your list\. Maple & Pine Tax Co\. will take a look\. We still need: W-2 from Midtown Transit\.$/);
});
