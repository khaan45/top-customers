// The imported historical data (transactions_export.csv) is all Jan-May
// 2026 — none of it will ever match "today" in findTodaysTransaction().
// This inserts one fake transaction dated right now, purely so you can
// test the "register with today's transaction ID" flow before you have a
// live payment feed wired in.
require('dotenv').config();
const { ready, pool } = require('../db');

const testTransferId = 99999001;

async function main() {
  await ready;
  const now = new Date();

  await pool.query(
    `INSERT INTO transactions (transfer_id, transfer_date, full_name, mobile, credit)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (transfer_id) DO UPDATE SET
       transfer_date = EXCLUDED.transfer_date, full_name = EXCLUDED.full_name,
       mobile = EXCLUDED.mobile, credit = EXCLUDED.credit, claimed_by_student_id = NULL`,
    [testTransferId, now, 'Test New Customer', '252699000001', 5000]
  );

  console.log(`Seeded a test transaction dated ${now.toISOString()}`);
  console.log(`Try registering with Transfer ID ${testTransferId} and mobile 252699000001`);
  await pool.end();
}

main().catch((err) => {
  console.error('Failed:', err);
  process.exit(1);
});
