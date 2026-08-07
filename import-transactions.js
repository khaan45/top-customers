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
const { db } = require('../db');

const csvPath = process.argv[2];
if (!csvPath) {
  console.error('Usage: node scripts/import-transactions.js path/to/transactions.csv');
  process.exit(1);
}

const lines = fs.readFileSync(path.resolve(csvPath), 'utf8').trim().split('\n');
const header = lines[0].split(',');
const rows = lines.slice(1).map((line) => {
  // simple CSV split — fine here since none of these fields contain commas
  const vals = line.split(',');
  const obj = {};
  header.forEach((h, i) => { obj[h.trim()] = vals[i]; });
  return obj;
});

const stmt = db.prepare(`
  INSERT INTO transactions (transfer_id, transfer_date, full_name, mobile, credit)
  VALUES (@transfer_id, @transfer_date, @full_name, @mobile, @credit)
  ON CONFLICT(transfer_id) DO UPDATE SET
    transfer_date = excluded.transfer_date, full_name = excluded.full_name,
    mobile = excluded.mobile, credit = excluded.credit
`);

const insertMany = db.transaction((rows) => {
  for (const r of rows) stmt.run(r);
});
insertMany(rows);

console.log(`Imported ${rows.length} transactions from ${csvPath}`);
