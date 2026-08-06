# Top Customer Vote — real backend (Firebase Phone Auth)

| Was (demo) | Now |
|---|---|
| Fake name generated from a hash of the Student ID | Real `SELECT` against a `students` table (swap for your real DB) |
| OTP shown on-screen, checked in the browser | Firebase Phone Auth: real SMS, real code check, on Google's infrastructure |
| "One vote per account" enforced in browser storage | Enforced by a real SQL constraint the browser can't bypass |
| Voting window / results math done in JS anyone can edit | Done server-side; the browser only ever sees what the server sends |

## How the pieces fit together

1. Frontend collects **Student ID + Mobile Number**, sends them to `POST /api/students/check` — this confirms the student is real and the mobile matches what's on file, and returns their **Full Name** (auto-filled).
2. Frontend then calls Firebase's `signInWithPhoneNumber(...)` directly — **Firebase sends the real SMS**, not this backend.
3. Student enters the code. Firebase verifies it client-side and hands back an ID token.
4. Frontend sends that token to `POST /api/session/create`. The backend verifies it with the **Firebase Admin SDK**, double-checks the phone number on the token matches the student's registered mobile, and issues its own short-lived session token.
5. That session token is required by `POST /api/vote` — the vote itself is still 100% this backend's own logic (one vote per student, real IP/timestamp, server-computed scores).

Firebase only replaces the "send/check an SMS code" piece. Everything else — who's a real student, who already voted, the scoring, the results — is still your own backend and your own database.

## Setup

### 1. Create a Firebase project
- Go to the [Firebase Console](https://console.firebase.google.com), create a project.
- **Authentication > Sign-in method > Phone** → enable it.
- **Authentication > Settings > Authorized domains** → add your real portal domain (`localhost` is already authorized for local testing).
- Phone Auth requires the **Blaze (pay-as-you-go)** plan once you're past Firebase's small free/testing quota — check current pricing before launch.

### 2. Get your two Firebase credentials
These are **not interchangeable** — mixing them up is a security bug:

- **Web config** (public, goes in the frontend): Project Settings > General > Your apps > Web app > SDK setup and config. Paste it into the `firebaseConfig` object near the top of `top_customer_vote.html`.
- **Service account key** (secret, backend only): Project Settings > Service Accounts > Generate new private key. Save the JSON file *outside* your web root, and point `FIREBASE_SERVICE_ACCOUNT_PATH` at it in `.env`. Never commit it, never send it to the browser.

### 3. Backend

```bash
cd vote-backend
npm install
cp .env.example .env
```

Edit `.env`: set `FIREBASE_SERVICE_ACCOUNT_PATH`, `SESSION_SECRET` (e.g. `openssl rand -hex 32`), and real `VOTING_START`/`VOTING_END` dates.

Seed test students and start the server:

```bash
npm run initdb
npm start
```

Test student: `UCS-2024-00214` / `252634567890` — but note Firebase will try to send a **real SMS** to whatever number you actually enter once Phone Auth is live, so use a real phone you control for testing, not the fake seeded number, unless you've set up [Firebase's test phone numbers](https://firebase.google.com/docs/auth/web/phone-auth#test-with-fictional-phone-numbers) (recommended for development — configurable in Authentication > Sign-in method > Phone > Phone numbers for testing).

### 4. Frontend

Open `top_customer_vote.html` and fill in both:

```js
var API_BASE_URL = "https://your-backend.example.com";
var firebaseConfig = { apiKey: "...", authDomain: "...", /* ... */ };
```

Serve it over `http://` or `https://`, not `file://` (Firebase's reCAPTCHA and your backend's CORS both need a real origin).

## What's still on you

- **Deploying the backend.** Plain Node/Express — any VPS, Render, Railway, Fly.io, etc.
- **Firebase billing.** Phone Auth volume beyond the free tier needs the Blaze plan.
- **Pointing `db.js` at your real student data**, not the seeded SQLite file.
- **HTTPS in production.**

## API summary

| Endpoint | What it does |
|---|---|
| `GET /api/config` | Voting window, nominee list, prize tiers |
| `POST /api/students/check` | Confirms Student ID + mobile match your DB, returns Full Name |
| `POST /api/session/create` | Verifies the Firebase ID token, issues a vote session token |
| `POST /api/vote` | Records one vote per student, server-enforced, with real IP + timestamp |
| `GET /api/results` | Live participation while open; full scores/prizes once closed |
