# Scope: the one job

> **November 24, 2026: email-first.** Requests and follow-ups go by email as one letter listing everything owed; documents come in through the client's private upload link; texting is out of scope for launch and returns, if at all, as a link-only nudge after counsel signs off. `docs/V2.md` has the detail. Where this file says "text", read it as history.

Tallyhound does one thing for an accounting firm: it gets every client's tax documents in, and checks each one. Nothing else ships until this is the best tool a CPA can buy for that job.

## The job, in four steps

1. **Client list.** Create or import the firm's clients. A CSV, or one client at a time. Live the same day.
2. **Checklist.** Give each client the list of documents they owe. The fastest way is the check-in: the client gets a link, taps what applied this year (or "about the same as last year"), and the answers come back as a proposed checklist the CPA can add to or cut before confirming. From a template, from the recommendations, or picked by the CPA. One click to assign to many clients.
3. **Chase.** Ask for each document by text and email, answer replies, follow up, escalate, and log everything. The Hound does this without staff. Staff can watch, approve or take over at any point.
4. **Check.** Every document that comes in must pass three checks before it counts:
   - **Right document.** It is the form that was asked for, for the right tax year, and not a copy of one already in.
   - **Right information.** It is for this client, and every required part of the form is there.
   - **Clear to read.** The key boxes can be read.
   A document that fails goes back to the client with one plain sentence saying what to fix. A document the system is unsure about goes to a person.

"Done" for a client means every item on the checklist is received and passed, waived by staff, or the client said they do not have it and staff agreed.

## What Tallyhound is not

| Not this | Why |
|---|---|
| Data entry into tax software | Different product. Soraban, Canopy and TaxDome sell it. A firm keeps whatever it uses today. |
| Return delivery, e-signature, payments | After the job ends. |
| Practice management: CRM, tasks, time, billing | TaxDome, Canopy and Karbon own this. Tallyhound sits beside them. |
| A client portal with a login | Clients reply to a text or an email. The upload page needs no account. |
| A long questionnaire or organizer | Only yes or no questions that change the checklist. |
| Tax advice | Tax questions are handed to the preparer, never answered. |
| Paid onboarding | A firm must be live in under an hour without us. |

## Rules for saying no

- A feature request is in scope only if it makes one of the four steps faster, more hands-off or more accurate.
- A request that helps a firm after documents are in gets one answer: hand-off. Tallyhound files the checked documents where the firm already works and stops there.
- Hand-off is kept deliberately small: named files, one folder per client, and a list of what is missing.

## How to tell it is the best at the job

These are targets, not measurements. Measure them with the pilot firms (ticket T-22 and the launch plan).

| Measure | Target |
|---|---|
| Time from sign-up to first request sent | Under 60 minutes, no call with us |
| Documents that pass all three checks with no staff touch | 80% or more |
| Wrong accepts (a document accepted that should not have been) | Under 1 in 200 |
| Clients complete within 21 days of the first request | 70% or more |
| Staff minutes per client per season | Under 5 |
| Client effort | No login, no app, no form longer than 5 questions |

## Where the others stand (checked November 18, 2026)

| Product | How the client sends | Price as published | Minimum or setup |
|---|---|---|---|
| Soraban | Secure link by email or text | Per return, annual; third parties report $15 to $30 | Packages start at 250 returns; onboarding fee $1,000 to $4,500; about 2 to 4 weeks to implement |
| StanfordTax | Link to an organizer | $18 per return, charged only when a client uploads | None; 5 free credits |
| TaxDome | Portal and app | $0.83 per client a month; AI add-on $200 a month | $1,500 a year (150 clients) |
| Canopy | Portal and app | $74 to $149 per user a month, plus intake credits from $34 per client | 5 credits included |
| SmartVault SmartRequestAI | Email link or portal | Bundles of 50 requests; third parties report $12.50 per return | Needs a SmartVault plan |

Sources: soraban.com/tax-organizer-software, stanfordtax.com/faq, taxdome.com/pricing, getcanopy.com/pricing, smartvault.com/srai. Prices change; check before quoting them to a firm.

What none of them publish: a reply-to-the-text flow with no link, an agent that acts on free-form replies without staff, and a check that names the exact missing part. Those three, plus price and same-day setup, are the whole pitch. Verify each on a demo call before saying it to a customer.

## Every Settings page, and the step it serves (T-45)

A page is in Settings only if it changes one of the four steps, or is something a firm must do before it may run them. A page
for a service this installation has not connected is not shown at all.

| Page | Step | Why it is there |
|---|---|---|
| Your firm (name, sender name, phone, tax year, next season) | Chase | Every message is sent in these words and for this year |
| People | All four | Who may do them. The preparer on each client is who questions go to |
| Checklists | Checklist | Ready-made lists to give clients |
| Message wording | Chase | The words of each request and reminder |
| Sending hours | Chase | When a message may go |
| Text number | Chase | Carriers must approve a firm before it may text; the note that makes the first message expected |
| Email address | Chase | The address requests come from. Shown only when own-domain sending is connected |
| Finished files | Hand-off after Check | Where a checked document is filed. Only connected storage services are listed |
| Your plan | Before any step | What the firm may use, and the pause. Only plans on sale are listed when paying by card |
| Security and data | Check | How long a checked document is kept, the emergency stop, and the firm's records |

On The Hound: Ask is shown only when the model is connected, and the reminder call switch only when calls are.
