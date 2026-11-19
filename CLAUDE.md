# Tallyhound: instructions for Claude Code

Tallyhound collects tax documents from an accounting firm's clients by text and email. Launch target: pilot firms live by January 15, 2027.

## The one job
Tallyhound does one job: client list, checklist, chase, check. `docs/SCOPE.md` defines it and lists what is out. Before building anything, ask which of the four steps it improves. If the answer is none, stop and ask the owner.

Every document must pass three checks, and `T.verdict(doc)` is the only place they are computed: right document, right information, clear to read. Screens, logs and client messages all read from it. Do not re-implement the checks anywhere else.

## Ease of use
`docs/UX.md` has ten rules and a vocabulary table. They are acceptance criteria for every screen. If a screen needs explaining, change the screen.

## Ground rules
- Sending is claim, send, record (`withFirm` in `packages/core/pipeline.js`). A message is marked and saved before the provider is called. Never add a code path that calls a provider for a message that has not been claimed and saved, and never resend a claimed message automatically.
- Pricing is flat by client count (`docs/PRICING.md`). Do not build per-return, per-document or per-message billing.
- `packages/engine/engine.js` is the source of truth for every product rule. It is the same file the demo runs. Do not rewrite it. Change it in small steps, and add a test in `test/engine.test.js` for every change.
- Run `npm run check` (type check, lint, all tests) before and after every change. All tests must pass before a ticket is done. Set `DATABASE_URL` to a throwaway Postgres to include the tests that need a real server.
- The engine never talks to the outside world. Texting, email, storage and the model live behind the interfaces in `packages/core/pipeline.js`. Keep it that way.
- The model reads and writes. Code decides. Never let model output trigger an action without the engine's checks: `outputCheck`, `composeDone`, and the opt-out rule in `inboundText`.
- Opt-out wording always wins. Consent replies (STOP, START, HELP) always send immediately, in every mode.
- Never log document contents, message bodies or model prompts in plain application logs. Log ids and outcomes.
- No real client data in development or tests. Use the synthetic forms.
- Data rules (`docs/SECURITY.md`). Never add a field for a Social Security number, date of birth, bank detail or an amount from a document. Every inbound message goes through `scrub` before it is stored. Every store is wrapped in `encryptedStore`; nothing reaches the database or the bucket unsealed. A stored file is deleted only after the state that forgets it has been saved (`dropFiles`). Deletion on schedule runs whatever the firm's billing state.
- Tallyhound never connects to a firm's mailbox. Email arrives at the firm's Tallyhound address. Mail whose sender cannot be confirmed is never filed to a client automatically (`docs/INTEGRATIONS.md`).
- Work the tickets in `docs/TICKETS.md` in order. Each has acceptance checks. Do not start a ticket marked AFTER LAUNCH.

## Layout
- `packages/engine` rules engine and loader (`createEngine()` gives a separate engine per call)
- `packages/core` pipeline, prompts, in-memory store and fakes
- `packages/core/crypto.js` key per firm, sealing, the encrypted store wrapper
- `packages/adapters` Claude API, Twilio (send, webhook signature, media), inbound email, Postgres store, Karbon import. None run live yet
- `apps/server` the web service (TypeScript, runs without a build step): sign-in, `/api/state`, role-checked actions, the timer, the admin command. See `apps/server/README.md`. A browser reaches only the engine functions listed in `apps/server/src/actions.ts`
- `db/schema.sql` the Postgres schema; later changes go in `db/migrations`, applied by `npm run admin -- migrate`
- `reference/artifact` the working demo: use it as the design and behavior reference for every screen
- `docs` launch plan and tickets

## Known gaps in the engine (each has a ticket)
- Time: the engine reads hours off its own clock, which must be the firm's wall time. `pipeline.wallTime` converts when `firm.iana` is set. Set it for every production firm. Each client can have a US zone (`T.setZone`); sending hours are judged on the client's clock. Offsets are fixed hour differences, so Arizona and Hawaii are an hour off during daylight saving (T-47).
- Never build HTML from a client name, payer, message or model output without escaping it. `tools/` has the injection sweep the demo passes; the web app needs the same test (T-52).
- Tax year 2026 is fixed in `newEng`. T-27.
- Spanish wording has not had native review. Keep Spanish off for pilots. T-31.
- `seed()` builds demo data. Production only calls `blank()` and `load()`.
