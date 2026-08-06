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
  db, studentLookup,
  getVote, castVote, allVotes,
};
