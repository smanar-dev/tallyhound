# Neeter go-live runbook (internal)

From "Neeter has answered" to "a pilot firm's letters leave from the CPA's mailbox". Read `docs/V2.md`, "What is not real yet", first.

**Where things are.** `BRIEF.md` is what we send Neeter. `contract.json` is the interface our adapter is written to. The adapter is `apps/server/src/integrations/neeter/index.ts`. The stand-in is `fake.ts` in the same folder. `apps/server/test/neeter.test.ts` holds the adapter to the contract and runs the conformance suite.

## 0. Until Neeter answers: run without it

Leave `TH_MAIL_LAYER` unset. Every firm is email-first and its letters go from its Tallyhound address through Postmark; replies come back there. Nothing below is needed for that.

## 1. Send the brief

Send `BRIEF.md`, with `contract.json` attached. Ask for written answers to the four extensions and the nine questions, and for a sandbox partner key.

## 2. Turn their answers into settings

| Neeter says | Set | What changes |
|---|---|---|
| Yes to all four | `NEETER_SEND=letters`, `NEETER_REPLIES=webhook` (the defaults) | The design as written |
| Cannot send our wording on demand | `NEETER_SEND=due_date` | We do not send the letter; we set the project's due date to tomorrow and Neeter's own follow-up goes in its own words. **Pilot stopgap only:** the wording is not ours, not in the firm's voice, and not checked by our output check |
| Cannot call us | `NEETER_REPLIES=poll` | The timer asks for each assistant's events every pass. No webhook secret is needed |
| Cannot make an assistant from our sign-in | Connect each CPA at Neeter as they require, then `npm run admin -- link-mailbox --firm f_… --user u_… --assistant <their id> --provider google --address cpa@firm.com` | Tallyhound holds no token for that mailbox. Disconnecting removes the assistant but cannot withdraw the permission at Google, so the CPA does that in their own account. **The white label breaks at this step**: the CPA sees Neeter's sign-in |
| Cannot hand over attachments | Nothing | Already handled: a person is asked to forward the email to the firm's Tallyhound address, or to add the file on the client's page |
| Different paths or field names | Edit `index.ts` and `contract.json` together | `npm test` fails until they match again |
| Will not honour `Idempotency-Key` on letters | Turn off the letter retry in `packages/core/pipeline.js` (search `letter_waiting`) | A letter that could not reach Neeter is marked failed and a person is told, instead of being retried |

## 3. Run the conformance suite against their sandbox

```bash
NEETER_SANDBOX_URL=https://… NEETER_SANDBOX_PARTNER_KEY=… NEETER_SANDBOX_REFRESH_TOKEN=… NEETER_SANDBOX_ADDRESS=test-cpa@yourdomain.com NEETER_SANDBOX_TO=inbox-you-own@yourdomain.com npm run test:layer
```

The refresh token comes from signing a test Google account into Tallyhound's own sign-in app. Every call is traced as its method, path with ids removed, status and time. Every failure names the step. Keep the output for the record.

## 4. Settings on the host

| Setting | Value |
|---|---|
| `TH_MAIL_LAYER` | `neeter` |
| `NEETER_BASE_URL` | Their API address, `https://…` |
| `NEETER_PARTNER_KEY` | Tallyhound's partner key. Each firm's own key is made from it on first use, sealed with the firm's key, and replaced every 90 days |
| `NEETER_WEBHOOK_SECRET` | At least 32 random characters, shared with Neeter. Not needed with `NEETER_REPLIES=poll` |
| `NEETER_SEND`, `NEETER_REPLIES` | From the table in step 2 |
| `NEETER_TRACE` | `on` for the first weeks: one log line per call, no ids, no bodies |
| `GOOGLE_CLIENT_ID` / `_SECRET`, `MICROSOFT_CLIENT_ID` / `_SECRET` | Tallyhound's own sign-in apps. Add the return addresses that `check-services` prints |

Give Neeter the webhook address: `{APP_URL}/hooks/neeter`.

## 5. Check the connection

```bash
npm run admin -- check-services
```

```bash
npm run admin -- layer-ping
```

`check-services` checks the settings for sense and asks Neeter who we are. `layer-ping` sends a signed test event to our own webhook; ask Neeter to send a `ping` too.

## 6. First firm

1. Their Workspace or 365 administrator approves Tallyhound's sign-in app for their organisation, until Google's verification for mailbox scopes is done.
2. Create the firm (`npm run admin -- create-firm …`). With `TH_MAIL_LAYER=neeter` it is a mailbox firm.
3. Each CPA signs in and goes to Settings, Mailbox, Connect. Confirm it with `npm run admin -- mailboxes --firm f_…`.
4. Import a test client whose email is yours. Go fetch. Approve the letter. Check that it arrived from the CPA's address, with nothing added; reply to it; upload through its link.
5. `npm run admin -- layer-reconcile --firm f_…` should report 0 put back.

## Every day while piloting

- `npm run admin -- status`, and the alerts: "the email service has not taken updates for a day" means Neeter has been unreachable for 24 hours. Nothing is lost; letters are late.
- The nightly comparison runs at 2 am server time and tells `TH_ALERT_EMAIL` when it repaired anything. Repairs that keep coming back mean someone is editing Neeter's board by hand, or the two sides disagree about a status.

## Taking it out again

1. Disconnect every mailbox (`npm run admin -- disconnect-mailbox --firm f_… --user u_…`, one per line of `mailboxes`), so each permission is withdrawn and each assistant removed.
2. Switch each firm to its Tallyhound address: `npm run admin -- set-mail --firm f_… --mode own --by <you>`. Letters that were waiting for a mailbox go on the next working morning.
3. Unset `TH_MAIL_LAYER` and restart.

Nothing is lost: the checklists, letters and history are Tallyhound's. The reverse, `--mode mailbox`, moves an existing firm onto the layer.

## Clean-ups that happen by themselves

- **A person leaves the firm:** their mailbox is disconnected and its assistant removed.
- **A firm is closed:** every mailbox is disconnected and every assistant removed, before the firm's key is destroyed. If Neeter cannot be reached at that moment, the closure still goes ahead and the log says `firm_mailboxes_not_removed`. Remove those assistants by hand at Neeter.
- **A client's records are deleted on schedule:** their project at Neeter is deleted.
