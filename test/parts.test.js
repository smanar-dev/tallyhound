// T-33, T-54, T-101: a firm saved as a core, one sealed row per client and audit rows, with the engine none the wiser.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const { createApp } = require("../packages/core/pipeline");
const { memoryStore, fakeSender, fakeAI } = require("../packages/core/memory");
const { encryptedStore, localKeyring } = require("../packages/core/crypto");
const { postgresStore, memoryBucket } = require("../packages/adapters/postgres");
const { createEngine } = require("../packages/engine");
const parts = require("../packages/core/parts");

const FIRM_NO = "+16155550100", mobile = (i) => "615" + String(2000000 + i);
const model = () => fakeAI((p) => p.startsWith("You read photos") ? { is_tax_document: true, form: "W2", tax_year: 2026, payer: "Acme Logistics", recipient_name: "", legibility: 0.95, confidence: 0.97, missing_parts: [], note: "A W-2" }
  : p.startsWith("You read text messages") ? { intent: "thanks", item_id: null, later_days: null, summary: "Says thanks", scope: "documents", sentiment: "calm", memory: null, staff_reply: null }
  : p.startsWith("You read emails") ? { items: [], question: false, summary: "Sent documents" } : p.startsWith("You write one message") ? { text: null } : null);
// One firm with n clients, all started and agreed to texts. store: a raw memory store (one value) or an encrypted one (parts).
async function firm(store, n) {
  let t = new Date(2027, 0, 25, 10, 5, 0); const sms = fakeSender(), email = fakeSender(), ai = model(), app = createApp({ store, sms, email, ai, clock: () => t });
  await app.createFirm("f1", { plan: "Firm", name: "Test CPAs", email: "docs@test.example", smsNumber: FIRM_NO, senderStatus: "approved", mode: "autopilot", users: [{ id: "u1", first: "Pat", name: "Pat Owner", role: "owner", email: "pat@test.example" }] });
  await app.staff("f1", "u1", (T) => { T.importRows(T.parseCSV("First,Last,Email,Mobile\n" + Array.from({ length: n }, (_, i) => "C" + i + ",L" + i + ",c" + i + "@x.example," + mobile(i)).join("\n"))); for (const e of T.S.engs) { e.confirmed = true; T.start(e.id); } for (const c of T.S.clients) T.giveConsent(c.id, "page"); });
  return { app, sms, email, ai, tick: (min) => { t = new Date(t.getTime() + min * 60000); } };
}
const sealedStore = () => { const inner = memoryStore(); return { inner, store: encryptedStore(inner, localKeyring(crypto.randomBytes(32))) }; };
const engine = (json) => { const T = createEngine(); T.load(json); return T; };
// What a run of ordinary traffic looks like: texts, photos, an email, a staff action, the timer.
async function traffic(x, n) {
  let seed = 11; const r = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  for (let k = 0; k < 40; k++) {
    const i = Math.floor(r() * n), kind = r();
    if (kind < 0.35) await x.app.inboundSms({ to: FIRM_NO, from: "+1" + mobile(i), body: "thanks", media: [], providerId: "t" + k });
    else if (kind < 0.7) await x.app.inboundSms({ to: FIRM_NO, from: "+1" + mobile(i), body: "", media: [{ bytes: Buffer.from("photo-" + k), contentType: "image/jpeg" }], providerId: "p" + k });
    else if (kind < 0.85) await x.app.inboundEmail({ to: "docs@test.example", from: "c" + i + "@x.example", body: "attached", attachments: [{ bytes: Buffer.from("pdf-" + k), contentType: "application/pdf" }], providerId: "e" + k, trusted: true });
    else if (kind < 0.93) await x.app.staff("f1", "u1", (T) => { const e = T.S.engs[i]; T.setItem(T.itemsOf(e.id)[0].id, "waived", "Not needed this year"); });
    else { x.tick(60 * 26); await x.app.tick("f1"); }
    x.tick(7);
  }
}

test("parts: splitting and joining gives back the same workspace, in the same order, and an untouched client's part comes out identical", () => {
  const T = createEngine(); const whole = JSON.parse(T.dump()), first = parts.split(JSON.parse(T.dump()));
  assert.ok(first.slices.size > 3); assert.equal(first.audit.length, whole.state.audit.length);
  const m = parts.merge(JSON.parse(JSON.stringify(first.core)), new Map([...first.slices].map(([k, v]) => [k, JSON.parse(JSON.stringify(v))])));
  for (const k of Object.keys(whole.state)) if (k !== "audit") assert.deepEqual(m.whole.state[k], whole.state[k], k);
  assert.equal(m.whole.seq, whole.seq);
  // Loaded again by the engine, one message added for one client: only that client's part differs.
  const U = engine(JSON.stringify(m.whole)), e = U.S.engs[0]; U.inboundText(e.clientId, "thank you"); const second = parts.split(JSON.parse(U.dump()), m.known, m.bounds);
  const changed = [...second.slices].filter(([k, v]) => JSON.stringify(v) !== JSON.stringify(first.slices.get(k))).map(([k]) => k);
  assert.deepEqual(changed, [parts.partKey(e.clientId)]);
  // Joined once more, the order of every list is what the engine left.
  const again = parts.merge(second.core, second.slices), V = JSON.parse(U.dump());
  for (const k of parts.SLICED) assert.deepEqual(again.whole.state[k].map((x) => x.id || x.year), V.state[k].map((x) => x.id || x.year), k);
});

test("parts: the same traffic through the old single value and through parts ends in the same workspace", async () => {
  const N = 12, raw = memoryStore(), a = await firm(raw, N), s = sealedStore(), b = await firm(s.store, N);
  await traffic(a, N); await traffic(b, N);
  const A = JSON.parse(raw.read("f1")), B = JSON.parse(await s.store.readState("f1"));
  for (const k of Object.keys(A.state)) assert.deepEqual(B.state[k], A.state[k], "the two differ in " + k);
  assert.equal(B.seq, A.seq); assert.deepEqual(b.sms.sent.map((m) => [m.to, m.body]), a.sms.sent.map((m) => [m.to, m.body])); assert.equal(b.email.sent.length, a.email.sent.length);
  assert.ok(A.state.audit.length > N, "the audit trail came back whole from its rows"); assert.ok(s.inner.audits.get("f1").length > 5); assert.equal(s.inner.parts.get("f1").size, N);
});

test("parts: one text touches the core and one client's row, however large the firm; nothing readable is stored; the index holds no numbers", async () => {
  const cost = async (n) => { const s = sealedStore(), x = await firm(s.store, n); await x.app.inboundSms({ to: FIRM_NO, from: "+1" + mobile(1), body: "", media: [{ bytes: Buffer.from("w2"), contentType: "image/jpeg" }], providerId: "w" });
    s.inner.touched.read = s.inner.touched.written = 0; const calls = x.ai.calls.length; const r = await x.app.inboundSms({ to: FIRM_NO, from: "+1" + mobile(1), body: "thanks", media: [], providerId: "q" }); assert.ok(r.client); assert.ok(x.ai.calls.length > calls);
    return { s, x, bytes: s.inner.touched.read + s.inner.touched.written }; };
  const small = await cost(5), large = await cost(150);
  assert.ok(large.bytes < small.bytes * 1.5, "150 clients cost " + large.bytes + " bytes, 5 cost " + small.bytes); assert.ok(large.bytes < 200 * 1024);
  const stored = [large.s.inner.firms.get("f1")].concat([...large.s.inner.parts.get("f1").values()].map((p) => p.sealed), large.s.inner.audits.get("f1")).map((v) => Buffer.from(v, "base64").toString("latin1")).join("\n");
  for (const secret of ["c1@x.example", mobile(1), "Acme Logistics", "Pat Owner"]) assert.ok(!stored.includes(secret), secret + " is readable in what was stored");
  for (const p of large.s.inner.parts.get("f1").values()) for (const h of p.hashes) { assert.match(h, /^[0-9a-f]{40}$/); }
  // Another firm's key gives another hash for the same number, so the index cannot be matched across firms.
  const other = await cost(5), h1 = new Set([...small.s.inner.parts.get("f1").values()].flatMap((p) => p.hashes)), h2 = [...other.s.inner.parts.get("f1").values()].flatMap((p) => p.hashes); assert.ok(h2.every((h) => !h1.has(h)));
});

test("parts: a changed number is found under the new one and not the old; a shared number loads both clients; a removed client's row goes", async () => {
  const s = sealedStore(), x = await firm(s.store, 6), state = async () => engine(await s.store.readState("f1"));
  await x.app.staff("f1", "u1", (T) => { T.S.clients[2].mobile = "6159990000"; T.S.clients[4].mobile = T.S.clients[3].mobile; });
  let T = await state(); const c2 = T.S.clients[2].id, c3 = T.S.clients[3].id, c4 = T.S.clients[4].id;
  assert.equal((await x.app.inboundSms({ to: FIRM_NO, from: "+1" + mobile(2), body: "hello", media: [], providerId: "n1" })).client, null, "the old number is nobody now");
  assert.equal((await x.app.inboundSms({ to: FIRM_NO, from: "+16159990000", body: "hello", media: [], providerId: "n2" })).client, c2);
  const both = await s.store.readScope("f1", { mobile: mobile(3) }); assert.deepEqual(engine(both).S.clients.map((c) => c.id).sort(), [c3, c4].sort());
  assert.ok([c3, c4].includes((await x.app.inboundSms({ to: FIRM_NO, from: "+1" + mobile(3), body: "hello", media: [], providerId: "n3" })).client));
  // The unknown sender's words went to a person, and no client's row was loaded for it.
  T = await state(); assert.ok(T.S.tray.length >= 1);
  await x.app.staff("f1", "u1", (U) => { const e = U.engOf(c2); U.S.clients = U.S.clients.filter((c) => c.id !== c2); U.S.engs = U.S.engs.filter((y) => y.clientId !== c2); for (const k of ["items", "msgs", "docs", "tasks", "alerts", "hlog"]) U.S[k] = U.S[k].filter((y) => y.engId !== e.id); });
  assert.equal(s.inner.parts.get("f1").size, 5); assert.ok(!s.inner.parts.get("f1").has(parts.partKey(c2)));
  assert.equal((await x.app.inboundSms({ to: FIRM_NO, from: "+16159990000", body: "hello", media: [], providerId: "n4" })).client, null);
  assert.equal((await state()).S.clients.length, 5);
});

test("parts: a firm saved the old way is split the first time it is saved, and reads the same before and after", async () => {
  const s = sealedStore(), T = createEngine(); const before = JSON.parse(T.dump());
  await s.store.create("old", T.dump(), {}); assert.equal((s.inner.parts.get("old") || new Map()).size, 0);
  assert.deepEqual(JSON.parse(await s.store.readState("old")).state.clients, before.state.clients);
  await s.store.lock("old", async (json) => json);
  assert.equal(s.inner.parts.get("old").size, before.state.clients.length); const after = JSON.parse(await s.store.readState("old"));
  for (const k of Object.keys(before.state)) assert.deepEqual(after.state[k], before.state[k], k);
  // Nothing changed on the next turn, so nothing is written.
  s.inner.touched.written = 0; await s.store.lock("old", async (json) => json); assert.equal(s.inner.touched.written, 0);
});

let pgmem = null; try { pgmem = require("pg-mem"); } catch (e) { /* optional */ }
test("parts: the Postgres store keeps the same parts, index and audit rows, and a firm's closure removes them", { skip: pgmem ? false : "pg-mem is not installed" }, async () => {
  const db = pgmem.newDb(); db.public.none(fs.readFileSync(path.join(__dirname, "../db/schema.sql"), "utf8")); db.public.none(fs.readFileSync(path.join(__dirname, "../db/migrations/015_firm_parts.sql"), "utf8"));
  const { Pool } = db.adapters.createPg(), pool = new Pool(), store = encryptedStore(postgresStore(pool, memoryBucket(), { parts: true }), localKeyring(crypto.randomBytes(32)));
  const x = await firm(store, 4), n = async (t) => +(await pool.query("select count(*) as n from " + t)).rows[0].n;
  assert.equal(await n("firm_parts"), 4); assert.ok((await n("firm_index")) >= 8); assert.ok((await n("firm_audit")) >= 1);
  const r = await x.app.inboundSms({ to: FIRM_NO, from: "+1" + mobile(2), body: "", media: [{ bytes: Buffer.from("w2"), contentType: "image/jpeg" }], providerId: "s1" }); assert.ok(r.client); assert.equal(r.docs.length, 1);
  const T = engine(await store.readState("f1")); assert.equal(T.S.clients.length, 4); assert.equal(T.S.docs.length, 1); assert.ok(T.S.audit.length > 4);
  assert.equal(engine(await store.readScope("f1", { email: "C3@x.example" })).S.clients.length, 1);
  const rows = (await pool.query("select sealed from firm_parts")).rows.map((y) => Buffer.from(y.sealed, "base64").toString("latin1")).join(""); assert.ok(!rows.includes("c2@x.example"));
  await store.destroyFirm("f1"); for (const t of ["firm_parts", "firm_index", "firm_audit"]) assert.equal(await n(t), 0, t);
});
