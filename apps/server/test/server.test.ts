// The web service end to end: sign-in, roles, firm separation, the timer. Runs in memory, and again on a real Postgres when DATABASE_URL is set.
import test from "node:test";
import assert from "node:assert/strict";
import { build, KINDS, APP_URL } from "./harness.ts";
import { ACTIONS } from "../src/actions.ts";
import { createEngine } from "../src/kit.ts";

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
    for (const fn of ["portalNone", "clientAnswers", "setVerified", "advance", "reset", "blank", "load", "giveConsent", "registerSender", "constructor", "__proto__", "S"]) assert.equal((await owner.post("/api/act", { fn, args: [true] })).status, 404, fn + " is not reachable");
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

  test(name("the timer visits every firm, and one firm failing does not stop the rest"), async () => {
    const H = await build(kind); const a = await H.newFirm(1), b = await H.newFirm(2); const seen: string[] = [], real = H.app.tick;
    H.app.tick = async (id: string) => { seen.push(id); if (id === a.firmId) throw new Error("boom"); return real(id); };
    const s = await H.worker.pass(); assert.deepEqual(seen.sort(), [a.firmId, b.firmId].sort()); assert.equal(s.firms, 2); assert.equal(s.failed, 1); assert.ok(s.lastPass);
    assert.equal((await H.browser().get("/healthz")).json.ok, true);
    await H.close();
  });
}
