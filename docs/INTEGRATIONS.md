# Connections

Round 13, November 19, 2026. How the client list gets in, how email and texts connect, and where finished files go. Vendor facts were checked on the dates shown; they change, so check again before building against any of them.

## The short version

* **Client list:** a CSV file is the path for almost every firm, because the tax programs most small firms use have no API. That is fine: it is a two-minute export and Tallyhound reads whatever columns come out.
* **Email:** no mailbox connection at all. Each firm gets a Tallyhound address.
* **Texts:** one registered number per firm through Twilio.
* **Files out:** the firm's own cloud folder, or a zip.

## Getting the client list in

### Tax preparation software

| Product | API open to a small vendor? | How the list comes out |
|---|---|---|
| Drake Tax | No | Reports, Report Manager, Client contact report, export CSV. Or Tools, File Maintenance, Export Client/EF Data. Source: Drake knowledge base articles 10354 and 20069 |
| Lacerte (Intuit) | No | Clients tab, Client menu, Export, Export to File, Comma Delimited |
| ProSeries (Intuit) | No | HomeBase, Export Contacts |
| UltraTax CS (Thomson Reuters) | No | Utilities, Client Listing Reports, Client Contact |
| CCH Axcess (Wolters Kluwer) | Yes, but it is sold: the Open Integration Platform needs purchased API kits | Export to Excel or CSV |

Drake exports names in capitals. The importer turns "MARIA GARCIA" into "Maria Garcia". It does not try to be clever about "MCDONALD".

### Practice management software

| Product | API | Status for us |
|---|---|---|
| Karbon | Public REST API, self-service keys. `GET https://api.karbonhq.com/v3/Contacts` with `Authorization: Bearer` and `AccessKey` headers. Mobile numbers are on the contact's business card (`?$expand=BusinessCards`). Source: developers.karbonhq.com | Importer written (`packages/adapters/importers.js`), not run against a live account (T-104) |
| TaxDome | Public API and MCP server announced October 28, 2026, rolling out to firms over the following weeks; listed as part of a paid add-on. Before that, Zapier only. Source: CPA Practice Advisor, TaxDome pricing page | Wait for the rollout to finish, then read the docs. CSV until then |
| Canopy | External API platform launched September 30, 2026 | Not yet read. CSV until then |
| Financial Cents, Jetpack Workflow, others | Not checked | CSV |

### What we should build, in order

1. **CSV, done well.** Built. It already handles the real exports: odd headers, a spouse column, home and cell phones, client numbers, capitals, semicolons, sensitive columns.
2. **Re-import that updates.** Built. A second file with the same client numbers updates email and mobile and adds only new clients. This covers "keep in sync" for firms on Drake or Lacerte, by hand, once a season.
3. **Karbon.** One to two days once we have a test account. Only worth it if pilot firms use Karbon.
4. **TaxDome and Canopy.** Decide after the pilot from what firms ask for.

A direct connection saves a firm about two minutes a year. It matters for the sales conversation more than for the product. Do not build one before a paying firm asks.

### What an import never takes

Whatever the source, only these fields are read: first name, last name, email, mobile, client number, preparer, language, state or time zone. A column that looks like an SSN, date of birth, fee, income, refund or bank detail is flagged on screen as "Never imported" and skipped. API importers request and map the same short list and nothing else.

## Email

### Decision, reversed on November 24, 2026 (see `docs/V2.md`): Tallyhound never connects to a firm's mailbox

With the mail layer on, each preparer connects their own Google or Microsoft mailbox so letters leave from their own address. The reasons below still describe the cost of that, and are why it is one consent screen, the narrowest permissions the providers offer, reading limited to threads Tallyhound started and senders on the client list, and a one-click disconnect. Without the layer the decision below still holds.

Reading a Gmail inbox through Google's API needs a restricted scope. Google requires an app that uses one to pass a third-party security assessment and repeat it every 12 months (Google Cloud help, "Security assessment"). Older write-ups put the cost at $15,000 to $75,000 a year; we have no current quote. Microsoft has its own review for the equivalent permission.

Cost is the smaller reason. The larger one: mailbox access means Tallyhound could read every email a firm receives. That is far more than the job needs, it is the first thing a careful firm's IT person will refuse, and it would make this document's first promise false.

### What we do instead

* **Each firm gets an address,** for example `larkin-poe@docs.tallyhound.com`. Requests go out from it with the firm's name as the sender, and clients reply to it.
* **Optional: forward.** A firm that wants clients to keep writing to `docs@theirfirm.com` sets a forwarding rule in their own mail to the Tallyhound address. Nothing to install and they can turn it off themselves. Auto-forwarded mail keeps its DKIM signature, so the sender check still works in the usual case. Mail from a domain that only publishes SPF will fail after forwarding and wait for a person; we will learn in the pilot how often that happens.
* **Optional: send from the firm's own domain.** The firm adds three DNS records (SPF include, DKIM, DMARC) and requests go out as `docs@theirfirm.com`. This is a deliverability nicety for later (T-110).
* **A staff member can forward one email by hand.** If the forwarder is a signed-in user's address, Tallyhound reads who the original was from and files it to that client.

### The sender check

The mail service that receives for us reports SPF, DKIM and DMARC results. `packages/adapters/email-inbound.js` turns that into one answer: can we believe the From line?

* DMARC pass: yes.
* DMARC fail: no.
* No DMARC record: yes if a DKIM signature or SPF pass lines up with the From domain.
* No result at all: no.

"No" never bounces the mail. It goes to the firm's unmatched tray with the reason, files attached, nothing sent back.

### Attachments

Up to 20 per email, 25 MB each. Logos and signature images are skipped by size and by the inline flag. Photos and PDFs are read. A password-protected PDF gets a request for an unlocked copy. Anything else gets a request for a photo or PDF. The quoted thread under a reply is cut off before the model sees it.

## Texts

* One ten-digit number per firm, through Twilio.
* United States carriers require a business to register before texting from such a number (10DLC): the brand once, then a campaign describing the messages. Approval has been taking one to three weeks. A firm cannot text until it clears.
* Registration starts when a firm chooses a plan, not at sign-up, because each registration costs us money and most trials should not trigger one. Until it clears, Tallyhound collects by email and the upload page, and the app says so.
* Consent is per client and recorded: a client agrees on the upload page or by replying YES. STOP and HELP are handled by the engine in English and Spanish and always get through, including when the firm is paused.
* Photos arrive as picture messages. Twilio holds the media; we fetch it, seal it and ask Twilio to delete its copy (T-108).

## Where finished files go

| Destination | How | Permission asked for |
|---|---|---|
| Google Drive | OAuth, `drive.file` scope | Only files and folders Tallyhound creates or the firm picks. This scope is not in the restricted class, so no annual assessment |
| OneDrive, SharePoint | Microsoft Graph, a chosen folder | Folder-level |
| Dropbox | App folder access | One app folder |
| None | Download a zip | |

Files land as `Client Tax Docs / 2026 / Garcia, Maria / 2026 W-2 Acme Logistics.pdf` with a short manifest. Delivery can be by hand or automatic when a client's set is complete. After delivery the keep-for clock starts.

None of the four connectors is built. The demo simulates them. Build Google Drive first (T-111); most small firms have it or OneDrive.

## Not doing

* Writing into tax software. Out of scope by the one-problem rule, and there is no API to write to anyway.
* Reading a firm's mailbox, calendar or drive contents.
* A client portal with a login.
