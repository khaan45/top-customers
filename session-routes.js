/**
 * Routes for the eligibility flow:
 *   POST /api/students/lookup   -> match a phone number against the roster,
 *                                  and pull back Student ID + name automatically
 *   POST /api/session/create    -> issue a voting session once checkboxes are confirmed
 *
 * Depends on voting-logic.js (normalizePhone) and schema.sql (students, sessions tables).
 */

const crypto = require("crypto");
const { normalizePhone } = require("./voting-logic");

const SESSION_TTL_MINUTES = 45; // long enough to browse nominees and vote, not much more

// ------------------------------------------------------------------
// POST /api/students/lookup
// body: { mobile }
// success: { studentId, fullName }
// failure: 404 { error: "mobile_not_found" } | 403 { error: "inactive" }
//          | 409 { error: "already_voted" } | 400 { error: "missing_fields" }
//
// Matching on phone number alone is simpler for students (no ID needed on
// hand), but means a match only proves the phone number is on the roster —
// not that the person typing it is its actual owner. Anyone who knows or
// guesses a registered number could confirm eligibility for that student.
// The one-vote-per-student constraint in the database is what actually
// caps the damage: at most one vote gets "used up" per real account.
// ------------------------------------------------------------------
function registerLookupRoute(app, db) {
  app.post("/api/students/lookup", async (req, res) => {
    const { mobile } = req.body || {};

    if (!mobile || typeof mobile !== "string" || mobile.trim().length < 6) {
      return res.status(400).json({ error: "missing_fields" });
    }

    const normalizedPhone = normalizePhone(mobile);
    const { rows } = await db.query(
      "SELECT student_id, full_name, status, has_voted FROM students WHERE phone_number = $1",
      [normalizedPhone]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: "mobile_not_found" });
    }

    const student = rows[0];
    if (student.status !== "Active") {
      return res.status(403).json({ error: "inactive" });
    }
    if (student.has_voted) {
      return res.status(409).json({ error: "already_voted" });
    }

    return res.json({
      studentId: student.student_id,
      fullName: student.full_name,
    });
  });
}

// ------------------------------------------------------------------
// POST /api/session/create
// body: { studentId, mobile, hasAccountConfirmed, ageConfirmed, notStaffConfirmed }
// success: { sessionToken }
// failure: 400 { error: "checkboxes_required" } | 404 { error: "student_not_found" }
//          | 409 { error: "already_voted" }
// ------------------------------------------------------------------
function registerSessionRoute(app, db) {
  app.post("/api/session/create", async (req, res) => {
    const {
      studentId,
      mobile,
      hasAccountConfirmed,
      ageConfirmed,
      notStaffConfirmed,
    } = req.body || {};

    if (!hasAccountConfirmed || !ageConfirmed || !notStaffConfirmed) {
      return res.status(400).json({ error: "checkboxes_required" });
    }

    // Re-verify the student/phone pairing server-side — never trust the
    // studentId the client sends without checking it against the phone
    // number that was actually looked up.
    const normalizedPhone = normalizePhone(mobile);
    const { rows } = await db.query(
      "SELECT student_id FROM students WHERE student_id = $1 AND phone_number = $2",
      [studentId, normalizedPhone]
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: "student_not_found" });
    }

    const { rows: votedRows } = await db.query(
      "SELECT 1 FROM votes WHERE student_id = $1",
      [studentId]
    );
    if (votedRows.length > 0) {
      return res.status(409).json({ error: "already_voted" });
    }

    const token = crypto.randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + SESSION_TTL_MINUTES * 60 * 1000);

    await db.query(
      "INSERT INTO sessions (token, student_id, expires_at) VALUES ($1, $2, $3)",
      [token, studentId, expiresAt]
    );

    return res.json({ sessionToken: token });
  });
}

// ------------------------------------------------------------------
// Helper other routes (e.g. /api/vote) should use to resolve a session
// token back to a student_id, rather than trusting studentId from the body.
// ------------------------------------------------------------------
async function resolveSession(db, token) {
  if (!token) return null;
  const { rows } = await db.query(
    "SELECT student_id, expires_at FROM sessions WHERE token = $1",
    [token]
  );
  if (rows.length === 0) return null;
  if (new Date(rows[0].expires_at) < new Date()) return null;
  return rows[0].student_id;
}

module.exports = {
  registerLookupRoute,
  registerSessionRoute,
  resolveSession,
};
