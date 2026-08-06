require('dotenv').config();
const admin = require('firebase-admin');

/**
 * Firebase handles sending the SMS and checking the code entirely on the
 * frontend (via the Firebase Web SDK's signInWithPhoneNumber). All this
 * server needs to do is verify the ID token Firebase hands back afterward —
 * that proves the phone number really received and confirmed the code.
 *
 * You need a service account key for this (Firebase Console > Project
 * Settings > Service Accounts > Generate new private key). Never commit
 * that JSON file or expose it to the frontend — it's backend-only.
 */
let initialized = false;

function init() {
  if (initialized) return;
  const keyPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
  if (!keyPath) {
    throw new Error(
      'FIREBASE_SERVICE_ACCOUNT_PATH is not set in .env — download a service ' +
      'account key from Firebase Console > Project Settings > Service Accounts ' +
      'and point this at the JSON file.'
    );
  }
  admin.initializeApp({
    credential: admin.credential.cert(require(require('path').resolve(keyPath))),
  });
  initialized = true;
}

/**
 * Verifies a Firebase ID token from a completed Phone Auth sign-in.
 * Returns the E.164 phone number (e.g. "+252634567890") on success,
 * throws on an invalid/expired/tampered token.
 */
async function verifyPhoneAuthToken(idToken) {
  init();
  const decoded = await admin.auth().verifyIdToken(idToken);
  if (!decoded.phone_number) {
    throw new Error('Token has no verified phone number attached');
  }
  return decoded.phone_number; // E.164 format, e.g. +252634567890
}

module.exports = { verifyPhoneAuthToken };
