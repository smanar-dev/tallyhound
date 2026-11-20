# The firm check (T-116)

One page. Done by a person at Tallyhound for every new firm, before anything is sent to that firm's clients.

## Why

Tallyhound asks people for W-2s and other tax documents in a firm's name. That is exactly what a fraudster wants. So a new firm
is created unchecked: it can sign in, add clients and build checklists, but the engine sends nothing and reads nothing
(`access()` returns "checking") until a person has confirmed it is a real tax or accounting firm.

## What to confirm

Both of these, from sources the applicant does not control.

1. **The email address belongs to the firm.** The owner signed in with it, so they can read it. Check that its domain is the
   firm's own (the website on that domain names the firm and its people). A free address (Gmail, Outlook, Yahoo) is not a
   failure, since many sole practitioners use one, but then the second item needs two proofs, not one.
2. **The firm is allowed to prepare returns.** One of:
   - a PTIN for the owner, found in the IRS Directory of Federal Tax Return Preparers under the same name and city;
   - a state CPA licence, found on that state board's own lookup (or CPAverify), active, in the owner's name;
   - an enrolled agent, found through the IRS;
   - an IRS e-file acceptance letter in the firm's name. Ask for it only if none of the lookups finds them.

Look these up yourself. Never accept a screenshot or a number the applicant sends in place of the lookup.

## Signs to stop and ask

- The firm's name differs between the sign-up, the website and the licence.
- The domain was registered in the last few weeks.
- The owner wants to load a large client list and start the same day.
- The office phone is unanswered or is a personal mobile with no firm greeting.
- The client list, when loaded, has addresses or numbers spread across the country for a firm with one small office.

Any one of these: call the firm on the number from the licence record or the state board, not the one they gave.

## Recording it

    npm run admin -- firm-check --firm f_... --by "Your name"

This lifts the gate and writes who checked to the audit log. Keep a one-line note of what you looked up (which directory,
the date) in the support record for the firm. Do not store a licence number or a PTIN in Tallyhound.

To take it back, for example after a complaint:

    npm run admin -- firm-check --firm f_... --by "Your name" --suspend

A suspended firm sends and reads nothing. Deletion on schedule carries on.

## How long

Aim for one business day; the app tells the firm that. A firm that signs itself up sees "Your firm is still being checked"
until this is done, and can finish setting up in the meantime.
