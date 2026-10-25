require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  connectionTimeoutMillis: 10000
});

async function main() {
  try {
    const db = await pool.query(
      'SELECT current_database() AS database, current_user AS db_user'
    );
    console.log('\n=== DATABASE CONNECTION ===');
    console.table(db.rows);

    console.log('\n=== ROLES ===');
    const roles = await pool.query(
      'SELECT id, name FROM roles ORDER BY id'
    );
    console.table(roles.rows);

    console.log('\n=== PERMISSIONS ===');
    const permissions = await pool.query(
      'SELECT id, code FROM permissions ORDER BY code'
    );
    console.table(permissions.rows);

    console.log('\n=== ROLE PERMISSIONS ===');
    const acl = await pool.query(`
      SELECT r.name AS role_name, p.code AS permission
      FROM role_permissions rp
      JOIN roles r ON r.id = rp.role_id
      JOIN permissions p ON p.id = rp.permission_id
      ORDER BY r.name, p.code
    `);
    console.table(acl.rows);

    console.log('\n=== USER ACCOUNTS (NO PASSWORDS) ===');
    const users = await pool.query(`
      SELECT u.username, u.is_active, r.name AS role_name
      FROM users u
      JOIN roles r ON r.id = u.role_id
      ORDER BY u.username
    `);
    console.table(users.rows);
  } catch (err) {
    console.error('ตรวจสอบไม่สำเร็จ:', err.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main();
