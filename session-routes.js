/**
 * Routes for the eligibility flow:
 *   POST /api/students/lookup   -> verify Student ID + mobile TOGETHER against the roster
 *   POST /api/session/create    -> issue a voting session once checkboxes are confirmed
 *
 * Depends on voting-logic.js (normalizePhone) and schema.sql (students, sessions tables).
 */

const crypto = require("crypto");
const { normalizePhone } = require("./voting-logic");

const SESSION_TTL_MINUTES = 45; // long enough to browse nominees and vote, not much more

// ------------------------------------------------------------------
// POST /api/students/lookup
// body: { studentId, mobile }
// success: { studentId, fullName }
// failure: 404 { error: "not_found" } | 403 { error: "inactive" }
//          | 409 { error: "already_voted" } | 400 { error: "missing_fields" }
//
// Requiring both fields (rather than mobile alone) means a match proves
// the requester knows two pieces of information about the student, not
// just a guessable phone number — meaningfully harder to spoof, though
// still not proof of identity the way OTP would be.
// ------------------------------------------------------------------
function registerLookupRoute(app, db) {
  app.post("/api/students/lookup", async (req, res) => {
    const { studentId, mobile } = req.body || {};

    if (!studentId || typeof studentId !== "string" ||
        !mobile || typeof mobile !== "string" || mobile.trim().length < 6) {
      return res.status(400).json({ error: "missing_fields" });
    }

    const { rows } = await db.query(
      "SELECT student_id, full_name, phone_number, status, has_voted FROM students WHERE student_id = $1",
      [studentId]
    );

    // Same "not_found" response whether the Student ID doesn't exist or
    // exists but the mobile doesn't match — don't let this endpoint be
    // used to confirm a guessed Student ID or a guessed mobile number
    // against a known one.
    if (rows.length === 0) {
      return res.status(404).json({ error: "not_found" });
    }

    const student = rows[0];
    if (normalizePhone(student.phone_number) !== normalizePhone(mobile)) {
      return res.status(404).json({ error: "not_found" });
    }
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
