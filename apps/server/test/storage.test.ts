// A firm's own Google Drive (T-25, T-111), against a stand-in for Google's sign-in and Drive.
import test from "node:test";
import assert from "node:assert/strict";
import { build, KINDS } from "./harness.ts";
import { createEngine, kitMemory, type Engine } from "../src/kit.ts";
import { StorageError } from "../src/storage.ts";

/* eslint-disable @typescript-eslint/no-explicit-any */
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(40000, 7)]);
const model = () => kitMemory.fakeAI((p: string) => p.startsWith("You read photos") ? { is_tax_document: true, form: "W2", tax_year: 2026, payer: "Acme Logistics", recipient_name: "JO DAY", legibility: 0.95, confidence: 0.97, missing_parts: [], note: "A W-2" } : null);
// Google, as far as Tallyhound uses it: the token endpoint, revoke, and Drive's folders and files.
function google() {
  const G = { calls: [] as string[], revoked: [] as string[], refuse: false, items: new Map<string, { name: string; parents: string[]; folder: boolean; bytes?: number }>(), n: 0 };
  const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { "content-type": "application/json" } });
  const f = (async (url: unknown, init: RequestInit = {}) => {
    const u = new URL(String(url)), body = typeof init.body === "string" ? init.body : "", auth = new Headers(init.headers).get("authorization"); G.calls.push((init.method || "GET") + " " + u.host + u.pathname);
    if (u.host === "oauth2.googleapis.com" && u.pathname === "/token") { const p = new URLSearchParams(body); if (p.get("client_id") !== "client-1" || p.get("client_secret") !== "shh") return json({ error: "invalid_client" }, 401);
      if (p.get("grant_type") === "authorization_code") return p.get("code") === "good-code" ? json({ access_token: "access-1", refresh_token: "refresh-1", expires_in: 3600, scope: p.get("redirect_uri") ? "https://www.googleapis.com/auth/drive.file" : "" }) : json({ error: "invalid_grant" }, 400);
      return G.refuse || p.get("refresh_token") !== "refresh-1" ? json({ error: "invalid_grant" }, 400) : json({ access_token: "access-2", expires_in: 3600 }); }
    if (u.pathname === "/revoke") { G.revoked.push(new URLSearchParams(body).get("token") || ""); return json({}); }
    if (!/^Bearer access-/.test(auth || "")) return json({ error: { message: "no token" } }, 401);
    if (u.pathname === "/drive/v3/files" && (init.method || "GET") === "GET") { const q = u.searchParams.get("q") || "", name = /name = '((?:[^'\\]|\\.)*)'/.exec(q)![1]!.replace(/\\(.)/g, "$1"), parent = /'([^']+)' in parents/.exec(q)![1]!; return json({ files: [...G.items].filter(([, v]) => v.folder && v.name === name && v.parents.includes(parent)).map(([id]) => ({ id })) }); }
    if (u.pathname === "/drive/v3/files" && init.method === "POST") { const j = JSON.parse(body), id = "fld" + ++G.n; G.items.set(id, { name: j.name, parents: j.parents, folder: true }); return json({ id }); }
    if (u.pathname === "/upload/drive/v3/files") { const raw = Buffer.from(init.body as Buffer), meta = JSON.parse(/\r\n\r\n(\{.*?\})\r\n/.exec(raw.subarray(0, 600).toString("latin1"))![1]!), id = "file" + ++G.n; G.items.set(id, { name: meta.name, parents: meta.parents, folder: false, bytes: raw.length }); return json({ id }); }
    const one = /^\/drive\/v3\/files\/(\w+)$/.exec(u.pathname); if (one && G.items.has(one[1]!)) { const it = G.items.get(one[1]!)!; if (init.method === "PATCH") { const add = u.searchParams.get("addParents"), rm = (u.searchParams.get("removeParents") || "").split(","); it.parents = it.parents.filter((p) => !rm.includes(p)).concat(add ? [add] : []); it.name = JSON.parse(body).name; } return json({ id: one[1], parents: it.parents }); }
    return json({ error: { message: "not found" } }, 404);
  }) as unknown as typeof fetch;
  const path = (id: string): string => { const it = G.items.get(id); return it ? (it.parents[0] && it.parents[0] !== "root" ? path(it.parents[0]) + "/" : "") + it.name : ""; };
  return Object.assign(G, { f, files: () => [...G.items].filter(([, v]) => !v.folder).map(([id]) => path(id)) });
}

for (const kind of KINDS) {
  const name = (s: string) => "storage (" + kind + "): " + s;
  test(name("an owner connects the firm's Google Drive by signing in to Google; the token is stored sealed; documents are then filed there and renamed once accepted; disconnecting takes the permission away"), async () => {
    const G = google(), H = await build(kind, { ai: model(), google: G.f }), { firmId, ownerId } = await H.newFirm(), owner = await H.signInAs("pat1@firm1.test");
    await owner.post("/api/users", { name: "Alex Staff", email: "alex@firm1.test", role: "staff" }); const alex = await H.signInAs("alex@firm1.test");
    const state = async () => { const T = createEngine(); T.load(await H.store.readState(firmId)); return T; };
    assert.deepEqual((await owner.get("/api/storage")).json, { available: true, connected: false, provider: null, since: null });
    // Start: only an owner, and the address asks Google for the one narrow permission and for nothing else.
    assert.equal((await alex.get("/api/storage/google/start")).status, 403);
    const go = await owner.get("/api/storage/google/start"); assert.equal(go.status, 303); const to = new URL(String(go.headers.location)); assert.equal(to.host, "accounts.google.com"); assert.equal(to.searchParams.get("scope"), "https://www.googleapis.com/auth/drive.file"); assert.equal(to.searchParams.get("access_type"), "offline"); assert.match(to.searchParams.get("redirect_uri")!, /\/api\/storage\/google\/callback$/);
    const st = to.searchParams.get("state")!, back = (b: typeof owner, q: string) => b.get("/api/storage/google/callback?" + q);
    // Coming back: a made-up state, someone else's state, a refusal at Google and a bad code all connect nothing.
    for (const [b, q, why] of [[owner, "code=good-code&state=made.up", "state"], [alex, "code=good-code&state=" + st, null], [owner, "error=access_denied&state=" + st, "declined"], [owner, "code=bad-code&state=" + st, "token"]] as [typeof owner, string, string | null][]) { const r = await back(b, q); if (why) { assert.equal(r.status, 303); assert.equal(r.headers.location, "/settings?tab=files&problem=" + why); } else assert.equal(r.status, 403); }
    assert.equal((await state()).S.firm.delivery.provider, "Download");
    const ok = await back(owner, "code=good-code&state=" + encodeURIComponent(st)); assert.equal(ok.headers.location, "/settings?tab=files&connected=1");
    let T = await state(); assert.equal(T.S.firm.delivery.provider, "Google Drive"); assert.equal(T.S.firm.delivery.auto, "on"); assert.equal(T.S.firm.delivery.when, "arrival"); assert.ok(T.S.audit.some((a: any) => a.action === "settings.delivery" && /Google Drive connected/.test(a.detail)));
    const row = (await (H.storage as any).status(firmId)); assert.equal(row.connected, true);
    // The folder and timing are the owner's to set; which storage is connected cannot be set from the browser.
    assert.equal((await alex.post("/api/act", { fn: "setDelivery", args: [{ folder: "X" }] })).status, 403);
    assert.equal((await owner.post("/api/act", { fn: "setDelivery", args: [{ folder: " ../Tax Docs//2026 intake/ ", when: "arrival", auto: true, provider: "Dropbox" }] })).json.result, null); T = await state(); assert.equal(T.S.firm.delivery.folder, "Tax Docs/2026 intake"); assert.equal(T.S.firm.delivery.provider, "Google Drive");
    // A document arrives. The original goes to the firm's drive at once, then takes its proper name once it is accepted and filed.
    await H.app.staff(firmId, ownerId, (E: Engine) => { E.S.firm.hound.mode = "autopilot"; E.importRows(E.parseCSV("First,Last,Email\nJo,Day,jo@x.example")); const e = E.S.engs[0]; E.itemsOf(e.id).find((i: any) => i.form === "W2").payer = "Acme Logistics"; e.confirmed = true; E.start(e.id); });
    const jo = (await state()).S.clients[0].id; await H.app.clientUpload({ firmId, clientId: jo, files: [{ bytes: JPEG, contentType: "image/jpeg" }], providerId: "up1" });
    for (let i = 0; i < 4; i++) await H.worker.pass();
    const files = G.files(); assert.equal(files.length, 1, "one file in the drive, not a copy per step"); assert.match(files[0]!, /^Tax Docs\/2026 intake\/2026\/Day, Jo\//);
    T = await state(); const d = T.S.docs[0]; assert.ok(d.master && d.master.id, "the document remembers where its original is"); if (d.deliveredAt) assert.equal(files[0], "Tax Docs/2026 intake/2026/Day, Jo/" + T.fileName(T.S.clients[0], T.S.engs[0], d));
    assert.ok(G.calls.includes("POST oauth2.googleapis.com/token"));
    // Disconnect: the permission is taken away at Google, the token is forgotten, and files go back to the zip.
    assert.equal((await alex.post("/api/storage/disconnect")).status, 403); assert.equal((await owner.post("/api/storage/disconnect")).status, 200);
    assert.deepEqual(G.revoked, ["refresh-1"]); assert.equal((await owner.get("/api/storage")).json.connected, false); assert.equal((await state()).S.firm.delivery.provider, "Download");
    await assert.rejects((H.storage as any).files.put({ firmId, provider: "Google Drive", folder: "a", name: "b", bytes: JPEG }), (e: unknown) => e instanceof StorageError && e.code === "not_connected");
    await H.close();
  });
}

test("storage: when Google says the permission is gone, filing fails in words and nothing else breaks; with no Google sign-in set up, the page says so", async () => {
  const G = google(), H = await build("memory", { google: G.f }), { firmId } = await H.newFirm(), owner = await H.signInAs("pat1@firm1.test");
  const st = new URL(String((await owner.get("/api/storage/google/start")).headers.location)).searchParams.get("state")!; await owner.get("/api/storage/google/callback?code=good-code&state=" + encodeURIComponent(st));
  H.advance(2 * 3600); G.refuse = true;   // the first token has aged out, and Google refuses a new one
  await assert.rejects((H.storage as any).files.put({ firmId, provider: "Google Drive", folder: "a", name: "b", bytes: JPEG }), (e: unknown) => e instanceof StorageError && e.code === "revoked" && /Connect the drive again/.test(e.message));
  await assert.rejects((H.storage as any).files.put({ firmId, provider: "Dropbox", folder: "a", name: "b", bytes: JPEG }), /Dropbox is not connected/);
  // The state value expires.
  const again = await H.signInAs("pat1@firm1.test"), old = new URL(String((await again.get("/api/storage/google/start")).headers.location)).searchParams.get("state")!; H.advance(11 * 60); G.refuse = false;
  assert.equal((await again.get("/api/storage/google/callback?code=good-code&state=" + encodeURIComponent(old))).headers.location, "/settings?tab=files&problem=state"); await H.close();
  const N = await build("memory"); await N.newFirm(); const o = await N.signInAs("pat1@firm1.test"); assert.equal((await o.get("/api/storage")).json.available, false); assert.equal((await o.get("/api/storage/google/start")).headers.location, "/settings?tab=files&problem=unavailable"); await N.close();
});
