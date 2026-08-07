// The imported historical data (transactions_export.csv) is all Jan-May
// 2026 — none of it will ever match "today" in findTodaysTransaction().
// This inserts one fake transaction dated right now, purely so you can
// test the "register with today's transaction ID" flow before you have a
// live payment feed wired in.
require('dotenv').config();
const { db } = require('../db');

const testTransferId = 99999001;
const now = new Date().toISOString().slice(0, 19).replace('T', ' ');

db.prepare(`
  INSERT INTO transactions (transfer_id, transfer_date, full_name, mobile, credit)
  VALUES (?, ?, ?, ?, ?)
  ON CONFLICT(transfer_id) DO UPDATE SET
    transfer_date = excluded.transfer_date, full_name = excluded.full_name,
    mobile = excluded.mobile, credit = excluded.credit, claimed_by_student_id = NULL
`).run(testTransferId, now, 'Test New Customer', '252699000001', 5000);

console.log(`Seeded a test transaction dated ${now}`);
console.log(`Try registering with Transfer ID ${testTransferId} and mobile 252699000001`);
