// Card billing (T-81), against a stand-in for Stripe.
import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { build, KINDS, type Harness } from "./harness.ts";
import { createEngine } from "../src/kit.ts";

/* eslint-disable @typescript-eslint/no-explicit-any */
function stripe() {
  const S = { calls: [] as { path: string; fields: Record<string, string>; key: string | null; auth: string | null }[], down: false };
  const f = (async (url: unknown, init: RequestInit = {}) => { const u = new URL(String(url)), h = new Headers(init.headers), fields = Object.fromEntries(new URLSearchParams(String(init.body || ""))), path = u.pathname.replace("/v1/", ""); S.calls.push({ path, fields, key: h.get("idempotency-key"), auth: h.get("authorization") });
    const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { "content-type": "application/json" } }); if (S.down) return json({ error: { code: "api_error" } }, 500);
    return path === "checkout/sessions" ? json({ id: "cs_1", url: "https://checkout.stripe.com/c/pay/cs_1" }) : path === "billing_portal/sessions" ? json({ id: "bps_1", url: "https://billing.stripe.com/p/session/bps_1" }) : json({ id: path.split("/")[1] }); }) as unknown as typeof fetch;
  return Object.assign(S, { f });
}
let n = 0;
const event = (H: Harness, type: string, object: Record<string, unknown>, o: { secret?: string; at?: number; id?: string } = {}) => { const body = JSON.stringify({ id: o.id || "evt_" + ++n, type, data: { object } }), t = Math.floor((o.at ?? H.clock().getTime()) / 1000), sig = createHmac("sha256", o.secret || "whsec_test").update(t + "." + body).digest("hex"); return H.server.inject({ method: "POST", url: "/hooks/stripe", payload: body, headers: { "content-type": "application/json", "stripe-signature": "t=" + t + ",v1=" + sig } }); };

for (const kind of KINDS) {
  const name = (s: string) => "billing (" + kind + "): " + s;
  test(name("a trial firm pays by card on Stripe's page and the plan starts when Stripe says so; a failed card gets 7 days; a pause stops collecting; cancelling ends the plan"), async () => {
    const S = stripe(), H = await build(kind, { stripe: S.f }), { firmId } = await H.firms.create({ name: "Trial CPAs", inbox: "trial@docs.tallyhound.test", iana: "America/Chicago", ownerName: "Pat Owner", ownerEmail: "pat@trial.test", verified: true });
    const owner = await H.signInAs("pat@trial.test"); await owner.post("/api/users", { name: "Alex Staff", email: "alex@trial.test", role: "staff" }); const alex = await H.signInAs("alex@trial.test");
    const state = async () => { const T = createEngine(); T.load(await H.store.readState(firmId)); T.setNow(H.clock()); return T; };
    assert.equal((await state()).billing().state, "trial"); assert.deepEqual((await owner.get("/api/billing")).json, { available: true, plans: ["Solo", "Practice"], paying: false, pastDue: false, graceEnds: null });
    // Checkout: owner only, a plan on offer only, and what goes to Stripe is the price, the firm's id and where to come back to. No card ever passes through here.
    assert.equal((await alex.post("/api/billing/checkout", { plan: "Solo" })).status, 403); assert.equal((await owner.post("/api/billing/checkout", { plan: "Large" })).status, 400);
    const go = await owner.post("/api/billing/checkout", { plan: "Practice" }); assert.equal(go.json.url, "https://checkout.stripe.com/c/pay/cs_1");
    const sent = S.calls.at(-1)!; assert.equal(sent.auth, "Bearer sk_test_x"); assert.equal(sent.fields.mode, "subscription"); assert.equal(sent.fields["line_items[0][price]"], "price_practice"); assert.equal(sent.fields.client_reference_id, firmId); assert.equal(sent.fields.customer_email, "pat@trial.test"); assert.match(sent.fields.success_url!, /\/settings\?tab=plan&paid=1$/);
    assert.equal((await state()).billing().state, "trial", "opening the payment page starts nothing");
    // The webhook: a bad signature, an old timestamp and a body changed on the way are all refused.
    const done = { client_reference_id: firmId, customer: "cus_1", subscription: "sub_1", metadata: { firm_id: firmId, plan: "Practice" } };
    assert.equal((await event(H, "checkout.session.completed", done, { secret: "whsec_wrong" })).statusCode, 400); assert.equal((await event(H, "checkout.session.completed", done, { at: H.clock().getTime() - 3600000 })).statusCode, 400);
    assert.equal((await H.server.inject({ method: "POST", url: "/hooks/stripe", payload: "{}", headers: { "content-type": "application/json" } })).statusCode, 400); assert.equal((await state()).billing().state, "trial");
    assert.equal((await event(H, "checkout.session.completed", done, { id: "evt_paid" })).statusCode, 200); let T = await state(); assert.equal(T.billing().state, "active"); assert.equal(T.billing().plan, "Practice"); assert.ok(T.S.audit.some((a: any) => a.action === "billing.plan" && /paid by card/.test(a.detail)));
    const audits = T.S.audit.length; assert.equal((await event(H, "checkout.session.completed", done, { id: "evt_paid" })).statusCode, 200); assert.equal((await state()).S.audit.length, audits, "the same event twice does nothing the second time");
    assert.equal((await owner.get("/api/billing")).json.paying, true); assert.equal((await owner.post("/api/billing/checkout", { plan: "Solo" })).status, 400, "already has a plan");
    assert.equal((await owner.post("/api/billing/portal")).json.url, "https://billing.stripe.com/p/session/bps_1"); assert.equal(S.calls.at(-1)!.fields.customer, "cus_1"); assert.equal((await alex.post("/api/billing/portal")).status, 403);
    // The owner moves to Solo on Stripe's page.
    await event(H, "customer.subscription.updated", { id: "sub_1", customer: "cus_1", status: "active", items: { data: [{ price: { id: "price_solo" } }] } }); assert.equal((await state()).billing().plan, "Solo");
    // A pause: at the timer's next pass Stripe is told to stop collecting until the date; resuming early starts it again. Told once each way.
    const until = new Date(H.clock().getTime() + 30 * 86400000).toISOString().slice(0, 10); assert.equal((await owner.post("/api/act", { fn: "pauseSeason", args: [until] })).json.result, null);
    await H.worker.pass(); await H.worker.pass(); let subs = S.calls.filter((c) => c.path === "subscriptions/sub_1"); assert.equal(subs.length, 1); assert.equal(subs[0]!.fields["pause_collection[behavior]"], "void"); assert.ok(+subs[0]!.fields["pause_collection[resumes_at]"]! > H.clock().getTime() / 1000);
    await owner.post("/api/act", { fn: "resumeNow", args: [] }); await H.worker.pass(); subs = S.calls.filter((c) => c.path === "subscriptions/sub_1"); assert.equal(subs.length, 2); assert.equal(subs[1]!.fields.pause_collection, "");
    // The card fails. Seven days of full access and a date on the plan page; paid in time, nothing happens.
    await event(H, "invoice.payment_failed", { customer: "cus_1", subscription: "sub_1" }); const b = (await owner.get("/api/billing")).json; assert.equal(b.pastDue, true); assert.ok(b.graceEnds); H.advance(3 * 86400); await H.worker.pass(); assert.equal((await state()).access().ok, true);
    await event(H, "invoice.paid", { customer: "cus_1", subscription: "sub_1" }); H.advance(10 * 86400); await H.worker.pass(); assert.equal((await state()).access().ok, true); assert.equal((await (await H.signInAs("pat@trial.test")).get("/api/billing")).json.pastDue, false);
    // It fails again and is not put right: after seven days the plan ends, the firm is locked like an ended trial, and paying lifts it.
    await event(H, "invoice.payment_failed", { customer: "cus_1", subscription: "sub_1" }); H.advance(6 * 86400); await H.worker.pass(); assert.equal((await state()).access().ok, true); H.advance(2 * 86400); await H.worker.pass();
    T = await state(); assert.equal(T.access().ok, false); assert.match(T.access().reason, /Your plan has ended/); assert.ok(T.S.audit.some((a: any) => a.action === "billing.plan_ended" && /declined for 7 days/.test(a.detail)));
    await event(H, "invoice.paid", { customer: "cus_1", subscription: "sub_1" }); assert.equal((await state()).access().ok, true);
    // Cancelling on Stripe's page ends the plan. Someone else's customer id changes nothing here.
    await event(H, "customer.subscription.deleted", { id: "sub_other", customer: "cus_other", status: "canceled" }); assert.equal((await state()).access().ok, true);
    await event(H, "customer.subscription.deleted", { id: "sub_1", customer: "cus_1", status: "canceled" }); assert.equal((await state()).access().ok, false); assert.equal((await (await H.signInAs("pat@trial.test")).get("/api/billing")).json.paying, false);
    await H.close();
  });
}

test("billing: Stripe being down is said in words and changes nothing; with no Stripe set up the page says so and the webhook does not exist", async () => {
  const S = stripe(), H = await build("memory", { stripe: S.f }); await H.newFirm(); const owner = await H.signInAs("pat1@firm1.test"); S.down = true;
  const r = await owner.post("/api/billing/checkout", { plan: "Solo" }); assert.equal(r.status, 502); assert.match(r.json.message, /did not accept that|could not be reached/); await H.close();
  const N = await build("memory"); await N.newFirm(); const o = await N.signInAs("pat1@firm1.test"); assert.equal((await o.get("/api/billing")).json.available, false); assert.equal((await o.post("/api/billing/checkout", { plan: "Solo" })).status, 503);
  assert.equal((await N.server.inject({ method: "POST", url: "/hooks/stripe", payload: "{}", headers: { "content-type": "application/json" } })).statusCode, 404); await N.close();
});
