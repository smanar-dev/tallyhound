# The Tallyhound web service

Sign-in, the firm's workspace for the web app, the role-checked staff actions, and the timer. Built in round 16 (tickets T-01, T-04, T-05, T-49, T-105, T-116 gate, T-132, T-139).

It holds no product rules. Every staff action runs the engine through `app.staff` in `packages/core/pipeline.js`.

## Run it locally

You need Node 22.18 or later and a Postgres server. TypeScript runs directly; there is no build step.

    cp .env.example .env          # fill in TH_MASTER_KEY and TH_LINK_SECRET
    set -a; . ./.env; set +a
    npm run admin -- create-firm --name "Larkin & Poe CPAs" --inbox larkinpoe@docs.tallyhound.com \
        --zone America/Chicago --owner-name "Pat Larkin" --owner-email pat@larkinpoe.com --sms 6155550100
    npm run build                 # the staff web app, served by the web service
    npm start

`create-firm` brings the database up to date first. Open http://localhost:3000, enter the owner's email, and copy the sign-in link from the terminal (it is only printed when no email service is connected, and never in production).

A new firm is not checked: nothing is sent or read until `npm run admin -- firm-check --firm f_... --by "Your name"` (T-116).

## What is where

| File | What it does |
|---|---|
| `src/server.ts` | Routes. `/auth/*` sign-in, `/api/state`, `/api/act`, `/api/clients/:id/plan`, `/api/users`, `/healthz`, the pages |
| `src/signin.ts` | Emailed link, authenticator code, recovery codes, sessions. Uses `packages/core/auth.js` |
| `src/authstore.ts` | Accounts, sessions and the audit log, in memory and in Postgres |
| `src/actions.ts` | The engine functions a browser may call, and which role may call each |
| `src/firms.ts` | Create a firm, the firm check, add and remove people, change roles |
| `src/hooks.ts` | Where providers call in: `/hooks/twilio` (texts), `/hooks/twilio/status`, `/hooks/twilio/voice`, `/hooks/postmark/inbound`, `/hooks/postmark/bounce` |
| `src/public.ts`, `src/clientpages.ts` | The client's pages: `/c/` agree to texts, `/u/` send documents, `/e/` stop emails, and `/f/`, the firm's public page. Plain HTML from React on the server, no script |
| `src/queue.ts` | The inbound queue: store, answer, process with retries, hand to a person |
| `src/files.ts` | Makes an arriving file ready: identify, convert, rotate, shrink, scan, read PDF text |
| `src/model.ts` | The Claude client: timeout, retries, refusals, a daily spend cap per firm |
| `src/worker.ts` | Calls `tick` for every firm every five minutes, and works the queue every 15 seconds |
| `src/runtime.ts` | Reads the environment, connects everything, runs database migrations |
| `src/admin.ts` | `migrate`, `create-firm`, `firm-check`, `firms` |
| `test/` | 41 tests. 29 of them run in memory and again on a real Postgres when `DATABASE_URL` is set |

## Rules this code keeps

- A client's link key never leaves the server, not even inside the text of a sent message. The audit trail and the list of people go to owners only.
- A browser can only reach the engine functions listed in `src/actions.ts`. Adding a screen means adding its action there, with a role.
- Read-only accounts get 403 on every action. Owner-only: how long data is kept, deleting copies, people and roles.
- A user id is the same in the sign-in table and in the firm's workspace, so the engine's audit trail names the right person.
- The second-factor secret is sealed with the firm's own data key. Session tokens and recovery codes are stored as hashes.
- A role change or a removal signs that person out everywhere. A firm cannot lose its last owner.
- Logs carry event names and ids. Never bodies, never tokens, never an address.
- A webhook checks who is calling before it reads a field, stores the event sealed with the firm's key, and answers. It never sends a reply itself.
- Twilio's copy of a photo is deleted only after ours is sealed and the result is saved.

## Not done here

- File bytes sit on local disk (sealed). A private bucket is T-11.
- The master key comes from an environment variable. The cloud key service is T-102.
- The webhooks have never been called by Twilio or Postmark (T-136). The Twilio routes exist only when `TWILIO_AUTH_TOKEN` is set, the Postmark ones only when `POSTMARK_HOOK_PASSWORD` is set.
- The product screens (T-15 onward).

## Connecting the providers (T-136)

| Where | Set it to |
|---|---|
| Twilio Messaging Service, incoming messages | `https://<host>/hooks/twilio`, fallback `https://<host>/hooks/twilio/fallback` |
| Twilio Messaging Service, delivery status callback | `https://<host>/hooks/twilio/status` |
| Twilio number, voice | `https://<host>/hooks/twilio/voice` |
| Postmark inbound stream webhook | `https://postmark:<POSTMARK_HOOK_PASSWORD>@<host>/hooks/postmark/inbound` |
| Postmark bounce and spam complaint webhooks | `https://postmark:<POSTMARK_HOOK_PASSWORD>@<host>/hooks/postmark/bounce` |

`APP_URL` must be the exact public address Twilio calls, or every signature check fails.
- `access()` is enforced by the engine when sending and reading. The lock page for a paused or expired firm is T-83.
