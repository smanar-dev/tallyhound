# Architecture

Round 13, November 19, 2026. This is the whole system on one page: what the parts are, how a document travels through them, where data rests, and where the design stops scaling.

Status words used here: **built** means code in this kit with tests. **Designed** means decided and written down, not coded. **Unproven** means built but never run against the real service.

## The parts

| Part | What it does | Where | Status |
|---|---|---|---|
| Rules engine | Every decision: who is asked for what, when, by which channel, what counts as received, what is deleted and when. No network, no clock of its own, no AI. | `packages/engine` | Built, 221 tests in the kit, fuzzed |
| Pipeline | Wraps the engine. Loads one firm, lets the model read and write, saves, sends, records. One firm at a time. | `packages/core/pipeline.js` | Built against fakes |
| Prompts | The five things the model is asked to do: read a document, read a multi-page file, read a text, read an email, write one message. | `packages/core/prompts.js` | Built. Live accuracy unmeasured |
| Encryption | A key per firm. Firm state and every file are sealed before they reach the database or the bucket. | `packages/core/crypto.js` | Built, tested |
| Store | Postgres for firm state, a bucket for files. | `packages/adapters/postgres.js`, `db/schema.sql` | Built. Passed on a real PostgreSQL 18 server in round 15, including two servers writing at once |
| Text adapter | Twilio: send, receive, delivery receipts, signature check. | `packages/adapters/twilio.js` | Built. Unproven live |
| Email in | Provider webhook to pipeline input: sender check, forwarded mail, reply stripping, attachment limits. | `packages/adapters/email-inbound.js` | Built, tested on sample payloads |
| Email out | One call to a sending service. | not in the kit | Designed (T-103) |
| Model adapter | Claude API, two tiers: a small model for texts and wording, a larger one for documents. | `packages/adapters/anthropic.js` | Built. Unproven live |
| Client list in | CSV import in the engine. Karbon importer. | engine `parseCSV`/`importRows`, `packages/adapters/importers.js` | CSV built. Karbon built from the published reference, unproven |
| Web app | What staff see. | `reference/artifact` is the working demo and the visual spec | Demo built. Production front end is T-10 to T-19 |
| Client pages | Upload page and questions page, opened from a signed link, no login. | demo only | Designed (T-68) |
| Sign-in | Emailed link or identity provider, plus a second factor. Sessions in Postgres. | `db/schema.sql` tables only | Logic built and tested in `packages/core/auth.js`. Screens not built (T-139) |
| Billing | Stripe subscription per plan, paused and resumed by the engine's state. | engine state only | Designed (T-94) |

## How one document travels

1. A client texts a photo to the firm's Tallyhound number, or emails it to the firm's Tallyhound address, or uses the upload page.
2. The provider (Twilio or the mail service) calls our webhook. We check the provider's signature. A delivery we have seen before is answered and ignored.
3. The pipeline finds the firm by the number or address, then takes that firm's lock.
4. The file is sealed with the firm's key and put in the bucket. Its key (a random name) goes in the firm's state.
5. The model reads the image and answers in a fixed shape: which form, which year, who issued it, who it is for, how legible, what is missing. It is told not to return amounts or ID numbers, and the engine has nowhere to keep them if it did.
6. The engine decides: accepted, ask again, wrong year, duplicate, not for this client, or a person should look. It writes the reply or queues it for approval, depending on the firm's mode.
7. State is saved. Only then are messages sent, each one claimed first so a crash can never send twice.
8. The firm delivers the finished set to its own storage (Drive, OneDrive, Dropbox, SharePoint) or downloads a zip.
9. After the firm's keep-for time, the engine lets go of the copy. On the next pass the pipeline deletes the bytes from the bucket and marks the file row deleted.

A text with no photo skips 4 and 5 and goes to the small model with the client's open items. An email is the same with one extra gate: mail whose sender cannot be confirmed is never filed to a client on its own word.

## Where data rests

| What | Where | Sealed | How long |
|---|---|---|---|
| Client name, email, mobile, preparer, client number | Firm state in Postgres | Yes, firm key | Until the firm removes the client or closes the account |
| Checklist and status | Firm state | Yes | Same |
| Message text, in and out | Firm state | Yes | Until 90 days (setting) after the client's file is closed |
| Document file | Bucket | Yes, firm key | 30 days (setting) after delivery. 7 days if rejected. 400 days at most |
| Document record: form, year, issuer, date, verdict | Firm state | Yes | Kept. This is what builds next year's checklist |
| Audit log | Its own table, append only | Detail sealed | 7 years (to confirm with counsel) |
| Usage counters | Its own table | No. Numbers only | Kept for billing |
| Social Security, bank and card numbers | Nowhere | | Removed from message text before it is stored or shown to the model |
| Amounts from documents | Nowhere | | Never extracted |

## The store, and where it stops scaling

Each firm is one sealed value. Every event loads it, changes it and writes it back under a row lock. This is simple, makes every change atomic, and makes "one firm at a time" free. It has a ceiling.

Measured with `node tools/scale.js` (a full 75-day season, synthetic clients, this machine):

| Clients | State size | Load | Save | Timer pass |
|---|---|---|---|---|
| 150 | 1.9 MB | 23 ms | 17 ms | under 5 ms |
| 500 | 6.0 MB | 43 ms | 57 ms | 12 ms |
| 1,000 | 12.1 MB | 185 ms | 120 ms | 63 ms |

Messages are over half the size and the audit trail about 15%. Add roughly 10 to 30 ms each way for compression and sealing at the larger sizes (the sealed value is about a tenth of the JSON).

What this means:

* **Solo, Practice, Firm plans (up to 1,000 clients):** fine. A text is answered in well under a second of our own time. The model call dominates.
* **Large plan (up to 2,500):** built (T-33, T-101). The numbers above are the old single value and are kept for comparison. A firm is now a small core in `firm_state`, one sealed row per client in `firm_parts`, and audit rows in `firm_audit` (`packages/core/parts.js`). A text, email or upload from a known client loads the core and that client's row: 12 KB and 12 ms at 2,500 clients (`node tools/scale.js 2500`). The engine's interface did not change.
* **What still loads the whole firm:** the five-minute timer and every staff action (about 0.8 s at 2,500 clients; only the rows that changed are written), and `/api/state`, which sends the browser the whole workspace. Scoping staff actions to one client is the next step if a Large firm finds clicks slow.
* **The model is called before the lock (T-106).** An inbound event is first run against an unlocked copy to collect the model's answers, then run again under the lock, where it finds them. A slow model call no longer blocks other events for the same firm.

## Hosting (designed, not provisioned)

One region in the United States. A managed Postgres with encrypted disks and point-in-time recovery. A private bucket with no public access and versioning off, so a delete is a delete. A key service for the master key. Two small app servers behind a load balancer, plus a timer that calls `tick` for each active firm every five minutes. Outbound: Twilio, the mail service, the model provider, Stripe, and the storage provider a firm connects.

Nothing here is exotic and nothing needs more than the smallest instance sizes for a pilot. See `docs/PRICING.md` for running cost.

## What is not built

Said plainly so nobody plans around it: the production web front end, sign-in, the client pages, Stripe, the storage connectors (Drive, OneDrive, Dropbox, SharePoint), outbound email, PDF page rendering on the server, and deployment. The tickets cover each. The demo simulates all of them.
