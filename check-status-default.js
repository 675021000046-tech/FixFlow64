require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

(async () => {
  try {
    const r = await pool.query(`
      SELECT
        column_name,
        column_default,
        is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'repair_requests'
        AND column_name = 'status'
    `);
    console.log('=== STATUS COLUMN ===');
    console.table(r.rows);

    const c = await pool.query(`
      SELECT conname, pg_get_constraintdef(oid) AS definition
      FROM pg_constraint
      WHERE conrelid = 'public.repair_requests'::regclass
        AND conname = 'repair_requests_status_check'
    `);
    console.log('=== STATUS CONSTRAINT ===');
    console.table(c.rows);
  } catch (e) {
    console.error(e.message);
  } finally {
    await pool.end();
  }
})();
