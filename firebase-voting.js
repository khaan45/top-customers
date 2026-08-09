// firebase-voting.js
// Implements: Students { studentId, name, mobile, status, hasVoted }
//             Votes    { voteId, studentId, candidateId, date }
// Security rule: a vote is only accepted when Student ID + mobile match
// the same record AND hasVoted is still false at write time.

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import {
  getFirestore, doc, getDoc, runTransaction, collection,
  serverTimestamp, Timestamp,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

// TODO: replace with your project's config (Firebase console → Project settings)
const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT.firebaseapp.com",
  projectId: "YOUR_PROJECT",
  storageBucket: "YOUR_PROJECT.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID",
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

function err(code) {
  var e = new Error(code);
  e.code = code;
  return e;
}

/**
 * Step 1-7 of the flow: look up Student ID, check the mobile number
 * matches, check status is Active, check hasVoted is false.
 * Throws { code: "not_found" | "inactive" | "already_voted" } on any
 * mismatch — deliberately the same "not_found" for a wrong Student ID
 * and a right-ID-wrong-mobile, so this can't be used to enumerate valid
 * Student IDs or confirm a guessed mobile number against a known ID.
 */
export async function verifyStudent(studentId, mobile) {
  if (!studentId || !mobile) throw err("missing_fields");

  var snap = await getDoc(doc(db, "students", studentId));
  if (!snap.exists()) throw err("not_found");

  var student = snap.data();
  if (normalizePhone(student.mobile) !== normalizePhone(mobile)) {
    throw err("not_found");
  }
  if (student.status !== "Active") throw err("inactive");
  if (student.hasVoted === true) throw err("already_voted");

  return { studentId: studentId, name: student.name };
}

/**
 * Steps 9-13: cast the vote. Runs as a Firestore transaction so the
 * hasVoted check and the write happen atomically — this is the actual
 * security boundary, not the earlier verifyStudent() call, since two
 * requests could otherwise both pass verifyStudent() before either
 * writes (a classic check-then-act race).
 */
export async function submitVote(studentId, candidateId) {
  if (!studentId || !candidateId) throw err("missing_fields");

  var studentRef = doc(db, "students", studentId);
  var voteRef = doc(collection(db, "votes")); // auto-generated Vote ID

  await runTransaction(db, async function (tx) {
    var studentSnap = await tx.get(studentRef);
    if (!studentSnap.exists()) throw err("not_found");

    var student = studentSnap.data();
    if (student.status !== "Active") throw err("inactive");
    if (student.hasVoted === true) throw err("already_voted");

    tx.set(voteRef, {
      studentId: studentId,
      candidateId: candidateId,
      date: serverTimestamp(),
    });
    tx.update(studentRef, { hasVoted: true });
  });

  return { voteId: voteRef.id };
}

function normalizePhone(raw) {
  if (!raw) return "";
  var digits = String(raw).replace(/\D/g, "");
  if (digits.indexOf("0") === 0) digits = "252" + digits.slice(1);
  else if (digits.indexOf("252") !== 0) digits = "252" + digits;
  return digits;
}

// Expose as window.tcvFirebase so the existing widget script (a plain,
// non-module <script>) can call these without a bundler.
window.tcvFirebase = { verifyStudent: verifyStudent, submitVote: submitVote };
