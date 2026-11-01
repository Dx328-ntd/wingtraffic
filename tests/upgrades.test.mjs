import { mkdtempSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';

const dir = mkdtempSync(join(tmpdir(), 'omni-upg-'));
process.env.OMNI_DATA_DIR = dir;
process.env.JWT_SECRET = 'test-secret-for-upgrades-0123456789abcdef';
const auth = await import('../auth/auth.mjs');
const { db } = await import('../database/init.mjs');
const { users, campaigns, wallet, notifications } = await import('../database/repo.mjs');
const { handleApi } = await import('../api.mjs');
const backup = await import('../backup.mjs');
const { Campaign } = await import('../campaign.mjs');

let pass = 0, fail = 0;
const ok = (n, c, x = '') => { if (c) { pass++; console.log(`  PASS  ${n}`); } else { fail++; console.log(`  FAIL  ${n} ${x}`); } };

const hash = await auth.hashPassword('MatKhauCu1');
const aid = Number(users.create({ username: 'ad', passwordHash: hash, role: 'admin' }).lastInsertRowid);
const u1 = Number(users.create({ username: 'khach1', passwordHash: hash, displayName: 'Tên Cũ' }).lastInsertRowid);
const u2 = Number(users.create({ username: 'khach2', passwordHash: hash }).lastInsertRowid);
const admin = { id: aid, username: 'ad', role: 'admin' }, user1 = { id: u1, username: 'khach1', role: 'user' }, user2 = { id: u2, username: 'khach2', role: 'user' };

async function call(actor, method, path, body) {
  const req = Object.assign(Readable.from(body ? [JSON.stringify(body)] : []), { method, headers: {} });
  let status = 0, out = '', headers = {}, buf = null; const setH = {};
  const res = { headersSent: false, writeHead(s, h) { status = s; headers = h || {}; }, end(b) { if (Buffer.isBuffer(b)) buf = b; else out = b || ''; }, setHeader(k, v) { setH[k] = v; } };
  const send = (r, s, b) => { status = s; out = typeof b === 'string' ? b : JSON.stringify(b); return true; };
  const readBody = async r => { let d = ''; for await (const c of r) d += c; return d ? JSON.parse(d) : {}; };
  const campaign = { status: () => ({ maxThreads: 3 }), settings: { activeFrom: 0, activeTo: 24, threads: 3, mobilePercent: 30 }, schedule() {}, syncTasks() {}, paceOf: () => null };
  try { await handleApi({ req, res, url: new URL('http://x' + path), actor, campaign, send, readBody }); } catch (e) { status = e.status || 500; out = JSON.stringify({ error: e.message }); }
  let data = null; try { data = out ? JSON.parse(out) : null; } catch { data = null; }
  return { status, headers, buf, text: out, data, setCookie: setH['Set-Cookie'] || '' };
}

console.log('\n== tài khoản: tên hiển thị + đổi mật khẩu ==');
let r = await call(user1, 'POST', '/api/account/profile', { displayName: '  Tên Mới  ' });
ok('khách tự đổi tên hiển thị', r.status === 200 && users.byId(u1).display_name === 'Tên Mới');
r = await call(user1, 'POST', '/api/account/profile', { displayName: '' });
ok('xoá tên hiển thị (để trống) được', r.status === 200 && users.byId(u1).display_name === null);
r = await call(user1, 'POST', '/api/account/password', { current: 'MatKhauCu1', password: 'abc' });
ok('mật khẩu mới < 8 ký tự bị từ chối (400)', r.status === 400);
r = await call(user1, 'POST', '/api/account/password', { current: 'MatKhauCu1', password: 'MatKhauCu1' });
ok('mật khẩu mới trùng mật khẩu cũ bị từ chối (400)', r.status === 400);
r = await call(user1, 'POST', '/api/account/password', { current: 'MatKhauCu1', password: 'MatKhauMoi99', passwordConfirm: 'khac-nhau-1' });
ok('nhập lại không khớp bị từ chối (400), mật khẩu chưa đổi', r.status === 400 && await auth.verifyPassword('MatKhauCu1', users.authRow('khach1').password_hash));
r = await call(user1, 'POST', '/api/account/password', { current: 'sai-mat-khau', password: 'MatKhauMoi99' });
ok('sai mật khẩu hiện tại bị từ chối (400), mật khẩu chưa đổi', r.status === 400 && await auth.verifyPassword('MatKhauCu1', users.authRow('khach1').password_hash));
r = await call(user1, 'POST', '/api/account/password', { current: 'MatKhauCu1', password: 'MatKhauMoi99', passwordConfirm: 'MatKhauMoi99' });
ok('đổi mật khẩu đúng -> 200; mật khẩu mới dùng được, cũ hết dùng', r.status === 200 && await auth.verifyPassword('MatKhauMoi99', users.authRow('khach1').password_hash) && !(await auth.verifyPassword('MatKhauCu1', users.authRow('khach1').password_hash)));
const pwRow = db.prepare('SELECT pw_changed_at FROM users WHERE id = ?').get(u1);
ok('đổi mật khẩu ghi mốc thu hồi phiên cũ (pw_changed_at) và cấp lại cookie đăng nhập cho phiên hiện tại', pwRow.pw_changed_at > Date.now() - 60000 && /^omni_token=[^;]+; HttpOnly; Path=\/; SameSite=Lax/.test(r.setCookie));
{
  const t0 = pwRow.pw_changed_at, secs = Math.floor(t0 / 1000);
  ok('token phát hành TRƯỚC lần đổi mật khẩu bị coi là hết hiệu lực (đăng xuất thiết bị khác)', auth.tokenIsStale(secs - 5, t0) === true && auth.tokenIsStale(secs - 1, t0) === true);
  ok('token cấp cùng giây / sau lần đổi vẫn hợp lệ (phiên mới không bị loại oan)', auth.tokenIsStale(secs, t0) === false && auth.tokenIsStale(secs + 10, t0) === false);
  ok('tài khoản chưa từng đổi mật khẩu: không token nào bị coi là cũ', auth.tokenIsStale(1, null) === false && auth.tokenIsStale(1, 0) === false);
  const fresh = r.setCookie.split(';')[0].split('=')[1];
  ok('cookie mới cấp xác thực được và KHÔNG bị coi là cũ', auth.verifyToken(fresh).id === String(u1) && auth.tokenIsStale(auth.verifyToken(fresh).iat, t0) === false);
}
ok('đổi mật khẩu xong có thông báo cho chính chủ', notifications.list({ userId: u1, limit: 20 }).some(n => /Mật khẩu của bạn vừa được đổi/.test(n.title)));
ok('mật khẩu của khách 2 không bị ảnh hưởng', await auth.verifyPassword('MatKhauCu1', users.authRow('khach2').password_hash));
let last;
for (let i = 0; i < 7; i++) last = await call(user2, 'POST', '/api/account/password', { current: 'doan-sai-' + i, password: 'MatKhauMoi99' });
ok('đoán mật khẩu hiện tại nhiều lần sai bị khoá tạm (429)', last.status === 429);
r = await call(user2, 'POST', '/api/account/password', { current: 'MatKhauCu1', password: 'MatKhauMoi99' });
ok('đang bị khoá thì dù nhập đúng cũng chờ (429)', r.status === 429);
ok('phản hồi không bao giờ chứa mật khẩu/hash', !/\$2[aby]\$|MatKhau/.test(r.text) && !/\$2[aby]\$/.test(JSON.stringify((await call(user1, 'POST', '/api/account/profile', { displayName: 'x' })).data)));

r = await call(admin, 'PATCH', `/api/users/${u2}`, { password: 'MatKhauAdminDat1' });
ok('admin đặt lại mật khẩu cho khách -> thu hồi phiên cũ của khách đó (pw_changed_at)', r.status === 200 && db.prepare('SELECT pw_changed_at FROM users WHERE id = ?').get(u2).pw_changed_at > 0);

console.log('\n== doanh thu cho admin ==');
wallet.credit({ userId: u1, amountVnd: 200000, method: 'manual', note: 'nạp thử' });
wallet.credit({ userId: u2, amountVnd: 100000, method: 'manual', note: 'nạp thử' });
const c1 = Number(campaigns.create({ userId: u1, keyword: 'a', targetUrl: 'https://a.example/', count: 5, unit: 'day' }).lastInsertRowid);
const c2 = Number(campaigns.create({ userId: u2, keyword: 'b', targetUrl: 'https://b.example/', count: 5, unit: 'day' }).lastInsertRowid);
for (let i = 0; i < 4; i++) wallet.spend({ userId: u1, amountVnd: 1500, campaignId: c1, note: 'lượt' });
for (let i = 0; i < 2; i++) wallet.spend({ userId: u2, amountVnd: 1000, campaignId: c2, note: 'lượt' });
r = await call(user1, 'GET', '/api/stats/revenue');
ok('khách KHÔNG xem được doanh thu (403)', r.status === 403);
r = await call(admin, 'GET', '/api/stats/revenue');
const rv = r.data || {};
ok('admin xem doanh thu: hôm nay = 4×1.500 + 2×1.000 = 8.000đ (6 lượt)', r.status === 200 && rv.spent?.today.amount === 8000 && rv.spent?.today.count === 6);
ok('7 ngày / tháng này / tổng đều ≥ hôm nay và khớp (8.000đ)', rv.spent.last7.amount === 8000 && rv.spent.month.amount === 8000 && rv.spent.total.amount === 8000);
ok('tiền nạp: 300.000đ (2 lần)', rv.topup?.today.amount === 300000 && rv.topup?.total.count === 2);
ok('doanh thu theo ngày có ngày hôm nay', Array.isArray(rv.byDay) && rv.byDay.length === 1 && rv.byDay[0].spent === 8000);
ok('top khách xếp theo tiền chạy: khach1 (6.000) trước khach2 (2.000)', rv.top?.length === 2 && rv.top[0].username === 'khach1' && rv.top[0].spent === 6000 && rv.top[1].username === 'khach2');

console.log('\n== sao lưu CSDL ==');
const b1 = await backup.createBackup('tay');
ok('tạo bản sao lưu thủ công (tên đúng mẫu, có dữ liệu)', /^omni-tay-\d{8}-\d{6}\.db$/.test(b1.name) && b1.size > 0 && existsSync(join(backup.BACKUP_DIR, b1.name)));
ok('bản sao lưu là SQLite hợp lệ (đầu file "SQLite format 3")', readFileSync(join(backup.BACKUP_DIR, b1.name)).slice(0, 15).toString() === 'SQLite format 3');
const { default: Database } = await import('better-sqlite3');
const copy = new Database(join(backup.BACKUP_DIR, b1.name), { readonly: true });
ok('mở bản sao lưu đọc được dữ liệu (3 tài khoản, đúng tên)', copy.prepare('SELECT COUNT(*) AS n FROM users').get().n === 3 && copy.prepare("SELECT username FROM users WHERE id = ?").get(u1).username === 'khach1');
copy.close();
ok('danh sách sao lưu có bản vừa tạo', backup.listBackups().some(b => b.name === b1.name && b.kind === 'tay'));
ok('chặn tên file lạ / thoát thư mục (../, đường dẫn, sai mẫu)', backup.backupFile('../omni.db') === null && backup.backupFile('omni-tay-1.db') === null && backup.backupFile('omni-auto-20260101-000000.db') === null && backup.backupFile(b1.name) !== null);
for (let i = 1; i <= 10; i++) writeFileSync(join(backup.BACKUP_DIR, `omni-auto-2026010${i % 10}-0${i}0000.db`.replace('-0100000', '-100000')), 'x');
for (let i = 1; i <= 5; i++) writeFileSync(join(backup.BACKUP_DIR, `omni-tay-2026020${i}-120000.db`), 'x');
backup.pruneBackups();
const after = backup.listBackups();
ok(`giữ tối đa ${backup.KEEP_AUTO} bản tự động và ${backup.KEEP_MANUAL} bản thủ công mới nhất`, after.filter(b => b.kind === 'auto').length <= backup.KEEP_AUTO && after.filter(b => b.kind === 'tay').length === backup.KEEP_MANUAL, JSON.stringify(after.map(b => b.name)));
r = await call(user1, 'GET', '/api/server/backups');
ok('khách KHÔNG xem/tải được sao lưu (403)', r.status === 403 && (await call(user1, 'GET', '/api/server/backup')).status === 403);
r = await call(admin, 'GET', '/api/server/backups');
ok('admin xem được danh sách sao lưu', r.status === 200 && Array.isArray(r.data.backups) && r.data.backups.length >= 1);
r = await call(admin, 'GET', '/api/server/backup');
ok('admin tải bản sao lưu mới: 200 + file SQLite + tên file đúng', r.status === 200 && Buffer.isBuffer(r.buf) && r.buf.slice(0, 15).toString() === 'SQLite format 3' && /filename="omni-tay-\d{8}-\d{6}\.db"/.test(r.headers['Content-Disposition']));
r = await call(admin, 'GET', '/api/server/backup?name=../../etc/passwd');
ok('tải tên file lạ bị từ chối (404)', r.status === 404);

console.log('\n== cảnh báo sắp hết số dư ==');
const uLow = Number(users.create({ username: 'sapHet', passwordHash: hash }).lastInsertRowid);
wallet.credit({ userId: uLow, amountVnd: 153000, method: 'manual', note: 'nạp ít' });
const cLow = Number(campaigns.create({ userId: uLow, keyword: 'c', targetUrl: 'https://c.example/', count: 5, unit: 'day' }).lastInsertRowid);
const engine = new Campaign({ profiles: {}, open: async () => { throw new Error('không mở trình duyệt'); } }, dir);
await engine.load();
const task = { dbId: cLow, userId: uLow, type: 'search_dwell', keyword: 'c' };
const res1 = { status: 'ok', result: { landed: { url: 'x' } } };
const lowCount = () => notifications.list({ userId: uLow, limit: 50 }).filter(n => n.title === 'Số dư sắp hết').length;
engine.chargeVisit(task, res1);
engine.chargeVisit(task, res1);
ok('số dư còn ≥ ngưỡng (150.000đ): chưa báo', lowCount() === 0 && wallet.balanceOf(uLow) === 150000, `(số dư ${wallet.balanceOf(uLow)}, số báo ${lowCount()})`);
engine.chargeVisit(task, res1);
ok('số dư xuống dưới ngưỡng: báo cho khách 1 lần (kèm số dư + số lượt còn)', lowCount() === 1 && /148\.500đ/.test(notifications.list({ userId: uLow, limit: 50 }).find(n => n.title === 'Số dư sắp hết').body) && /99 lượt/.test(notifications.list({ userId: uLow, limit: 50 }).find(n => n.title === 'Số dư sắp hết').body));
engine.chargeVisit(task, res1); engine.chargeVisit(task, res1);
ok('những lượt sau trong ngày KHÔNG báo lại (tránh làm phiền)', lowCount() === 1);
ok('khách có số dư lớn không bị báo', notifications.list({ userId: u1, limit: 50 }).filter(n => n.title === 'Số dư sắp hết').length === 0);

console.log(`\nKết quả: ${pass} PASS, ${fail} FAIL`);
process.exit(fail ? 1 : 0);
