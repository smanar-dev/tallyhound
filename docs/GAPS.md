# Gaps: round 14, November 19, 2026

The product was walked end to end in the order a firm meets it: sign-up, setup, adding clients, checklists, consent, email, texts, the AI, documents, storage, running it. The full write-up is a shared doc: https://claude.ai/artifact/1HfkYMxE4StypJPdYwYbUz

## Fixed in this round (engine, pipeline, app, tests)

| Gap | Fix | Where |
|---|---|---|
| Anyone could sign up and message strangers for W-2s | `firm.verified === false` makes `access()` return not ok: nothing sends, nothing is read, deletion carries on. `setVerified` flips it and suspends a firm later | engine |
| A second household member on the same phone or email was refused | Accepted. `pick` and `ownerOf` in the pipeline route a text to whoever was written to last and a document to the person named on it | engine import, pipeline |
| A client with a mobile and no email could never be texted | `recordConsent(cid, how)`: staff attest to consent the firm holds; logged with their name; the client gets the confirmation text | engine, app |
| Texts kept going to a reassigned number | "wrong number" / "who is this" stops texts, sets `mobileBad`, alerts. Only the client's own confirmation page or a corrected number clears it | engine, app |
| A link instead of a file | Template M30K asks for the file itself, English and Spanish | engine |
| No bulk way to set checklists | A "Documents needed" column on import (`listForms`) | engine, app |
| Files reached the firm's storage only when a client was complete | `delivery.when = "each"` | engine, app |
| Agreeing to texts started collecting for a client the firm had not started | `giveConsent` returns a never-started client to "not started" | engine (found by fuzz) |
| Unrequested check-in answers could push a trial past its client limit | Refused when the trial is full | engine (found by fuzz) |

201 tests. Fuzz 200 x 600 with the new behaviours and checks: 0 findings. Browser suites 2 to 12: 0 errors.

## Open

See tickets T-116 to T-133 in `docs/TICKETS.md`. The ones marked BEFORE PILOT are the list.

# Round 15, November 19, 2026: closing the list

Jordan asked for the open list to be solved, not ticketed. What changed, in his order.

## The original goes to the firm first

With storage connected, the firm chooses when files reach it. The new default is "the original the moment it arrives".

1. A file arrives. Tallyhound seals its own working copy and, in the same event, puts the untouched original into the firm's storage under `Client Tax Docs / 2026 / Day, Jo / _To check`.
2. The working copy is read and checked.
3. Accepted: the firm's file is renamed into the client's folder as `2026 W-2 Acme Logistics.pdf`. It is a move, not a second copy. Rejected or duplicate: moved to `_Not used`. Needs a person: stays in `_To check` until staff decide.
4. Tallyhound's working copy is deleted 7 days after delivery (was 30; the firm can set 0 to 365).
5. If the firm's storage is failing, Tallyhound keeps its copy past the keep-for time, keeps trying, and alerts the firm after three failures. A copy is never let go until the firm's own is confirmed in place.

Built in `fileJobs` (pipeline) and `masterFirst`/`strip` (engine), tested with a stand-in for the storage. The Google Drive adapter is written against the published API and has not run on a real account.

## Reading accuracy: measure it, and stop depending on it

* **A second, independent reader.** A PDF made by a payroll company, bank or broker carries its own text. `precheck.fromText` reads the form and tax year from that text with plain rules. When it and the model agree the document is marked as read twice. When they disagree nobody is trusted and a person looks. When the model is down, such PDFs are still identified. This does nothing for phone photos, which have no text.
* **A check inside the app.** Settings, Email, texts and AI: "Accuracy check: reading documents" draws 48 test photos (six kinds of form, each clean, tilted, dim, wrong year, wrong name, cut off and blurred, plus six utility bills), sends them through the live model and the same rules, and reports the one number that matters: how many wrong or unreadable documents were accepted. It needs the live model, so it runs when Jordan opens the app, not in this kit.
* **A tool for real files.** `node tools/eval-docs.js ./testset` runs a folder of real photographs with a truth file through the production prompt, model and engine and prints wrong accepts, needless re-asks and every miss. Targets: wrong accepts 0, never above 1 in 100; needless re-asks under 1 in 10.
* Still true: no number exists yet. These are the instruments, not the result.

## A fast and legal start to texting

There is no legal way to skip carrier registration, and sharing one Tallyhound number between firms is exactly what the carriers reject. What can be removed is every other source of delay.

* A firm starts collecting the day it signs up, by email and each client's upload page, which opens the phone camera at full quality.
* Registration is filed the day the firm check passes, during the trial, without a plan (`registerSender`). It costs us about $20 a firm.
* The details are checked before filing (`registration.problems`): legal name, EIN format, street address not a PO box.
* Every firm gets a public page with the consent, STOP, HELP and privacy wording the carriers look for (`registration.firmPage`), and the same tested campaign description is filed for all (`registration.campaign`).
* Clients can agree to texts while the registration is pending, so texting begins for everyone the day it clears.

## The first message

* The firm sends its own note first. The wording is in the app with copy buttons: an email to all clients, a paragraph for the engagement letter that also records consent to texts, and a line for the website. Home shows it as a step until it is marked sent.
* The invitation now ends "To check this message is really from us, call the office at (615) 555-0100."
* The firm's public page says which number and address its messages come from and what it will never ask for.

## Every kind of return

Individual, S corporation, partnership, C corporation, trust or estate, nonprofit. Each has a starting list. Businesses get books, year-end bank and card statements, payroll reports, assets, loans and the prior return. A client can have a business or trust name; messages name it; documents are matched on it. The import reads "Business name" and "Return type" columns. Long reports are asked for as a PDF by email, not a photo.

## Also closed

| Was open | Now |
|---|---|
| Database only run on an emulator | Run on a real PostgreSQL 18 server: schema, sealed pipeline, a real row lock, and 80 simultaneous events from two servers with none lost or doubled (`test/pg-live.test.js`) |
| Sign-in not built | Emailed link, authenticator code (checked against the published standard), recovery codes, hashed sessions (`packages/core/auth.js`). The screens are not built |
| Outbound email not built | Postmark adapter and bounce handling written (`email-out.js`). Not run live |
| Storage connectors not built | Google Drive written (`drive.js`). Not run live. OneDrive, Dropbox, SharePoint not started |
| Corrected forms treated as duplicates | A corrected copy replaces the earlier one and the preparer is alerted |
| Calls to the text number go nowhere | `voiceForward` rings the firm's office |
| Long PDFs | Read from the first 90 pages, and the note says so |
| iPhone photos, renamed files, viruses | `prepare.js` identifies files by their first bytes, detects locked PDFs, converts HEIC and scans when given a converter and a scanner. The converter and scanner themselves are two packages to install (T-127) |
| PDFs by text | Requests for multi-page documents ask for the PDF by email |

## Still not solved, and why

* **Legal.** Only counsel can answer. `docs/COUNSEL_BRIEF.md` is the brief.
* **An outside security review.** By definition not something we can do ourselves.
* **Anything live.** Twilio, the mail service, Drive, the model and the key service have still never been called from this code.
* **Billing, the production screens, OneDrive, Dropbox and SharePoint.**
