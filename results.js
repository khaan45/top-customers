/**
 * Vote tallying logic + admin results endpoint.
 * Depends on the schema in schema.sql (students, votes, ballots).
 *
 * Assumes `db` is a Postgres-style client with db.query(sql, params) -> { rows }
 */

// ------------------------------------------------------------------
// Tally votes per candidate
// ------------------------------------------------------------------
async function getResults(db) {
  const { rows } = await db.query(`
    SELECT candidate_id, COUNT(*) AS vote_count
    FROM ballots
    GROUP BY candidate_id
    ORDER BY vote_count DESC
  `);

  const totalVotes = rows.reduce((sum, r) => sum + Number(r.vote_count), 0);

  return rows.map((r) => ({
    candidateId: r.candidate_id,
    voteCount: Number(r.vote_count),
    percentage: totalVotes === 0 ? 0 : Math.round((Number(r.vote_count) / totalVotes) * 1000) / 10,
  }));
}

// ------------------------------------------------------------------
// Turnout: how many eligible students have voted vs. total roster
// ------------------------------------------------------------------
async function getTurnout(db) {
  const [{ rows: totalRows }, { rows: votedRows }] = await Promise.all([
    db.query("SELECT COUNT(*) AS total FROM students"),
    db.query("SELECT COUNT(*) AS voted FROM votes"),
  ]);

  const totalStudents = Number(totalRows[0].total);
  const votedCount = Number(votedRows[0].voted);

  return {
    totalStudents,
    votedCount,
    remaining: totalStudents - votedCount,
    turnoutPercentage: totalStudents === 0 ? 0 : Math.round((votedCount / totalStudents) * 1000) / 10,
  };
}

// ------------------------------------------------------------------
// Votes over time (for a turnout trend line)
// ------------------------------------------------------------------
async function getVotesOverTime(db) {
  const { rows } = await db.query(`
    SELECT date_trunc('hour', voted_at) AS hour, COUNT(*) AS count
    FROM votes
    GROUP BY hour
    ORDER BY hour
  `);
  return rows.map((r) => ({ hour: r.hour, count: Number(r.count) }));
}

// ------------------------------------------------------------------
// Express route: GET /api/admin/results
// Protect this behind admin auth — it's aggregate-only (no per-student
// choices are exposed, since ballots aren't linked to students), but
// live results before voting closes can still influence turnout.
// ------------------------------------------------------------------
function registerResultsRoute(app, db, requireAdmin) {
  app.get("/api/admin/results", requireAdmin, async (req, res) => {
    try {
      const [results, turnout, trend] = await Promise.all([
        getResults(db),
        getTurnout(db),
        getVotesOverTime(db),
      ]);
      res.json({ results, turnout, trend });
    } catch (err) {
      console.error("results fetch failed", err);
      res.status(500).json({ error: "failed_to_load_results" });
    }
  });
}

module.exports = {
  getResults,
  getTurnout,
  getVotesOverTime,
  registerResultsRoute,
};
