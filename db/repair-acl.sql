-- FixFlow: เติม Permission และผูกสิทธิ์ตามบทบาทที่มีอยู่ โดยไม่ลบข้อมูลเดิม
-- ใช้กับฐานข้อมูล fixflow_db ที่เว็บ Render เชื่อมต่ออยู่จริง
BEGIN;

INSERT INTO permissions (code, name, description) VALUES
('dashboard.read', 'ดูภาพรวม', 'เปิด Dashboard'),
('request.read', 'ดูรายการแจ้งซ่อม', 'ดูรายการที่ได้รับอนุญาต'),
('request.create', 'สร้างคำขอแจ้งซ่อม', 'สร้างคำขอใหม่'),
('request.update.own', 'แก้ไขคำขอของตนเอง', 'แก้ไขคำขอของตนเองก่อนพิจารณา'),
('request.approve', 'พิจารณาคำขอ', 'อนุมัติหรือปฏิเสธคำขอ'),
('request.assign', 'มอบหมายช่าง', 'มอบหมายงานให้ช่าง'),
('request.work', 'อัปเดตงานซ่อม', 'อัปเดตสถานะและผลการซ่อม'),
('request.delete', 'ลบคำขอแจ้งซ่อม', 'สิทธิ์สำหรับการลบคำขอ'),
('file.upload', 'อัปโหลดไฟล์', 'แนบไฟล์ในคำขอที่เข้าถึงได้'),
('file.read', 'ดาวน์โหลดไฟล์', 'ดูหรือดาวน์โหลดไฟล์แนบ'),
('file.delete', 'ลบไฟล์แนบ', 'ลบไฟล์แนบ'),
('user.manage', 'จัดการผู้ใช้', 'สร้างผู้ใช้และกำหนดบทบาท'),
('role.manage', 'จัดการบทบาท', 'เพิ่มหรือลบบทบาท'),
('permission.manage', 'จัดการ ACL', 'จัดการ Permission และ ACL'),
('log.read', 'ดู Audit Log', 'ดูประวัติการใช้งาน')
ON CONFLICT (code) DO NOTHING;

WITH role_aliases AS (
  SELECT id,
    CASE
      WHEN LOWER(TRIM(name)) IN ('admin','administrator','ผู้ดูแลระบบ') THEN 'admin'
      WHEN LOWER(TRIM(name)) IN ('manager','ผู้จัดการ') THEN 'manager'
      WHEN LOWER(TRIM(name)) IN ('technician','ช่างซ่อม','ช่าง') THEN 'technician'
      WHEN LOWER(TRIM(name)) IN ('requester','ผู้แจ้งซ่อม','ผู้แจ้ง') THEN 'requester'
      ELSE NULL
    END AS role_key
  FROM roles
),
desired(role_key, permission_code) AS (
  SELECT 'admin', code FROM permissions
  UNION ALL SELECT 'manager', unnest(ARRAY[
    'dashboard.read','request.read','request.approve','request.assign',
    'file.read','file.upload'
  ]::text[])
  UNION ALL SELECT 'technician', unnest(ARRAY[
    'dashboard.read','request.read','request.work','file.read','file.upload'
  ]::text[])
  UNION ALL SELECT 'requester', unnest(ARRAY[
    'dashboard.read','request.read','request.create','request.update.own',
    'file.read','file.upload'
  ]::text[])
)
INSERT INTO role_permissions (role_id, permission_id)
SELECT ra.id, p.id
FROM role_aliases ra
JOIN desired d ON d.role_key = ra.role_key
JOIN permissions p ON p.code = d.permission_code
ON CONFLICT DO NOTHING;

COMMIT;

-- ตรวจผลหลังรัน
SELECT r.name AS role_name, COUNT(rp.permission_id) AS total_permissions
FROM roles r
LEFT JOIN role_permissions rp ON rp.role_id = r.id
GROUP BY r.id, r.name
ORDER BY r.id;
