require('dotenv').config();
const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const { verifyPhoneAuthToken } = require('./firebase-admin-auth');
const {
  studentLookup,
  getVote, castVote, allVotes,
} = require('./db');

const app = express();
app.use(express.json());

const allowedOrigins = (process.env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
app.use(cors({ origin: allowedOrigins.length ? allowedOrigins : true }));

// Basic abuse protection on the endpoints that touch phones/DB lookups
app.use('/api/students', rateLimit({ windowMs: 60_000, max: 10, standardHeaders: true, legacyHeaders: false }));
app.use('/api/session', rateLimit({ windowMs: 60_000, max: 10 }));
app.use('/api/vote', rateLimit({ windowMs: 60_000, max: 10 }));

const VOTING_START = new Date(process.env.VOTING_START || '2026-08-06T00:00:00Z');
const VOTING_END = new Date(process.env.VOTING_END || '2026-08-26T23:59:00Z');
const SESSION_TTL = Number(process.env.SESSION_TTL_SECONDS || 600) * 1000;
const SESSION_SECRET = process.env.SESSION_SECRET || '';

// Same nominees as the frontend — spend never leaves the server.
const NOMINEES = [
  { id: 'n1', firstName: 'Najma', spend: 705500 },
  { id: 'n2', firstName: 'Faadumo', spend: 700500 },
  { id: 'n3', firstName: 'Naciima', spend: 637500 },
  { id: 'n4', firstName: 'Xafsa', spend: 561500 },
  { id: 'n5', firstName: 'Safa', spend: 549000 },
];
const VOTE_WEIGHT = 0.6;
const SPEND_WEIGHT = 0.4;
const PRIZES = ['$40', '$25', '$15', '$10', '$10'];
const MAX_SPEND = Math.max(...NOMINEES.map((n) => n.spend));

function votingStatus() {
  const now = new Date();
  if (now < VOTING_START) return 'before';
  if (now > VOTING_END) return 'closed';
  return 'open';
}

// Firebase phone numbers are E.164 ("+252634567890"); your student DB might
// store them without the "+". Compare on digits only so either format works.
function normalizePhone(p) {
  return String(p || '').replace(/\D/g, '');
}

function signSession(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(body).digest('base64url');
  return body + '.' + sig;
}
function verifySession(token) {
  if (!token || typeof token !== 'string' || token.indexOf('.') === -1) return null;
  const [body, sig] = token.split('.');
  const expected = crypto.createHmac('sha256', SESSION_SECRET).update(body).digest('base64url');
  if (sig !== expected) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString());
    if (Date.now() > payload.exp) return null;
    return payload;
  } catch (e) {
    return null;
  }
}

if (!SESSION_SECRET || SESSION_SECRET === 'change-this-to-a-long-random-string') {
  console.warn('WARNING: SESSION_SECRET is unset or default — set a real random value in .env before going live.');
}

// ---- Config: frontend pulls voting window + nominee list from here, not hardcoded ----
app.get('/api/config', (req, res) => {
  res.json({
    status: votingStatus(),
    votingStart: VOTING_START.toISOString(),
    votingEnd: VOTING_END.toISOString(),
    nominees: NOMINEES.map((n) => ({ id: n.id, firstName: n.firstName })),
    prizes: PRIZES,
  });
});

// ---- Step 1: confirm the Student ID is real and its mobile matches, BEFORE
// the frontend asks Firebase to send an SMS. This is what auto-fills the
// Full Name field, and stops Firebase's SMS quota being spent on numbers
// that aren't actually registered students. ----
app.post('/api/students/check', (req, res) => {
  const { studentId, mobile } = req.body || {};
  if (!studentId || !mobile) return res.status(400).json({ error: 'missing_fields' });

  const student = studentLookup(String(studentId).toUpperCase());
  if (!student) return res.status(404).json({ error: 'student_not_found' });
  if (normalizePhone(student.mobile) !== normalizePhone(mobile)) {
    return res.status(400).json({ error: 'mobile_mismatch' });
  }

  res.json({
    ok: true,
    fullName: student.full_name,
    purchasedThisSemester: !!student.purchased_this_semester,
    isStaff: !!student.is_staff,
  });
});

// ---- Step 2: frontend has already completed Firebase Phone Auth (real SMS,
// real OTP check, all on Google's infrastructure) and has a Firebase ID
// token proving it. We verify that token here, confirm the phone number on
// it actually matches this student's registered mobile, and only then issue
// our own short-lived session token for the vote-casting step. ----
app.post('/api/session/create', async (req, res) => {
  const { studentId, idToken } = req.body || {};
  if (!studentId || !idToken) return res.status(400).json({ error: 'missing_fields' });

  const sid = String(studentId).toUpperCase();
  const student = studentLookup(sid);
  if (!student) return res.status(404).json({ error: 'student_not_found' });

  let phoneFromToken;
  try {
    phoneFromToken = await verifyPhoneAuthToken(idToken);
  } catch (err) {
    return res.status(401).json({ error: 'invalid_firebase_token', detail: String(err.message || err) });
  }

  if (normalizePhone(phoneFromToken) !== normalizePhone(student.mobile)) {
    return res.status(400).json({ error: 'phone_mismatch' });
  }

  const token = signSession({ sid, mobile: student.mobile, exp: Date.now() + SESSION_TTL });
  res.json({ ok: true, sessionToken: token, expiresInSeconds: SESSION_TTL / 1000 });
});

// ---- Step 3: cast the vote (server enforces every rule, not the browser) ----
app.post('/api/vote', (req, res) => {
  const { sessionToken, nomineeId, ageConfirmed, notStaffConfirmed, hasAccountConfirmed } = req.body || {};

  const status = votingStatus();
  if (status !== 'open') return res.status(403).json({ error: 'voting_' + status });

  const session = verifySession(sessionToken);
  if (!session) return res.status(401).json({ error: 'invalid_or_expired_session' });

  if (!ageConfirmed || !notStaffConfirmed || !hasAccountConfirmed) {
    return res.status(400).json({ error: 'eligibility_not_confirmed' });
  }
  if (!NOMINEES.some((n) => n.id === nomineeId)) {
    return res.status(400).json({ error: 'invalid_nominee' });
  }

  const existing = getVote(session.sid);
  if (existing) return res.status(409).json({ error: 'already_voted' });

  const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
  const ua = (req.headers['user-agent'] || '').slice(0, 200);
  castVote(session.sid, nomineeId, ip, ua);

  res.json({ ok: true });
});

// ---- Results: live participation while open, full scores/prizes once closed ----
app.get('/api/results', (req, res) => {
  const status = votingStatus();
  const counts = {};
  allVotes().forEach((r) => { counts[r.nominee_id] = r.n; });
  const totalVotes = Object.values(counts).reduce((a, b) => a + b, 0);

  if (status !== 'closed') {
    return res.json({
      status,
      totalVotes,
      participating: NOMINEES.filter((n) => counts[n.id] > 0).map((n) => n.id),
    });
  }

  const maxVotes = Math.max(0, ...NOMINEES.map((n) => counts[n.id] || 0));
  const scored = NOMINEES.map((n) => {
    const votes = counts[n.id] || 0;
    const normVotes = maxVotes > 0 ? votes / maxVotes : 0;
    const normSpend = n.spend / MAX_SPEND;
    const score = normVotes * VOTE_WEIGHT * 100 + normSpend * SPEND_WEIGHT * 100;
    return { id: n.id, firstName: n.firstName, votes, score };
  }).sort((a, b) => b.score - a.score);

  res.json({
    status,
    totalVotes,
    results: scored.map((r, i) => ({ ...r, rank: i + 1, prize: PRIZES[i] })),
  });
});

const port = Number(process.env.PORT || 4000);
app.listen(port, () => console.log(`Vote API listening on :${port}`));
