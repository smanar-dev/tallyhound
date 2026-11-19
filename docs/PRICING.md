# Pricing: what it costs to run, what to charge, and the rules that protect the margin

Updated November 18 (round 11). This replaces every earlier version. Run `node tools/cost-model.js` to reproduce every number here and to change an assumption.

## Verdict

1. **The prices hold on cost.** A normal client costs about $0.63 a season to serve. Every plan keeps a gross margin of roughly 77% to 85% in the normal case and 59% to 76% if every client needs twice the chasing.
2. **One plan did not hold and was changed.** The old Firm plan ($599 for up to 2,000 clients) fell to a 47% margin under heavy use. It is now two plans: Firm ($599, up to 1,000) and Large ($999, up to 2,500).
3. **Texting is the cost, not AI or storage.** About 78% of the cost of a normal client is carrier and Twilio fees. AI is about 22%. Email and storage round to zero.
4. **The price is low for the value.** Cost does not force a higher price. The market might allow one. That is a test to run with pilot firms, not something the cost model can answer.

## What each unit costs (published list prices, read November 2026)

| Unit | Price | Source |
|---|---|---|
| Text segment, in or out | $0.0083 | Twilio US list, via third-party trackers |
| Carrier fee per outbound segment | $0.0035 to $0.005 | Same |
| Carrier fee per picture message | $0.007 to $0.01 | Same |
| Inbound picture message, Twilio's own fee | $0.0165 | **Assumption, not confirmed this round** |
| Text number | $1.15 a month per firm | Same |
| Carrier registration, per firm, once | $4.50 brand plus $15 campaign check (or $46 brand for the standard kind) | Twilio support pages |
| Carrier registration, per firm, monthly | $1.50 to $10 | Same |
| Email | $0.10 per 1,000 | Amazon SES list |
| Storage | $0.023 per GB a month | Amazon S3 list |
| Claude Sonnet 5.5 | $2 in, $10 out, per million tokens | Anthropic pricing page |
| Claude Haiku 5.5 | $0.10 in, $0.50 out, per million tokens | Anthropic pricing page |
| Card payments | 2.9% plus $0.30, plus 0.5% to 0.7% for Stripe Billing | Stripe pricing page and trackers |

Links: twilio.com/en-us/sms/pricing/us, support.twilio.com (A2P 10DLC fees), aws.amazon.com/ses/pricing, aws.amazon.com/s3/pricing, platform.claude.com/docs/en/about-claude/pricing, stripe.com/pricing. Check each before signing a contract. Trackers disagree on the Stripe Billing rate (0.5% or 0.7%); the model uses 0.7%.

## Cost of one client for one season

Assumptions (mine, to be replaced by measurements from the usage meter, ticket T-78): 6 to 8 documents, 2 pages each, about 3,000 image tokens a page. Documents read by Sonnet. Texts read and written by Haiku.

| Client | Texts | AI | Email and storage | Total |
|---|---|---|---|---|
| Normal: 22 segments out, 5 in, 6 photos, 8 documents read | $0.49 | $0.14 | under $0.01 | **$0.63** |
| Heavy: twice the chasing, 14 documents read | $1.00 | $0.24 | $0.01 | **$1.25** |
| Email only: never turns texting on | $0.00 | $0.13 | $0.01 | **$0.14** |

Three things follow:

- **A client who uses email costs a quarter of one who texts.** Texting is the product's edge, so this is a cost to accept, not to avoid.
- **If Haiku can read documents as well as Sonnet, AI cost drops from $0.14 to about $0.01 a client.** Worth testing on real documents before launch (T-92). Do not switch without measuring accuracy.
- **Spanish costs more to text.** One accented letter outside the basic character set (á, í, ó, ú) makes the whole message bill at 70 characters a segment instead of 160. A 150-character Spanish text is 3 segments. The engine now counts this correctly. Keep the accents: correct Spanish matters more than a cent.

## Plans

| Plan | Price a month | Clients | Users | Revenue a client, 9 paid months | Margin, normal use | Margin, heavy use |
|---|---|---|---|---|---|---|
| Solo | $99 | Up to 150 | 1 | $5.94 | 80% | 69% |
| Practice | $249 | Up to 500 | 5 | $4.48 | 80% | 66% |
| Firm | $599 | Up to 1,000 | 15 | $5.39 | 81% | 70% |
| Large | $999 | Up to 2,500 | Unlimited | $3.60 | 77% | 59% |
| Above 2,500 | By quote, per block of 1,000 clients | | | | | |

Margins are at the plan's client limit, with the firm taking the full 3-month pause, after variable cost, per-firm text registration and card fees. A firm at half its limit pays the same and costs half as much, so real margins sit above these. They do not include hosting, support or salaries.

**Bigger firms do pay more**, by client count, in steps. That is the only thing the price depends on. No plan is priced per return, per document or per message.

## Is the price too low?

On cost, no. On value, probably yes. A 500-client firm pays $2,241 to $2,988 a year. The competitor research in `docs/SCOPE.md` found per-return prices near $18, which for 500 clients is about $9,000. Tallyhound could charge twice today's price and still be the cheap option. I have not changed the prices because the pilot's job is adoption, and a price test needs real firms. Recommendation: hold these prices for pilot firms for their first year, and test $149 / $349 / $799 / $1,299 on new sign-ups after the pilot.

## The rules that protect the margin (all built and tested)

### Trial

- 14 days.
- Collects from up to **10 clients**. The firm can import its whole list. It cannot start the 11th until it picks a plan.
- Up to **100 documents** checked. Past that, files are stored and not read.
- Email only in practice: a text number takes one to three weeks to register, and registration starts when a plan is chosen. So a trial costs us no registration fee.
- Worst-case cost of a trial: about **$1.74**.

### Pause

- **Opt-in only.** It never happens by itself. A firm that does nothing is never paused.
- **At most 90 days in any 12 months**, in one stretch or several. Resuming early gives the unused days back.
- While paused: data stored, nothing runs, the firm cannot use the product, nothing is billed.
- A client who writes in gets one automatic reply, at most once a week: "[Firm] is not collecting documents here right now. Please contact [Firm] directly", with the firm's phone and email. STOP and HELP still work.
- Effect on revenue: every firm pays for at least 9 months a year. That is why the margins above start at 9 months. This settles the "thin margin" worry from round 9: the worst case is now $3.60 a client against $0.63 to $1.25 of cost.

### Fair use (the cap that is not a meter)

- Each plan includes, per year: **60 text segments and 25 document checks per client on the plan**. Solo: 9,000 segments and 3,750 checks. Practice: 30,000 and 12,500. That is more than twice normal use.
- The firm sees two bars on its plan page. It is never billed for going over.
- At 80% the owner gets a notice. At 100%: nothing stops. **Reminders move to email** for clients who have one. Replies, first requests and legal messages still go by text. We suggest the next plan.
- Why not charge for overage: the promise is that the price depends only on client count. A cap that changes the channel keeps the promise and still limits the one cost that can run away.

## Costs the model does not include

| Cost | Estimate | Status |
|---|---|---|
| Hosting, database, monitoring, error tracking | $300 to $600 a month at pilot size | Assumption |
| Support time | Unknown | The product is designed to need none. Measure in the pilot |
| Failed payments and chargebacks | 1% to 3% of revenue is typical for small-business software | Assumption |
| Engineering | Manar | Not a unit cost |

Break-even on hosting alone is about three Practice firms.

## What would force a change

- **Carrier fees rise.** They have risen most years. Texting is 78% of cost, so a 50% rise takes about 5 points off the margin. Response: adjust plan prices at the next season, never mid-season.
- **Document reading needs a bigger model.** If accuracy needs Opus-class reading at $4 in and $20 out, AI cost doubles to about $0.28 a client. Still fine.
- **A firm far above the allowance.** Move it up a plan at renewal. Do not add a meter.
- **A firm above 2,500 clients.** Quote by block of 1,000. Suggested: $350 a month per extra 1,000, which keeps revenue above $3.50 a client-year.

## Still unproven

- Every usage figure is an assumption until the meter has a season of real data.
- The inbound picture-message fee is unconfirmed.
- Image token counts per page vary by model and photo size. 3,000 a page is a middle guess.
- Nobody has been asked what they would pay.
