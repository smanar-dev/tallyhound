# Tallyhound and Neeter: what we need to integrate

*To send to Neeter. Internal notes are in `RUNBOOK.md`; the machine-readable version of everything below is `contract.json` (OpenAPI 3.1).*

## What Tallyhound is

Tallyhound collects tax documents from an accounting firm's clients. The firm confirms each client's checklist; Tallyhound sends one letter listing everything still owed, with a private upload link, follows up on a schedule, checks every document that comes in, and files it. We would like Neeter to be the email arm: send each letter from the CPA's own mailbox, read the replies, and keep a board of who owes what.

Tallyhound decides what to ask, when, and whether a document counts. Neeter sends, listens and keeps score. No client document ever passes through Neeter.

## The four things we need confirmed in writing

We cannot start without a yes, a no, or a date on each.

1. **Make a CPA's assistant without a Neeter sign-in.** The CPA signs in once, to Tallyhound's own Google or Microsoft app, and approves mailbox access. We hand you the refresh token (scopes below) and you make the assistant. The CPA never sees a Neeter screen or email. *If not:* can a firm's Google Workspace or Microsoft 365 administrator approve your app for their organisation, and can we then link the assistant to our user by id?
2. **Send a letter on demand, in our words.** We give you the recipient, subject and plain-text body (including the upload link); you send it now from the CPA's mailbox, unchanged, with no signature, footer, tracking pixel or "sent by" line. Follow-ups are replies on the same thread. *If not:* we can fall back to your own follow-up the morning before a task's due date, setting the due date ourselves, but only as a pilot stopgap, because the wording would be yours.
3. **Send with no click.** Letters go when we ask, with no Send button for the CPA. (In the pilot the CPA approves each letter inside Tallyhound first.)
4. **Deliver replies and bounces to us.** For each reply on a thread we started, from a sender on the firm's client list: sender, thread, time, plain text, your proposed status, and attachments if you can hand them over. Pushed to our webhook, signed as below. *If not:* an endpoint we can poll with a cursor.

## The calls we would make

All under `/v1`, JSON, with a key per firm in `Authorization: Bearer`. Every write carries an `Idempotency-Key`; a repeated key must change nothing and return the first answer. This matters most for letters: after an outage we retry with the same key and must never send a letter twice.

| Operation | Call |
|---|---|
| Who are we | `GET /v1/partner` (partner key) |
| A key for one firm | `POST /v1/keys`, `POST /v1/keys/revoke` (partner key). We replace each firm's key every 90 days |
| Make or remove an assistant | `POST /v1/assistants`, `DELETE /v1/assistants/{id}` |
| One project per client engagement | `POST` / `PUT /v1/assistants/{a}/projects[/{p}]` with `name` ("Garcia, Maria 2026"), `contact_email`, `closed`, `due_date` |
| One task per document owed | `POST` / `PUT .../projects/{p}/tasks[/{t}]` with `title` ("W-2 from Acme Logistics"), `owed_by: client`, `status`, `note` |
| Send a letter | `POST .../projects/{p}/letters` with `to`, `subject`, `body`, `thread_id`, `list_unsubscribe`, `send_now: true`, `add_signature: false` |
| Read back for the nightly check | `GET .../projects/{p}?include=tasks,history` |
| Delete a client's project | `DELETE .../projects/{p}` |
| Fallback only | `PATCH .../projects/{p}` with `due_date`; `GET /v1/assistants/{a}/events?cursor=` |

Statuses: **Open** (owed), **Completed** (the client says it is sent; we are checking), **Done** (verified; only Tallyhound sets it), **On hold** (no follow-ups), **Canceled** (not needed).

We are happy to use your names and paths instead of ours. These are what our adapter expects today, and changing them on our side is a small, contained job.

## What you would call

`POST {our address}/hooks/neeter`, JSON, one event per call:

```json
{ "id": "evt_1001", "type": "reply", "assistant_id": "as_1", "at": "2027-01-27T15:04:00Z",
  "from": "maria@x.example", "text": "Can I send the W-2 after the 15th?",
  "proposed_status": "On hold", "attachment_count": 0, "attachments": [] }
```

`type` is `reply`, `bounce` (with `to`) or `ping`. Sign it with header `x-layer-signature: t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>." followed by the exact body>`, using a secret we exchange. We refuse anything older than five minutes. Retry with backoff on anything other than 200 or 202. We act on each `id` once.

## White label

A CPA and a client see only Tallyhound and the firm.

- Letters come from the CPA's own address, exactly as we wrote them. No Neeter name, logo, domain, link, header or sender address anywhere a CPA or client can see. We scan every outbound email for it.
- The consent screen names Tallyhound: the sign-in app is ours, on our domain, with our privacy policy.
- The CPA never opens a Neeter page.
- You will be named, as you must be, in our subprocessor list and data processing terms: "email delivery and task tracking", with your hosting location.

## What you would hold

Each client's name and email address, the names of the forms they owe and who issues them, and access to the CPA's mailbox. Reading should be limited to threads Tallyhound started and senders on the firm's client list. Never a document, an amount, a Social Security or account number, or anything read from a document. Our side refuses to send you anything that looks like a figure or an identifier.

Mailbox scopes we would ask for: Google `gmail.send`, `gmail.readonly`; Microsoft `Mail.Send`, `Mail.Read`, `offline_access`. If you can work with narrower ones, tell us.

## Questions

1. Can you do the four things above, and by when?
2. Who owns the Google and Microsoft sign-in app in your current set-up, and can the token come from ours?
3. Where is data hosted? Where do staff with production access sit? Who are your own subprocessors? (You mentioned Google Cloud Vertex AI and no training on client content; we would put both in the contract.)
4. How long after an assistant is removed is its data deleted?
5. Price: per client per season, or per connected mailbox? What does white label cost?
6. When does reply reading leave pilot, and what is your SOC 2 timeline?
7. Sending limits per mailbox per day that you enforce or recommend.
8. A sandbox with a partner key, so we can run our conformance suite against you before any real mailbox is used.
9. Can two pilot firms be live by January 8, 2027?

## How we would test with you

We have a conformance suite that runs the whole lifecycle against a layer: make an assistant, a project, two tasks, every status, the same key twice, read back with history, refuse a figure, send one letter to a test inbox (twice, expecting one), delete, remove. It passes against our own stand-in today. With a sandbox key it runs against you in about a minute, and we would share the output.
