// Bulk-loads transaction records into the `transactions` table from a CSV
// with columns: transfer_id, transfer_date, full_name, mobile, credit
//
// This is here for two purposes:
//   1. Loading historical data (like transactions_export.csv, included) so
//      you have something real to test "register with today's transaction"
//      against once you also run scripts/seed-todays-transaction.js.
//   2. A template for however you end up feeding in REAL daily transactions
//      in production — e.g. a nightly job pulling from your Zaad/eDahab
//      merchant feed and calling this same insert logic.
//
// Usage: node scripts/import-transactions.js path/to/file.csv
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { ready, pool } = require('../db');

const csvPath = process.argv[2];
if (!csvPath) {
  console.error('Usage: node scripts/import-transactions.js path/to/transactions.csv');
  process.exit(1);
}

async function main() {
  await ready;

  const lines = fs.readFileSync(path.resolve(csvPath), 'utf8').trim().split('\n');
  const header = lines[0].split(',').map((h) => h.trim());
  const rows = lines.slice(1).map((line) => {
    // simple CSV split — fine here since none of these fields contain commas
    const vals = line.split(',');
    const obj = {};
    header.forEach((h, i) => { obj[h] = vals[i]; });
    return obj;
  });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const r of rows) {
      await client.query(
        `INSERT INTO transactions (transfer_id, transfer_date, full_name, mobile, credit)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (transfer_id) DO UPDATE SET
           transfer_date = EXCLUDED.transfer_date, full_name = EXCLUDED.full_name,
           mobile = EXCLUDED.mobile, credit = EXCLUDED.credit`,
        [Number(r.transfer_id), r.transfer_date, r.full_name, r.mobile, r.credit ? Number(r.credit) : null]
      );
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  console.log(`Imported ${rows.length} transactions from ${csvPath}`);
  await pool.end();
}

main().catch((err) => {
  console.error('Import failed:', err);
  process.exit(1);
});
