# Top Customer Vote — Backend

This is a complete, deployable Express app. It was missing before — that's
why Render's build failed with `Could not read package.json`: there was no
project for it to build, just loose files.

## What's in this folder

| File | Purpose |
|---|---|
| `package.json` | Project manifest — Render needs this to know what to build |
| `server.js` | Entry point — starts Express, connects to Postgres, wires up all routes |
| `config-results.js` | `GET /api/config` (nominees, voting window) and `GET /api/results` |
| `session-routes.js` | `POST /api/students/lookup`, `POST /api/session/create` |
| `vote-route.js` | `POST /api/vote` |
| `voting-logic.js` | Shared helpers (phone normalizing, atomic vote recording) |
| `schema.sql` | Database tables — run this once against your Postgres database |
| `import_students.py` | Loads your Excel roster into the `students` table |

## Fixing the Render deploy

The error you hit — `ENOENT ... open '/opt/render/project/src/package.json'`
— means Render looked for `package.json` in the wrong place, because there
wasn't one anywhere. Here's the correct setup:

1. **Put every file in this folder into a GitHub repo.** All of them need
   to sit in the same directory as `package.json` — don't nest them in a
   subfolder unless you also set Render's "Root Directory" to match.

2. **In Render, create a new Web Service** from that repo, with:
   - **Root Directory**: leave blank if `package.json` is at the repo
     root; otherwise set it to the subfolder path
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Environment**: Node

3. **Add the `DATABASE_URL` environment variable** in Render's dashboard
   (Environment tab), pointing at your Postgres database. If your database
   is also on Render, use the **Internal Database URL** shown on the
   database's own page — it's faster and doesn't leave Render's network.

4. **Set up the database** (one-time, before or after first deploy):
   ```bash
   psql "$DATABASE_URL" -f schema.sql
   python import_students.py Student_Database.xlsx --db "$DATABASE_URL"
   ```

5. **Redeploy.** Render should now find `package.json`, run `npm install`,
   then `npm start`, and you'll see `Vote backend listening on port ...`
   in the logs.

6. **Point the frontend at it.** In your `index.html`, `API_BASE_URL`
   should be your Render service's URL, e.g.
   `https://top-customer-vote-backend.onrender.com` (with no trailing
   slash).

## Before this actually decides a real contest

`config-results.js` has the 5 finalists and voting window **hardcoded** as
placeholder values (the top 5 spenders from your workbook, and a made-up
two-week window) — open that file and edit the `NOMINEES`,
`VOTING_START`, and `VOTING_END` constants to the real ones before you
announce this to students.
