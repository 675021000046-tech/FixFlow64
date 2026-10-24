require('dotenv').config();
const {Pool}=require('pg'); const bcrypt=require('bcrypt');
const pool=new Pool({connectionString:process.env.DATABASE_URL});
const perms=[
['dashboard.read','ดูหน้าภาพรวม','dashboard'],['request.read','ดูรายการแจ้งซ่อม','requests'],
['request.create','สร้างคำขอแจ้งซ่อม','requests'],['request.update.own','แก้ไขคำขอของตนก่อนพิจารณา','requests'],
['request.approve','อนุมัติหรือปฏิเสธคำขอ','requests'],['request.assign','มอบหมายช่าง','requests'],
['request.work','อัปเดตสถานะงานซ่อม','requests'],['request.delete','ลบคำขอแจ้งซ่อม','requests'],
['file.upload','อัปโหลดไฟล์แนบ','files'],['file.read','ดูหรือดาวน์โหลดไฟล์แนบ','files'],
['file.delete','ลบไฟล์แนบ','files'],['user.manage','จัดการผู้ใช้และกำหนดบทบาท','users'],
['role.manage','จัดการบทบาท','acl'],['permission.manage','จัดการ Permission และ ACL','acl'],
['log.read','ดูและค้นหา Audit Log','logs']
];
(async()=>{const c=await pool.connect();try{
 await c.query('BEGIN');
 await c.query(`INSERT INTO roles(name,description,is_system) VALUES
 ('Admin','ผู้ดูแลระบบ จัดการระบบได้ทั้งหมด',true),
 ('ผู้จัดการ','พิจารณาคำขอและมอบหมายงาน',true),
 ('ช่างซ่อม','รับงานและอัปเดตสถานะการซ่อม',true),
 ('ผู้แจ้งซ่อม','สร้างคำขอและติดตามงานของตน',true) ON CONFLICT(name) DO NOTHING`);
 for(const [code,name] of perms) await c.query('INSERT INTO permissions(code,name,description) VALUES($1,$2,$3) ON CONFLICT(code) DO NOTHING',[code,name,`สิทธิ์สำหรับ ${name}`]);
 const roles=(await c.query('SELECT id,name FROM roles')).rows, ps=(await c.query('SELECT id,code FROM permissions')).rows;
 const all=ps.map(p=>p.id);
 const map={
 'Admin':all,
 'ผู้จัดการ':ps.filter(p=>['dashboard.read','request.read','request.approve','request.assign','file.read','file.upload'].includes(p.code)).map(p=>p.id),
 'ช่างซ่อม':ps.filter(p=>['dashboard.read','request.read','request.work','file.read','file.upload'].includes(p.code)).map(p=>p.id),
 'ผู้แจ้งซ่อม':ps.filter(p=>['dashboard.read','request.read','request.create','request.update.own','file.upload','file.read'].includes(p.code)).map(p=>p.id)
 };
 for(const r of roles) for(const pid of (map[r.name]||[])) await c.query('INSERT INTO role_permissions(role_id,permission_id) VALUES($1,$2) ON CONFLICT DO NOTHING',[r.id,pid]);
 const hash=await bcrypt.hash('Admin@12345',12);
 await c.query(`INSERT INTO users(username,full_name,password_hash,role_id,is_active)
 VALUES('admin','ผู้ดูแลระบบ',$1,(SELECT id FROM roles WHERE name='Admin'),true)
 ON CONFLICT(username) DO UPDATE SET full_name=EXCLUDED.full_name, password_hash=EXCLUDED.password_hash, role_id=EXCLUDED.role_id,is_active=true`,[hash]);
 const demo=[['manager','ผู้จัดการระบบ','Manager@12345','ผู้จัดการ'],['tech','ช่างซ่อมตัวอย่าง','Tech@12345','ช่างซ่อม'],['requester','ผู้แจ้งซ่อมตัวอย่าง','User@12345','ผู้แจ้งซ่อม']];
 for(const [u,n,p,r] of demo){const h=await bcrypt.hash(p,12);await c.query(`INSERT INTO users(username,full_name,password_hash,role_id,is_active) VALUES($1,$2,$3,(SELECT id FROM roles WHERE name=$4),true) ON CONFLICT(username) DO UPDATE SET full_name=EXCLUDED.full_name,password_hash=EXCLUDED.password_hash,role_id=EXCLUDED.role_id,is_active=true`,[u,n,h,r]);}
 await c.query('COMMIT'); console.log('Seed สำเร็จ: บัญชีทดสอบ admin, manager, tech, requester'); console.log('รหัสผ่าน: Admin@12345 / Manager@12345 / Tech@12345 / User@12345');
 }catch(e){await c.query('ROLLBACK');console.error(e);process.exitCode=1;}finally{c.release();await pool.end();}})();
