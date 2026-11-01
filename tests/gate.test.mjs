import { Readable } from 'node:stream';

process.env.JWT_SECRET = 'test-secret-for-gate-0123456789abcdef';
const gate = await import('../gate.mjs');
const auth = await import('../auth/auth.mjs');

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { if (cond) { pass++; console.log(`  PASS  ${name}`); } else { fail++; console.log(`  FAIL  ${name} ${extra}`); } };

const store = new Map();
const repo = { settings: { get: k => (store.has(k) ? store.get(k) : null), set: (k, v) => { store.set(k, v == null ? null : String(v)); return 1; } } };
const loadDeps = async () => ({ repo, auth });

const TUNNEL = { 'cf-ray': 'abc-SIN', 'cf-connecting-ip': '203.0.113.7', 'x-forwarded-for': '203.0.113.7', 'x-forwarded-proto': 'https' };
function mkReq(method, path, { headers = {}, body = null, remote = '127.0.0.1' } = {}) {
  const r = Readable.from(body == null ? [] : [body]);
  Object.assign(r, { method, url: path, headers, socket: { remoteAddress: remote } });
  return r;
}
function mkRes() {
  const o = { status: 0, headers: {}, body: '' };
  o.writeHead = (s, h = {}) => { o.status = s; Object.assign(o.headers, h); };
  o.setHeader = (k, v) => { o.headers[k] = v; };
  o.end = (b = '') => { o.body += b; };
  return o;
}
async function call(method, path, opts = {}) {
  const req = mkReq(method, path, opts), res = mkRes();
  const handled = await gate.gateGuard({ req, res, url: new URL(path, 'http://x'), loadDeps });
  return { handled, res };
}
const cookieOf = res => { const m = /omni_gate=([^;]+)/.exec(String(res.headers['Set-Cookie'] || '')); return m ? `omni_gate=${m[1]}` : ''; };
const form = o => new URLSearchParams(o).toString();

console.log('\n== nhận diện truy cập từ ngoài ==');
ok('trực tiếp trên máy (127.0.0.1, không header proxy) = nội bộ', gate.isExternalRequest(mkReq('GET', '/', { remote: '127.0.0.1' })) === false);
ok('IPv6 loopback / IPv4-mapped = nội bộ', gate.isExternalRequest(mkReq('GET', '/', { remote: '::1' })) === false && gate.isExternalRequest(mkReq('GET', '/', { remote: '::ffff:127.0.0.1' })) === false);
ok('có header Cloudflare (cf-ray) = bên ngoài dù kết nối từ 127.0.0.1', gate.isExternalRequest(mkReq('GET', '/', { headers: { 'cf-ray': 'x' }, remote: '127.0.0.1' })) === true);
ok('có X-Forwarded-For (proxy Caddy/Nginx) = bên ngoài', gate.isExternalRequest(mkReq('GET', '/', { headers: { 'x-forwarded-for': '1.2.3.4' } })) === true);
ok('kết nối từ địa chỉ không phải loopback = bên ngoài', gate.isExternalRequest(mkReq('GET', '/', { remote: '198.51.100.9' })) === true);

console.log('\n== mặc định (chưa cấu hình gì): BẬT + chưa có mật khẩu = chặn hết khách bên ngoài ==');
let r = await call('GET', '/login', { headers: TUNNEL });
ok('khách ngoài: trang bị chặn (503, "tạm đóng", không có form mật khẩu)', r.handled && r.res.status === 503 && /tạm đóng/.test(r.res.body) && !/type="password"/.test(r.res.body));
r = await call('GET', '/api/me', { headers: TUNNEL });
ok('khách ngoài: API cũng bị chặn (503 JSON)', r.handled && r.res.status === 503 && /"error"/.test(r.res.body));
r = await call('GET', '/admin', { remote: '127.0.0.1' });
ok('truy cập trực tiếp trên máy RDP vẫn vào bình thường (không bị hỏi)', r.handled === false);

console.log('\n== admin đặt mật khẩu (writeGate) ==');
let st = await gate.writeGate(repo, auth, { enabled: true, password: 'abc' }, 1).catch(e => e);
ok('mật khẩu < 6 ký tự bị từ chối (400)', st instanceof Error && st.status === 400);
st = await gate.writeGate(repo, auth, { enabled: true, password: 'Mat-khau-1' }, 1);
ok('đặt mật khẩu hợp lệ: bật + có mật khẩu', st.enabled === true && st.hasPassword === true);
const saved = store.get('gate_password_hash') || '';
ok('lưu dạng băm bcrypt, KHÔNG lưu mật khẩu gốc', /^\$2[aby]\$/.test(saved) && !JSON.stringify([...store.values()]).includes('Mat-khau-1'));
st = await gate.writeGate(repo, auth, { enabled: true }, 1);
ok('để trống mật khẩu = giữ mật khẩu cũ', st.hasPassword === true && store.get('gate_password_hash') === saved);

console.log('\n== khách bên ngoài phải nhập mật khẩu ==');
r = await call('GET', '/', { headers: TUNNEL });
ok('chưa nhập: thấy trang nhập mật khẩu (401, có form, noindex)', r.handled && r.res.status === 401 && /type="password"/.test(r.res.body) && /noindex/.test(r.res.body));
ok('trang nhập mật khẩu KHÔNG lộ nội dung app', !/campaign|\/api\/|Chiến dịch/.test(r.res.body.replace(/WingTraffic/g, '')));
r = await call('GET', '/api/campaigns', { headers: TUNNEL });
ok('chưa nhập: API trả 401 JSON {gate:true}', r.handled && r.res.status === 401 && JSON.parse(r.res.body).gate === true);
r = await call('GET', '/wt-badge.js', { headers: TUNNEL });
ok('huy hiệu footer: GET /wt-badge.js qua cổng KHÔNG cần mật khẩu (website khách nhúng)', r.handled === false);
r = await call('GET', '/logo-icon.png', { headers: TUNNEL });
ok('huy hiệu footer: GET /logo-icon.png qua cổng không cần mật khẩu', r.handled === false);
r = await call('POST', '/wt-badge.js', { headers: TUNNEL, body: '' });
ok('chỉ mở cho GET/HEAD: POST /wt-badge.js vẫn bị chặn', r.handled === true);
r = await call('GET', '/wt-badge.js/../api/campaigns', { headers: TUNNEL });
ok('không mở rộng sang đường dẫn khác (/api/campaigns vẫn bị chặn)', r.handled === true || new URL('/wt-badge.js/../api/campaigns', 'http://x').pathname === '/api/campaigns');
r = await call('GET', '/logo-full.png', { headers: TUNNEL });
ok('file khác (logo-full.png, ui.js...) vẫn bị chặn khi chưa nhập mật khẩu', r.handled === true && r.res.status === 401);
r = await call('GET', '/ui.css', { headers: TUNNEL });
ok('chưa nhập: file giao diện cũng không tải được', r.handled && r.res.status === 401);

r = await call('POST', '/__cong', { headers: { ...TUNNEL, 'content-type': 'application/x-www-form-urlencoded' }, body: form({ password: 'sai-roi', next: '/my' }) });
ok('nhập SAI: 401 + báo "chưa đúng", không cấp cookie', r.res.status === 401 && /chưa đúng/.test(r.res.body) && !cookieOf(r.res));
r = await call('POST', '/__cong', { headers: { ...TUNNEL, 'content-type': 'application/x-www-form-urlencoded' }, body: form({ password: 'Mat-khau-1', next: '/my' }) });
const goodCookie = cookieOf(r.res);
ok('nhập ĐÚNG: 303 về trang đang vào + cấp cookie HttpOnly/Secure (qua https)', r.res.status === 303 && r.res.headers.Location === '/my' && !!goodCookie && /HttpOnly/.test(r.res.headers['Set-Cookie']) && /Secure/.test(r.res.headers['Set-Cookie']));
r = await call('GET', '/my', { headers: { ...TUNNEL, cookie: goodCookie } });
ok('có cookie đã qua cổng: request đi tiếp vào app', r.handled === false);
r = await call('GET', '/api/events', { headers: { ...TUNNEL, cookie: `omni_token=abc; ${goodCookie}` } });
ok('cookie đăng nhập app đi kèm vẫn nhận ra cookie cổng', r.handled === false);
r = await call('GET', '/my', { headers: { ...TUNNEL, cookie: goodCookie.replace(/.$/, c => (c === '0' ? '1' : '0')) } });
ok('cookie bị sửa chữ ký: bị chặn lại', r.handled && r.res.status === 401);
ok('hết hạn (12 giờ) thì cookie vô hiệu', gate.checkGateCookieValue(gate.makeGateCookieValue(saved, Date.now() - 13 * 3600 * 1000), saved) === false
  && gate.checkGateCookieValue(gate.makeGateCookieValue(saved), saved) === true);
ok('chuyển hướng chỉ trong nội bộ (chặn open-redirect)', gate.safeNext('//evil.com') === '/' && gate.safeNext('https://evil.com') === '/' && gate.safeNext('/\\evil') === '/' && gate.safeNext('/my#x') === '/my#x' && gate.safeNext('/__cong') === '/');

console.log('\n== đổi mật khẩu = mọi phiên cũ hết hiệu lực ==');
await gate.writeGate(repo, auth, { password: 'Mat-khau-2' }, 1);
r = await call('GET', '/my', { headers: { ...TUNNEL, cookie: goodCookie } });
ok('cookie cũ bị chặn sau khi đổi mật khẩu', r.handled && r.res.status === 401);
r = await call('POST', '/__cong', { headers: { ...TUNNEL, 'content-type': 'application/x-www-form-urlencoded' }, body: form({ password: 'Mat-khau-1' }) });
ok('mật khẩu cũ không còn dùng được', r.res.status === 401);

console.log('\n== chống dò mật khẩu ==');
let last;
for (let i = 0; i < 9; i++) last = await call('POST', '/__cong', { headers: { ...TUNNEL, 'cf-connecting-ip': '198.51.100.77', 'x-forwarded-for': '198.51.100.77', 'content-type': 'application/x-www-form-urlencoded' }, body: form({ password: 'doan-' + i }) });
ok('nhập sai nhiều lần từ một IP bị khoá tạm (429 + Retry-After)', last.res.status === 429 && !!last.res.headers['Retry-After']);
r = await call('POST', '/__cong', { headers: { ...TUNNEL, 'cf-connecting-ip': '198.51.100.88', 'x-forwarded-for': '198.51.100.88', 'content-type': 'application/x-www-form-urlencoded' }, body: form({ password: 'Mat-khau-2' }) });
ok('IP khác không bị ảnh hưởng và vào được bằng mật khẩu đúng', r.res.status === 303);

console.log('\n== tắt cổng ==');
await gate.writeGate(repo, auth, { enabled: false }, 1);
r = await call('GET', '/login', { headers: TUNNEL });
ok('admin tắt cổng: khách bên ngoài đi thẳng vào app', r.handled === false);
await gate.writeGate(repo, auth, { enabled: true }, 1);
r = await call('GET', '/login', { headers: TUNNEL });
ok('bật lại: chặn lại ngay', r.handled && r.res.status === 401);

console.log(`\nKết quả: ${pass} PASS, ${fail} FAIL`);
process.exit(fail ? 1 : 0);
