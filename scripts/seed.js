require('dotenv').config();
const { Pool } = require('pg');
const bcrypt = require('bcrypt');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const permissions = [
  ['dashboard.read', 'ดูหน้าภาพรวม', 'เปิด Dashboard'],
  ['request.read', 'ดูรายการแจ้งซ่อม', 'ดูรายการที่ได้รับอนุญาต'],
  ['request.create', 'สร้างคำขอแจ้งซ่อม', 'สร้างคำขอใหม่'],
  ['request.update.own', 'แก้ไขคำขอของตนก่อนพิจารณา', 'แก้ไขคำขอของตนเอง'],
  ['request.approve', 'พิจารณาคำขอ', 'อนุมัติหรือปฏิเสธคำขอ'],
  ['request.assign', 'มอบหมายช่าง', 'มอบหมายงานให้ช่าง'],
  ['request.work', 'อัปเดตงานซ่อม', 'อัปเดตสถานะงาน'],
  ['request.delete', 'ลบคำขอแจ้งซ่อม', 'สิทธิ์ลบคำขอ'],
  ['file.upload', 'อัปโหลดไฟล์แนบ', 'แนบไฟล์ในรายการที่เข้าถึงได้'],
  ['file.read', 'ดูหรือดาวน์โหลดไฟล์แนบ', 'ดาวน์โหลดไฟล์แนบ'],
  ['file.delete', 'ลบไฟล์แนบ', 'ลบไฟล์แนบ'],
  ['user.manage', 'จัดการผู้ใช้', 'สร้างผู้ใช้และกำหนดบทบาท'],
  ['role.manage', 'จัดการบทบาท', 'เพิ่มหรือลบบทบาท'],
  ['permission.manage', 'จัดการ Permission และ ACL', 'จัดการสิทธิ์'],
  ['log.read', 'ดูและค้นหา Audit Log', 'ดูประวัติการใช้งาน']
];

const roleDefs = [
  { key: 'admin', name: 'admin', description: 'ผู้ดูแลระบบ', aliases: ['admin', 'administrator', 'ผู้ดูแลระบบ'] },
  { key: 'manager', name: 'manager', description: 'ผู้จัดการ', aliases: ['manager', 'ผู้จัดการ'] },
  { key: 'technician', name: 'technician', description: 'ช่างซ่อม', aliases: ['technician', 'ช่างซ่อม', 'ช่าง'] },
  { key: 'requester', name: 'requester', description: 'ผู้แจ้งซ่อม', aliases: ['requester', 'ผู้แจ้งซ่อม', 'ผู้แจ้ง'] }
];

const rolePermissionCodes = {
  admin: null, // ทุก permission
  manager: ['dashboard.read', 'request.read', 'request.approve', 'request.assign', 'file.read', 'file.upload'],
  technician: ['dashboard.read', 'request.read', 'request.work', 'file.read', 'file.upload'],
  requester: ['dashboard.read', 'request.read', 'request.create', 'request.update.own', 'file.read', 'file.upload']
};

function sqlAliases(aliases) {
  return aliases.map(x => x.toLowerCase());
}

(async () => {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');

    // ใช้บทบาทเดิมถ้ามีอยู่แล้ว ไม่สร้าง role ซ้ำเพียงเพราะชื่อภาษาไม่เหมือนกัน
    for (const role of roleDefs) {
      const aliases = sqlAliases(role.aliases);
      await c.query(
        `INSERT INTO roles (name, description, is_system)
         SELECT $1, $2, TRUE
         WHERE NOT EXISTS (
           SELECT 1 FROM roles WHERE LOWER(TRIM(name)) = ANY($3::text[])
         )
         ON CONFLICT (name) DO NOTHING`,
        [role.name, role.description, aliases]
      );
    }

    for (const [code, name, description] of permissions) {
      await c.query(
        `INSERT INTO permissions (code, name, description)
         VALUES ($1, $2, $3) ON CONFLICT (code) DO NOTHING`,
        [code, name, description]
      );
    }

    const roles = (await c.query('SELECT id, name FROM roles')).rows;
    const perms = (await c.query('SELECT id, code FROM permissions')).rows;
    const normalize = name => {
      const n = String(name || '').trim().toLowerCase();
      if (['admin', 'administrator', 'ผู้ดูแลระบบ'].includes(n)) return 'admin';
      if (['manager', 'ผู้จัดการ'].includes(n)) return 'manager';
      if (['technician', 'ช่างซ่อม', 'ช่าง'].includes(n)) return 'technician';
      if (['requester', 'ผู้แจ้งซ่อม', 'ผู้แจ้ง'].includes(n)) return 'requester';
      return null;
    };

    for (const role of roles) {
      const key = normalize(role.name);
      if (!key) continue;
      const allowed = rolePermissionCodes[key];
      const selected = allowed === null ? perms : perms.filter(p => allowed.includes(p.code));
      for (const p of selected) {
        await c.query(
          `INSERT INTO role_permissions (role_id, permission_id)
           VALUES ($1, $2) ON CONFLICT DO NOTHING`,
          [role.id, p.id]
        );
      }
    }

    // สร้างบัญชีตัวอย่างเฉพาะเมื่อยังไม่มี ห้ามรีเซ็ตรหัสผ่านของบัญชีเดิม
    const demo = [
      ['admin', 'ผู้ดูแลระบบ', 'Admin@12345', 'admin'],
      ['manager', 'ผู้จัดการระบบ', 'Manager@12345', 'manager'],
      ['tech', 'ช่างซ่อมตัวอย่าง', 'Tech@12345', 'technician'],
      ['requester', 'ผู้แจ้งซ่อมตัวอย่าง', 'User@12345', 'requester']
    ];
    for (const [username, fullName, password, roleKey] of demo) {
      const exists = await c.query('SELECT 1 FROM users WHERE username=$1', [username]);
      if (exists.rowCount) continue;
      const role = roles.find(r => normalize(r.name) === roleKey);
      if (!role) throw new Error(`ไม่พบบทบาทสำหรับ ${roleKey}`);
      const hash = await bcrypt.hash(password, 12);
      await c.query(
        `INSERT INTO users (username, full_name, password_hash, role_id, is_active)
         VALUES ($1, $2, $3, $4, TRUE)`,
        [username, fullName, hash, role.id]
      );
      console.log(`สร้างบัญชีตัวอย่างใหม่: ${username}`);
    }

    await c.query('COMMIT');
    console.log('Seed/ACL สำเร็จ: ใช้บทบาทเดิมและเพิ่มเฉพาะข้อมูลที่ขาด');
    console.log('บัญชีตัวอย่างที่สร้างใหม่เท่านั้น: admin / Admin@12345, manager / Manager@12345, tech / Tech@12345, requester / User@12345');
    console.log('บัญชีที่มีอยู่แล้วและรหัสผ่านเดิมจะไม่ถูกเปลี่ยน');
  } catch (e) {
    await c.query('ROLLBACK');
    console.error('Seed ล้มเหลว:', e.message);
    process.exitCode = 1;
  } finally {
    c.release();
    await pool.end();
  }
})();
