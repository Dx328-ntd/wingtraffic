import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';

const dir = mkdtempSync(join(tmpdir(), 'omni-gate-api-'));
process.env.OMNI_DATA_DIR = dir;
process.env.JWT_SECRET = 'test-secret-for-gate-0123456789abcdef';
const { users, settings } = await import('../database/repo.mjs');
const { handleApi } = await import('../api.mjs');

let pass = 0, fail = 0;
const ok = (n, c, x = '') => { if (c) { pass++; console.log(`  PASS  ${n}`); } else { fail++; console.log(`  FAIL  ${n} ${x}`); } };
const uid = Number(users.create({ username: 'khach', passwordHash: 'x' }).lastInsertRowid);
const aid = Number(users.create({ username: 'ad', passwordHash: 'x', role: 'admin' }).lastInsertRowid);
const user = { id: uid, username: 'khach', role: 'user' }, admin = { id: aid, username: 'ad', role: 'admin' };

async function call(actor, method, path, body) {
  const req = Object.assign(Readable.from(body ? [JSON.stringify(body)] : []), { method, headers: {} });
  let status = 0, out = '';
  const res = { headersSent: false, writeHead(s) { status = s; }, end(b) { out = b || ''; }, setHeader() {} };
  const send = (r, s, b) => { status = s; out = typeof b === 'string' ? b : JSON.stringify(b); return true; };
  const readBody = async r => { let d = ''; for await (const c of r) d += c; return d ? JSON.parse(d) : {}; };
  const campaign = { status: () => ({ maxThreads: 3 }), settings: {}, schedule() {}, syncTasks() {} };
  try { await handleApi({ req, res, url: new URL('http://x' + path), actor, campaign, send, readBody }); } catch (e) { status = e.status || 500; out = JSON.stringify({ error: e.message }); }
  return { status, text: out, data: out ? JSON.parse(out) : null };
}

let r = await call(admin, 'GET', '/api/server/gate');
ok('mặc định: cổng BẬT, chưa có mật khẩu', r.status === 200 && r.data.enabled === true && r.data.hasPassword === false);
r = await call(user, 'GET', '/api/server/gate');
ok('người dùng thường KHÔNG xem được cài đặt cổng (403)', r.status === 403);
r = await call(user, 'POST', '/api/server/gate', { enabled: false, password: 'hack-hack' });
ok('người dùng thường KHÔNG đặt/tắt được cổng (403) và cổng không bị đổi', r.status === 403 && settings.get('gate_enabled') === null && settings.get('gate_password_hash') === null);
r = await call(admin, 'POST', '/api/server/gate', { enabled: true, password: 'abc' });
ok('admin đặt mật khẩu quá ngắn -> 400', r.status === 400);
r = await call(admin, 'POST', '/api/server/gate', { enabled: true, password: 'Matkhau-Tunnel-1' });
ok('admin đặt mật khẩu hợp lệ -> 200, trả về chỉ trạng thái (không trả mật khẩu/hash)', r.status === 200 && r.data.hasPassword === true && !/Matkhau|\$2[aby]\$/.test(r.text));
r = await call(admin, 'GET', '/api/server/gate');
ok('đọc lại: bật + đã có mật khẩu, không lộ mật khẩu/hash', r.data.enabled === true && r.data.hasPassword === true && !/Matkhau|\$2[aby]\$/.test(r.text));
const hash1 = settings.get('gate_password_hash');
r = await call(admin, 'POST', '/api/server/gate', { enabled: false });
ok('admin tắt cổng mà không gửi mật khẩu -> giữ nguyên mật khẩu cũ', r.data.enabled === false && settings.get('gate_password_hash') === hash1);
r = await call(admin, 'POST', '/api/server/gate', { enabled: true, password: 'Matkhau-Tunnel-2' });
ok('đổi mật khẩu -> hash đổi', r.status === 200 && settings.get('gate_password_hash') !== hash1);

console.log(`\nKết quả: ${pass} PASS, ${fail} FAIL`);
process.exit(fail ? 1 : 0);
