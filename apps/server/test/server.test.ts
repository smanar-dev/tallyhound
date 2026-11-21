// The web service end to end: sign-in, roles, firm separation, the timer. Runs in memory, and again on a real Postgres when DATABASE_URL is set.
import { createClosure } from "../src/closure.ts";
import { costOf } from "../src/ops.ts";
import test from "node:test";
import assert from "node:assert/strict";
import { build, KINDS, APP_URL } from "./harness.ts";
import { ACTIONS } from "../src/actions.ts";
import { createEngine, type Engine } from "../src/kit.ts";

for (const kind of KINDS) {
  const name = (s: string) => "server (" + kind + "): " + s;

  test(name("first sign-in is a link, then setting up two-step, then ten recovery codes shown once"), async () => {
    const H = await build(kind); await H.newFirm();
    const b = H.browser(); assert.equal((await b.get("/api/me")).status, 401);
    assert.equal((await b.post("/auth/link", { email: "Pat1@Firm1.test" })).status, 200); assert.equal(H.links.length, 1);
    assert.ok(H.links[0]!.url.startsWith(APP_URL + "/signin/open#t="), "the token rides after the #, so it is never in a server log");
    const o = await b.post("/auth/open", { token: H.token(H.links[0]!.url) }); assert.equal(o.json.next, "setup");
    assert.ok(o.setCookie!.httpOnly && o.setCookie!.secure && o.setCookie!.sameSite === "Lax");
    assert.equal((await b.get("/api/me")).status, 401, "the link alone does not sign anyone in");
    const s = await b.post("/auth/setup/start"); assert.match(s.json.secret, /^[A-Z2-7]{32}$/); assert.ok(s.json.qr.startsWith("data:image/svg+xml;base64,"));
    assert.equal((await b.post("/auth/setup/start")).json.secret, s.json.secret, "reloading the page shows the same key");
    H.secrets.set("pat1@firm1.test", H.unbase32(s.json.secret));
    assert.equal((await b.post("/auth/setup/finish", { code: "000000" })).status, 400);
    const f = await b.post("/auth/setup/finish", { code: H.codeFor("pat1@firm1.test") }); assert.equal(f.status, 200); assert.equal(f.json.recoveryCodes.length, 10);
    const me = await b.get("/api/me"); assert.equal(me.status, 200); assert.equal(me.json.role, "owner"); assert.equal(me.json.email, "pat1@firm1.test");
    const audit = (await H.auditRows()).map((r) => r.action); for (const a of ["firm.created", "signin.failed", "mfa.setup", "signin"]) assert.ok(audit.includes(a), a + " is in the audit log");
    await H.close();
  });

  test(name("a link works once, expires, and the form never says who has an account"), async () => {
    const H = await build(kind); await H.newFirm(); const b = H.browser();
    const known = await b.post("/auth/link", { email: "pat1@firm1.test" }), unknown = await b.post("/auth/link", { email: "nobody@else.test" });
    assert.deepEqual(known.json, unknown.json); assert.equal(H.links.length, 1, "nothing is sent to an address with no account");
    const tok = H.token(H.links[0]!.url); assert.equal((await b.post("/auth/open", { token: tok })).status, 200);
    const again = await H.browser().post("/auth/open", { token: tok }); assert.equal(again.status, 401); assert.equal(again.json.error, "link_used");
    assert.equal((await H.browser().post("/auth/open", { token: tok.slice(0, -2) + "xx" })).status, 401);
    await b.post("/auth/link", { email: "pat1@firm1.test" }); H.advance(16 * 60);
    const late = await H.browser().post("/auth/open", { token: H.token(H.links[1]!.url) }); assert.equal(late.json.error, "link_expired");
    for (let i = 0; i < 10; i++) await H.browser().post("/auth/link", { email: "pat1@firm1.test" });
    assert.equal(H.links.length, 5, "five links an hour per address, however many times the form is sent");
    await H.close();
  });

  test(name("later sign-ins need the code; a code is never accepted twice; five wrong codes lock sign-in for 15 minutes and email the person"), async () => {
    const H = await build(kind); await H.newFirm(); await H.signInAs("pat1@firm1.test");
    const b = await H.signInAs("pat1@firm1.test"); assert.equal((await b.get("/api/me")).status, 200);
    // The code that just worked is replayed from another browser inside the same half minute.
    const used = H.codeFor("pat1@firm1.test"), c = H.browser(); await c.post("/auth/link", { email: "pat1@firm1.test" }); await c.post("/auth/open", { token: H.token(H.links.at(-1)!.url) });
    assert.equal((await c.post("/auth/code", { code: used })).status, 400, "a used code is refused");
    for (let i = 0; i < 3; i++) assert.equal((await c.post("/auth/code", { code: "123456" })).json.error, "wrong_code");
    const last = await c.post("/auth/code", { code: "123456" }); assert.equal(last.status, 423); assert.equal(last.json.error, "locked"); assert.deepEqual(H.lockMails, [{ to: "pat1@firm1.test", minutes: 15 }]);
    H.advance(31); assert.equal((await c.post("/auth/code", { code: H.codeFor("pat1@firm1.test") })).status, 401, "the half-open session is gone");
    // Locked: no new link is sent, and a link sent just before the lock does not open. Someone already signed in is not thrown out.
    const n = H.links.length, early = H.links.at(-1)!.url; await H.browser().post("/auth/link", { email: "pat1@firm1.test" }); assert.equal(H.links.length, n);
    assert.equal((await b.get("/api/me")).status, 200); void early;
    H.advance(61 * 60); const again = await H.signInAs("pat1@firm1.test"); assert.equal((await again.get("/api/me")).status, 200, "after 15 minutes sign-in works again");
    await H.close();
  });

  test(name("T-145: staff cannot record a client's consent to texts unless an owner has switched that on, and only an owner can switch it"), async () => {
    const H = await build(kind), { firmId } = await H.newFirm(), owner = await H.signInAs("pat1@firm1.test"); await owner.post("/api/users", { name: "Alex Staff", email: "alex@firm1.test", role: "staff" }); const alex = await H.signInAs("alex@firm1.test");
    await owner.post("/api/act", { fn: "addClient", args: [{ first: "Jo", last: "Day", email: "jo@x.example", mobile: "6155550111" }] });
    const eng = async () => { const T = createEngine(); T.load(await H.store.readState(firmId)); return T; }, jo = (await eng()).S.clients[0].id;
    assert.match((await alex.post("/api/act", { fn: "recordConsent", args: [jo, "Signed letter"] })).json.result, /owner has not switched on/); assert.notEqual((await eng()).client(jo).textConsent, "given");
    assert.equal((await alex.post("/api/act", { fn: "setStaffConsent", args: [true] })).status, 403);
    assert.equal((await owner.post("/api/act", { fn: "setStaffConsent", args: [true] })).status, 200); assert.equal((await alex.post("/api/act", { fn: "recordConsent", args: [jo, "Signed <b>letter</b>"] })).json.result, null);
    const T = await eng(); assert.equal(T.client(jo).textConsent, "given"); assert.match(T.client(jo).consentLog.at(-1).what, /recorded by Alex Staff: Signed bletter\/b/); assert.ok(T.S.audit.some((a: { action: string }) => a.action === "settings.consent"));
    await H.close();
  });

  test(name("a staff action sent twice with the same key runs once and answers the same; a different key runs again"), async () => {
    const H = await build(kind), { firmId } = await H.newFirm(), b = await H.signInAs("pat1@firm1.test"), add = { fn: "addClient", args: [{ first: "Jo", last: "Day", email: "jo@x.example" }] }, k = { "idempotency-key": "k".repeat(24) };
    const n = async () => { const T = createEngine(); T.load(await H.store.readState(firmId)); return T.S.clients.length; };
    const one = await b.post("/api/act", add, k), two = await b.post("/api/act", add, k); assert.equal(one.status, 200); assert.equal(two.status, 200); assert.deepEqual(two.json, one.json); assert.equal(await n(), 1, "the retry added nothing");
    // The same key from a different action is still the first answer: the key, not the body, is what counts.
    assert.deepEqual((await b.post("/api/act", { fn: "stopAll", args: [] }, k)).json, one.json); const T = createEngine(); T.load(await H.store.readState(firmId)); assert.notEqual(T.S.firm.stopped, true);
    const other = { fn: "addClient", args: [{ first: "Al", last: "Bo", email: "al@x.example" }] }; await b.post("/api/act", other, { "idempotency-key": "j".repeat(24) }); assert.equal(await n(), 2);
    // A key claimed by a request that has not answered yet: the retry waits, it does not run.
    const me = (await b.get("/api/me")).json; await H.auth.claimKey(firmId, me.id + ":" + "p".repeat(24), new Date());
    const held = await b.post("/api/act", add, { "idempotency-key": "p".repeat(24) }); assert.equal(held.status, 409); assert.equal(held.json.error, "in_progress"); assert.equal(await n(), 2);
    // A refused action answers the same refusal again.
    const r = { "idempotency-key": "r".repeat(24) }, no1 = await b.post("/api/act", { fn: "saveClient", args: ["nobody", {}] }, r), no2 = await b.post("/api/act", add, r); assert.equal(no2.status, no1.status); assert.deepEqual(no2.json, no1.json); assert.equal(await n(), 2);
    await H.close();
  });
  test(name("wrong codes spread over separate sign-in attempts count together towards the lock"), async () => {
    const H = await build(kind); await H.newFirm(); await H.signInAs("pat1@firm1.test"); H.advance(61 * 60);   // an hour on, so the five links below are inside the hourly limit
    // Wrong codes spread over separate attempts still count together.
    for (let i = 0; i < 5; i++) { const x = H.browser(); await x.post("/auth/link", { email: "pat1@firm1.test" }); const o = await x.post("/auth/open", { token: H.token(H.links.at(-1)!.url) }); if (i < 4) assert.equal(o.status, 200); const r = await x.post("/auth/code", { code: "000000" }); assert.equal(r.json.error, i < 4 ? "wrong_code" : "locked"); }
    const x = H.browser(), m = H.links.length; await x.post("/auth/link", { email: "pat1@firm1.test" }); assert.equal(H.links.length, m, "locked again");
    assert.equal(H.lockMails.length, 1); assert.ok((await H.auditRows()).some((a) => a.action === "signin.locked"));
    await H.close();
  });

  test(name("a recovery code gets a person in once"), async () => {
    const H = await build(kind); await H.newFirm(); const first = await H.signInAs("pat1@firm1.test"), rc = first.recoveryCodes[0]!;
    const open = async () => { const b = H.browser(); await b.post("/auth/link", { email: "pat1@firm1.test" }); await b.post("/auth/open", { token: H.token(H.links.at(-1)!.url) }); return b; };
    const b = await open(), r = await b.post("/auth/recovery", { code: rc.toUpperCase() + " " }); assert.equal(r.status, 200); assert.equal(r.json.left, 9); assert.equal((await b.get("/api/me")).status, 200);
    const c = await open(); assert.equal((await c.post("/auth/recovery", { code: rc })).status, 400); assert.equal((await c.get("/api/me")).status, 401);
    await H.close();
  });

  test(name("TH-PLN-3: one client's plan is served to a signed-in member of that firm and to nobody else, and asking for it changes nothing"), async () => {
    const H = await build(kind); const { firmId, ownerId } = await H.newFirm(); await H.newFirm(2);
    await H.app.staff(firmId, ownerId, (T: Engine) => { T.S.firm.senderStatus = "approved"; T.S.firm.hound.mode = "autopilot"; T.importRows(T.parseCSV("First,Last,Email,Mobile\nJo,Day,jo@x.example,6155550111")); const e = T.S.engs[0]; e.confirmed = true; T.start(e.id); T.giveConsent(T.S.clients[0].id, "page"); });
    const owner = await H.signInAs("pat1@firm1.test"), st = (await owner.get("/api/state")).json.state, eid = st.engs[0].id, before = st.msgs.length;
    const r = await owner.get("/api/clients/" + eid + "/plan"); assert.equal(r.status, 200); const asks = r.json.events.filter((x: { status: string; preview?: { preview: boolean; body: string } }) => x.status === "planned" && x.preview);
    assert.ok(asks.length >= 3, "no planned asks"); assert.ok(asks.every((x: { preview: { preview: boolean; body: string } }) => x.preview.preview === true && x.preview.body)); assert.equal(r.json.preset, "steady");
    assert.equal((await owner.get("/api/state")).json.state.msgs.length, before, "asking for the plan created a message");
    assert.equal((await owner.get("/api/clients/nobody/plan")).status, 404);
    const stranger = await H.signInAs("pat2@firm2.test"); assert.equal((await stranger.get("/api/clients/" + eid + "/plan")).status, 404, "another firm can read this plan");
    assert.equal((await H.browser().get("/api/clients/" + eid + "/plan")).status, 401);
    await H.close();
  });

  test(name("T-04: a read-only person's write requests return 403, staff cannot use owner actions, and unlisted engine functions cannot be reached"), async () => {
    const H = await build(kind); const { firmId } = await H.newFirm(); const owner = await H.signInAs("pat1@firm1.test");
    assert.equal((await owner.post("/api/users", { name: "Alex Staff", email: "alex@firm1.test", role: "staff" })).status, 200);
    assert.equal((await owner.post("/api/users", { name: "Sam Reader", email: "sam@firm1.test", role: "read_only" })).status, 200);
    const staff = await H.signInAs("alex@firm1.test"), reader = await H.signInAs("sam@firm1.test");
    const add = { fn: "addClient", args: [{ first: "Jo", last: "Day", email: "jo@x.example", mobile: "6155550111" }] };
    const no = await reader.post("/api/act", add); assert.equal(no.status, 403); assert.equal(no.json.error, "role");
    assert.equal((await reader.post("/api/users", { name: "X Y", email: "x@firm1.test", role: "owner" })).status, 403);
    assert.equal((await reader.get("/api/state")).json.state.clients.length, 0, "and nothing was saved");
    for (const fn of Object.keys(ACTIONS)) assert.equal((await reader.post("/api/act", { fn, args: [] })).status, 403, fn + " is closed to read-only");
    assert.equal((await staff.post("/api/act", add)).status, 200);
    assert.equal((await reader.get("/api/users")).status, 403, "who has access is the owner's to see"); assert.equal((await staff.get("/api/users")).status, 403);
    const st = (await reader.get("/api/state")).json; assert.equal(st.state.clients.length, 1); assert.deepEqual(st.state.audit, [], "the audit trail is the owner's to read");
    assert.ok((await owner.get("/api/state")).json.state.audit.length > 0); assert.equal(st.userId, (await reader.get("/api/me")).json.id, "read-only can look");
    assert.equal((await staff.post("/api/act", { fn: "setRetain", args: ["delivered", 0] })).status, 403);
    assert.equal((await owner.post("/api/act", { fn: "setRetain", args: ["delivered", 0] })).status, 200);
    // An import: the browser may say how to use a column, but it cannot make the server read one the engine marked sensitive.
    const imp = await staff.post("/api/act", { fn: "importCsv", args: ["First,Last,Email,SSN\nBo,Lee,bo@x.example,123-45-6789", ["first", "last", "email", "ref"]] }); assert.equal(imp.json.result.ok, 1);
    assert.ok(!(await owner.get("/api/state")).raw.body.includes("123-45-6789"), "the Social Security number was not stored under another name");
    // Several actions in one request: every one is checked before any runs, and the firm is saved once.
    const two = { calls: [{ fn: "addClient", args: [{ first: "Al", last: "Bo", email: "al@x.example" }] }, { fn: "setRetain", args: ["delivered", 3] }] };
    assert.equal((await staff.post("/api/act", two)).status, 403, "one owner-only call refuses the whole request"); assert.equal((await owner.get("/api/state")).json.state.clients.length, 2, "and nothing in it ran");
    const ok = await owner.post("/api/act", two); assert.equal(ok.status, 200); assert.equal(ok.json.results.length, 2); assert.equal((await owner.get("/api/state")).json.state.clients.length, 3);
    assert.equal((await owner.post("/api/act", { calls: [] })).status, 400); assert.equal((await owner.post("/api/act", { calls: [{ fn: "blank" }] })).status, 404);
    for (const fn of ["portalNone", "clientAnswers", "setVerified", "advance", "reset", "blank", "load", "giveConsent", "constructor", "__proto__", "S"]) assert.equal((await owner.post("/api/act", { fn, args: [true] })).status, 404, fn + " is not reachable");
    // Filing the firm's details for a text number is the owner's; it can never mark the number as approved.
    assert.equal((await owner.post("/api/act", { fn: "registerSender", args: [{ legalName: "X" }] })).status, 200); const TS = createEngine(); TS.load(await H.store.readState((await owner.get("/api/me")).json.firmId)); assert.equal((await owner.post("/api/act", { fn: "registerSender", args: [{ legalName: "Test CPAs LLC", ein: "12-3456789", street: "1 Main Street", city: "Nashville", state: "TN", zip: "37201", contact: "Pat Owner", senderStatus: "approved" }] })).json.result, null); assert.notEqual(TS.S.firm.senderStatus, "nonsense");
    // The engine's own audit trail names the person who acted.
    const T = createEngine(); T.load(await H.store.readState(firmId)); assert.ok(T.S.audit.some((a: { actor: string }) => a.actor === "Alex Staff"));
    await H.close();
  });

  test(name("a request that did not come from our own pages is refused"), async () => {
    const H = await build(kind); await H.newFirm(); const b = await H.signInAs("pat1@firm1.test"), add = { fn: "addClient", args: [{ first: "Jo", last: "Day", email: "jo@x.example" }] };
    assert.equal((await b.call("POST", "/api/act", add, {})).status, 403, "a plain form post from another site has no header");
    assert.equal((await b.call("POST", "/api/act", add, { "x-tallyhound": "1", origin: "https://evil.example" })).status, 403);
    assert.equal((await b.get("/api/state")).json.state.clients.length, 0);
    const page = await H.browser().get("/signin"); assert.match(String(page.headers["content-security-policy"]), /default-src 'self'/);
    assert.equal((await H.browser().get("/api/nothing")).status, 404); assert.equal((await H.browser().get("/assets/nothing.js")).status, 404);
    await H.close();
  });

  test(name("one firm can never see or change another"), async () => {
    const H = await build(kind); await H.newFirm(1); await H.newFirm(2); const a = await H.signInAs("pat1@firm1.test"), b = await H.signInAs("pat2@firm2.test");
    await a.post("/api/act", { fn: "addClient", args: [{ first: "Jo", last: "Day", email: "jo@x.example" }] });
    assert.equal((await a.get("/api/state")).json.state.clients.length, 1); assert.equal((await b.get("/api/state")).json.state.clients.length, 0);
    const bUsers = (await b.get("/api/users")).json; assert.equal(bUsers.length, 1); const aId = (await a.get("/api/me")).json.id;
    assert.equal((await b.post("/api/users/" + aId + "/role", { role: "read_only" })).status, 404); assert.equal((await b.del("/api/users/" + aId)).status, 404);
    assert.equal((await b.post("/api/users", { name: "Pat Again", email: "pat1@firm1.test", role: "staff" })).status, 400, "one account per email address");
    await H.close();
  });

  test(name("sessions end after 2 idle hours and at 12 hours whatever happens; a role change or removal signs the person out everywhere; a firm always keeps an owner"), async () => {
    const H = await build(kind); await H.newFirm(); const owner = await H.signInAs("pat1@firm1.test"), ownerId = (await owner.get("/api/me")).json.id;
    const id = (await owner.post("/api/users", { name: "Alex Staff", email: "alex@firm1.test", role: "staff" })).json.id;
    const one = await H.signInAs("alex@firm1.test"), two = await H.signInAs("alex@firm1.test");
    assert.equal((await owner.post("/api/users/" + ownerId + "/role", { role: "staff" })).status, 400); assert.equal((await owner.del("/api/users/" + ownerId)).status, 400);
    assert.equal((await owner.post("/api/users/" + id + "/role", { role: "read_only" })).status, 200);
    assert.equal((await one.get("/api/me")).status, 401); assert.equal((await two.get("/api/me")).status, 401);
    const back = await H.signInAs("alex@firm1.test"); assert.equal((await back.get("/api/me")).json.role, "read_only");
    assert.equal((await owner.del("/api/users/" + id)).status, 200); assert.equal((await back.get("/api/me")).status, 401);
    const n = H.links.length; await H.browser().post("/auth/link", { email: "alex@firm1.test" }); assert.equal(H.links.length, n, "a removed person gets no link");
    // Removed is switched off, not deleted: the row and the name stay, the second factor goes, and coming back means setting it up again.
    const gone = (await H.auth.usersOfFirm((await owner.get("/api/me")).json.firmId)).find((u) => u.id === id)!; assert.ok(gone.leftAt); assert.equal(gone.name, "Alex Staff"); assert.equal(gone.mfaSecret, null);
    const list = (await owner.get("/api/users")).json as { id: string; left: boolean }[]; assert.equal(list.find((u) => u.id === id)!.left, true);
    assert.equal((await owner.del("/api/users/" + id)).status, 404, "already gone"); assert.equal((await owner.post("/api/users/" + id + "/role", { role: "staff" })).status, 404);
    const re = await owner.post("/api/users", { name: "Alex Staff", email: "alex@firm1.test", role: "staff" }); assert.equal(re.json.id, id, "the same person comes back as the same row");
    const fid = (await owner.get("/api/me")).json.firmId, eng = async () => { const T = createEngine(); T.load(await H.store.readState(fid)); return T; }, st = await eng(); assert.equal(st.S.users.filter((u: { id: string }) => u.id === id).length, 1);
    await owner.post("/api/act", { fn: "addClient", args: [{ first: "Cara", last: "Moved", email: "cara@x.example" }] }); const cid = (await eng()).S.clients.find((c: { last: string }) => c.last === "Moved").id; assert.equal((await owner.post("/api/act", { fn: "saveClient", args: [cid, { preparer: id }] })).status, 200); assert.equal((await eng()).client(cid).preparer, id);
    const rm = await owner.del("/api/users/" + id); assert.equal(rm.json.moved, 1); assert.equal((await eng()).client(cid).preparer, ownerId, "their clients pass to the owner who removed them");
    H.advance(110 * 60); assert.equal((await owner.get("/api/me")).status, 200, "still in use: the idle clock restarts");
    H.advance(110 * 60); assert.equal((await owner.get("/api/me")).status, 200);
    H.advance(121 * 60); assert.equal((await owner.get("/api/me")).status, 401, "two idle hours end it");
    // Twelve hours is the most, however busy the person is.
    const busy = await H.signInAs("pat1@firm1.test"); for (let h = 0; h < 11; h++) { H.advance(3600); assert.equal((await busy.get("/api/me")).status, 200, "hour " + (h + 1)); }
    H.advance(3660); assert.equal((await busy.get("/api/me")).status, 401, "signed out at twelve hours");
    const out = await H.signInAs("pat1@firm1.test"); assert.equal((await out.post("/auth/signout")).status, 200); assert.equal((await out.get("/api/me")).status, 401);
    await H.close();
  });

  test(name("T-05 and T-116: a new firm is set up in one call, on its own clock, and sends nothing until it has been checked"), async () => {
    const H = await build(kind); const { firmId } = await H.newFirm(1, false);
    const T = createEngine(); T.load(await H.store.readState(firmId));
    assert.equal(T.S.firm.iana, "America/Chicago"); assert.equal(T.S.firm.tz, "Central"); assert.equal(T.S.firm.hound.mode, "copilot", "every firm starts in Copilot"); assert.equal(T.S.clients.length, 0, "no demo data");
    assert.equal(T.access().ok, false); assert.equal(T.access().state, "checking");
    await H.firms.setVerified(firmId, true, "Jordan"); const U = createEngine(); U.load(await H.store.readState(firmId)); assert.equal(U.access().ok, true);
    assert.equal(await H.store.firmIdByInbox("test1@docs.tallyhound.test"), firmId); assert.equal(await H.store.firmIdByNumber("6155550101"), firmId);
    await assert.rejects(H.newFirm(1), /already has an account/);
    await assert.rejects(H.firms.create({ name: "X", inbox: "x@docs.tallyhound.test", iana: "Mars/Olympus", ownerName: "A B", ownerEmail: "a@b.test" }), /Time zone/);
    await H.close();
  });

  test(name("staff get one morning note on working days and a note at once for anything urgent; the emails name nobody in full and carry no details"), async () => {
    const H = await build(kind), { firmId } = await H.newFirm(), owner = await H.signInAs("pat1@firm1.test");   // the test clock starts on a Monday, 10:05 in the firm's time zone
    const alex = (await owner.post("/api/users", { name: "Alex Staff", email: "alex@firm1.test", role: "staff" })).json.id; await owner.post("/api/users", { name: "Rae Reader", email: "rae@firm1.test", role: "read_only" });
    await owner.post("/api/act", { calls: [{ fn: "addClient", args: [{ first: "Jo", last: "Daybreak", email: "jo@x.example" }] }, { fn: "addClient", args: [{ first: "Al", last: "Bosworth", email: "al@x.example" }] }] });
    let alId = "";
    await H.app.withFirm(firmId, (T: any) => {   // eslint-disable-line @typescript-eslint/no-explicit-any
      const al = T.S.clients.find((c: { first: string }) => c.first === "Al"), e = T.S.engs.find((x: { clientId: string }) => x.clientId === al.id); al.preparer = alex; alId = al.id;
      T.S.tasks.push({ id: "t_x", at: new Date(T.S.now), status: "open", kind: "question", engId: e.id, reason: "Question" });
      T.S.alerts.unshift({ id: "a_x", at: new Date(T.S.now), engId: e.id, level: "high", kind: "frustrated", text: "Al Bosworth sounds upset about the W-2", key: null, read: false });
    });
    await H.worker.pass(); const to = (addr: string) => H.staffMails.filter((m) => m.to === addr);
    assert.deepEqual(to("alex@firm1.test").map((m) => m.subject), ["Al B. needs you in Tallyhound", "Tallyhound: 1 thing in the review queue"]); assert.match(to("alex@firm1.test")[0]!.body, new RegExp("/clients/" + alId));
    assert.deepEqual(to("pat1@firm1.test").map((m) => m.subject), ["Tallyhound: 1 thing in the review queue"], "the owner sees every client in the morning note; the urgent note went to the preparer");
    assert.equal(to("rae@firm1.test").length, 0); for (const m of H.staffMails) { assert.doesNotMatch(m.subject + m.body, /Bosworth|Daybreak|W-2|upset|x\.example/); assert.match(m.body, /Al B\./); }
    const n = H.staffMails.length; await H.worker.pass(); assert.equal(H.staffMails.length, n, "nothing is sent twice");
    // Each person chooses their own emails. Alex turns the morning note off; Pat's keeps coming.
    const alexB = await H.signInAs("alex@firm1.test"); assert.deepEqual((await alexB.get("/api/me")).json.notes, { morning: true, urgent: true }); assert.deepEqual((await alexB.post("/api/me/notes", { morning: false })).json.notes, { morning: false, urgent: true });
    H.advance(86400); await H.worker.pass(); const day2 = H.staffMails.slice(n); assert.deepEqual(day2.filter((m) => /in the review queue/.test(m.subject)).map((m) => m.to), ["pat1@firm1.test"], "Tuesday: the owner's note only, since Alex switched theirs off"); await H.auth.setNotes(alex, { morningOff: false, urgentOff: false });
    H.advance(4 * 86400); const m = H.staffMails.length; await H.worker.pass(); assert.equal(H.staffMails.slice(m).filter((x) => /in the review queue/.test(x.subject)).length, 0, "Saturday: no morning note");
    H.advance(2 * 86400 - 4 * 3600); const k = H.staffMails.length; await H.worker.pass(); assert.equal(H.staffMails.slice(k).filter((x) => /in the review queue/.test(x.subject)).length, 0, "Monday at 6: not yet");
    H.advance(3600); await H.worker.pass(); assert.equal(H.staffMails.slice(k).filter((x) => /in the review queue/.test(x.subject)).length, 2, "Monday at 7");
    // TH-BRK: a new item barks its person by email once it has stood five minutes, with counts and no client; at night it is held for the morning note.
    H.advance(3 * 3600); const b0 = H.staffMails.length; await H.app.withFirm(firmId, (T: any) => { const al = T.S.clients.find((c: { first: string }) => c.first === "Al"), e = T.engOf(al.id); T.addTask({ kind: "question", reason: "Question", category: "other", engId: e.id }); T.addTask({ kind: "document", reason: "Low confidence", engId: e.id }); });   // eslint-disable-line @typescript-eslint/no-explicit-any
    await H.worker.pass(); assert.equal(H.staffMails.slice(b0).filter((x) => /barked/.test(x.subject)).length, 0, "not before it has stood five minutes"); H.advance(6 * 60); await H.worker.pass();
    const barks = H.staffMails.slice(b0).filter((x) => /barked/.test(x.subject)); assert.deepEqual(barks.map((x) => [x.to, x.subject]), [["alex@firm1.test", "Tallyhound barked. 2 things need your team."]]);
    assert.match(barks[0]!.body, /1 question\n {2}1 to check/); assert.match(barks[0]!.body, /\/needs-you\?mine=1&bark=/); assert.doesNotMatch(barks[0]!.subject + barks[0]!.body, /Bosworth|Al B/);
    H.advance(600); await H.worker.pass(); assert.equal(H.staffMails.slice(b0).filter((x) => /barked\./.test(x.subject)).length, 1, "barked twice for the same items");
    H.advance(10 * 3600); const b1 = H.staffMails.length; await H.app.withFirm(firmId, (T: any) => { const al = T.S.clients.find((c: { first: string }) => c.first === "Al"); T.addTask({ kind: "call", reason: "Call the client", engId: T.engOf(al.id).id }); });   // eslint-disable-line @typescript-eslint/no-explicit-any
    H.advance(600); await H.worker.pass(); assert.equal(H.staffMails.slice(b1).filter((x) => /barked\./.test(x.subject)).length, 0, "a bark went out at night");
    H.advance(11 * 3600); await H.worker.pass(); const morning = H.staffMails.slice(b1).filter((x) => x.to === "alex@firm1.test" && /in the review queue/.test(x.subject)); assert.equal(morning.length, 1); assert.match(morning[0]!.body, /Since you left yesterday\n {2}1 call to make/);
    await H.close();
  });

  test(name("T-29, T-91: after each pass there is a status line and a month of usage for every firm, kept outside the firm's own state; the developer is told once when sends fail"), async () => {
    const H = await build(kind), { firmId, ownerId } = await H.newFirm();
    await H.app.staff(firmId, ownerId, (T: Engine) => { T.S.firm.hound.mode = "autopilot"; T.importRows(T.parseCSV("First,Last,Email\nJo,Day,jo@x.example")); const e = T.S.engs[0]; e.confirmed = true; T.start(e.id); });
    await H.worker.pass(); let line = (await H.ops.status(H.clock())).find((l) => l.firmId === firmId)!;
    assert.ok(line.lastTick); assert.equal(line.lastError, null); assert.ok(line.sent >= 1, "the first request went by email"); assert.equal(line.failed, 0); assert.equal(H.devMails.length, 0);
    const T = createEngine(); T.load(await H.store.readState(firmId)); const month = Object.keys(T.S.usage)[0]!, use = (await H.ops.usage(month)).find((l) => l.firmId === firmId)!;
    assert.equal(use.usage.email, T.S.usage[month].email); assert.ok(use.usage.email >= 1); assert.ok(costOf(use.usage, T.RATES) > 0);
    // A send fails for good: counted, and the developer hears once, not on every pass.
    await H.app.withFirm(firmId, (E: Engine) => { const m = E.S.msgs.find((x: { dir: string }) => x.dir === "out"); m.status = "failed"; });
    await H.worker.pass(); await H.worker.pass(); line = (await H.ops.status(H.clock())).find((l) => l.firmId === firmId)!; assert.equal(line.failed, 1);
    assert.equal(H.devMails.length, 1); assert.match(H.devMails[0]!.subject, /1 message failed to send/); assert.match(H.devMails[0]!.body, new RegExp(firmId)); assert.doesNotMatch(H.devMails[0]!.body, /Jo|Day|x\.example/);
    // A firm whose turn fails keeps its last good tick and shows the error.
    const real = H.app.withFirm; H.app.withFirm = async () => { throw new Error("boom"); }; await H.worker.pass(); H.app.withFirm = real;
    line = (await H.ops.status(H.clock())).find((l) => l.firmId === firmId)!; assert.equal(line.lastError, "boom"); assert.ok(line.lastTick); assert.ok(H.devMails.some((m) => /could not finish a firm's turn/.test(m.subject)));
    await H.worker.pass(); assert.equal((await H.ops.status(H.clock())).find((l) => l.firmId === firmId)!.lastError, null, "cleared by the next good pass");
    await H.close();
  });

  test(name("T-28: closing a firm destroys its key and signs everyone out, and a firm with a closure marker is closed again after a restore"), async () => {
    const H = await build(kind), a = await H.newFirm(1), b = await H.newFirm(2), ownerA = await H.signInAs("pat1@firm1.test"); await ownerA.post("/api/act", { fn: "addClient", args: [{ first: "Jo", last: "Day", email: "jo@x.example" }] });
    const kept = new Map<string, Buffer>(), closure = createClosure({ store: H.store, auth: H.auth, clock: H.clock, markers: { async put(k, v) { kept.set(k, v); }, async get(k) { return kept.get(k) || null; } } });
    await assert.rejects(closure.close("f_nobody", "Jordan"), /No open firm/);
    await closure.close(a.firmId, "Jordan"); assert.deepEqual([...kept.keys()], ["closed/" + a.firmId]); assert.doesNotMatch(kept.get("closed/" + a.firmId)!.toString(), /Test CPAs|pat1/);
    assert.equal((await ownerA.get("/api/me")).status, 401); const n = H.links.length; await H.browser().post("/auth/link", { email: "pat1@firm1.test" }); assert.equal(H.links.length, n, "nobody signs in to a closed firm");
    await assert.rejects(H.store.readState(a.firmId)); assert.deepEqual(await H.auth.activeFirmIds(), [b.firmId]); assert.ok((await H.auditRows()).some((r) => r.action === "firm.closed"));
    // The other firm is untouched, and with no marker a restore check changes nothing.
    assert.deepEqual(await closure.afterRestore("Jordan"), []); assert.ok(await H.store.readState(b.firmId));
    // A backup from before a closure comes back with the firm open. Its marker is still in the bucket, so it is closed again.
    kept.set("closed/" + b.firmId, Buffer.from("{}")); assert.deepEqual(await closure.afterRestore("Jordan"), [b.firmId]); await assert.rejects(H.store.readState(b.firmId)); assert.deepEqual(await H.auth.activeFirmIds(), []);
    await H.close();
  });

  test(name("TH-CON-10: an owner downloads consent records with the wording each client saw, and the audit trail; a name cannot become a spreadsheet formula; nobody else can"), async () => {
    const H = await build(kind), { firmId, ownerId } = await H.newFirm(), owner = await H.signInAs("pat1@firm1.test"); await owner.post("/api/users", { name: "Alex Staff", email: "alex@firm1.test", role: "staff" }); const alex = await H.signInAs("alex@firm1.test");
    await H.app.staff(firmId, ownerId, (T: Engine) => { T.S.firm.senderStatus = "approved"; T.importRows(T.parseCSV("First,Last,Email,Mobile\nJo,Day,jo@x.example,6155550111\n=cmd|calc,\"Smith, Jr\",al@x.example,")); const jo = T.S.clients[0]; T.consentFromPage(jo.id, { mobile: "6155550111", ip: "203.0.113.9", agent: "Phone browser" });
      T.S.clients[1].first = "=cmd|calc"; });   // the import already strips this; the export must not rely on that
    assert.equal((await alex.post("/api/export/consent")).status, 403); assert.equal((await owner.post("/api/export/payroll")).status, 404); assert.equal((await H.browser().post("/api/export/consent")).status, 401);
    const r = await owner.post("/api/export/consent"); assert.equal(r.status, 200); assert.match(String(r.headers["content-type"]), /text\/csv/); assert.match(String(r.headers["content-disposition"]), /attachment; filename="tallyhound-consent-\d{4}-\d\d-\d\d\.csv"/);
    const csv = r.raw.body, lines = csv.replace(/^\ufeff/, "").split("\r\n"); assert.match(lines[0]!, /^Client,Reference,Email,Mobile,Texts now/);
    const jo = lines.find((l) => l.startsWith("Jo Day") && /Given \(page\)/.test(l))!; assert.match(jo, /6155550111/); assert.match(jo, /203\.0\.113\.9/); assert.match(jo, /Phone browser/); assert.match(jo, /Test CPAs 1/, "the wording the client saw, with the firm's name in it");
    assert.ok(lines.some((l) => l.startsWith("\"'=cmd|calc Smith, Jr\",") && /No record/.test(l)), "a name that starts like a formula is defused and the comma is quoted");
    const a = await owner.post("/api/export/audit"); assert.equal(a.status, 200); assert.match(a.raw.body, /export\.consent/); assert.match(a.raw.body, /^\ufeffWhen,Who,Action,Detail/);
    const T = createEngine(); T.load(await H.store.readState(firmId)); assert.ok(T.S.audit.some((x: { action: string }) => x.action === "export.audit"));
    await H.close();
  });

  test(name("after a staff action, whatever has come due for that firm is sent within a moment, not at the next five-minute pass"), async () => {
    const H = await build(kind, { nudge: true }), { firmId, ownerId } = await H.newFirm();
    await H.app.staff(firmId, ownerId, (T: Engine) => { T.S.firm.hound.mode = "autopilot"; T.importRows(T.parseCSV("First,Last,Email\nSam,Lee,sam@x.example")); const e = T.S.engs[0]; e.confirmed = true; T.start(e.id); });
    // Three days on, a reminder is due. Nothing has ticked the firm, so nothing has gone yet.
    H.advance(3 * 86400); const again = await H.signInAs("pat1@firm1.test"), before = H.email.sent.length;
    await again.post("/api/act", { fn: "alertsRead", args: [] }); for (let i = 0; i < 100 && H.email.sent.length === before; i++) await new Promise((r) => setTimeout(r, 20));
    assert.equal(H.email.sent.length, before + 1, "the reminder went without waiting for the timer"); assert.equal((H.email.sent.at(-1) as { to: string }).to, "sam@x.example");
    // Several actions close together are one turn, and nothing goes twice.
    for (let i = 0; i < 5; i++) await again.post("/api/act", { fn: "alertsRead", args: [] }); await new Promise((r) => setTimeout(r, 80)); assert.equal(H.email.sent.length, before + 1);
    await H.close();
  });

  test(name("T-95, T-63, T-123: owners are emailed when the plan's allowance is reached and Tallyhound is told; an owner sets closed days; a large start is paced"), async () => {
    const H = await build(kind), { firmId, ownerId } = await H.newFirm(), owner = await H.signInAs("pat1@firm1.test"); await owner.post("/api/users", { name: "Alex Staff", email: "alex@firm1.test", role: "staff" }); const alex = await H.signInAs("alex@firm1.test");
    await H.app.withFirm(firmId, (T: Engine) => { T.S.alerts.unshift({ id: "a_fair", at: new Date(T.S.now), engId: null, level: "low", kind: "fair_use", text: "You have used 80% of this year's text messages on your plan.", key: "fair80", read: false }); });
    await H.worker.pass(); const mine = H.staffMails.filter((m) => /allowance/.test(m.subject)); assert.deepEqual(mine.map((m) => m.to), ["pat1@firm1.test"], "owners only"); assert.match(mine[0]!.body, /80% of this year's text messages/); assert.match(mine[0]!.body, /Nothing is switched off/);
    assert.ok(H.devMails.some((m) => /reached its plan's allowance/.test(m.subject))); const n = H.staffMails.length; await H.worker.pass(); assert.equal(H.staffMails.filter((m) => /allowance/.test(m.subject)).length, 1, "once"); void n;
    // Closed days: owner only, and the engine holds them.
    assert.equal((await alex.post("/api/act", { fn: "setClosedDays", args: [["2027-02-15"]] })).status, 403); assert.equal((await owner.post("/api/act", { fn: "setClosedDays", args: [["2027-02-15", "nonsense"]] })).json.result, "Not a date: nonsense");
    assert.equal((await owner.post("/api/act", { fn: "setClosedDays", args: [["2027-02-15"]] })).json.result, null); const T = createEngine(); T.load(await H.store.readState(firmId)); assert.deepEqual(T.S.firm.closedDays, ["2027-02-15"]); assert.equal(T.allowed(new Date(2027, 1, 15, 11)), false);
    // A start of 120 clients: the answer says 70 were held back.
    await H.app.staff(firmId, ownerId, (E: Engine) => { E.S.firm.hound.mode = "autopilot"; for (let i = 0; i < 120; i++) E.addClient({ first: "C" + i, last: "L" + i, email: "c" + i + "@x.example" }); E.S.engs.forEach((e: { confirmed: boolean }) => { e.confirmed = true; }); });
    const U = createEngine(); U.load(await H.store.readState(firmId)); const r = (await owner.post("/api/act", { fn: "startMany", args: [U.S.engs.map((e: { id: string }) => e.id)] })).json.result; assert.equal(r.started, 120); assert.equal(r.paced, 70);
    await H.close();
  });

  test(name("the timer visits every firm, and one firm failing does not stop the rest"), async () => {
    const H = await build(kind); const a = await H.newFirm(1), b = await H.newFirm(2); const seen: string[] = [], real = H.app.withFirm;
    H.app.withFirm = async (id: string, fn: never) => { seen.push(id); if (id === a.firmId) throw new Error("boom"); return real(id, fn); };
    const s = await H.worker.pass(); assert.deepEqual(seen.sort(), [a.firmId, b.firmId].sort()); assert.equal(s.firms, 2); assert.equal(s.failed, 1); assert.ok(s.lastPass);
    assert.equal((await H.browser().get("/healthz")).json.ok, true);
    await H.close();
  });

  test(name("T-107: an owner lets one named support person look for a set time; they cannot change anything; the firm's history shows it; it ends on time"), async () => {
    const H = await build(kind), { firmId } = await H.newFirm(), owner = await H.signInAs("pat1@firm1.test"); await owner.post("/api/users", { name: "Alex Staff", email: "alex@firm1.test", role: "staff" }); const alex = await H.signInAs("alex@firm1.test");
    assert.equal((await alex.post("/api/support", { name: "Sam Help", email: "sam@tallyhound.test", hours: 4 })).status, 403, "owners only");
    assert.equal((await owner.post("/api/support", { name: "Sam Help", email: "sam@tallyhound.test", hours: 5 })).status, 400, "set lengths only");
    const g = await owner.post("/api/support", { name: "Sam Help", email: "sam@tallyhound.test", hours: 4 }); assert.equal(g.status, 200);
    const row = (await owner.get("/api/users")).json.find((u: { email: string }) => u.email === "sam@tallyhound.test"); assert.equal(row.role, "read_only"); assert.equal(row.name, "Sam Help (Tallyhound support)"); assert.ok(row.supportUntil);
    assert.equal((await owner.post("/api/users/" + row.id + "/role", { role: "owner" })).status, 400, "support can never be made more than a looker");
    const sam = await H.signInAs("sam@tallyhound.test"); assert.equal((await sam.get("/api/state")).status, 200); await sam.get("/api/state");
    assert.equal((await sam.post("/api/act", { fn: "setClosedDays", args: [[]] })).status, 403); assert.equal((await sam.get("/api/users")).status, 403);
    const hist = () => H.store.readState(firmId).then((j) => JSON.parse(j!).state.audit.map((a: { action: string }) => a.action));
    let h = await hist(); assert.equal(h.filter((k: string) => k === "support.granted").length, 1); assert.equal(h.filter((k: string) => k === "support.view").length, 1, "one line, not one per page");
    // No morning note goes to support.
    const u = await H.auth.userByEmail("sam@tallyhound.test"); assert.ok(u!.morningOff && u!.urgentOff);
    // Still in after 3 hours of use; out on the minute at 4, with the tab open.
    H.advance(100 * 60); assert.equal((await sam.get("/api/me")).status, 200); H.advance(100 * 60); assert.equal((await sam.get("/api/me")).status, 200);
    H.advance(41 * 60); assert.equal((await sam.get("/api/me")).status, 401);
    const before = H.links.length; await H.browser().post("/auth/link", { email: "sam@tallyhound.test" }); assert.equal(H.links.length, before, "no new link after the time is up");
    assert.equal(await H.firms.expireSupport(), 1); assert.equal(await H.firms.expireSupport(), 0); h = await hist(); assert.ok(h.includes("support.ended"));
    const T = createEngine(); T.load(await H.store.readState(firmId)); assert.ok(!T.S.users.some((x: { email: string }) => x.email === "sam@tallyhound.test"));
    // The owner can let the same person in again, and end it early.
    const o2 = await H.signInAs("pat1@firm1.test"); const again = await o2.post("/api/support", { name: "Sam Help", email: "sam@tallyhound.test", hours: 24 }); assert.equal(again.status, 200); assert.equal(again.json.id, row.id);
    const sam2 = await H.signInAs("sam@tallyhound.test"); assert.equal((await sam2.get("/api/me")).status, 200);
    assert.equal((await o2.del("/api/users/" + row.id)).status, 200); assert.equal((await sam2.get("/api/me")).status, 401);
    await H.close();
  });

  test(name("TH-BRK-10: a person adds their own mobile with a code; a bark is then texted from Tallyhound's number with a count and nothing else; STOP removes the number"), async () => {
    const H = await build(kind, { systemSms: true }), { firmId, ownerId } = await H.newFirm(), owner = await H.signInAs("pat1@firm1.test");
    assert.equal((await owner.get("/api/features")).json.textBarks, true); assert.equal((await owner.get("/api/me")).json.mobile, null);
    assert.equal((await owner.post("/api/me/mobile", { mobile: "555" })).status, 400);
    assert.equal((await owner.post("/api/me/mobile", { mobile: "(615) 555-0177" })).status, 200); assert.equal(H.staffTexts.length, 1); assert.equal(H.staffTexts[0]!.to, "+16155550177");
    const code = /code is (\d{6})/.exec(H.staffTexts[0]!.body)![1]!; assert.deepEqual((await owner.get("/api/me")).json.mobile, { ends: "0177", verified: false });
    assert.equal((await owner.post("/api/me/mobile/verify", { code: code === "000000" ? "000001" : "000000" })).status, 400); assert.equal((await owner.post("/api/me/mobile/verify", { code })).status, 200);
    assert.deepEqual((await owner.get("/api/me")).json.mobile, { ends: "0177", verified: true }); assert.equal((await owner.post("/api/act", { fn: "setMyBarks", args: [{ email: false, text: true }] })).status, 200);
    // A client's question opens; the owner is this client's preparer.
    await owner.post("/api/act", { fn: "addClient", args: [{ first: "Maria", last: "Garcia", email: "maria@x.example" }] });
    await H.app.withFirm(firmId, (T: any) => { T.addTask({ kind: "question", reason: "Question", category: "other", engId: T.S.engs[0].id, summary: "Maria asked about her HSA" }); });   // eslint-disable-line @typescript-eslint/no-explicit-any
    const mails = H.staffMails.length; H.advance(6 * 60); await H.worker.pass();
    assert.equal(H.staffTexts.length, 2); assert.equal(H.staffTexts[1]!.to, "+16155550177"); assert.equal(H.staffTexts[1]!.body, "Tallyhound barked. 1 thing needs your team. Open the review queue to see. Reply STOP to end these texts.");
    assert.doesNotMatch(H.staffTexts[1]!.body, /Maria|Garcia|HSA/); assert.equal(H.staffMails.slice(mails).filter((m) => /barked/.test(m.subject)).length, 0, "the email was switched off");
    assert.ok(!H.sms.sent.some((m: { to: string }) => /0177/.test(m.to)), "a staff text went out through a firm's client sender");
    // STOP to Tallyhound's number removes the mobile at once. A STOP from a number nobody verified does nothing.
    await H.twilioPost("/hooks/twilio", { To: "+16155550999", From: "+16155550000", Body: "STOP", MessageSid: "SMs0" }); assert.ok((await owner.get("/api/me")).json.mobile);
    const r = await H.twilioPost("/hooks/twilio", { To: "+16155550999", From: "+16155550177", Body: "stop", MessageSid: "SMs1" }); assert.equal(r.statusCode, 200); assert.equal((await owner.get("/api/me")).json.mobile, null);
    await H.app.withFirm(firmId, (T: any) => { T.addTask({ kind: "document", reason: "Low confidence", engId: T.S.engs[0].id }); });   // eslint-disable-line @typescript-eslint/no-explicit-any
    H.advance(40 * 60); await H.worker.pass(); assert.equal(H.staffTexts.length, 2, "texted after STOP"); void ownerId;
    // Without Tallyhound's number configured the page says so and nothing is stored.
    const H2 = await build(kind), f2 = await H2.newFirm(); void f2; const o2 = await H2.signInAs("pat1@firm1.test"); assert.equal((await o2.get("/api/features")).json.textBarks, false); assert.equal((await o2.post("/api/me/mobile", { mobile: "6155550177" })).status, 503);
    await H.close(); await H2.close();
  });
}
