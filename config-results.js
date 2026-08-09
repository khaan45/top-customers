/**
 * GET /api/config  — nominee list (auto-selected), voting window, status
 * GET /api/results — live/final results: vote counts + weighted score
 *
 * Nominees are no longer a hand-edited list — the system picks the top
 * NUM_FINALISTS Active students by semester_spend_slsh automatically,
 * straight from the database. Re-running import_students.py with fresh
 * spend data (or students changing status) changes who qualifies without
 * touching this file.
 *
 * SCORE = 60% community vote + 40% semester loyalty (spend), per the
 * criteria shown on the page.
 *
 * EDIT THESE before deploying:
 *   - NUM_FINALISTS: how many top spenders become finalists.
 *   - VOTING_START / VOTING_END: your real contest dates.
 */

const NUM_FINALISTS = 5;

const VOTING_START = new Date("2026-08-09T00:00:00Z");
const VOTING_END   = new Date("2026-08-23T00:00:00Z");

const PRIZES = ["$40", "$25", "$15", "$10", "$10"];

function getStatus(now) {
  now = now || new Date();
  if (now < VOTING_START) return "before";
  if (now > VOTING_END) return "closed";
  return "open";
}

// Picks the top NUM_FINALISTS Active students by spend. Only Active
// students are eligible — someone who left, graduated, or went on leave
// won't surface here even if their historical spend was high.
async function getFinalists(db) {
  const { rows } = await db.query(
    `SELECT student_id, full_name, semester_spend_slsh
     FROM students
     WHERE status = 'Active'
     ORDER BY semester_spend_slsh DESC
     LIMIT $1`,
    [NUM_FINALISTS]
  );
  return rows.map((r) => ({
    id: r.student_id,
    // First name only, matching the "first names only, full identity kept
    // private" promise on the page — full_name is "FIRST MIDDLE LAST...",
    // so take the first token and title-case it for display.
    firstName: r.full_name.trim().split(/\s+/)[0].toLowerCase()
      .replace(/^./, (c) => c.toUpperCase()),
    semesterSpend: r.semester_spend_slsh,
  }));
}

// ------------------------------------------------------------------
// GET /api/config
// ------------------------------------------------------------------
function registerConfigRoute(app, db) {
  app.get("/api/config", async (req, res) => {
    try {
      const nominees = await getFinalists(db);
      res.json({
        nominees: nominees.map((n) => ({ id: n.id, firstName: n.firstName })),
        votingStart: VOTING_START.toISOString(),
        votingEnd: VOTING_END.toISOString(),
        status: getStatus(),
      });
    } catch (err) {
      console.error("config query failed", err);
      res.status(500).json({ error: "config_unavailable" });
    }
  });
}

// ------------------------------------------------------------------
// GET /api/results
// Vote counts come from the real `ballots` table; spend comes from the
// same live query as the finalist selection. Both are normalized 0-100
// against the current max among the finalists, then blended 60/40.
// ------------------------------------------------------------------
function registerResultsRoute(app, db) {
  app.get("/api/results", async (req, res) => {
    try {
      const nominees = await getFinalists(db);

      const { rows } = await db.query(`
        SELECT candidate_id, COUNT(*) AS vote_count
        FROM ballots
        GROUP BY candidate_id
      `);
      const votesById = {};
      rows.forEach((r) => { votesById[r.candidate_id] = Number(r.vote_count); });

      const totalVotes = Object.values(votesById).reduce((a, b) => a + b, 0);
      const maxVotes = Math.max(1, ...nominees.map((n) => votesById[n.id] || 0));
      const maxSpend = Math.max(1, ...nominees.map((n) => n.semesterSpend));

      const scored = nominees.map((n) => {
        const votes = votesById[n.id] || 0;
        const voteScore = (votes / maxVotes) * 100;
        const spendScore = (n.semesterSpend / maxSpend) * 100;
        const score = 0.6 * voteScore + 0.4 * spendScore;
        return { id: n.id, votes, score };
      });

      scored.sort((a, b) => b.score - a.score);
      scored.forEach((r, idx) => {
        r.rank = idx + 1;
        r.prize = PRIZES[idx] || "";
      });

      const participating = scored.filter((r) => r.votes > 0).map((r) => r.id);

      res.json({
        status: getStatus(),
        totalVotes,
        participating,
        results: getStatus() === "closed" ? scored : null, // hide numbers until close, per the page's own copy
      });
    } catch (err) {
      console.error("results query failed", err);
      res.status(500).json({ error: "results_unavailable" });
    }
  });
}

module.exports = { registerConfigRoute, registerResultsRoute, getStatus, getFinalists };
