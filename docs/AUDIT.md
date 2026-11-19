# Audit, November 18, 2026

What was tested, what was found and fixed, and what is still unproven.

## How it was tested

| Method | Size | Result after fixes |
|---|---|---|
| Random actions against the rules engine with safety checks (`tools/fuzz.js`) | 200 firms x 600 actions | 0 findings |
| Random clicking and typing through the app, desktop, tablet and phone width | 4,000+ actions, 7 runs | 0 errors, no broken text, no overflow |
| Scripted browser suites (main, Hound, live-model stand-in, focus, audit) | 5 suites | 0 errors |
| Unit tests (`npm test`) | 60 | 60 pass |

The safety checks in the fuzzer: no text without consent, no Hound message during a staff takeover, no proactive message outside sending hours or on a Sunday, no message with an unfilled blank, a complete file has nothing outstanding, a file with nothing outstanding is complete, save and reload gives the same state.

## Bugs found and fixed

| # | Bug | Effect on a firm | Fix |
|---|---|---|---|
| 1 | Waiving or removing the last outstanding item left the file "collecting" | Finished clients kept getting chased | Status is reconciled after every action; the client gets the "that's everything" message |
| 2 | An incomplete document on a complete file left it marked complete | A missing page could be lost | The file reopens |
| 3 | Staff "ask again" or "re-ask" sent a text immediately, even at 10 pm or on a Sunday | Texting clients at night | Held until sending hours |
| 4 | A staff message could go by text to a client marked opted out | Compliance risk | Blocked, with the reason shown |
| 5 | With no office phone set, messages read "call us on ." | Embarrassing first message for a new firm | Wording adapts when there is no phone |
| 6 | "We need 1 documents" | Looks automated and sloppy | Singular handled in English and Spanish |
| 7 | "Where do I find my W-2?" answered about a different form when the W-2 was already in | Wrong answer to a client | Answers about the form named, or says it is already received |
| 8 | Empty firm: "NaN% of the season", "Oundefined" initials, Settings pages crashed with no clients | A new firm's first five minutes were broken | Fixed, with a sample client used for previews |
| 9 | Phone width: Clients header and four Settings pages overflowed | Sideways scrolling on a phone | Fixed |
| 10 | Very long names broke the layout | Cosmetic | Text wraps; inputs capped |
| 11 | Bulk template assignment reopened complete files | Finished clients chased again | "Leave complete files alone" is on by default |
| 12 | Blank staff message could be sent; bad reply email could be saved | Data quality | Validated |

## Added because the audit showed a gap

- **Checklist from last year's return.** Upload the return, Claude lists the documents and payers, staff tick what to add. This is the feature every competitor leads with.
- **"What else do you need?"** The Hound answers with the open list instead of handing it to staff.
- **Tax year setting** for new clients.

## Against Soraban, capability by capability

Soraban's side is from its public pages. It has not been tested hands-on. Book a demo before quoting any row to a customer.

| Capability | Soraban (public material) | Tallyhound | Standing |
|---|---|---|---|
| Checklist from prior-year data | Yes, core feature, from tax software data | Templates, recommendations, and reading the return itself (demo; legal gate for production) | Behind until T-46 ships; no tax software import by design |
| Client sends documents | Secure link by email or text, no password | Reply to the text with a photo, email attachments, or a no-login upload page | Ahead on effort for the client |
| Document recognition | Type, tax year, taxpayer name, flags errors | Same, plus required parts per form and legibility, as three named checks | Ahead, unproven at volume |
| Chasing the exact missing part | Not described | Yes, names the part and keeps the item open | Ahead |
| Reminders | SMS, email, voicemail | Text, email, call script for staff | Behind on voicemail (T-50) |
| Replies to clients | AI drafts, staff approve and send | Copilot (same) and Autopilot (sends itself inside safety rules), handoff by category | Ahead |
| Understanding free-form replies | Not described | Intent, "don't have it", "later", "what's left", frustration, opt-out wording | Ahead |
| Staff control | Not described | Take over, hand back, alerts, decision log for every action | Ahead |
| Setup | 2 to 4 weeks, onboarding fee | CSV or one-by-one, target under an hour, no fee | Ahead, target not yet timed (T-42) |
| Price | Per return, 250-return minimum | Flat monthly, no minimum (working figures) | Ahead for firms under about 500 returns |
| Questionnaire | Long dynamic organizer | Yes or no questions only | Different on purpose |
| Data entry into tax software, e-signature, payments, delivery | Yes | No, out of scope | Soraban wins if the firm wants one tool for everything |
| Track record | Six seasons, hundreds of firms, SOC 2 | None yet | Behind; pilots are the answer |
| Multi-document PDF split | Not confirmed | No (T-48) | Unknown |
| Client time zones | Not confirmed | No (T-47) | Must fix before launch |

## Still unproven

- Accuracy of the three checks on real photos (T-43, T-44). Everything above assumes the model reads well enough.
- Live texting, email and Claude at volume. The adapters have never run against real services.
- Spanish wording has not had a native review.
- Legal: Manar's clearance, Section 7216 consent, model provider terms, and the opt-out rule.
- "Perfect" is not something a test run can show. What the audit shows is that 120,000 random actions and 4,000 random clicks no longer break a rule or a screen.


# Round 3, November 18, 2026 (evening)

New angles this time: injection, scale, messy client lists, keyboard and labels, time zones, and files that are not active.

## How it was tested

| Method | Size | Result after fixes |
|---|---|---|
| Engine fuzzer with new checks: client-local sending hours, three-a-day cap, silence before start and after close, hostile CSVs | 250 firms x 600 actions | 0 findings |
| Injection sweep: an HTML payload planted in every stored field, every screen visited | 60+ screens and tabs | 0 payloads rendered |
| Scale: 1,500 clients imported, started and run for three days | 1 run | No errors; timings below |
| Accessibility check: labels, names, keyboard reach, dialog focus | every screen | 0 real findings |
| Random clicking, three widths | 3,000 more actions | 0 findings |
| Unit tests | 70 | 70 pass |

## Found and fixed

| # | Finding | Why it matters | Fix |
|---|---|---|---|
| 13 | A client's name was drawn into the document preview without escaping | A crafted name could run script in a staff member's browser. Security bug | Escaped; sweep now covers every field |
| 14 | The CSV importer broke on quoted commas, "+1" phone numbers, semicolon or tab files, and a single Name column | 5 of 8 realistic exports failed. This is step one of the product | Rewritten parser; reads all eight; strips markup and formula characters |
| 15 | A document sent before outreach started triggered "Next: your ..." requests | Chasing a client whose checklist nobody had confirmed | Checked and thanked only (M27) |
| 16 | A document or email on a closed file restarted requests and reminders | Chasing a finished client | Goes to staff, one acknowledgment, no chasing |
| 17 | Sending hours ignored where the client lives | A Pacific client of a Central firm could be texted at 6 am | Zone per client; hours judged on the client's clock |
| 18 | On a UTC server the engine would have read UTC as the firm's time | Every send six hours off in production | `pipeline.wallTime` and `firm.iana` |
| 19 | Every action re-checked every file | One text took 89 ms at 1,500 clients, starting outreach 2.8 s | Only the touched file is re-checked: 2 ms and 0.17 s |
| 20 | The client list drew every row on every click | 36,000 page elements at 1,500 clients | 200 rows at a time |
| 21 | Rows and document thumbnails could not be reached by keyboard; dialogs did not take focus; two inputs had no label | Keyboard and screen reader users were stuck | Fixed |
| 22 | A failed save still said "Not saved yet" | Misleading | Says the workspace is too large for the demo |

## Measured at 1,500 clients (demo, one browser tab)

| Action | Time |
|---|---|
| Import 1,500 rows | 35 ms |
| Start outreach for all | 171 ms |
| Three simulated days | 360 ms |
| One inbound document or text | 2 ms |
| Open the Clients screen | about 270 ms |

## A decision this round surfaced

One saved workspace per firm grows to about 6 MB for 500 clients over a 45-day season. That is fine for pilots and wrong beyond them. See T-54.

## Still unproven (unchanged)

Model accuracy on real photos, live texting and email, Spanish review, legal sign-off, and a screen reader pass by a person.


# Round 4, November 18, 2026 (night)

Angles: long names against message limits, Copilot approvals at odd hours, consent sequences, shared contact details, hand-off file names, holidays, retention, repeated provider deliveries, and every guided demo scenario end to end.

## How it was tested

| Method | Result after fixes |
|---|---|
| Targeted probes for each angle above (`tools/` and `test/round4.test.js`) | All pass |
| Engine fuzzer, now mostly Copilot firms, with clock jumps to night and random purges | 200 firms x 600 actions, 0 findings |
| All 18 guided demo scenarios run to the end | 0 errors |
| Pipeline tests with a repeated webhook, a formatted sender address, a carrier opt-out, a night approval | Pass |
| Browser suites, crawls and injection sweep rerun | 0 findings |
| Unit tests | 82 pass |

## Found and fixed

| # | Finding | Why it matters | Fix |
|---|---|---|---|
| 23 | Holiday list stopped at Memorial Day 2027 | Reminders would go out on July 4, Thanksgiving, Christmas and every holiday in 2028 | Computed for any year, with observed days |
| 24 | Spanish messages naming Form 1095-A were blocked by the safety check | Spanish-speaking clients with marketplace insurance were never asked automatically; staff got a "message blocked" task each time | Form numbers are allowed digits |
| 25 | In Copilot, a draft approved at 11 pm was sent at 11 pm | Night texts, caused by a staff click | Held until the client's sending hours |
| 26 | Unapproved reminders stacked up, five in ten days for one client, with no alert | Approving them all would send five texts | A newer draft replaces the older one; a stale draft raises an alert |
| 27 | A draft could be approved after the client opted out | Compliance risk | Drafts are discarded on opt-out; approval is refused |
| 28 | Every repeat STOP got another confirmation text | Carriers expect one | One confirmation |
| 29 | Documents were never deleted when the retention period ended, and a manual purge kept the image | The Settings page promised deletion. Privacy bug | Automatic deletion; image, model reading, payer and message text are cleared |
| 30 | Two documents with the same form and no payer got the same hand-off file name | One file would overwrite the other in the firm's folder | Names are made unique |
| 31 | A webhook delivered twice was processed twice | Double replies and duplicate documents whenever the provider retries | Deduplicated by provider id |
| 32 | An email from "Jo Day <jo@x.example>" did not match the client | Most real email arrives in that form; it would all have gone to the unmatched tray | Address is parsed |
| 33 | A carrier "unsubscribed" error was treated as an ordinary failure | The system would keep trying to text | Consent is withdrawn |
| 34 | "Duplicate of an existing client" did not say which client | Staff could not resolve it | Names the client and the shared detail |

## Checked and found sound

Consent sequences (STOP, START, HELP in any order), START resuming outreach, no text after opt-out over six days, every message under 320 characters with the longest realistic names (longest is 298), and all 18 guided scenarios.

## Decisions this round surfaced

- Households sharing a phone or email (T-58).
- Outbound messages can be sent twice if a save fails (T-59). This needs building before real texts go out.


# Round 5, November 18, 2026: ease of use

Method: counted controls, words and jargon on every screen; walked the first-run path from an empty firm and counted clicks; looked at each screen as a first-time user would. Then reran every suite.

## Found and changed

| # | Problem | Change |
|---|---|---|
| 35 | A new firm landed on a wall of zeros that said "Nothing needs you. Tallyhound is collecting for everyone else." with no clients | Three numbered steps on Home until the first requests go out; only the current step has buttons |
| 36 | Three menu badges for three overlapping work lists (Hound, Review, Inbox) | One "Needs you" list with one badge, including drafts to approve |
| 37 | Eight menu items of equal weight | Four main items; the rest under More |
| 38 | The Hound page: six tabs and ten filters named in system terms | Renamed in plain words; an empty state before anything has started |
| 39 | Home showed two rows of numbers that overlapped | One row (the five steps) and one line of proof |
| 40 | "Start outreach" was offered when nobody could be started | Shown only when it can act; reworded "Start collecting" |
| 41 | The Clients screen with no clients said "No clients match. Clear filters" | "No clients yet" with Import and Add buttons |
| 42 | Pasting a list was hidden behind a closed disclosure | Visible by default |
| 43 | After import, the finish screen did not lead anywhere | "Next: choose their checklist" |
| 44 | Demo controls and a simulated clock sat in every firm's menu | Collapsed as "Test tools" outside the sample firm; the guided demo button is hidden there |
| 45 | Jargon: outreach, consent, handoff, playbook, queue, stuck, unmatched, deliver, reasoning | Replaced; see the vocabulary in `docs/UX.md` |
| 46 | Bug: a document from an unknown sender crashed the page in a firm with no clients | Fixed |
| 47 | Bug: a very long firm name pushed Settings wider than the screen | Fixed |

## Measured

| | Before | After |
|---|---|---|
| Clicks from empty firm to collecting | no guided path | 10 |
| Main menu items | 8 | 4, plus 4 under More |
| Menu badges | 3 | 1 (plus unknown senders) |
| Controls on an empty Home | 7, none useful | 3, all useful |

## Not done, and why

- Undo for destructive actions (T-66): needs an action history the demo does not have.
- The Hound page still carries a lot. It is the power-user screen; the daily screens are Home and Needs you.
- No real user has tried any of this. Everything above is my judgement plus counts. T-64 is the test that matters.


# Round 6, November 18, 2026: the check-in, and more ease of use

## Built

**The check-in.** Before collecting starts, the firm sends a link. The client taps what applied this year, or taps once to say it was about the same as last year. The answers come back as a proposed checklist. The CPA ticks what to add and remove, then confirms and starts collecting in one click. While collecting, if the client mentions something new, a suggestion is raised for a person.

| Step | Where |
|---|---|
| Send to one client, to a selection, or to everyone not yet started | Client checklist, Clients list, get-started step 2 |
| Client taps (18 tiles, employer counter, optional note; English and Spanish) | The client's phone, Upload page |
| Proposed adds and removals with the client's own answer as the reason | Review card on the client's checklist; a row in Needs you |
| Confirm and start, or confirm only | Review card |
| Optional: simple check-ins start on their own | Settings, Checklist templates |
| Mid-collection suggestions | Needs you, and the Suggested tab |

## Bugs found while building it

| # | Finding | Fix |
|---|---|---|
| 48 | A check-in sent at night would have texted at night | Held until the client's sending hours |
| 49 | "About the same as last year" proposed a property tax bill because the client owns a home | "Same" proposes nothing; otherwise only what the client changed is proposed |
| 50 | The status chip said "No consent" | "Not OK to text yet" |

## Tested

92 unit tests pass. The fuzzer now sends check-ins, answers them at random, applies them and feeds in "something new" messages: 200 firms x 600 actions, 0 findings. A browser test walks the whole flow on the client's phone and the firm's screen. All earlier suites, crawls, the injection sweep and the 18 guided scenarios still pass.

## Honest limits

- The topic spotter is a fixed phrase list. It will miss unusual wording (T-71).
- The check-in decides which forms to ask for, not who the payer is. A new W-2 is requested without the employer's name (T-72).
- The tiles map to 18 situations. Unusual ones (foreign income, crypto mining, a farm) go in the note and to a person.
- No client has used it. Two minutes is a target.


# Round 7, November 18, 2026: closing the check-in's limits

| Limit after round 6 | Now |
|---|---|
| New topics were spotted from a fixed phrase list | Claude reads every text, email and check-in note and may answer with any of twenty fixed keys, or a few words for something unusual. The phrase list still runs as a backstop when the model is off |
| The check-in picked the form but not the payer | After the tiles, an optional step asks who each new item is with. The first request then names it |
| Eighteen situations; anything unusual went to a person as a bare note | Twenty tiles, a "Something else" tile that requires a few words, and the model turns the note into up to three suggested custom requests. The CPA can accept, edit or type their own |
| Check-in or ready-made checklist first? | Check-in first, everywhere. Ready-made checklists are the fallback, and a client who does not answer in a week starts with the checklist on file |

Safety rules that hold for all of it, each with a test:

- The model's output is limited to the twenty keys and short plain text. Unknown keys are dropped. Text is stripped of markup and template braces.
- Nothing the model reads adds or removes a checklist item. It creates a proposal or a suggestion that a person accepts.
- A note or a custom request always stops a check-in from starting on its own.
- In the pipeline, topics and custom requests can only come from the model's reading on the server. Values sent by the browser are discarded.

Tested: 101 unit tests pass. The fuzzer now feeds hostile payer names, custom text and model output: 200 firms x 600 actions, 0 findings. Two browser tests walk the flow with and without a stand-in for Claude. The injection sweep covers the new fields. Not tested: the live model's accuracy at spotting topics (T-71), and any real client.


# Round 8, November 18, 2026

## Fresh angle: saves from older versions, and damaged saves

A user's saved workspace is written by whatever version they last used. Tested: a workspace saved by each of the eight earlier engine versions, loaded into the current one and worked hard; then the app opened on those saves and on corrupted ones.

| # | Finding | Fix |
|---|---|---|
| 51 | A damaged save could leave the engine half-loaded | Loading checks the shape first and leaves the current workspace untouched if it is wrong |
| 52 | Older saves lacked newer fields | Missing lists and settings are filled with safe defaults on load |
| 53 | Season data reused a field name that pausing already used, so resuming a rolled client would have broken its status | Renamed; test added |
| 54 | "Outreach started" still appeared in one message | Reworded |

## The four open items

| Item | Now |
|---|---|
| Live accuracy of topic reading (T-71) | A sixty-message set, a command-line scorer and a one-click check in the demo. Baseline for the phrase list alone: 15 of 36 found, 2 of 24 false. **The live number still has to be produced by running it; I could not call the live model from the build environment** |
| Custom requests on arrival (T-74) | Matched to the closest open request from the model's description; staff confirm or choose another in one click; an unclear document is never matched silently |
| Spanish custom requests | Translated by the model when added, editable by staff, and the checklist shows which ones still lack Spanish wording |
| Outbound double-send (T-59) | The pipeline now claims and saves each message before calling the provider and records the answer after. If that record is lost the message is flagged for a person and never resent |

## The three advantages

Season roll-forward, sign-up to first message, and flat pricing are covered in `docs/MOAT.md` (status table) and `docs/PRICING.md`.

## Tested

115 unit tests pass. Fuzzer with season rolls, custom documents and Spanish wording, plus checks for orphaned records and duplicate files: 200 firms x 600 actions, 0 findings. Eight browser suites, three crawls, the injection sweep and all 18 guided scenarios pass.

## Honest limits

- Texting cannot be live in an hour. Carrier registration takes one to three weeks. Email can.
- Roll-forward has only been run on simulated seasons.
- The cost figures in `docs/PRICING.md` are my assumptions.
- Last season's documents leave Tallyhound at roll-forward. A firm that rolls early loses access here to files it may still want; they are in its hand-off folder.


# Round 9 (November 18): pricing model, uploads, files that cannot be opened

## Pricing changed

There is no permanent free plan. A firm gets a 14-day trial, then must choose a paid plan. A paying firm can pause for the off-season: data is stored, nothing runs, the firm has no access, nothing is billed, and it switches back on by itself on the date chosen. See `docs/PRICING.md`.

## Found and fixed

| # | Problem | Fix |
|---|---|---|
| 1 | Staff could still send a message by hand while the firm was paused or its trial had ended (found by the fuzzer) | `manual` refuses when access is off |
| 2 | "Where do I find it?" about a custom request produced "comes from ." (found by the fuzzer) | Goes to a person with the hand-off message |
| 3 | A PDF holding several forms was read as one document | Pages are grouped into documents, each is checked, one reply is sent |
| 4 | Several photos in one text got several replies | One combined reply, shortened to fit a text |
| 5 | A locked PDF only showed staff an error. The client heard nothing | The client is asked for an unlocked copy or a photo. A second one goes to Needs you |
| 6 | Files that are not photos or PDFs were dropped silently | The client is asked for a photo or a PDF |
| 7 | Email signature logos would have been read as documents | Inline and tiny images are skipped |
| 8 | Staff had no way to add a document that arrived on paper or in their own inbox | "Add a document" on the Documents tab. The client is not messaged |
| 9 | A bad photo was only caught after sending | The upload page checks it on the phone and offers Retake or Send anyway |
| 10 | On a phone the client list scrolled sideways and the top bar overflowed | The list fits the screen: name and status |

## Tested

131 unit tests pass (16 new). Fuzzer with billing, pause, staff uploads, bundles and unopenable files: 200 firms x 600 actions, 0 findings, including "nothing is sent while paused or expired". Nine browser suites, crawls at desktop and phone width, the injection sweep, 18 guided scenarios and the ten-click first run: clean.

## Honest limits

- Billing is state only. No card is taken, no invoice is sent (T-81).
- Splitting a multi-form PDF has only run against a stand-in model. Real brokerage packets are the hard case (T-85).
- The photo checks use guessed thresholds (T-89).
- HEIC conversion and server-side PDF rendering are tickets, not code (T-86, T-87).
- The earlier limits still stand: live model accuracy, live texting and email, legal clearance, and no real user has tried the product.

# Round 10 (November 18): every control questioned

A review of meaning rather than function: 199 controls on 24 pages, each asked "why is it here and is it clear". The full table is in `docs/UX.md`. The headline items: one "needs you" count instead of three, plain names for all 38 messages, grouped activity, internal codes removed from the screen, and dollar amounts removed from the document reader (prompt, storage and viewer), which was a scope leak. 135 unit tests pass. Fuzzer, nine browser suites, crawls at two widths, injection sweep and guided scenarios: clean. Not done: merging the three attention surfaces (see UX.md), and no real user has seen any of it.


# Round 11 (November 18): pricing review and the five open decisions

**Pricing.** A cost model built from published prices (`tools/cost-model.js`, results in `docs/PRICING.md`). A normal client costs about $0.63 a season, of which texting is 78%. Prices hold. One plan did not (old Firm, 47% margin under heavy use) and was split into Firm (1,000 clients) and Large (2,500).

**Decisions built.**

| Decision | What the product does now |
|---|---|
| Pause | Opt-in only, never automatic. At most 90 days in any 12 months. Every firm pays at least 9 months a year |
| Trial | 14 days, 10 clients, 100 documents checked. The whole list can be imported. Worst-case cost about $1.74 |
| Clients during a pause | One automatic reply, at most weekly, asking them to contact the firm directly. STOP and HELP still work |
| Three places asking for attention | The Hound's "Questions for you" and "Alerts" tabs are gone. Questions and calls are in Needs you. The bell is for news |
| "The Hound" in the menu | Kept, with "your assistant" beside it |
| Settings | "Connections" and "Text number" are one page, "Email, texts and AI". Ten tabs |

**New protection.** A fair-use allowance per plan (60 text segments and 25 document checks per client a year). Going over never stops collecting and never adds a charge: reminders move to email. A usage meter counts what each firm uses, so the cost model can be checked against real numbers.

**Found on the way.** Spanish texts with accented letters bill at 70 characters a segment, not 160. The engine now counts segments the way carriers do.

**Tested.** 151 unit tests (16 new). Fuzzer with billing, pause, trial and usage checks: 200 firms x 600 actions, 0 findings. Nine browser suites, crawls, injection sweep, guided scenarios: clean.

**Honest limits.** Usage figures are assumptions until a real season is metered. No card is taken yet (T-81). Nobody has been asked what they would pay.

# Round 12 (November 18): the questions after opt-in

Built to Jordan's description: after a client opts in, the questionnaire can go out as a one-time text, automatically or when the firm sends it, and the firm can bypass it for one client, several, or everyone. Details in `docs/UX.md`. The default is off, because most firms do this on a call. 163 unit tests pass (12 new). Fuzzer checks that the questions are never texted twice, never without consent, never followed by a reminder and never sent to a skipped client: 200 firms x 600 actions, 0 findings. Ten browser suites clean.

Not proven: whether clients answer a questionnaire sent by text. That needs pilot data. The 2-day wait is a guess.

# Round 13 (November 19): data, security, connections, onboarding

Jordan asked for everything to be looked at again from the bottom up: database, back end, how email and text connect, how documents are stored and dumped, how to avoid keeping personal information, how clients are brought in, and whether open APIs exist.

## What was wrong or missing

1. **The app promised connections that do not exist.** Settings showed "Connect Gmail", "Connect Outlook", tax software tiles and a Developer card. None can be built as shown: the tax programs have no API and reading a mailbox needs a yearly outside security review. Rewritten to what is real.
2. **Nothing was ever deleted on a schedule.** Document copies stayed until a client's file was closed and purged. Now: 30 days after delivery, 7 days for rejected files, 30 days for unknown senders, 400 days at most, all adjustable by an owner within limits.
3. **A Social Security number typed into a text was stored as typed.** Now removed before storing and before the model sees it. Same for card and bank numbers.
4. **Import would have read an SSN column if someone mapped it.** Now such columns are recognised and cannot be mapped.
5. **Attachments from an unknown email address were dropped.** A spouse writing from their own address lost the file without a word. Now kept for a person to file, with a daily cap.
6. **Mail was trusted by its From line.** Anyone could file a document to a client by typing that client's address. Now the receiving server's sender check decides, and failures wait for a person.
7. **Deleting stopped when a firm paused or its trial ended.** Found by the fuzz tool, not by reading. Fixed: deletion runs regardless of billing state.
8. **Stored bytes were never actually removed.** The engine forgot a document; the file stayed in the bucket. Now the pipeline deletes it, after the state that forgets it is saved, and retries on failure.
9. **Files that arrived during a pause kept no link to their stored copy after being read.** Fixed.
10. **Text number registration started at sign-up,** costing a registration for every trial. Now starts when a plan is chosen.
11. **Twilio's webhook signature was a comment, not code.** Written and tested.
12. **A new firm's Home did not say what had to be connected.** Added "Connect once": email (ready), text number, where files go.
13. **Import assumed the firm knew how to get a list out of its tax program.** Added the menu path for Drake, Lacerte, UltraTax and ProSeries.
14. **The import screen made everyone pick a source before uploading.** Caught in regression. The upload box is now always there.

## Built

Engine: `scrub`, retention schedule and sweep, `deleteDocsNow`, `dataMap`, hardened `parseCSV`/`importRows` (sensitive columns, client number, update on re-import, name clean-up), sender state "none".
Kit: `crypto.js` (key per firm, sealed state and files, key destruction), `postgres.js` + `db/schema.sql`, `email-inbound.js`, `importers.js` (Karbon), Twilio signature and media handling, pipeline file deletion, sender check, forwarded mail, `openFile` with logging, `destroyFirm`, `tools/scale.js`.
App: import source picker with export steps, "Connect once" card, Security and data page, honest Connections and "Where files go" pages, delete-now, deleted-copy display.
Docs: ARCHITECTURE, SECURITY, INTEGRATIONS. Tickets T-100 to T-115.

## Tested

192 unit tests (29 new). Fuzz: 200 seasons of 600 steps with new checks after every step (no ID number stored, nothing kept past its time, limits hold): 0 findings. Browser suites 2 to 11: 0 errors. Random-click crawls at 1500 and 390 wide: 0 findings. Injection sweep: 0. First-run walk: 11 clicks from empty to collecting. 18 guided scenarios: 0 problems.

## Honest limits

* The Postgres store has only run on an emulator with no real locking.
* The key service, mail service, Twilio and the model have never been called for real from this code.
* The storage connectors are simulated in the demo and not built.
* The SSN filter is pattern matching. It catches the usual ways people type one. It will miss "one two three..." and will not find one inside a photo, which is the whole content of a W-2.
* The sender check depends on what the receiving mail service reports. Auto-forwarded mail from domains without DKIM will wait for a person. How common that is, nobody knows until the pilot.
* The scale numbers are from synthetic clients on one machine.
* The Karbon field names come from Karbon's published guide, not a live account.
* No outside security review of any kind.

# Round 14 (November 19): end-to-end walk-through

Jordan asked for the whole platform to be thought through with no gaps: sign-up, onboarding, adding clients, checklists, messaging, email and text connection, AI reading and replying, document intake and checking, security, where documents end up, and things not yet thought of. See `docs/GAPS.md` for what was fixed and what is open, and the shared doc for the full walk.

New outside facts checked this round: Twilio's registration rules for firms with and without a tax ID and the need for a website and clear consent wording; Twilio's 5 MB picture-message limit and unreliable PDF delivery by text; Treasury Regulation 301.7216-2(d) on sharing return information with a United States service provider; Anthropic's documented PDF limits (100 pages per request on standard models, no locked PDFs) and zero-retention eligibility.

Honest limits: none of the new behaviours has run live. The firm check is a switch with no procedure behind it yet. Routing on a shared phone depends on the model reading the first name on the document. The "wrong number" detector is a short list of phrases.
