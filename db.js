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

module.exports = {
  db, studentLookup, studentLookupByMobile, saveOtp, getOtp, bumpOtpAttempts, clearOtp,
  getVote, castVote, allVotes,
};
