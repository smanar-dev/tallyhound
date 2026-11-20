# Tallyhound build kit

Working code and a plan to take Tallyhound from demo to pilot firms by January 15, 2027.

**Read `docs/SCOPE.md` first, then `docs/UX.md`, `docs/MOAT.md` and `docs/PRICING.md`.** Tallyhound does one job: get every client's documents in and check each one. Client list, checklist, chase, check. Anything else is out.

## What is here, and what state it is in

Updated November 20, 2026. "Tested" means against stand-ins for the outside service; "run live" means against the real one.

| Part | State |
|---|---|
| Rules engine (`packages/engine`) | Working. The same file the demo runs. Every product rule is here and has a test |
| Pipeline (`packages/core/pipeline.js`) | Working: claim, send, record; reading documents; filing to a firm's storage; second contacts |
| Data layer (`packages/core/crypto.js`, `packages/adapters/postgres.js`, `db/`) | Working on Postgres: a key per firm, everything sealed before it is stored, deletion on schedule. Ten migrations |
| Web service (`apps/server`) | Built: sign-in (emailed link plus authenticator code, lockout), roles, every staff action, webhooks for texts and email, the arriving-message queue, the timer, staff email notes, monitoring and usage, backups and closing a firm, the admin command |
| Staff web app (`apps/web`, React) | Built: Home, Clients, each client's page, Needs you, The Hound (with Ask), Add clients, All messages, Progress, and Settings (firm, people, checklists, message wording, sending hours, text number, finished files, plan, security and data) |
| Client pages (`/c/`, `/u/`, `/e/`, `/f/`) | Built: agree to texts, send documents (with or without scripts), the check-in, stop emails, the firm's public page |
| Claude (document reading, message writing, Ask the Hound) | Built on the official SDK with a daily cap per firm and a record per call. Tested. Never run live |
| Twilio (texts, pictures, landline lookup) | Built. Tested. Never run live. Text number registration is filed by hand from `npm run admin -- registration` |
| Postmark (email out and in) | Built. Tested. Never run live |
| A firm's own storage: Google Drive, OneDrive, SharePoint, Dropbox | Built. Tested. Never run live. Each needs its own app registration, and Google and Microsoft review an app before firms outside a test list can connect |
| Stripe (card billing, two price lists) | Built. Tested. Never run live |
| Self-serve sign-up and the price page (`/signup`, `/quote`) | Built. Tested. Sign-up is closed until `TH_SIGNUP=on` |
| Email from a firm's own domain | Built. Tested. Never run live |
| Recorded reminder calls | Built. Tested. Never run live. Off until `TH_VOICE=on`, and waits for counsel |
| AWS KMS (master key), S3-compatible bucket (files) | Built. Tested. Never run live |
| Hosting | `Dockerfile` and `docs/DEPLOY.md`. Not deployed anywhere |
| Accuracy of document reading | Not measured. `tools/eval-docs.js` exists; the test set of about 300 documents does not (T-22, T-130, T-138) |

Not built, on purpose: reading last year's return (waits for counsel, T-46). Spanish is written but switched off until a native review (T-31). Staff-recorded consent to texts has its gate built and no screen, until counsel approves it (T-145).

**To run it on your own computer, follow `docs/LOCAL.md`.** In short: `npm install`, `npm run local:setup`, a Postgres database, `npm run build`, create a firm, `npm start`, then `npm run admin -- check-services`.

Run the tests: `npm install`, then `npm test`. Node 22.18 or later. `npm run check` adds the type check, lint, the web build and the browser tests; set `DATABASE_URL` to a throwaway Postgres to include the tests that need a real one. `docs/TICKETS.md` has the state of every ticket, step by step.

## How it fits together

```
text / email / upload ─▶ pipeline ─▶ model reads it ─▶ ENGINE decides ─▶ model writes ─▶ safety check ─▶ send ─▶ save
                                                          ▲
staff actions in the web app ─────────────────────────────┘        a timer calls tick() every few minutes
```

The engine holds one firm's whole workspace in memory. The pipeline loads it, runs one event, sends what is ready and saves it, one event at a time per firm.

## Two decisions made for speed. Review both.

1. **Node, not Python.** The earlier build specification chose Python. The engine is JavaScript and already works, so the kit keeps one language and reuses it as is. Porting it would cost about two weeks you do not have.
2. **One workspace per firm to the engine; rows per client in the database.** The engine loads and saves one workspace, which keeps every rule in one tested file. Underneath (T-33, T-101) a firm is a small core, one sealed row per client and audit rows, so a text from one client reads and writes that client's row, not the firm. There is still no cross-firm reporting from these tables: everything in them is sealed with each firm's own key.

Read `docs/GAPS.md` (round 14: the end-to-end walk, what was fixed, what must be closed before a pilot). Then `docs/ARCHITECTURE.md`, `docs/SECURITY.md` and `docs/INTEGRATIONS.md` (round 13) for how data is stored, locked up and deleted, and how email, texts and client lists connect. Then `docs/LAUNCH_PLAN.md` and `docs/TICKETS.md`.
