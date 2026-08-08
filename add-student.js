// Directly adds a customer to the students table — no transaction ID
// needed, unlike the voter-facing "register with today's purchase" flow
// (which requires proof of a same-day purchase). Use this for admin
// additions: someone you're manually vouching for, correcting a record
// that didn't make it into the original import, etc.
//
// Usage: node scripts/add-student.js <mobile> "<fullName>" [purchased=1] [isStaff=0]
require('dotenv').config();
const { ready, adminAddStudent, pool } = require('../db');

const [mobile, fullName, purchasedArg, staffArg] = process.argv.slice(2);

if (!mobile || !fullName) {
  console.error('Usage: node scripts/add-student.js <mobile> "<fullName>" [purchased=1] [isStaff=0]');
  process.exit(1);
}

const purchased = purchasedArg === undefined ? true : purchasedArg === '1';
const isStaff = staffArg === '1';

async function main() {
  await ready;
  const result = await adminAddStudent(fullName, mobile, purchased, isStaff);

  if (!result.ok) {
    if (result.error === 'already_registered') {
      console.error(`That mobile number is already registered as ${result.student.student_id} (${result.student.full_name}).`);
    } else {
      console.error('Could not add student:', result.error);
    }
    await pool.end();
    process.exit(1);
  }

  console.log(`Added ${result.student.full_name} as ${result.student.student_id} (${mobile}).`);
  await pool.end();
}

main().catch((err) => {
  console.error('Failed:', err);
  process.exit(1);
});
