/**
 * Top Customer Vote — backend entry point.
 *
 * Required environment variable:
 *   DATABASE_URL — your Postgres connection string (Render's Postgres
 *                  dashboard → Connect → "External Database URL" or
 *                  "Internal Database URL" if the DB is on Render too).
 *
 * Local run:
 *   npm install
 *   DATABASE_URL=postgresql://user:pass@host:5432/dbname npm start
 *
 * On Render:
 *   - Root Directory: wherever this file lives in your repo (often the repo root)
 *   - Build Command:  npm install
 *   - Start Command:  npm start
 *   - Environment:    add DATABASE_URL as an env var in Render's dashboard
 */

const express = require("express");
const cors = require("cors");
const { Pool } = require("pg");

const { registerLookupRoute, registerSessionRoute } = require("./session-routes");
const { registerVoteRoute } = require("./vote-route");
const { registerConfigRoute, registerResultsRoute, getStatus } = require("./config-results");

if (!process.env.DATABASE_URL) {
  console.error("Missing DATABASE_URL environment variable. Set it in Render's dashboard (or your .env locally) before starting.");
  process.exit(1);
}

const db = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL.includes("localhost") ? false : { rejectUnauthorized: false },
});

const app = express();
app.use(cors());
app.use(express.json());

registerConfigRoute(app, db);
registerResultsRoute(app, db);
registerLookupRoute(app, db);
registerSessionRoute(app, db);
registerVoteRoute(app, db, async () => getStatus()); // getStatus doesn't need the db, but vote-route expects an async fn

app.get("/", (req, res) => {
  res.json({ ok: true, service: "top-customer-vote-backend" });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Vote backend listening on port ${PORT}`);
});
