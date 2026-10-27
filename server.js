
app.get('/app/requests/:id', auth, need('request.read'), async (req, res, next) => {
    try {
        // ตรวจสอบ ID ของรายการแจ้งซ่อม
        const requestId = Number(req.params.id);

        if (!Number.isInteger(requestId) || requestId < 1) {
            return res.status(404).render('error', {
                title: 'ไม่พบรายการ',
                message: 'ไม่พบคำขอนี้'
            });
        }

        // ดึงข้อมูลรายการแจ้งซ่อม
        const result = await pool.query(
            `SELECT
                rr.*,
                u.full_name AS requester,
                t.full_name AS technician
             FROM repair_requests rr
             JOIN users u ON u.id = rr.requester_id
             LEFT JOIN users t ON t.id = rr.technician_id
             WHERE rr.id = $1`,
            [requestId]
        );

        const item = result.rows[0];

        if (!item) {
            return res.status(404).render('error', {
                title: 'ไม่พบรายการ',
                message: 'ไม่พบคำขอนี้'
            });
        }

        // อ่านบทบาทล่าสุดจากฐานข้อมูลโดยใช้ ID ผู้ใช้
        const userResult = await pool.query(
            `SELECT u.id, u.role_id, r.name AS role_name
             FROM users u
             JOIN roles r ON r.id = u.role_id
             WHERE u.id = $1
               AND u.is_active = TRUE`,
            [req.session.user.id]
        );

        if (!userResult.rowCount) {
            return res.status(403).render('error', {
                title: 'บัญชีไม่พร้อมใช้งาน',
                message: 'ไม่พบบัญชีผู้ใช้หรือบัญชีถูกปิดใช้งาน'
            });
        }

        const currentUser = userResult.rows[0];
                const roleName = String(currentUser.role_name || '').trim().toLowerCase();

        // รองรับชื่อบทบาทที่ใช้จริงในฐานข้อมูล
        const canViewAll =
            roleName === 'admin' ||
            roleName === 'manager' ||
            roleName === 'ผู้จัดการ';



        // ตรวจสอบว่าเป็นผู้แจ้งหรือช่างที่ได้รับมอบหมายหรือไม่
        const userId = Number(currentUser.id);

        const isRequester =
            Number(item.requester_id) === userId;

        const isAssignedTechnician =
            item.technician_id != null &&
            Number(item.technician_id) === userId;

        //ปฏิเสธเฉพาะผู้ที่ไม่มีสิทธิ์จริง ๆ
        if (
            !canViewAll &&
            !isRequester &&
            !isAssignedTechnician
        ) {
            await logEvent(
                req,
                'ACCESS_DENIED',
                'repair_requests',
                item.id,
                'DENIED',
                'ไม่มีสิทธิ์ดูรายการแจ้งซ่อม'
            );

            return res.status(403).render('error', {
                title: 'ไม่มีสิทธิ์',
                message:
                    'ดูได้เฉพาะรายการของตนเองหรือรายการที่รับผิดชอบ'
            });
        }

        // ดึงไฟล์แนบของรายการ
        const filesResult = await pool.query(
            `SELECT f.*, u.full_name AS uploader
             FROM uploaded_files f
             JOIN users u ON u.id = f.uploaded_by
             WHERE f.request_id = $1
             ORDER BY f.created_at DESC`,
            [item.id]
        );

        // ดึงรายชื่อช่างที่เปิดใช้งาน
        const techniciansResult = await pool.query(
            `SELECT u.id, u.full_name
             FROM users u
             JOIN roles r ON r.id = u.role_id
             WHERE LOWER(TRIM(r.name)) IN (
                 'technician', 'ช่างซ่อม', 'ช่าง'
             )
             AND u.is_active = TRUE
             ORDER BY u.full_name`
        );

        // แสดงหน้ารายละเอียดแจ้งซ่อม
        return res.render('request-detail', {
            title: item.request_no,
            item,
            files: filesResult.rows,
            techs: techniciansResult.rows
        });

    } catch (error) {
        next(error);
    }
});
