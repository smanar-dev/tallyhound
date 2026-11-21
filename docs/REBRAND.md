# Brand, copy and six features: the spec for this codebase

November 21, 2026. Sources: the Tallyhound brand book, the content book, and "New features spec and build plan" (all dated November 20, 2026). Those three say what; this file says what it means here, in this repository, and in what order it is built. Where a source and the code disagree, the difference is listed under "Differences and decisions" so nothing is changed by accident.

The feature spec was written against the earlier build specification (Python paths such as `domain/` and `core/llm.py`, tables such as `review_task` and `client_memory`). This product is the Node kit: one engine file holds every rule and a firm's state is saved through `packages/core/parts.js`. Each requirement below is mapped to where it lives here. Requirement IDs (TH-CMP-1 and so on) are kept so tests can be named after them.

## 1. What changes, in one page

| Area | Today | After |
|---|---|---|
| Look | Navy ink, marigold accent, Bricolage Grotesque and Hanken Grotesk | Ledger green, Paper, one Fox orange action per view; Fraunces, Instrument Sans, IBM Plex Mono |
| Logo | Text wordmark | Hound-head mark with the Fox collar and tick tag, beside the Fraunces wordmark |
| The hound | Not drawn | One SVG component (from the website's `Hound.jsx`): run, carry, sniff, wag, sit. Empty states, progress, success only |
| Words | "Start collecting", "Needs you" as the place, "Stuck" | "Go fetch", "the review queue", "Gone quiet", "sniff test", "In and verified n of m" |
| Reminders | One fixed rhythm (2, 5, 9, final 14) | Fetch intensity: Gentle, Steady (today's), Persistent; for the firm or one client |
| Message wording | One set of templates | Voice: Warm, Professional (today's), Brief; for the firm or one client; a firm sign-off |
| A client who stops replying | Marked stuck, a call task if switched on | Always a "gone quiet" item in the review queue with what is missing and four actions |
| Replies | Nine intents | Five more: someone else has it, already sent, life change, send after a date, not mine |
| Telling staff | Morning note, urgent email, in-app alerts | Barks: batched, routed by kind, staff hours respected, escalation, a bell with history |
| Next season | Roll forward keeps the checklist | Outcome memory: "From 2026", "Removed last season", "Slow last year" |

## 2. Rules that do not move

These come from `CLAUDE.md` and the three books, and every ticket below is checked against them.

1. Clients see the firm, never the hound. No hound, no "bark", no "fetch", no Fox button on a client text, email or page. Client pages carry the firm's name first and one small "Sent with Tallyhound" line.
2. No hound next to bad news: errors, security, legal, sign-in problems, the locked-out page.
3. Fox (`#F26B3A`) is a fill, never text. Orange text is Fox deep (`#B23F14`). No white text on Fox. One Fox element asking for action per view.
4. Never claim what is not built or measured. No accuracy numbers. The sniff test is never called a review of the figures.
5. The model never decides. A reply understood as a life change suggests an edit; a person accepts it. Nothing is added to or removed from a checklist by a reply.
6. Every message, in every voice and language, passes `outputCheck`. A version that fails cannot be saved or shipped.
7. Barks are internal and carry a first name and last initial only, no document details, when they leave the app.
8. Memory holds outcomes: form, payer, who sent it, how many asks, how long. No amounts, no identifiers, no message text, no images. It is deleted with the client.
9. No emoji and no exclamation marks in product or client messages, in every voice (decision 2 below).
10. Spanish stays off for pilot firms until a fluent speaker has reviewed it (T-31). The Spanish versions are written and tested, not switched on.

## 3. Brand (brand book sections 4 to 11, 13)

### Tokens (`apps/web/src/styles/app.css`, `apps/server` client pages and emails)

| Token | Value | Use |
|---|---|---|
| Ledger | `#13261F` | Text, headings, sidebar, the logo square |
| Hunter | `#1E4637` | Raised surfaces on dark, hover on dark buttons |
| Paper | `#F6F2E9` | Page background |
| Bone | `#FFFDF8` | Cards, panels |
| Linen | `#EFE8DA` | Chips, table headers, quiet bands |
| Fox | `#F26B3A` | Primary button fill, progress, one highlight per view |
| Fox deep | `#B23F14` | The only orange text; problem notes |
| Highlighter | `#FFE9A8` | Marker behind a phrase, text selection |
| Moss | `#4F5F57` | Secondary text |
| Line | `#E2D9C8` | Borders and rules |
| Faint | `#8A968F` | Icons and decoration only, never text |
| Good | `#1F8A55` | Ticks, "passed", "filed" (with an icon; text only at 24 px and up) |
| Warn | `#9A5B00` | Needs-a-look notes |
| Problem note | text Fox deep on `#FDF0EA`, border `#F2C3AE` | Replaces red everywhere |

Motion: ease `cubic-bezier(.2,.8,.2,1)`, spring `cubic-bezier(.34,1.56,.64,1)`; quick 150 to 250 ms, standard 300 to 450 ms. Every animation stops under `prefers-reduced-motion`.

Type: Fraunces 600 for headings, prices and big numbers; Instrument Sans 400 to 700 for everything read or pressed; IBM Plex Mono 400 and 500 for eyebrow labels, chips, file paths and timestamps. The fonts are packaged with the app (no request to Google from a firm's browser). Sentence case everywhere.

Components: primary button Fox fill with Ledger text, fully rounded, lifts 2 px; secondary 1.5 px Ledger outline; dark button Ledger fill; card Bone with a Line border and 18 px radius; chip Linen, fully rounded, Plex Mono; field 12 px radius with a Ledger border and soft Fox ring on focus; table with a Linen header row and `#FBF7EE` hover; verdict banners passed (`#EEF6F1`, border `#CFE3D6`), asked again (`#FDF0EA`, `#F2C3AE`), sent to your team (`#EEF1F6`, `#C9D3E3`); focus outline Ledger.

### Logo and the hound

- `Mark` and `Logo` components and `favicon.svg`, from the website's `public/logo.svg`. Top left, 36 px mark. Never recoloured, never animated except the small wag while the app loads.
- `Hound` component from the website's `Hound.jsx` (150 by 92, facing right), with its poses. Decorative hounds are hidden from screen readers.
- Where it appears in the product: the loading screen (run), empty states (sit and wag), the review queue when empty, "all fetched" and other success moments (wag), the Go fetch confirmation (run once). Never on sign-in errors, the lock page, security and data settings, billing problems, or any client page. One hound per view.

### Client pages and emails

- Client pages (`/c/`, `/u/`, `/e/`, `/f/`): firm name first, plain Ledger buttons (no Fox), no hound, one small "Sent with Tallyhound" line. They still work with no script and set no cookie.
- Emails to staff: plain, Paper background, the lockup at the top, one primary button. Emails to clients: the firm's name, no Tallyhound styling beyond the footer line.

## 4. Words (content book sections 4 and 6)

`docs/UX.md` is rewritten to this table and `apps/web/e2e/rules.test.ts` checks it.

| Was | Now |
|---|---|
| Start collecting | Go fetch (button); "Fetch for Maria" for one client |
| Needs you (the place) | The review queue. "Needs you" stays as the status on a client row |
| Stuck | Gone quiet (the stored value stays `stuck`) |
| Check / checked | sniff test; passed the sniff test; did not pass the sniff test |
| n of m received | In and verified n of m |
| Not started / in progress / complete | Ready to fetch / Fetching / All fetched |
| Copilot / Autopilot | Approve each message / Send on its own |
| Waive | Not needed this year (with a reason) |
| Take over | I'll handle Maria |
| Alert, notification | A bark (staff only) |

Still retired: inbox, outreach, engagement, playbook, handoff, approvals, deliver. "Review" is allowed only inside "review queue"; a document is never "reviewed" by Tallyhound.

Buttons, statuses, moments of delight, empty states, errors and staff notifications use the content book's wording exactly (section 6). Errors stay plain: no hound, no jokes.

The demo firm and every sample use the sample cast: Maple & Pine Tax Co., Maria and Daniel Garcia, Luis, Ray Chen, Chen & Park LLC, Okafor Dental PC, Hartley Family Trust, Riverside Food Pantry.

## 5. Features

### F4 Fetch intensity (PAC)

Today: `GAPS = [2, 3, 4, 5]` in the engine (reminders on days 2, 5 and 9, the final note on day 14).

| Preset | Reminder days | Final | Gaps the engine uses |
|---|---|---|---|
| Gentle | 3, 7, 12 | 18 | 3, 4, 5, 6 |
| Steady (default) | 2, 5, 9 | 14 | 2, 3, 4, 5 |
| Persistent | 1, 3, 5, 7, 10 | 12 | 1, 2, 2, 2, 3, 2 |

- TH-PAC-1: `CADENCE_PRESETS` is one table in the engine; tests and the settings screen read it.
- TH-PAC-2: `firm.hound.intensity`, owner only (`setIntensity`), audit `firm.cadence_changed`.
- TH-PAC-3: `client.intensity`, staff (`setClientIntensity`); blank means the firm's.
- TH-PAC-4: a change never sends at once and never moves a send to earlier than one day after the last message. `cadenceFor(e)` is the only lookup `step` uses.
- TH-PAC-5: Settings shows two weeks of reminder dots per preset, built from the table, Sundays empty.
- TH-PAC-6: a chip on the client page when it differs from the firm's; a filter on the client list.
- TH-PAC-7 (V1): Progress counts Persistent clients and their median days to finish.
- Unchanged by any preset: one automatic message a day outside a live conversation, sending hours on the client's clock, Sundays, federal holidays and the firm's closed days, stop on arrival, STOP.

### F1 Fetch until verified (CMP)

Today: `checkComplete`, `setStuck(e, reason)`, a call task only when `hound.callTask` is on.

- TH-CMP-1: the start action is "Go fetch" on every screen; audit action `engagement.go_fetch`.
- TH-CMP-2: `T.verified(eid)` returns `{ n, m }`: items accepted or confirmed as not needed, over items required. "Client says none" is not verified until a person confirms. Screens show "In and verified n of m".
- TH-CMP-3: `setStuck` always opens one `gone_quiet` task with what is missing, the last request date and how many times each was asked. An engine test proves no engagement is `stuck` without one.
- TH-CMP-4: the task closes on one of four actions: make a call task, restart fetching (step back to 0, status `in_progress`), pause, close.
- TH-CMP-5: becoming in and verified marks the file complete and sends "that's everything" once (exists; a test confirms).
- TH-CMP-6: a file is never shown as finished while a review queue item for it is open.

### F3 Voice (VOI)

Today: `TPL.en` and `TPL.es`, one version each; `fill(code, c, e, extra)`; the model may reword a message when `hound.aiWrite` is on, and `outputCheck` and `composeDone` decide.

- TH-VOI-1: `TPL[lang][voice][code]`. Professional is today's wording. Warm and Brief are written by hand for every client template. Compliance messages (opt-in confirmation, STOP, HELP, wrong number) have one wording in every voice. A missing version fails a test.
- TH-VOI-2: `firm.hound.voice`, owner only (`setVoice`), audit `firm.voice_changed`.
- TH-VOI-3: `client.voice`, staff (`setClientVoice`); blank means the firm's.
- TH-VOI-4: `{sign_off}`, set by the firm, up to 30 characters, used by Warm and Professional; checked for digits.
- TH-VOI-5: every version passes `outputCheck` with the longest realistic values, in a test and whenever an owner edits wording.
- TH-VOI-6: a live preview on the settings page, built from sample data (Maria, Maple & Pine Tax Co.), never a real client.
- TH-VOI-7: every automatic message records `voice`.
- TH-VOI-8 (V1): an owner's wording edits are kept per voice.
- Warm aims at 200 characters, Brief at 100 with no sign-off and the firm's name in the first 40 characters.

### F5 Barks and the review queue (BRK)

Today: `S.tasks` (kinds document, question, says_none, call, output_check), `S.alerts`, the morning note and urgent email in `apps/server/src/notify.ts`, per-person switches for those two.

- A bark is one alert to one person: how many things in the review queue need them, by kind, with a link to the queue filtered to theirs.
- TH-BRK-1: opening a task queues a bark for the people its routing names. In the app within a minute; by email within five unless batched.
- TH-BRK-2: at most one bark per person per `BARK_BATCH_MIN` (30), with counts by kind.
- TH-BRK-3: routing by kind: the client's preparer by default, owners for system kinds, a client with no preparer goes to all owners; the firm can add owners or named people per kind (`firm.barkRules`).
- TH-BRK-4: each person chooses channels (in the app, email; text in V1) and kinds.
- TH-BRK-5: outside the app, first name and last initial only.
- TH-BRK-6: outside staff hours (`firm.staffHours`, default 8:00 to 18:00 on working days) barks are held for the morning note.
- TH-BRK-7: one escalation bark to owners when a task has waited more than one working day.
- TH-BRK-8: a bell with unread count and bark history; opening the queue from a bark marks it read.
- TH-BRK-9: every item shows "What Tallyhound knows" and "Suggested next step", chosen by fixed rules, never by the model.
- TH-BRK-10 (V1): text barks to a staff member's verified mobile, from Tallyhound's own number.
- TH-BRK-11: the morning note's subject is "Tallyhound: n things in the review queue".
- Where it lives: bark rows are saved outside the firm's sealed state (ids and counts only), in `apps/server/src/barks.ts` with a Postgres table; the engine decides who a task routes to.

### F2 Reply understanding (RPL)

Today: keywords in code first, then the model's reading (`prompts.readText`) checked by the engine in `inboundText`.

| New intent | The engine does | The client hears |
|---|---|---|
| `someone_else_has_it` | If the named role is a linked client who agreed to messages, move the item to them and ask them next. Otherwise note it on the item and open a question | M34: thanks, we'll ask them or follow up |
| `already_sent` | Look for a matching document in the last 21 days. Say it is being checked, or ask again with the upload link | M35 |
| `life_change` | Never edits the checklist. Opens a `change_noted` item with a suggested add or remove for one-click approval | M36: thanks, passed to your preparer |
| `send_after_date` | Quiet until that date, at most 30 days out; an unreadable date falls back to "will send later" | M20 with the date |
| `not_mine` | Stops automatic messages on that conversation at once and opens an urgent question | M37: sorry, we'll check and stop |

(The spec numbers these M21 to M24; those codes are taken here, so they are M34 to M37.)

- TH-RPL-1: contract `reply-v2`: intent, confidence, item, person (a role, never a name), date, change. Keywords are still handled in code before any model call.
- TH-RPL-2: the engine acts only through templates and state changes.
- TH-RPL-3: staff see one line on the thread, built from the structured answer: "Understood: sold the house. Suggested: remove 1098. Waiting for you."
- TH-RPL-4: anything below high confidence becomes a question for a person.
- TH-RPL-5: accepting a `change_noted` item applies the edit and logs `checklist.change_from_reply`.
- TH-RPL-6: the same intents in Spanish.
- TH-RPL-7 (V1): a reply with a document and an intent does both.
- Validation in code: the item must be on the client's open list, the form in the catalogue, a date more than 60 days out is dropped; a failure becomes a question.
- Evaluation: a labelled set in `tools/evals/` with the spec's gates, and a shadow switch that classifies with v2, logs the result and acts on v1.

### F6 Smarter every season (MEM)

Today: `rollSeason` archives the old file and carries the checklist forward; `history(cid)` reads it.

- TH-MEM-1: when a file closes, one outcome record per item: form, payer, owner role, outcome (received, waived, said none), waive reason code, number of asks, days to receive, channel.
- Waiving asks for a reason: sold home, account closed, no longer employed, not this year, combined elsewhere, other. The first three are lasting.
- TH-MEM-2 and 3: next season's proposal uses last season first; carried items show "From 2026".
- TH-MEM-4: items waived for a lasting reason are proposed as "Removed last season" for a person to confirm.
- TH-MEM-5: items that took three or more asks show "Slow last year" and are asked first.
- TH-MEM-6: a "Last season" panel on the client page; an owner can clear one client's memory.
- TH-MEM-7 (V1): after three replies in the same two-hour window, schedule that client's sends at the start of it.
- TH-MEM-8: an owner switch turns memory off for the firm.
- TH-MEM-9: memory is in the client's deletion and export.

## 6. Differences and decisions

| # | Question | What the sources say | What is built unless told otherwise |
|---|---|---|---|
| 1 | Does the model write client messages? | The feature spec says no (templates only). The content book and brand book say AI writes each request. This product already lets the model reword a template, behind `outputCheck`, with an owner switch | Voices are hand-written templates and are what goes out when the switch is off or the check fails. The existing owner switch stays, and the model is told the voice. One line to change the default |
| 2 | May Warm use an exclamation mark? | Spec: no | No, in every voice |
| 3 | Persistent: up to seven automatic texts in 12 days | Spec: ship pending counsel | Built; the settings page says counsel should confirm before a firm uses it |
| 4 | Text barks to staff | Spec: V1 | Built after everything marked MVP |
| 5 | Memory on by default | Spec: on, with an owner switch | On |
| 6 | Template codes M21 to M24 | Taken in this engine | M34 to M37 |
| 7 | "Review queue" was a retired phrase in `docs/UX.md` | The brand book makes it the name of the place | `docs/UX.md` is updated; "Needs you" stays as a status |
| 8 | Storage claims | Brand book: say Google Drive now, the others next | The product has all four built but none run live. Product screens list what is configured; nothing in the product claims a provider is proven |
| 9 | The marketing website | Lives on Base44 and is the master for the hound artwork and tokens | Not changed by this work. Artwork and tokens are copied from it |
| 10 | "AI writes each request" on the website FAQ | Spec asks for the line to be corrected if decision 1 stays with templates | A website change; listed for Jordan, not made here |

## 7. Order of work

Each step ends with `npm run check` passing and a merge to `main`.

| Step | Ticket | What |
|---|---|---|
| 1 | T-148 | Tokens, fonts, logo, favicon; the staff app restyled |
| 2 | T-149 | The hound component and its places |
| 3 | T-150 | Client pages and emails under the brand rules |
| 4 | T-151 | Words: `docs/UX.md`, every screen's copy, the sample cast, the jargon test |
| 5 | T-152 | PAC fetch intensity |
| 6 | T-153 | CMP fetch until verified |
| 7 | T-154 | VOI voices, sign-off, preview; all versions written |
| 8 | T-155 | BRK barks: routing, batching, staff hours, escalation, the bell |
| 9 | T-156 | BRK the review queue: what Tallyhound knows, suggested next step, mine |
| 10 | T-157 | RPL reply understanding v2 and the understood line |
| 11 | T-158 | RPL evaluation set and shadow mode |
| 12 | T-159 | MEM outcome memory, waive reasons, the proposal, the panel |
| 13 | T-160 | The V1 items: text barks, send-time learning, intent plus document, Persistent in Progress |
| 14 | T-161 | End-to-end scenarios 1 to 12 from the spec's section 14, as browser and engine tests |

## 8. Where it stands

Built and merged, steps 1 to 13: see `docs/TICKETS.md`, round 17, entries 49 to 56. Step 14 is covered by tests named after the requirement IDs in `test/engine.test.js`, `test/pipeline.test.js`, `apps/server/test/server.test.ts` and `apps/web/e2e`. The same entry lists what is still open.

## 9. What code cannot finish

- A fluent Spanish speaker reviewing the Spanish versions (T-31).
- Counsel on Persistent and on the four new templates.
- Manar and a pilot firm approving the client wording.
- The reply evaluation on consented pilot data, and five working days in shadow.
- The website line in decision 10.
