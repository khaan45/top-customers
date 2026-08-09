/**
 * GET /api/config  — nominee list, voting window, current status
 * GET /api/results — live/final results: vote counts + weighted score
 *
 * SCORE = 60% community vote + 40% semester loyalty (spend), per the
 * criteria shown on the page. Spend is historical (Jan–May 2026, already
 * final) so it's stored here as a static value per nominee rather than
 * queried — it never changes, unlike vote counts.
 *
 * EDIT THESE before deploying:
 *   - NOMINEES: the 5 finalists. Replace with whoever you've actually
 *     selected — these are just the top 5 by spend from your workbook,
 *     as a working default.
 *   - VOTING_START / VOTING_END: your real contest dates.
 */

const NOMINEES = [
  { id: "STU0603", firstName: "Mukhtaar", semesterSpend: 599500 },
  { id: "STU0083", firstName: "Naciima",  semesterSpend: 524500 },
  { id: "STU1150", firstName: "Safa",     semesterSpend: 523500 },
  { id: "STU1523", firstName: "Najma",    semesterSpend: 509000 },
  { id: "STU0528", firstName: "Saynab",   semesterSpend: 449500 },
];

const VOTING_START = new Date("2026-08-10T00:00:00Z");
const VOTING_END   = new Date("2026-08-24T00:00:00Z");

const PRIZES = ["$40", "$25", "$15", "$10", "$10"];

function getStatus(now) {
  now = now || new Date();
  if (now < VOTING_START) return "before";
  if (now > VOTING_END) return "closed";
  return "open";
}

// ------------------------------------------------------------------
// GET /api/config
// ------------------------------------------------------------------
function registerConfigRoute(app) {
  app.get("/api/config", (req, res) => {
    res.json({
      nominees: NOMINEES.map((n) => ({ id: n.id, firstName: n.firstName })),
      votingStart: VOTING_START.toISOString(),
      votingEnd: VOTING_END.toISOString(),
      status: getStatus(),
    });
  });
}

// ------------------------------------------------------------------
// GET /api/results
// Vote counts come from the real `ballots` table; spend is the static
// value above. Both are normalized 0-100 against the current max among
// the 5 nominees, then blended 60/40.
// ------------------------------------------------------------------
function registerResultsRoute(app, db) {
  app.get("/api/results", async (req, res) => {
    try {
      const { rows } = await db.query(`
        SELECT candidate_id, COUNT(*) AS vote_count
        FROM ballots
        GROUP BY candidate_id
      `);
      const votesById = {};
      rows.forEach((r) => { votesById[r.candidate_id] = Number(r.vote_count); });

      const totalVotes = Object.values(votesById).reduce((a, b) => a + b, 0);
      const maxVotes = Math.max(1, ...NOMINEES.map((n) => votesById[n.id] || 0));
      const maxSpend = Math.max(1, ...NOMINEES.map((n) => n.semesterSpend));

      const scored = NOMINEES.map((n) => {
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

module.exports = { registerConfigRoute, registerResultsRoute, getStatus, NOMINEES };
