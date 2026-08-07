const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const dbPath = process.env.STUDENT_DB_PATH || './data/students.db';
fs.mkdirSync(path.dirname(dbPath), { recursive: true });
const db = new Database(dbPath);

db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS students (
    student_id TEXT PRIMARY KEY,
    full_name TEXT NOT NULL,
    mobile TEXT NOT NULL,
    purchased_this_semester INTEGER NOT NULL DEFAULT 0,
    is_staff INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS otps (
    student_id TEXT PRIMARY KEY,
    mobile TEXT NOT NULL,
    code_hash TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS votes (
    student_id TEXT PRIMARY KEY,
    nominee_id TEXT NOT NULL,
    cast_at TEXT NOT NULL,
    ip TEXT,
    user_agent TEXT
  );

  -- Real cafeteria payment records. Loaded here from historical data for
  -- testing (see scripts/import-transactions.js) — IN PRODUCTION this
  -- should instead be a live query against your actual payment feed
  -- (Zaad/eDahab), not a static imported table, since "today's transaction"
  -- only means something if the data is actually current. See the note on
  -- findTodaysTransaction() below.
  CREATE TABLE IF NOT EXISTS transactions (
    transfer_id  INTEGER PRIMARY KEY,
    transfer_date TEXT NOT NULL,
    full_name    TEXT NOT NULL,
    mobile       TEXT NOT NULL,
    credit       REAL,
    claimed_by_student_id TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_txn_mobile ON transactions(mobile);

  -- Every significant thing that happens: OTP sends/verifies, registrations,
  -- votes, and the reason for any rejection. This is what lets you actually
  -- answer "who tried to vote, when, from where, and did it work" later —
  -- the votes table alone only tells you about successful votes.
  CREATE TABLE IF NOT EXISTS audit_log (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    at           TEXT NOT NULL DEFAULT (datetime('now')),
    event_type   TEXT NOT NULL,
    student_id   TEXT,
    mobile       TEXT,
    detail       TEXT,
    ip           TEXT,
    user_agent   TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_audit_at ON audit_log(at);
  CREATE INDEX IF NOT EXISTS idx_audit_event ON audit_log(event_type);
  CREATE INDEX IF NOT EXISTS idx_audit_student ON audit_log(student_id);
`);

/**
 * REAL LOOKUP GOES HERE.
 * Swap this for a query against your actual student/customer database
 * (e.g. the system behind your Zaad/eDahab transaction records). This
 * SQLite table is just a stand-in so the rest of the app has something
 * real to check against while you wire up the real source.
 */
function studentLookup(studentId) {
  const row = db.prepare('SELECT * FROM students WHERE student_id = ?').get(studentId);
  return row || null;
}

/**
 * The voter now only types their mobile number — the Student ID is looked
 * up automatically instead of typed in. Requires `mobile` to be unique in
 * the students table (it is, in the seeded data — see scripts/init-db.js).
 */
function studentLookupByMobile(mobile) {
  const row = db.prepare('SELECT * FROM students WHERE mobile = ?').get(mobile);
  return row || null;
}

function saveOtp(studentId, mobile, codeHash, expiresAt) {
  db.prepare(`
    INSERT INTO otps (student_id, mobile, code_hash, expires_at, attempts)
    VALUES (?, ?, ?, ?, 0)
    ON CONFLICT(student_id) DO UPDATE SET
      mobile = excluded.mobile, code_hash = excluded.code_hash,
      expires_at = excluded.expires_at, attempts = 0
  `).run(studentId, mobile, codeHash, expiresAt);
}

function getOtp(studentId) {
  return db.prepare('SELECT * FROM otps WHERE student_id = ?').get(studentId) || null;
}

function bumpOtpAttempts(studentId) {
  db.prepare('UPDATE otps SET attempts = attempts + 1 WHERE student_id = ?').run(studentId);
}

function clearOtp(studentId) {
  db.prepare('DELETE FROM otps WHERE student_id = ?').run(studentId);
}

function getVote(studentId) {
  return db.prepare('SELECT * FROM votes WHERE student_id = ?').get(studentId) || null;
}

function castVote(studentId, nomineeId, ip, userAgent) {
  db.prepare(`
    INSERT INTO votes (student_id, nominee_id, cast_at, ip, user_agent)
    VALUES (?, ?, datetime('now'), ?, ?)
  `).run(studentId, nomineeId, ip, userAgent);
}

function allVotes() {
  return db.prepare('SELECT nominee_id, COUNT(*) as n FROM votes GROUP BY nominee_id').all();
}

/**
 * Records one audit event. Mobile numbers are masked (last 4 digits only)
 * before storage, since the log is meant for "what happened and when," not
 * as a second copy of everyone's full phone number.
 */
function logEvent({ eventType, studentId, mobile, detail, ip, userAgent }) {
  const maskedMobile = mobile && mobile.length > 4
    ? mobile.slice(0, -4).replace(/./g, '*') + mobile.slice(-4)
    : mobile || null;
  db.prepare(`
    INSERT INTO audit_log (event_type, student_id, mobile, detail, ip, user_agent)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(eventType, studentId || null, maskedMobile, detail || null, ip || null, (userAgent || '').slice(0, 200));
}

/**
 * Read access for the admin endpoint. Supports simple filtering + paging
 * so the log stays usable once it has thousands of rows.
 */
function queryAuditLog({ eventType, studentId, limit, before } = {}) {
  const clauses = [];
  const params = {};
  if (eventType) { clauses.push('event_type = @eventType'); params.eventType = eventType; }
  if (studentId) { clauses.push('student_id = @studentId'); params.studentId = studentId; }
  if (before) { clauses.push('at < @before'); params.before = before; }
  const where = clauses.length ? 'WHERE ' + clauses.join(' AND ') : '';
  params.limit = Math.min(Number(limit) || 100, 500);
  return db.prepare(`
    SELECT * FROM audit_log ${where}
    ORDER BY at DESC, id DESC
    LIMIT @limit
  `).all(params);
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
function findTodaysTransaction(transferId, mobile) {
  const row = db.prepare('SELECT * FROM transactions WHERE transfer_id = ?').get(transferId);
  if (!row) return { ok: false, error: 'transaction_not_found' };
  if (row.claimed_by_student_id) return { ok: false, error: 'transaction_already_used' };

  const today = new Date().toISOString().slice(0, 10);
  const txnDate = String(row.transfer_date).slice(0, 10);
  if (txnDate !== today) return { ok: false, error: 'transaction_not_today' };

  if (row.mobile !== mobile) return { ok: false, error: 'transaction_mobile_mismatch' };

  return { ok: true, transaction: row };
}

function nextStudentId() {
  const row = db.prepare(`
    SELECT student_id FROM students
    WHERE student_id LIKE 'UCS-2026-%'
    ORDER BY CAST(SUBSTR(student_id, 10) AS INTEGER) DESC
    LIMIT 1
  `).get();
  const next = row ? parseInt(row.student_id.slice(9), 10) + 1 : 1;
  return 'UCS-2026-' + String(next).padStart(5, '0');
}

/**
 * Registers a brand-new student from a same-day transaction. Returns the
 * new student record. Marks the transaction as claimed so it can't be
 * reused to mint additional accounts.
 */
function registerStudentFromTransaction(transferId, mobile) {
  const check = findTodaysTransaction(transferId, mobile);
  if (!check.ok) return check;

  const existing = db.prepare('SELECT * FROM students WHERE mobile = ?').get(mobile);
  if (existing) return { ok: false, error: 'already_registered', student: existing };

  const studentId = nextStudentId();
  const insert = db.transaction(() => {
    db.prepare(`
      INSERT INTO students (student_id, full_name, mobile, purchased_this_semester, is_staff)
      VALUES (?, ?, ?, 1, 0)
    `).run(studentId, check.transaction.full_name, mobile);
    db.prepare('UPDATE transactions SET claimed_by_student_id = ? WHERE transfer_id = ?').run(studentId, transferId);
  });
  insert();

  return { ok: true, student: db.prepare('SELECT * FROM students WHERE student_id = ?').get(studentId) };
}

/**
 * Directly adds a student — no transaction proof required. This is for
 * YOU (the admin) adding someone by hand (e.g. scripts/add-student.js),
 * not something exposed to voters — there's no public endpoint for this,
 * unlike registerStudentFromTransaction() which voters trigger themselves.
 */
function adminAddStudent(fullName, mobile, purchasedThisSemester, isStaff) {
  const existing = db.prepare('SELECT * FROM students WHERE mobile = ?').get(mobile);
  if (existing) return { ok: false, error: 'already_registered', student: existing };

  const studentId = nextStudentId();
  db.prepare(`
    INSERT INTO students (student_id, full_name, mobile, purchased_this_semester, is_staff)
    VALUES (?, ?, ?, ?, ?)
  `).run(studentId, fullName, mobile, purchasedThisSemester ? 1 : 0, isStaff ? 1 : 0);

  return { ok: true, student: db.prepare('SELECT * FROM students WHERE student_id = ?').get(studentId) };
}

module.exports = {
  db, studentLookup, studentLookupByMobile, saveOtp, getOtp, bumpOtpAttempts, clearOtp,
  getVote, castVote, allVotes, findTodaysTransaction, registerStudentFromTransaction,
  adminAddStudent, logEvent, queryAuditLog,
};
