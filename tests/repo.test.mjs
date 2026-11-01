import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'omni-repo-'));
process.env.OMNI_DATA_DIR = dir;

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name} ${extra}`); }
};

const { db } = await import('../database/init.mjs');
const { users, campaigns, runs, stats, audit, notifications, settings, today } = await import('../database/repo.mjs');

const cols = t => db.prepare(`PRAGMA table_info(${t})`).all().map(c => c.name);
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map(r => r.name);
for (const t of ['users', 'campaigns', 'runs', 'campaign_stats_daily', 'audit_logs', 'notifications', 'settings', 'wallets', 'wallet_txns']) {
  ok(`bảng ${t}`, tables.includes(t));
}
ok('campaigns có cột duyệt + chỉ tiêu', ['approval_status', 'approved_by', 'approved_at', 'reject_reason', 'count', 'unit', 'type', 'priority', 'note'].every(c => cols('campaigns').includes(c)));
ok('users có cột trạng thái + 2 cột cũ giữ lại cho tương thích', ['display_name', 'status', 'max_slots', 'daily_quota', 'last_login_at'].every(c => cols('users').includes(c)));
ok('runs có cột chi tiết lượt chạy', ['keyword', 'target_url', 'position', 'on_site', 'pages', 'attempts', 'captchas', 'proxy', 'ram_peak_mb', 'cpu_avg', 'error', 'device_kind', 'device'].every(c => cols('runs').includes(c)));
ok('có cột kiểu truy vấn (campaigns.query_mode) + truy vấn thật đã gõ (runs.query)',
  cols('campaigns').includes('query_mode') && cols('runs').includes('query'));

const uid = Number(users.create({ username: 'alice', passwordHash: 'x', displayName: 'Alice', dailyQuota: 50 }).lastInsertRowid);
ok('tạo + đọc user', users.byId(uid).username === 'alice' && users.byId(uid).role === 'user');
ok('authRow kèm hash', users.authRow('alice').password_hash === 'x');
ok('update bỏ khoá lạ', users.update(uid, { display_name: 'Alice 2', bogus: 1 }) === 1 && users.byId(uid).display_name === 'Alice 2' && users.byId(uid).bogus === undefined);
users.update(uid, { status: 'locked' });
ok('lọc theo trạng thái', users.list({ status: 'locked' }).length === 1 && users.list({ status: 'active' }).length === 0);
ok('tìm theo tên', users.list({ q: 'ali' }).length === 1);
ok('touchLogin', users.touchLogin(uid) === 1 && !!users.byId(uid).last_login_at);
users.update(uid, { status: 'active' });

const cid = Number(campaigns.create({ userId: uid, name: 'CD 1', keyword: 'mua laptop', targetUrl: 'https://shop.vn/laptop', type: 'search_dwell', count: 20, unit: 'hour', note: 'xin duyệt' }).lastInsertRowid);
const cid2 = Number(campaigns.create({ userId: uid, keyword: 'giá iphone', targetUrl: 'https://shop.vn/iphone', count: 5, unit: 'day' }).lastInsertRowid);
ok('chiến dịch mới = chờ duyệt + idle', campaigns.byId(cid).approval_status === 'pending' && campaigns.byId(cid).status === 'idle');
ok('pendingCount', campaigns.pendingCount() === 2);
ok('pendingCount theo từng tài khoản', campaigns.pendingCount(uid) === 2 && campaigns.pendingCount(9999) === 0);
ok('countByUser', campaigns.countByUser(uid) === 2 && campaigns.countByUser(9999) === 0);
ok('chưa duyệt thì không chạy được', campaigns.runnable().length === 0);
ok('duyệt chiến dịch', campaigns.setApproval(cid, { status: 'approved', byId: uid }) === 1 && campaigns.byId(cid).approved_by === uid && !!campaigns.byId(cid).approved_at);
campaigns.setStatus(cid, 'running', uid);
ok('list kèm chủ sở hữu + lọc trạng thái', campaigns.list({ userId: uid, status: 'running' }).length === 1 && campaigns.list({ userId: uid }).every(c => c.owner === 'alice'));
ok('runnable chỉ gồm chiến dịch đã duyệt & đang bật', campaigns.runnable().length === 1 && campaigns.runnable()[0].id === cid);
ok('từ chối kèm lý do', campaigns.setApproval(cid2, { status: 'rejected', byId: uid, reason: 'URL không hợp lệ' }) === 1 && campaigns.byId(cid2).reject_reason === 'URL không hợp lệ');

const { searchQuery, QUERY_MODE_IDS } = await import('../campaign-types.mjs');
const cidKd = Number(campaigns.create({ userId: uid, keyword: 'soi kèo nhà cái', targetUrl: 'https://brfo.io/', queryMode: 'keyword_domain', count: 3, unit: 'day' }).lastInsertRowid);
ok('lưu kiểu truy vấn khi tạo chiến dịch (mặc định = "keyword")',
  campaigns.byId(cidKd).query_mode === 'keyword_domain' && campaigns.byId(cid).query_mode === 'keyword');
ok('cột lạ không được ghi (query_mode giữ nguyên)',
  campaigns.byId(cidKd).query_mode === 'keyword_domain' && campaigns.update(cidKd, { query_mode_X: 'link' }) === 1);
ok('sửa kiểu truy vấn qua update', campaigns.update(cidKd, { query_mode: 'keyword' }) === 1 && campaigns.byId(cidKd).query_mode === 'keyword');
ok('truy vấn THẬT SỰ gõ lên Google theo kiểu truy vấn',
  searchQuery({ keyword: 'soi kèo nhà cái', targetUrl: 'https://brfo.io/', queryMode: 'keyword_domain' }) === 'soi kèo nhà cái https://brfo.io'
  && searchQuery({ keyword: 'soi kèo nhà cái', targetUrl: 'https://brfo.io/', queryMode: 'keyword' }) === 'soi kèo nhà cái'
  && QUERY_MODE_IDS.join() === 'keyword,keyword_domain');
campaigns.remove(cidKd);
ok('xoá chiến dịch thử kiểu truy vấn', campaigns.byId(cidKd) === null);

const cidThr = Number(campaigns.create({ userId: uid, keyword: 'chay song song', targetUrl: 'https://brfo.io/song-song', count: 50, unit: 'hour', maxThreads: 3 }).lastInsertRowid);
ok('lưu số luồng chạy song song khi tạo chiến dịch', campaigns.byId(cidThr).max_threads === 3);
ok('chiến dịch không khai báo -> mặc định 1 luồng (tuần tự, hành vi cũ)', campaigns.byId(cid).max_threads === 1);
ok('sửa số luồng chạy song song qua update', campaigns.update(cidThr, { max_threads: 4 }) === 1 && campaigns.byId(cidThr).max_threads === 4);
ok('cột lạ không được ghi (max_threads giữ nguyên)',
  campaigns.update(cidThr, { max_threads_X: 9 }) === 1 && campaigns.byId(cidThr).max_threads === 4);
campaigns.remove(cidThr);
ok('xoá chiến dịch thử số luồng', campaigns.byId(cidThr) === null);

const at = `${today()} 09:30:00`;
const base = { campaignId: cid, userId: uid, at, keyword: 'mua laptop', targetUrl: 'https://shop.vn/laptop' };
runs.record({ ...base, status: 'ok', seconds: 42, position: 3, onSite: true, pages: 2, attempts: 1, proxy: 'p1', ramPeakMb: 812.5, cpuAvg: 12.3, deviceKind: 'desktop', device: 'máy tính', query: 'mua laptop shop.vn' });
runs.record({ ...base, status: 'ok', seconds: 30, position: 7, onSite: true, pages: 1, attempts: 1, impression: true, deviceKind: 'mobile', device: 'Android 412x915' });
runs.record({ ...base, status: 'notfound', attempts: 1, deviceKind: 'mobile', device: 'Android 412x915' });
runs.record({ ...base, status: 'captcha', attempts: 1, captchas: 1 });
runs.record({ ...base, status: 'error', error: 'timeout' });
ok('todayCount = 4 lượt tính chỉ tiêu', runs.todayCount(cid) === 4, `= ${runs.todayCount(cid)}`);
ok('todayCountByUser đếm cả lượt lỗi', runs.todayCountByUser(uid) === 5);
ok('recent trả về 5 lượt kèm từ khóa', runs.recent({ campaignId: cid }).length === 5 && runs.recent({ campaignId: cid })[0].campaign_keyword === 'mua laptop');
ok('lượt "chỉ lấy hiển thị" (impression) lưu + đọc lại được — cột runs.impression = 1',
  runs.recent({ campaignId: cid }).filter(r => r.impression === 1).length === 1
  && runs.recent({ campaignId: cid }).find(r => r.impression === 1).status === 'ok');
ok('lượt chạy lưu TRUY VẤN THẬT SỰ gõ lên Google (runs.query) — lượt không ghi thì để trống',
  runs.recent({ campaignId: cid }).some(r => r.query === 'mua laptop shop.vn')
  && runs.recent({ campaignId: cid }).filter(r => !r.query).length === 4);
const ranks = runs.rankByDevice({ campaignId: cid });
ok('xếp hạng theo thiết bị: lấy lượt có vị trí CUỐI của từng thiết bị',
  ranks.length === 2 && ranks.find(r => r.deviceKind === 'desktop')?.position === 3
  && ranks.find(r => r.deviceKind === 'mobile')?.position === 7,
  JSON.stringify(ranks));
ok('xếp hạng bỏ qua lượt không ghi vị trí và lọc được theo tài khoản',
  ranks.every(r => r.keyword === 'mua laptop')
  && runs.rankByDevice({ userId: uid }).length === 2 && runs.rankByDevice({ userId: 999999 }).length === 0);
const d1 = campaigns.detail(cid);
ok('detail kèm số liệu hôm nay', d1.today_attempts === 4 && d1.today_ok === 2 && d1.today_notfound === 1 && d1.today_error === 1 && d1.approver === 'alice');
const daily = stats.daily({ campaignId: cid });
ok('stats.daily gộp theo ngày', daily.length === 1 && daily[0].day === today() && daily[0].attempts === 4 && daily[0].ok === 2);
ok('stats.daily lọc theo khoảng ngày', stats.daily({ campaignId: cid, from: '2000-01-01', to: '2000-01-02' }).length === 0);
const kw = stats.byKeyword({ userId: uid });
ok('stats.byKeyword tách theo từ khóa', kw.length === 1 && kw[0].keyword === 'mua laptop' && kw[0].attempts === 5 && kw[0].ok === 2 && kw[0].error === 1);
const sm = stats.summary({ userId: uid });
ok('stats.summary', sm.total === 5 && sm.todayAttempts === 5 && sm.todayOk === 2 && sm.captcha === 1 && sm.error === 1, JSON.stringify(sm));

audit.add({ actorId: uid, actorRole: 'admin', action: 'approve', entity: 'campaign', entityId: cid, before: { approval_status: 'pending' }, after: { approval_status: 'approved' } });
const logs = audit.list({ entity: 'campaign', entityId: cid });
ok('audit ghi + đọc được ảnh chụp before/after', logs.length === 1 && logs[0].actor === 'alice' && JSON.parse(logs[0].after_json).approval_status === 'approved');
notifications.add({ userId: uid, campaignId: cid, title: 'Chiến dịch đã được duyệt' });
notifications.add({ forRole: 'admin', campaignId: cid2, title: 'Có chiến dịch chờ duyệt' });
ok('thông báo theo người nhận', notifications.list({ userId: uid }).length === 1 && notifications.list({ role: 'admin' }).length === 1);
ok('unreadCount', notifications.unreadCount({ userId: uid }) === 1);
notifications.markAllRead({ userId: uid });
ok('markAllRead', notifications.unreadCount({ userId: uid }) === 0);
settings.set('daily_slots', 5, uid);
settings.set('daily_slots', 7, uid);
ok('settings ghi đè theo khoá', settings.get('daily_slots') === '7' && settings.all().daily_slots === '7');

users.update(uid, { status: 'locked' });
ok('khoá tài khoản -> không chạy chiến dịch', campaigns.runnable().length === 0);
users.update(uid, { status: 'active' });
campaigns.setStatus(cid, 'stopped');
ok('activeCount', campaigns.activeCount(uid) === 0);
campaigns.setStatus(cid, 'running');
ok('activeCount sau khi bật lại', campaigns.activeCount(uid) === 1);
campaigns.remove(cid2);
ok('xoá chiến dịch', campaigns.byId(cid2) === null);
campaigns.remove(cid);
ok('xoá chiến dịch -> dọn runs + thống kê theo (cascade)', runs.recent({ userId: uid }).length === 0 && stats.daily({ campaignId: cid }).length === 0);
users.remove(uid);
ok('xoá tài khoản', users.byId(uid) === null);

{
  const { ranks, nextRankAt, RANK_MIN_MINUTES, RANK_MAX_MINUTES } = await import('../database/repo.mjs');
  const ruid = Number(users.create({ username: 'rank-user', passwordHash: 'x' }).lastInsertRowid);
  const rc = Number(campaigns.create({ userId: ruid, keyword: 'vi tri', targetUrl: 'https://rank.vn/', count: 5, unit: 'day' }).lastInsertRowid);
  const rec = (at, status, position, deviceKind, query = 'vi tri') => runs.record({ campaignId: rc, userId: ruid, status, at, position, deviceKind, query });
  const get = kind => ranks.list({ campaignId: rc }).find(r => r.deviceKind === kind);
  const mins = (a, b) => Math.round((new Date(b.replace(' ', 'T')) - new Date(a.replace(' ', 'T'))) / 60000);

  ok('mốc kế tiếp nằm trong 15–45 phút sau lần cập nhật (rand=0 -> 15, rand≈1 -> 45)',
    mins('2026-10-10 10:00:00', nextRankAt('2026-10-10 10:00:00', () => 0)) === RANK_MIN_MINUTES
    && mins('2026-10-10 10:00:00', nextRankAt('2026-10-10 10:00:00', () => 0.999999)) === RANK_MAX_MINUTES
    && RANK_MIN_MINUTES === 15 && RANK_MAX_MINUTES === 45);
  rec('2026-10-10 10:00:00', 'ok', 3, 'desktop');
  ok('lượt tìm Google đầu tiên -> ghi ngay vị trí máy tính + mốc kế tiếp 15–45 phút sau',
    get('desktop') && get('desktop').position === 3 && get('desktop').at === '2026-10-10 10:00:00'
    && mins('2026-10-10 10:00:00', get('desktop').nextAt) >= 15 && mins('2026-10-10 10:00:00', get('desktop').nextAt) <= 45);
  ok('điện thoại có dòng riêng: chưa có lượt di động thì chưa có vị trí', get('mobile') === undefined);
  rec('2026-10-10 10:10:00', 'ok', 9, 'desktop');
  ok('lượt chạy TRƯỚC mốc 15 phút không đổi vị trí hiển thị', get('desktop').position === 3 && get('desktop').at === '2026-10-10 10:00:00');
  rec('2026-10-10 10:05:00', 'ok', 8, 'mobile');
  ok('thiết bị di động có lịch riêng, không bị lịch máy tính chặn', get('mobile').position === 8);
  rec('2026-10-10 11:00:00', 'ok', 2, 'desktop');
  ok('lượt chạy SAU mốc -> cập nhật vị trí + giờ + mốc mới', get('desktop').position === 2 && get('desktop').at === '2026-10-10 11:00:00' && get('desktop').nextAt > '2026-10-10 11:14:59');
  rec('2026-10-10 12:00:00', 'notfound', null, 'desktop');
  ok('đến lịch mà không tìm thấy URL -> vị trí NULL (giao diện hiện "-") nhưng vẫn có giờ cập nhật', get('desktop').position === null && get('desktop').at === '2026-10-10 12:00:00');
  rec('2026-10-10 14:00:00', 'captcha', null, 'desktop');
  rec('2026-10-10 14:00:00', 'error', null, 'desktop');
  ok('lượt captcha / lỗi không đụng tới vị trí', get('desktop').at === '2026-10-10 12:00:00');
  runs.record({ campaignId: rc, userId: ruid, status: 'ok', at: '2026-10-10 16:00:00', deviceKind: 'desktop', query: null });
  ok('lượt vào thẳng URL (không có truy vấn Google) không tính vào vị trí', get('desktop').at === '2026-10-10 12:00:00');
  ok('lọc theo tài khoản', ranks.list({ userId: ruid }).length === 2 && ranks.list({ userId: 999999 }).length === 0);
  campaigns.remove(rc);
  ok('xoá chiến dịch -> xoá luôn vị trí đã lưu (cascade)', ranks.list({ campaignId: rc }).length === 0);
  users.remove(ruid);
}

db.close();
rmSync(dir, { recursive: true, force: true });
console.log(`\nKết quả: ${pass} PASS, ${fail} FAIL`);
process.exit(fail ? 1 : 0);
