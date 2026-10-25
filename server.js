require('dotenv').config();
const express = require('express'), session = require('express-session'), PgSession = require('connect-pg-simple')(session);
const { Pool } = require('pg'), bcrypt = require('bcrypt'), helmet = require('helmet'), multer = require('multer');
const path = require('path'), fs = require('fs'), crypto = require('crypto'), methodOverride = require('method-override');
const app = express();
const pool = new Pool({
    connectionString: process.env.DATABASE_URL
});
app.set('trust proxy', 1);
if (process.env.NODE_ENV === 'production' && !process.env.SESSION_SECRET) {
    console.error('ต้องตั้งค่า SESSION_SECRET ใน Environment ของ Render');
    process.exit(1);
}
const PORT = process.env.PORT || 3000, UPLOAD_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
app.use(express.static(path.join(__dirname, 'public'))); app.set('view engine', 'ejs'); app.set('views', path.join(__dirname, 'views'));
app.use(helmet({ contentSecurityPolicy: false })); app.use(express.urlencoded({ extended: false, limit: '1mb' })); app.use(express.json({ limit: '1mb' })); app.use(methodOverride('_method'));
app.use(session({ store: new PgSession({ pool, tableName: 'user_sessions', createTableIfMissing: true }), secret: process.env.SESSION_SECRET || 'development-only-secret', resave: false, saveUninitialized: false, cookie: { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: 1000 * 60 * 60 * 4 } }));
app.use(async (req, res, next) => {
    res.locals.user = req.session.user || null; res.locals.flash = req.session.flash || null; delete req.session.flash;
    if (req.session.user) { try { const q = await pool.query(`SELECT p.code FROM permissions p JOIN role_permissions rp ON rp.permission_id=p.id WHERE rp.role_id=$1`, [req.session.user.role_id]); req.session.permissions = q.rows.map(x => x.code); res.locals.permissions = req.session.permissions; } catch (e) { return next(e) } } else { req.session.permissions = []; res.locals.permissions = [] }
    next();
});
function flash(req, msg, type = 'success') { req.session.flash = { msg, type } }
function normalizeRole(value) {
    const role = String(value || '').trim().toLowerCase();
    if (['admin', 'administrator', 'ผู้ดูแลระบบ'].includes(role)) return 'admin';
    if (['manager', 'ผู้จัดการ'].includes(role)) return 'manager';
    if (['technician', 'ช่างซ่อม', 'ช่าง'].includes(role)) return 'technician';
    if (['requester', 'ผู้แจ้งซ่อม', 'ผู้แจ้ง'].includes(role)) return 'requester';
    return role;
}
function isAdmin(user) { return normalizeRole(user?.role_name) === 'admin'; }
function isManager(user) { return normalizeRole(user?.role_name) === 'manager'; }
function canViewAllRequests(user) { return isAdmin(user) || isManager(user); }
async function logEvent(req, event, resource, id, result = 'SUCCESS', details = '') { try { await pool.query(`INSERT INTO audit_logs(user_id,username,event_type,resource,resource_id,result,details,ip_address) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`, [req.session.user?.id || null, req.session.user?.username || req.body.username || null, event, resource, id == null ? null : String(id), result, String(details).slice(0, 500), req.ip]) } catch (e) { console.error('log failure', e.message) } }
function auth(req, res, next) { if (!req.session.user) { if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'กรุณาเข้าสู่ระบบ' }); return res.redirect('/login') } next() }
function need(code) { return async (req, res, next) => { try { if (isAdmin(req.session.user)) return next(); const q = await pool.query(`SELECT 1 FROM role_permissions rp JOIN permissions p ON p.id=rp.permission_id WHERE rp.role_id=$1 AND p.code=$2`, [req.session.user.role_id, code]); if (q.rowCount) return next(); await logEvent(req, 'ACCESS_DENIED', req.path, req.params.id, 'DENIED', `ต้องมี ${code}`); return res.status(403).render('error', { title: 'ไม่มีสิทธิ์', message: `บัญชีนี้ไม่มีสิทธิ์ ${code}` }) } catch (e) { next(e) } } }
app.get('/health', async (req, res) => { const q = await pool.query('SELECT current_database() AS database,NOW() AS time'); res.json({ status: 'ok', ...q.rows[0] }) });
app.get('/', (req, res) => res.redirect(req.session.user ? '/app' : '/login'));
app.get('/login', (req, res) => res.render('login', { title: 'เข้าสู่ระบบ' }));
app.post('/login', async (req, res, next) => {
    try {
        const { username, password } = req.body; const q = await pool.query(`SELECT u.*,r.name role_name FROM users u JOIN roles r ON r.id=u.role_id WHERE u.username=$1`, [String(username || '').trim()]); const u = q.rows[0]; if (!u || !u.is_active || !await bcrypt.compare(String(password || ''), u.password_hash)) { await logEvent(req, 'LOGIN_FAILED', 'auth', username, 'FAILURE', 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง'); return res.status(401).render('login', { title: 'เข้าสู่ระบบ', error: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' }) }
        await new Promise((resolve, reject) => req.session.regenerate(e => e ? reject(e) : resolve())); req.session.user = { id: u.id, username: u.username, full_name: u.full_name, role_id: u.role_id, role_name: u.role_name }; await logEvent(req, 'LOGIN_SUCCESS', 'auth', u.id, 'SUCCESS', 'เข้าสู่ระบบสำเร็จ'); res.redirect('/app')
    } catch (e) { next(e) }
});
app.post('/logout', auth, async (req, res) => { await logEvent(req, 'LOGOUT', 'auth', req.session.user.id); req.session.destroy(() => res.redirect('/login')) });
app.get('/app', auth, need('dashboard.read'), async (req, res, next) => {
    try {
        const userId = Number(req.session.user.id);
        const seeAll = canViewAllRequests(req.session.user);
        const stats = await pool.query(
            `SELECT status, count(*)::int AS count
             FROM repair_requests
             WHERE ($1::boolean OR requester_id=$2 OR technician_id=$2)
             GROUP BY status`,
            [seeAll, userId]
        );
        const recent = await pool.query(
            `SELECT rr.*, u.full_name AS requester
             FROM repair_requests rr
             JOIN users u ON u.id = rr.requester_id
             WHERE ($1::boolean OR rr.requester_id=$2 OR rr.technician_id=$2)
             ORDER BY rr.created_at DESC LIMIT 8`,
            [seeAll, userId]
        );
        res.render('dashboard', { title: 'ภาพรวม', stats: stats.rows, recent: recent.rows })
    } catch (e) { next(e) }
});
app.get('/app/requests', auth, need('request.read'), async (req, res, next) => {
    try {
        const { status = '', q = '' } = req.query;
        const isPriv = canViewAllRequests(req.session.user);
        const rows = await pool.query(`SELECT rr.*,u.full_name requester,t.full_name technician FROM repair_requests rr JOIN users u ON u.id=rr.requester_id LEFT JOIN users t ON t.id=rr.technician_id WHERE ($1 OR rr.requester_id=$2 OR rr.technician_id=$2) AND ($3='' OR rr.status=$3) AND ($4='' OR rr.title ILIKE '%'||$4||'%' OR rr.request_no ILIKE '%'||$4||'%') ORDER BY rr.created_at DESC`, [isPriv, req.session.user.id, status, q]); res.render('requests', { title: 'รายการแจ้งซ่อม', requests: rows.rows, status, q })
    } catch (e) { next(e) }
});
app.get('/app/requests/new', auth, need('request.create'), (req, res) => res.render('request-form', { title: 'แจ้งซ่อม', item: null }));
app.post('/app/requests', auth, need('request.create'), async (req, res, next) => { try { const { title, description, location, priority } = req.body; if (!title?.trim() || !description?.trim() || !location?.trim()) return res.status(400).render('error', { title: 'ข้อมูลไม่ครบ', message: 'กรุณากรอกหัวข้อ รายละเอียด และสถานที่' }); const no = 'FX-' + Date.now().toString().slice(-9) + '-' + crypto.randomBytes(2).toString('hex').toUpperCase(); const q = await pool.query(`INSERT INTO repair_requests(request_no,title,description,location,priority,requester_id) VALUES($1,$2,$3,$4,$5,$6) RETURNING id`, [no, title.trim(), description.trim(), location.trim(), ['ต่ำ', 'ปกติ', 'สูง', 'เร่งด่วน'].includes(priority) ? priority : 'ปกติ', req.session.user.id]); await logEvent(req, 'REQUEST_CREATE', 'repair_requests', q.rows[0].id, 'SUCCESS', no); flash(req, 'สร้างคำขอแจ้งซ่อมเรียบร้อย เลขที่ ' + no); res.redirect('/app/requests/' + q.rows[0].id) } catch (e) { next(e) } });
app.get('/app/requests/:id', auth, need('request.read'), async (req, res, next) => {
    try {
        const requestId = Number(req.params.id);
        if (!Number.isInteger(requestId) || requestId < 1) {
            return res.status(404).render('error', { title: 'ไม่พบรายการ', message: 'ไม่พบคำขอนี้' });
        }
        const q = await pool.query(
            `SELECT rr.*, u.full_name AS requester, t.full_name AS technician
             FROM repair_requests rr
             JOIN users u ON u.id = rr.requester_id
             LEFT JOIN users t ON t.id = rr.technician_id
             WHERE rr.id = $1`,
            [requestId]
        );
        const item = q.rows[0];
        if (!item) return res.status(404).render('error', { title: 'ไม่พบรายการ', message: 'ไม่พบคำขอนี้' });

        const userId = Number(req.session.user.id);
        const canViewOwn = Number(item.requester_id) === userId ||
            (item.technician_id != null && Number(item.technician_id) === userId);
        if (!canViewAllRequests(req.session.user) && !canViewOwn) {
            await logEvent(req, 'ACCESS_DENIED', 'repair_requests', item.id, 'DENIED', 'พยายามดูรายการของผู้อื่น');
            return res.status(403).render('error', {
                title: 'ไม่มีสิทธิ์',
                message: 'ดูได้เฉพาะรายการของตนเองหรือรายการที่รับผิดชอบ'
            });
        }

        const files = await pool.query(
            `SELECT f.*, u.full_name AS uploader
             FROM uploaded_files f
             JOIN users u ON u.id = f.uploaded_by
             WHERE f.request_id = $1 ORDER BY f.created_at DESC`,
            [item.id]
        );
        const techs = await pool.query(
            `SELECT u.id, u.full_name
             FROM users u JOIN roles r ON r.id = u.role_id
             WHERE LOWER(r.name) IN ('technician', 'ช่างซ่อม', 'ช่าง')
               AND u.is_active = TRUE
             ORDER BY u.full_name`
        );
        res.render('request-detail', { title: item.request_no, item, files: files.rows, techs: techs.rows });
    } catch (e) { next(e); }
});
app.post('/app/requests/:id/decision', auth, need('request.approve'), async (req, res, next) => { try { const { decision, note } = req.body; const status = decision === 'approve' ? 'อนุมัติแล้ว' : 'ไม่อนุมัติ'; const q = await pool.query(`UPDATE repair_requests SET status=$1,manager_note=$2,updated_at=NOW() WHERE id=$3 AND status='รอพิจารณา' RETURNING id`, [status, String(note || '').slice(0, 1000), req.params.id]); if (!q.rowCount) { flash(req, 'รายการนี้ไม่อยู่ในสถานะรอพิจารณา', 'error'); return res.redirect('/app/requests/' + req.params.id) } await logEvent(req, 'REQUEST_DECISION', 'repair_requests', req.params.id, 'SUCCESS', status); flash(req, 'บันทึกผลพิจารณาแล้ว'); res.redirect('/app/requests/' + req.params.id) } catch (e) { next(e) } });
app.post('/app/requests/:id/assign', auth, need('request.assign'), async (req, res, next) => { try { const tech = Number(req.body.technician_id); const exists = await pool.query(`SELECT u.id FROM users u JOIN roles r ON r.id=u.role_id WHERE u.id=$1 AND LOWER(r.name) IN ('technician','ช่างซ่อม','ช่าง') AND u.is_active=true`, [tech]); if (!exists.rowCount) { flash(req, 'กรุณาเลือกบัญชีช่างที่ถูกต้อง', 'error'); return res.redirect('/app/requests/' + req.params.id) } await pool.query(`UPDATE repair_requests SET technician_id=$1,status=CASE WHEN status='อนุมัติแล้ว' THEN 'กำลังซ่อม' ELSE status END,updated_at=NOW() WHERE id=$2`, [tech, req.params.id]); await logEvent(req, 'REQUEST_ASSIGN', 'repair_requests', req.params.id, 'SUCCESS', `มอบหมายให้ user id ${tech}`); flash(req, 'มอบหมายช่างเรียบร้อย'); res.redirect('/app/requests/' + req.params.id) } catch (e) { next(e) } });
app.post('/app/requests/:id/work', auth, need('request.work'), async (req, res, next) => { try { const allowed = ['กำลังซ่อม', 'รอตรวจรับ', 'เสร็จสิ้น']; const { status, resolution_note } = req.body; const q = await pool.query('SELECT technician_id FROM repair_requests WHERE id=$1', [req.params.id]); if (!q.rowCount) return res.status(404).render('error', { title: 'ไม่พบรายการ', message: 'ไม่พบรายการ' }); if (!isAdmin(req.session.user) && Number(q.rows[0].technician_id) !== Number(req.session.user.id)) { await logEvent(req, 'ACCESS_DENIED', 'repair_requests', req.params.id, 'DENIED', 'ช่างที่ไม่ได้รับมอบหมาย'); return res.status(403).render('error', { title: 'ไม่มีสิทธิ์', message: 'อัปเดตได้เฉพาะงานที่ได้รับมอบหมาย' }) } if (!allowed.includes(status)) return res.status(400).render('error', { title: 'ข้อมูลไม่ถูกต้อง', message: 'สถานะไม่ถูกต้อง' }); await pool.query('UPDATE repair_requests SET status=$1,resolution_note=$2,updated_at=NOW() WHERE id=$3', [status, String(resolution_note || '').slice(0, 1000), req.params.id]); await logEvent(req, 'REQUEST_STATUS_CHANGE', 'repair_requests', req.params.id, 'SUCCESS', status); flash(req, 'อัปเดตสถานะงานแล้ว'); res.redirect('/app/requests/' + req.params.id) } catch (e) { next(e) } });
const storage = multer.diskStorage({ destination: (req, file, cb) => cb(null, UPLOAD_DIR), filename: (req, file, cb) => cb(null, crypto.randomUUID() + path.extname(file.originalname).toLowerCase()) });
const upload = multer({ storage, limits: { fileSize: (Number(process.env.MAX_FILE_MB) || 5) * 1024 * 1024 }, fileFilter: (req, file, cb) => { const ok = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf', 'text/plain'].includes(file.mimetype); cb(ok ? null : new Error('อนุญาตเฉพาะ JPG, PNG, WEBP, PDF หรือ TXT'), ok) } });
app.post('/app/requests/:id/files', auth, need('file.upload'), (req, res, next) => upload.single('attachment')(req, res, async err => { if (err) { await logEvent(req, 'FILE_UPLOAD', 'uploaded_files', req.params.id, 'FAILURE', err.message); flash(req, err.code === 'LIMIT_FILE_SIZE' ? `ไฟล์ต้องไม่เกิน ${process.env.MAX_FILE_MB || 5} MB` : err.message, 'error'); return res.redirect('/app/requests/' + req.params.id) } try { if (!req.file) { flash(req, 'กรุณาเลือกไฟล์', 'error'); return res.redirect('/app/requests/' + req.params.id) } const r = await pool.query('SELECT requester_id,technician_id FROM repair_requests WHERE id=$1', [req.params.id]); if (!r.rowCount) { fs.unlinkSync(req.file.path); return res.status(404).render('error', { title: 'ไม่พบรายการ', message: 'ไม่พบรายการ' }) } if (!canViewAllRequests(req.session.user) && Number(r.rows[0].requester_id) !== Number(req.session.user.id) && Number(r.rows[0].technician_id) !== Number(req.session.user.id)) { fs.unlinkSync(req.file.path); await logEvent(req, 'ACCESS_DENIED', 'uploaded_files', req.params.id, 'DENIED', 'อัปโหลดไฟล์ในรายการที่ไม่มีสิทธิ์'); return res.status(403).render('error', { title: 'ไม่มีสิทธิ์', message: 'ไม่มีสิทธิ์แนบไฟล์ในรายการนี้' }) } await pool.query('INSERT INTO uploaded_files(request_id,original_name,stored_name,mime_type,size_bytes,uploaded_by) VALUES($1,$2,$3,$4,$5,$6)', [req.params.id, path.basename(req.file.originalname), req.file.filename, req.file.mimetype, req.file.size, req.session.user.id]); await logEvent(req, 'FILE_UPLOAD', 'uploaded_files', req.params.id, 'SUCCESS', req.file.originalname); flash(req, 'อัปโหลดไฟล์เรียบร้อย'); res.redirect('/app/requests/' + req.params.id) } catch (e) { next(e) } }));
app.get('/files/:id', auth, need('file.read'), async (req, res, next) => { try { const q = await pool.query(`SELECT f.*,r.requester_id,r.technician_id FROM uploaded_files f JOIN repair_requests r ON r.id=f.request_id WHERE f.id=$1`, [req.params.id]); const f = q.rows[0]; if (!f) return res.status(404).render('error', { title: 'ไม่พบไฟล์', message: 'ไม่พบไฟล์นี้' }); if (!canViewAllRequests(req.session.user) && Number(f.requester_id) !== Number(req.session.user.id) && Number(f.technician_id) !== Number(req.session.user.id)) { await logEvent(req, 'FILE_ACCESS_DENIED', 'uploaded_files', f.id, 'DENIED', 'ไม่มีสิทธิ์ดาวน์โหลด'); return res.status(403).render('error', { title: 'ไม่มีสิทธิ์', message: 'ไม่มีสิทธิ์เข้าถึงไฟล์นี้' }) } await logEvent(req, 'FILE_DOWNLOAD', 'uploaded_files', f.id, 'SUCCESS', f.original_name); res.download(path.join(UPLOAD_DIR, path.basename(f.stored_name)), f.original_name) } catch (e) { next(e) } });
app.post('/files/:id/delete', auth, need('file.delete'), async (req, res, next) => { try { const q = await pool.query('SELECT * FROM uploaded_files WHERE id=$1', [req.params.id]); if (!q.rowCount) return res.redirect('/app/requests'); const f = q.rows[0]; try { fs.unlinkSync(path.join(UPLOAD_DIR, path.basename(f.stored_name))) } catch { } await pool.query('DELETE FROM uploaded_files WHERE id=$1', [f.id]); await logEvent(req, 'FILE_DELETE', 'uploaded_files', f.id, 'SUCCESS', f.original_name); flash(req, 'ลบไฟล์แล้ว'); res.redirect('/app/requests/' + f.request_id) } catch (e) { next(e) } });
app.get('/admin/users', auth, need('user.manage'), async (req, res, next) => { try { const users = await pool.query('SELECT u.id,u.username,u.full_name,u.is_active,u.created_at,u.role_id,r.name role_name FROM users u JOIN roles r ON r.id=u.role_id ORDER BY u.id'); const roles = await pool.query('SELECT * FROM roles ORDER BY id'); res.render('admin-users', { title: 'จัดการผู้ใช้', users: users.rows, roles: roles.rows }) } catch (e) { next(e) } });
app.post('/admin/users', auth, need('user.manage'), async (req, res, next) => { try { const { username, full_name, password, role_id } = req.body; if (!/^[a-zA-Z0-9_.-]{3,60}$/.test(username) || !full_name?.trim() || String(password || '').length < 8) throw Error('ชื่อผู้ใช้ต้อง 3-60 ตัวอักษร และรหัสผ่านอย่างน้อย 8 ตัว'); const hash = await bcrypt.hash(password, 12); await pool.query('INSERT INTO users(username,full_name,password_hash,role_id) VALUES($1,$2,$3,$4)', [username, full_name.trim(), hash, role_id]); await logEvent(req, 'USER_CREATE', 'users', username, 'SUCCESS', `สร้างบัญชี ${username}`); flash(req, 'สร้างผู้ใช้เรียบร้อย') } catch (e) { flash(req, e.code === '23505' ? 'ชื่อผู้ใช้นี้มีแล้ว' : e.message, 'error') } res.redirect('/admin/users') });
app.post('/admin/users/:id/role', auth, need('user.manage'), async (req, res, next) => { try { if (Number(req.params.id) === req.session.user.id && Number(req.body.role_id) !== req.session.user.role_id) throw Error('ไม่อนุญาตให้เปลี่ยนบทบาทของบัญชีที่กำลังใช้งาน'); const target = await pool.query('SELECT role_id FROM users WHERE id=$1', [req.params.id]); if (!target.rowCount) throw Error('ไม่พบผู้ใช้'); const role = await pool.query('SELECT name FROM roles WHERE id=$1', [req.body.role_id]); if (normalizeRole(role.rows[0]?.name) !== 'admin' && Number(target.rows[0].role_id) !== Number(req.body.role_id)) { const n = await pool.query(`SELECT count(*)::int n FROM users u JOIN roles r ON r.id=u.role_id WHERE LOWER(r.name) IN ('admin','administrator','ผู้ดูแลระบบ') AND u.is_active=true`); const old = await pool.query(`SELECT r.name FROM users u JOIN roles r ON r.id=u.role_id WHERE u.id=$1`, [req.params.id]); if (normalizeRole(old.rows[0]?.name) === 'admin' && n.rows[0].n <= 1) throw Error('ต้องมี Admin ที่ใช้งานได้อย่างน้อย 1 บัญชี') } await pool.query('UPDATE users SET role_id=$1 WHERE id=$2', [req.body.role_id, req.params.id]); await logEvent(req, 'USER_ROLE_CHANGE', 'users', req.params.id, 'SUCCESS', `เปลี่ยนเป็น ${role.rows[0]?.name}`); flash(req, 'เปลี่ยนบทบาทเรียบร้อย') } catch (e) { flash(req, e.message, 'error') } res.redirect('/admin/users') });
app.get('/admin/roles', auth, need('role.manage'), async (req, res, next) => { try { const roles = await pool.query(`SELECT r.*,count(u.id)::int user_count FROM roles r LEFT JOIN users u ON u.role_id=r.id GROUP BY r.id ORDER BY r.id`); res.render('admin-roles', { title: 'จัดการบทบาท', roles: roles.rows }) } catch (e) { next(e) } });
app.post('/admin/roles', auth, need('role.manage'), async (req, res) => { try { const name = String(req.body.name || '').trim(), description = String(req.body.description || '').trim(); if (name.length < 2 || name.length > 50) throw Error('ชื่อบทบาทต้อง 2-50 ตัวอักษร'); await pool.query('INSERT INTO roles(name,description) VALUES($1,$2)', [name, description]); await logEvent(req, 'ROLE_CREATE', 'roles', name, 'SUCCESS', 'สร้างบทบาท'); flash(req, 'เพิ่มบทบาทแล้ว') } catch (e) { flash(e.code === '23505' ? 'ชื่อบทบาทซ้ำ' : e.message, 'error') } res.redirect('/admin/roles') });
app.post('/admin/roles/:id/delete', auth, need('role.manage'), async (req, res) => { try { const q = await pool.query('SELECT * FROM roles WHERE id=$1', [req.params.id]); if (!q.rowCount) throw Error('ไม่พบบทบาท'); if (normalizeRole(q.rows[0].name) === 'admin') throw Error('ห้ามลบบทบาท Admin'); const n = await pool.query('SELECT count(*)::int n FROM users WHERE role_id=$1', [req.params.id]); if (n.rows[0].n) throw Error('ลบบทบาทที่มีผู้ใช้อยู่ไม่ได้'); await pool.query('DELETE FROM roles WHERE id=$1', [req.params.id]); await logEvent(req, 'ROLE_DELETE', 'roles', req.params.id, 'SUCCESS', q.rows[0].name); flash(req, 'ลบบทบาทแล้ว') } catch (e) { flash(req, e.message, 'error') } res.redirect('/admin/roles') });
app.get('/admin/acl', auth, need('permission.manage'), async (req, res, next) => { try { const roles = (await pool.query('SELECT * FROM roles ORDER BY id')).rows, perms = (await pool.query('SELECT * FROM permissions ORDER BY code')).rows, links = (await pool.query('SELECT role_id,permission_id FROM role_permissions')).rows; res.render('admin-acl', { title: 'Permission และ ACL', roles, perms, links }) } catch (e) { next(e) } });
app.post('/admin/acl', auth, need('permission.manage'), async (req, res) => { const c = await pool.connect(); try { await c.query('BEGIN'); const roles = (await c.query('SELECT id,name FROM roles')).rows; for (const r of roles) { await c.query('DELETE FROM role_permissions WHERE role_id=$1', [r.id]); const ids = req.body[`role_${r.id}`]; for (const raw of (Array.isArray(ids) ? ids : ids ? [ids] : [])) { await c.query('INSERT INTO role_permissions(role_id,permission_id) VALUES($1,$2) ON CONFLICT DO NOTHING', [r.id, Number(raw)]) } if (normalizeRole(r.name) === 'admin') { await c.query('INSERT INTO role_permissions(role_id,permission_id) SELECT $1,id FROM permissions ON CONFLICT DO NOTHING', [r.id]) } } await c.query('COMMIT'); await logEvent(req, 'ACL_UPDATE', 'role_permissions', 'all', 'SUCCESS', 'อัปเดตตาราง ACL'); flash(req, 'บันทึก ACL แล้ว สิทธิ์มีผลทันที') } catch (e) { await c.query('ROLLBACK'); flash(req, 'บันทึก ACL ไม่สำเร็จ: ' + e.message, 'error') } finally { c.release() } res.redirect('/admin/acl') });
app.post('/admin/permissions', auth, need('permission.manage'), async (req, res) => { try { const { code, name, description = '' } = req.body; const supported = ['dashboard.read', 'request.read', 'request.create', 'request.update.own', 'request.approve', 'request.assign', 'request.work', 'request.delete', 'file.upload', 'file.read', 'file.delete', 'user.manage', 'role.manage', 'permission.manage', 'log.read']; if (!supported.includes(code)) throw Error('Permission นี้ยังไม่มี Route/API รองรับในเวอร์ชันนี้'); await pool.query('INSERT INTO permissions(code,name,description) VALUES($1,$2,$3)', [code, name, description]); await logEvent(req, 'PERMISSION_CREATE', 'permissions', code, 'SUCCESS', name); flash(req, 'เพิ่ม Permission แล้ว') } catch (e) { flash(req, e.code === '23505' ? 'รหัส Permission ซ้ำ' : e.message, 'error') } res.redirect('/admin/acl') });
app.post('/admin/permissions/:id/delete', auth, need('permission.manage'), async (req, res) => { try { const p = await pool.query('SELECT * FROM permissions WHERE id=$1', [req.params.id]); if (!p.rowCount) throw Error('ไม่พบ Permission'); if (p.rows[0].code === 'dashboard.read') throw Error('ห้ามลบ dashboard.read'); await pool.query('DELETE FROM permissions WHERE id=$1', [req.params.id]); await logEvent(req, 'PERMISSION_DELETE', 'permissions', req.params.id, 'SUCCESS', p.rows[0].code); flash(req, 'ลบ Permission แล้ว') } catch (e) { flash(req, e.message, 'error') } res.redirect('/admin/acl') });
app.get('/admin/logs', auth, need('log.read'), async (req, res, next) => { try { const { username = '', event = '', from = '', to = '' } = req.query; const logs = await pool.query(`SELECT * FROM audit_logs WHERE ($1='' OR username ILIKE '%'||$1||'%') AND ($2='' OR event_type=$2) AND ($3='' OR created_at >= $3::date) AND ($4='' OR created_at < ($4::date + INTERVAL '1 day')) ORDER BY created_at DESC LIMIT 500`, [username, event, from, to]); const events = await pool.query('SELECT DISTINCT event_type FROM audit_logs ORDER BY event_type'); res.render('admin-logs', { title: 'Audit Log', logs: logs.rows, filters: { username, event, from, to }, events: events.rows }) } catch (e) { next(e) } });
app.use((req, res) => res.status(404).render('error', { title: 'ไม่พบหน้า', message: 'ไม่พบหน้าที่ต้องการ (404)' }));
app.use((err, req, res, next) => { console.error(err.stack || err); if (req.session) req.session.flash = { msg: 'ระบบพบข้อผิดพลาด กรุณาตรวจสอบข้อมูลและลองใหม่', type: 'error' }; res.status(500).render('error', { title: 'เกิดข้อผิดพลาด', message: process.env.NODE_ENV === 'production' ? 'ระบบไม่สามารถดำเนินการได้' : err.message }) });
(async () => { try { await pool.query('SELECT 1'); app.listen(PORT, () => console.log(`FixFlow พร้อมใช้งาน: http://localhost:${PORT}`)) } catch (e) { console.error('เชื่อมต่อ PostgreSQL ไม่สำเร็จ:', e.message); process.exit(1) } })();
