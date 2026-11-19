// Twilio sender for the pipeline's `sms` interface. STARTER: not yet run against a live account (T-06).
// Inbound: point the Messaging Service webhook at POST /hooks/twilio, verify the X-Twilio-Signature header,
// download each MediaUrlN with the same credentials, then call app.inboundSms({ to: To, from: From, body: Body, media }).
function twilio({ accountSid, authToken, messagingServiceSid, fetchImpl }) {
  const f = fetchImpl || fetch, auth = "Basic " + Buffer.from(accountSid + ":" + authToken).toString("base64");
  return {
    async send({ to, body }) {
      const form = new URLSearchParams({ To: to.startsWith("+") ? to : "+1" + to, MessagingServiceSid: messagingServiceSid, Body: body });
      const res = await f("https://api.twilio.com/2010-04-01/Accounts/" + accountSid + "/Messages.json", { method: "POST", headers: { authorization: auth, "content-type": "application/x-www-form-urlencoded" }, body: form });
      const data = await res.json(); if (!res.ok) { const err = new Error(data.message || "Twilio " + res.status); err.code = data.code; throw err; }
      return data.sid;
    },
    // Inbound webhook -> pipeline input. Downloads each photo, then asks Twilio to delete its copy so the only one left is ours, sealed.
    // opt.keep: do not delete at Twilio yet, and fail loudly if a photo cannot be fetched. The queue worker uses this: it calls
    // forget(params) only after the message has been processed and saved, so a retry can fetch the photos again.
    async inbound(params, opt) {
      const keep = !!(opt && opt.keep), n = Math.min(10, +params.NumMedia || 0), media = [];
      for (let i = 0; i < n; i++) {
        const url = params["MediaUrl" + i]; if (!url || !/^https:\/\/api\.twilio\.com\//.test(url)) continue;   // never fetch an address the request itself supplied from elsewhere
        const res = await f(url, { headers: { authorization: auth } }); if (!res.ok) { if (keep) throw new Error("Twilio media " + res.status); continue; }
        media.push({ bytes: Buffer.from(await res.arrayBuffer()), contentType: String(params["MediaContentType" + i] || res.headers.get("content-type") || "").split(";")[0] });
        if (!keep) try { await f(url, { method: "DELETE", headers: { authorization: auth } }); } catch (err) { /* T-108: a failed delete is retried by a nightly sweep */ }
      }
      return { to: params.To, from: params.From, body: params.Body || "", media, providerId: params.MessageSid || params.SmsSid || null };
    },
    // Deletes Twilio's copies of a message's photos. Returns how many deletes failed (T-108 sweeps those up).
    async forget(params) {
      const n = Math.min(10, +params.NumMedia || 0); let failed = 0;
      for (let i = 0; i < n; i++) { const url = params["MediaUrl" + i]; if (!url || !/^https:\/\/api\.twilio\.com\//.test(url)) continue; try { const r = await f(url, { method: "DELETE", headers: { authorization: auth } }); if (!r.ok && r.status !== 404) failed++; } catch (err) { failed++; } }
      return failed;
    }
  };
}
// Twilio signs every webhook: base64( HMAC-SHA1( auth token, full URL + every POST field as name+value, sorted by name ) ).
// Reject anything that does not match before reading a single field. url must be the public URL Twilio called, exactly.
function verifySignature(authToken, url, params, signature) {
  const crypto = require("node:crypto"), data = url + Object.keys(params || {}).sort().map((k) => k + params[k]).join("");
  const want = crypto.createHmac("sha1", authToken).update(Buffer.from(data, "utf8")).digest(), got = Buffer.from(String(signature || ""), "base64");
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}
// Clients will call the number that texts them. The answer is one line of TwiML: ring the firm's office.
function voiceForward(officeNumber) {
  const d = String(officeNumber || "").replace(/\D/g, "").slice(-10);
  return '<?xml version="1.0" encoding="UTF-8"?><Response>' + (d.length === 10 ? "<Say>Connecting you to the office.</Say><Dial>+1" + d + "</Dial>" : "<Say>This number only receives text messages. Please call your preparer's office directly.</Say>") + "</Response>";
}
module.exports = { twilio, verifySignature, voiceForward };
