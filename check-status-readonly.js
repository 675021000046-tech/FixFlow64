require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

(async () => {
  try {
    const constraints = await pool.query(`
      SELECT conname, pg_get_constraintdef(oid) AS definition
      FROM pg_constraint
      WHERE conrelid = 'repair_requests'::regclass
        AND contype = 'c'
    `);

    console.log('\n=== CONSTRAINTS ===');
    console.table(constraints.rows);

    const statuses = await pool.query(`
      SELECT status, COUNT(*)::int AS total
      FROM repair_requests
      GROUP BY status
      ORDER BY status
    `);

    console.log('\n=== CURRENT STATUSES ===');
    console.table(statuses.rows);
  } catch (error) {
    console.error('ตรวจสอบไม่สำเร็จ:', error.message);
  } finally {
    await pool.end();
  }
})();
