# FixFlow — แพ็กเกจแก้ไข

## ไฟล์ที่แก้
- `server.js`: แก้ alias ชื่อบทบาท admin/manager/technician/requester, การเห็นรายการตามบทบาท, เปรียบเทียบ ID, รายชื่อช่าง และการนับสถิติให้ไม่เปิดเผยรายการของผู้อื่น
- `views/request-detail.ejs`: แก้การแสดงส่วนอัปเดตงานสำหรับ Admin ที่ชื่อบทบาทเป็นตัวพิมพ์เล็ก/ภาษาไทย
- `views/admin-acl.ejs`, `views/admin-roles.ejs`: แก้เงื่อนไข Admin ให้รองรับชื่อบทบาทหลายรูปแบบ
- `scripts/seed.js`: ทำให้ seed รองรับชื่อบทบาทเดิมและไม่รีเซ็ตรหัสผ่านผู้ใช้ที่มีอยู่
- `db/repair-acl.sql`: เติม Permission ที่ขาดและเชื่อมกับบทบาทเดิมโดยไม่ลบข้อมูล

## ขั้นตอนแนะนำ
1. สำรองโปรเจกต์เดิมไว้ก่อน
2. คัดลอกไฟล์จากแพ็กเกจนี้ไปทับไฟล์เดิมตามโครงสร้าง
3. เปิด PostgreSQL ที่ Render ใช้งานจริง แล้วรัน `db/repair-acl.sql` ทั้งไฟล์
4. ตรวจ Environment Variables บน Render ว่ามี `DATABASE_URL` และ `SESSION_SECRET`
5. Push โค้ดขึ้น GitHub แล้วรอ Deploy สำเร็จ
6. ทดสอบ `/health`, Login, สร้างคำขอด้วย Requester, อนุมัติ/มอบหมายด้วย Manager, อัปเดตงานด้วย Technician และหน้า ACL ด้วย Admin

## หมายเหตุ
- อย่ารันคำสั่ง `CREATE DATABASE` กับฐานข้อมูลเดิม
- อย่าอัปโหลด `.env` ไป GitHub
- ไฟล์นี้ผ่านการตรวจไวยากรณ์ `node --check` สำหรับ `server.js` และ `scripts/seed.js` แต่ไม่ได้เชื่อมต่อฐานข้อมูล Render เพื่อทดสอบ end-to-end
- Render filesystem อาจเป็นแบบชั่วคราว: ไฟล์แนบใน `uploads/` อาจหายเมื่อ redeploy/restart เว้นแต่ตั้ง Persistent Disk หรือใช้ object storage
