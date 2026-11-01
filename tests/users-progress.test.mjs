import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';

const dir = mkdtempSync(join(tmpdir(), 'omni-progress-'));
process.env.OMNI_DATA_DIR = dir;
process.env.JWT_SECRET = 'test-secret-for-progress-0123456789abcdef';
const { users, campaigns, runs, wallet } = await import('../database/repo.mjs');
const { handleApi } = await import('../api.mjs');

let pass = 0, fail = 0;
const ok = (n, c, x = '') => { if (c) { pass++; console.log(`  PASS  ${n}`); } else { fail++; console.log(`  FAIL  ${n} ${x}`); } };

const aid = Number(users.create({ username: 'ad', passwordHash: 'x', role: 'admin' }).lastInsertRowid);
const u1 = Number(users.create({ username: 'khach1', passwordHash: 'x', displayName: 'Khách Một' }).lastInsertRowid);
const u2 = Number(users.create({ username: 'khach2', passwordHash: 'x' }).lastInsertRowid);
const admin = { id: aid, username: 'ad', role: 'admin' };
const user1 = { id: u1, username: 'khach1', role: 'user' };

const c1 = Number(campaigns.create({ userId: u1, keyword: 'giay the thao', targetUrl: 'https://shop.example/giay', type: 'search_dwell', count: 100, unit: 'day' }).lastInsertRowid);
const c2 = Number(campaigns.create({ userId: u1, keyword: 'may loc nuoc', targetUrl: 'https://shop.example/loc', type: 'direct_visit', count: 10, unit: 'hour' }).lastInsertRowid);
const c3 = Number(campaigns.create({ userId: u2, keyword: 'cua khach hai', targetUrl: 'https://khac.example/', count: 5, unit: 'day' }).lastInsertRowid);
campaigns.setApproval(c1, { status: 'approved', byId: aid }); campaigns.setStatus(c1, 'running', aid);
const nowStr = () => { const d = new Date(), p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`; };
const yesterday = () => { const d = new Date(Date.now() - 86400000), p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} 10:00:00`; };
for (let i = 0; i < 2; i++) runs.record({ campaignId: c1, userId: u1, status: 'ok', at: yesterday(), position: 4, deviceKind: 'desktop', query: 'giay the thao' });
runs.record({ campaignId: c1, userId: u1, status: 'notfound', at: yesterday(), deviceKind: 'mobile', query: 'giay the thao' });
for (let i = 0; i < 3; i++) runs.record({ campaignId: c1, userId: u1, status: 'ok', at: nowStr(), position: 3, deviceKind: 'desktop', query: 'giay the thao' });
runs.record({ campaignId: c3, userId: u2, status: 'ok', at: nowStr(), position: 9, deviceKind: 'desktop', query: 'cua khach hai' });
wallet.credit({ userId: u1, amountVnd: 100000, method: 'manual', note: 'test' });
for (let i = 0; i < 3; i++) wallet.spend({ userId: u1, amountVnd: 1500, campaignId: c1, note: 'lượt' });

async function call(actor, method, path) {
  const req = Object.assign(Readable.from([]), { method, headers: {} });
  let status = 0, out = '';
  const res = { headersSent: false, writeHead(s) { status = s; }, end(b) { out = b || ''; }, setHeader() {} };
  const send = (r, s, b) => { status = s; out = typeof b === 'string' ? b : JSON.stringify(b); return true; };
  const readBody = async () => ({});
  const campaign = { status: () => ({ maxThreads: 3 }), settings: { threads: 3, activeFrom: 0, activeTo: 24, mobilePercent: 30 }, schedule() {}, syncTasks() {}, paceOf: () => null, taskThreads: () => 1, maxThreads: () => 3 };
  try { await handleApi({ req, res, url: new URL('http://x' + path), actor, campaign, send, readBody }); } catch (e) { status = e.status || 500; out = JSON.stringify({ error: e.message }); }
  return { status, text: out, data: out ? JSON.parse(out) : null };
}

let r = await call(user1, 'GET', `/api/users/${u1}/progress`);
ok('người dùng thường KHÔNG xem được tiến độ tài khoản (403), kể cả của chính mình', r.status === 403);
r = await call(admin, 'GET', '/api/users/9999/progress');
ok('tài khoản không tồn tại -> 404', r.status === 404);
r = await call(admin, 'GET', `/api/users/${u1}/progress`);
const d = r.data || {};
ok('admin xem tiến độ khách 1 -> 200', r.status === 200 && d.ok === true);
ok('thông tin tài khoản: tên, tên hiển thị, vai trò, KHÔNG có hash mật khẩu', d.user?.username === 'khach1' && d.user?.displayName === 'Khách Một' && d.user?.role === 'user' && !/password|\$2[aby]\$/i.test(r.text));
ok('số dư và tổng đã chi của tài khoản đúng (100.000 - 3×1.500)', d.user?.balance === 95500 && d.user?.spent === 4500);
ok('chỉ gồm chiến dịch của khách 1 (không lẫn khách 2)', Array.isArray(d.campaigns) && d.campaigns.length === 2 && d.campaigns.every(c => c.userId === u1));
const k1 = (d.campaigns || []).find(c => c.id === c1) || {};
ok('chiến dịch 1: tổng lượt = 6, thành công cộng dồn = 5 (2 hôm qua + 3 hôm nay)', k1.totalAttempts === 6 && k1.totalOk === 5);
ok('chiến dịch 1: hôm nay 3 lượt thành công', k1.today?.ok === 3);
ok('chiến dịch 1: tiền đã trừ = 4.500đ', k1.spent === 4500);
ok('chiến dịch 1: có lượt chạy đầu và gần nhất', !!k1.firstRunAt && !!k1.lastRunAt && k1.firstRunAt <= k1.lastRunAt);
ok('chiến dịch 1: kèm trạng thái duyệt/chạy + chỉ tiêu mỗi ngày', k1.approval === 'approved' && k1.status === 'running' && k1.perDay === 100);
const k2 = (d.campaigns || []).find(c => c.id === c2) || {};
ok('chiến dịch chưa chạy lượt nào: các số cộng dồn = 0, lượt gần nhất = null', k2.totalAttempts === 0 && k2.totalOk === 0 && k2.spent === 0 && k2.lastRunAt === null);
ok('chiến dịch theo giờ: chỉ tiêu mỗi ngày = 24 × lượt/giờ', k2.perDay === 240);
ok('số liệu tổng của tài khoản: hôm nay ok = 3, tổng ok = 5 (không tính khách 2)', d.summary?.todayOk === 3 && d.summary?.totalOk === 5 && d.summary?.totalAttempts === 6);
ok('tài khoản: đang chạy 1, chờ duyệt 1', d.user?.activeCampaigns === 1 && d.user?.pendingCampaigns === 1);
ok('vị trí Google theo thiết bị của chiến dịch (máy tính #3)', k1.ranks?.desktop?.position === 3);
r = await call(admin, 'GET', `/api/users/${u2}/progress`);
ok('khách 2: chỉ thấy chiến dịch của mình + 1 lượt ok', r.data.campaigns.length === 1 && r.data.summary.totalOk === 1 && r.data.user.balance === 0);

console.log(`\nKết quả: ${pass} PASS, ${fail} FAIL`);
process.exit(fail ? 1 : 0);
