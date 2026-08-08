// Seeds a couple of test students so you can run the real flow end-to-end
// before your actual student/customer database is wired in (see db.js).
require('dotenv').config();
const { pool, ready } = require('../db');

const rows = [
  { student_id: 'UCS-2024-00214', full_name: 'Ahmed Warsame', mobile: '252634567890', purchased: true, staff: false },
  { student_id: 'UCS-2024-00187', full_name: 'Hodan Farah', mobile: '252638112233', purchased: true, staff: false },
  { student_id: 'STAFF-0001', full_name: 'Cafeteria Manager', mobile: '252630000000', purchased: false, staff: true },
];

async function main() {
  await ready; // wait for tables to exist
  for (const r of rows) {
    await pool.query(
      `INSERT INTO students (student_id, full_name, mobile, purchased_this_semester, is_staff)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (student_id) DO UPDATE SET
         full_name = EXCLUDED.full_name, mobile = EXCLUDED.mobile,
         purchased_this_semester = EXCLUDED.purchased_this_semester, is_staff = EXCLUDED.is_staff`,
      [r.student_id, r.full_name, r.mobile, r.purchased, r.staff]
    );
  }
  console.log(`Seeded ${rows.length} test students into your Neon database.`);
  console.log('Try: UCS-2024-00214 / 252634567890  (a normal eligible student)');
  await pool.end();
}

main().catch((err) => {
  console.error('Seeding failed:', err);
  process.exit(1);
});
