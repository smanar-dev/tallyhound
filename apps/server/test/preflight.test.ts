// The services check, against stand-ins: it reports each service truthfully, prints no secret, and sends nothing unless asked.
import test from "node:test";
import assert from "node:assert/strict";
import { preflight } from "../src/preflight.ts";

const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { "content-type": "application/json" } });
test("preflight: every service that is set up is asked one harmless question, a wrong key is a failure in words, and unset services say what is lost", async () => {
  const E: Record<string, string> = { APP_URL: "https://app.example", TWILIO_ACCOUNT_SID: "AC1", TWILIO_AUTH_TOKEN: "twilio-secret", TWILIO_MESSAGING_SERVICE_SID: "MG1", POSTMARK_TOKEN: "pm-secret", STRIPE_SECRET_KEY: "sk_test_secret", STRIPE_PRICE_SOLO: "price_solo", STRIPE_PRICE_FIRM: "price_yearly", GOOGLE_CLIENT_ID: "g-1" }, asked: string[] = [];
  const f = (async (url: unknown, init: RequestInit = {}) => { const u = String(url); asked.push((init.method || "GET") + " " + u);
    if (u.includes("/Accounts/AC1.json")) return json({ status: "active", type: "Trial" }); if (u.includes("messaging.twilio.com")) return json({ inbound_request_url: "https://old.example/hook" }); if (u.includes("lookups.twilio.com")) return json({ line_type_intelligence: { type: "mobile" } });
    if (u.endsWith("/server")) return json({ Message: "bad token", ErrorCode: 10 }, 401); if (u.includes("/prices/price_solo")) return json({ active: true, unit_amount: 9900, recurring: { interval: "month" } }); if (u.includes("/prices/price_yearly")) return json({ active: true, unit_amount: 599900, recurring: { interval: "year" } }); return json({}, 404); }) as unknown as typeof fetch;
  const out = await preflight({ env: (k) => E[k] || "", fetch: f, db: async () => "Postgres 16, 13 migrations applied", files: async () => { throw new Error("a deleted file can still be read: turn versioning OFF on the bucket"); }, key: async () => "works" });
  const of = (n: string) => out.find((c) => c.name.startsWith(n))!;
  assert.equal(of("Database").state, "ok"); assert.equal(of("Files").state, "failed"); assert.match(of("Files").detail, /versioning OFF/);
  assert.equal(of("Claude").state, "not set"); assert.match(of("Claude").detail, /documents go to a person/);
  assert.equal(of("Twilio account").state, "ok"); assert.match(of("Twilio account").detail, /TRIAL account/); assert.match(of("Twilio messaging service").detail, /SET its incoming-message address to https:\/\/app\.example\/hooks\/twilio/); assert.equal(of("Twilio landline lookup").state, "ok");
  assert.equal(of("Postmark (email out)").state, "failed"); assert.match(of("Postmark (email out)").detail, /HTTP 401 bad token/); assert.equal(of("Postmark account").state, "not set");
  assert.equal(of("Stripe").state, "failed"); assert.match(of("Stripe").detail, /FIRM is not a monthly price/);
  assert.equal(of("Google Drive").state, "ok"); assert.match(of("Google Drive").detail, /https:\/\/app\.example\/api\/storage\/google\/callback/); assert.equal(of("Dropbox").state, "not set");
  assert.doesNotMatch(JSON.stringify(out), /twilio-secret|pm-secret|sk_test_secret/, "no secret is ever printed"); assert.ok(asked.every((a) => a.startsWith("GET ")), "nothing was sent or changed"); assert.ok(!out.some((c) => c.name.startsWith("A real")));
  // The real sends happen only when asked for by name.
  let sent = 0; const more = await preflight({ env: (k) => E[k] || "", fetch: f, sendEmail: async (to) => { sent++; return "accepted for " + to; } }, { email: "me@firm.example", text: "6155550100" });
  assert.equal(sent, 1); assert.equal(more.find((c) => c.name === "A real email to me@firm.example")!.state, "ok"); assert.equal(more.find((c) => c.name === "A real text to 6155550100")!.state, "not set");
});
