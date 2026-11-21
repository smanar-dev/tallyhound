# The website's features, built (Website Feature Delta, November 21, 2026)

Source: `Tallyhound_Website_Feature_Delta_Tech_Spec.pdf`. It lists what the website shows that the product did not yet do. This file says where each part lives, what was decided on its nine open points, and where the build differs from the spec. Tickets T-162 to T-168.

## Where each part is

| Spec | What it is | Where |
|---|---|---|
| TH-PLN-1, 2, 4, 5 | The follow-up plan: every ask for one client with its day, channel and exact words, and what was cancelled, held or handed to staff | `apps/server/src/plan.ts` (`planFor`). It never schedules anything. What is still to come is found by loading that one client (`T.dumpOne`) into a second engine and letting the real scheduler run ahead, so the plan cannot drift from what is sent |
| TH-PLN-3 | The plan over the API | `GET /api/clients/:id/plan` |
| TH-PLN-6, 8 | The Plan tab: week grid, legend, wording preview by text or email | `apps/web/src/screens/PlanTab.tsx` |
| TH-PLN-7, TH-OUT-24 | Hold a document until a date, clear the hold, ask now; late forms wait for their usual issue date | Engine: `setHold`, `askNow`, `holdOf`, `heldUntil`, `releaseOf` |
| TH-CNV-1, 3 | What Tallyhound understood from a reply, what it did, what is left for a person | Engine: `panelOf` (English and Spanish rows in `PANEL`). Screen: `Understood` in `ClientPage.tsx` |
| TH-CNV-2, 6, 7 | One thread across text and email; staff choose the channel of a reply | `manual(eid, body, quiet, via)`; the pills in the composer |
| TH-CNV-4 | "I already sent that": search, move a system-matched document, never move one a person placed | Engine: `actV2`, template `M35Y` |
| TH-CNV-5 | A life change suggests checklist edits from a fixed table; a person ticks and applies | Engine: `LIFE_SUGGEST`, `suggestFor`; the checkboxes in the review queue |
| TH-SNF-1 to 5 | The sniff trace: eight steps, stops at the first that failed | Engine: `traceOf`, `keepTrace`. Screen: `Trace` in `components/Doc.tsx`. It reads `T.verdict`; it computes no check |
| TH-SNF-6, 7 | Filed as "2026 W-2 Acme Logistics.pdf"; the wrong-year reply says when the form usually arrives | Engine: `filedName`, `usualIssue` |
| TH-BRK-12 to 14 | Can't reach a client; who hears each kind; the office manager | Engine: `cantReach`, `BARK_TARGETS`, `BARK_DEFAULT`, `setBarkRules`, `setDuty`. Settings: Barks and People |
| TH-CAL-1 to 6 | The call card: who to call, what is missing, what is in; log the call; try again on a day; restart at a pace | Engine: `decideTask(id, "log_call", ...)`, `CALL_OUTCOMES`. Screen: the gone-quiet pane in `NeedsYou.tsx` |
| TH-LOG-1 to 5 | The activity log with filters and a download | Engine: `activity(clientId, kind)`. Screen: `Activity` in `ClientPage.tsx` |

Tests: `test/delta.test.js` (scenarios 7 and 10 to 17, 21, 22, and the no-amounts property), `apps/server/test/plan.test.ts` (scenarios 1 to 6 and "the first planned ask is the next message sent" over 500 generated files), `test/engine.test.js` (the rules, including scenarios 8, 9, 13, 19, 20), `apps/web/e2e/delta.test.ts` (the screens).

## The nine decisions

The spec's recommendation was followed on each. Jordan can reverse any of them.

| | Decision | What was built |
|---|---|---|
| C1 | One document per message | Kept. The plan shows one row per document; a document is asked for once the one before it is in |
| C2 | Final reminder by preset | Kept (`CADENCE_PRESETS`) |
| C3 | Hold late forms until their usual issue date | Built, with the staff override (Hold until, Clear hold, Ask now) |
| C4 | Ask the spouse | Only a spouse who is a linked client with their own OK (`setSpouse`), as before |
| C5 | Spanish | The new panel and trace words exist in Spanish and are tested. Spanish stays off for pilots until a native review (T-31, `CLAUDE.md`) |
| C6 | Blurry photo | Kept: asked again twice, then a person |
| C7 | Cut-off detection now, splitting a PDF of several forms later | Both built. Missing-part detection is the existing "required parts" check. A PDF of several forms was already read as separate documents (T-85, T-143); each is now also handed off and filed as a PDF of its own pages (`pagesToFile` in `packages/core/pipeline.js`, `pdfCut` in `apps/server/src/files.ts`). A page nobody claimed goes with the form before it, so no page is dropped. The copy Tallyhound holds stays whole. A file that cannot be cut is filed whole |
| C8 | Forms it knows | The catalogue is unchanged |
| C9 | Who hears "gone quiet" | The office manager when one is marked, otherwise the client's preparer |

## Where the build differs from the spec

- **The quiet day.** The spec puts the "gone quiet" event the day after the last reminder. This engine opens it the moment the last reminder is sent (decided in `docs/REBRAND.md`). The plan shows it where the engine puts it.
- **No separate log table.** The spec has an `activity` table with a transaction id. Here the log is read from the client's own messages, documents and timeline, which are saved in the same write as the event, so a row cannot be missing or extra. There is no second copy to keep sealed and to delete on schedule.
- **The plan is worked out, not stored.** No `plan_events` table. The staff app works it out in the browser from the state it already holds; the API route does the same on the server.
- **A document in someone else's name.** The spec says the client is told nothing. The engine used to send "passed to your preparer"; it now sends nothing for that case and a person looks first.
- **"After the 15th"** now holds the document until the 16th (it used to be the 15th).
- **Template names.** The spec's M22b is `M35Y` here (M22 was taken).
- **A document that comes off hold.** One document is asked for at a time (C1), so a document held until a date used to wait behind the reminders for another one and could be left unasked when the client went quiet. Now a document whose hold has ended is asked for next and the reminders start over from that ask (`released` in the engine). If the client has already gone quiet when the hold ends, nothing is sent by itself: the call card marks the document "not asked for yet" and Restart fetching asks for it first.
- **Not built:** a spoken-call integration for the call card (staff call from their own phone and log it).
