# Running Tallyhound on your own computer

This is for trying it out and for the first run against each outside service. It is not production: `docs/DEPLOY.md` is.
Everything on this page was run start to finish on November 20, 2026.

## What you need

- Node 22.18 or later (`node -v`).
- Postgres 14 or later, or Docker to run it for you.

## Start it

    npm install
    npm run local:setup

`local:setup` writes `.env` with a new master key and link secret and leaves an existing `.env` alone. **Keep that file.**
Everything Tallyhound stores is sealed with the master key in it; lose the key and nothing stored can be read again.

Then a database. Either:

    docker compose up -d db                 # Postgres on 127.0.0.1:5432, as .env expects
    # or, with your own Postgres:
    createdb th_dev

Then:

    npm run build
    npm run admin -- create-firm --name "Your Firm CPAs" --inbox yourfirm@docs.tallyhound.com \
        --zone America/Chicago --owner-name "Your Name" --owner-email you@example.com --plan Practice
    npm run admin -- firm-check --firm f_... --by "Your Name"
    npm start

`create-firm` prints the firm id that `firm-check` needs. Leave out `--plan Practice` to start on the 14-day trial instead.
Without `firm-check` the firm can sign in and set up, and nothing is sent or read.

Open http://localhost:3000.

To run the database and the app both in Docker instead: `docker compose up --build`, then run the two `admin` commands
with `docker compose exec app npm run admin -- ...`. The compose file has not been run here (no Docker on the build machine);
the image's steps have.

## Signing in with no email service

Enter the owner's email on the sign-in page. With no `POSTMARK_TOKEN`, the sign-in link is printed in the terminal where
`npm start` is running (development only; never in production). Open it, then scan the code with an authenticator app
(1Password, Google Authenticator, Authy). Save the recovery codes it shows you: they are shown once.

## What works with no keys at all

Signing in, adding and importing clients, checklists, every screen and setting, staff uploading a document, the client's
own pages (`/c/`, `/u/`, `/e/`, `/f/`), handing files off as a zip, the timer, `/quote`.

What does not, and what you see instead:

| Missing | What happens |
|---|---|
| `ANTHROPIC_API_KEY` | Documents are not read: each one goes to Needs you for a person. Messages use the standard wording. Ask is hidden |
| `POSTMARK_TOKEN` | Emails to clients are recorded as failed, "Email is not connected yet" |
| `TWILIO_*` | Nothing, for an email-first firm (every firm made now): it sends no texts. Only matters if texting returns |
| `TH_MAIL_LAYER` | Nothing. Unset, client letters go from the firm's Tallyhound address through Postmark. Set it to `fake` to try mailbox connection and the mirror on your own computer with a stand-in (it also needs `GOOGLE_CLIENT_ID` or `MICROSOFT_CLIENT_ID`); see `docs/V2.md` |
| The rest | That feature's tab, switch or button is simply not shown |

## Is each service really working?

    npm run admin -- check-services

One harmless question to every service that is set up. Nothing is sent to anyone and no secret is printed. Each line says
`ok`, `FAILED` and why, or `not set` and what you lose. It also tells you when a webhook address at Twilio or Postmark is
not pointing at this service. Two real sends, only when you ask:

    npm run admin -- check-services --email you@example.com
    npm run admin -- check-services --text 6155550100 --from 6155550199      # --from is your Twilio number

Run it after every change to `.env`. This is the first live run: these services have only ever been tested against
stand-ins, so expect the first real answers to show something that needs fixing. Tell the developer exactly what the line says.

## Letting Twilio, Postmark and Stripe reach your computer

They call Tallyhound when a text, an email or a payment arrives, so they need a public address. On your own computer that
means a tunnel:

    cloudflared tunnel --url http://localhost:3000        # or: ngrok http 3000

Put the `https://...` address it prints into `.env` as `APP_URL`, restart `npm start`, and give each service its address:

| Service | Where | Address |
|---|---|---|
| Twilio | Messaging service, incoming messages | `<APP_URL>/hooks/twilio` (fallback `<APP_URL>/hooks/twilio/fallback`, status `<APP_URL>/hooks/twilio/status`) |
| Postmark | Server, inbound webhook | `https://postmark:<POSTMARK_HOOK_PASSWORD>@<host>/hooks/postmark/inbound`; bounces to `/hooks/postmark/bounce` the same way |
| Stripe | Webhooks | `<APP_URL>/hooks/stripe` |
| Google, Microsoft, Dropbox | The app's allowed return addresses | `<APP_URL>/api/storage/<google, onedrive, sharepoint or dropbox>/callback` |

`APP_URL` must be exact: Twilio signs each request against it, and a mismatch rejects every text. A free tunnel's address
changes each time it starts, so each service has to be told again.

## Order to connect things in

1. Nothing. Click through every screen with a made-up client list first.
2. `ANTHROPIC_API_KEY`, then have staff upload a photo of a sample W-2 from a client's page. This is the heart of the product.
3. `POSTMARK_TOKEN` and `TH_SIGNIN_FROM`, then `check-services --email`.
4. A tunnel, then Postmark inbound: email a document to the firm's Tallyhound address.
5. The whole email-first round trip: press Go fetch for a client whose email is yours, open the letter, upload a document through its link, and reply to it.
6. Twilio only if texting returns: an email-first firm sends no texts.
6. Stripe in test mode, Drive, and the rest.

Use made-up clients and the sample forms. No real client's documents until counsel has signed off and you are on a real host.

## Looking at it, and starting again

    npm run admin -- firms
    npm run admin -- status
    npm run admin -- usage

To wipe everything: stop the app, drop and recreate the database (`dropdb th_dev && createdb th_dev`, or
`docker compose down -v`), and delete the `.data` folder. Keep `.env` unless you mean to start with a new master key.
