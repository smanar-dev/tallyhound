# Launch plan: pilot firms live by January 15, 2027

Written November 18, 2026. Eight weeks, with two holiday weeks in the middle. One or two developers working with Claude Code.

## What "launched" means on January 15
- 3 to 5 pilot accounting firms, each with their real client list loaded.
- Real texts and emails, both directions. Real photos and PDFs read by Claude.
- Every firm starts in Copilot: a person approves each message. Autopilot is switched on per firm once the accuracy numbers support it.
- You onboard each firm by hand. No self-serve sign-up, no card billing.

## In for January 15
Everything here serves one of the four steps in `docs/SCOPE.md`.

- **Client list:** sign-in with two-step codes, CSV import, add one client by hand.
- **Checklist:** templates (eight built in, firms can make their own), assign to one or many, recommendations, yes or no questions that add items.
- **Chase:** texting and email both ways, the upload page, the Hound (reading, writing, safety checks, reminders, escalation, handoffs with draft replies, take over and hand back, Copilot approvals, alerts, the decision log).
- **Check:** document reading, the three checks (right document, right information, clear to read), the review queue for anything unsure.
- Underneath: audit log, emergency stop, hand-off to Google Drive.

## Out for good unless the scope changes
Data entry into tax software. Return delivery, e-signature and payments. Engagement letters. CRM, tasks, time and billing features. A client login. Long organizers.

## Out until after launch
OneDrive, Dropbox, SharePoint hand-off. Spanish. Card billing. Public API and webhooks. Business returns. Autopilot by default. Ask the Hound actions (read-only answers are in).

## Week by week

| Week of | Developer work (ticket numbers) | Founder work |
|---|---|---|
| Nov 18 | T-01 to T-05: repo, hosting, database, sign-in, firm setup | File text registration. Publish privacy policy and terms. Engage counsel. Open Twilio, email provider and Claude API accounts. |
| Nov 23 | T-06 to T-09: texting and email, both ways (short week) | Pilot firm calls. Draft the pilot agreement. |
| Nov 30 | T-10 to T-13: Claude reading and writing live, file storage | Sign the model provider's business terms. Collect 100+ sample forms for accuracy testing. |
| Dec 7 | T-14 to T-18: time zones, web app shell, clients, checklist, client page | Sign pilot firms 1 to 3. |
| Dec 14 | T-19 to T-23: review queue, Hound console, upload page, accuracy run | Get client lists from pilot firms. Each firm's text registration filed. |
| Dec 21 | T-24 to T-26: import, Google Drive delivery, alerts by email (short week) | Counsel sign-off on consent wording and the 7216 step. |
| Dec 28 | T-27 to T-30: hardening, backups, monitoring, security checklist | Dry run with one friendly firm on 10 real clients. |
| Jan 4 | Fixes from the dry run. Onboard firms 1 and 2. | Train each firm, one hour each. |
| Jan 11 | Onboard the rest. Launch January 15. | Daily check-in with every pilot firm. |

## The three things that can sink the date
1. **Text registration.** Carriers approve each firm's texting before any message goes out, it can take weeks, and a rejection restarts the clock. File the platform's own registration this week and each firm's the day they sign. Email and the upload link work without it and are the fallback.
2. **Legal.** No real client data until three things are done: the former-employer invention and confidentiality review, the Section 7216 consent step agreed with counsel, and signed business terms with the model provider covering no training on firm data.
3. **Pilot firms.** Tax season opens in late January. Firms decide their tools in December. Without three signed firms by December 18, there is nobody to launch to.

## Go or no-go checks on January 8
- Accuracy run (T-22): form type and year right on at least 97 of 100 sample forms, and no wrong document accepted without review.
- 100 test conversations with no message sent after STOP, none outside sending hours, none with an advice word.
- A restore from backup has been done once, for real.
- Each launch firm has an approved text registration, or has agreed to start on email only.
- Counsel has signed off the consent wording.

## Numbers to measure in the first two weeks
Share of documents accepted with no staff touch. Share of model drafts that pass the safety check. Median days to a complete file. Opt-out rate. Model cost per client. Staff minutes per client.
