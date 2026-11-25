// Getting ready for Neeter (docs/neeter/RUNBOOK.md). Four things are tested here:
//   1. The adapter calls exactly what docs/neeter/contract.json says, with the fields it says. Change one without the other and this fails.
//   2. The webhook takes the contract's own example events.
//   3. One conformance suite every mail layer must pass: the stand-in always, and Neeter's sandbox when its keys are set:
//        NEETER_SANDBOX_URL, NEETER_SANDBOX_PARTNER_KEY, NEETER_SANDBOX_REFRESH_TOKEN, NEETER_SANDBOX_ADDRESS
//        (and NEETER_SANDBOX_TO, an inbox you own, to also send one real letter).   npm run test:layer
//   4. The answers Neeter may give that are settings: letters by due date, replies fetched, an assistant linked by hand; and
//      the clean-ups: a person leaving, a firm closing.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "./harness.ts";
import { createEngine, kitMemory, type Engine } from "../src/kit.ts";
import { guarded, LayerError, TASK_STATUS, type MailLayer } from "../src/maillayer.ts";
import { hookSign, SCOPES } from "../src/mailbox.ts";
import { layerEvent } from "../src/layerevents.ts";
import { preflight } from "../src/preflight.ts";
import { createClosure } from "../src/closure.ts";
import { fakeLayer } from "../src/integrations/neeter/fake.ts";
import { neeter, template } from "../src/integrations/neeter/index.ts";

/* eslint-disable @typescript-eslint/no-explicit-any */
const C = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../../../docs/neeter/contract.json"), "utf8"));
const json = (j: unknown, status = 200) => new Response(JSON.stringify(j), { status, headers: { "content-type": "application/json" } });
const resolve = (s: any): any => (s && s.$ref ? C.components.schemas[s.$ref.split("/").pop()] : s);
const pathRe = (p: string) => new RegExp("^" + p.replace(/\{[^}]+\}/g, "[^/]+") + "$");
const keys = () => { const m = new Map<string, { key: string; issuedAt: Date }>(); return { async get(id: string) { return m.get(id) || null; }, async put(id: string, key: string, issuedAt: Date) { m.set(id, { key, issuedAt }); }, m }; };

test("1. every call the adapter makes is in the contract, with a key where the contract asks for one, the required fields, and nothing it does not list", async () => {
  const seen: { method: string; path: string; body: any; headers: Record<string, string> }[] = [];
  const f = (async (url: string | URL, init: RequestInit = {}) => { const u = new URL(String(url)); seen.push({ method: String(init.method || "GET"), path: u.pathname, body: init.body ? JSON.parse(String(init.body)) : null, headers: (init.headers || {}) as Record<string, string> });
    const p = u.pathname; return json(p.endsWith("/keys") ? { key: "k1" } : p.endsWith("/partner") ? { name: "Tallyhound" } : p.endsWith("/events") ? { events: [], cursor: "c1" } : init.method === "GET" ? { name: "n", closed: false, tasks: [], history: [] } : { id: "x1", thread_id: "t1" }); }) as unknown as typeof fetch;
  for (const send of ["letters", "due_date"] as const) {
    const N = neeter({ baseUrl: "https://layer.example", partnerKey: "pk", keys: keys(), clock: () => new Date("2027-01-25T12:00:00Z"), fetch: f, send });
    const a = (await N.provision({ firmId: "f1", userId: "u1", provider: "google", address: "pat@firm.example", refreshToken: "rt", scopes: SCOPES.google })).assistantId;
    const p = (await N.upsertProject({ firmId: "f1", assistantId: a, key: "e1:v1", name: "Garcia, Maria 2026", email: "maria@x.example", closed: false, due: "2027-01-27" })).id;
    await N.upsertProject({ firmId: "f1", assistantId: a, key: "e1:v2", remoteId: p, name: "Garcia, Maria 2026", email: "maria@x.example", closed: true, due: null });
    const t = (await N.upsertTask({ firmId: "f1", assistantId: a, key: "i1:v1", projectId: p, title: "W-2 from Acme Logistics", status: "Open", note: "" })).id;
    await N.upsertTask({ firmId: "f1", assistantId: a, key: "i1:v2", projectId: p, remoteId: t, title: "W-2 from Acme Logistics", status: "Done", note: "Passed the sniff test" });
    await N.sendLetter({ firmId: "f1", assistantId: a, key: "m1", projectId: p, to: "maria@x.example", subject: "2 documents for your 2026 tax return", body: "Hi Maria", thread: null, unsubscribe: "https://go.example/e/x" });
    await N.getProject({ firmId: "f1", assistantId: a, projectId: p }); await N.listEvents!({ firmId: "f1", assistantId: a, cursor: null }); await N.listEvents!({ firmId: "f1", assistantId: a, cursor: "c1" }); await N.whoAmI!();
    await N.forgetProject({ firmId: "f1", assistantId: a, key: "e1:forget", projectId: p }); await N.remove({ firmId: "f1", assistantId: a });
  }
  // A firm key 90 days old is replaced, and the old one given up.
  const old = keys(); await old.put("f2", "k-old", new Date("2026-10-01T00:00:00Z")); await neeter({ baseUrl: "https://layer.example", partnerKey: "pk", keys: old, clock: () => new Date("2027-01-25T12:00:00Z"), fetch: f }).maintain!("f2"); assert.equal(old.m.get("f2")!.key, "k1");
  const used = new Set<string>();
  for (const r of seen) {
    const entry = Object.entries(C.paths).find(([p, ops]: [string, any]) => pathRe(p).test(r.path) && ops[r.method.toLowerCase()]); assert.ok(entry, r.method + " " + r.path + " is not in the contract");
    const [p, ops] = entry as [string, any], op = ops[r.method.toLowerCase()]; used.add(r.method + " " + p);
    if ((op.parameters || []).some((x: any) => x.name === "Idempotency-Key")) assert.ok(r.headers["idempotency-key"], op.operationId + " was called with no Idempotency-Key");
    const auth = r.headers.authorization; assert.ok(op.security && op.security[0] && op.security[0].partnerKey ? auth === "Bearer pk" : auth === "Bearer k1", op.operationId + " used the wrong key");
    const schema = resolve(op.requestBody && op.requestBody.content["application/json"].schema);
    if (!schema) { assert.equal(r.body, null, op.operationId + " sent a body the contract does not have"); continue; }
    for (const k of schema.required || []) assert.ok(r.body && k in r.body, op.operationId + " is missing " + k);
    for (const k of Object.keys(r.body || {})) assert.ok(k in schema.properties, op.operationId + " sends " + k + ", which the contract does not list");
    if (r.body && r.body.status) assert.ok(TASK_STATUS.includes(r.body.status));
  }
  const all = Object.entries(C.paths).flatMap(([p, ops]: [string, any]) => Object.keys(ops).map((m) => m.toUpperCase() + " " + p)); assert.deepEqual(all.filter((x) => !used.has(x)), [], "the contract lists calls the adapter never makes");
  assert.deepEqual(C.components.schemas.TaskStatus.enum, TASK_STATUS);
});

test("2. the webhook takes each example in the contract: a test, a reply, a reply with a file and a bounce; anything unsigned or stale is refused", async () => {
  const ai = kitMemory.fakeAI((p: string) => (p.startsWith("You read photos") ? { is_tax_document: true, form: "1098", tax_year: 2026, payer: "Hillcrest Mortgage", recipient_name: "MARIA GARCIA", legibility: 0.95, confidence: 0.97, missing_parts: [], note: "" } : null));
  const H = await build("memory", { layer: true, ai, mailFetch: googleStandIn() }), { firmId, ownerId } = await H.newFirm(), owner = await H.signInAs("pat1@firm1.test");
  await connect(owner); const as = [...H.layer.assistants.keys()][0]!;
  await H.app.staff(firmId, ownerId, (T: Engine) => { T.S.firm.hound.mode = "autopilot"; T.S.firm.confirmAll = false; T.importRows(T.parseCSV("First,Last,Email\nMaria,Garcia,maria@x.example")); const e = T.S.engs[0]; e.confirmed = true; T.start(e.id); }); await H.worker.pass();
  const ex = C.webhooks.tallyhoundEvents.post.requestBody.content["application/json"].examples;
  assert.deepEqual((await H.layerPost(ex.ping.value)).json(), { ok: true, ping: true });
  for (const k of ["reply", "reply_with_file", "bounce"]) assert.equal((await H.layerPost(ex[k].value)).statusCode, 202, k + " for an assistant we do not know was taken");
  assert.equal((await H.layerPost({ ...ex.reply_with_file.value, assistant_id: as, attachments: [{ name: "1098.pdf", content_type: "application/pdf", content_base64: Buffer.from("%PDF-1.4\n" + "x".repeat(3000)).toString("base64") }] })).statusCode, 200);
  assert.equal((await H.layerPost({ ...ex.reply.value, assistant_id: as })).statusCode, 200); assert.equal((await H.layerPost({ ...ex.bounce.value, assistant_id: as })).statusCode, 200);
  const T = createEngine(); T.load((await H.store.readState(firmId))!); assert.equal(T.S.docs.filter((d: any) => d.form === "1098").length, 1); assert.equal(T.S.clients[0].emailOk, false);
  // The signature: missing, wrong, or older than five minutes.
  const raw = Buffer.from(JSON.stringify(ex.ping.value)); for (const h of [{}, { "x-layer-signature": "t=1,v1=" + "0".repeat(64) }, { "x-layer-signature": hookSign("layer-hook-secret", raw, new Date(Date.now() - 6 * 60000)) }]) assert.equal((await H.server.inject({ method: "POST", url: "/hooks/neeter", payload: raw, headers: { "content-type": "application/json", ...h } })).statusCode, 401);
  await H.close();
});

// The suite every mail layer must pass. For the stand-in it runs always; for Neeter's sandbox only when its keys are set.
async function layerSuite(L: MailLayer, o: { refreshToken: string; address: string; to?: string }) {
  const G = guarded(L), firmId = "tallyhound-conformance", run = Date.now().toString(36);
  if (L.whoAmI) assert.ok((await L.whoAmI()).length > 0, "whoAmI says nothing");
  const a = (await G.provision({ firmId, userId: "u-" + run, provider: "google", address: o.address, refreshToken: o.refreshToken, scopes: SCOPES.google })).assistantId; assert.ok(a);
  try {
    const p1 = await G.upsertProject({ firmId, assistantId: a, key: "e-" + run + ":1", name: "Conformance, Test 2026", email: o.address, closed: false, due: null });
    assert.deepEqual(await G.upsertProject({ firmId, assistantId: a, key: "e-" + run + ":1", name: "Conformance, Test 2026", email: o.address, closed: false, due: null }), p1, "a repeated key made a second project");
    const t1 = await G.upsertTask({ firmId, assistantId: a, key: "i1-" + run + ":1", projectId: p1.id, title: "W-2 from Acme Logistics", status: "Open", note: "" });
    const t2 = await G.upsertTask({ firmId, assistantId: a, key: "i2-" + run + ":1", projectId: p1.id, title: "1098 from Hillcrest Mortgage", status: "Open", note: "" });
    assert.deepEqual(await G.upsertTask({ firmId, assistantId: a, key: "i1-" + run + ":1", projectId: p1.id, title: "W-2 from Acme Logistics", status: "Open", note: "" }), t1, "a repeated key made a second task");
    for (const s of ["Completed", "Done"] as const) await G.upsertTask({ firmId, assistantId: a, key: "i1-" + run + ":" + s, projectId: p1.id, remoteId: t1.id, title: "W-2 from Acme Logistics", status: s, note: "" });
    await G.upsertTask({ firmId, assistantId: a, key: "i2-" + run + ":hold", projectId: p1.id, remoteId: t2.id, title: "1098 from Hillcrest Mortgage", status: "On hold", note: "Held until March 15" });
    const got = await G.getProject({ firmId, assistantId: a, projectId: p1.id }); assert.ok(got, "the project cannot be read back"); assert.equal(got!.name, "Conformance, Test 2026");
    assert.deepEqual(got!.tasks.map((t) => [t.id, t.title, t.status]).sort(), [[t1.id, "W-2 from Acme Logistics", "Done"], [t2.id, "1098 from Hillcrest Mortgage", "On hold"]].sort());
    assert.ok(got!.history.filter((h) => h.taskId === t1.id).length >= 2, "status changes are not in the history");
    await assert.rejects(G.upsertTask({ firmId, assistantId: a, key: "i3-" + run, projectId: p1.id, title: "W-2 box 1 $52,000", status: "Open", note: "" }), (e: unknown) => e instanceof LayerError && e.code === "schema");
    if (o.to) { const l1 = await G.sendLetter({ firmId, assistantId: a, key: "m-" + run, projectId: p1.id, to: o.to, subject: "Tallyhound conformance " + run, body: "This is a test letter from Tallyhound's conformance suite. No action is needed." });
      assert.ok(l1.id && l1.thread); assert.deepEqual(await G.sendLetter({ firmId, assistantId: a, key: "m-" + run, projectId: p1.id, to: o.to, subject: "Tallyhound conformance " + run, body: "This is a test letter from Tallyhound's conformance suite. No action is needed." }), l1, "a repeated key sent a second letter"); }
    if (L.listEvents) { const e = await L.listEvents({ firmId, assistantId: a, cursor: null }); assert.ok(Array.isArray(e.events)); }
    await G.forgetProject({ firmId, assistantId: a, key: "e-" + run + ":forget", projectId: p1.id }); assert.equal(await G.getProject({ firmId, assistantId: a, projectId: p1.id }), null, "a forgotten project can still be read");
  } finally { await G.remove({ firmId, assistantId: a }); }
}
test("3a. the conformance suite passes against the stand-in, and an outage reads as unreachable", async () => {
  const F = fakeLayer(); await layerSuite(F, { refreshToken: "rt", address: "pat@firm.example", to: "inbox@firm.example" }); assert.equal(F.letters.length, 1, "the repeated letter went twice");
  F.down = true; await assert.rejects(F.whoAmI!(), (e: unknown) => e instanceof LayerError && e.code === "unreachable");
});
const SB = { url: process.env.NEETER_SANDBOX_URL, key: process.env.NEETER_SANDBOX_PARTNER_KEY, token: process.env.NEETER_SANDBOX_REFRESH_TOKEN, address: process.env.NEETER_SANDBOX_ADDRESS, to: process.env.NEETER_SANDBOX_TO };
test("3b. the conformance suite passes against Neeter's sandbox", { skip: SB.url && SB.key && SB.token && SB.address ? false : "set NEETER_SANDBOX_URL, NEETER_SANDBOX_PARTNER_KEY, NEETER_SANDBOX_REFRESH_TOKEN and NEETER_SANDBOX_ADDRESS to run against Neeter" }, async () => {
  await layerSuite(neeter({ baseUrl: SB.url!, partnerKey: SB.key!, keys: keys(), clock: () => new Date(), trace: true, log: (...a) => console.log("  " + a.join(" ")) }), { refreshToken: SB.token!, address: SB.address!, to: SB.to });
});

test("4a. letters by due date (NEETER_SEND=due_date): no letter is sent by us; the project's due date moves to tomorrow, once for each letter", async () => {
  const calls: { method: string; path: string; body: any; idem: string }[] = [], f = (async (url: string | URL, init: RequestInit = {}) => { calls.push({ method: String(init.method), path: new URL(String(url)).pathname, body: init.body ? JSON.parse(String(init.body)) : null, idem: ((init.headers || {}) as Record<string, string>)["idempotency-key"]! }); return json({ key: "k", id: "p1" }); }) as unknown as typeof fetch;
  const N = neeter({ baseUrl: "https://layer.example", partnerKey: "pk", keys: keys(), clock: () => new Date("2027-01-25T15:00:00Z"), fetch: f, send: "due_date" });
  const r = await N.sendLetter({ firmId: "f1", assistantId: "a1", key: "m9", projectId: "p1", to: "maria@x.example", subject: "s", body: "b" });
  assert.deepEqual(r, { id: "due:m9", thread: "" }); const last = calls.at(-1)!; assert.equal(last.method, "PATCH"); assert.equal(last.path, "/v1/assistants/a1/projects/p1"); assert.deepEqual(last.body, { due_date: "2027-01-26" }); assert.equal(last.idem, "m9:due");
  assert.ok(!calls.some((c) => c.path.endsWith("/letters")), "a letter was sent in due-date mode");
});
test("4b. replies fetched (NEETER_REPLIES=poll): the timer's poll acts on each event once, keeps its place, and drops what is not ours", async () => {
  const H = await build("memory", { layer: true, mailFetch: googleStandIn() }), { firmId, ownerId } = await H.newFirm(), owner = await H.signInAs("pat1@firm1.test"); await connect(owner); const as = [...H.layer.assistants.keys()][0]!;
  await H.app.staff(firmId, ownerId, (T: Engine) => { T.S.firm.hound.mode = "autopilot"; T.importRows(T.parseCSV("First,Last,Email\nMaria,Garcia,maria@x.example")); const e = T.S.engs[0]; e.confirmed = true; T.start(e.id); }); await H.worker.pass();
  const handle = (e: any) => layerEvent({ app: H.app, firmOfAssistant: (a) => H.mailboxes!.firmOfAssistant(a) }, e);
  H.layer.queue({ id: "p1", type: "reply", assistant_id: as, from: "maria@x.example", text: "can I deduct my home office?" }); H.layer.queue({ id: "p2", type: "reply", assistant_id: "someone-else", from: "x@y.example", text: "hi" });
  assert.equal(await H.mailboxes!.poll(firmId, handle), 1); assert.equal(await H.mailboxes!.poll(firmId, handle), 0, "the same events were fetched twice");
  H.layer.queue({ id: "p1", type: "reply", assistant_id: as, from: "maria@x.example", text: "can I deduct my home office?" }); assert.equal(await H.mailboxes!.poll(firmId, handle), 1);
  const T = createEngine(); T.load((await H.store.readState(firmId))!); assert.equal(T.S.msgs.filter((m: any) => m.dir === "in").length, 1, "an event delivered twice was acted on twice"); assert.equal(T.S.tasks.filter((t: any) => t.kind === "question" && t.status === "open").length, 1);
  H.layer.down = true; assert.equal(await H.mailboxes!.poll(firmId, handle), 0, "an outage while polling threw"); await H.close();
});
test("4c. an assistant linked by hand: letters go from it, Tallyhound holds no token for it, and disconnecting removes it without asking Google", async () => {
  const google = googleStandIn(), H = await build("memory", { layer: true, mailFetch: google }), { firmId, ownerId } = await H.newFirm();
  const a = (await H.layer.provision({ firmId, userId: ownerId, provider: "google", address: "pat@firm1.test", refreshToken: "set-up-elsewhere", scopes: [] })).assistantId;
  await assert.rejects(H.mailboxes!.linkExisting(firmId, ownerId, { assistantId: "bad id!", provider: "google", address: "pat@firm1.test" }), /assistant id/);
  await H.mailboxes!.linkExisting(firmId, ownerId, { assistantId: a, provider: "google", address: "Pat@Firm1.test" }); await assert.rejects(H.mailboxes!.linkExisting(firmId, ownerId, { assistantId: a, provider: "google", address: "pat@firm1.test" }), /already linked/);
  const row = (await H.mailboxes!.adminList(firmId))[0]!; assert.equal(row.linked, true); assert.equal(row.assistantId, a); assert.equal(row.address, "pat@firm1.test");
  await H.app.staff(firmId, ownerId, (T: Engine) => { T.S.firm.hound.mode = "autopilot"; T.importRows(T.parseCSV("First,Last,Email\nMaria,Garcia,maria@x.example")); const e = T.S.engs[0]; e.confirmed = true; assert.equal(T.start(e.id), null); }); await H.worker.pass();
  assert.equal(H.layer.letters.length, 1); assert.equal(H.layer.letters[0]!.assistantId, a);
  assert.equal(await H.mailboxes!.disconnect(firmId, ownerId), true); assert.equal(H.layer.assistants.has(a), false); assert.equal(google.revoked.length, 0, "Google was asked to withdraw a permission Tallyhound never held"); await H.close();
});
test("4d. a person who leaves the firm has their mailbox disconnected; closing a firm removes every assistant before its key is destroyed", async () => {
  const H = await build("memory", { layer: true, mailFetch: googleStandIn() }), { firmId } = await H.newFirm(), owner = await H.signInAs("pat1@firm1.test"); await connect(owner);
  await owner.post("/api/users", { name: "Alex Staff", email: "alex@firm1.test", role: "staff" }); const alex = await H.signInAs("alex@firm1.test"); await connect(alex, "alex@firm1.test");
  assert.equal(H.layer.assistants.size, 2); const alexId = (await owner.get("/api/users")).json.find((u: any) => u.name === "Alex Staff").id;
  assert.equal((await owner.del("/api/users/" + alexId)).status, 200); assert.equal(H.layer.assistants.size, 1, "the leaver's assistant is still there");
  const order: string[] = [], C2 = createClosure({ store: { destroyFirm: async () => { order.push("key destroyed"); } } as any, auth: { activeFirmIds: async () => [firmId], usersOfFirm: async () => [], deactivateUser: async () => {}, audit: async () => {} } as any, markers: { put: async () => {}, get: async () => null }, clock: () => new Date(), beforeDestroy: async (id) => { order.push("mailboxes removed: " + (await H.mailboxes!.removeAll(id))); } });
  await C2.close(firmId, "Jordan"); assert.deepEqual(order, ["mailboxes removed: 1", "key destroyed"]); assert.equal(H.layer.assistants.size, 0); await H.close();
});
test("4e. the connection check: the layer's settings are checked for sense, then one question with the partner key; the trace names no id", async () => {
  const env = (o: Record<string, string>) => (k: string) => o[k] || "", base = { TH_MAIL_LAYER: "neeter", APP_URL: "https://app.tallyhound.com", NEETER_BASE_URL: "https://api.layer.example", NEETER_PARTNER_KEY: "pk", NEETER_WEBHOOK_SECRET: "s".repeat(40), GOOGLE_CLIENT_ID: "g" };
  const line = async (o: Record<string, string>, layer?: () => Promise<string>) => (await preflight({ env: env(o), layer })).filter((c) => c.name.startsWith("Mail layer"));
  let L = await line(base, async () => "answers; it knows us as Tallyhound"); assert.deepEqual(L.map((c) => c.state), ["ok", "ok"]); assert.match(L[0]!.detail, /replies pushed to https:\/\/app\.tallyhound\.com\/hooks\/neeter; sign-in return addresses to register: https:\/\/app\.tallyhound\.com\/api\/mailbox\/google\/callback/);
  for (const [o, why] of [[{ NEETER_PARTNER_KEY: "" }, /missing NEETER_PARTNER_KEY/], [{ NEETER_BASE_URL: "http://x" }, /https/], [{ NEETER_WEBHOOK_SECRET: "short" }, /32 characters/], [{ GOOGLE_CLIENT_ID: "" }, /no sign-in app/]] as [Record<string, string>, RegExp][]) { L = await line({ ...base, ...o }); assert.equal(L[0]!.state, "failed"); assert.match(L[0]!.detail, why); }
  L = await line({ ...base, NEETER_REPLIES: "poll", NEETER_WEBHOOK_SECRET: "", NEETER_SEND: "due_date" }); assert.equal(L[0]!.state, "ok"); assert.match(L[0]!.detail, /DUE DATE.*fetched by the timer/);
  assert.equal((await line({}))[0]!.state, "not set"); L = await line(base, async () => { throw new Error("HTTP 401"); }); assert.equal(L[1]!.state, "failed");
  assert.equal(template("/v1/assistants/as_77/projects/pr_9/tasks/tk_1?x=1"), "/v1/assistants/{id}/projects/{id}/tasks/{id}"); assert.equal(template("/v1/partner"), "/v1/partner");
});

// Google's sign-in, stood in for: one good code, one address per test, and a record of what was withdrawn.
function googleStandIn() {
  const revoked: string[] = []; let next = "pat@firm1.test";
  const f = (async (url: string | URL, init: RequestInit = {}) => { const u = String(url), body = String(init.body || "");
    if (u === "https://oauth2.googleapis.com/token") { const m = /code=good-([a-z@.0-9]+)/.exec(decodeURIComponent(body)); if (m) next = m[1]!; return m ? json({ access_token: "at", refresh_token: "rt-" + next, scope: SCOPES.google.join(" ") }) : json({ error: "invalid_grant" }, 400); }
    if (u.startsWith("https://openidconnect.googleapis.com/")) return json({ email: next, email_verified: true });
    if (u === "https://oauth2.googleapis.com/revoke") { revoked.push(body); return json({}); } return json({}, 404); }) as unknown as typeof fetch & { revoked: string[] };
  return Object.assign(f, { revoked });
}
async function connect(b: { get(u: string): Promise<{ headers: Record<string, unknown> }> }, address = "pat@firm1.test") { const st = new URL(String((await b.get("/api/mailbox/google/start")).headers.location)).searchParams.get("state")!; const r = await b.get("/api/mailbox/google/callback?code=" + encodeURIComponent("good-" + address) + "&state=" + encodeURIComponent(st)); assert.equal(r.headers.location, "/settings?tab=mailbox&connected=1"); }
