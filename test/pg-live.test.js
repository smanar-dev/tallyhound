// The database code against a REAL Postgres server. Skipped unless DATABASE_URL is set:
//   DATABASE_URL=postgres://postgres@127.0.0.1:5432/postgres node --test test/pg-live.test.js
// It drops and recreates the Tallyhound tables in that database. Never point it at one that matters.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const URL_ = process.env.DATABASE_URL; let pg = null; try { pg = require("pg"); } catch (e) { /* npm install pg */ }
const skip = !URL_ ? "DATABASE_URL is not set" : !pg ? "the pg package is not installed" : false;
const { createApp } = require("../packages/core/pipeline");
const { fakeSender, fakeAI } = require("../packages/core/memory");
const { localKeyring, encryptedStore } = require("../packages/core/crypto");
const { postgresStore, memoryBucket } = require("../packages/adapters/postgres");
const { createEngine } = require("../packages/engine");
const FIRM_NO = "+16155550100", big = Buffer.alloc(40000, 7);
const model = () => fakeAI((p) => p.startsWith("You read photos") ? { is_tax_document: true, form: "W2", tax_year: 2026, payer: "Acme Logistics", recipient_name: "JO DAY", legibility: 0.95, confidence: 0.97, missing_parts: [], note: "A W-2" } : p.startsWith("You read text messages") ? { intent: "thanks", item_id: null, summary: "thanks", scope: "documents", sentiment: "calm" } : p.startsWith("You write one message") ? { text: null } : null);
async function fresh() {
  const admin = new pg.Pool({ connectionString: URL_, max: 2 });
  await admin.query("drop table if exists sessions, users, usage_monthly, audit_log, inbound_events, files, firm_state, firms cascade");
  await admin.query(fs.readFileSync(path.join(__dirname, "../db/schema.sql"), "utf8")); return admin;
}
test("real Postgres: the schema loads and the sealed pipeline runs end to end", { skip }, async () => {
  const admin = await fresh(), v = (await admin.query("select version() as v")).rows[0].v; console.log("  server: " + v.split(",")[0]);
  const pool = new pg.Pool({ connectionString: URL_, max: 5 }), bucket = memoryBucket(), store = encryptedStore(postgresStore(pool, bucket), localKeyring(crypto.randomBytes(32)));
  let t = new Date(2027, 0, 25, 10, 5); const sms = fakeSender(), app = createApp({ store, sms, email: fakeSender(), ai: model(), clock: () => t });
  await app.createFirm("f1", { plan: "Practice", name: "Test CPAs", email: "office@test.example", inbox: "t@docs.tallyhound.example", smsNumber: FIRM_NO, senderStatus: "approved", mode: "autopilot", users: [{ id: "u1", first: "Pat", name: "Pat Owner", role: "owner", email: "pat@test.example" }] });
  await app.staff("f1", "u1", (T) => { T.importRows(T.parseCSV("First,Last,Email,Mobile\nJo,Day,jo@x.example,6155550111")); const e = T.S.engs[0]; T.itemsOf(e.id).find((i) => i.form === "W2").payer = "Acme Logistics"; e.confirmed = true; T.start(e.id); T.giveConsent(T.S.clients[0].id, "page"); });
  const r = await app.inboundSms({ to: FIRM_NO, from: "+16155550111", body: "", media: [{ bytes: big, contentType: "image/jpeg" }], providerId: "s1" }); assert.deepEqual(r.docs, ["accepted"]);
  const row = (await admin.query("select sealed, version, bytes from firm_state where firm_id = 'f1'")).rows[0]; assert.ok(!Buffer.from(row.sealed, "base64").toString("latin1").includes("jo@x.example")); assert.ok(+row.version >= 3);
  assert.equal((await admin.query("select count(*)::int as n from files where deleted_at is null")).rows[0].n, 1);
  assert.equal(await store.inner.firstTime("twilio", "SM1", "f1"), true); assert.equal(await store.inner.firstTime("twilio", "SM1", "f1"), false);
  await pool.end(); await admin.end();
});
test("real Postgres: forty events for one firm from two separate servers, all at once, and none is lost or doubled", { skip }, async () => {
  const admin = await fresh(), ring = localKeyring(crypto.randomBytes(32)), bucket = memoryBucket(); let t = new Date(2027, 0, 25, 10, 5);
  const server = () => { const pool = new pg.Pool({ connectionString: URL_, max: 6 }), sms = fakeSender(); return { pool, sms, app: createApp({ store: encryptedStore(postgresStore(pool, bucket), ring), sms, email: fakeSender(), ai: model(), clock: () => t }) }; };
  const A = server(), B = server();
  await A.app.createFirm("f1", { plan: "Practice", name: "Test CPAs", email: "office@test.example", smsNumber: FIRM_NO, senderStatus: "approved", mode: "autopilot", users: [{ id: "u1", first: "Pat", name: "Pat Owner", role: "owner", email: "pat@test.example" }] });
  await A.app.staff("f1", "u1", (T) => { T.importRows(T.parseCSV("First,Last,Email,Mobile\nJo,Day,jo@x.example,6155550111")); const e = T.S.engs[0]; e.confirmed = true; T.start(e.id); T.giveConsent(T.S.clients[0].id, "page"); });
  const before = +(await admin.query("select version from firm_state where firm_id = 'f1'")).rows[0].version, N = 40;
  const started = Date.now();
  const results = await Promise.all(Array.from({ length: N }, (_, i) => (i % 2 ? A : B).app.inboundSms({ to: FIRM_NO, from: "+16155550111", body: "message number " + i, providerId: "p" + i })));
  // the same forty again, as a provider retry would send them
  const again = await Promise.all(Array.from({ length: N }, (_, i) => (i % 2 ? B : A).app.inboundSms({ to: FIRM_NO, from: "+16155550111", body: "message number " + i, providerId: "p" + i })));
  console.log("  80 concurrent calls took " + (Date.now() - started) + " ms");
  assert.ok(results.every((r) => r.handled && !r.duplicate)); assert.ok(again.every((r) => r.duplicate), "a retried delivery was processed twice");
  const T = createEngine(); T.load(await encryptedStore(postgresStore(A.pool, bucket), ring).readState("f1"));
  const got = T.S.msgs.filter((m) => m.dir === "in" && /^message number/.test(m.body)).map((m) => +m.body.split(" ")[2]).sort((a, b) => a - b);
  assert.deepEqual(got, Array.from({ length: N }, (_, i) => i), "an inbound message was lost or stored twice");
  const outIds = [...A.sms.sent, ...B.sms.sent].map((m) => m.idempotencyKey); assert.equal(new Set(outIds).size, outIds.length, "the same outgoing text was sent by both servers");
  const after = +(await admin.query("select version from firm_state where firm_id = 'f1'")).rows[0].version; assert.ok(after - before >= N, "every event should have saved once: " + before + " -> " + after);
  await A.pool.end(); await B.pool.end(); await admin.end();
});
test("real Postgres: the row lock makes a second writer wait for the first", { skip }, async () => {
  const admin = await fresh(), pool = new pg.Pool({ connectionString: URL_, max: 4 }), store = postgresStore(pool, memoryBucket());
  await store.create("f1", "v0", { name: "x" }); const order = [];
  const slow = store.lock("f1", async (v) => { order.push("a-in:" + v); await new Promise((ok) => setTimeout(ok, 300)); order.push("a-out"); return "v1"; });
  await new Promise((ok) => setTimeout(ok, 60));
  const fast = store.lock("f1", async (v) => { order.push("b-in:" + v); return "v2"; });
  await Promise.all([slow, fast]); assert.deepEqual(order, ["a-in:v0", "a-out", "b-in:v1"], "the second writer read stale data"); assert.equal(await store.readState("f1"), "v2");
  await assert.rejects(store.lock("f1", async () => { throw new Error("boom"); })); assert.equal(await store.readState("f1"), "v2", "a failed change must leave nothing behind");
  await pool.end(); await admin.end();
});
