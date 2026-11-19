# Brief for counsel

Drafted November 19, 2026 for a one-hour meeting. Nothing here is legal advice; the draft wording at the end is a starting point for counsel to correct.

## What Tallyhound does, in five lines

1. An accounting firm uploads a list of its clients: name, email, mobile. No tax IDs.
2. Tallyhound emails and texts each client, in the firm's name, asking for specific tax documents.
3. Clients reply with photos and PDFs. An AI model (Anthropic's Claude, called over its API) reads each one and answers fixed questions: which form, which year, whose name, is it legible. Code decides whether to accept it or ask again. No amounts are extracted. No tax decisions are made.
4. The original file goes into the firm's own cloud storage. Tallyhound's working copy is encrypted with a key unique to that firm and deleted 7 days after delivery.
5. Everything runs in the United States.

## Questions

**1. Internal Revenue Code section 7216.** May a firm send its clients' tax documents through Tallyhound, and through Tallyhound to the AI provider, without each client's written consent? We believe Treasury Regulation 301.7216-2(d) covers disclosure to a contractor in the United States providing auxiliary services where no substantive determinations are made. Does it cover us? Does it reach the AI provider as our subcontractor? If consent is needed, is the draft paragraph below sufficient, and must it meet the form requirements of 301.7216-3 and Revenue Procedure 2013-14?

**2. Are we ourselves a "tax return preparer" under 7216,** with its criminal penalties, and what does that require of us?

**3. The FTC Safeguards Rule.** Our customers are covered financial institutions. What must our contract with them say for them to meet their service-provider oversight duty? Are we directly covered?

**4. The AI provider's terms.** We need: no training on our inputs, zero or minimal retention, United States processing, and breach notice. Which of Anthropic's commercial terms and addenda give us that, and for which models?

**5. Text messages.** Consent is collected by a tick box, by the firm's signed engagement letter recorded by a named staff member, or by the client texting START. Is the recorded-consent path sound under the TCPA for informational messages? Is the draft engagement-letter paragraph adequate? Who bears liability when a firm records consent it did not have?

**6. Manar's former employer.** Review the confidentiality and invention-assignment terms. Tallyhound uses no code, data, customer lists or documents from that employer. Is anything else needed before he works on document-reading software?

**7. Our own terms of service and data agreement.** Draft them: limits of liability, the firm's responsibility for its client list and consents, our retention and deletion commitments, breach notice within 72 hours, return of data on exit.

**8. State privacy laws.** Does the Gramm-Leach-Bliley exemption cover us in the states that have comprehensive privacy laws?

## Draft wording for a firm's engagement letter (for counsel to correct)

"Document collection. [Firm] uses Tallyhound, a document collection service operated in the United States, to request, receive and check the documents needed to prepare your tax return. Documents you send are read by automated software, including an artificial intelligence service, solely to identify and check them. They are filed in [Firm]'s own records and deleted from Tallyhound after a short period. By signing, you agree that [Firm] may share your tax documents with Tallyhound and its service providers in the United States for this purpose, and you agree to receive text messages from [Firm] about these documents at the mobile number you gave us. Message frequency varies. Message and data rates may apply. Reply STOP to stop or HELP for help. Agreeing to text messages is not a condition of our services."
