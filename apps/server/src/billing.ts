// Card billing through Stripe (T-81). One flat monthly price per plan (docs/PRICING.md); nothing is charged per return, document
// or message. Tallyhound never sees a card: the owner pays on Stripe's own checkout page and manages cards and invoices on
// Stripe's own portal. What a plan allows, and what happens when one ends, is the engine's (choosePlan, planEnded, access).
//   start a plan    -> Stripe Checkout, then the "checkout.session.completed" webhook calls T.choosePlan
//   a failed card   -> 7 days of full access, then the same lock as an ended trial (T.planEnded)
//   a pause         -> Stripe stops collecting until the pause date; resuming early starts it again
//   cancelling      -> the plan ends when Stripe says the subscription is over
// Written from Stripe's API reference and tested against a stand-in. Not yet run against a real Stripe account.
import { createHmac, timingSafeEqual } from "node:crypto";
import type { App, Engine } from "./kit.ts";

export const GRACE_DAYS = 7, SIGNATURE_TOLERANCE_S = 300;
export interface BillingRow { firmId: string; customerId: string; subscriptionId: string | null; plan: string | null; status: string; pastDueSince: Date | null; paused: boolean; updatedAt: Date }
export interface BillingStore { get(firmId: string): Promise<BillingRow | null>; byCustomer(customerId: string): Promise<BillingRow | null>; put(r: BillingRow): Promise<void>; /** True the first time an event id is seen. */ claimEvent(id: string, at: Date): Promise<boolean> }

export function memoryBillingStore(): BillingStore { const rows = new Map<string, BillingRow>(), seen = new Set<string>(); return { async get(id) { const r = rows.get(id); return r ? { ...r } : null; }, async byCustomer(c) { const r = [...rows.values()].find((x) => x.customerId === c); return r ? { ...r } : null; }, async put(r) { rows.set(r.firmId, { ...r }); }, async claimEvent(id) { if (seen.has(id)) return false; seen.add(id); return true; } }; }
interface Db { query(sql: string, args?: unknown[]): Promise<{ rows: Record<string, unknown>[]; rowCount: number | null }> }
export function postgresBillingStore(pool: Db): BillingStore {
  const row = (r: Record<string, unknown> | undefined): BillingRow | null => (r ? { firmId: r.firm_id as string, customerId: r.customer_id as string, subscriptionId: (r.subscription_id as string) || null, plan: (r.plan as string) || null, status: r.status as string, pastDueSince: (r.past_due_since as Date) || null, paused: !!r.paused, updatedAt: r.updated_at as Date } : null);
  return {
    async get(id) { return row((await pool.query("select * from firm_billing where firm_id = $1", [id])).rows[0]); },
    async byCustomer(c) { return row((await pool.query("select * from firm_billing where customer_id = $1", [c])).rows[0]); },
    async put(r) { await pool.query("insert into firm_billing (firm_id, customer_id, subscription_id, plan, status, past_due_since, paused, updated_at) values ($1, $2, $3, $4, $5, $6, $7, $8) on conflict (firm_id) do update set customer_id = excluded.customer_id, subscription_id = excluded.subscription_id, plan = excluded.plan, status = excluded.status, past_due_since = excluded.past_due_since, paused = excluded.paused, updated_at = excluded.updated_at", [r.firmId, r.customerId, r.subscriptionId, r.plan, r.status, r.pastDueSince, r.paused, r.updatedAt]); },
    async claimEvent(id, at) { return ((await pool.query("insert into stripe_events (id, at) values ($1, $2) on conflict do nothing", [id, at])).rowCount || 0) > 0; }
  };
}

export class BillingError extends Error { status: number; constructor(message: string, status = 400) { super(message); this.status = status; } }
export interface BillingDeps { store: BillingStore; app: App; secretKey: string; webhookSecret: string; /** Stripe price id for each plan name, e.g. { Solo: "price_...", Practice: "price_..." } */ prices: Record<string, string>; appUrl: string; clock: () => Date; fetch?: typeof fetch; log?: (event: string, ...ids: unknown[]) => void }

export function createBilling(d: BillingDeps) {
  const f = d.fetch || fetch, base = d.appUrl.replace(/\/$/, ""), say = d.log || (() => {}), planOf = (priceId: string) => Object.keys(d.prices).find((p) => d.prices[p] === priceId) || null;
  // Stripe takes form fields, with brackets for nesting. A key makes a repeated request safe.
  async function stripe(path: string, fields: Record<string, string>, key?: string): Promise<Record<string, any>> {   // eslint-disable-line @typescript-eslint/no-explicit-any
    const r = await f("https://api.stripe.com/v1/" + path, { method: "POST", headers: { authorization: "Bearer " + d.secretKey, "content-type": "application/x-www-form-urlencoded", ...(key ? { "idempotency-key": key } : {}) }, body: new URLSearchParams(fields).toString(), signal: AbortSignal.timeout(20000) });
    const j = (await r.json().catch(() => ({}))) as Record<string, any>;   // eslint-disable-line @typescript-eslint/no-explicit-any
    if (!r.ok) { say("stripe_failed", path.split("/")[0], r.status, (j.error && j.error.code) || ""); throw new BillingError("The payment service did not accept that. Try again in a moment.", 502); }
    return j;
  }
  const lift = (firmId: string, plan: string, why: string) => d.app.withFirm(firmId, (T: Engine) => { const b = T.billing(); if (b.state === "active" && b.plan === plan) return null; const r = T.choosePlan(plan); if (!r) T.audit("billing.plan", plan + ": " + why, "Tallyhound"); return r as string | null; });
  const end = (firmId: string, why: string) => d.app.withFirm(firmId, (T: Engine) => T.planEnded(why));

  return {
    plans: Object.keys(d.prices),
    async status(firmId: string) {
      const r = await d.store.get(firmId), until = r && r.pastDueSince ? new Date(r.pastDueSince.getTime() + GRACE_DAYS * 86400000) : null;
      return { available: true, plans: Object.keys(d.prices), paying: !!(r && r.subscriptionId && r.status !== "cancelled" && r.status !== "ended"), pastDue: !!(r && r.pastDueSince), graceEnds: until };
    },
    /** The address of Stripe's checkout page for this firm and plan. Nothing changes here until Stripe says the payment went through. */
    async checkout(firmId: string, who: { id: string; email: string }, plan: string): Promise<string> {
      if (!d.prices[plan]) throw new BillingError("That plan is not on offer.");
      const fit = (await d.app.withFirm(firmId, (T: Engine) => { const p = (T.PLANS as [string, number, number][]).find((x) => x[0] === plan); return !p ? "Unknown plan" : T.S.clients.length > p[2] ? plan + " covers up to " + p[2] + " clients. You have " + T.S.clients.length + "." : null; })) as string | null;
      if (fit) throw new BillingError(fit);
      const row = await d.store.get(firmId); if (row && row.subscriptionId && (row.status === "active" || row.status === "past_due")) throw new BillingError("This firm already has a plan. Change it under Manage billing.");
      const s = await stripe("checkout/sessions", { mode: "subscription", "line_items[0][price]": d.prices[plan]!, "line_items[0][quantity]": "1", success_url: base + "/settings?tab=plan&paid=1", cancel_url: base + "/settings?tab=plan", client_reference_id: firmId, "metadata[firm_id]": firmId, "metadata[plan]": plan, "subscription_data[metadata][firm_id]": firmId, "subscription_data[metadata][plan]": plan, ...(row ? { customer: row.customerId } : { customer_email: who.email }) });
      if (typeof s.url !== "string" || !/^https:\/\/[a-z.]*stripe\.com\//.test(s.url)) throw new BillingError("The payment page could not be opened. Try again.", 502);
      say("checkout_started", firmId, plan); return s.url;
    },
    /** Stripe's own page for cards, invoices, changing plan and cancelling. */
    async portal(firmId: string): Promise<string> {
      const row = await d.store.get(firmId); if (!row) throw new BillingError("There is no billing to manage yet. Choose a plan first.");
      const s = await stripe("billing_portal/sessions", { customer: row.customerId, return_url: base + "/settings?tab=plan" });
      if (typeof s.url !== "string" || !/^https:\/\/[a-z.]*stripe\.com\//.test(s.url)) throw new BillingError("The billing page could not be opened. Try again.", 502); return s.url;
    },
    /** Stripe calls this. The body must be the exact bytes received: the signature is over them. Each event is handled once. */
    async webhook(raw: Buffer, signature: string | undefined): Promise<{ ok: boolean; status: number }> {
      const parts = Object.fromEntries(String(signature || "").split(",").map((p) => p.trim().split("=") as [string, string])), t = Number(parts.t), want = createHmac("sha256", d.webhookSecret).update(t + "." + raw.toString("utf8")).digest("hex");
      const given = String(signature || "").split(",").map((p) => p.trim()).filter((p) => p.startsWith("v1=")).map((p) => p.slice(3));
      if (!t || Math.abs(d.clock().getTime() / 1000 - t) > SIGNATURE_TOLERANCE_S || !given.some((g) => g.length === want.length && timingSafeEqual(Buffer.from(g), Buffer.from(want)))) return { ok: false, status: 400 };
      let ev: { id?: string; type?: string; data?: { object?: Record<string, any> } };   // eslint-disable-line @typescript-eslint/no-explicit-any
      try { ev = JSON.parse(raw.toString("utf8")); } catch { return { ok: false, status: 400 }; }
      const o = (ev.data && ev.data.object) || {}, now = d.clock(); if (!ev.id || !ev.type) return { ok: false, status: 400 };
      if (!(await d.store.claimEvent(ev.id, now))) return { ok: true, status: 200 };   // a repeat: already done
      if (ev.type === "checkout.session.completed") {
        const firmId = String(o.client_reference_id || (o.metadata && o.metadata.firm_id) || ""), plan = String((o.metadata && o.metadata.plan) || ""); if (!firmId || !d.prices[plan] || !o.customer) { say("stripe_event_skipped", ev.type); return { ok: true, status: 200 }; }
        const other = await d.store.byCustomer(String(o.customer)); if (other && other.firmId !== firmId) { say("stripe_event_skipped", ev.type, "customer belongs to another firm"); return { ok: true, status: 200 }; }
        await d.store.put({ firmId, customerId: String(o.customer), subscriptionId: o.subscription ? String(o.subscription) : null, plan, status: "active", pastDueSince: null, paused: false, updatedAt: now });
        const r = await lift(firmId, plan, "paid by card"); say("plan_started", firmId, plan, r || "ok");
      } else if (ev.type === "customer.subscription.updated" || ev.type === "customer.subscription.deleted") {
        const row = await d.store.byCustomer(String(o.customer || "")); if (!row || (row.subscriptionId && row.subscriptionId !== o.id)) return { ok: true, status: 200 };
        if (ev.type === "customer.subscription.deleted" || o.status === "canceled" || o.status === "unpaid" || o.status === "incomplete_expired") { await d.store.put({ ...row, status: "cancelled", pastDueSince: null, paused: false, updatedAt: now }); await end(row.firmId, "The subscription ended"); say("plan_ended", row.firmId, "cancelled"); }
        else { // the owner moved to another plan on Stripe's page
          const price = o.items && o.items.data && o.items.data[0] && o.items.data[0].price ? String(o.items.data[0].price.id) : "", plan = planOf(price);
          if (plan && plan !== row.plan) { const r = await lift(row.firmId, plan, "changed by the owner"); if (r) say("plan_change_refused", row.firmId, plan); else await d.store.put({ ...row, plan, updatedAt: now }); }
        }
      } else if (ev.type === "invoice.payment_failed") {
        const row = await d.store.byCustomer(String(o.customer || "")); if (row && !row.pastDueSince && row.status !== "cancelled" && row.status !== "ended") { await d.store.put({ ...row, status: "past_due", pastDueSince: now, updatedAt: now }); await d.app.withFirm(row.firmId, (T: Engine) => { T.audit("billing.payment_failed", "The card was declined. Collecting carries on for " + GRACE_DAYS + " days", "Tallyhound"); }); say("payment_failed", row.firmId); }
      } else if (ev.type === "invoice.paid" || ev.type === "invoice.payment_succeeded") {
        const row = await d.store.byCustomer(String(o.customer || "")); if (row && (row.pastDueSince || row.status === "ended") && row.plan) { await d.store.put({ ...row, status: "active", pastDueSince: null, updatedAt: now }); await lift(row.firmId, row.plan, "payment received"); say("payment_recovered", row.firmId); }
      }
      return { ok: true, status: 200 };
    },
    /** The timer's part, once per firm per pass: tell Stripe about a pause or its end, and end a plan whose card has failed for a week. */
    async check(firmId: string, b: { state: string; pausedUntil: Date | null }): Promise<void> {
      const row = await d.store.get(firmId), now = d.clock(); if (!row || !row.subscriptionId || row.status === "cancelled" || row.status === "ended") return;
      const paused = b.state === "paused";
      if (paused !== row.paused) {
        await stripe("subscriptions/" + row.subscriptionId, paused ? { "pause_collection[behavior]": "void", ...(b.pausedUntil ? { "pause_collection[resumes_at]": String(Math.floor(new Date(b.pausedUntil).getTime() / 1000)) } : {}) } : { pause_collection: "" });
        await d.store.put({ ...row, paused, updatedAt: now }); say(paused ? "billing_paused" : "billing_resumed", firmId);
      }
      if (row.pastDueSince && now.getTime() - row.pastDueSince.getTime() > GRACE_DAYS * 86400000 && (b.state === "active" || b.state === "paused")) { await d.store.put({ ...row, paused, status: "ended", updatedAt: now }); await end(firmId, "The card was declined for " + GRACE_DAYS + " days"); say("plan_ended", firmId, "unpaid"); }
    }
  };
}
export type Billing = ReturnType<typeof createBilling>;
