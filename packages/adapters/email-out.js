// Outbound email for the pipeline's `email` interface, through Postmark's HTTP API. STARTER: not run against a live account (T-103).
// From is the firm's Tallyhound address with the firm's name, or an address on the firm's own domain once that domain is verified (T-110).
// Reply-To is always the Tallyhound address, so replies come straight back to the inbound webhook whichever From is used.
function postmark({ serverToken, stream, fetchImpl }) {
  const f = fetchImpl || fetch;
  return {
    async send({ from, fromName, to, subject, body, idempotencyKey, unsubscribe, replyTo }) {
      const res = await f("https://api.postmarkapp.com/email", { method: "POST", headers: { accept: "application/json", "content-type": "application/json", "x-postmark-server-token": serverToken },
        body: JSON.stringify({ From: fromName ? '"' + String(fromName).replace(/["\\]/g, "") + '" <' + from + ">" : from, To: to, ReplyTo: replyTo || from, Metadata: { inbox: String(replyTo || from).toLowerCase() }, Subject: subject, TextBody: body, MessageStream: stream || "outbound", TrackOpens: false, TrackLinks: "None", Headers: [{ Name: "X-Tallyhound-Id", Value: String(idempotencyKey || "") }].concat(unsubscribe ? [{ Name: "List-Unsubscribe", Value: "<" + unsubscribe + ">" }, { Name: "List-Unsubscribe-Post", Value: "List-Unsubscribe=One-Click" }] : []) }) });
      const data = await res.json().catch(() => ({}));
      // 406: the address bounced or complained before. Never retried; the engine marks the address bad and tells the firm.
      if (!res.ok) { const err = new Error(data.Message || "Postmark " + res.status); err.code = data.ErrorCode === 406 ? "bounced" : data.ErrorCode || res.status; throw err; }
      return data.MessageID;
    }
  };
}
// Postmark's bounce and spam-complaint webhooks -> what to tell the engine.
function bounceEvent(j) { const hard = j.RecordType === "SpamComplaint" || ["HardBounce", "BadEmailAddress", "SpamComplaint", "ManuallyDeactivated"].includes(j.Type); return { inbox: String((j.Metadata && j.Metadata.inbox) || "").toLowerCase(), email: String(j.Email || "").toLowerCase(), hard, kind: j.RecordType === "SpamComplaint" ? "complaint" : "bounce", id: j.MessageID || null }; }
module.exports = { postmark, bounceEvent };
