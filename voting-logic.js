/**
 * Phone-based lookup & verification logic for student voting.
 *
 * Stack assumptions (swap for your own):
 *   - `db` is a Postgres-style client with db.query(sql, params) -> { rows }
 *   - `sendSms(phoneNumber, text)` is your SMS/USSD/WhatsApp sender
 *   - Node 18+ (for built-in crypto.randomInt / crypto.randomUUID)
 *
 * Table structure this assumes: see schema.sql (students, otp_codes, votes, ballots)
 */

const crypto = require("crypto");

const OTP_LENGTH = 6;
const OTP_TTL_MINUTES = 5;
const OTP_MAX_ATTEMPTS = 3;

// ------------------------------------------------------------------
// 1. Normalize phone number
// ------------------------------------------------------------------
// Strips spaces/dashes/parens and collapses common local-vs-international
// formats down to one canonical form: country code + subscriber number,
// digits only. Adjust the country-code rule for your own numbering plan.
function normalizePhone(raw) {
  if (!raw) return null;
  let digits = raw.replace(/[^\d]/g, "");

  // Example rule for Somaliland/Somalia-style numbers (+252):
  // '0638355592' -> '252638355592', already-international numbers pass through.
  if (digits.startsWith("0")) {
    digits = "252" + digits.slice(1);
  } else if (!digits.startsWith("252")) {
    digits = "252" + digits;
  }

  return digits;
}

// ------------------------------------------------------------------
// 2. Look up the student by phone number
// ------------------------------------------------------------------
async function lookupStudent(db, rawPhone) {
  const phone = normalizePhone(rawPhone);
  if (!phone) {
    return { found: false, reason: "invalid_phone" };
  }

  const { rows } = await db.query(
    "SELECT student_id, full_name, phone_number FROM students WHERE phone_number = $1",
    [phone]
  );

  if (rows.length === 0) {
    return { found: false, reason: "not_on_roster", phone };
  }

  return { found: true, student: rows[0] };
}

// ------------------------------------------------------------------
// 3. Send a one-time code to that phone
// ------------------------------------------------------------------
function hashCode(code) {
  return crypto.createHash("sha256").update(code).digest("hex");
}

async function sendOtp(db, sendSms, phone) {
  const code = crypto.randomInt(0, 10 ** OTP_LENGTH).toString().padStart(OTP_LENGTH, "0");
  const codeHash = hashCode(code);
  const expiresAt = new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000);

  await db.query(
    `INSERT INTO otp_codes (phone_number, code_hash, expires_at)
     VALUES ($1, $2, $3)`,
    [phone, codeHash, expiresAt]
  );

  await sendSms(phone, `Your voting verification code is ${code}. It expires in ${OTP_TTL_MINUTES} minutes.`);

  return { sent: true, expiresAt };
}

// Verify the code the user typed back in.
async function verifyOtp(db, phone, submittedCode) {
  const { rows } = await db.query(
    `SELECT id, code_hash, expires_at, attempts, consumed
     FROM otp_codes
     WHERE phone_number = $1
     ORDER BY created_at DESC
     LIMIT 1`,
    [phone]
  );

  if (rows.length === 0) {
    return { verified: false, reason: "no_otp_sent" };
  }

  const otp = rows[0];

  if (otp.consumed) {
    return { verified: false, reason: "already_used" };
  }
  if (new Date(otp.expires_at) < new Date()) {
    return { verified: false, reason: "expired" };
  }
  if (otp.attempts >= OTP_MAX_ATTEMPTS) {
    return { verified: false, reason: "too_many_attempts" };
  }

  const submittedHash = hashCode(submittedCode);
  if (submittedHash !== otp.code_hash) {
    await db.query("UPDATE otp_codes SET attempts = attempts + 1 WHERE id = $1", [otp.id]);
    return { verified: false, reason: "wrong_code" };
  }

  await db.query("UPDATE otp_codes SET consumed = TRUE WHERE id = $1", [otp.id]);
  return { verified: true };
}

// ------------------------------------------------------------------
// 4. Check whether this student has already voted
// ------------------------------------------------------------------
async function hasVoted(db, studentId) {
  const { rows } = await db.query(
    "SELECT 1 FROM votes WHERE student_id = $1",
    [studentId]
  );
  return rows.length > 0;
}

// ------------------------------------------------------------------
// 5. Record the vote (anonymously) and lock it
// ------------------------------------------------------------------
async function recordVote(db, studentId, candidateId) {
  const ballotToken = crypto.randomUUID();

  // Wrap in a transaction so a partial failure can't create an
  // orphaned ballot or a voter record with no matching ballot.
  await db.query("BEGIN");
  try {
    // Ballot: the choice, not linked to the student.
    await db.query(
      "INSERT INTO ballots (ballot_token, candidate_id) VALUES ($1, $2)",
      [ballotToken, candidateId]
    );

    // Voter record: that they voted, not what they voted for.
    // The UNIQUE/PRIMARY KEY constraint on student_id is the real
    // enforcement against double voting — do not rely on the
    // hasVoted() check alone, since two requests could race past it.
    await db.query(
      "INSERT INTO votes (student_id, ballot_token) VALUES ($1, $2)",
      [studentId, ballotToken]
    );

    // Keep students.has_voted in sync so /api/students/lookup can do a
    // fast single-row check without joining against votes.
    await db.query(
      "UPDATE students SET has_voted = TRUE WHERE student_id = $1",
      [studentId]
    );

    await db.query("COMMIT");
    return { success: true, ballotToken };
  } catch (err) {
    await db.query("ROLLBACK");
    if (err.code === "23505") {
      // unique_violation — this student already has a vote row
      return { success: false, reason: "already_voted" };
    }
    throw err;
  }
}

// ------------------------------------------------------------------
// Putting it together: the full flow for one voting attempt
// ------------------------------------------------------------------
//
// Step A (phone entry screen):
//   const { found, student, reason } = await lookupStudent(db, phoneInput);
//   if (!found) return showError(reason); // 'invalid_phone' | 'not_on_roster'
//   await sendOtp(db, sendSms, student.phone_number);
//   // -> move to code-entry screen
//
// Step B (code entry screen):
//   const { verified, reason } = await verifyOtp(db, student.phone_number, codeInput);
//   if (!verified) return showError(reason); // 'wrong_code' | 'expired' | ...
//   if (await hasVoted(db, student.student_id)) return showError('already_voted');
//   // -> move to ballot screen
//
// Step C (ballot submission):
//   const result = await recordVote(db, student.student_id, candidateId);
//   if (!result.success) return showError(result.reason);
//   return showConfirmation(result.ballotToken);

module.exports = {
  normalizePhone,
  lookupStudent,
  sendOtp,
  verifyOtp,
  hasVoted,
  recordVote,
};
