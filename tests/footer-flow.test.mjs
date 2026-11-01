import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';

const dir = mkdtempSync(join(tmpdir(), 'omni-footer-'));
process.env.OMNI_DATA_DIR = dir;
process.env.JWT_SECRET = 'test-secret-for-footer-0123456789abcdef';
const repo = await import('../database/repo.mjs');
const { handleApi, __setFooterChecker } = await import('../api.mjs');
const { users, campaigns, notifications } = repo;

let pass = 0, fail = 0;
const ok = (n, c, x = '') => { if (c) { pass++; console.log(`  PASS  ${n}`); } else { fail++; console.log(`  FAIL  ${n} ${x}`); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));

const calls = [];
__setFooterChecker(async url => {
  calls.push(url);
  const at = new Date().toISOString();
  if (/\/\/co-ma\./.test(url)) return { status: 'ok', note: 'Đã thấy mã WingTraffic trong trang.', checkedAt: at };
  if (/loi-mang/.test(url)) return { status: 'error', note: 'Website không phản hồi sau 10 giây.', checkedAt: at };
  return { status: 'missing', note: 'Không thấy mã WingTraffic trong HTML.', checkedAt: at };
});

async function call(actor, method, path, body) {
  const req = Object.assign(Readable.from(body ? [JSON.stringify(body)] : []), { method, headers: {} });
  let status = 0, out = '';
  const res = { headersSent: false, writeHead(s) { status = s; }, end(b) { out = b || ''; }, setHeader() {} };
  const send = (r, s, b) => { status = s; out = typeof b === 'string' ? b : JSON.stringify(b); return true; };
  const readBody = async r => { let d = ''; for await (const c of r) d += c; return d ? JSON.parse(d) : {}; };
  const campaign = { status: () => ({ maxThreads: 3 }), settings: { activeFrom: 0, activeTo: 24, threads: 3, mobilePercent: 30 }, schedule() {}, syncTasks() {}, paceOf: () => null };
  try { await handleApi({ req, res, url: new URL('http://x' + path), actor, campaign, send, readBody }); } catch (e) { status = e.status || 500; out = JSON.stringify({ error: e.message }); }
  let data = null; try { data = out ? JSON.parse(out) : null; } catch { data = null; }
  return { status, data };
}

const aid = Number(users.create({ username: 'ad', passwordHash: 'x', role: 'admin' }).lastInsertRowid);
const u1 = Number(users.create({ username: 'khach1', passwordHash: 'x' }).lastInsertRowid);
const u2 = Number(users.create({ username: 'khach2', passwordHash: 'x' }).lastInsertRowid);
const admin = { id: aid, username: 'ad', role: 'admin' }, user1 = { id: u1, username: 'khach1', role: 'user' }, user2 = { id: u2, username: 'khach2', role: 'user' };
const payload = url => ({ keyword: 'soi keo', targetUrl: url, type: 'search_dwell', count: 10, unit: 'day', queryMode: 'keyword' });
const adminNotifs = () => notifications.list({ role: 'admin', limit: 100 });

console.log('\n== tạo chiến dịch: kiểm tra nền ==');
let r = await call(user1, 'POST', '/api/campaigns', payload('https://chua-cai.example/'));
ok('tạo chiến dịch -> 201', r.status === 201, JSON.stringify(r.data));
const idMissing = r.data.campaign.id;
await sleep(100);
ok('đã tự kiểm tra nền sau khi tạo (ghi vào CSDL: missing)', campaigns.byId(idMissing).footer_check === 'missing' && !!campaigns.byId(idMissing).footer_checked_at);
r = await call(user1, 'GET', '/api/campaigns');
const row = r.data.campaigns.find(c => c.id === idMissing);
ok('danh sách trả footerCheck {status, note, checkedAt}', row.footerCheck.status === 'missing' && /Không thấy/.test(row.footerCheck.note) && !!row.footerCheck.checkedAt);
ok('tạo xong chưa có cảnh báo "chưa cài" nào gửi admin (chỉ cảnh báo khi duyệt)', !adminNotifs().some(n => /chưa cài mã footer/i.test(n.title)));

console.log('\n== duyệt khi KHÁCH CHƯA CÀI MÃ ==');
r = await call(admin, 'POST', `/api/campaigns/${idMissing}/approve`, {});
ok('vẫn duyệt được (không chặn) và chiến dịch chạy', r.status === 200 && campaigns.byId(idMissing).approval_status === 'approved' && campaigns.byId(idMissing).status === 'running');
ok('phản hồi kèm footer.status = missing + ghi chú', r.data.footer && r.data.footer.status === 'missing' && /Không thấy/.test(r.data.footer.note), JSON.stringify(r.data.footer));
let n = adminNotifs().filter(x => /Khách chưa cài mã footer/.test(x.title));
ok('admin có thông báo lưu trong tài khoản: "Khách chưa cài mã footer…" (kèm tên khách + URL)', n.length === 1 && /khach1/.test(n[0].title) && /chua-cai\.example/.test(n[0].body) && n[0].campaign_id === idMissing, JSON.stringify(n));
ok('thông báo gửi cho vai trò admin (không gửi cho khách)', n[0].for_role === 'admin' && n[0].user_id == null);

console.log('\n== duyệt khi ĐÃ cài mã ==');
r = await call(user1, 'POST', '/api/campaigns', payload('https://co-ma.example/'));
const idOk = r.data.campaign.id; await sleep(100);
const before = adminNotifs().length;
r = await call(admin, 'POST', `/api/campaigns/${idOk}/approve`, {});
ok('duyệt -> footer.status = ok', r.status === 200 && r.data.footer.status === 'ok');
ok('đã cài mã: KHÔNG có thông báo cảnh báo mới cho admin', !adminNotifs().slice(0, adminNotifs().length - before).some(x => /⚠/.test(x.title)) && !adminNotifs().some(x => x.campaign_id === idOk && /⚠/.test(x.title)));

console.log('\n== không kiểm tra được website ==');
r = await call(user1, 'POST', '/api/campaigns', payload('https://loi-mang.example/'));
const idErr = r.data.campaign.id; await sleep(100);
r = await call(admin, 'POST', `/api/campaigns/${idErr}/approve`, {});
ok('lỗi mạng: vẫn duyệt + footer.status = error', r.status === 200 && r.data.footer.status === 'error');
ok('admin có thông báo "Chưa kiểm tra được mã footer"', adminNotifs().some(x => x.campaign_id === idErr && /Chưa kiểm tra được mã footer/.test(x.title)));

console.log('\n== dùng lại kết quả mới (không tải website lặp) ==');
r = await call(user1, 'POST', '/api/campaigns', payload('https://dem-so-lan.example/'));
const idCache = r.data.campaign.id; await sleep(100);
const callsBefore = calls.length;
await call(admin, 'POST', `/api/campaigns/${idCache}/approve`, {});
ok('duyệt ngay sau lần kiểm nền (< 2 phút): dùng kết quả cũ, không tải lại', calls.length === callsBefore, `${callsBefore} -> ${calls.length}`);

console.log('\n== kiểm tra lại ==');
r = await call(user1, 'POST', `/api/campaigns/${idMissing}/footer-check`, {});
ok('chủ chiến dịch bấm "Kiểm tra lại" -> 200 + kết quả', r.status === 200 && r.data.footer && r.data.campaign.footerCheck.status === r.data.footer.status);
r = await call(user2, 'POST', `/api/campaigns/${idMissing}/footer-check`, {});
ok('khách KHÁC không kiểm tra được chiến dịch của người khác (403/404)', r.status === 403 || r.status === 404, String(r.status));
r = await call(admin, 'POST', `/api/campaigns/${idMissing}/footer-check`, {});
ok('admin kiểm tra lại được chiến dịch của khách', r.status === 200);
r = await call(admin, 'POST', `/api/campaigns/999999/footer-check`, {});
ok('chiến dịch không tồn tại -> lỗi (không 200)', r.status !== 200, String(r.status));

console.log('\n== sửa URL đích -> kiểm tra lại nền ==');
r = await call(user1, 'POST', '/api/campaigns', payload('https://chua-cai-2.example/'));
const idEdit = r.data.campaign.id; await sleep(100);
const cBefore = calls.length;
r = await call(user1, 'PATCH', `/api/campaigns/${idEdit}`, { targetUrl: 'https://co-ma.example/trang-moi' });
await sleep(150);
ok('đổi URL: gọi kiểm tra lại và kết quả đổi sang ok', r.status === 200 && calls.length === cBefore + 1 && campaigns.byId(idEdit).footer_check === 'ok', `${campaigns.byId(idEdit).footer_check}`);
const cB2 = calls.length;
await call(user1, 'PATCH', `/api/campaigns/${idEdit}`, { count: 20 });
await sleep(100);
ok('sửa trường khác (không đổi URL) -> KHÔNG tải lại website', calls.length === cB2);

console.log('\n== hậu quả khác ==');
ok('ghi kết quả kiểm tra không làm đổi người sửa cuối (updated_by) của chiến dịch', campaigns.byId(idOk).updated_by === aid);
campaigns.setFooterCheck(idOk, { status: null });
ok('setFooterCheck(status null) xoá kết quả (hiện "chưa kiểm tra")', campaigns.byId(idOk).footer_check === null && campaigns.byId(idOk).footer_checked_at === null);

console.log(`\nKết quả: ${pass} PASS, ${fail} FAIL`);
process.exit(fail ? 1 : 0);
