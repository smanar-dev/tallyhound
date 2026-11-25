// Self-serve sign-up (T-76, T-79), the price test (T-97) and the large-firm quote (T-98).
import test from "node:test";
import assert from "node:assert/strict";
import { build, KINDS } from "./harness.ts";
import { createEngine } from "../src/kit.ts";

const words = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/\s+/g, " ");
for (const kind of KINDS) {
  const name = (s: string) => "signup (" + kind + "): " + s;
  test(name("a firm signs itself up: nothing exists until the emailed link is opened and the button pressed; then a trial firm, unchecked, on the second price list, and the owner can sign in"), async () => {
    const H = await build(kind, { signup: { open: true, priceBook: "B" }, stripe: (async () => new Response(JSON.stringify({ id: "cs", url: "https://checkout.stripe.com/c/pay/cs" }), { status: 200, headers: { "content-type": "application/json" } })) as unknown as typeof fetch });
    const post = (url: string, body: Record<string, string>) => H.server.inject({ method: "POST", url, payload: new URLSearchParams(body).toString(), headers: { "content-type": "application/x-www-form-urlencoded" } }), get = (url: string) => H.server.inject({ method: "GET", url });
    const page = await get("/signup"); assert.equal(page.statusCode, 200); assert.match(words(page.body), /Start your free trial.*14 days, no card/); assert.doesNotMatch(page.body, /<script/i);
    const good = { firm: "Larkin & Poe CPAs", name: "Pat Larkin", email: "Pat@LarkinPoe.example", iana: "America/Phoenix", clients: "320" };
    for (const [bad, why] of [[{ ...good, email: "nope" }, /work email/], [{ ...good, firm: "" }, /firm's name/], [{ ...good, iana: "Mars/Olympus" }, /time zone/], [{ ...good, clients: "lots" }, /how many clients/]] as [Record<string, string>, RegExp][]) { const r = await post("/signup", bad); assert.equal(r.statusCode, 400); assert.match(words(r.body), why); }
    // A program that fills in the hidden field is told the same thing and nothing is sent.
    assert.match(words((await post("/signup", { ...good, website: "http://spam.example" })).body), /Check your email/); assert.equal(H.signupMails.length, 0);
    const r = await post("/signup", good); assert.equal(r.statusCode, 200); assert.match(words(r.body), /Check your email/); assert.equal(H.signupMails.length, 1); assert.equal(H.signupMails[0]!.to, "pat@larkinpoe.example"); assert.deepEqual(await H.auth.activeFirmIds(), [], "nothing created yet");
    const link = /\/signup\/confirm\?t=([\w-]+)/.exec(H.signupMails[0]!.body)![1]!;
    // Opening the link (as a mail scanner would) creates nothing. The button does, once.
    const open = await get("/signup/confirm?t=" + link); assert.match(words(open.body), /Start Larkin & Poe CPAs's trial/); assert.deepEqual(await H.auth.activeFirmIds(), []); assert.equal((await get("/signup/confirm?t=wrong")).statusCode, 404);
    const done = await post("/signup/confirm", { t: link }); assert.match(words(done.body), /You're in/); const ids = await H.auth.activeFirmIds(); assert.equal(ids.length, 1);
    assert.equal((await post("/signup/confirm", { t: link })).statusCode, 404, "the link works once");
    const T = createEngine(); T.load(await H.store.readState(ids[0]!)); T.setNow(H.clock());
    assert.equal(T.S.firm.name, "Larkin & Poe CPAs"); assert.equal(T.S.firm.email, "larkinandpoecpas@docs.tallyhound.test"); assert.equal(T.S.firm.tz, "Arizona"); assert.equal(T.billing().state, "trial"); assert.equal(Math.round((+new Date(T.billing().trialEnds) - +H.clock()) / 86400000), 14);
    assert.equal(T.S.firm.verified, false, "unchecked: nothing is sent to clients yet"); assert.equal(T.access().ok, false); assert.equal(T.access().state, "checking"); assert.equal(T.S.firm.priceBook, "B"); assert.deepEqual(T.plans().map((p: [string, number]) => p[1]), [149, 349, 799, 1299]);
    assert.equal(H.told.length, 1); assert.match(H.told[0]!.subject, /waiting for its check/); assert.match(H.told[0]!.body, new RegExp(ids[0]!)); assert.doesNotMatch(H.told[0]!.body, /larkinpoe/i);
    // The owner got a sign-in link and gets in; the plan page offers the plans on sale to this firm's price list.
    assert.ok(H.links.some((l) => l.to === "pat@larkinpoe.example")); const owner = await H.signInAs("pat@larkinpoe.example"); assert.equal((await owner.get("/api/me")).json.role, "owner"); assert.deepEqual((await owner.get("/api/billing")).json.plans, ["Solo", "Practice", "Firm"]);
    // Signing up again with the same address says the same thing and sends nothing; a second firm with the same name gets its own address.
    const n = H.signupMails.length; assert.match(words((await post("/signup", good)).body), /Check your email/); assert.equal(H.signupMails.length, n);
    await post("/signup", { ...good, email: "sam@other.example", name: "Sam Poe" }); await post("/signup/confirm", { t: /t=([\w-]+)/.exec(H.signupMails.at(-1)!.body)![1]! });
    const second = (await H.auth.activeFirmIds()).find((x) => x !== ids[0])!, U = createEngine(); U.load(await H.store.readState(second)); assert.equal(U.S.firm.email, "larkinandpoecpas2@docs.tallyhound.test");
    // The link runs out.
    await post("/signup", { ...good, email: "late@third.example" }); const late = /t=([\w-]+)/.exec(H.signupMails.at(-1)!.body)![1]!; H.advance(61 * 60); assert.equal((await post("/signup/confirm", { t: late })).statusCode, 404); assert.equal((await H.auth.activeFirmIds()).length, 2);
    await H.close();
  });
}

test("signup: the price page answers for any size of firm by the engine's rule and takes a large firm's request; with sign-up closed nothing can be started", async () => {
  const H = await build("memory", { signup: { open: false } }), post = (url: string, body: Record<string, string>) => H.server.inject({ method: "POST", url, payload: new URLSearchParams(body).toString(), headers: { "content-type": "application/x-www-form-urlencoded" } });
  assert.deepEqual((await H.browser().get("/api/site")).json, { signup: false });
  assert.equal((await H.server.inject({ method: "GET", url: "/signup" })).statusCode, 404); assert.equal((await post("/signup", { firm: "X", name: "Y", email: "a@b.example", iana: "America/Chicago", clients: "5" })).statusCode, 404);
  assert.match(words((await post("/quote", { clients: "120" })).body), /\$99 a month.*Solo plan, for up to 150 clients/); assert.doesNotMatch((await post("/quote", { clients: "120" })).body, /signup/, "no trial link while sign-up is closed");
  const big = await post("/quote", { clients: "6200" }); assert.match(words(big.body), /For 6,200 clients \$2,399 a month.*Large plan \(2,500 clients\) plus 4 blocks of 1,000 clients\. Covers up to 6,500/); assert.match(big.body, /Ask for this price/);
  assert.equal((await post("/quote", { clients: "0" })).statusCode, 400); assert.equal((await post("/quote", { clients: "6200", ask: "1", firm: "Big LLP", name: "", email: "x" })).statusCode, 400); assert.equal(H.told.length, 0);
  const asked = await post("/quote", { clients: "6200", ask: "1", firm: "Big <b>LLP</b>", name: "Dana Okafor", email: "dana@big.example" }); assert.match(words(asked.body), /Someone from Tallyhound will write to you/); assert.equal(H.told.length, 1); assert.match(H.told[0]!.body, /Big bLLP\/b\nDana Okafor, dana@big\.example\n6200 clients: \$2,399 a month/);
  await H.close();
});

test("features: the screens are told what this installation has connected, and nothing more", async () => {
  const bare = await build("memory"); await bare.newFirm(); const a = await bare.signInAs("pat1@firm1.test"); assert.deepEqual((await a.get("/api/features")).json, { ask: false, prior: false, signup: false, billing: false, domain: false, voice: false, textBarks: false, storage: [], mailbox: [] }); assert.equal((await bare.browser().get("/api/features")).status, 401); await bare.close();
  const noop = (async () => new Response("{}", { status: 200, headers: { "content-type": "application/json" } })) as unknown as typeof fetch, full = await build("memory", { stripe: noop, google: noop, postmarkAccount: noop, voice: true, converse: { async converse() { return "ok"; } } }); await full.newFirm(); const b = await full.signInAs("pat1@firm1.test");
  assert.deepEqual((await b.get("/api/features")).json, { ask: true, prior: false, signup: false, billing: true, domain: true, voice: true, textBarks: false, storage: ["Google Drive", "Microsoft OneDrive", "SharePoint", "Dropbox"], mailbox: [] }); await full.close();
});
