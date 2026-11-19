// Texts and email arriving from the providers: who is allowed to call, store-then-answer, retries, and the hand-off to a person.
import test from "node:test";
import assert from "node:assert/strict";
import { build, KINDS, type Harness } from "./harness.ts";
import { createEngine, kitMemory, type Engine, type PrepareOpts } from "../src/kit.ts";
import { RETRY_AFTER_S } from "../src/queue.ts";

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(40000, 7)]), PDF = Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.alloc(30000, 32)]);
const FIRM_NO = "+16155550101", JO = "+16155550111", INBOX = "test1@docs.tallyhound.test";
// The stand-in model from the kit's own tests: a clean W-2 for Jo Day, a thank-you text, a plain email.
const model = () => kitMemory.fakeAI((p: string) => p.startsWith("You read photos") ? { is_tax_document: true, form: "W2", tax_year: 2026, payer: "Acme Logistics", recipient_name: "JO DAY", legibility: 0.95, confidence: 0.97, missing_parts: [], note: "A W-2" }
  : p.startsWith("You read text messages") ? { intent: "thanks", item_id: null, summary: "thanks", scope: "documents", sentiment: "calm" }
  : p.startsWith("You read emails") ? { intent: "sending", item_id: null, summary: "Sending documents", scope: "documents", sentiment: "calm" } : null);
// One firm on Autopilot with an approved number and one client, Jo Day, who has agreed to texts and is being asked for a W-2.
async function firmWithJo(kind: "memory" | "postgres", prepare?: PrepareOpts) {
  const H = await build(kind, { ai: model(), prepare }), { firmId, ownerId } = await H.newFirm();
  await H.app.staff(firmId, ownerId, (T: Engine) => { T.S.firm.hound.mode = "autopilot"; T.S.firm.senderStatus = "approved"; T.S.firm.phone = "(615) 555-0100";
    T.importRows(T.parseCSV("First,Last,Email,Mobile\nJo,Day,jo@x.example,6155550111")); const e = T.S.engs[0]; T.itemsOf(e.id).find((i: { form: string }) => i.form === "W2").payer = "Acme Logistics"; e.confirmed = true; T.start(e.id); T.giveConsent(T.S.clients[0].id, "page"); });
  const state = async () => { const T = createEngine(); T.load(await H.store.readState(firmId)); return T; };
  return Object.assign(H, { firmId, ownerId, state });
}
const mms = (H: Harness, sid: string, n = 1) => { const p: Record<string, string> = { To: FIRM_NO, From: JO, Body: "", NumMedia: String(n), MessageSid: sid }; for (let i = 0; i < n; i++) { const u = "https://api.twilio.com/2010-04-01/Accounts/AC1/Messages/" + sid + "/Media/ME" + sid + i; H.media.set(u, JPEG); p["MediaUrl" + i] = u; p["MediaContentType" + i] = "image/jpeg"; } return p; };
const docs = (T: Engine) => T.S.docs.filter((d: { engId?: string }) => d.engId);

for (const kind of KINDS) {
  const name = (s: string) => "hooks (" + kind + "): " + s;

  test(name("T-07: a texted photo is stored and answered at once, read by the worker, and the same webhook twice makes one document"), async () => {
    const H = await firmWithJo(kind), p = mms(H, "MM1"), before = (await H.state()).S.msgs.length;
    const r = await H.twilioPost("/hooks/twilio", p); assert.equal(r.statusCode, 200); assert.match(r.body, /<Response\/>/);
    await H.inbox.drain();
    let T = await H.state(); assert.equal(docs(T).length, 1); assert.equal(docs(T)[0].state, "accepted"); assert.ok(docs(T)[0].fileKey);
    assert.deepEqual(H.mediaCalls, ["GET MEMM10", "DELETE MEMM10"], "Twilio's copy is deleted only after ours is saved"); assert.equal(H.media.size, 0);
    const again = await H.twilioPost("/hooks/twilio/fallback", p); assert.equal(again.statusCode, 200); await H.inbox.drain();
    T = await H.state(); assert.equal(docs(T).length, 1, "a repeated delivery is not processed twice"); assert.equal(T.S.msgs.filter((m: { dir: string }) => m.dir === "in").length, (await H.state()).S.msgs.filter((m: { dir: string }) => m.dir === "in").length);
    assert.ok(T.S.msgs.length > before); assert.deepEqual(await H.inbox.counts(), { waiting: 0, dead: 0 });
    // What was stored for the queue was sealed, and is gone once the work is done.
    const kept = kind === "memory" ? [...H.inner.files.values()] : []; for (const f of kept) assert.ok(!f.bytes.toString("latin1").includes("6155550111"));
    await H.close();
  });

  test(name("a caller without Twilio's signature is turned away and nothing is stored; an unknown number is answered and dropped"), async () => {
    const H = await firmWithJo(kind);
    for (const path of ["/hooks/twilio", "/hooks/twilio/fallback", "/hooks/twilio/status", "/hooks/twilio/voice"]) assert.equal((await H.twilioPost(path, mms(H, "MMx"), true)).statusCode, 403, path);
    const changed = mms(H, "MM2"), sent = await H.server.inject({ method: "POST", url: "/hooks/twilio", payload: new URLSearchParams({ ...changed, From: "+16155550999" }).toString(), headers: { "content-type": "application/x-www-form-urlencoded", "x-twilio-signature": "AAAA" } }); assert.equal(sent.statusCode, 403);
    assert.equal((await H.twilioPost("/hooks/twilio", { ...mms(H, "MM3"), To: "+16155559999" })).statusCode, 200);
    await H.inbox.drain(); assert.deepEqual(await H.inbox.counts(), { waiting: 0, dead: 0 }); assert.equal(docs(await H.state()).length, 0);
    await H.close();
  });

  test(name("T-128: a failure is retried later, and after five tries the event goes to a person and is deleted after 30 days"), async () => {
    const H = await firmWithJo(kind); H.mediaDown(true);
    assert.equal((await H.twilioPost("/hooks/twilio", mms(H, "MM1"))).statusCode, 200, "Twilio still gets its answer at once");
    await H.inbox.drain(); assert.equal(docs(await H.state()).length, 0); assert.deepEqual(await H.inbox.counts(), { waiting: 1, dead: 0 });
    await H.inbox.drain(); assert.equal(H.mediaCalls.length, 1, "not tried again before its time");
    H.mediaDown(false); H.advance(RETRY_AFTER_S[0]! + 1); await H.worker.pass();
    assert.equal(docs(await H.state()).length, 1, "the retry worked, with the photo still at Twilio to fetch"); assert.deepEqual(await H.inbox.counts(), { waiting: 0, dead: 0 });
    // A second message that never works.
    H.mediaDown(true); await H.twilioPost("/hooks/twilio", mms(H, "MM2")); await H.inbox.drain();
    for (const s of RETRY_AFTER_S) { H.advance(s + 1); await H.inbox.drain(); }
    assert.deepEqual(await H.inbox.counts(), { waiting: 0, dead: 1 });
    const T = await H.state(), y = T.S.tray.find((t: { why?: string }) => t.why === "Could not be processed"); assert.ok(y, "a person is told"); assert.match(y.text, /ask them to send it again/);
    H.advance(3600); await H.inbox.drain(); assert.equal(H.mediaCalls.filter((c) => c.includes("MM2")).length, 5, "a dead event is not tried again");
    assert.equal(await H.inbox.sweep(), 0); H.advance(31 * 86400); assert.equal(await H.inbox.sweep(), 1); assert.equal(await H.inbox.sweep(), 0);
    await H.close();
  });

  test(name("no client link key ever reaches a browser, and a failed store leaves nothing half-queued"), async () => {
    const H = await firmWithJo(kind), T = await H.state(); assert.match(T.S.clients[0].key, /^[a-z]{28}$/, "the invitation made Jo a link key");
    const owner = await H.signInAs("pat1@firm1.test"), body = (await owner.get("/api/state")).raw.body; assert.ok(!body.includes(T.S.clients[0].key)); assert.equal((await owner.get("/api/state")).json.state.clients[0].key, undefined);
    // The row cannot be written: the provider gets an error (and will deliver again), and the stored copy is removed.
    const real = H.queue.add; H.queue.add = async () => { throw new Error("database is down"); };
    const files = async () => kind === "memory" ? H.inner.files.size : 0, before = await files();
    assert.equal((await H.twilioPost("/hooks/twilio", mms(H, "MM9"))).statusCode, 500); assert.equal(await files(), before); H.queue.add = real;
    assert.equal((await H.twilioPost("/hooks/twilio", mms(H, "MM9"))).statusCode, 200); await H.inbox.drain(); assert.equal(docs(await H.state()).length, 1, "the redelivery is processed");
    await H.close();
  });

  test(name("a file that fails the virus scan is not kept, the firm is told, and the rest of the message is still handled"), async () => {
    const BAD = Buffer.concat([JPEG, Buffer.from("EICAR-TEST")]), H = await firmWithJo(kind, { scan: async (b) => ({ clean: !b.includes("EICAR-TEST"), name: "Eicar-Test-Signature" }) });
    await H.postmarkPost("/hooks/postmark/inbound", { MessageID: "pmv", OriginalRecipient: INBOX, From: "jo@x.example", Subject: "docs", TextBody: "Two files", Headers: [{ Name: "Authentication-Results", Value: "mx; dmarc=pass" }],
      Attachments: [{ Name: "w2.jpg", ContentType: "image/jpeg", Content: JPEG.toString("base64") }, { Name: "invoice.jpg", ContentType: "image/jpeg", Content: BAD.toString("base64") }] });
    await H.inbox.drain(); const T = await H.state();
    assert.equal(T.S.docs.length, 1, "the clean file was read, the other was not kept"); const y = T.S.tray.find((t: { why?: string }) => t.why === "Blocked by the virus scan"); assert.ok(y, "the firm is told"); assert.match(y.text, /^1 file that arrived by email failed the virus scan/);
    assert.deepEqual(await H.inbox.counts(), { waiting: 0, dead: 0 });
    await H.close();
  });

  test(name("an event a crashed worker left half done is picked up again and still processed once"), async () => {
    const H = await firmWithJo(kind); assert.equal(await H.inbox.accept("twilio", "MM1", H.firmId, "sms", Buffer.from(JSON.stringify(mms(H, "MM1")))), "queued");
    const now = H.clock(), j = await H.queue.claim(now, new Date(now.getTime() - 600000)); assert.ok(j, "a worker takes it, then dies");
    await H.inbox.drain(); assert.equal(docs(await H.state()).length, 0, "nobody else touches it while it may still be running");
    H.advance(11 * 60); await H.inbox.drain(); assert.equal(docs(await H.state()).length, 1);
    await H.close();
  });

  test(name("T-09: an email with two attachments and a note gets one combined reply; the wrong password gets nothing"), async () => {
    const H = await firmWithJo(kind), sentBefore = H.email.sent.length + H.sms.sent.length;
    const mail = { MessageID: "pm1", OriginalRecipient: INBOX, From: "Jo Day <jo@x.example>", Subject: "My documents", TextBody: "Here are two things for you.", Headers: [{ Name: "Authentication-Results", Value: "mx; dmarc=pass" }],
      Attachments: [{ Name: "w2.jpg", ContentType: "image/jpeg", Content: JPEG.toString("base64") }, { Name: "scan.pdf", ContentType: "application/pdf", Content: PDF.toString("base64") }] };
    assert.equal((await H.postmarkPost("/hooks/postmark/inbound", mail, "guess")).statusCode, 401); assert.deepEqual(await H.inbox.counts(), { waiting: 0, dead: 0 });
    assert.equal((await H.postmarkPost("/hooks/postmark/inbound", mail)).statusCode, 200); assert.equal((await H.postmarkPost("/hooks/postmark/inbound", mail)).statusCode, 200);
    await H.inbox.drain(); const T = await H.state();
    assert.equal(T.S.docs.length, 2, "both attachments were read, once"); assert.equal(H.email.sent.length + H.sms.sent.length - sentBefore, 1, "one reply, not one per attachment");
    assert.equal(T.S.msgs.filter((m: { dir: string; channel: string }) => m.dir === "in" && m.channel === "email").length, 1);
    await H.close();
  });

  test(name("email whose sender cannot be confirmed waits for a person and gets no reply"), async () => {
    const H = await firmWithJo(kind), sentBefore = H.email.sent.length + H.sms.sent.length;
    await H.postmarkPost("/hooks/postmark/inbound", { MessageID: "pm2", OriginalRecipient: INBOX, From: "jo@x.example", Subject: "W-2", TextBody: "Here", Headers: [{ Name: "Authentication-Results", Value: "mx; dmarc=fail" }], Attachments: [{ Name: "w2.jpg", ContentType: "image/jpeg", Content: JPEG.toString("base64") }] });
    await H.inbox.drain(); const T = await H.state();
    assert.equal(docs(T).length, 0, "nothing reaches Jo's file"); assert.ok(T.S.tray.some((y: { why?: string }) => /could not be confirmed/.test(y.why || ""))); assert.equal(H.email.sent.length + H.sms.sent.length, sentBefore);
    await H.close();
  });

  test(name("T-60: a hard bounce stops email to that address, an undelivered text is marked failed, and both tell the firm"), async () => {
    const H = await firmWithJo(kind); let T = await H.state(); const out = T.S.msgs.find((m: { dir: string; providerId?: string }) => m.dir === "out" && m.providerId); assert.ok(out, "the first request went out");
    assert.equal((await H.postmarkPost("/hooks/postmark/bounce", { RecordType: "Bounce", Type: "Transient", Email: "jo@x.example", From: INBOX })).statusCode, 200); assert.equal((await H.state()).S.clients[0].emailOk, true, "a soft bounce changes nothing");
    await H.postmarkPost("/hooks/postmark/bounce", { RecordType: "Bounce", Type: "HardBounce", Email: "Jo@X.example", From: "Test CPAs <" + INBOX + ">" });
    T = await H.state(); assert.equal(T.S.clients[0].emailOk, false); assert.ok(T.S.alerts.some((a: { kind: string }) => a.kind === "email_bounced"));
    assert.equal((await H.twilioPost("/hooks/twilio/status", { MessageSid: out.providerId, MessageStatus: "delivered", From: FIRM_NO, To: JO })).statusCode, 204); assert.ok(!(await H.state()).S.msgs.find((m: { id: string }) => m.id === out.id).failed);
    await H.twilioPost("/hooks/twilio/status", { MessageSid: out.providerId, MessageStatus: "undelivered", ErrorCode: "30003", From: FIRM_NO, To: JO });
    T = await H.state(); const m = T.S.msgs.find((x: { id: string }) => x.id === out.id); assert.equal(m.status, "failed"); assert.match(m.failed, /30003/); assert.ok(T.S.alerts.some((a: { kind: string }) => a.kind === "send_failed"));
    await H.close();
  });

  test(name("T-90 and T-11: staff add a document by hand; it is checked, the client is not messaged, and only that firm's staff can open it"), async () => {
    const H = await firmWithJo(kind); await H.newFirm(2); const a = await H.signInAs("pat1@firm1.test"), b = await H.signInAs("pat2@firm2.test"), sent = H.sms.sent.length + H.email.sent.length;
    await a.post("/api/users", { name: "Sam Reader", email: "sam@firm1.test", role: "read_only" }); const reader = await H.signInAs("sam@firm1.test");
    const cid = (await H.state()).S.clients[0].id, up = (who: typeof a, bytes: Buffer, type = "image/jpeg") => H.server.inject({ method: "POST", url: "/api/clients/" + cid + "/documents", payload: bytes, headers: { "content-type": type, "x-tallyhound": "1", cookie: who.cookie() } });
    assert.equal((await up(reader, JPEG)).statusCode, 403); assert.equal((await up(b, JPEG)).statusCode, 400, "another firm has no such client");
    const r = await up(a, JPEG); assert.equal(r.statusCode, 200); assert.deepEqual(r.json().docs, ["accepted"]);
    assert.equal((await up(a, Buffer.concat([Buffer.from("MZ"), Buffer.alloc(200)]))).statusCode, 400);
    const T = await H.state(), d = docs(T)[0]; assert.equal(H.sms.sent.length + H.email.sent.length, sent, "the client hears nothing");
    const mine = await H.server.inject({ method: "GET", url: "/api/documents/" + d.id + "/file", headers: { cookie: a.cookie() } }); assert.equal(mine.statusCode, 200); assert.equal(mine.headers["content-type"], "image/jpeg"); assert.ok(mine.rawPayload.equals(JPEG));
    assert.equal((await H.server.inject({ method: "GET", url: "/api/documents/" + d.id + "/file", headers: { cookie: reader.cookie() } })).statusCode, 200, "read-only can look");
    assert.equal((await H.server.inject({ method: "GET", url: "/api/documents/" + d.id + "/file", headers: { cookie: b.cookie() } })).statusCode, 404, "another firm's staff cannot open it");
    assert.equal((await H.server.inject({ method: "GET", url: "/api/documents/" + d.id + "/file" })).statusCode, 401);
    assert.ok((await H.state()).S.audit.some((x: { action: string }) => x.action === "doc.view"), "every view is in the firm's audit trail");
    await H.close();
  });

  test(name("T-122: a call to the text number rings the firm's office"), async () => {
    const H = await firmWithJo(kind), r = await H.twilioPost("/hooks/twilio/voice", { To: FIRM_NO, From: JO, CallSid: "CA1" });
    assert.equal(r.statusCode, 200); assert.match(r.body, /<Dial>\+16155550100<\/Dial>/);
    assert.match((await H.twilioPost("/hooks/twilio/voice", { To: "+16155559999", From: JO, CallSid: "CA2" })).body, /only receives text messages/);
    await H.close();
  });
}
