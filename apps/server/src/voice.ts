// A recorded reminder call (T-50), placed through Twilio's voice API. The pipeline's `voice` interface: call({ from, to, say }).
// The words are the engine's fixed wording, read out by Twilio's text-to-speech. Twilio waits to hear whether a person or a
// voicemail greeting answered and, for voicemail, speaks after the tone. Nothing is recorded and no keys are listened for.
// A recorded call to a mobile needs the client's agreement: the engine places one only for a client marked as having agreed.
// Written from Twilio's API reference and tested against a stand-in. Not yet run against a real account.
export interface Voice { call(o: { from: string; to: string; say: string; idempotencyKey?: string }): Promise<string> }
const xml = (s: string) => s.replace(/[<>&'"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" })[c]!);
const e164 = (n: string) => { const d = String(n || "").replace(/\D/g, "").replace(/^1(\d{10})$/, "$1"); if (!/^[2-9]\d{9}$/.test(d)) throw new Error("Not a phone number that can be called"); return "+1" + d; };

export function twilioVoice(o: { accountSid: string; authToken: string; fetch?: typeof fetch }): Voice {
  const f = o.fetch || fetch, auth = "Basic " + Buffer.from(o.accountSid + ":" + o.authToken).toString("base64");
  return {
    async call({ from, to, say, idempotencyKey }) {
      const twiml = '<?xml version="1.0" encoding="UTF-8"?><Response><Pause length="1"/><Say>' + xml(say.slice(0, 600)) + "</Say></Response>";
      const r = await f("https://api.twilio.com/2010-04-01/Accounts/" + encodeURIComponent(o.accountSid) + "/Calls.json", { method: "POST", headers: { authorization: auth, "content-type": "application/x-www-form-urlencoded", ...(idempotencyKey ? { "i-twilio-idempotency-token": idempotencyKey } : {}) },
        body: new URLSearchParams({ To: e164(to), From: e164(from), Twiml: twiml, MachineDetection: "DetectMessageEnd", Timeout: "25" }).toString(), signal: AbortSignal.timeout(20000) });
      const j = (await r.json().catch(() => ({}))) as { sid?: string; code?: number; message?: string };
      if (!r.ok || !j.sid) throw Object.assign(new Error("Twilio call " + r.status), { code: j.code || r.status });
      return j.sid;
    }
  };
}
