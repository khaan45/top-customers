const { Pool } = require('pg');
require('dotenv').config();

// Neon (and most managed Postgres) require SSL. rejectUnauthorized: false is
// fine here — Neon's certs are properly signed, this just skips Node's
// occasionally-fussy local CA bundle checks, a common pattern for managed
// Postgres connections.
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

async function init() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS students (
      student_id TEXT PRIMARY KEY,
      full_name TEXT NOT NULL,
      mobile TEXT NOT NULL,
      purchased_this_semester BOOLEAN NOT NULL DEFAULT false,
      is_staff BOOLEAN NOT NULL DEFAULT false
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS otps (
      student_id TEXT PRIMARY KEY,
      mobile TEXT NOT NULL,
      code_hash TEXT NOT NULL,
      expires_at BIGINT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS votes (
      student_id TEXT PRIMARY KEY,
      nominee_id TEXT NOT NULL,
      cast_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      ip TEXT,
      user_agent TEXT
    );
  `);
  // Real cafeteria payment records. Loaded here from historical data for
  // testing (see scripts/import-transactions.js) — IN PRODUCTION this
  // should instead be a live query against your actual payment feed
  // (Zaad/eDahab), not a static imported table, since "today's transaction"
  // only means something if the data is actually current. See the note on
  // findTodaysTransaction() below.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS transactions (
      transfer_id  BIGINT PRIMARY KEY,
      transfer_date TIMESTAMPTZ NOT NULL,
      full_name    TEXT NOT NULL,
      mobile       TEXT NOT NULL,
      credit       REAL,
      claimed_by_student_id TEXT
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_txn_mobile ON transactions(mobile);`);

  // Every significant thing that happens: OTP sends/verifies, registrations,
  // votes, and the reason for any rejection. This is what lets you actually
  // answer "who tried to vote, when, from where, and did it work" later —
  // the votes table alone only tells you about successful votes.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS audit_log (
      id           SERIAL PRIMARY KEY,
      at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      event_type   TEXT NOT NULL,
      student_id   TEXT,
      mobile       TEXT,
      detail       TEXT,
      ip           TEXT,
      user_agent   TEXT
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_audit_at ON audit_log(at);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_audit_event ON audit_log(event_type);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_audit_student ON audit_log(student_id);`);
}
// Run once at startup. server.js awaits this before accepting requests —
// see the top of server.js.
const ready = init();

/**
 * REAL LOOKUP GOES HERE.
 * Swap this for a query against your actual student/customer database
 * (e.g. the system behind your Zaad/eDahab transaction records). This
 * table is just a stand-in so the rest of the app has something real to
 * check against while you wire up the real source.
 */
async function studentLookup(studentId) {
  const { rows } = await pool.query('SELECT * FROM students WHERE student_id = $1', [studentId]);
  return rows[0] || null;
}

/**
 * The voter now only types their mobile number — the Student ID is looked
 * up automatically instead of typed in. Requires `mobile` to be unique in
 * the students table (it is, in the seeded data — see scripts/init-db.js).
 */
async function studentLookupByMobile(mobile) {
  const { rows } = await pool.query('SELECT * FROM students WHERE mobile = $1', [mobile]);
  return rows[0] || null;
}

async function saveOtp(studentId, mobile, codeHash, expiresAt) {
  await pool.query(
    `INSERT INTO otps (student_id, mobile, code_hash, expires_at, attempts)
     VALUES ($1, $2, $3, $4, 0)
     ON CONFLICT (student_id) DO UPDATE SET
       mobile = EXCLUDED.mobile, code_hash = EXCLUDED.code_hash,
       expires_at = EXCLUDED.expires_at, attempts = 0`,
    [studentId, mobile, codeHash, expiresAt]
  );
}

async function getOtp(studentId) {
  const { rows } = await pool.query('SELECT * FROM otps WHERE student_id = $1', [studentId]);
  return rows[0] || null;
}

async function bumpOtpAttempts(studentId) {
  await pool.query('UPDATE otps SET attempts = attempts + 1 WHERE student_id = $1', [studentId]);
}

async function clearOtp(studentId) {
  await pool.query('DELETE FROM otps WHERE student_id = $1', [studentId]);
}

async function getVote(studentId) {
  const { rows } = await pool.query('SELECT * FROM votes WHERE student_id = $1', [studentId]);
  return rows[0] || null;
}

async function castVote(studentId, nomineeId, ip, userAgent) {
  await pool.query(
    `INSERT INTO votes (student_id, nominee_id, cast_at, ip, user_agent)
     VALUES ($1, $2, NOW(), $3, $4)`,
    [studentId, nomineeId, ip, userAgent]
  );
}

async function allVotes() {
  const { rows } = await pool.query('SELECT nominee_id, COUNT(*) as n FROM votes GROUP BY nominee_id');
  return rows.map((r) => ({ nominee_id: r.nominee_id, n: Number(r.n) }));
}

/**
 * Records one audit event. Mobile numbers are masked (last 4 digits only)
 * before storage, since the log is meant for "what happened and when," not
 * as a second copy of everyone's full phone number.
 */
async function logEvent({ eventType, studentId, mobile, detail, ip, userAgent }) {
  const maskedMobile = mobile && mobile.length > 4
    ? mobile.slice(0, -4).replace(/./g, '*') + mobile.slice(-4)
    : mobile || null;
  await pool.query(
    `INSERT INTO audit_log (event_type, student_id, mobile, detail, ip, user_agent)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [eventType, studentId || null, maskedMobile, detail || null, ip || null, (userAgent || '').slice(0, 200)]
  );
}

/**
 * Read access for the admin endpoint. Supports simple filtering + paging
 * so the log stays usable once it has thousands of rows.
 */
async function queryAuditLog({ eventType, studentId, limit, before } = {}) {
  const clauses = [];
  const params = [];
  if (eventType) { params.push(eventType); clauses.push(`event_type = $${params.length}`); }
  if (studentId) { params.push(studentId); clauses.push(`student_id = $${params.length}`); }
  if (before) { params.push(before); clauses.push(`at < $${params.length}`); }
  const where = clauses.length ? 'WHERE ' + clauses.join(' AND ') : '';
  params.push(Math.min(Number(limit) || 100, 500));
  const { rows } = await pool.query(
    `SELECT * FROM audit_log ${where} ORDER BY at DESC, id DESC LIMIT $${params.length}`,
    params
  );
  return rows;
}

/**
 * Finds a transaction by its ID, checks it was made TODAY, and checks it
 * hasn't already been used to register an account (otherwise the same
 * receipt could be used to create unlimited fake voters).
 *
 * PRODUCTION NOTE: "today" here means today relative to whenever this
 * historical data was imported, which will drift out of date. Swap this
 * whole function for a live query against your real payment system —
 * the important checks (right date, not already claimed, mobile matches)
 * stay the same, only where the data comes from changes.
 */
async function findTodaysTransaction(transferId, mobile) {
  const { rows } = await pool.query('SELECT * FROM transactions WHERE transfer_id = $1', [transferId]);
  const row = rows[0];
  if (!row) return { ok: false, error: 'transaction_not_found' };
  if (row.claimed_by_student_id) return { ok: false, error: 'transaction_already_used' };

  const today = new Date().toISOString().slice(0, 10);
  const txnDate = new Date(row.transfer_date).toISOString().slice(0, 10);
  if (txnDate !== today) return { ok: false, error: 'transaction_not_today' };

  if (row.mobile !== mobile) return { ok: false, error: 'transaction_mobile_mismatch' };

  return { ok: true, transaction: row };
}

async function nextStudentId() {
  const { rows } = await pool.query(`
    SELECT student_id FROM students
    WHERE student_id LIKE 'UCS-2026-%'
    ORDER BY (SUBSTRING(student_id FROM 10))::INTEGER DESC
    LIMIT 1
  `);
  const next = rows[0] ? parseInt(rows[0].student_id.slice(9), 10) + 1 : 1;
  return 'UCS-2026-' + String(next).padStart(5, '0');
}

/**
 * Registers a brand-new student from a same-day transaction. Returns the
 * new student record. Marks the transaction as claimed so it can't be
 * reused to mint additional accounts.
 */
async function registerStudentFromTransaction(transferId, mobile) {
  const check = await findTodaysTransaction(transferId, mobile);
  if (!check.ok) return check;

  const existingRes = await pool.query('SELECT * FROM students WHERE mobile = $1', [mobile]);
  if (existingRes.rows[0]) return { ok: false, error: 'already_registered', student: existingRes.rows[0] };

  const studentId = await nextStudentId();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO students (student_id, full_name, mobile, purchased_this_semester, is_staff)
       VALUES ($1, $2, $3, true, false)`,
      [studentId, check.transaction.full_name, mobile]
    );
    await client.query(
      'UPDATE transactions SET claimed_by_student_id = $1 WHERE transfer_id = $2',
      [studentId, transferId]
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  const { rows } = await pool.query('SELECT * FROM students WHERE student_id = $1', [studentId]);
  return { ok: true, student: rows[0] };
}

/**
 * Directly adds a student — no transaction proof required. This is for
 * YOU (the admin) adding someone by hand (e.g. scripts/add-student.js),
 * not something exposed to voters — there's no public endpoint for this,
 * unlike registerStudentFromTransaction() which voters trigger themselves.
 */
async function adminAddStudent(fullName, mobile, purchasedThisSemester, isStaff) {
  const existingRes = await pool.query('SELECT * FROM students WHERE mobile = $1', [mobile]);
  if (existingRes.rows[0]) return { ok: false, error: 'already_registered', student: existingRes.rows[0] };

  const studentId = await nextStudentId();
  await pool.query(
    `INSERT INTO students (student_id, full_name, mobile, purchased_this_semester, is_staff)
     VALUES ($1, $2, $3, $4, $5)`,
    [studentId, fullName, mobile, !!purchasedThisSemester, !!isStaff]
  );

  const { rows } = await pool.query('SELECT * FROM students WHERE student_id = $1', [studentId]);
  return { ok: true, student: rows[0] };
}

module.exports = {
  pool, ready, studentLookup, studentLookupByMobile, saveOtp, getOtp, bumpOtpAttempts, clearOtp,
  getVote, castVote, allVotes, findTodaysTransaction, registerStudentFromTransaction,
  adminAddStudent, logEvent, queryAuditLog,
};
