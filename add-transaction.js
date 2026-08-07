// Adds one transaction record manually — for cases where you need to add
// a specific receipt (e.g. testing, or a one-off correction) rather than
// bulk-importing a whole CSV (see import-transactions.js for that).
//
// Usage: node scripts/add-transaction.js <transferId> <mobile> "<fullName>" [credit]
// Defaults transfer_date to right now, so it's immediately usable with
// "register with today's transaction" (findTodaysTransaction in db.js).
require('dotenv').config();
const { db } = require('../db');

const [transferId, mobile, fullName, credit] = process.argv.slice(2);

if (!transferId || !mobile || !fullName) {
  console.error('Usage: node scripts/add-transaction.js <transferId> <mobile> "<fullName>" [credit]');
  process.exit(1);
}

const now = new Date().toISOString().slice(0, 19).replace('T', ' ');

db.prepare(`
  INSERT INTO transactions (transfer_id, transfer_date, full_name, mobile, credit)
  VALUES (?, ?, ?, ?, ?)
  ON CONFLICT(transfer_id) DO UPDATE SET
    transfer_date = excluded.transfer_date, full_name = excluded.full_name,
    mobile = excluded.mobile, credit = excluded.credit, claimed_by_student_id = NULL
`).run(Number(transferId), now, fullName, mobile, credit ? Number(credit) : null);

console.log(`Added transaction ${transferId} for ${mobile} (${fullName}), dated ${now}`);
console.log(`Ready to use in the app's "register with today's purchase" flow.`);
