# Deploying Tallyhound

Round 16. What a host needs to run Tallyhound, written so it can be followed on Render, Fly, AWS or anything that runs a container. Nothing here has been done on a real host yet (ticket T-02).

## What runs

| Piece | How |
|---|---|
| Web service and timer | The `Dockerfile` at the repo root. One image. `TH_ROLE=web` or `TH_ROLE=worker` runs one of them; unset runs both in one process, which is enough for the pilot |
| Database | A managed Postgres, 16 or later, with encrypted disks and point-in-time recovery. The service brings the schema up to date each time it starts |
| Files | A private bucket that speaks the S3 API, with versioning OFF (a delete must be a delete) and no public access |
| Outside services | Twilio (texts), Postmark (email both ways), the Claude API |

Rehearsed on November 19 without a container runtime: a clean copy, `npm ci`, `npm run build`, `npm prune --omit=dev`, then started with `NODE_ENV=production` against an empty Postgres. The five migrations applied, `/healthz` answered and the sign-in page was served. That rehearsal found the database driver listed as a development-only package, which would have stopped a production install from starting. Fixed. The image itself has NOT been built: there was no Docker daemon here.

## Settings

Put every one of these in the host's secret store, never in the repo.

| Name | Needed | What it is |
|---|---|---|
| `NODE_ENV` | yes | `production`. Turns off the development shortcuts: sign-in links are never printed, files never rest on local disk |
| `APP_URL` | yes | The exact public address, for example `https://app.tallyhound.com`. Twilio signs requests against it, so a wrong value rejects every text |
| `LINK_HOST` | if different | The host clients see in their links, for example `go.tallyhound.com`. Letters and dots only matter here: no `https://`, no path. Point it at the same service |
| `PORT` | host sets it | Defaults to 3000 |
| `DATABASE_URL` | yes | Postgres connection string |
| `TH_MASTER_KEY` | yes | 32 random bytes, base64. Wraps every firm's data key. Losing it loses every firm's data; leaking it with a database copy exposes it. T-102 moves it into a cloud key service |
| `TH_LINK_SECRET` | yes | A long random string. Signs staff sign-in links |
| `S3_BUCKET`, `S3_REGION`, `S3_ENDPOINT` | yes | The private bucket. `S3_ENDPOINT` only for a store that is not Amazon's. Credentials come from `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` |
| `POSTMARK_TOKEN`, `TH_SIGNIN_FROM` | yes | Sends client email and staff sign-in links. Production will not start without the token |
| `TH_KMS_KEY_ID`, `TH_KMS_REGION` | recommended | The master key in AWS KMS (a key id, ARN or alias). The service's role needs `kms:GenerateDataKey` and `kms:Decrypt` on that one key and nothing else, so it can use the key and never read it. Turn on automatic rotation on the key. Works from any host given AWS credentials in the usual variables. When this is set, `TH_MASTER_KEY` is only needed to open firms made before the move |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | for Drive | A Google Cloud OAuth client (type: web application) with the redirect address `<APP_URL>/api/storage/google/callback` and the single scope `drive.file`. Without these, firms hand off finished files as a zip |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_SOLO`, `STRIPE_PRICE_PRACTICE`, `STRIPE_PRICE_FIRM`, `STRIPE_PRICE_LARGE` | for card billing | In Stripe: one product per plan with a monthly price (the price ids go here; leave one out to keep that plan off sale), the customer portal switched on, email receipts switched on, and a webhook to `<APP_URL>/hooks/stripe` for `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.payment_failed` and `invoice.paid`. Without these, plans are started with `npm run admin -- set-plan` and invoiced by hand |
| `TH_LINE_LOOKUP` | no | `off` stops the landline check (Twilio Lookup, a fraction of a cent per number, asked once). On whenever Twilio is connected |
| `TH_ALERT_EMAIL` | recommended | Where the developer is emailed when sends fail for a firm, a firm's turn on the timer fails, or an arriving message is lost after every retry. At most once an hour for the same trouble. Point an uptime check at `/healthz` as well: it answers 503 when the timer has not run for 10 minutes |
| `POSTMARK_HOOK_USER`, `POSTMARK_HOOK_PASSWORD` | for email in | The name and password inside the webhook address given to Postmark |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_MESSAGING_SERVICE_SID` | for texts | Without them texting is "not connected" and Tallyhound collects by email |
| `ANTHROPIC_API_KEY` | for reading | Without it documents go to a person and messages use the standard wording |
| `TH_MODEL_DAILY_CAP_USD` | no | Most the model may cost one firm in a day. Default 10 |
| `CLAMAV_HOST`, `CLAMAV_PORT` | recommended | A ClamAV daemon. Without it files are not scanned, and the log says so at start |

Generate the two secrets:

    node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"   # TH_MASTER_KEY
    node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))" # TH_LINK_SECRET

## After the first start

1. `GET /healthz` should answer `{"ok":true,...}` with the timer's last pass and the queue counts. Point the host's health check at it.
2. Create the first firm: `npm run admin -- create-firm ...` (see `apps/server/README.md`). It starts unchecked; `firm-check` lets it send.
3. Give the providers their webhook addresses. The table is in `apps/server/README.md`, "Connecting the providers".
4. Send one text, one email and one photo through staging before any firm is created on production (T-136).

## What to watch

- `queue.dead` in `/healthz` above zero: an inbound message could not be processed after five tries and is waiting under Unknown senders.
- `worker.lastPass` older than ten minutes: the timer has stopped. Reminders and scheduled deletion stop with it.
- Log events `send_failed`, `tick_failed`, `queue_dead`, `model_cap_reached`, `hook_rejected`. Logs carry event names and ids only, never a message, a document or an address.

## Not done

Scheduling `tools/backup.sh` nightly and repeating the restore drill on this host (`docs/BACKUP.md`), an uptime check on `/healthz`, a second region, and a staging environment separate from production.

## Looking at how it is running

- `npm run admin -- status` prints one line per firm: last tick, messages sent and failed today, model calls, model errors and model cost today, and the last error.
- `npm run admin -- usage --month 2027-02` prints what each firm used that month and what it cost us, from the engine's rates.
- The tables behind these (`firm_status`, `usage_monthly`, `model_calls`) hold counts, times and outcomes only, and sit outside each firm's sealed state, so they survive a restore of it.
- Not built in: an error tracker. The service writes one JSON line per event to standard output; send that to the host's log search and alert on `tick_failed`, `worker_failed`, `act_failed` and `watch_failed`.
