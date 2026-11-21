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
    assert.deepEqual((await owner.get("/api/storage")).json, { available: true, offered: ["Google Drive", "Microsoft OneDrive", "SharePoint", "Dropbox"], connected: false, provider: null, since: null, site: null });
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
    T = await state(); const d = T.S.docs[0]; assert.ok(d.master && d.master.id, "the document remembers where its original is"); if (d.deliveredAt) assert.equal(files[0], "Tax Docs/2026 intake/2026/Day, Jo/" + T.filedName(T.S.clients[0], T.S.engs[0], d).replace(/\.pdf$/, ".jpg"));
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
  await assert.rejects((H.storage as any).files.put({ firmId, provider: "Google Drive", folder: "a", name: "b", bytes: JPEG }), (e: unknown) => e instanceof StorageError && e.code === "revoked" && /Connect it again in Settings/.test(e.message));
  await assert.rejects((H.storage as any).files.put({ firmId, provider: "Dropbox", folder: "a", name: "b", bytes: JPEG }), /not connected/);
  // The state value expires.
  const again = await H.signInAs("pat1@firm1.test"), old = new URL(String((await again.get("/api/storage/google/start")).headers.location)).searchParams.get("state")!; H.advance(11 * 60); G.refuse = false;
  assert.equal((await again.get("/api/storage/google/callback?code=good-code&state=" + encodeURIComponent(old))).headers.location, "/settings?tab=files&problem=state"); await H.close();
  const N = await build("memory"); await N.newFirm(); const o = await N.signInAs("pat1@firm1.test"); assert.equal((await o.get("/api/storage")).json.available, false); assert.equal((await o.get("/api/storage/google/start")).headers.location, "/settings?tab=files&problem=unavailable"); await N.close();
});

// Microsoft (sign-in and Graph) and Dropbox, as far as Tallyhound uses them.
function others() {
  const O = { calls: [] as string[], items: new Map<string, { path: string; bytes: number }>(), folders: new Set<string>(), n: 0, revoked: 0, sessions: new Map<string, { path: string; got: number; total: number }>(), scope: "" };
  const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { "content-type": "application/json" } });
  const f = (async (url: unknown, init: RequestInit = {}) => {
    const u = new URL(String(url)), h = new Headers(init.headers), body = typeof init.body === "string" ? init.body : "", m = init.method || "GET", size = init.body && typeof init.body !== "string" ? (init.body as Uint8Array).length : 0; O.calls.push(m + " " + u.host + decodeURIComponent(u.pathname));
    if (u.host === "login.microsoftonline.com") { const p = new URLSearchParams(body); O.scope = p.get("scope") || ""; if (p.get("client_id") !== "ms-1" || p.get("client_secret") !== "ms-shh") return json({ error: "invalid_client" }, 401); return p.get("grant_type") === "authorization_code" ? (p.get("code") === "ms-code" ? json({ access_token: "ms-access", refresh_token: "ms-refresh-1", expires_in: 3600 }) : json({ error: "invalid_grant" }, 400)) : json({ access_token: "ms-access", refresh_token: "ms-refresh-2", expires_in: 3600 }); }
    if (u.host === "api.dropboxapi.com" && u.pathname === "/oauth2/token") { const p = new URLSearchParams(body); return p.get("client_id") === "dbx-1" ? json(p.get("grant_type") === "authorization_code" ? { access_token: "dbx-access", refresh_token: "dbx-refresh", expires_in: 14400 } : { access_token: "dbx-access", expires_in: 14400 }) : json({ error: "invalid_client" }, 401); }
    if (u.host === "upload.example") { const s = O.sessions.get(u.pathname)!, r = /bytes (\d+)-(\d+)\/(\d+)/.exec(h.get("content-range") || "")!; s.total = +r[3]!; s.got += +r[2]! - +r[1]! + 1; if (s.got < s.total) return json({ nextExpectedRanges: [s.got + "-"] }, 202); const id = "item" + ++O.n; O.items.set(id, { path: s.path, bytes: s.got }); return json({ id }, 201); }
    if (!/^Bearer (ms|dbx)-access$/.test(h.get("authorization") || "")) return json({ error: "no token" }, 401);
    if (u.host === "graph.microsoft.com") {
      const p = decodeURIComponent(u.pathname).replace("/v1.0", "");
      if (p === "/sites/acme.sharepoint.com:/sites/Tax") return json({ id: "acme.sharepoint.com,site1,web1" }); if (p.startsWith("/sites/") && p.endsWith("/drive")) return json({ id: "drive-sp" }); if (p.startsWith("/sites/")) return json({ error: "itemNotFound" }, 404);
      const root = p.startsWith("/drives/drive-sp/") ? "/drives/drive-sp/root" : "/me/drive/special/approot", rest = p.slice(root.length), where = (rest.startsWith(":/") ? rest.slice(2) : "").replace(/:(\/content|\/createUploadSession|\/children)?$/, ""), tail = /:(\/\w+)?$/.exec(rest)?.[1] || (rest === "/children" ? "/children" : "");
      if (p.includes("/items/") && m === "PATCH") { const id = p.split("/items/")[1]!, j = JSON.parse(body), it = O.items.get(id); if (!it) return json({}, 404); const parent = [...O.folders].find((x) => "fld:" + x === j.parentReference.id) || ""; it.path = root + ":" + parent + "/" + j.name; return json({ id }); }
      if (tail === "/content") { const id = "item" + ++O.n; O.items.set(id, { path: root + ":" + where, bytes: size }); return json({ id }, 201); }
      if (tail === "/createUploadSession") { const k = "/s" + ++O.n; O.sessions.set(k, { path: root + ":" + where, got: 0, total: 0 }); return json({ uploadUrl: "https://upload.example" + k }); }
      if (tail === "/children" && m === "POST") { const full = (where ? where + "/" : "") + JSON.parse(body).name; O.folders.add(full); return json({ id: "fld:" + full }, 201); }
      if (m === "GET") return O.folders.has(where) ? json({ id: "fld:" + where }) : json({ error: "itemNotFound" }, 404);
    }
    if (u.host === "content.dropboxapi.com") { const a = JSON.parse(h.get("dropbox-api-arg")!), id = "id:dbx" + ++O.n; O.items.set(id, { path: a.path, bytes: size }); return json({ id }); }
    if (u.host === "api.dropboxapi.com" && u.pathname === "/2/files/move_v2") { const j = JSON.parse(body), it = O.items.get(j.from_path); if (!it) return json({ error: "not_found" }, 409); it.path = j.to_path; return json({ metadata: { id: j.from_path } }); }
    if (u.host === "api.dropboxapi.com" && u.pathname === "/2/auth/token/revoke") { O.revoked++; return json({}); }
    return json({ error: "not found" }, 404);
  }) as unknown as typeof fetch;
  return Object.assign(O, { f });
}
const connect = async (H: Awaited<ReturnType<typeof build>>, b: any, service: string, code: string, extra = "") => { const go = await b.get("/api/storage/" + service + "/start" + extra), to = new URL(String(go.headers.location)); return { to, back: await b.get("/api/storage/" + service + "/callback?code=" + code + "&state=" + encodeURIComponent(to.searchParams.get("state")!)) }; };

test("storage: OneDrive, SharePoint and Dropbox each connect by a visit to the service and back, file into their own place, and move a file when it is accepted", async () => {
  const O = others(), H = await build("memory", { google: O.f }), { firmId } = await H.newFirm(), owner = await H.signInAs("pat1@firm1.test"), S = H.storage as any, big = Buffer.alloc(9 * 1024 * 1024, 1), small = Buffer.from("small file");
  const state = async () => { const T = createEngine(); T.load(await H.store.readState(firmId)); return T; };
  // OneDrive: only Tallyhound's own folder is asked for.
  let c = await connect(H, owner, "onedrive", "ms-code"); assert.equal(c.to.host, "login.microsoftonline.com"); assert.equal(c.to.searchParams.get("scope"), "Files.ReadWrite.AppFolder offline_access"); assert.match(c.to.searchParams.get("redirect_uri")!, /\/api\/storage\/onedrive\/callback$/); assert.equal(c.back.headers.location, "/settings?tab=files&connected=1");
  assert.equal((await state()).S.firm.delivery.provider, "Microsoft OneDrive"); assert.equal((await owner.get("/api/storage")).json.provider, "Microsoft OneDrive");
  const one = await S.files.put({ firmId, provider: "Microsoft OneDrive", folder: "Client Tax Docs/2026/Day, Jo/_To check", name: "arrived.jpg", bytes: small }); assert.equal(O.items.get(one)!.path, "/me/drive/special/approot:Client Tax Docs/2026/Day, Jo/_To check/arrived.jpg");
  assert.ok(O.folders.has("Client Tax Docs/2026/Day, Jo/_To check"), "each folder on the way was made"); const made = O.folders.size; await S.files.put({ firmId, provider: "Microsoft OneDrive", folder: "Client Tax Docs/2026/Day, Jo/_To check", name: "b.jpg", bytes: small }); assert.equal(O.folders.size, made, "and not made twice");
  await S.files.move({ firmId, provider: "Microsoft OneDrive", id: one, folder: "Client Tax Docs/2026/Day, Jo", name: "Day_Jo_2026_W2.pdf" }); assert.equal(O.items.get(one)!.path, "/me/drive/special/approot:Client Tax Docs/2026/Day, Jo/Day_Jo_2026_W2.pdf");
  // A large file goes up in pieces.
  const sess = O.calls.length; const bigId = await S.files.put({ firmId, provider: "Microsoft OneDrive", folder: "Client Tax Docs", name: "big.pdf", bytes: big }); assert.equal(O.items.get(bigId)!.bytes, big.length); assert.ok(O.calls.slice(sess).filter((x) => x.startsWith("PUT upload.example")).length >= 2);
  // The token is refreshed when it ages out, and the newer long-lived token Microsoft hands back is the one kept.
  H.advance(2 * 3600); await S.files.put({ firmId, provider: "Microsoft OneDrive", folder: "x", name: "c.jpg", bytes: small }); assert.equal(O.scope, "Files.ReadWrite.AppFolder offline_access");
  // Another service's name is refused while OneDrive is the one connected.
  await assert.rejects(S.files.put({ firmId, provider: "Dropbox", folder: "a", name: "b", bytes: small }), /not connected/);
  // SharePoint: the owner names the site; a site that is not on sharepoint.com, or cannot be found, connects nothing.
  const again = await H.signInAs("pat1@firm1.test");
  assert.equal((await connect(H, again, "sharepoint", "ms-code", "?site=" + encodeURIComponent("https://evil.example/sites/Tax"))).back.headers.location, "/settings?tab=files&problem=site"); assert.equal((await connect(H, again, "sharepoint", "ms-code", "?site=" + encodeURIComponent("https://acme.sharepoint.com/sites/Nope"))).back.headers.location, "/settings?tab=files&problem=site");
  assert.equal((await state()).S.firm.delivery.provider, "Microsoft OneDrive", "still the last one that worked");
  c = await connect(H, again, "sharepoint", "ms-code", "?site=" + encodeURIComponent("https://acme.sharepoint.com/sites/Tax/")); assert.equal(c.to.searchParams.get("scope"), "Sites.ReadWrite.All offline_access"); assert.equal(c.back.headers.location, "/settings?tab=files&connected=1");
  const st = (await again.get("/api/storage")).json; assert.equal(st.provider, "SharePoint"); assert.equal(st.site, "https://acme.sharepoint.com/sites/Tax");
  const sp = await S.files.put({ firmId, provider: "SharePoint", folder: "Client Tax Docs/2026", name: "a.jpg", bytes: small }); assert.equal(O.items.get(sp)!.path, "/drives/drive-sp/root:Client Tax Docs/2026/a.jpg");
  await S.files.move({ firmId, provider: "SharePoint", id: sp, folder: "Client Tax Docs/2026/Done", name: "final.pdf" }); assert.equal(O.items.get(sp)!.path, "/drives/drive-sp/root:Client Tax Docs/2026/Done/final.pdf");
  // Dropbox: connecting it gives up the one before; files keep their id when moved; disconnecting takes the permission away at Dropbox.
  c = await connect(H, again, "dropbox", "dbx-code"); assert.equal(c.to.host, "www.dropbox.com"); assert.equal(c.to.searchParams.get("token_access_type"), "offline"); assert.equal(c.back.headers.location, "/settings?tab=files&connected=1"); assert.equal((await state()).S.firm.delivery.provider, "Dropbox");
  const dbx = await S.files.put({ firmId, provider: "Dropbox", folder: "Client Tax Docs/2026/Ruiz, Ana", name: "arrived ñ.jpg", bytes: small }); assert.equal(O.items.get(dbx)!.path, "/Client Tax Docs/2026/Ruiz, Ana/arrived ñ.jpg", "a name with an accent survives the header");
  await S.files.move({ firmId, provider: "Dropbox", id: dbx, folder: "Client Tax Docs/2026/Ruiz, Ana", name: "Ruiz_Ana_2026_W2.pdf" }); assert.equal(O.items.get(dbx)!.path, "/Client Tax Docs/2026/Ruiz, Ana/Ruiz_Ana_2026_W2.pdf");
  await assert.rejects(S.files.put({ firmId, provider: "SharePoint", folder: "a", name: "b", bytes: small }), /not connected/);
  assert.equal((await again.post("/api/storage/disconnect")).status, 200); assert.equal(O.revoked, 1); assert.equal((await state()).S.firm.delivery.provider, "Download"); assert.equal((await again.get("/api/storage")).json.connected, false);
  // A service nobody set up cannot be started.
  assert.equal((await again.get("/api/storage/box/start")).headers.location, "/settings?tab=files&problem=unavailable");
  await H.close();
});
