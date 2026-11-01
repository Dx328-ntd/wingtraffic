const [, , portArg, username = 'admin', password = ''] = process.argv;
const base = `http://localhost:${portArg || 3300}`;
const TS = Date.now();
let cookie = '';
let userCookie = '';
let pass = 0;
let fail = 0;
const created = { campaigns: [], users: [] };

async function call(method, path, body, { as = 'admin', raw = false } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const c = as === 'user' ? userCookie : cookie;
  if (c) headers.Cookie = c;
  const res = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual' });
  const set = res.headers.get('set-cookie');
  if (set) {
    const jar = set.split(';')[0];
    if (as === 'user') userCookie = jar; else cookie = jar;
  }
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  return { status: res.status, data, text: raw ? text : text.slice(0, 200) };
}

function check(label, got, want) {
  const ok = String(got) === String(want);
  if (ok) pass++; else fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}  ->  ${got}${ok ? '' : `  (mong đợi ${want})`}`);
}

const tomorrow = () => {
  const d = new Date(Date.now() + 86400000).toLocaleDateString('sv-SE');
  return `${d} 00:00:00`;
};

let r = await call('POST', '/api/login', { username, password });
check('POST /api/login (admin)', r.status, 200);
if (r.status !== 200) {
  console.log('Không đăng nhập được — dừng kiểm tra.');
  process.exit(1);
}

r = await call('GET', '/api/meta');
check('GET /api/meta', r.status, 200);
check('   có 5 loại chiến dịch', r.data.types.length, 5);
check('   engine dùng CSDL', r.data.engine.dbMode, true);
check('   có 2 kiểu truy vấn gõ lên Google (Chỉ từ khóa / Từ khóa + tên miền)', r.data.queryModes?.length, 2);
check('   kiểu truy vấn mặc định là "keyword"', r.data.queryModes?.[0]?.id, 'keyword');
check('   có trần "Số luồng tối đa cho 1 chiến dịch" (mục 10.17 HDSD)', r.data.maxThreadsPerCampaign, 30);

r = await call('GET', '/api/badges');
check('GET /api/badges', r.status, 200);

r = await call('POST', '/api/campaigns', { keyword: '', targetUrl: 'https://example.org', count: 5, unit: 'day', type: 'search_dwell' });
check('POST /api/campaigns (thiếu từ khóa)', r.status, 400);
r = await call('POST', '/api/campaigns', { keyword: 'abc', targetUrl: 'https://example.org', count: 5, unit: 'day', type: 'khong-co' });
check('POST /api/campaigns (loại sai)', r.status, 400);
r = await call('POST', '/api/campaigns', { keyword: 'abc', targetUrl: 'khong-phai-url', count: 5, unit: 'day', type: 'search_dwell' });
check('POST /api/campaigns (URL sai)', r.status, 400);
r = await call('POST', '/api/campaigns', { keyword: 'abc', targetUrl: 'https://example.org', count: 0, unit: 'day', type: 'search_dwell' });
check('POST /api/campaigns (chỉ tiêu 0)', r.status, 400);
r = await call('POST', '/api/campaigns', { keyword: 'abc', targetUrl: 'https://example.org', count: 5, unit: 'tuan', type: 'search_dwell' });
check('POST /api/campaigns (đơn vị sai)', r.status, 400);
r = await call('POST', '/api/campaigns', { keyword: 'abc', targetUrl: 'https://example.org', count: 5, unit: 'day', type: 'search_dwell', maxThreads: 0 });
check('POST /api/campaigns (số luồng chạy song song = 0)', r.status, 400);
r = await call('POST', '/api/campaigns', { keyword: 'abc', targetUrl: 'https://example.org', count: 5, unit: 'day', type: 'search_dwell', maxThreads: 31 });
check('POST /api/campaigns (số luồng chạy song song > 30)', r.status, 400);

r = await call('POST', '/api/campaigns', {
  name: 'Kiểm tra API', keyword: `___test_api_${TS}`, targetUrl: 'https://example.org/kiem-tra',
  type: 'search_click', count: 6, unit: 'day', note: 'chiến dịch thử của bộ kiểm tra', startAt: tomorrow(), maxThreads: 3,
});
check('POST /api/campaigns (hợp lệ)', r.status, 201);
const cid = r.data?.campaign?.id;
created.campaigns.push(cid);
check('   trạng thái duyệt mặc định', r.data?.campaign?.approval, 'pending');
check('   lưu số luồng chạy song song (mục 10.17 HDSD)', r.data?.campaign?.maxThreads, 3);
check('   loại chiến dịch', r.data?.campaign?.type, 'search_click');

r = await call('GET', '/api/campaigns?q=___test_api_' + TS);
check('GET /api/campaigns (lọc theo từ khóa)', r.status, 200);
check('   tìm thấy chiến dịch vừa tạo', r.data.campaigns.some(c => c.id === cid), true);
check('   chủ sở hữu là admin', r.data.campaigns[0].owner, username);

r = await call('GET', `/api/campaigns/${cid}`);
check('GET /api/campaigns/:id', r.status, 200);
check('   có thống kê ngày', Array.isArray(r.data.daily), true);
check('   có thống kê từ khóa', Array.isArray(r.data.keywords), true);

r = await call('POST', `/api/campaigns/${cid}/status`, { status: 'running' });
check('POST .../status khi chưa duyệt -> 400', r.status, 400);

r = await call('POST', `/api/campaigns/${cid}/approve`, {});
check('POST .../approve', r.status, 200);
check('   đã duyệt', r.data.campaign.approval, 'approved');
check('   chuyển sang đang chạy', r.data.campaign.status, 'running');

r = await call('POST', `/api/campaigns/${cid}/approve`, {});
check('POST .../approve lần hai -> 400', r.status, 400);

r = await call('PATCH', `/api/campaigns/${cid}`, { count: 9, unit: 'hour', priority: 7 });
check('PATCH /api/campaigns/:id', r.status, 200);
check('   chỉ tiêu mới', r.data.campaign.count, 9);
check('   đơn vị mới', r.data.campaign.unit, 'hour');
check('   giữ nguyên số luồng chạy song song khi không gửi trường này', r.data.campaign.maxThreads, 3);

r = await call('PATCH', `/api/campaigns/${cid}`, { maxThreads: 5 });
check('PATCH số luồng chạy song song (mục 10.17 HDSD)', r.data?.campaign?.maxThreads, 5);
r = await call('PATCH', `/api/campaigns/${cid}`, { maxThreads: 99 });
check('PATCH số luồng chạy song song vượt trần -> 400', r.status, 400);
r = await call('GET', `/api/campaigns/${cid}`);
check('   giá trị lưu trong CSDL đọc lại đúng', r.data?.campaign?.maxThreads, 5);

r = await call('POST', `/api/campaigns/${cid}/status`, { status: 'paused' });
check('POST .../status = paused', r.data?.campaign?.status, 'paused');
r = await call('POST', `/api/campaigns/${cid}/status`, { status: 'khong-co' });
check('POST .../status sai -> 400', r.status, 400);

r = await call('POST', `/api/campaigns/${cid}/reject`, { reason: 'Thử từ chối' });
check('POST .../reject', r.status, 200);
check('   đã từ chối', r.data.campaign.approval, 'rejected');
check('   có lý do', r.data.campaign.rejectReason, 'Thử từ chối');

r = await call('POST', `/api/campaigns/${cid}/approve`, {});
check('   duyệt lại sau khi bị từ chối', r.data?.campaign?.approval, 'approved');

r = await call('POST', '/api/campaigns', {
  keyword: `___test_kw_${TS} https://example.org/kw`, targetUrl: '', type: 'search_only', count: 2, unit: 'day', startAt: tomorrow(),
});
check('POST /api/campaigns (từ khóa dán lẫn URL, ô URL để trống)', r.status, 201);
check('   tự tách URL ra khỏi từ khóa', r.data?.campaign?.keyword, `___test_kw_${TS}`);
check('   và lấy URL đó làm URL đích', r.data?.campaign?.targetUrl, 'https://example.org/kw');
created.campaigns.push(r.data?.campaign?.id);

r = await call('POST', '/api/campaigns', {
  keyword: `___test_kw2_${TS} https://example.org/x`, targetUrl: 'https://example.org/khac', type: 'search_only', count: 2, unit: 'day', startAt: tomorrow(),
});
check('   đã có URL đích riêng thì giữ nguyên, chỉ bỏ URL khỏi từ khóa',
  `${r.data?.campaign?.keyword} → ${r.data?.campaign?.targetUrl}`, `___test_kw2_${TS} → https://example.org/khac`);
created.campaigns.push(r.data?.campaign?.id);

r = await call('POST', '/api/campaigns', { keyword: 'https://example.org/chi-co-url', targetUrl: '', type: 'search_only', count: 2, unit: 'day' });
check('   ô từ khóa CHỈ có URL -> 400', r.status, 400);
check('   báo lỗi nói rõ phải nhập từ khóa', /Từ khóa/.test(r.data?.error || ''), true);

r = await call('POST', '/api/campaigns', {
  keyword: `___test_kd_${TS}`, targetUrl: 'https://brfo.io/', type: 'search_only', count: 2, unit: 'day', startAt: tomorrow(),
  queryMode: 'keyword_domain',
});
check('POST /api/campaigns (kiểu truy vấn "từ khóa + tên miền")', r.status, 201);
check('   lưu đúng kiểu truy vấn', r.data?.campaign?.queryMode, 'keyword_domain');
check('   trả kèm truy vấn THẬT SỰ gõ lên Google', r.data?.campaign?.query, `___test_kd_${TS} brfo.io`);
created.campaigns.push(r.data?.campaign?.id);

check('   kiểu truy vấn lạ -> 400', (await call('PATCH', `/api/campaigns/${r.data.campaign.id}`, { queryMode: 'link' })).status, 400);

r = await call('POST', '/api/campaigns', {
  keyword: `___test_kw3_${TS}`, targetUrl: 'https://brfo.io/', type: 'search_only', count: 2, unit: 'day', startAt: tomorrow(),
});
check('   không gửi kiểu truy vấn -> mặc định "keyword" (truy vấn = đúng từ khóa)',
  `${r.data?.campaign?.queryMode} → ${r.data?.campaign?.query}`, `keyword → ___test_kw3_${TS}`);
created.campaigns.push(r.data?.campaign?.id);

r = await call('GET', '/api/campaigns');
check('GET /api/campaigns trả kèm vị trí Google theo thiết bị', typeof r.data.ranks, 'object');
r = await call('GET', `/api/campaigns/${cid}`);
check('GET /api/campaigns/:id trả kèm ranks { desktop, mobile }', typeof r.data.ranks, 'object');
r = await call('GET', '/api/runs?limit=5');
check('mỗi lượt chạy có cột thiết bị (device_kind / device)', r.data.runs.every(x => 'device_kind' in x && 'device' in x), true);

r = await call('GET', '/api/stats/daily?days=7');
check('GET /api/stats/daily', r.status, 200);
check('   trả về mảng ngày', Array.isArray(r.data.days), true);
r = await call('GET', '/api/stats/keywords?days=30');
check('GET /api/stats/keywords', r.status, 200);
check('   trả về mảng từ khóa', Array.isArray(r.data.keywords), true);
r = await call('GET', '/api/stats/summary');
check('GET /api/stats/summary', r.status, 200);
check('   có tổng số lượt', typeof r.data.summary.total, 'number');
r = await call('GET', '/api/runs?limit=5');
check('GET /api/runs', r.status, 200);

r = await call('GET', '/api/notifications?unread=1');
check('GET /api/notifications (chưa đọc)', r.status, 200);
check('   admin có thông báo chờ duyệt', r.data.unread > 0, true);
check('   trả về danh sách thông báo dù không truyền limit', r.data.items.length > 0, true);
r = await call('POST', '/api/notifications/read-all', {});
check('POST /api/notifications/read-all', r.status, 200);
r = await call('GET', '/api/notifications');
check('   đã đọc hết', r.data.unread, 0);

r = await call('GET', '/api/users');
check('GET /api/users', r.status, 200);
check('   có ít nhất 1 admin', r.data.users.some(u => u.role === 'admin'), true);

const newUser = `test_user_${TS}`;
r = await call('POST', '/api/users', { username: newUser, password: 'matkhau123', role: 'user' });
check('POST /api/users', r.status, 201);
const uid = r.data?.user?.id;
created.users.push(uid);
check('   API đã gỡ hạn mức chạy song song', r.data?.user?.maxSlots, undefined);
r = await call('POST', '/api/users', { username: newUser, password: 'matkhau123' });
check('POST /api/users (trùng tên) -> 400', r.status, 400);

r = await call('PATCH', `/api/users/${uid}`, { displayName: 'Người thử' });
check('PATCH /api/users/:id', r.status, 200);
check('   đổi tên hiển thị', r.data?.user?.displayName, 'Người thử');
check('   API đã gỡ hạn mức lượt/ngày', r.data?.user?.dailyQuota, undefined);
r = await call('PATCH', `/api/users/${uid}`, { dailyQuota: 12 });
check('PATCH chỉ gửi dailyQuota -> 400 (hạn mức đã gỡ)', r.status, 400);
r = await call('PATCH', `/api/users/${uid}`, { password: 'matkhaumoi123' });
check('PATCH /api/users/:id (đổi mật khẩu)', r.status, 200);

r = await call('DELETE', `/api/users/${uid}`);
check('DELETE /api/users/:id (không phải chính mình)', r.status, 200);
created.users.pop();
r = await call('POST', '/api/users', { username: newUser, password: 'matkhau123', role: 'user' });
created.users.push(r.data?.user?.id);
r = await call('POST', '/api/login', { username: newUser, password: 'matkhau123' }, { as: 'user' });
check('POST /api/login (tài khoản thường)', r.status, 200);
check('   có cookie riêng', /^omni_token=/.test(userCookie), true);

r = await call('GET', '/api/campaigns', undefined, { as: 'user' });
check('GET /api/campaigns (tài khoản thường)', r.status, 200);
check('   chỉ thấy chiến dịch của mình', r.data.campaigns.length, 0);
r = await call('GET', `/api/campaigns/${cid}`, undefined, { as: 'user' });
check('GET chiến dịch của người khác -> 403', r.status, 403);
r = await call('PATCH', `/api/campaigns/${cid}`, { count: 3 }, { as: 'user' });
check('PATCH chiến dịch của người khác -> 403', r.status, 403);
r = await call('POST', `/api/campaigns/${cid}/approve`, {}, { as: 'user' });
check('POST approve (tài khoản thường) -> 403', r.status, 403);
r = await call('GET', '/api/users', undefined, { as: 'user' });
check('GET /api/users (tài khoản thường) -> 403', r.status, 403);
r = await call('GET', '/api/audit', undefined, { as: 'user' });
check('GET /api/audit (tài khoản thường) -> 403', r.status, 403);

r = await call('POST', '/api/campaigns', {
  keyword: `___test_user_${TS}`, targetUrl: 'https://example.org/user', type: 'search_only', count: 4, unit: 'day', startAt: tomorrow(),
}, { as: 'user' });
check('POST /api/campaigns (tài khoản thường)', r.status, 201);
const ucid = r.data?.campaign?.id;
created.campaigns.push(ucid);
check('   chờ admin duyệt', r.data?.campaign?.approval, 'pending');

r = await call('PATCH', `/api/campaigns/${ucid}`, { count: 5 }, { as: 'user' });
check('PATCH chiến dịch của mình', r.status, 200);
check('   vẫn ở trạng thái chờ duyệt', r.data?.campaign?.approval, 'pending');

r = await call('POST', `/api/campaigns/${ucid}/approve`, {});
check('POST approve (admin duyệt chiến dịch của user)', r.data?.campaign?.approval, 'approved');
r = await call('GET', '/api/notifications?unread=1', undefined, { as: 'user' });
check('   user nhận được thông báo duyệt', r.data.unread > 0, true);

r = await call('GET', `/api/users?q=${newUser}`);
const uidNow = r.data.users.find(u => u.username === newUser)?.id;
check('tra được id tài khoản thử đang dùng', uidNow > 0, true);

r = await call('PATCH', `/api/users/${uidNow}`, { maxSlots: 1 });
check('gửi maxSlots -> 400 (hạn mức đã gỡ)', r.status, 400);

r = await call('GET', '/api/campaigns', undefined, { as: 'user' });
check('   tài khoản đang bật 1 chiến dịch', r.data.limits.active, 1);
check('   không trả maxSlots nữa', r.data.limits.maxSlots, undefined);
check('   hạn mức tạo: 3 chờ duyệt · 50 tổng', `${r.data.limits.maxPending}/${r.data.limits.maxTotal}`, '3/50');

r = await call('POST', '/api/campaigns', {
  keyword: `___test_slot_${TS}`, targetUrl: 'https://example.org/slot', type: 'search_only', count: 3, unit: 'day', startAt: tomorrow(),
}, { as: 'user' });
check('tạo thêm chiến dịch mới', r.status, 201);
const ucid2 = r.data?.campaign?.id;
created.campaigns.push(ucid2);
check('   chiến dịch mới ở trạng thái chờ duyệt', r.data?.campaign?.approval, 'pending');

r = await call('POST', `/api/campaigns/${ucid2}/approve`, {});
check('admin duyệt -> tự bật chạy', r.data?.campaign?.status, 'running');
r = await call('POST', `/api/campaigns/${ucid2}/status`, { status: 'paused' }, { as: 'user' });
check('user tạm dừng chiến dịch vừa được duyệt', r.data?.campaign?.status, 'paused');
r = await call('POST', `/api/campaigns/${ucid2}/status`, { status: 'running' }, { as: 'user' });
check('không còn hạn mức -> bật lại được ngay', r.data?.campaign?.status, 'running');

const pendStatus = [];
for (let i = 1; i <= 4; i++) {
  const p = await call('POST', '/api/campaigns', {
    keyword: `___test_pending_${TS}_${i}`, targetUrl: `https://example.org/pending/${i}`, type: 'search_only', count: 2, unit: 'day', startAt: tomorrow(),
  }, { as: 'user' });
  pendStatus.push(p.status);
  if (p.data?.campaign?.id) created.campaigns.push(p.data.campaign.id);
}
check('gửi duyệt được 3 chiến dịch cùng lúc',
  String(pendStatus[0]) + '/' + String(pendStatus[1]) + '/' + String(pendStatus[2]), '201/201/201');
check('chiến dịch chờ duyệt thứ 4 -> 400', pendStatus[3], 400);

r = await call('GET', '/api/settings/wallet', undefined, { as: 'user' });
check('GET /api/settings/wallet (tài khoản thường) -> 403', r.status, 403);
r = await call('POST', '/api/settings/wallet', { usdtAddress: 'TXtest123', usdtNetwork: 'TRC20', usdtRate: 25000, bankName: 'Vietcombank', accountNo: '0123456789', note: 'chuyển xong nhắn admin' });
check('POST /api/settings/wallet (admin)', r.status, 200);
check('   lưu địa chỉ + tỷ giá + mạng USDT', `${r.data.wallet.usdtAddress}/${r.data.wallet.usdtRate}/${r.data.wallet.usdtNetwork}`, 'TXtest123/25000/TRC20');
r = await call('POST', '/api/settings/wallet', { usdtRate: 0 });
check('   tỷ giá 0 -> quay về tỷ giá mặc định 26.000', r.data.wallet.usdtRate, 26000);
await call('POST', '/api/settings/wallet', { usdtRate: 25000 });

r = await call('GET', '/api/wallet', undefined, { as: 'user' });
check('GET /api/wallet (tài khoản thường)', r.status, 200);
check('   số dư ban đầu = 0', r.data.balance, 0);
check('   người dùng thấy ví nhận tiền của admin', r.data.receive.usdtAddress, 'TXtest123');
r = await call('GET', '/api/wallet?userId=1', undefined, { as: 'user' });
check('   tài khoản thường không xem được ví người khác', r.data.userId, uidNow);

r = await call('POST', '/api/wallet/topup', { userId: uidNow, usdt: 4, rate: 25000 }, { as: 'user' });
check('POST /api/wallet/topup (tài khoản thường) -> 403', r.status, 403);
r = await call('POST', '/api/wallet/topup', { userId: 999999, usdt: 4, rate: 25000 });
check('nạp cho tài khoản không tồn tại -> 404', r.status, 404);
r = await call('POST', '/api/wallet/topup', { userId: uidNow, amountVnd: 0 });
check('nạp 0 đồng -> 400', r.status, 400);

r = await call('POST', '/api/wallet/topup', { userId: uidNow, usdt: 4, rate: 25000, note: 'ck lan 1' });
check('admin nạp 4 USDT × 25.000 = 100.000đ', r.data?.balance, 100000);
check('   có mã giao dịch dạng TSxxxxxx', /^TS\d{6}$/.test(r.data?.txn?.code || ''), true);
check('   sổ ghi lại số USDT + tỷ giá', `${r.data?.txn?.usdt}/${r.data?.txn?.rate}`, '4/25000');

r = await call('GET', `/api/wallet?userId=${uidNow}`);
check('GET /api/wallet?userId= (admin xem ví người khác)', r.data?.balance, 100000);
check('   tổng đã nạp = tổng ngân sách', `${r.data.toppedUp}/${r.data.total}`, '100000/100000');
check('   sổ giao dịch có 1 dòng', r.data.txns.length, 1);

r = await call('POST', '/api/wallet/adjust', { userId: uidNow, amountVnd: -20000, note: 'hoàn tiền lượt lỗi' });
check('admin điều chỉnh -20.000đ', r.data?.balance, 80000);
r = await call('POST', '/api/wallet/adjust', { userId: uidNow, amountVnd: -999999 });
check('điều chỉnh vượt số dư -> 400', r.status, 400);
r = await call('POST', '/api/wallet/adjust', { userId: uidNow, amountVnd: 0 });
check('điều chỉnh 0 đồng -> 400', r.status, 400);

r = await call('GET', `/api/wallet/transactions?userId=${uidNow}`);
check('GET /api/wallet/transactions', r.data?.items?.length, 2);
r = await call('GET', `/api/wallet/transactions?userId=${uidNow}&kind=topup`);
check('   lọc sổ theo loại giao dịch', r.data?.items?.length, 1);
r = await call('GET', `/api/wallet?userId=${uidNow}`);
check('   số dư đọc lại vẫn đúng', r.data.balance, 80000);

r = await call('GET', `/api/users?q=${newUser}`);
check('bảng tài khoản ở /admin kèm số dư + đã chạy',
  `${r.data.users[0].balance}/${r.data.users[0].spent}`, '80000/0');
r = await call('POST', `/api/notifications/read-all`, {}, { as: 'user' });
check('người dùng nhận thông báo nạp tiền', (await call('GET', '/api/notifications?limit=20', undefined, { as: 'user' })).data.items.some(n => /nạp/i.test(n.title)), true);

r = await call('GET', '/api/audit?limit=50');
check('GET /api/audit', r.status, 200);
check('   có ghi thao tác duyệt chiến dịch', r.data.items.some(a => a.action === 'approve' && a.entity === 'campaign'), true);
check('   có ghi thao tác tạo tài khoản', r.data.items.some(a => a.entity === 'user' && a.action === 'create'), true);

{
  const res = await fetch(base + '/api/events', { headers: { Cookie: cookie } });
  check('GET /api/events (SSE)', res.status, 200);
  check('   content-type', (res.headers.get('content-type') || '').startsWith('text/event-stream'), true);
  const reader = res.body.getReader();
  const { value } = await reader.read();
  const chunk = new TextDecoder().decode(value || new Uint8Array());
  check('   có ảnh chụp tiến độ', /"type":"status"/.test(chunk), true);
  check('   có danh sách chiến dịch', /"tasks":\[/.test(chunk), true);
  await reader.cancel();
}

r = await call('DELETE', `/api/campaigns/${cid}`);
check('DELETE /api/campaigns/:id', r.status, 200);
check('   xoá hẳn (chưa có lượt chạy)', r.data.deleted, true);
for (const id of created.campaigns.filter(Boolean)) {
  const d = await call('DELETE', `/api/campaigns/${id}?hard=1`);
  console.log(`      dọn chiến dịch #${id}: ${d.status}`);
}
for (const id of created.users.filter(Boolean)) {
  const d = await call('DELETE', `/api/users/${id}`);
  console.log(`      dọn tài khoản #${id}: ${d.status}`);
}
const me = (await call('GET', '/api/meta')).data.me;
r = await call('DELETE', `/api/users/${me.id}`);
check('DELETE chính mình -> 400', r.status, 400);

console.log(`\nKết quả: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);

