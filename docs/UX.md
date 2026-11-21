# Ease of use: the rules

Tools in this market lose customers because they are hard to learn. A CPA in January will not read a manual. These rules are requirements, the same as the engine rules. The demo in `reference/artifact` follows them.

## The rules

1. **A new firm is collecting in ten clicks.** Measured on the demo: from an empty firm to twelve clients being contacted takes 10 clicks and one paste. A change that adds a click to this path needs a reason.
2. **One screen tells you what to do next.** Home shows three numbered steps until the first requests go out: add clients, choose a checklist, start collecting. Only the current step has buttons.
3. **One place for work that needs a person.** The review queue holds unsure documents, client questions, "I don't have that" replies, calls to make and drafts to approve. One badge in the menu, not three.
4. **Four things in the main menu.** Home, Clients, Review queue, The hound. Everything else sits under More.
5. **No screen starts empty and silent.** Every empty screen says what will appear there and offers the one button that gets you there.
6. **A primary button appears only when it can do something.** No "Go fetch" when there is nobody to fetch for.
7. **Plain words.** The table below is the vocabulary. Do not bring the left column back.
8. **The system explains itself.** Every automatic action has a one-line reason a CPA can read ("Why it did that").
9. **Nothing irreversible without a clear warning.** Removing a template or waiving an item says what it affects. Purge asks for the client's last name.
10. **Demo and test tools are not product.** They sit in a collapsed "Test tools" box outside the sample firm, and do not exist in production.

## Vocabulary

Rewritten November 21, 2026 from the brand book and the content book (`docs/REBRAND.md` section 4). `apps/web/e2e/rules.test.ts` checks the left column never appears on a screen.

| Do not say | Say |
|---|---|
| Front desk | Office manager |
| Cadence, sequence (for one client) | Follow-up plan; the Plan tab |
| Pipeline steps | Sniff trace |
| Unreachable | Can't reach |
| Start outreach, Start collecting | Go fetch (the button); "Fetch for Maria" for one client; "say go fetch" in a sentence |
| Needs you, as the name of the place | The review queue. "Needs you" is the status on a client or a document |
| Review, reviewed (of what Tallyhound does to a document) | sniff test; passed the sniff test; did not pass the sniff test |
| Queue (anything but the review queue) | Coming up |
| Stuck | Gone quiet, or Needs you |
| Not started, Collecting, Complete | Ready to fetch, Fetching, All fetched |
| Copilot, Autopilot | Approve each message, Send on its own |
| Waive | Not needed this year, with a reason |
| Take over | I'll handle Maria |
| Alert, notification (to staff) | A bark. Never said to a client |
| The Hound | the hound, lower case. It has no name yet |
| Inbox | All messages |
| Unmatched tray | Unknown senders |
| Waiting on consent | Waiting for OK to text |
| Handoffs | Questions for you |
| Approvals | Drafts to approve |
| Playbook | Rules it follows |
| Live log | Activity |
| Requirements | Suggested |
| Deliver | Hand off files |
| Latest reasoning | Why it did that |
| Engagement | File (never shown to users as "engagement") |
| TallyHound, Tally Hound, TH | Tallyhound |

Mechanics, from the brand book: US spelling; sentence case for headings and buttons; form names written exactly (W-2, 1099-NEC, Schedule K-1); no em dashes; no exclamation marks; no emoji; the hound never appears beside an error and never in anything a firm's client sees.

## How to test it

- `first run`: script the path from an empty firm to collecting and count clicks. Fail the build above 12.
- `jargon`: scan every screen's visible text for the left column of the vocabulary table.
- `empty states`: load an empty firm, visit every screen, and check each has a sentence and a button.
- Then the test no script can do: sit a CPA who has never seen it in front of an empty firm, say nothing, and watch. Do this with each pilot firm in week 5 (ticket T-42 covers the timing; T-64 covers the watching).


## The check-in (round 6)

The check-in replaces the tax organizer for the purpose of deciding what to collect. Rules:

- **Two minutes, taps only.** One screen of tiles, one counter (number of employers), one optional note. No typing required, no login.
- **Returning clients get one question first:** "Was this year about the same?" with last year's documents shown. "Yes" is a single tap and ends it.
- **The client proposes, the firm decides.** Answers never change the checklist by themselves unless the firm switched that on, and then only when nothing would be removed and there is no note.
- **The firm's review is one card:** what to add, what to remove, the client's note, and two buttons: "Confirm and start collecting" and "Confirm only".
- **It keeps listening.** If a client later mentions something new (sold stock, a new job, a rental), a suggestion appears in Needs you. Nothing is added without a person.

# Round 10 (November 18): every control questioned

The test applied to each page, button, label, icon and number: why is it here, would a preparer know what it does without being told, and does it say the same thing as the rest of the app. 199 controls across 24 pages were listed and read. What failed and what changed:

| Where | What was wrong | Now |
|---|---|---|
| Home, side menu, Needs you page | Three different counts for "needs you" (5, 4 and 3) | One count everywhere. The Needs you page also lists the items that are not in the queue ("Also waiting on you") |
| Home | Step cards carried a bare 1 to 5 that read as data | Labelled "Step 1" to "Step 5" |
| Home | "Start collecting" only opened the client list | Opens the start wizard and shows how many clients are ready |
| Home | Activity feed was seven identical lines | A burst of the same message is one line: "sent 7 clients the next request" |
| Home | "1 unmatched" with a "Sort" button | "1 message from an unknown sender" with "Match to a client" |
| Needs you | Filters "For a person", "Says none", "Calls"; reasons like "Low confidence" | "Client questions", "Client has none", "Calls to make"; reasons in a preparer's words |
| All messages | Every row said "Message" in blue | Shows what Tallyhound read it as, or nothing. Button says "Open client" |
| The Hound | Row labels ("Handoff", "Escalation") did not match the filter names | Same words in both. Stats reworded: "Things it did today", "Waiting on you" |
| Client page | Checklist names in lower case, "Suggested" tab that opened on tax questions, internal codes such as CHILDCARE and PTAX, a note signed "Claude" | Capitalised, tab renamed "Tax situation", real form numbers only ("1099-INT"), "picked up from a message" |
| Client page | Two note boxes with no hint how they differ | One is "Tell Tallyhound something about Dana" (it uses it). The other is "Private staff notes" (it does not) |
| Client page, Settings | "Hand off files", "Hand-off" | "Send files to preparer", "Where files go" |
| Document viewer | A "Box 1 wages" field with the dollar figure, and a second list repeating the three checks | The figure is gone (see below). The detail list is folded under "How each check was made" |
| Settings, Messages | 38 messages in creation order with codes like M22R, and insert buttons reading {plain_name} | Six groups in the order a client meets them, plain names, buttons reading "Document name" |
| Settings, Document rules | Mortgage form first, codes like 1099INT | Same order as the checklist, "Form 1099-INT" |
| Progress | "Start the 2027 season" at the top in January | At the top only when most clients are finished or from November. Otherwise at the bottom |
| Everywhere | Small buttons 26px high | 30px, and 38px on touch screens |

## A scope fix found on the way

The document reader was asked for "the main dollar figure" and the viewer showed it. Tallyhound's one job is to check a document, not to extract it, and a stored income figure is data it has no reason to hold. The prompt no longer asks, nothing stores it, and the model is told not to return dollar amounts.

## Still open (design decisions, not bugs)

- **Three places ask for attention:** the Needs you queue, the bell, and the Hound's "Questions for you" and "Alerts" tabs. They overlap. Recommendation: fold the two Hound tabs into Needs you and keep the bell for news that needs no action. Not done this round because it changes the page structure and should be tried with a real preparer first (T-64).
- **"The Hound" as a menu name.** It is the brand, but a new user cannot tell what is behind it. Options: "Assistant", or keep the name with a one-line subtitle.
- **Settings has 11 tabs.** "Connections" and "Text number" could merge.

# Round 12 (November 18): the questions, as a one-time text after opt-in

**What it is.** One text with a link to quick tap questions ("did you start a new job, sell a home, sell stock...") so the firm only asks for documents the client has. It is a helper for the CPA, not a required step. Most firms cover the same ground on a call.

**Order of messages for a client:** invitation to text, the client opts in, confirmation, then either the questions or the first document request.

| Firm setting (Settings, Checklist templates) | What happens after a client opts in |
|---|---|
| **Off for everyone** (default) | Nothing extra. The first document request goes out. Staff can still text the questions to one client from that client's page |
| **Send automatically** | The questions go by text right away, once. Document requests wait up to 2 days for the answers |

**Skipping.** With automatic sending on, the firm can skip the questions for one client ("Skip the questions" on the client page) or for several at once from the client list. Turning the setting off skips them for everyone.

**Rules it always follows.**

- Sent once. Never a reminder.
- Only by text, only after the client has opted in, only inside sending hours, never while a person has the conversation.
- No answer in 2 days: document requests go out with the checklist on file.
- Answers that change nothing are applied quietly and collecting carries on.
- Answers that add or remove a document go to Needs you for a person to confirm. Collecting waits up to 2 more days for that review, then carries on regardless.
- Covered it on a call: the preparer sets the answers under Tax situation on the client page, and the suggestions appear the same way.

The earlier check-in sent before collecting starts (round 6) still exists for firms that want answers before the first message. The two never both go to the same client.

## Round 13: sign-up to first request, connections, and data (November 19)

**The path a new firm walks.** Sign up (name, firm, email, no card) lands on Home with two cards. "Get your first requests out": add clients, give each a checklist, start. "Connect once": email (ready, with the firm's address and a copy button), text number (starts when a plan is chosen, with the wait explained), where finished files go. A firm can collect by email before either of the last two is done, and the card says so. Measured: 11 clicks from an empty firm to ten clients being collected from.

**Add clients.** One question first: where is your list today? Ten tiles. Picking a tax program shows its menu path to a CSV. The upload box is always visible underneath for someone who already has a file. Step 2 shows each column with what Tallyhound will use it for; sensitive columns carry a lock and "Never imported" and cannot be changed. Step 3 shows only the columns being taken. Step 4 says how many were added, updated, unchanged and skipped, and names the columns that were left out.

**Why there are no "Connect Gmail" or "Connect Drake" buttons.** They were in the demo and could not be built as shown. A button that cannot work is worse than no button. Email now says exactly what is true: your Tallyhound address, optional forwarding, and "Your own mailbox: never connected".

**Security and data** is a page for the owner to read once and for the firm's IT person or insurer to be sent. Four numbers at the top (held, deleted, waiting for delivery, next deletion), four keep-for times with plain consequences under each, a list of what is never kept, the other companies involved, a paragraph to paste into the firm's own security plan, and the log.

**A deleted copy is shown, not hidden.** The document card stays with "copy deleted 3 days ago". Opening it says where the permanent copy is. The checklist still shows the item as received.

**Words.** "Keep for" instead of "retention". "Where finished files go" instead of "Delivery". "Copy" for what Tallyhound holds, "permanent copy" for what the firm holds.
