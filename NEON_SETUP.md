# Setting up Neon (free Postgres, no credit card)

This replaces the local SQLite database. No payment method needed anywhere
in this setup — Neon's free tier is permanent, not a trial.

## 1. Create your database

- Go to [neon.tech](https://neon.tech) → Sign up (GitHub or email — no card requested).
- Create a project. Give it any name (e.g. `top-customer-vote`).
- Neon shows you a **Connection string** immediately — looks like:
  ```
  postgresql://neondb_owner:AbC123xyz@ep-cool-name-12345.us-east-2.aws.neon.tech/neondb?sslmode=require
  ```
- Copy that whole string.

## 2. Set it as DATABASE_URL

Locally, in `.env`:
```
DATABASE_URL=postgresql://neondb_owner:AbC123xyz@ep-cool-name-12345.us-east-2.aws.neon.tech/neondb?sslmode=require
```

On Render: Environment tab → add `DATABASE_URL` → paste the same string.

## 3. Run it

```bash
npm install
npm run initdb
npm start
```

The first `npm start` (or the first real request if deployed) automatically
creates all the tables — you don't write or run any SQL by hand. Watch the
console for `Vote API listening on :4000`; if it instead prints "Failed to
initialize database," double-check you copied the full connection string
including `?sslmode=require` at the end.

## What changed from the SQLite version

- No more `STUDENT_DB_PATH` or a local `.db` file — `DATABASE_URL` is the
  only database setting now.
- No persistent disk needed on Render — you can use the plain **free** plan.
  The earlier instructions about upgrading to a paid plan + adding a disk
  no longer apply.
- Every database function in `db.js` is now `async` (Postgres queries are
  asynchronous, unlike the old synchronous SQLite calls) — this only
  matters if you're editing the code; the scripts and API behave the same
  from the outside.

## Free tier limits (so you know what to expect)

Neon's free tier gives you 0.5 GB storage and scales compute to zero when
idle (auto-wakes in about half a second on the next request — you might
notice a brief pause on the very first request after a quiet period, not
on every request). For a university cafeteria vote — a few thousand
students at most — this is comfortably enough.
