CREATE TABLE IF NOT EXISTS roles (
 id SERIAL PRIMARY KEY, name VARCHAR(50) UNIQUE NOT NULL, description TEXT NOT NULL DEFAULT '',
 is_system BOOLEAN NOT NULL DEFAULT FALSE, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS permissions (
 id SERIAL PRIMARY KEY, code VARCHAR(100) UNIQUE NOT NULL, name VARCHAR(120) NOT NULL,
 description TEXT NOT NULL DEFAULT '', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS role_permissions (
 role_id INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
 permission_id INTEGER NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
 PRIMARY KEY(role_id, permission_id)
);
CREATE TABLE IF NOT EXISTS users (
 id SERIAL PRIMARY KEY, username VARCHAR(60) UNIQUE NOT NULL, full_name VARCHAR(120) NOT NULL,
 password_hash TEXT NOT NULL, role_id INTEGER NOT NULL REFERENCES roles(id),
 is_active BOOLEAN NOT NULL DEFAULT TRUE, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS repair_requests (
 id SERIAL PRIMARY KEY, request_no VARCHAR(30) UNIQUE NOT NULL, title VARCHAR(160) NOT NULL,
 description TEXT NOT NULL, location VARCHAR(160) NOT NULL, priority VARCHAR(20) NOT NULL DEFAULT 'ปกติ'
 CHECK(priority IN ('ต่ำ','ปกติ','สูง','เร่งด่วน')),
 status VARCHAR(30) NOT NULL DEFAULT 'รอพิจารณา'
 CHECK(status IN ('รอพิจารณา','อนุมัติแล้ว','ไม่อนุมัติ','กำลังซ่อม','รอตรวจรับ','เสร็จสิ้น')),
 requester_id INTEGER NOT NULL REFERENCES users(id), technician_id INTEGER REFERENCES users(id),
 manager_note TEXT NOT NULL DEFAULT '', resolution_note TEXT NOT NULL DEFAULT '',
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS uploaded_files (
 id SERIAL PRIMARY KEY, request_id INTEGER NOT NULL REFERENCES repair_requests(id) ON DELETE CASCADE,
 original_name TEXT NOT NULL, stored_name TEXT NOT NULL UNIQUE, mime_type VARCHAR(120) NOT NULL,
 size_bytes BIGINT NOT NULL, uploaded_by INTEGER NOT NULL REFERENCES users(id),
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS audit_logs (
 id BIGSERIAL PRIMARY KEY, user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
 username VARCHAR(60), event_type VARCHAR(100) NOT NULL, resource VARCHAR(120) NOT NULL,
 resource_id VARCHAR(100), result VARCHAR(20) NOT NULL CHECK(result IN ('SUCCESS','DENIED','FAILURE')),
 details TEXT NOT NULL DEFAULT '', ip_address VARCHAR(80), created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_logs_created ON audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_requests_status ON repair_requests(status);
CREATE INDEX IF NOT EXISTS idx_requests_requester ON repair_requests(requester_id);
