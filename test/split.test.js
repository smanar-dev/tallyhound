// TH-DOC-19: several forms that arrive as one PDF are filed as one PDF each. Which pages go where is decided here (pagesToFile);
// the cutting itself is apps/server/src/files.ts pdfCut, tested with real PDFs in apps/server/test/hooks.test.ts.
const test = require("node:test");
const assert = require("node:assert/strict");
const { createApp, pagesToFile } = require("../packages/core/pipeline");
const { memoryStore, fakeSender, fakeAI } = require("../packages/core/memory");
const { createEngine } = require("../packages/engine");

test("pagesToFile: a document gets its own pages plus the unclaimed pages that follow it; every page of the file lands in exactly one document", () => {
  assert.deepEqual(pagesToFile(3, [1, 2], [[3]]), [1, 2]); assert.deepEqual(pagesToFile(3, [3], [[1, 2]]), [3]);
  // A cover page nobody claimed goes with the first document; an instruction sheet goes with the form before it.
  assert.deepEqual(pagesToFile(6, [2], [[4]]), [1, 2, 3]); assert.deepEqual(pagesToFile(6, [4], [[2]]), [4, 5, 6]);
  assert.deepEqual(pagesToFile(4, [1, 2, 3, 4], []), [1, 2, 3, 4]); assert.deepEqual(pagesToFile(5, [2, 9, 0], []), [1, 2, 3, 4, 5], "page numbers outside the file are ignored");
  assert.deepEqual(pagesToFile(4, [], [[1]]), [], "a document with no pages of its own gets none");
  for (let k = 0; k < 300; k++) {
    const total = 1 + Math.floor(Math.random() * 12), n = 1 + Math.floor(Math.random() * 4), docs = Array.from({ length: n }, () => []);
    for (let p = 1; p <= total; p++) if (Math.random() < 0.6) docs[Math.floor(Math.random() * n)].push(p);
    const live = docs.filter((d) => d.length); if (!live.length) continue;
    const seen = []; live.forEach((own, i) => seen.push(...pagesToFile(total, own, live.filter((_, j) => j !== i))));
    assert.deepEqual(seen.sort((a, b) => a - b), Array.from({ length: total }, (_, i) => i + 1), "a page was lost or filed twice: " + JSON.stringify(live) + " of " + total);
  }
});

const big = Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.alloc(3000, 1)]), FIRM_NO = "6155550101", JO = "+16155550111";
const doc = (form, payer, pages) => ({ pages, is_tax_document: true, form, tax_year: 2026, payer, recipient_name: "JO DAY", legibility: 0.95, confidence: 0.97, missing_parts: [], note: "A form" });
test("pipeline: two forms in one PDF go to the firm's storage as two files, each cut to its own pages; if the file cannot be cut, the whole file is filed", async () => {
  for (const broken of [false, true]) {
    const t = new Date(2027, 0, 25, 10, 5, 0), puts = [], cuts = [];
    const ai = fakeAI((p) => (p.startsWith("The images are the pages") ? { documents: [doc("W2", "Acme Logistics", [1, 2]), doc("1098", "Regions Mortgage", [3])] } : p.startsWith("You write one message") ? { text: null } : null));
    const files = { put: async (x) => { puts.push(x); return "file" + puts.length; }, move: async () => {} };
    const cut = async (bytes, own, others) => { cuts.push({ own, others }); return broken ? null : Buffer.from("pages " + own.join(",")); };
    const store = memoryStore(), app = createApp({ store, sms: fakeSender(), email: fakeSender(), ai, clock: () => t, files, cut });
    await app.createFirm("f1", { plan: "Practice", name: "Test CPAs", email: "docs@test.example", smsNumber: FIRM_NO, senderStatus: "approved", mode: "autopilot", users: [{ id: "u1", first: "Pat", name: "Pat Owner", role: "owner", email: "pat@test.example" }] });
    await app.staff("f1", "u1", (T) => { T.S.firm.delivery = Object.assign(T.S.firm.delivery || {}, { provider: "Google Drive", folder: "Client Tax Docs", auto: "on", when: "arrival" }); T.importRows(T.parseCSV("First,Last,Email,Mobile\nJo,Day,jo@x.example,6155550111")); const e = T.S.engs[0]; T.itemsOf(e.id).find((i) => i.form === "W2").payer = "Acme Logistics"; e.confirmed = true; T.start(e.id); T.giveConsent(T.S.clients[0].id, "page"); });
    await app.inboundSms({ to: FIRM_NO, from: JO, body: "", media: [{ bytes: big, contentType: "application/pdf", pages: [big, big, big] }], providerId: "p1" });
    for (let i = 0; i < 3; i++) await app.staff("f1", "u1", () => {});
    const T = createEngine(); T.load(store.read("f1")); assert.equal(T.S.docs.length, 2); assert.equal(new Set(T.S.docs.map((d) => d.fileKey)).size, 1, "Tallyhound keeps the one original");
    assert.equal(puts.length, 2, "each form is filed once"); assert.deepEqual(cuts.map((c) => c.own.join()).sort(), ["1,2", "3"]); assert.deepEqual(cuts.find((c) => c.own.join() === "3").others, [[1, 2]]);
    if (broken) assert.ok(puts.every((p) => p.bytes.equals(big)), "a file that cannot be cut is filed whole");
    else assert.deepEqual(puts.map((p) => p.bytes.toString()).sort(), ["pages 1,2", "pages 3"]);
    assert.ok(T.S.docs.every((d) => d.master && d.master.id), "each document remembers its own file");
  }
});
