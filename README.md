# Tallyhound build kit

Working code and a plan to take Tallyhound from demo to pilot firms by January 15, 2027.

**Read `docs/SCOPE.md` first, then `docs/UX.md`, `docs/MOAT.md` and `docs/PRICING.md`.** Tallyhound does one job: get every client's documents in and check each one. Client list, checklist, chase, check. Anything else is out.

## What is here, and what state it is in

| Part | State |
|---|---|
| Rules engine (`packages/engine`) | Working. The same code the demo runs. 138 tests, including the trial, paid plans and off-season pause (round 9), the client check-in, season roll-forward, custom request matching, Spanish wording, checklist templates, adding one client, the three document checks, the pipeline counts and a regression test for every engine bug in `docs/AUDIT.md` (eight rounds). `node tools/fuzz.js 200 600` runs 120,000 random actions against the safety rules and must report 0 findings. |
| Save, load and blank workspace | Working and tested: a reloaded workspace sends exactly the same messages. |
| Data layer (`packages/core/crypto.js`, `packages/adapters/postgres.js`, `db/schema.sql`) | Built in round 13. A key per firm, everything sealed before it is stored, scheduled deletion that really removes the bytes. Tested on an emulator; not yet on a real server (T-100, T-102). |
| Email in, Twilio webhook, Karbon import (`packages/adapters`) | Built in round 13 with tests on sample payloads. None has been run live. |
| Production pipeline (`packages/core/pipeline.js`) | Working against fakes. 25 tests cover real sending, including send-once after a failed save, multi-form uploads, locked files, staff uploads and held files while paused, model reading, model writing with the safety check, model outage, Copilot approval, failed sends and two events at once. |
| Prompts (`packages/core/prompts.js`) | Ported from the demo, where they run against Claude. No accuracy numbers yet: that is ticket T-22. |
| Claude API client | Rebuilt on the official SDK in `apps/server/src/model.ts` (round 16): timeout, retries, daily cap per firm. Never run against the live API. The starter in `packages/adapters/anthropic.js` is no longer used by the server. |
| Twilio adapter | Starter, extended in round 16 for safe retries. Never run against a live account. |
| Web service (`apps/server`) | Built in round 16: sign-in by emailed link plus authenticator code, recovery codes, sessions, three roles enforced on every action, firm setup in one command, the firm check gate, the timer. Step 2 added the inbound queue, the text and email webhooks, bounce and delivery receipts, file preparation, staff upload and document viewing. 23 tests, 19 of them run in memory and again on a real Postgres. Driven once in a real browser. See `apps/server/README.md`. |
| Staff web app (`apps/web`) | Started in round 16, in React: sign-in, the shell and Home, with 8 browser tests that drive the real service, including an injection sweep and the vocabulary check on every screen. The other screens show a holding page. See `apps/web/README.md`. |
| The rest of the screens, provider accounts, file bucket, hosting | Not built. See the tickets. |

Run the tests: `npm install` once (one test-only package, an in-process Postgres emulator), then `npm test`. Node 22.18 or later. `npm run check` adds the type check, lint, the web build and 25 browser tests. 273 tests, plus thirty-two that run against a real Postgres when DATABASE_URL is set (the three kit ones passed on PostgreSQL 18 on November 19; all thirty-two passed on PostgreSQL 16 on November 19). `npm run fuzz` runs 200 random seasons; `npm run scale` prints size and timing at 150, 500 and 1,000 clients.

## How it fits together

```
text / email / upload ─▶ pipeline ─▶ model reads it ─▶ ENGINE decides ─▶ model writes ─▶ safety check ─▶ send ─▶ save
                                                          ▲
staff actions in the web app ─────────────────────────────┘        a timer calls tick() every few minutes
```

The engine holds one firm's whole workspace in memory. The pipeline loads it, runs one event, sends what is ready and saves it, one event at a time per firm.

## Two decisions made for speed. Review both.

1. **Node, not Python.** The earlier build specification chose Python. The engine is JavaScript and already works, so the kit keeps one language and reuses it as is. Porting it would cost about two weeks you do not have.
2. **One saved workspace per firm, not 33 tables.** For the pilot each firm's state is one JSON document in Postgres behind a row lock. It is simple and already tested. It is fine for a firm with a few hundred clients and will not scale to thousands or support cross-firm reporting. Ticket T-33 moves to proper tables after tax season starts.

Read `docs/GAPS.md` (round 14: the end-to-end walk, what was fixed, what must be closed before a pilot). Then `docs/ARCHITECTURE.md`, `docs/SECURITY.md` and `docs/INTEGRATIONS.md` (round 13) for how data is stored, locked up and deleted, and how email, texts and client lists connect. Then `docs/LAUNCH_PLAN.md` and `docs/TICKETS.md`.
