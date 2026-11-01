import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';

const dir = mkdtempSync(join(tmpdir(), 'omni-runlog-'));
process.env.OMNI_DATA_DIR = dir;
process.env.JWT_SECRET = 'test-secret-for-runlog-0123456789abcdef';
const { users, campaigns, runs, runExports } = await import('../database/repo.mjs');
const { handleApi } = await import('../api.mjs');

let pass = 0, fail = 0;
const ok = (n, c, x = '') => { if (c) { pass++; console.log(`  PASS  ${n}`); } else { fail++; console.log(`  FAIL  ${n} ${x}`); } };

const aid = Number(users.create({ username: 'ad', passwordHash: 'x', role: 'admin' }).lastInsertRowid);
const u1 = Number(users.create({ username: 'khach1', passwordHash: 'x' }).lastInsertRowid);
const u2 = Number(users.create({ username: 'khach2', passwordHash: 'x' }).lastInsertRowid);
const admin = { id: aid, username: 'ad', role: 'admin' }, user1 = { id: u1, username: 'khach1', role: 'user' }, user2 = { id: u2, username: 'khach2', role: 'user' };
const c1 = Number(campaigns.create({ userId: u1, keyword: 'kèo nhà cái', targetUrl: 'https://x.example/1', count: 10, unit: 'day' }).lastInsertRowid);
const c2 = Number(campaigns.create({ userId: u2, keyword: 'khach hai', targetUrl: 'https://y.example/', count: 5, unit: 'day' }).lastInsertRowid);

const UA_M = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_3 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1';
const UA_D = 'Mozilla/5.0 (Linux; Android 10; K) Chrome/156.0.0.0 Mobile Safari/537.36';
runs.record({ campaignId: c1, userId: u1, status: 'ok', at: '2026-11-01 11:09:00', ip: '171.252.155.33', keyword: 'kèo nhà cái', userAgent: UA_D });
runs.record({ campaignId: c1, userId: u1, status: 'ok', at: '2026-11-01 11:08:00', ip: '2001:ee0:4b77::1', keyword: 'truc tiep keo nha cai', userAgent: UA_M });
runs.record({ campaignId: c1, userId: u1, status: 'ok', at: '2026-10-30 09:00:00', ip: '1.53.114.89', keyword: 'kèo nhà cái' });
runs.record({ campaignId: c1, userId: u1, status: 'notfound', at: '2026-11-01 11:10:00', ip: '9.9.9.9', keyword: 'kèo nhà cái', userAgent: UA_D });
runs.record({ campaignId: c1, userId: u1, status: 'ok', at: '2026-11-01 11:11:00', ip: '8.8.8.8', keyword: 'kèo nhà cái', impression: true });
runs.record({ campaignId: c1, userId: u1, status: 'ok', at: '2026-11-01 12:00:00', ip: '=cmd|x', keyword: '=HYPERLINK("x")', userAgent: UA_D });
runs.record({ campaignId: c2, userId: u2, status: 'ok', at: '2026-11-01 11:00:00', ip: '5.5.5.5', keyword: 'khach hai', userAgent: UA_D });

async function call(actor, method, path) {
  const req = Object.assign(Readable.from([]), { method, headers: {} });
  let status = 0, out = '', headers = {}, buf = null;
  const res = { headersSent: false, writeHead(s, h) { status = s; headers = h || {}; }, end(b) { if (Buffer.isBuffer(b)) buf = b; else out = b || ''; }, setHeader() {} };
  const send = (r, s, b) => { status = s; out = typeof b === 'string' ? b : JSON.stringify(b); return true; };
  const readBody = async () => ({});
  const campaign = { status: () => ({ maxThreads: 3 }), settings: { activeFrom: 0, activeTo: 24, threads: 3, mobilePercent: 30 }, schedule() {}, syncTasks() {}, paceOf: () => null };
  try { await handleApi({ req, res, url: new URL('http://x' + path), actor, campaign, send, readBody }); } catch (e) { status = e.status || 500; out = JSON.stringify({ error: e.message }); }
  let data = null; try { data = out ? JSON.parse(out) : null; } catch { data = null; }
  return { status, headers, buf, text: buf ? buf.toString('utf8') : out, data };
}

console.log('\n== lưu user agent ==');
const row = runs.log({ campaignId: c1 }).rows.find(r => r.ip === '171.252.155.33');
ok('lượt chạy lưu user agent', row?.userAgent === UA_D);
ok('lượt cũ không có UA vẫn đọc được (rỗng)', runs.log({ campaignId: c1 }).rows.find(r => r.ip === '1.53.114.89')?.userAgent === null);

console.log('\n== API: xem log ==');
let r = await call(user1, 'GET', `/api/campaigns/${c1}/log`);
ok('khách xem log chiến dịch của mình (200)', r.status === 200 && r.data.ok === true);
ok('chỉ gồm lượt thành công thật (bỏ notfound và lượt chỉ hiển thị): 4 dòng', r.data.total === 4 && r.data.rows.length === 4, JSON.stringify(r.data.total));
ok('sắp xếp mới nhất trước, STT đánh từ 1', r.data.rows[0].n === 1 && r.data.rows[0].at === '2026-11-01 12:00:00' && r.data.rows[3].at === '2026-10-30 09:00:00');
ok('mỗi dòng có từ khóa, IP, user agent, thời gian', r.data.rows[1].keyword === 'kèo nhà cái' && r.data.rows[1].ip === '171.252.155.33' && r.data.rows[1].userAgent === UA_D);
ok('danh sách từ khóa để chọn lọc', r.data.keywords.includes('kèo nhà cái') && r.data.keywords.includes('truc tiep keo nha cai'));
r = await call(user1, 'GET', `/api/campaigns/${c1}/log?keyword=${encodeURIComponent('truc tiep keo nha cai')}`);
ok('lọc theo từ khóa', r.data.total === 1 && r.data.rows[0].ip === '2001:ee0:4b77::1');
r = await call(user1, 'GET', `/api/campaigns/${c1}/log?from=2026-11-01&to=2026-11-01`);
ok('lọc theo khoảng ngày (gồm cả ngày cuối)', r.data.total === 3 && r.data.rows.every(x => x.at.startsWith('2026-11-01')));
r = await call(user1, 'GET', `/api/campaigns/${c1}/log?from=2026-10-30&to=2026-10-30`);
ok('lọc đúng một ngày cũ', r.data.total === 1 && r.data.rows[0].ip === '1.53.114.89');
r = await call(user1, 'GET', `/api/campaigns/${c1}/log?pageSize=10&page=2`);
ok('phân trang: trang 2 trống khi chỉ có 4 dòng', r.data.rows.length === 0 && r.data.page === 2);
r = await call(user1, 'GET', `/api/campaigns/${c1}/log?from=khong-phai-ngay`);
ok('ngày sai định dạng bị bỏ qua, không lỗi', r.status === 200 && r.data.total === 4);
r = await call(user2, 'GET', `/api/campaigns/${c1}/log`);
ok('khách khác KHÔNG xem được log của người khác (403)', r.status === 403);
r = await call(admin, 'GET', `/api/campaigns/${c1}/log`);
ok('admin xem được', r.status === 200 && r.data.total === 4);
r = await call(user1, 'GET', '/api/campaigns/99999/log');
ok('chiến dịch không tồn tại -> 404', r.status === 404);

console.log('\n== API: tải CSV + lịch sử tải ==');
r = await call(user1, 'GET', `/api/campaigns/${c1}/log.csv?from=2026-11-01&to=2026-11-01`);
ok('tải CSV (200, đúng Content-Type, tên file)', r.status === 200 && /text\/csv/.test(r.headers['Content-Type']) && new RegExp(`filename="WingTraffic-log-chien-dich-${c1}-\\d{4}-\\d{2}-\\d{2}\\.csv"`).test(r.headers['Content-Disposition']));
const lines = r.text.replace(/^﻿/, '').trim().split('\r\n');
ok('CSV có BOM UTF-8 (Excel đọc đúng tiếng Việt) + dòng tiêu đề', r.text.charCodeAt(0) === 0xFEFF && lines[0] === 'STT,Từ khóa,IP,User Agent,Thời gian');
ok('CSV đủ 3 dòng dữ liệu, thời gian dạng HH:MM DD/MM/YYYY', lines.length === 4 && /,11:09 01\/11\/2026$/.test(lines.find(l => l.includes('171.252.155.33'))));
ok('chống chèn công thức Excel (ô bắt đầu bằng = được thêm dấu nháy)', r.text.includes("'=cmd|x") && r.text.includes(`"'=HYPERLINK(""x"")"`));
r = await call(user2, 'GET', `/api/campaigns/${c1}/log.csv`);
ok('khách khác KHÔNG tải được log của người khác (403)', r.status === 403);
r = await call(user1, 'GET', `/api/campaigns/${c1}/log-exports`);
ok('lịch sử tải ghi lại lần tải: người tải, ngày lọc, số dòng', r.status === 200 && r.data.exports.length === 1 && r.data.exports[0].by === 'khach1' && r.data.exports[0].fromDay === '2026-11-01' && r.data.exports[0].rows === 3);
ok('lần tải bị từ chối không bị ghi vào lịch sử', runExports.list(c1).length === 1);
r = await call(user2, 'GET', `/api/campaigns/${c1}/log-exports`);
ok('khách khác KHÔNG xem được lịch sử tải của người khác (403)', r.status === 403);

console.log(`\nKết quả: ${pass} PASS, ${fail} FAIL`);
process.exit(fail ? 1 : 0);
