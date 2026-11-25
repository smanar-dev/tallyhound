# The agreement with Neeter: what it must cover (internal)

For counsel and for whoever signs. Not legal advice; points to settle, from the v2 spec's section 9 and what the build assumes.

## Must be in writing before any real client is contacted

- [ ] **White label.** No Neeter name, logo, domain, link, header or sender address on anything a CPA or client can reach. Letters sent exactly as written, with nothing added. The CPA never needs a Neeter account or screen.
- [ ] **Data processing terms** between Tallyhound and Neeter, flowing down to each firm. Neeter acts only on Tallyhound's instructions.
- [ ] **What Neeter may hold:** client names and email addresses, form names and issuers, mailbox access limited to threads Tallyhound started and senders on the firm's client list. Nothing read from a document.
- [ ] **No training** on client content by Neeter or any of its subprocessors (it says it uses Google Cloud Vertex AI).
- [ ] **Location:** where data is hosted, where staff with production access sit, and the full list of its subprocessors. Under 26 CFR 301.7216-3, disclosure to a preparer's provider outside the United States needs the taxpayer's consent. Counsel decides whether engagement letters need wording.
- [ ] **Deletion:** an assistant's data deleted within an agreed number of days of removal; everything deleted when the agreement ends; written confirmation.
- [ ] **Breach notice** to Tallyhound within 72 hours.
- [ ] **Security:** its written security policy now, a SOC 2 timeline, and the right to answer firms' questionnaires with its policy attached.
- [ ] **Idempotency** on every write, especially letters: a repeated key never sends a second letter. Our retry depends on it.
- [ ] **Availability and notice:** what happens to letters during an outage, and notice before any change to the interface.
- [ ] **Price:** per client per season or per mailbox, white label included, held for the 2027 season. The spec's ceiling: under $1.00 a client a season, or about $150 a mailbox.
- [ ] **Exit:** we can stop at any time; Neeter removes every assistant and deletes everything.

## Questions for counsel (from `docs/V2.md`)

1. Are form names and issuer names sent to Neeter "tax return information" under Section 7216, and is Neeter an auxiliary service provider?
2. Does the Safeguards Rule require anything more from each firm than naming Neeter as a service provider and overseeing it through our agreement?
3. Does mailbox access by a vendor change what each firm must tell its clients?

## What each pilot firm gets

- The subprocessor list (`docs/SECURITY.md`, "Subprocessors"), with Neeter's location filled in.
- A security plan addendum they can drop into their own written plan.
- The mailbox scopes asked for and why (`docs/SECURITY.md`).
- How to disconnect: Settings, Mailbox, Disconnect; letters and reading stop at once.
