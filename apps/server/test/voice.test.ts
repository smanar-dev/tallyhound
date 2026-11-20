// The reminder call adapter (T-50), against a stand-in for Twilio's voice API.
import test from "node:test";
import assert from "node:assert/strict";
import { twilioVoice } from "../src/voice.ts";

test("voice: a call is asked for with the wording as speech, waits for the voicemail tone, and a refusal is an error", async () => {
  const seen: { url: string; body: URLSearchParams; headers: Headers }[] = []; let status = 201;
  const f = (async (url: unknown, init: RequestInit) => { seen.push({ url: String(url), body: new URLSearchParams(String(init.body)), headers: new Headers(init.headers) }); return new Response(JSON.stringify(status === 201 ? { sid: "CA123" } : { code: 21211, message: "invalid" }), { status, headers: { "content-type": "application/json" } }); }) as unknown as typeof fetch;
  const v = twilioVoice({ accountSid: "AC1", authToken: "tok", fetch: f });
  assert.equal(await v.call({ from: "+16155550100", to: "6155550111", say: "This is a message for Jo from Larkin & Poe <CPAs>.", idempotencyKey: "m_1" }), "CA123");
  const c = seen[0]!; assert.equal(c.url, "https://api.twilio.com/2010-04-01/Accounts/AC1/Calls.json"); assert.equal(c.body.get("To"), "+16155550111"); assert.equal(c.body.get("From"), "+16155550100"); assert.equal(c.body.get("MachineDetection"), "DetectMessageEnd");
  assert.equal(c.body.get("Twiml"), '<?xml version="1.0" encoding="UTF-8"?><Response><Pause length="1"/><Say>This is a message for Jo from Larkin &amp; Poe &lt;CPAs&gt;.</Say></Response>'); assert.equal(c.headers.get("authorization"), "Basic " + Buffer.from("AC1:tok").toString("base64")); assert.equal(c.headers.get("i-twilio-idempotency-token"), "m_1");
  await assert.rejects(v.call({ from: "+16155550100", to: "911", say: "x" }), /Not a phone number/); assert.equal(seen.length, 1, "a bad number never reaches Twilio");
  status = 400; await assert.rejects(v.call({ from: "+16155550100", to: "6155550111", say: "x" }), (e: Error & { code?: number }) => e.code === 21211);
});
