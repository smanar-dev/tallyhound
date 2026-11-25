// The reader against the synthetic test set (docs/FETCH.md, acceptance criteria). On made-up files these targets are easy to
// meet; the real bar is set by each pilot firm's shadow import of its own organizers, which this cannot stand in for.
import test from "node:test";
import assert from "node:assert/strict";
import { readPages, readPdf, stripNumbers, matchFile } from "../src/reader.ts";
import { pdfPagesWith } from "./harness.ts";
import { testSet, testSetCsv } from "./fixtures/testset.ts";
import { createEngine } from "../src/kit.ts";

const SET = testSet(), FILES = SET.flatMap((c) => c.files.map((f) => ({ c, f })));
const norm = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");

test("numbers: every token longer than four digits and every token next to a $ sign is dropped; years and form numbers stay", () => {
  assert.equal(stripNumbers("W-2   Midtown Transit   52,310.00"), "W-2 Midtown Transit"); assert.equal(stripNumbers("Interest $412.00 from 1099-INT in 2025"), "Interest from 1099-INT in 2025");
  assert.equal(stripNumbers("SSN 123-45-6789 EIN 62-1234567 acct 4455667788"), "SSN EIN acct"); assert.equal(stripNumbers("Box 1 and line 26"), "Box 1 and line 26");
});
test("the test set: 60 clients, joint and single, returning and new, organizers, returns, source documents and scans", () => {
  assert.equal(SET.length, 60); assert.ok(SET.filter((c) => c.spouse).length >= 15); assert.ok(SET.filter((c) => !c.returning).length >= 10);
  const kinds = new Set(FILES.map((x) => x.f.kind)); for (const k of ["organizer", "return", "source_doc", "unknown"]) assert.ok(kinds.has(k as never), k);
  assert.ok(FILES.some((x) => x.f.truth.schedules.includes("Schedule E")) && FILES.some((x) => x.f.truth.lines.includes("car loan interest")));
});
test("organizers: at least 98% of payer lines come back with the right form code and name", () => {
  let n = 0, ok = 0; for (const { f } of FILES.filter((x) => x.f.kind === "organizer")) { const r = readPages(f.pages); assert.equal(r.kind, "organizer"); for (const [form, payer] of f.truth.payers) { n++; if (r.findings.some((x) => x.kind === "payer" && x.form === form && norm(x.payer || "") === norm(payer))) ok++; } }
  assert.ok(n > 40); assert.ok(ok / n >= 0.98, ok + " of " + n);
});
test("source documents: at least 98% get the right form code and at least 95% the right issuer; scans come back unreadable", () => {
  let n = 0, form = 0, issuer = 0; for (const { f } of FILES.filter((x) => x.f.kind === "source_doc" || x.f.kind === "return")) for (const [code, payer] of f.truth.payers.filter(([c]) => f.kind === "source_doc" || c === "W2")) { n++; const r = readPages(f.pages), hit = r.findings.filter((x) => x.kind === "payer" && x.form === code); if (hit.length) form++; if (hit.some((x) => norm(x.payer || "") === norm(payer))) issuer++; }
  assert.ok(n > 20); assert.ok(form / n >= 0.98, "form " + form + " of " + n); assert.ok(issuer / n >= 0.95, "issuer " + issuer + " of " + n);
  for (const { f } of FILES.filter((x) => x.f.truth.scanned)) assert.equal(readPages(f.pages).status, "unreadable");
});
test("returns: at least 95% of schedule and line detections are right, with no false ones", () => {
  let n = 0, ok = 0, wrong = 0; for (const { f } of FILES.filter((x) => x.f.kind === "return")) { const r = readPages(f.pages), got = new Set(r.findings.filter((x) => x.kind === "schedule" || x.kind === "line").map((x) => x.value)); const want = new Set([...f.truth.schedules, ...f.truth.lines]);
    for (const w of want) { n++; if (got.has(w)) ok++; } for (const g of got) if (!want.has(g!) && g !== "Schedule 1-A") wrong++; }
  assert.ok(n > 15); assert.ok(ok / n >= 0.95, ok + " of " + n); assert.equal(wrong, 0);
});
test("no finding from any file in the test set holds a number longer than four digits or anything next to a $ sign", () => {
  for (const { f } of FILES) { const s = JSON.stringify(readPages(f.pages).findings); assert.ok(!/\d{5,}|\$|\d{3}-\d{2}-\d{4}/.test(s), f.name + ": " + s.slice(0, 200)); }
});
test("a real PDF's text layer is read the same way, and a page with no text is unreadable", async () => {
  const f = FILES.find((x) => x.f.kind === "organizer")!.f, r = await readPdf(new Uint8Array(pdfPagesWith(f.pages.map((p) => p.split("\n")))));
  assert.equal(r.kind, "organizer"); assert.ok(r.findings.filter((x) => x.kind === "payer").length >= f.truth.payers.length);
  assert.equal((await readPdf(new Uint8Array(pdfPagesWith([[]])))).status, "unreadable"); assert.equal((await readPdf(new Uint8Array(Buffer.from("not a pdf")))).status, "unreadable");
});
test("end to end on the test set: import, read, build; returning clients with organizers are mostly ready, new clients need a look, and nothing is sent", () => {
  const T = createEngine(); T.blank({ letters: true, plan: "Practice", name: "Maple & Pine", email: "d@m.example", mode: "autopilot", confirmAll: false, now: new Date(2027, 0, 11, 10), users: [{ id: "u1", first: "Dana", name: "Dana Whitfield", role: "owner", email: "d@m.example" }] }); T.setUser("u1");
  const b = T.importBegin("testset.csv", testSetCsv(SET)); assert.deepEqual(b.dropped, ["SSN"]); const v = T.importMap(b.id); assert.equal(v.rows.filter((r: { status: string }) => r.status === "ok").length, 60);
  // A file that finds no client waits in the tray: here, only the scans with no text and no telling name.
  const tray: string[] = []; for (const { f } of FILES) { const r = readPages(f.pages), got = T.importRecord(b.id, { file: f.name, kind: r.kind, status: r.status, findings: r.findings, where: "browser" }); if (got.tray) tray.push(f.name); }
  assert.deepEqual(tray, FILES.filter((x) => x.f.truth.scanned).map((x) => x.f.name));
  const built = T.importBuild(b.id); assert.equal(built.counts.read + 0 >= 40, true); assert.ok(built.counts.ready >= 10, "ready " + built.counts.ready); const newOnes = built.lists.filter((l: { clientId: string }) => !T.client(l.clientId).returning);
  assert.ok(newOnes.every((l: { group: string; reasons: string[] }) => l.group === "look" && l.reasons.includes("New client"))); assert.equal(T.S.msgs.length, 0);
  assert.equal(matchFile("2003 Sato organizer.pdf", [{ key: "a", ref: "2003", last: "Sato" }, { key: "b", ref: "2004", last: "Ruiz" }]), "a");
});
