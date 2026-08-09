/**
 * POST /api/vote
 * body: { sessionToken, nomineeId }
 * success: {}
 * failure: 401 { error: "invalid_or_expired_session" } | 409 { error: "already_voted" }
 *          | 400 { error: "missing_fields" } | 403 { error: "voting_closed" | "voting_before" }
 *
 * Depends on:
 *   - resolveSession from session-routes.js (turns a sessionToken into a student_id)
 *   - recordVote from voting-logic.js (the atomic vote-write + hasVoted flip)
 *   - a getVotingStatus(db) you already have for /api/config — reused here so
 *     the server enforces the voting window too, not just the client.
 */

const { resolveSession } = require("./session-routes");
const { recordVote } = require("./voting-logic");

function registerVoteRoute(app, db, getVotingStatus) {
  app.post("/api/vote", async (req, res) => {
    const { sessionToken, nomineeId } = req.body || {};

    if (!sessionToken || !nomineeId) {
      return res.status(400).json({ error: "missing_fields" });
    }

    const status = await getVotingStatus(db); // "before" | "open" | "closed"
    if (status === "before") return res.status(403).json({ error: "voting_before" });
    if (status === "closed") return res.status(403).json({ error: "voting_closed" });

    const studentId = await resolveSession(db, sessionToken);
    if (!studentId) {
      return res.status(401).json({ error: "invalid_or_expired_session" });
    }

    const result = await recordVote(db, studentId, nomineeId);
    if (!result.success) {
      return res.status(409).json({ error: result.reason }); // "already_voted"
    }

    return res.json({});
  });
}

module.exports = { registerVoteRoute };
