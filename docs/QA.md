# QA and completion run, November 20, 2026

What was actually run in this pass, what it showed, and where every ticket stands. Commit: see the git log entry that adds this file.

## What was run

| Check | Result |
|---|---|
| Type check, lint | Clean |
| Engine, pipeline and server tests, in memory and on a real Postgres 16 | 367 of 367 pass at the QA run; 387 of 387 after the 14 tickets below |
| Browser tests (Chromium, driving the real service in memory) | 43 of 43 pass |
| Fuzzer, 200 seeds by 600 steps against the engine | 0 findings |
| `npm audit` on production dependencies | 0 known vulnerabilities |
| CI on GitHub for `main` | Green on the last finished run |
| **The service started the way a person starts it** (`npm run local:setup`, a fresh database, `create-firm`, `firm-check`, `npm start`) and driven by a real browser | 20 of 20 checks pass, after the fixes below |

The last row is new. The automated tests build the service from test parts; this run used `runtime.ts` and `main.ts`, the real wiring. The 20 checks: sign-in by the link printed in the terminal, authenticator setup, ten recovery codes, Home; a CSV import of three clients through the screen; all 25 staff screens open with no browser error and no "undefined" or "NaN" on them; optional features hidden when nothing is connected; confirm and start a client; a staff upload reaches Needs you; the stored file opens for staff and is **not readable on disk**; the client's upload page with scripts and without, no cookie set, photo delivered through the queue; a made-up client link says "expired" and nothing else; requests with no sign-in are refused; zip hand-off; the price page; sign-out; signing in again asks for the code.

## Found in this run and fixed

1. **After Start, nothing visibly happened for up to five minutes.** The first message was made at the timer's next pass. Nothing was lost, but it looked broken. A staff action now gives that firm its turn within a second (`worker.soon`), with a test.
2. **The banner said "Your text number is waiting for carrier approval" when nothing had been filed.** Choosing a plan marks a number as wanted; the screens read that as "with the carriers". They now say so only once the firm's legal details have been entered, and Home offers "Set up" until then.
3. **Home offered a storage "Connect" button when no storage service was set up.** Hidden unless one is.

Not faults, but worth knowing:

- A client in an earlier time zone is not messaged until 8 am on their own clock. Start a California client at 8:30 am Central and the first message waits until 10 am Pacific. The client's page says when it will go.
- A new firm is on Copilot: every message is a draft until a person approves it. That is the launch plan's choice (T-37).
- The Needs you badge counts drafts to approve as well as tasks; the "All" pill on that page counts tasks only.
- Staff can never see a client's private link, by design, including through the API.

## What has not been run, and so is not known to work

Every outside service has been tested only against a stand-in written from its documentation.

| Service | What is unproven |
|---|---|
| Claude | Reading real documents and writing messages; accuracy is unmeasured (T-22, T-130, T-138). Ask the Hound. Reading a prior-year return |
| Twilio | Texts out and in, picture messages, delivery status, the landline lookup's field names, reminder calls |
| Postmark | Email out, email in (and whether it passes on SPF, DKIM and DMARC results, T-112), bounces, own-domain setup |
| Stripe | Checkout, the portal, webhook signatures, pausing collection |
| Google Drive, OneDrive, SharePoint, Dropbox | The sign-in round trip and every file call |
| AWS KMS, an S3-compatible bucket | Wrapping keys; storing and really deleting files |
| Docker | The image and `docker-compose.yml` have never been built or run (no Docker on the build machine) |
| HEIC | Conversion is wired but has never seen a real iPhone photo |
| ClamAV | The scanner client is written; no daemon has been run |

`npm run admin -- check-services` is the tool for closing these, one key at a time. Expect the first real answers to need fixes.

Also untested by anyone: a screen reader, a real phone, Safari and Firefox (the browser tests use Chromium only), and load beyond the engine's own scale script.

## Where the 147 tickets stand

| State | Count | Tickets |
|---|---|---|
| Built, with tests | 111 | T-01, 03 to 21, 23 to 29, 32 to 34, 36, 38 to 41, 45 to 54, 56, 58 to 61, 63, 65 to 69, 71 to 74, 76, 79, 81, 83 to 87, 89 to 91, 94, 95, 97, 98, 100 to 103, 105 to 108, 110 to 112, 115 to 128, 131, 132, 135, 139, 140, 142 to 147 |
| Recorded as built in the kit before this week; not re-examined one by one in this pass | 10 | T-55, 57, 62, 75, 78, 80, 82, 88, 93, 99 |
| Cannot be finished in code: needs a live service, a person, counsel or a decision | 25 | T-02 hosting; T-22, 43, 44, 77, 92, 130, 138 accuracy measurements; T-30 outside security review; T-31 Spanish review; T-37 Autopilot by default (a decision); T-42 and T-64 watching real first-time users; T-70 showing an owner ten real check-ins; T-96 confirming prices; T-104 Karbon live; T-109 incident rehearsal; T-113 forwarded mail; T-114 penetration test; T-129 terms; T-133 running the company; T-134 a real text registration; T-136 the adapters live; T-137 the scanner installed; T-141 business checklists reviewed by a preparer |
| Not built | 0 | The 14 open at the QA run are built: see below |
| Cut | 1 | T-35 |

"Built" means the code exists and its tests pass. For anything touching an outside service it does **not** mean proven against that service.

### The 14 that were not built at the QA run, built since

| Ticket | What was built | Where |
|---|---|---|
| T-33, T-54, T-101 | A firm is saved as a small core, one sealed row per client and audit rows. One inbound text at 2,500 clients touches 12 KB, was about 25 MB | `packages/core/parts.js`, migration 015, `test/parts.test.js`, `node tools/scale.js 2500` |
| T-106 | The model reads before the firm's lock is taken | `readFirst` in `packages/core/pipeline.js` |
| T-107 | An owner lets one named support person look for a set time; it ends by itself and is written in the audit trail | Settings, People; `firms.addSupport` |
| T-108 | Twilio's copy of a picture and of the words is removed once ours is saved; failures are retried by the timer | `apps/server/src/twiliocleanup.ts` |
| T-115 | A monthly audit line with how many copies were deleted on schedule | `deletionEvidence` in the engine |
| T-63 | A firm's own closed days | Settings, Hours |
| T-66 | Undo for ten seconds on four actions | toast with Undo |
| T-67 | "How it works" inside the product | `/help` |
| T-95 | Owners are emailed at 80% and 100% of the allowance | `apps/server/src/notify.ts` |
| T-123 | A large start is paced, 50 every half hour | `startMany` |
| T-121 | An emailed link with no file is answered | `inboundEmail` |
| T-58 | Was already built; the row in this table was wrong. Import, add and the way in handle a shared number or address | `test/round14.test.js` |

What these do **not** change: T-108 has not been run against Twilio, and the new storage has run on Postgres 16 here but never under real traffic. The first deploy applies migration 015 by itself and each firm is split on its next save.
