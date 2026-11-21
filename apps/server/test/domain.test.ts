// Sending from a firm's own domain (T-110), against a stand-in for the mail service's Domains API.
import test from "node:test";
import assert from "node:assert/strict";
import { build, KINDS } from "./harness.ts";
import { createEngine, type Engine } from "../src/kit.ts";

/* eslint-disable @typescript-eslint/no-explicit-any */
function mailService() {
  const M = { domains: new Map<number, any>(), n: 0, dns: { dkim: false, rp: false, dmarc: false }, calls: [] as string[] };
  const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { "content-type": "application/json" } });
  const view = (x: any) => ({ ID: x.ID, Name: x.Name, DKIMVerified: x.dkim, DKIMPendingHost: x.dkim ? "" : "20270125pm._domainkey." + x.Name, DKIMPendingTextValue: x.dkim ? "" : "k=rsa; p=MIGfMA0", DKIMHost: x.dkim ? "20270125pm._domainkey." + x.Name : "", DKIMTextValue: x.dkim ? "k=rsa; p=MIGfMA0" : "", ReturnPathDomain: "pm-bounces." + x.Name, ReturnPathDomainCNAMEValue: "pm.mtasv.net", ReturnPathDomainVerified: x.rp });
  const f = (async (url: unknown, init: RequestInit = {}) => { const u = new URL(String(url)), m = init.method || "GET"; M.calls.push(m + " " + u.pathname); if (new Headers(init.headers).get("x-postmark-account-token") !== "acct-token") return json({ Message: "bad token" }, 401);
    if (u.pathname === "/domains" && m === "POST") { const b = JSON.parse(String(init.body)); if ([...M.domains.values()].some((x) => x.Name === b.Name)) return json({ ErrorCode: 505, Message: "exists" }, 422); const x = { ID: ++M.n, Name: b.Name, dkim: false, rp: false }; M.domains.set(x.ID, x); return json(view(x)); }
    const one = /^\/domains\/(\d+)(\/verifyDkim|\/verifyReturnPath)?$/.exec(u.pathname), x = one && M.domains.get(+one[1]!); if (!x) return json({ Message: "not found" }, 404);
    if (m === "DELETE") { M.domains.delete(x.ID); return json({}); } if (one![2] === "/verifyDkim") x.dkim = M.dns.dkim; if (one![2] === "/verifyReturnPath") x.rp = M.dns.rp; return json(view(x)); }) as unknown as typeof fetch;
  return Object.assign(M, { f, txt: async (host: string) => (M.dns.dmarc && host.startsWith("_dmarc.") ? [["v=DMARC1; p=none;"]] : []) });
}
for (const kind of KINDS) {
  test("domain (" + kind + "): an owner adds the firm's domain, gets three records, and mail comes from the firm's own address only after the records are found; replies and bounces still come to Tallyhound", async () => {
    const M = mailService(), H = await build(kind, { postmarkAccount: M.f, dnsTxt: M.txt }), { firmId, ownerId } = await H.newFirm(), owner = await H.signInAs("pat1@firm1.test"); await owner.post("/api/users", { name: "Alex Staff", email: "alex@firm1.test", role: "staff" }); const alex = await H.signInAs("alex@firm1.test");
    await H.app.staff(firmId, ownerId, (T: Engine) => { T.S.firm.hound.mode = "autopilot"; T.importRows(T.parseCSV("First,Last,Email\nJo,Day,jo@x.example\nSam,Lee,sam@x.example")); T.S.engs[0].confirmed = true; T.start(T.S.engs[0].id); }); await H.worker.pass();
    const state = async () => { const T = createEngine(); T.load(await H.store.readState(firmId)); return T; }, first = H.email.sent.at(-1) as any; assert.equal(first.from, "test1@docs.tallyhound.test"); assert.equal(first.replyTo, "test1@docs.tallyhound.test");
    assert.deepEqual((await owner.get("/api/domain")).json, { domain: null }); assert.equal((await alex.post("/api/domain", { name: "larkinpoe.example" })).status, 403);
    for (const [bad, why] of [["gmail.com", /not a domain your firm controls/], ["not a domain", /like maplepine\.com/], ["docs.tallyhound.com", /not a domain your firm controls/]] as [string, RegExp][]) { const r = await owner.post("/api/domain", { name: bad }); assert.equal(r.status, 400); assert.match(r.json.message, why); }
    assert.equal((await owner.post("/api/domain", { name: "larkinpoe.example", local: "bad address!" })).status, 400);
    const made = (await owner.post("/api/domain", { name: "https://www.LarkinPoe.example/contact", local: "Documents" })).json.domain; assert.equal(made.name, "larkinpoe.example"); assert.equal(made.from, "documents@larkinpoe.example"); assert.equal(made.verified, false);
    assert.deepEqual(made.records.map((r: any) => [r.kind, r.type, r.host, r.ok]), [["DKIM", "TXT", "20270125pm._domainkey.larkinpoe.example", false], ["Return-Path", "CNAME", "pm-bounces.larkinpoe.example", false], ["DMARC", "TXT", "_dmarc.larkinpoe.example", false]]);
    assert.equal((await owner.post("/api/domain", { name: "other.example" })).status, 400, "one domain at a time");
    // Not verified yet: mail still comes from the Tallyhound address.
    assert.equal((await owner.post("/api/domain/check")).json.domain.verified, false); await H.app.staff(firmId, ownerId, (T: Engine) => { T.S.engs[1].confirmed = true; T.start(T.S.engs[1].id); }); await H.worker.pass(); assert.equal((H.email.sent.at(-1) as any).from, "test1@docs.tallyhound.test");
    // One record found is not enough. Both are.
    M.dns.dkim = true; assert.equal((await owner.post("/api/domain/check")).json.domain.verified, false); M.dns.rp = true; M.dns.dmarc = true;
    const ok = (await owner.post("/api/domain/check")).json.domain; assert.equal(ok.verified, true); assert.deepEqual(ok.records.map((r: any) => r.ok), [true, true, true]); assert.ok((await state()).S.audit.some((a: any) => a.action === "settings.domain" && /now come from documents@larkinpoe\.example/.test(a.detail)));
    H.advance(4 * 86400); await H.worker.pass(); const later = H.email.sent.at(-1) as any; assert.equal(later.from, "documents@larkinpoe.example"); assert.equal(later.replyTo, "test1@docs.tallyhound.test", "replies still come to Tallyhound");
    // A hard bounce on mail sent from the firm's own domain is still tied to the firm.
    const r = await H.postmarkPost("/hooks/postmark/bounce", { RecordType: "Bounce", Type: "HardBounce", Email: later.to, From: "documents@larkinpoe.example", MessageID: "pmb", Metadata: { inbox: "test1@docs.tallyhound.test" } }); assert.equal(r.statusCode, 200); assert.equal((await state()).S.clients.find((c: any) => c.email === later.to).emailOk, false);
    // The records disappear: the next check goes back to the Tallyhound address. Removing does the same at once.
    M.dns.dkim = false; assert.equal((await (await H.signInAs("pat1@firm1.test")).post("/api/domain/check")).json.domain.verified, false); assert.equal((await state()).S.firm.domain.verified, false);
    const o2 = await H.signInAs("pat1@firm1.test"); assert.equal((await o2.del("/api/domain")).status, 200); assert.equal((await state()).S.firm.domain, null); assert.equal(M.domains.size, 0); assert.deepEqual((await o2.get("/api/domain")).json, { domain: null });
    await H.close();
  });
}
