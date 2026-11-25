# Client import and fetch lists (November 25, 2026)

Source: `Tallyhound_platform_spec_client_import_and_fetch_lists.pdf` (November 24). It adds what v2 left implied: how clients come in, how last year's records are read, and how the firm agrees what to fetch from each client before the first letter goes. This file says where each part is, what is not real yet, and where the build differs. Tickets T-192 to T-201.

## What is not real yet

- **The reader has only read made-up files.** It meets the spec's accuracy targets on the 60-client synthetic test set (`apps/server/test/fixtures/testset.ts`), but those files were written to look like what the reader expects. The real bar is each pilot firm's organizer PDFs from its own tax software, and a shadow import of 20 of its clients with preparers marking each proposed item right, wrong or missing. Ask each pilot firm for a sample organizer before January.
- **Scans are read by the model, not by an OCR engine.** A file with no text layer, or one where the rules find nothing, is shown to the model, which may answer only with names from fixed lists. Every such reading waits for a person to confirm it. No OCR library is installed.
- **The rules table and catalog dates need a CPA adviser's review** before the season (the spec says so). The 1098-VLI furnishing date is marked "to confirm".

## Where each part is

| Spec | What it is | Where |
|---|---|---|
| Document catalog | 31 types in six groups, each with its issuer label, how it is asked for when nobody knows the issuer, when it usually arrives, its hold date, and flags (one-time, new for 2026). Firms hide types and change the phrase | Engine `CATALOG`, `catalog()`, `askPhrase`, `setCatalog`; new form codes `1099B`, `1099DA`, `1099S`, `W2G`, `1098VLI`, `UNREPORTED`, `TIPS`, `PHOTOID`, `NOTICE`. Settings, Documents |
| Firm rules | Four switches: photo ID and last year's return for new clients, ask what's new, leave one-time documents off | `FIRM_RULES`, `firmRule`, `setFirmRule` |
| Payer display names | "JPMORGAN CHASE BANK NA" shown as "Chase" | `setAlias`, `payerShown` |
| Import flow | Upload (CSV, or XLSX converted on the server), match columns by synonym (saved for the firm's next import), normalise, match on client ID then email, validate (no email, Already a client, possible duplicate, SSN-like columns dropped), attach last year's records (bulk, matched by client ID in the file name, then the name inside; the rest wait in a tray), build, review, approve. A batch keeps its state for 30 days | Engine `importBegin`, `importMap`, `importDecide`, `importRecord`, `importPlace`, `importBuild`, `importApprove`, `importView`; `apps/server/src/xlsx.ts`; `POST /api/imports/xlsx`, `POST /api/imports/:id/read`. Add clients |
| Reading prior-year data | Text per page; numbers longer than four digits and anything next to a $ dropped first; each page classified (organizer, return, source document); payer lines, schedules and "has an entry" lines; evidence (page, matched words). In the browser by default, so only findings reach the server | `apps/server/src/reader.ts` (`readPages`, `readPdf`, `stripNumbers`); engine `cleanFinding` strips numbers again; `attachRecord` |
| Model fallback and OCR | A scan, or a readable file where the rules found nothing: the model answers with names from fixed lists only, and a person confirms | `apps/server/src/priorread.ts`; `POST /api/clients/:id/records`; engine `confirmRecord` |
| Rules: findings to items | Every row of the table, with each "not proposed when" case; each item keeps its rule id and rules version | Engine `buildList`, `RULE_TEXT`, `RULES_VERSION` |
| Ready as they are, Needs a look | Ready only when every kept item came from an organizer, a source document or last season with a named issuer, for a returning client with a valid email and no unreadable files. Otherwise tags say why | `sortList`, `listOf` |
| Fetch list per return | A proposal until approved (items can be ticked, unticked, given an issuer, added); approval is version 1 and starts the season; every later change is a new version | `listOf`, `tickItem`, `setIssuer`, `addCatalogItem`, `itemNeeded`, `approveList`, `approveMany`, `approveReady` |
| Not this season | No letters, no queue items, still on the client list, back in one click | `setSeason` (status `off_season`) |
| Coming later | Held items are listed in letters under "These usually arrive later" and on the upload page with when they usually come; no reminder chases them before the date; a client whose only open items are held gets the first letter and nothing more until then | `laterItems`, `uploadList`, `stepLetter`, `releaseOf` (moved off weekends and holidays: February 16 and March 15, 2027) |
| Anything new | Fourteen choices and an optional name on the upload page; notes go to "For the preparer"; documents wait as one "New this year" queue item; already-listed ones are not repeated except a new job's W-2; the name is the issuer of the first suggestion only | `NEWS`, `clientNews`, decision `add_news`; `clientpages.ts`, `public.ts` |
| Send something that isn't on the list | Anything not on the list becomes a "Not on the checklist" queue item; a form from a renamed issuer is filed against the open item and flagged | `decide()` in the engine |
| Notes for the preparer | From the client's news, a rule (overtime, the senior deduction, Schedule SE), or the firm | `addNote`, `noteForPreparer`, `e.notes` |
| Assign an item to another person | Their own letter, their own link showing only their items, their own unsubscribe; if they unsubscribe it comes back to the client | `addContact2`, `assignItem`, `contactLink`, `stopContact`; the pipeline sends to the contact's address |
| Household | A spouse column gives one household and one return with a household name; a second return in the household (an adult child) is a second client with the same household id, and its contact details are offered, not assumed | `importMap`, `importDecide`; `c.household`, `c.householdId` |
| Rule precision | Kept, unticked, ticked by the firm, or marked not needed later, per rule | `ruleNote`, `rulePrecision`; Settings, Documents |
| Year two | When a season rolls forward, last season's filed documents are the new proposal, sorted, still needing approval | `rollForward` |

Tests: `test/fetch.test.js` (every rules-table row and its "not proposed when" cases, ready and needs a look, approval, Not this season, held items, contacts, news, the import rules, 500 rows under ten seconds, year two), `apps/server/test/reader.test.ts` (the test set's accuracy, no number over four digits in any finding, a real PDF's text layer, the test set end to end), `apps/server/test/fetch.test.ts` (XLSX, a file read on the server and not kept, the database checked for SSNs and figures, no letter before approval, the upload page, a contact's link, the model reading of a scan), `apps/web/e2e/fetch.test.ts` (the screens, browser reading with no file sent to the server, 360 px).

## Open questions (from the spec)

- Which tax software do the pilot firms use? Get a sample organizer PDF from each, and what it can export.
- Prior-year files: this build never stores them (read in the browser, or in server memory for one request). Ask whether firms want them kept.
- Counsel: does building reminders from the prior-year return need its own Section 7216 consent when a provider sends them? The Safeguards Rule plan must cover prior-year findings. State privacy terms for the news answers.
- Which CPA adviser reviews the rules table, catalog and arrival dates each season?
- Should clients see an item's reason? The default here is no: they never do.
- Confirm the 1098-VLI furnishing date in IRS Publication 1099.
- Who approves lists in practice? In the pilot any staff member can.
- Does Neeter's reply hand-off include attachments the reader can take? Same as the v2 open item.

## Where the build differs from the spec

- **No new tables.** The spec lists fifteen entities. Here a tax return is the engagement, a household is a field on the client, the fetch list lives on the engagement, items stay in the existing item list with new fields (`source`, `rule`, `why`, `evidence`, `rulesVersion`, `assignee`), and import batches, records, notes and contacts live in the firm's sealed record. They are saved with the change that caused them and are never in the database in the clear. `apps/server/src/actions.ts` is the API, as for everything else; there are no `/fetch-lists` routes.
- **Item states** map onto the existing ones: proposed unticked is `off`; Waiting is `expected` or `requested`; In, waiting for your OK is `in_review`, or `received` while a person still has to confirm the sniff test; Filed is `received`; Needs a new copy is an open item with a fix note; Not needed is `waived`.
- **Clients are created when the columns are confirmed**, not at approval. They are not started and their lists are not approved, so nothing can be sent to them. This keeps the existing client page usable during review.
- **Confirming is approving.** In an email-first firm the older "Confirm checklist" action runs the list approval (`confirmChecklist` calls `approveList` in `apps/server/src/actions.ts`), so there is no way to mark a return ready without approving its list. The staff app shows Approve list and Approve lists.
- **Files are never stored.** The spec lets the firm pick a retention period for prior-year files. Here they are read in the browser, or held in server memory for one request, and only findings are kept, which is stricter.
- **Held items now appear in letters**, under "These usually arrive later". The v2 spec's scenario 10 said a K-1 is named in no letter before its date; this spec replaces that, and the test was changed.
- **A document not on the list no longer adds itself** to the list in an email-first firm: it waits for a person as "Not on the checklist".
- **No price is stated on screen.** The spec's line "importing is free, and the $5 applies only to clients who send a document" depends on the $5 price, which is on hold. Under the current plans every imported client counts toward the plan's client limit. Decide this before the import screen is shown to a pilot firm.
- **Events** (`import.created`, `fetchlist.approved` and so on) are not a separate system: the timer and the next letter read the record directly, so an item added after approval is in the next letter within one timer pass.
- **WCAG 2.2 AA** is not checked by a tool. The browser tests check the new screens at 360 px wide and the existing accessibility of controls; a full audit is still to do.
- **After the pilot, not built:** tax software exports, bulk rule changes, notes to clients on items, approver roles, business returns.
