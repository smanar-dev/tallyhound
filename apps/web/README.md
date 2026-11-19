# The Tallyhound staff web app

React, built with Vite. `npm run build` writes `apps/web/dist`, and the web service (`apps/server`) serves it.

## How it works

- **The engine is the read model.** `GET /api/state` returns the firm's workspace as the engine saved it. `src/lib/firm.tsx` loads it into the same rules engine the server runs (wrapped as a module at build time by `vite.config.ts`). Screens call engine functions for everything they show: `T.pipeline()`, `T.verdict(doc)`, `T.access()`. Nothing is worked out twice.
- **One way to change anything.** `act("decideTask", id, "waive")` posts to `/api/act`, the server checks the role and runs the engine, and the state is fetched again. A screen never edits the state it holds.
- **It looks like the demo.** `src/styles/app.css` is the demo's stylesheet. `reference/artifact` is the reference for every screen; each screen here is a port of the matching function in its `ui.js`.

## Working on it

    npm run build         # once, and after every change you want the server to serve
    npm run dev:web       # live reload on port 5173, passing /api and /auth to a server on port 3000
    npm run test:e2e      # real browser, real web service, in memory. Needs a build first

## Rules

- Text goes in as text. No `dangerouslySetInnerHTML`, no inline script. The Content-Security-Policy would block it and `e2e/rules.test.ts` checks it on every screen.
- A button appears only when it works (`docs/UX.md` rule 6). A screen that is not built says so (`src/screens/Soon.tsx`).
- Use the words in `docs/UX.md`. The retired ones fail the build.
- Add a new screen's address to `ROUTES` in `e2e/rules.test.ts` so the three cross-screen checks cover it.

## Built so far

| Screen | Ticket | State |
|---|---|---|
| Sign in, two-step setup, recovery codes | T-139 | Done |
| Shell: menu, client search, alerts, banners | T-15 | Done |
| Home: first steps, connect once, the five counts, Needs you, activity, progress, coming up | T-15, T-41 | Done. The buttons for flows not built yet (text registration, heads-up wording, storage) are left out until those flows exist |
| Clients: list, filters, selection, add a client, choose a checklist, start collecting | T-16, T-38, T-39 | Done |
| Client page: checklist, suggested, documents, conversation and approvals, activity, details | T-16, T-18, T-90 | Done, except the Hound panel and the check-in card |
| Needs you, and the document viewer | T-17, T-19, T-40 | Done. PDFs open in their own tab |
| Add clients: the four-step import | T-24 | Done. CSV only |
| All messages, with unknown senders | | Done |
| The Hound, Progress, Settings | T-20 | Not built: each shows a holding screen |
