// Tallyhound v2 (docs/V2.md): email-first on a white-labelled mail layer. The acceptance scenarios of the v2 spec, section 11,
// run end to end against the stand-in layer: sign-in at Google, letters from the preparer's own mailbox, the upload link, replies
// through the webhook, an outage, drift, disconnecting, and the scan that the layer's name appears nowhere a firm or client can see.
import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { build, KINDS, pdfPagesWith } from "./harness.ts";
import { createEngine, kitMemory, type Engine } from "../src/kit.ts";
import { checkNames, guarded, LayerError } from "../src/maillayer.ts";
import { SCOPES } from "../src/mailbox.ts";
import { fakeLayer } from "../src/integrations/neeter/fake.ts";
import { neeter } from "../src/integrations/neeter/index.ts";

/* eslint-disable @typescript-eslint/no-explicit-any */
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const json = (j: unknown, status = 200) => new Response(JSON.stringify(j), { status, headers: { "content-type": "application/json" } });
const words = (s: string) => s.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
const W2 = { is_tax_document: true, form: "W2", tax_year: 2026, payer: "Acme Logistics", recipient_name: "MARIA GARCIA", legibility: 0.95, confidence: 0.97, missing_parts: [], note: "A W-2" };

// Maple & Pine: an owner (Pat) with a connected Google mailbox, one client (Maria) owing a W-2 and a mortgage statement.
async function firm(kind: "memory" | "postgres", o: { connect?: boolean; confirmAll?: boolean; mode?: string; clients?: number } = {}) {
  const revoked: string[] = [], reading: { doc: Record<string, unknown>; text: Record<string, unknown> | null } = { doc: W2, text: null };
  const mailFetch = (async (url: string | URL, init?: RequestInit) => {
    const u = String(url), body = String((init && init.body) || "");
    if (u === "https://oauth2.googleapis.com/token") return body.includes("code=good-code") ? json({ access_token: "at-1", refresh_token: "rt-very-secret", scope: SCOPES.google.join(" ") }) : json({ error: "invalid_grant" }, 400);
    if (u.startsWith("https://openidconnect.googleapis.com/")) return json({ email: "Pat@MapleAndPine.example", email_verified: true });
    if (u === "https://oauth2.googleapis.com/revoke") { revoked.push(body); return json({}); }
    return json({}, 404);
  }) as unknown as typeof fetch;
  const ai = kitMemory.fakeAI((p: string) => (p.startsWith("You read photos") ? reading.doc : p.startsWith("You read text messages") ? reading.text : null));
  const H = await build(kind, { layer: true, mailFetch, ai }), { firmId, ownerId } = await H.newFirm(), owner = await H.signInAs("pat1@firm1.test");
  const state = async (): Promise<Engine> => { const T = createEngine(); T.load(await H.store.readState(firmId)); return T; };
  const connect = async () => { const go = await owner.get("/api/mailbox/google/start"), st = new URL(String(go.headers.location)).searchParams.get("state")!; return owner.get("/api/mailbox/google/callback?code=good-code&state=" + encodeURIComponent(st)); };
  if (o.connect !== false) assert.equal((await connect()).headers.location, "/settings?tab=mailbox&connected=1");
  const n = o.clients || 1;
  await H.app.staff(firmId, ownerId, (T: Engine) => {
    T.S.firm.hound.mode = o.mode || "autopilot"; T.S.firm.confirmAll = o.confirmAll === true;
    T.importRows(T.parseCSV("First,Last,Email\n" + (n === 1 ? "Maria,Garcia,maria@x.example" : Array.from({ length: n }, (_, i) => "C" + i + ",Client,c" + i + "@x.example").join("\n"))));
    if (n === 1) { const e = T.S.engs[0]; T.itemsOf(e.id).find((i: any) => i.form === "W2").payer = "Acme Logistics"; T.itemsOf(e.id).find((i: any) => i.form === "1098").payer = "Hillcrest Mortgage"; }
    T.S.engs.forEach((e: any) => { e.confirmed = true; });
  });
  const goFetch = async () => { await H.app.staff(firmId, ownerId, (T: Engine) => T.startMany(T.S.engs.map((e: any) => e.id))); await H.worker.pass(); };
  const days = async (d: number) => { for (let i = 0; i < d * 4; i++) { H.advance(6 * 3600); await H.worker.pass(); } };
  const upload = (url: string, files: [string, string, Buffer][]) => { const b = "----th" + Math.random().toString(36).slice(2), parts = files.map(([name, type, bytes]) => Buffer.concat([Buffer.from("--" + b + '\r\nContent-Disposition: form-data; name="file"; filename="' + name + '"\r\nContent-Type: ' + type + "\r\n\r\n"), bytes, Buffer.from("\r\n")]));
    return H.server.inject({ method: "POST", url, payload: Buffer.concat([...parts, Buffer.from("--" + b + "--\r\n")]), headers: { "content-type": "multipart/form-data; boundary=" + b } }); };
  const linkOf = async () => { const T = await state(); return "/u/" + T.S.firm.slug + "-" + T.S.engs[0].link.key; };
  return { H, firmId, ownerId, owner, state, connect, revoked, reading, goFetch, days, upload, linkOf };
}
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(4000, 7)]);

for (const kind of KINDS) {
  const name = (s: string) => "v2 (" + kind + "): " + s;

  test(name("scenario 1: one consent screen at Google naming the narrowest permissions; the assistant is ready at once; nothing secret reaches the browser"), async () => {
    const x = await firm(kind, { connect: false }), { H, owner } = x;
    assert.deepEqual((await owner.get("/api/mailbox")).json, { layer: true, offered: ["google", "microsoft"], mine: null, all: [] });
    const go = await owner.get("/api/mailbox/google/start"); assert.equal(go.status, 303); const to = new URL(String(go.headers.location));
    assert.equal(to.host, "accounts.google.com"); assert.equal(to.searchParams.get("scope"), "openid email https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/gmail.readonly"); assert.match(to.searchParams.get("redirect_uri")!, /\/api\/mailbox\/google\/callback$/);
    const st = to.searchParams.get("state")!;
    for (const [q, why] of [["code=good-code&state=made.up", "state"], ["error=access_denied&state=" + st, "declined"], ["code=bad-code&state=" + st, "token"]]) assert.equal((await owner.get("/api/mailbox/google/callback?" + q)).headers.location, "/settings?tab=mailbox&problem=" + why);
    assert.equal(H.layer.assistants.size, 0);
    assert.equal((await owner.get("/api/mailbox/google/callback?code=good-code&state=" + encodeURIComponent(st))).headers.location, "/settings?tab=mailbox&connected=1");
    assert.equal(H.layer.assistants.size, 1); const as = [...H.layer.assistants.values()][0]!; assert.equal(as.address, "pat@mapleandpine.example"); assert.deepEqual(as.scopes, SCOPES.google);
    const mine = (await owner.get("/api/mailbox")).json.mine; assert.equal(mine.address, "pat@mapleandpine.example"); assert.equal(mine.status, "active"); assert.deepEqual(Object.keys(mine).sort(), ["address", "connectedAt", "provider", "status", "userId"]);
    const T = await x.state(); assert.equal(T.S.users[0].mailbox.status, "active"); const all = JSON.stringify((await owner.get("/api/state")).json) + (await owner.get("/api/mailbox")).raw.body; assert.ok(!all.includes("rt-very-secret") && !/as\d+"/.test(all), "the token or the assistant's id reached the browser");
    assert.ok(!(await H.store.readState(x.firmId))!.includes("rt-very-secret")); await H.close();
  });

  test(name("scenarios 2, 3, 4: the letter leaves the preparer's own mailbox with every document and the link; an upload is sniffed, the page says what was found, and the layer's task follows"), async () => {
    const x = await firm(kind), { H } = x; await x.goFetch();
    assert.equal(H.layer.letters.length, 1); const L = H.layer.letters[0]!; assert.equal(L.to, "maria@x.example"); assert.equal(L.subject, "2 documents for your 2026 tax return"); assert.equal(H.layer.assistants.get(L.assistantId)!.address, "pat@mapleandpine.example");
    assert.match(L.body, /^Hi Maria,\n\nTo prepare your 2026 return we still need:\n\n {2}- W-2 from Acme Logistics\n {2}- 1098 from Hillcrest Mortgage\n\nUpload them here\. No account or password needed:\nhttps:\/\/go\.tallyhound\.test\/u\/[a-z]+-[a-z]{28}\n/); assert.match(L.body, /Thank you,\nPat Owner\nTest CPAs 1\n\nYou're getting this because Test CPAs 1 prepares your taxes\. To stop these emails: https:\/\//);
    assert.equal(H.email.sent.filter((m: any) => m.to === "maria@x.example").length, 0, "a client letter went through Tallyhound's own mail service"); assert.equal(H.sms.sent.length, 0);
    // The mirror: one project named for the client and the year, one task per document, all open.
    assert.deepEqual([...H.layer.projects.values()].map((p) => [p.name, p.email, p.closed]), [["Garcia, Maria 2026", "maria@x.example", false]]); assert.deepEqual([...H.layer.tasks.values()].map((t) => [t.title, t.status]).sort(), [["1098 from Hillcrest Mortgage", "Open"], ["W-2 from Acme Logistics", "Open"]]);
    // The upload page: the firm, the first name and the two documents, and nothing else about the client.
    const u = await x.linkOf(), page = await H.server.inject({ method: "GET", url: u }); assert.equal(page.statusCode, 200); const t = words(page.body);
    assert.match(t, /Hi Maria .*Test CPAs 1 still needs W-2 from Acme Logistics .*1098 from Hillcrest Mortgage/); assert.ok(!/maria@|Garcia|pat@|@x\.example/.test(page.body), "the page shows more than a first name"); assert.equal(page.headers["set-cookie"], undefined);
    assert.equal((page.body.match(/Take photo/g) || []).length, 2); assert.match(page.body, /I don't have this one|I don&#x27;t have this one/);
    // A clean W-2: stored, sniffed, and the page says so.
    const up = await x.upload(u, [["w2.jpg", "image/jpeg", JPEG]]); assert.equal(up.statusCode, 303); const loc = String(up.headers.location); assert.match(loc, /\?up=[0-9a-f]{24}$/);
    await H.inbox.drain(); await H.worker.pass(); const res = await H.server.inject({ method: "GET", url: loc }); assert.match(words(res.body), /What you just sent Got it: W-2 from Acme Logistics\./); assert.ok(!/W-2 from Acme Logistics Take photo/.test(words(res.body)), "a document that passed is still asked for");
    assert.deepEqual((await H.server.inject({ method: "GET", url: u + "/result?up=" + loc.split("up=")[1] })).json(), { done: true, lines: [{ ok: true, text: "Got it: W-2 from Acme Logistics." }] });
    assert.deepEqual([...H.layer.tasks.values()].map((t) => [t.title, t.status]).sort(), [["1098 from Hillcrest Mortgage", "Open"], ["W-2 from Acme Logistics", "Done"]]);
    // Last year's mortgage statement: the fix sentence, not counted, still open in the layer.
    x.reading.doc = { ...W2, form: "1098", payer: "Hillcrest Mortgage", tax_year: 2025 }; const up2 = await x.upload(u, [["m.jpg", "image/jpeg", Buffer.concat([JPEG, Buffer.from("2")])]]); await H.inbox.drain(); await H.worker.pass();
    assert.match(words((await H.server.inject({ method: "GET", url: String(up2.headers.location) })).body), /That one is for 2025\. We need the 2026 version\./);
    // The next letter lists one document, says what was wrong, and is a reply on the same thread.
    await x.days(4); assert.equal(H.layer.letters.length, 2); const L2 = H.layer.letters[1]!; assert.equal(L2.subject, "1 document for your 2026 tax return"); assert.ok(!/W-2/.test(L2.body)); assert.match(L2.body, /1098 from Hillcrest Mortgage \(the copy you sent was for 2025\)/); assert.equal(L2.thread, L.thread);
    await H.close();
  });

  test(name("scenarios 5 to 9: replies arrive signed from the layer and follow the reply table; a forged, stale or repeated call does nothing"), async () => {
    const x = await firm(kind), { H } = x; await x.goFetch(); const T0 = await x.state(), as = [...H.layer.assistants.keys()][0]!, eid = T0.S.engs[0].id;
    const reply = (id: string, text: string, more: Record<string, unknown> = {}) => H.layerPost({ id, type: "reply", assistant_id: as, from: "Maria Garcia <maria@x.example>", text, ...more });
    const open = async (kind2: string) => (await x.state()).S.tasks.filter((t: any) => t.status === "open" && t.engId === eid && t.kind === kind2);
    // Who is calling is checked before anything is read.
    assert.equal((await H.layerPost({ id: "r0", type: "reply", assistant_id: as, from: "maria@x.example", text: "hello" }, "wrong-secret")).statusCode, 401);
    assert.equal((await H.layerPost({ id: "r0", type: "reply", assistant_id: as, from: "maria@x.example", text: "hello" }, undefined, new Date(Date.now() - 20 * 60000))).statusCode, 401);
    assert.equal((await H.layerPost({ id: "r0", type: "reply", assistant_id: "as-nobody", from: "maria@x.example", text: "hello" })).statusCode, 202);
    assert.equal((await reply("r-stranger", "I am not a client", { from: "stranger@elsewhere.example" })).statusCode, 200); assert.equal((await x.state()).S.msgs.filter((m: any) => m.dir === "in").length, 0, "a sender who is not on the client list was read");
    // 8: a tax question. Passed on, and the reply gives no advice.
    const n0 = H.layer.letters.length; assert.equal((await reply("r1", "can I deduct my home office?\n\nOn Mon, Jan 25, 2027 Pat Owner wrote:\n> Hi Maria,\n> we still need")).statusCode, 200); await H.worker.pass();
    assert.equal((await open("question")).length, 1); const ack = H.layer.letters[n0]!; assert.match(ack.body, /^Good question\. I've passed it to Pat/); assert.ok(!/deduct|you can|you should/i.test(ack.body)); assert.ok(!(await x.state()).S.msgs.some((m: any) => m.dir === "in" && /wrote:|> Hi/.test(m.body)), "the quoted letter was kept as the client's words");
    // The same call delivered again changes nothing.
    await reply("r1", "can I deduct my home office?"); await H.worker.pass(); assert.equal((await open("question")).length, 1); assert.equal(H.layer.letters.length, n0 + 1);
    // 7: "after the 15th". A suggested step; nothing changes until the click.
    x.reading.text = { intent: "send_after_date", confidence: "high", legacy_intent: "will_send_later", date: "2027-02-15", item_id: T0.itemsOf(eid).find((i: any) => i.form === "W2").id };
    await reply("r2", "Can I send the W-2 after the 15th?"); let T = await x.state(); const st = T.S.tasks.find((t: any) => t.kind === "step" && t.status === "open"); assert.ok(st); assert.equal(T.holdOf(T.itemsOf(eid).find((i: any) => i.form === "W2"), T.eng(eid)), null);
    assert.equal((await x.owner.post("/api/act", { fn: "decideTask", args: [st.id, "apply_step", null] })).status, 200); await H.worker.pass(); T = await x.state(); assert.equal(T.holdOf(T.itemsOf(eid).find((i: any) => i.form === "W2"), T.eng(eid)).reason, "client_date");
    assert.equal([...H.layer.tasks.values()].find((t) => /W-2/.test(t.title))!.status, "On hold");
    // 5: "sent it", nothing arrived. The link once; the layer's own reading is used when ours has none.
    x.reading.text = null; const n1 = H.layer.letters.length; await reply("r3", "all done on my side", { proposed_status: "Completed" }); await H.worker.pass(); assert.equal(H.layer.letters.length, n1 + 1); assert.match(H.layer.letters[n1]!.body, /Could you upload it here\? https:\/\//);
    await reply("r4", "all done on my side", { proposed_status: "Completed" }); await H.worker.pass(); assert.equal(H.layer.letters.length, n1 + 1, "the link was sent a second time"); assert.equal((await open("question")).length, 2);
    // 6: a PDF attached to the reply is imported, sniffed and counted; with no bytes handed over, a person is asked to forward it.
    x.reading.doc = { ...W2, form: "1098", payer: "Hillcrest Mortgage" }; const pdf = pdfPagesWith([["Form 1098 Mortgage Interest Statement 2026"]]);
    await reply("r5", "here it is", { attachment_count: 1, attachments: [{ name: "1098.pdf", content_type: "application/pdf", content_base64: pdf.toString("base64") }] }); await H.worker.pass();
    T = await x.state(); const d = T.S.docs.find((q: any) => q.form === "1098"); assert.equal(d.state, "accepted"); assert.equal(d.intake, "email_attachment"); assert.equal(T.itemsOf(eid).find((i: any) => i.form === "1098").state, "received");
    assert.match(H.layer.letters.at(-1)!.body, /We received your mortgage interest statement from Hillcrest Mortgage\. Next time, this page is the quickest way to send a document: https:\/\//);
    await reply("r6", "see attached", { attachment_count: 2 }); T = await x.state(); assert.ok(T.S.tasks.some((t: any) => t.status === "open" && t.reason === "Emailed an attachment" && /Forward that email to test1@docs\.tallyhound\.test/.test(t.summary)));
    // 9: unsubscribe by reply. No more letters, and a can't-reach item.
    await reply("r7", "Please unsubscribe me"); await H.worker.pass(); T = await x.state(); assert.equal(T.S.clients[0].emailOff, true); assert.equal((await open("cant_reach")).length, 1); const n2 = H.layer.letters.length; await x.days(20); assert.equal(H.layer.letters.length, n2);
    // A bounce does the same (TH-EML-8).
    const y = await firm(kind); await y.goFetch(); await y.H.layerPost({ id: "b1", type: "bounce", assistant_id: [...y.H.layer.assistants.keys()][0]!, to: "maria@x.example" }); const Ty = await y.state(); assert.equal(Ty.S.clients[0].emailOk, false); assert.ok(Ty.S.tasks.some((t: any) => t.kind === "cant_reach" && t.status === "open"));
    await H.close(); await y.H.close();
  });

  test(name("scenarios 11 and 12: an hour's outage loses nothing and sends nothing twice; the layer's list changed by hand is put back overnight and each change is in the audit trail"), async () => {
    const x = await firm(kind), { H } = x; H.layer.down = true; await x.goFetch();
    assert.equal(H.layer.letters.length, 0); let T = await x.state(); const m = T.S.msgs.find((q: any) => q.tpl === "L1"); assert.equal(m.status, "delivered"); assert.ok(!m.failed && !m.sentAt && m.retryAt, "the letter was dropped or marked failed"); assert.ok(T.S.engs[0].mirror.err.n >= 1);
    for (let i = 0; i < 6; i++) { H.advance(600); await H.worker.pass(); } assert.equal(H.layer.letters.length, 0);
    H.layer.down = false; for (let i = 0; i < 8; i++) { H.advance(900); await H.worker.pass(); }
    assert.equal(H.layer.letters.length, 1, "after the outage the letter went once"); T = await x.state(); assert.ok(T.S.msgs.find((q: any) => q.tpl === "L1").sentAt); assert.equal(T.S.engs[0].mirror.err, undefined); assert.equal(H.layer.projects.size, 1); assert.equal(H.layer.tasks.size, 2);
    assert.ok(!T.S.alerts.some((a: any) => a.kind === "send_failed" || a.kind === "send_unconfirmed"));
    // Replaying every write changes nothing (TH-NTR-3).
    const calls = H.layer.calls; await H.worker.pass(); await H.worker.pass(); assert.equal(H.layer.letters.length, 1); assert.equal(H.layer.tasks.size, 2); assert.ok(H.layer.calls - calls <= 0, "a pass with nothing changed still wrote to the layer");
    // 12: someone marks the W-2 done in the layer's own list. Tallyhound says it is still owed, and wins.
    const tid = [...H.layer.tasks].find(([, t]) => /W-2/.test(t.title))![0]; H.layer.tamper(tid, "Done"); const r = await H.app.reconcile(x.firmId); assert.equal(r.checked, 1); assert.deepEqual(r.drift.map((d2) => d2.what), ["task"]);
    assert.equal(H.layer.tasks.get(tid)!.status, "Open", "the layer was not repaired"); assert.deepEqual((await H.app.reconcile(x.firmId)).drift, [], "the next night's report is not empty");
    T = await x.state(); const rows = T.S.audit.map((a: any) => a.action); assert.ok(rows.includes("mirror.repaired")); assert.ok(rows.filter((a: string) => a === "mirror.status").length >= 3, "the layer's status changes are not in the audit trail");
    await H.close();
  });

  test(name("scenarios 14 and 15: disconnecting stops letters and reading at once and gives the permission up; a firm-wide stop during a 500-client start lets no letter leave after the click"), async () => {
    const x = await firm(kind), { H, owner } = x; await x.goFetch(); assert.equal(H.layer.letters.length, 1); const as = [...H.layer.assistants.keys()][0]!;
    assert.deepEqual((await owner.post("/api/mailbox/disconnect", {})).json, { ok: true, disconnected: true });
    assert.equal(H.layer.assistants.size, 0); assert.equal(x.revoked.length, 1); assert.match(x.revoked[0]!, /token=rt-very-secret/); assert.equal((await owner.get("/api/mailbox")).json.mine, null);
    // A staff member cannot disconnect someone else's mailbox.
    await owner.post("/api/users", { name: "Alex Staff", email: "alex@firm1.test", role: "staff" }); const alex = await H.signInAs("alex@firm1.test"); assert.equal((await alex.post("/api/mailbox/disconnect", { userId: x.ownerId })).status, 403);
    await x.days(12); assert.equal(H.layer.letters.length, 1, "a letter left after the mailbox was disconnected"); const T = await x.state(); assert.equal(T.S.users[0].mailbox.status, "revoked"); assert.ok(T.S.alerts.some((a: any) => a.kind === "mailbox"));
    assert.equal((await H.layerPost({ id: "late", type: "reply", assistant_id: as, from: "maria@x.example", text: "hello" })).statusCode, 202); assert.equal((await x.state()).S.msgs.filter((q: any) => q.dir === "in").length, 0, "a reply was read after disconnecting");
    await H.close();
    // 15: 500 clients, a daily limit of 100 for the test, and the owner presses stop after the first day's letters.
    const y = await firm(kind, { clients: 500 }); await y.H.app.staff(y.firmId, y.ownerId, (E: Engine) => E.setMailCap(100)); await y.goFetch(); for (let i = 0; i < 8; i++) { y.H.advance(1800); await y.H.worker.pass(); }
    assert.equal(y.H.layer.letters.length, 100, "the daily limit was not kept"); assert.equal((await (await y.H.signInAs("pat1@firm1.test")).post("/api/act", { fn: "stopAll", args: [] })).status, 200);
    await y.days(5); assert.equal(y.H.layer.letters.length, 100, "a letter left after the firm-wide stop"); assert.ok([...y.H.layer.tasks.values()].every((t) => t.status === "On hold"), "the layer still has tasks it may follow up on");
    assert.equal((await (await y.H.signInAs("pat1@firm1.test")).post("/api/act", { fn: "resumeAll", args: [] })).status, 200); await y.days(2); assert.ok(y.H.layer.letters.length > 100 && y.H.layer.letters.length <= 300); await y.H.close();
  });
}

test("v2 scenario 13: the mail layer's name is in no email, on no page and in nothing a browser is sent; only the adapter and the place the service is put together know it", async () => {
  const x = await firm("memory"), { H, owner } = x; await x.goFetch(); const u = await x.linkOf();
  const seen: string[] = [];
  for (const L of H.layer.letters) seen.push(JSON.stringify(L)); for (const m of H.email.sent) seen.push(JSON.stringify(m)); for (const m of H.staffMails) seen.push(JSON.stringify(m)); for (const l of H.links) seen.push(JSON.stringify(l));
  for (const url of [u, u + "?up=" + "0".repeat(24), "/u/nobody-" + "a".repeat(28), "/f/" + (await x.state()).S.firm.slug, "/client.js", "/client.css"]) seen.push((await H.server.inject({ method: "GET", url })).body);
  for (const api of ["/api/state", "/api/features", "/api/mailbox", "/api/me", "/api/users"]) seen.push((await owner.get(api)).raw.body);
  for (const s of seen) assert.ok(!/neeter/i.test(s), "the layer is named in: " + s.slice(0, 160));
  // Everything the staff app is built from, and the built app when there is one.
  const walk = (dir: string): string[] => readdirSync(dir).flatMap((n) => { const p = join(dir, n); return statSync(p).isDirectory() ? (n === "node_modules" ? [] : walk(p)) : [p]; });
  const shown = walk(join(ROOT, "apps/web/src")).concat(walk(join(ROOT, "apps/server/assets")), [join(ROOT, "apps/server/src/clientpages.ts"), join(ROOT, "apps/server/src/notify.ts"), join(ROOT, "packages/engine/engine.js")]);
  try { shown.push(...walk(join(ROOT, "apps/web/dist"))); } catch { /* not built */ }
  for (const p of shown) if (/\.(tsx?|jsx?|css|html|json|svg)$/.test(p)) assert.ok(!/neeter/i.test(readFileSync(p, "utf8")), "the layer is named in " + p);
  // TH-NTR-1, TH-WLB-4: only the place the service is assembled imports the adapter.
  const src = walk(join(ROOT, "apps/server/src")).concat(walk(join(ROOT, "packages"))).filter((p) => /\.(ts|js)$/.test(p) && !p.includes("integrations/neeter"));
  for (const p of src) { const t = readFileSync(p, "utf8"); if (/from "[^"]*integrations\/neeter/.test(t)) assert.ok(p.endsWith("apps/server/src/runtime.ts"), p + " imports the adapter"); }
  await H.close();
});

test("TH-NTR-6: only names leave. A project or task that carries an amount or an identifier is refused before any request is made", async () => {
  for (const bad of [{ title: "W-2 from Acme, $52,000.00" }, { title: "W-2 123-45-6789" }, { note: "account 4455667788" }, { name: "Garcia 12-3456789" }, { title: 42 }, { title: "x".repeat(201) }]) assert.throws(() => checkNames(bad), (e: unknown) => e instanceof LayerError && e.code === "schema", JSON.stringify(bad));
  checkNames({ title: "1099-INT from First Farmers Bank", note: "Held until March 15", name: "Garcia, Maria 2026", email: "maria@x.example", due: "2027-01-27" });
  const L = fakeLayer(), G = guarded(L), a = (await G.provision({ firmId: "f", userId: "u", provider: "google", address: "a@b.example", refreshToken: "t", scopes: [] })).assistantId, p = await G.upsertProject({ firmId: "f", assistantId: a, key: "e1:1", name: "Garcia, Maria 2026", email: "maria@x.example", closed: false, due: null });
  await assert.rejects(G.upsertTask({ firmId: "f", assistantId: a, key: "i1:1", projectId: p.id, title: "W-2, box 1 $48,210", status: "Open", note: "" }), /amount or an identifier/); assert.equal(L.tasks.size, 0);
  // And the engine never offers one: a payer that looks like an account number is cut from the title before it gets this far.
  const T = createEngine(); T.blank({ letters: true, mail: "mailbox", plan: "Practice", name: "F", email: "f@f.example" }); T.importRows(T.parseCSV("First,Last,Email\nMaria,Garcia,maria@x.example")); const e = T.S.engs[0]; T.itemsOf(e.id)[0].payer = "Acme 123-45-6789 acct 9988776655 $1,200.50";
  T.setMailbox("u1", { provider: "google", address: "o@f.example" }); e.confirmed = true; T.start(e.id); for (const t of T.mirrorWant(e.id).tasks) { checkNames({ title: t.title, note: t.note }); assert.ok(!/\d{5,}|\$/.test(t.title), t.title); }
});

test("TH-NTR-9: each firm's layer key is made once, used on every call, replaced after 90 days, and a failing layer reads as unreachable", async () => {
  const calls: { url: string; auth: string; idem: string | null; body: any }[] = [], keys = new Map<string, { key: string; issuedAt: Date }>(); let now = new Date("2027-01-25T12:00:00Z"), status = 200, minted = 0;
  const f = (async (url: string | URL, init?: RequestInit) => { const h = (init!.headers || {}) as Record<string, string>; calls.push({ url: String(url), auth: h.authorization!, idem: h["idempotency-key"] || null, body: init!.body ? JSON.parse(String(init!.body)) : null });
    if (status !== 200) return json({}, status); if (String(url).endsWith("/v1/keys")) return json({ key: "firm-key-" + ++minted }); return json({ id: "r" + calls.length, thread_id: "th1" }); }) as unknown as typeof fetch;
  const N = neeter({ baseUrl: "https://layer.example/", partnerKey: "partner-key", keys: { async get(id) { return keys.get(id) || null; }, async put(id, key, issuedAt) { keys.set(id, { key, issuedAt }); } }, clock: () => now, fetch: f });
  const a = await N.provision({ firmId: "f1", userId: "u1", provider: "google", address: "pat@firm.example", refreshToken: "rt", scopes: ["s"] }); assert.equal(calls[0]!.auth, "Bearer partner-key"); assert.equal(calls[1]!.auth, "Bearer firm-key-1"); assert.equal(calls[1]!.body.white_label, true);
  await N.sendLetter({ firmId: "f1", assistantId: a.assistantId, key: "m7", projectId: "p1", to: "maria@x.example", subject: "s", body: "b" }); assert.equal(calls.at(-1)!.idem, "m7"); assert.equal(calls.at(-1)!.body.add_signature, false); assert.equal(calls.at(-1)!.body.send_now, true); assert.equal(minted, 1);
  now = new Date(+now + 91 * 86400000); await N.upsertProject({ firmId: "f1", assistantId: a.assistantId, key: "e1:abc", name: "Garcia, Maria 2026", email: "maria@x.example", closed: false, due: null }); assert.equal(minted, 2); assert.equal(calls.at(-1)!.auth, "Bearer firm-key-2"); assert.equal(await N.keyAge("f1"), 0);
  for (const s of [500, 503, 429]) { status = s; await assert.rejects(N.getProject({ firmId: "f1", assistantId: a.assistantId, projectId: "p1" }), (e: unknown) => e instanceof LayerError && e.code === "unreachable"); }
  status = 400; await assert.rejects(N.upsertTask({ firmId: "f1", assistantId: a.assistantId, key: "i:1", projectId: "p1", title: "W-2", status: "Open", note: "" }), (e: unknown) => e instanceof LayerError && e.code === "refused");
});

// With no mail layer set up, an email-first firm's letters go from its Tallyhound address through Tallyhound's own mail service,
// and replies come back to that address. Nothing else about the product changes (docs/V2.md, "Running without the layer").
for (const kind of KINDS) test("v2 (" + kind + "): without the mail layer the same letter goes from the firm's Tallyhound address; a reply, a switched-off link, the hourly limit and a staff upload all behave", async () => {
  const reading: { text: Record<string, unknown> | null } = { text: null };
  const ai = kitMemory.fakeAI((p: string) => (p.startsWith("You read photos") ? W2 : p.startsWith("You read text messages") ? reading.text : null));
  const H = await build(kind, { letters: true, ai }), { firmId, ownerId } = await H.newFirm(), owner = await H.signInAs("pat1@firm1.test");
  const state = async (): Promise<Engine> => { const T = createEngine(); T.load(await H.store.readState(firmId)); return T; };
  assert.deepEqual((await owner.get("/api/mailbox")).json, { layer: false, offered: [], mine: null, all: [] }); assert.equal((await owner.get("/api/mailbox/google/start")).headers.location, "/settings?tab=mailbox&problem=unavailable");
  assert.equal((await H.layerPost({ id: "x", type: "reply", assistant_id: "a", from: "maria@x.example", text: "hi" })).statusCode, 404, "the layer's webhook exists with no layer set up");
  await H.app.staff(firmId, ownerId, (T: Engine) => { assert.equal(T.S.firm.letters, true); assert.equal(T.S.firm.mail, "own"); T.S.firm.hound.mode = "autopilot"; T.S.firm.confirmAll = false; T.importRows(T.parseCSV("First,Last,Email,Mobile\nMaria,Garcia,maria@x.example,6155550111")); const e = T.S.engs[0]; T.itemsOf(e.id).find((i: any) => i.form === "W2").payer = "Acme Logistics"; e.confirmed = true; T.start(e.id); });
  await H.worker.pass(); assert.equal(H.sms.sent.length, 0, "an email-first firm sent a text"); assert.equal(H.email.sent.length, 1); const L = H.email.sent[0] as any;
  assert.equal(L.to, "maria@x.example"); assert.equal(L.from, "test1@docs.tallyhound.test"); assert.equal(L.replyTo, "test1@docs.tallyhound.test"); assert.equal(L.subject, "2 documents for your 2026 tax return"); assert.match(L.body, /- W-2 from Acme Logistics\n {2}- 1098 from your mortgage lender\n\nUpload them here/); assert.match(String(L.unsubscribe), /^https:\/\/go\.tallyhound\.test\/e\//);
  assert.equal(H.layer.calls, 0, "the mail layer was called for a firm that does not use it");
  // A reply to that address is read like any reply.
  await H.postmarkPost("/hooks/postmark/inbound", { MessageID: "pm1", OriginalRecipient: "test1@docs.tallyhound.test", From: "Maria Garcia <maria@x.example>", Subject: "Re: 2 documents", TextBody: "can I deduct my home office?", Headers: [{ Name: "Authentication-Results", Value: "mx; dmarc=pass" }], Attachments: [] });
  await H.inbox.drain(); await H.worker.pass(); let T = await state(); assert.equal(T.S.tasks.filter((t: any) => t.kind === "question" && t.status === "open").length, 1); assert.match((H.email.sent.at(-1) as any).body, /^Good question\. I've passed it to Pat/); assert.equal(T.S.msgs.find((m: any) => m.dir === "in").channel, "email");
  // The upload link: live, then switched off by staff, then replaced.
  const u = () => "/u/" + T.S.firm.slug + "-" + T.S.engs[0].link.key, get = (url: string) => H.server.inject({ method: "GET", url }), old = u();
  assert.equal((await get(old)).statusCode, 200); assert.equal((await owner.post("/api/act", { fn: "revokeLink", args: [T.S.engs[0].id] })).status, 200);
  const off = await get(old); assert.equal(off.statusCode, 404); assert.match(words(off.body), /This link no longer works Ask your accountant for a new link/); assert.ok(!/Maria|W-2/.test(off.body), "a dead link says whose it was");
  assert.equal((await owner.post("/api/act", { fn: "rotateLink", args: [T.S.engs[0].id] })).status, 200); T = await state(); assert.notEqual(u(), old); assert.equal((await get(u())).statusCode, 200); assert.equal((await get(old)).statusCode, 404);
  const st = (await owner.get("/api/state")).raw.body; assert.ok(!st.includes(T.S.engs[0].link.key) && !st.includes(old.slice(-28)), "an upload link reached a browser");
  // "I don't have this one" from the page pauses that document and asks a person; "later" is a suggested step.
  const form = (body: Record<string, string>) => H.server.inject({ method: "POST", url: u(), payload: new URLSearchParams(body).toString(), headers: { "content-type": "application/x-www-form-urlencoded" } }), iid = (f: string) => T.itemsOf(T.S.engs[0].id).find((i: any) => i.form === f).id;
  assert.equal((await form({ form: "none", item: iid("1098") })).headers.location, u() + "?said=none"); assert.equal((await form({ form: "later", item: iid("W2"), day: "2027-02-10" })).headers.location, u() + "?said=later"); assert.equal((await form({ form: "none", item: "i-nobody" })).headers.location, u());
  T = await state(); assert.equal(T.itemsOf(T.S.engs[0].id).find((i: any) => i.form === "1098").state, "says_none"); assert.ok(T.S.tasks.some((t: any) => t.kind === "says_none" && t.status === "open")); const step = T.S.tasks.find((t: any) => t.kind === "step" && t.status === "open"); assert.equal(step.step.type, "hold"); assert.equal(new Date(step.step.until).getDate(), 10);
  assert.match(words((await get(u() + "?said=none")).body), /We've let Test CPAs 1 know you don't have that one/);
  // TH-UPL-6: more than 20 files in an hour through one link is refused.
  const post = (n: number) => { const b = "----th" + Math.random().toString(36).slice(2), parts = Array.from({ length: n }, (_, i) => Buffer.concat([Buffer.from("--" + b + '\r\nContent-Disposition: form-data; name="file"; filename="f' + i + '.jpg"\r\nContent-Type: image/jpeg\r\n\r\n'), JPEG, Buffer.from(String(Math.random())), Buffer.from("\r\n")])); return H.server.inject({ method: "POST", url: u(), payload: Buffer.concat([...parts, Buffer.from("--" + b + "--\r\n")]), headers: { "content-type": "multipart/form-data; boundary=" + b } }); };
  assert.equal((await post(10)).statusCode, 303); assert.equal((await post(10)).statusCode, 303); const over = await post(1); assert.equal(over.statusCode, 429); assert.match(words(over.body), /That is a lot of files in one hour/);
  // TH-UPL-8: staff add a document for the client; it is marked as added by staff and the client is sent nothing about it.
  const n = H.email.sent.length, up = await H.server.inject({ method: "POST", url: "/api/clients/" + T.S.engs[0].id + "/documents", payload: JPEG, headers: { "content-type": "image/jpeg", cookie: (await H.signInAs("pat1@firm1.test")).cookie(), "x-tallyhound": "1" } });
  if (up.statusCode === 200) { T = await state(); assert.ok(T.S.audit.some((a: any) => a.action === "document.staff_upload")); assert.equal(H.email.sent.length, n); }
  await H.close();
});

test("TH-UPL-3: when the service is on https, a client page asked for in the clear is refused before anything is read", async () => {
  const H = await build("memory", { letters: true, secure: true }), { firmId, ownerId } = await H.newFirm();
  await H.app.staff(firmId, ownerId, (T: Engine) => { T.S.firm.hound.mode = "autopilot"; T.importRows(T.parseCSV("First,Last,Email\nMaria,Garcia,maria@x.example")); const e = T.S.engs[0]; e.confirmed = true; T.start(e.id); }); await H.worker.pass();
  const T = createEngine(); T.load(await H.store.readState(firmId)); const u = "/u/" + T.S.firm.slug + "-" + T.S.engs[0].link.key;
  const plain = await H.server.inject({ method: "GET", url: u }); assert.equal(plain.statusCode, 400); assert.ok(!/Maria/.test(plain.body));
  const post = await H.server.inject({ method: "POST", url: u, payload: "form=none&item=x", headers: { "content-type": "application/x-www-form-urlencoded" } }); assert.equal(post.statusCode, 400);
  const tls = await H.server.inject({ method: "GET", url: u, headers: { "x-forwarded-proto": "https" } }); assert.equal(tls.statusCode, 200); assert.match(tls.body, /Hi Maria/);
  await H.close();
});

test("v2: an owner changes a letter's wording; it keeps its line breaks, must keep the list and the link, passes the message check, and the next letter uses it", async () => {
  const H = await build("memory", { letters: true }), { firmId, ownerId } = await H.newFirm(), owner = await H.signInAs("pat1@firm1.test");
  const act = async (fn: string, ...args: unknown[]) => (await owner.post("/api/act", { fn, args })).json.result;
  const ok = "Dear {first},\n\nFor your {year} return we are still waiting on:\n\n{items}\n\nPlease upload them here when you can:\n{link}\n\nWith thanks,\n{sign_name}\n{firm}";
  assert.equal(await act("saveWording", "L1", ok.replace("{link}", "the page"), "professional"), "It must keep {link}");
  assert.equal(await act("saveWording", "L1", ok.replace("still waiting on", "waiting on, so you get your refund,"), "professional"), "It would not pass the message check: blocked word \"refund\"");
  assert.equal(await act("saveWording", "L1", ok.replace("{firm}", "{firm} {bank}"), "professional"), "Tallyhound does not know {bank}");
  assert.equal(await act("saveWording", "L1", ok, "professional"), null);
  await H.app.staff(firmId, ownerId, (T: Engine) => { assert.match(T.S.firm.templates.en.L1, /^Dear \{first\},¶¶For your/); T.S.firm.hound.mode = "autopilot"; T.importRows(T.parseCSV("First,Last,Email\nMaria,Garcia,maria@x.example")); const e = T.S.engs[0]; e.confirmed = true; T.start(e.id); }); await H.worker.pass();
  assert.match((H.email.sent[0] as any).body, /^Dear Maria,\n\nFor your 2026 return we are still waiting on:\n\n {2}- W-2 from each employer\n {2}- 1098 from your mortgage lender\n\nPlease upload them here when you can:\nhttps:\/\/go\.tallyhound\.test\/u\//);
  assert.equal(await act("resetWording", "L1", "professional"), null); const T = createEngine(); T.load((await H.store.readState(firmId))!); assert.equal(T.S.firm.templates.en.L1, undefined);
  // A reply's wording in a letters firm must keep the upload link it carries.
  assert.equal(await act("saveWording", "M8", "Sorry, part of that one is hard to read. Could you take it again?", "professional"), "It must keep {link}");
  await H.close();
});

test("v2: the morning note says how many letters went out since the last one and how many are waiting for approval", async () => {
  const { createNotifier } = await import("../src/notify.ts");
  const T = createEngine(); T.blank({ letters: true, plan: "Practice", name: "Maple & Pine", email: "docs@m.example", mode: "copilot", now: new Date(2027, 0, 25, 10, 5), users: [{ id: "u1", first: "Dana", name: "Dana Whitfield", role: "owner", email: "dana@m.example" }] });
  T.importRows(T.parseCSV("First,Last,Email\nMaria,Garcia,maria@x.example\nLuis,Ortega,luis@x.example")); const [a, b] = T.S.engs; a.confirmed = b.confirmed = true; T.start(a.id); T.start(b.id); T.advance(5 * T.MIN);
  const d = T.S.msgs.find((m: any) => m.engId === a.id && m.tpl === "L1"); T.setUser("u1"); assert.equal(T.approveMsg(d.id, null), null); d.sentAt = new Date(T.S.now);
  T.setNow(new Date(2027, 0, 26, 7, 30)); const mails = createNotifier({ appUrl: "https://app.tallyhound.test" }).collect(T, [{ id: "u1", name: "Dana Whitfield", email: "dana@m.example", role: "owner" } as any]);
  const note = mails.find((m: any) => m.kind === "digest"); assert.ok(note, "no morning note"); assert.match(note!.body, /Letters\n {2}1 letter went out since the last note\n {2}1 letter is waiting for your approval/); assert.ok(!/neeter/i.test(note!.body));
});
