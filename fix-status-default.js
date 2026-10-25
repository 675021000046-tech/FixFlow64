require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

(async () => {
  try {
    await pool.query(`
      ALTER TABLE public.repair_requests
      ALTER COLUMN status SET DEFAULT 'รอพิจารณา'
    `);
    console.log('แก้ DEFAULT status เป็น รอพิจารณา เรียบร้อย');
  } catch (e) {
    console.error('แก้ไขไม่สำเร็จ:', e.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
