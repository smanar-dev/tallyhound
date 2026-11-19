# How Tallyhound stays ahead

Written November 18, 2026. This is judgement, not research: it has not been tested with a single paying firm. Revisit it after the pilot.

## What can be copied, and how fast

Assume every feature in this kit can be copied by a funded competitor within one season. Texting, AI replies, document checks and a tap-based check-in are all within reach of Soraban, TaxDome, Canopy and StanfordTax. Features alone are a head start of months, not a moat.

## What is hard to copy

| Advantage | Why a competitor struggles to match it | What to build or do |
|---|---|---|
| **It knows each client by year two** | After one season Tallyhound holds, per client: which documents, from which payers, when they reply, who handles the paperwork, what they said they do not have. Next season starts pre-built. A firm that leaves loses that. Suites store documents; they do not learn the client | Season roll-forward (T-73): one click builds next year's checklist from this year's results and sends a check-in that is already 90% answered. This is the most important thing to build after launch |
| **One job, done for the client's convenience** | Suites cannot remove their portal, organizer and login without breaking the rest of their product. Their intake is a module inside something bigger | Never add a login. Never add a long form. Keep the check-in under two minutes. Publish the number |
| **Live in an hour, no sales call** | Soraban needs onboarding weeks and a 250-return minimum. Its cost structure assumes that | Self-serve sign-up after the pilot. A 14-day free trial, then a flat paid plan (no permanent free plan) so a solo CPA can try it in January without asking anyone |
| **Proof, per check** | Nobody publishes how often their AI is wrong. If Tallyhound publishes "wrong accepts under 1 in 200" with a method, the others have to answer | T-43 produces the numbers. Put them on the website. Update them every season |
| **Trust by design** | The decision log, "why it did that", suggestions that never act alone, and drafts a CPA can approve are easy to describe and tedious to build well | Keep the rule: the model reads and proposes, code and people decide. Say it in every demo |
| **Price that fits small firms** | Per-return pricing with minimums is how competitors pay for onboarding staff | Flat monthly, no minimum. Do not add per-return fees later |

## Where a competitor would attack

- **"We do everything."** A firm that wants intake, data entry and delivery in one tool will choose a suite. Answer: integrate, do not expand. A clean hand-off folder, and later a push into whatever the firm already uses.
- **Price.** StanfordTax has no minimum and TaxDome is under a dollar per client a month. Tallyhound will not win on price alone.
- **Trust.** Six seasons and SOC 2 beat a new name. Answer: pilot firms as references, a security page, SOC 2 started in year one.
- **Distribution.** They have sales teams. Answer: go where solo and small-firm CPAs already talk to each other, and let the product spread by referral. A CPA who saves a week in February tells other CPAs.

## The order to do things in

1. Launch with three to five pilot firms and measure the three checks, the check-in completion rate and the time to first request.
2. Publish those numbers.
3. Build season roll-forward before the following January.
4. Self-serve sign-up with a free tier.
5. Only then consider anything outside the four steps.


## Status after round 8

| Advantage | Status |
|---|---|
| It knows each client by year two | **Built** in the engine, the demo and the pipeline: `rollSeason` carries every finished client into the next tax year with the documents and payers they actually sent, what they said they do not have, their notes and reply hours. The check-in for a returning client is one tap. Not yet proven on a real second season |
| Live in an hour, no sales call | **Built for email, by design not for text.** Sign-up asks five things and lands on three numbered steps. A new firm reaches clients by email at once. Texting waits for carrier approval of the firm's number, which takes one to three weeks and cannot be shortened. The time from sign-up to first message is measured and shown on Progress |
| Flat price | **Decided and written down** in `docs/PRICING.md`, with a free plan for 25 clients and a promise shown in the product |
| Published accuracy | **Tool built, number not yet produced.** `tools/eval-topics.js` and the "How well it spots changes" check in the demo's Settings score the live model on sixty messages. The phrase list alone finds 15 of 36 with 2 of 24 false alarms. Run the live check and publish what it shows |
