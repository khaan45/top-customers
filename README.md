# Top Customer Vote — real backend (WhatsApp + SMS OTP)

| Was (demo) | Now |
|---|---|
| Fake name generated from a hash of the Student ID | Real `SELECT` against a `students` table (swap for your real DB) |
| OTP shown on-screen, checked in the browser | Real OTP, delivered by WhatsApp or SMS (voter's choice), checked server-side |
| "One vote per account" enforced in browser storage | Enforced by a real SQL constraint the browser can't bypass |
| Voting window / results math done in JS anyone can edit | Done server-side; the browser only ever sees what the server sends |

## How the pieces fit together

1. Frontend collects **Student ID + Mobile Number**, and the voter picks **WhatsApp or SMS**, then sends all three to `POST /api/otp/send`.
2. Backend looks up the student, confirms the mobile matches what's on file, generates a 6-digit code, and sends it via whichever channel was requested — WhatsApp via Meta's Cloud API, or SMS via your configured provider.
3. Student enters the code in the frontend, which sends it to `POST /api/otp/verify`.
4. Backend checks the code against what it stored (hashed, with a 5-minute expiry and a 5-attempt limit), and issues a short-lived session token.
5. That session token is required by `POST /api/vote` — one vote per student, real IP/timestamp, server-computed scores.

## Setup

### 1a. WhatsApp Business setup (Meta)

WhatsApp has a real requirement SMS doesn't: **you can't send an arbitrary first message.** An OTP is always the first message to someone, so it has to go through a pre-approved **message template** in the "Authentication" category.

- Go to [developers.facebook.com](https://developers.facebook.com) → create an app → add the **WhatsApp** product.
- Under **WhatsApp > API Setup**, you'll see a test phone number, a **Phone Number ID**, and a temporary access token — that's `WHATSAPP_PHONE_NUMBER_ID` and `WHATSAPP_TOKEN`. The default token expires in 24 hours; before your real voting period, generate a **permanent token** via a System User (Meta Business Settings > Users > System Users) so OTPs don't silently stop working mid-contest.
- Under **WhatsApp Manager > Message Templates**, create a new template: category **Authentication**, with a single body variable for the code (e.g. "Your verification code is {{1}}. Do not share this code."). Submit it — approval is usually quick, sometimes a few hours. That template's name goes in `WHATSAPP_TEMPLATE_NAME`.
- While testing, WhatsApp only lets you message numbers you've explicitly added under **API Setup > To** (a short allow-list) unless your app is fully live/verified. Add your own test number there first.

### 1b. SMS setup (fallback/alternative channel)

For students without WhatsApp, SMS still works as a second option. Set `SMS_PROVIDER` in `.env`:
- `console` — prints the code to your server logs instead of texting anyone. Good for local dev, never for production.
- `africastalking` — real SMS via Africa's Talking (common in East Africa). Fill in `AT_API_KEY` and `AT_USERNAME`.
- `generic_http` — any other provider with a simple HTTP send-message endpoint. Fill in `GENERIC_SMS_URL` and `GENERIC_SMS_API_KEY`, or edit `sms.js` if your provider's request shape is different.

### 2. Backend

```bash
cd vote-backend
npm install
cp .env.example .env
```

Edit `.env`: set `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_TEMPLATE_NAME`, an `SMS_PROVIDER` (start with `console` for local testing), `SESSION_SECRET` (e.g. `openssl rand -hex 32`), and real `VOTING_START`/`VOTING_END` dates.

```bash
npm run initdb
npm start
```

Test student: `UCS-2024-00214` / `252634567890` — but WhatsApp will only actually deliver to that number if it's a real WhatsApp account you've added to your test allow-list. Use your own real number for testing, and update the seeded row in `scripts/init-db.js` to match it.

### 3. Frontend

`top_customer_vote.html` already talks to `/api/otp/send` and `/api/otp/verify` — no WhatsApp-specific frontend code needed (unlike the earlier Firebase version, there's no SDK or reCAPTCHA to configure client-side). Just set:

```js
var API_BASE_URL = "https://your-backend.example.com";
```

## What's still on you

- **Deploying the backend.** A `render.yaml` blueprint is included for Render — New → Blueprint → point at your repo.
- **Meta Business verification.** To message anyone beyond your test allow-list, your WhatsApp Business app needs to go through Meta's app review / business verification — budget real time for this before launch, it's not instant.
- **Template approval.** Don't wait until voting day to submit your Authentication template.
- **Pointing `db.js` at your real student data**, not the seeded SQLite file.
- **HTTPS in production.**
- **`.gitignore` is included** — keeps `.env`, `node_modules/`, and the local SQLite file out of git.

## API summary

| Endpoint | What it does |
|---|---|
| `GET /api/config` | Voting window, nominee list, prize tiers |
| `POST /api/otp/send` | Confirms Student ID + mobile match your DB, sends OTP via WhatsApp |
| `POST /api/otp/verify` | Checks the code, issues a vote session token |
| `POST /api/vote` | Records one vote per student, server-enforced, with real IP + timestamp |
| `GET /api/results` | Live participation while open; full scores/prizes once closed |
