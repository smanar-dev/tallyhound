# Security and data

Round 13, November 19, 2026. Written to be handed to a firm's owner, their IT person, or a lawyer. Nothing here is legal advice, and three items at the bottom need counsel before a real client's data is touched.

## The idea

Tallyhound is a pass-through. The firm's own storage holds the permanent copy of every document. Tallyhound keeps its copy for as long as collecting needs it, then deletes it. The less we hold, the less there is to lose.

Three rules follow from that:

1. **Do not take what the job does not need.** No Social Security numbers, no dates of birth, no bank details, no amounts from returns. Not in the client list, not in messages, not pulled from documents.
2. **Lock up what we do take.** Every firm has its own key. What sits in the database and the file store is sealed with it.
3. **Let go on a schedule.** Deleting is automatic, visible to the firm, and does not stop when a firm pauses or stops paying.

## What Tallyhound holds, and for how long

| Data | Why | Kept |
|---|---|---|
| Client first and last name, email, mobile, preparer, client number, language, time zone | To ask and to match replies | Until the firm removes the client or closes the account |
| Checklist: which forms, from whom, status | The product | Same |
| Text and email messages | The conversation, and proof of consent to text | 90 days after the client's file is closed (firm can set 30 to 730) |
| Document files | To check them. The original goes to the firm's storage on arrival | 7 days after delivery (firm can set 0 to 365). Rejected, duplicate and discarded files: 7 days. Nothing longer than 400 days |
| One line per document: form, year, issuer, date, verdict | Builds next year's checklist | Kept |
| Messages and files from a sender nobody matched | So a person can file them | 30 days |
| Consent record: when and how each client agreed to texts, the wording they were shown, and the IP address and browser it came from | Required for texting, and proof if a carrier or a client asks | Kept with the client |
| Audit log | Who did what | Seven years (to confirm) |

An owner changes the four document times on Settings, Security and data. "Delete Tallyhound's copies" on a client's Documents tab removes them at once.

## What Tallyhound never holds

* **Social Security numbers, card numbers, bank account and routing numbers.** If a client types one into a text or an email, it is cut out before the message is stored and before the model sees it (`scrub` in the engine). The firm sees "[SSN removed]".
* **Columns such as SSN, date of birth, fee, AGI, refund, bank account in an imported client list.** They are recognised by their header or their contents, shown as "Never imported", and not read.
* **Amounts and box values from documents.** The model is asked whether the document is the right one and readable. It is not asked for the numbers and there is no field to put them in.
* **Passwords.** Staff sign in by emailed link or their identity provider. A locked PDF gets a request for an unlocked copy.
* **The firm's mailbox.** Without the mail layer, Tallyhound has its own address per firm and signs in to nobody's email. With it (v2), a preparer connects their own mailbox by their own consent; see Subprocessors below.

The honest limit: the document images themselves contain Social Security numbers. That is what a W-2 is. We hold those images, sealed, for the shortest time the firm chooses, and that is the main thing this document is about.

## How it is locked up

* **In transit:** TLS everywhere, including to Twilio, the mail service, the model provider and the firm's storage.
* **At rest, our layer:** AES-256-GCM. Each firm has a random 256-bit data key. Firm state and every file are sealed with it before they leave the application (`packages/core/crypto.js`). Each sealed value is tied to its firm and its purpose, so a value moved to another firm's row fails to open.
* **Keys:** a firm's data key is stored wrapped by a master key. The master key lives in a cloud key service and never in the database, a config file or a backup. Rotating the master key means re-wrapping a few hundred small keys, not re-encrypting data.
* **At rest, the provider's layer:** encrypted disks on the database and the bucket as well. Two layers, different keys.
* **What a stolen database backup contains:** firm ids, Tallyhound addresses and numbers, sizes, timestamps, usage counts. No client names, no messages, no documents.
* **Closing an account:** the firm's key is destroyed first. Every sealed byte belonging to that firm, including copies in backups, is unreadable from that moment. Then the rows and files are removed.

## Who can get in

* Staff accounts with three roles: owner, staff, read only. Only an owner changes retention, billing, or closes the account.
* A second factor for every staff account. Not optional.
* Sessions expire. Stored as a hash, so a database reader cannot use them.
* Every view of a document, every delivery, every deletion, every setting change and every sign-in is written to an append-only log the application cannot edit. The firm can read it on the Security and data page.
* Clients have no account. Their upload link is signed, expires, and opens only their own checklist. It never shows a document back to them.
* Tallyhound staff have no standing access to firm data. Support access (T-107) exists only when a firm's owner grants it under Settings, People: one named person, look-only, for 4 hours, 1 day or 3 days. It ends by itself, and the grant, each visit and the end are written in the firm's audit trail.

## What comes in from outside

* **Texts:** Twilio signs every webhook. A call with a missing or wrong signature is rejected before anything is read (`verifySignature`). Photos are fetched from Twilio and then deleted there.
* **Email:** the receiving server checks SPF, DKIM and DMARC. Mail that fails, including mail that claims to be from a known client, is not filed to that client. It waits for a person with the reason shown. Nothing is sent in reply.
* **Unknown senders:** their files are kept for a person to file (a spouse writing from another address is common), capped at 20 files per firm per day so a stranger cannot run up the bill.
* **Files:** only photos and PDFs are opened. Anything else gets a polite request for a photo or PDF. Files are never executed, and are shown to staff as images.
* **Text inside a message or a document is data.** The model reads it; it cannot give instructions. Its answers are fixed-shape and the engine, not the model, decides what happens. Every outgoing message passes the engine's own check before it is sent.

## Other companies that touch the data

| Company | What they see | Note |
|---|---|---|
| Cloud host | Sealed data only | United States region |
| Twilio | Mobile numbers, message text, photos in transit | T-108: once our sealed copy is saved we delete their copy of each picture and blank the words of each text, in and out; what fails is retried by the timer. Not yet run against the live account |
| Mail service | Email addresses, message text, attachments in transit | |
| Model provider (Anthropic) | Document images and message text, to read them | No training on the data and the shortest retention on offer must be in the contract. **Needs counsel** |
| Stripe | The firm's billing contact and card | Never client data |
| The firm's storage (Google, Microsoft, Dropbox) | Finished documents, in a folder the firm picks | Tallyhound asks for access to that one folder, not the whole drive |

## How this lines up with what a tax firm must do

Tax preparers fall under the FTC Safeguards Rule (16 CFR Part 314) and must keep a written information security plan. IRS Publication 4557 describes the safeguards and Publication 5708 gives a template for the plan. Tallyhound is a service provider under that rule, so a firm using it has to be able to say what it does with client data.

| What the rule asks of the firm | What Tallyhound gives them |
|---|---|
| Know where customer information is | Security and data page: counts of what is held and deleted, the schedule, the next deletion |
| Encrypt it in transit and at rest | Yes, described above |
| Multi-factor sign-in | Required for every staff account |
| Limit access to who needs it | Three roles. A read-only seat for someone who should look and not touch |
| Log activity | Append-only audit log, visible to the firm |
| Dispose of information securely | Scheduled deletion, delete-now, key destruction on closing |
| Oversee service providers | This document, the sub-processor table, and a paragraph the firm can paste into its own plan (on the Security and data page) |
| Respond to incidents | Below |

Tallyhound does not make a firm compliant. It removes one of the harder parts.

## If something goes wrong

Designed, not rehearsed (T-109):

1. Contain: the owner's emergency stop halts all sending for a firm. On our side, revoke the affected keys and sessions.
2. Establish what was reachable. Because data is sealed per firm, the question is which firm keys were exposed, not which rows.
3. Tell affected firms within 72 hours of confirming, with what was exposed, for which clients, and what we have done.
4. The firm decides its own notices. The FTC rule has a 30-day notice for breaches affecting 500 or more people; state laws vary.
5. Written review within two weeks, shared with affected firms.

## Open items. Do these before any real client data.

1. **Section 7216.** Whether a firm needs written client consent before sending tax return information to Tallyhound and, through it, to a model provider. The consent wording, if needed, goes on the client's first message. Counsel.
2. **Model provider terms.** Zero or minimal retention and no training, in writing.
3. **Manar's former-employer terms.** Clearance before any real document is processed.
4. **A third-party penetration test** before general sale. Not needed for a pilot on test data; needed before the Firm and Large plans are sold.
5. **SOC 2.** Larger firms will ask. Plan for a Type I in year one. Not needed for the pilot.

## What has and has not been tested

Tested in this kit: scrubbing, the import filter, every retention path, deletion while paused, encryption round trips and tampering, firm-to-firm key separation, key destruction, real deletion of stored bytes with retry, sender checks, forwarded mail, the unknown-sender cap. The fuzz tool runs 200 random seasons and checks after every step that no ID number was stored and nothing outlived its time.

Tested on a real PostgreSQL 18 server in round 15: the schema, the row lock and 80 simultaneous events from two servers. Not tested: anything against the real cloud key service, real Twilio or mail webhooks, sign-in, the storage connectors. No outside party has reviewed any of it.


## Subprocessors (v2, November 24, 2026)

A firm must be able to vet every service that handles its clients' information (FTC Safeguards Rule). This is the list a firm is given on request and the one the data processing terms carry.

| Subprocessor | Role | What it holds | Hosting location |
|---|---|---|---|
| Neeter | Email delivery and task tracking. Only when a firm's preparers connect their own mailboxes | Access to each connected mailbox, limited to threads Tallyhound started and senders on the firm's client list; each client's name and email address; the name of each form owed and who issues it. Never a document, an amount or an identifier | **TO BE CONFIRMED IN WRITING** with Neeter, with where its staff with production access sit and its own subprocessors (it says it runs its AI on Google Cloud Vertex AI and does not train on client content) |
| Postmark | Staff email (sign-in links, barks, the morning note) and, without the mail layer, client letters | Addresses and message text | United States |
| Anthropic | Reading documents and replies | The page images and reply text of one request at a time; not kept for training | United States |
| The hosting provider, the database and the file store | Running the service | Everything, sealed with each firm's key | To be chosen (T-02) |

Mailbox permissions asked for (TH-MBX-2): Google `gmail.send` and `gmail.readonly`; Microsoft `Mail.Send` and `Mail.Read`. Neither provider offers a narrower way to read replies. What is read is limited by the mail layer, and anything from a sender who is not on the firm's client list is dropped before Tallyhound keeps it.

Open with counsel before any client is contacted: whether form and issuer names are tax return information under Section 7216 and whether Neeter is an auxiliary service provider; whether any Neeter access is from outside the United States (26 CFR 301.7216-3 then needs the client's consent); what each pilot firm's insurer requires.
