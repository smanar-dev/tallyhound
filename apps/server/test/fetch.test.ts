// The client import and fetch list spec, through the web service (docs/FETCH.md): a spreadsheet, a file read on the server and not
// kept, the SSN column checked against what is actually stored, and the upload page: held items, the news card, a contact's link.
import test from "node:test";
import assert from "node:assert/strict";
import { zipSync, strToU8 } from "fflate";
import { build, KINDS, pdfPagesWith } from "./harness.ts";
import { createEngine, type Engine } from "../src/kit.ts";
import { xlsxToCsv } from "../src/xlsx.ts";
import { testSet, testSetCsv } from "./fixtures/testset.ts";

/* eslint-disable @typescript-eslint/no-explicit-any */
const words = (s: string) => s.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
function xlsx(rows: (string | number)[][]): Buffer {
  const shared: string[] = [], si = (v: string) => { let i = shared.indexOf(v); if (i < 0) { i = shared.length; shared.push(v); } return i; }, L = (i: number) => String.fromCharCode(65 + i);
  const sheet = '<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>' + rows.map((r, ri) => '<row r="' + (ri + 1) + '">' + r.map((v, ci) => (typeof v === "number" ? '<c r="' + L(ci) + (ri + 1) + '"><v>' + v + "</v></c>" : '<c r="' + L(ci) + (ri + 1) + '" t="s"><v>' + si(v) + "</v></c>")).join("") + "</row>").join("") + "</sheetData></worksheet>";
  const sst = '<?xml version="1.0"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' + shared.map((s) => "<si><t>" + s.replace(/&/g, "&amp;").replace(/</g, "&lt;") + "</t></si>").join("") + "</sst>";
  return Buffer.from(zipSync({ "[Content_Types].xml": strToU8("<Types/>"), "xl/workbook.xml": strToU8("<workbook/>"), "xl/sharedStrings.xml": strToU8(sst), "xl/worksheets/sheet1.xml": strToU8(sheet) }));
}

test("XLSX: the first sheet's values become CSV; anything that is not a spreadsheet is refused in words", () => {
  const r = xlsxToCsv(new Uint8Array(xlsx([["Client ID", "Name", "Email"], [1042, "Garcia, Maria", "maria@x.example"], [1043, "Ortega & Sons", "luis@x.example"]])));
  assert.equal(r.csv, 'Client ID,Name,Email\n1042,"Garcia, Maria",maria@x.example\n1043,Ortega & Sons,luis@x.example'); assert.match(String(xlsxToCsv(new Uint8Array(Buffer.from("nope"))).error), /not a spreadsheet/);
});

for (const kind of KINDS) test("fetch lists (" + kind + "): a spreadsheet import; last year's PDF read on the server and not kept; SSNs never stored; no letter before approval; the upload page shows held items, takes news, and a contact sees only their own", async () => {
  const H = await build(kind, { letters: true }), { firmId, ownerId } = await H.newFirm(), owner = await H.signInAs("pat1@firm1.test"), act = async (fn: string, ...args: unknown[]) => { const r = await owner.post("/api/act", { fn, args }); assert.equal(r.status, 200, fn + ": " + r.raw.body); return r.json.result; };
  const state = async (): Promise<Engine> => { const T = createEngine(); T.load((await H.store.readState(firmId))!); return T; };
  await H.app.staff(firmId, ownerId, (T: Engine) => { T.S.firm.hound.mode = "autopilot"; T.S.firm.confirmAll = false; });
  // A spreadsheet with an SSN column.
  const up = await H.server.inject({ method: "POST", url: "/api/imports/xlsx", payload: xlsx([["Client ID", "Last name", "First name", "Email", "SSN", "Status"], [1042, "Garcia", "Maria", "maria@x.example", "123-45-6789", "returning"], [1043, "Ortega", "Luis", "luis@x.example", "234-56-7890", "returning"]]), headers: { "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", cookie: owner.cookie(), "x-tallyhound": "1" } });
  assert.equal(up.statusCode, 200); const b = await act("importBegin", "clients.xlsx", up.json().csv); assert.deepEqual(b.dropped, ["SSN"]); const v = await act("importMap", b.id, null); assert.deepEqual(v.rows.map((r: any) => r.status), ["ok", "ok"]);
  // Last year's organizer, read on the server: the findings are kept, the file is not.
  const files = async () => ((H.inner as any).files ? (H.inner as any).files.size : kind === "postgres" ? Number((await (H as any).pool?.query?.("select count(*)::int as n from files"))?.rows?.[0]?.n || 0) : 0);
  const before = await files(), pdf = pdfPagesWith([["2025 Tax Organizer", "Prior Year Summary for Garcia, Maria", "W-2   Midtown Transit Authority   52,310.00", "1099-B   Schwab   12,004.11", "Schedule A Itemized Deductions"]]);
  const rd = await H.server.inject({ method: "POST", url: "/api/imports/" + b.id + "/read?name=" + encodeURIComponent("1042 Garcia organizer.pdf"), payload: pdf, headers: { "content-type": "application/pdf", cookie: owner.cookie(), "x-tallyhound": "1" } });
  assert.equal(rd.statusCode, 200); assert.equal(rd.json().row, 2); assert.equal(rd.json().kind, "organizer"); assert.equal(await files(), before, "the prior-year file was stored");
  const built = await act("importBuild", b.id); assert.equal(built.counts.read, 1);
  // The database check: no SSN and no figure from the organizer anywhere in what is stored for this firm.
  const raw = kind === "postgres" ? JSON.stringify((await (H as any).pool.query("select * from firm_state")).rows) + JSON.stringify((await (H as any).pool.query("select * from firm_parts")).rows) : "";
  const plain = (await H.store.readState(firmId))!; for (const s of [plain, raw]) { assert.ok(!s.includes("123-45-6789") && !s.includes("234-56-7890"), "an SSN was stored"); assert.ok(!s.includes("52,310") && !s.includes("12,004"), "a figure from the organizer was stored"); }
  // No letter before approval, enforced by the engine whatever the browser asks.
  let T = await state(); const garcia = T.S.engs.find((e: any) => T.client(e.clientId).last === "Garcia"); assert.equal(await act("start", garcia.id), "Checklist not confirmed"); await H.worker.pass(); assert.equal(H.email.sent.length, 0);
  // The old confirm step is approval too in an email-first firm: unticked items go and the approver is recorded.
  const anOff = T.S.items.find((i: any) => i.engId === garcia.id && i.state === "off");
  assert.equal(await act("confirmChecklist", garcia.id), null); await H.worker.pass(); assert.equal(H.email.sent.length, 1); const L = H.email.sent[0] as any;
  T = await state(); assert.equal(T.eng(garcia.id).list.status, "approved"); assert.equal(T.eng(garcia.id).list.approvedBy, "Pat Owner"); if (anOff) assert.equal(T.S.items.find((i: any) => i.id === anOff.id).state, "removed");
  assert.match(L.body, /These usually arrive later\. Send them when they come:\n {2}- 1099-B from Schwab \(usually arrives by mid-February\)/); assert.match(L.body, /Anything new this year/);
  // The upload page: still owed, then coming later, and the news card.
  T = await state(); const u = "/u/" + T.S.firm.slug + "-" + T.engOf(garcia.clientId).link.key, page = words((await H.server.inject({ method: "GET", url: u })).body);
  assert.match(page, /Test CPAs 1 still needs W-2 from Midtown Transit Authority/); assert.match(page, /These usually arrive later 1099-B from Schwab Usually arrives by mid-February\. Send it when it comes\./); assert.match(page, /Anything new in 2026\?/);
  const news = await H.server.inject({ method: "POST", url: u, payload: "form=news&n_new_car=1&n_moved_state=1&named=Ally+Auto", headers: { "content-type": "application/x-www-form-urlencoded" } }); assert.equal(news.headers.location, u + "?said=news");
  T = await state(); const ge = T.engOf(garcia.clientId); assert.deepEqual(ge.notes.map((n: any) => n.text), ["Moved to another state during 2026"]); const t = T.S.tasks.find((x: any) => x.kind === "news"); assert.deepEqual(t.suggest.map((s: any) => [s.form, s.payer]), [["1098VLI", "Ally Auto"]]);
  // The firm's public page in an email-first firm says nothing about texts (UX review).
  const fp = words((await H.server.inject({ method: "GET", url: "/f/" + T.S.firm.slug })).body); assert.match(fp, /asks for the documents for your tax return by email/); assert.match(fp, /Our letters come from test1@docs\.tallyhound\.test/); assert.ok(!/\btext|\bSTOP\b|carrier|programme|HELP/.test(fp) && !/text messag/i.test(fp), "the firm page talks about texting");
  // A contact: their own letter, their own link, only their own item, no news card.
  assert.equal(await act("addContact2", garcia.clientId, "Arjun Garcia", "arjun@x.example"), null); T = await state(); const p = T.client(garcia.clientId).contacts[0], w2 = T.S.items.find((i: any) => i.engId === ge.id && i.form === "W2");
  assert.equal(await act("assignItem", w2.id, p.id), null); for (let i = 0; i < 8; i++) { H.advance(6 * 3600); await H.worker.pass(); }
  const toP = (H.email.sent as any[]).find((m) => m.to === "arjun@x.example"); assert.ok(toP, "no letter to the contact"); assert.match(toP.body, /^Hi Arjun,/); assert.match(String(toP.unsubscribe), /\/e\//); const key = /\/u\/[a-z]+-([a-z]{28})/.exec(toP.body)![1]!;
  const cp = words((await H.server.inject({ method: "GET", url: "/u/" + T.S.firm.slug + "-" + key })).body); assert.match(cp, /Hi Arjun Test CPAs 1 asked you for these, for Maria's tax return\. Test CPAs 1 still needs W-2 from Midtown Transit Authority/); assert.ok(!/1099-B|Anything new/.test(cp), "the contact saw more than their own item");
  // Neither the contact's upload key nor any unsubscribe key reaches a browser.
  const api = (await owner.get("/api/state")).raw.body, ekey = /\/e\/[a-z]+-([a-z]{28})/.exec(String(toP.unsubscribe))![1]!; assert.ok(!api.includes(key), "the contact's upload key reached the browser"); assert.ok(!api.includes(ekey), "an unsubscribe key reached the browser"); assert.ok(!/"ekey"/.test(api));
  // The contact writes back to the firm's address: kept, and a person is told. Nothing is filed and no reply is sent.
  const sentBefore = H.email.sent.length;
  await H.postmarkPost("/hooks/postmark/inbound", { MessageID: "pm-arjun", OriginalRecipient: "test1@docs.tallyhound.test", From: "Arjun Garcia <arjun@x.example>", Subject: "Re: W-2", TextBody: "I will send it on Friday.", Headers: [{ Name: "Authentication-Results", Value: "mx; dmarc=pass" }], Attachments: [] });
  await H.inbox.drain(); await H.worker.pass(); T = await state(); assert.ok(T.S.alerts.some((a: any) => a.kind === "contact_reply"), "nobody was told about the contact's reply"); assert.ok(T.S.msgs.some((m: any) => m.dir === "in" && m.contactId === p.id)); assert.equal(H.email.sent.length, sentBefore);
  // The contact unsubscribes: their link stops working and the item is the client's again.
  const un = /\/e\/([a-z]+-[a-z]{28})/.exec(String(toP.unsubscribe))![1]; await H.server.inject({ method: "POST", url: "/e/" + un, payload: "List-Unsubscribe=One-Click", headers: { "content-type": "application/x-www-form-urlencoded" } });
  T = await state(); assert.equal(T.client(garcia.clientId).contacts[0].emailOff, true); assert.equal(T.S.items.find((i: any) => i.id === w2.id).assignee, undefined); assert.equal((await H.server.inject({ method: "GET", url: "/u/" + T.S.firm.slug + "-" + key })).statusCode, 404);
  // The client unsubscribes while a letter is made but not yet claimed: it is never sent.
  await H.app.staff(firmId, ownerId, (T2: Engine) => { const e2 = T2.engOf(garcia.clientId); T2.S.msgs.push({ id: "m_unclaimed", engId: e2.id, dir: "out", kind: "auto", tpl: "L2", channel: "email", subject: "Your documents", body: "Hi Maria", status: "delivered", at: new Date(T2.S.now) }); T2.stopEmail(garcia.clientId, "link"); });
  const n = H.email.sent.length; await H.worker.pass(); assert.equal((H.email.sent as any[]).slice(n).filter((m) => m.to === "maria@x.example").length, 0, "a letter went to a client who unsubscribed");
  T = await state(); assert.equal(T.S.msgs.find((m: any) => m.id === "m_unclaimed").status, "discarded");
  await H.close();
});

test("the 60-client test set imports through the web service with its SSN column dropped", async () => {
  const H = await build("memory", { letters: true }); await H.newFirm(); const owner = await H.signInAs("pat1@firm1.test");
  const b = (await owner.post("/api/act", { fn: "importBegin", args: ["testset.csv", testSetCsv(testSet())] })).json.result; assert.deepEqual(b.dropped, ["SSN"]);
  const v = (await owner.post("/api/act", { fn: "importMap", args: [b.id, null] })).json.result; assert.equal(v.rows.length, 60); assert.equal(v.rows.filter((r: any) => r.status === "ok").length, 60);
  const reader = await (async () => { await owner.post("/api/users", { name: "Sam Reader", email: "sam@firm1.test", role: "read_only" }); return H.signInAs("sam@firm1.test"); })();
  for (const fn of ["importBegin", "importMap", "importRecord", "approveList", "tickItem", "setCatalog"]) assert.equal((await reader.post("/api/act", { fn, args: [] })).status, 403, fn);
  await H.close();
});

test("a scan with no text goes to the model, which may answer only with names from fixed lists; numbers are stripped and a person must confirm it before it shapes a list", async () => {
  const { readWithModel, findingsPrompt } = await import("../src/priorread.ts"), forms = Object.keys(createEngine().FORMS);
  const ask = async () => ({ kind: "source_doc", payers: [{ form: "W2", payer: "Midtown Transit 62-1234567", page: 1 }, { form: "BANKSTMT", payer: "x" }, { form: "1099INT", payer: "$412.00" }], schedules: ["Schedule A", "Schedule Z"], lines: ["wages", "lottery"], recipient: "MARIA GARCIA 123-45-6789", ssn: "123-45-6789" });
  const r = await readWithModel({ render: async () => [Buffer.from("page")], ask, forms }, "f1", Buffer.from("%PDF-1.4"), "unreadable");
  assert.equal(r.by, "ocr"); assert.deepEqual(r.findings.map((f) => [f.kind, f.form || f.value || f.recipient, f.payer || null]), [["payer", "W2", "Midtown Transit"], ["payer", "1099INT", null], ["schedule", "Schedule A", null], ["line", "wages", null], ["recipient", "MARIA GARCIA", null]]);
  assert.ok(!/\d{5,}|\$|ssn/i.test(JSON.stringify(r))); assert.match(findingsPrompt(forms), /Never write a number/);
  // Through the service: the record waits for a person, and the list does not use it until they confirm.
  const H = await build("memory", { letters: true, readModel: (firmId, pdf, why) => readWithModel({ render: async () => [Buffer.from("p")], ask, forms }, firmId, pdf, why) }), { firmId, ownerId } = await H.newFirm(), owner = await H.signInAs("pat1@firm1.test");
  await H.app.staff(firmId, ownerId, (T: Engine) => { T.importRows(T.parseCSV("First,Last,Email\nMaria,Garcia,maria@x.example")); }); let T = createEngine(); T.load((await H.store.readState(firmId))!); const eid = T.S.engs[0].id;
  const up = await H.server.inject({ method: "POST", url: "/api/clients/" + eid + "/records?name=scan0001.pdf", payload: pdfPagesWith([[]]), headers: { "content-type": "application/pdf", cookie: owner.cookie(), "x-tallyhound": "1" } }); assert.equal(up.statusCode, 200); assert.equal(up.json().status, "needs_person");
  T = createEngine(); T.load((await H.store.readState(firmId))!); const e = T.S.engs[0]; assert.ok(!T.S.items.some((i: any) => i.engId === eid && i.source === "doc"), "an unconfirmed reading shaped the list"); assert.ok(T.listOf(eid).reasons.includes("A file couldn't be read"));
  assert.equal((await owner.post("/api/act", { fn: "confirmRecord", args: [eid, e.records[0].id] })).json.result, null);
  T = createEngine(); T.load((await H.store.readState(firmId))!); assert.ok(T.S.items.some((i: any) => i.engId === eid && i.form === "W2" && i.payer === "Midtown Transit" && i.source === "doc")); await H.close();
});
