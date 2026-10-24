const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

async function main() {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const statuses = [
      'รอพิจารณา',
      'อนุมัติแล้ว',
      'ไม่อนุมัติ',
      'กำลังซ่อม',
      'รอตรวจรับ',
      'เสร็จสิ้น'
    ];

    const priorities = ['ต่ำ', 'ปกติ', 'สูง', 'เร่งด่วน'];

    await client.query(
      'ALTER TABLE repair_requests DROP CONSTRAINT IF EXISTS repair_requests_status_check'
    );

    await client.query(
      'UPDATE repair_requests SET status = $1 WHERE NOT (status = ANY($2::text[]))',
      [statuses[0], statuses]
    );

    await client.query(
      'ALTER TABLE repair_requests ADD CONSTRAINT repair_requests_status_check CHECK (status IN ($$รอพิจารณา$$, $$อนุมัติแล้ว$$, $$ไม่อนุมัติ$$, $$กำลังซ่อม$$, $$รอตรวจรับ$$, $$เสร็จสิ้น$$))'
    );

    await client.query('COMMIT');

    const result = await client.query(
      'SELECT status, priority FROM repair_requests ORDER BY id DESC'
    );

    console.table(result.rows);
    console.log('แก้ไขสถานะเรียบร้อย');
  } catch (error) {
    await client.query('ROLLBACK');
    console.error(error.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

main();
