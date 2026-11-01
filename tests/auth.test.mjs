const [, , portArg, username = 'admin', password = ''] = process.argv;
const base = `http://localhost:${portArg || 3400}`;
let cookie = '';
let pass = 0;
let fail = 0;

async function call(method, path, body, { keepCookie = true, useCookie = null } = {}) {
  const headers = {};
  if (body) headers['Content-Type'] = 'application/json';
  const c = useCookie || cookie;
  if (c) headers.Cookie = c;
  const res = await fetch(base + path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    redirect: 'manual',
  });
  const set = res.headers.get('set-cookie');
  if (set && keepCookie) cookie = set.split(';')[0];
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  return { status: res.status, location: res.headers.get('location') || '', text, cookie: set ? set.split(';')[0] : '', data };
}

function check(label, got, want) {
  const ok = String(got) === String(want);
  if (ok) pass++; else fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}  ->  ${got}${ok ? '' : `  (mong đợi ${want})`}`);
}

function brief(text, max = 150) {
  const s = String(text).replace(/\s+/g, ' ');
  return s.length > max ? `${s.slice(0, max)}...` : s;
}

let r = await call('GET', '/api/health');
check('GET /api/health', r.status, 200);
console.log('      ', brief(r.text));
r = await call('GET', '/api/campaign');
check('GET /api/campaign (chưa login)', r.status, 401);
r = await call('GET', '/api/me');
check('GET /api/me (chưa login)', r.status, 401);
r = await call('GET', '/');
check('GET / (chưa login) -> chuyển sang /login', r.status, 302);
check('   Location = /login', r.location, '/login');
r = await call('GET', '/bang-gia');
check('GET /bang-gia (cần đăng nhập)', r.status, 302);
r = await call('GET', '/gioi-thieu');
check('GET /gioi-thieu (cổng công khai)', r.status, 200);
check('   có form đăng ký, không có khu quản trị', /id="reg-form"/.test(r.text) && !/panel-admin|href="\/admin"/.test(r.text), 'true');
check('   HTML đóng đủ (style + form + </html>)', /<\/style>/.test(r.text) && /id="reg-btn"/.test(r.text) && /<\/html>/.test(r.text), 'true');
check('   canonical đã thay bằng tên miền thật', /\{\{PUBLIC_URL\}\}/.test(r.text), 'false');
check('   có form đăng ký', /id="reg-form"/.test(r.text), 'true');
r = await call('GET', '/robots.txt');
check('GET /robots.txt (công khai)', r.status, 200);
check('   chặn crawler vào /admin', /Disallow: \/admin/.test(r.text), 'true');
r = await call('GET', '/sitemap.xml');
check('GET /sitemap.xml (công khai)', r.status, 200);
check('   có <urlset>', /<urlset/.test(r.text), 'true');
r = await call('GET', '/my');
check('GET /my (chưa login) chuyển hướng', r.status, 302);
check('   Location', r.location, '/login?next=%2Fmy');
r = await call('GET', '/login');
check('GET /login (công khai)', r.status, 200);
check('   có form đăng nhập', /id="f"/.test(r.text), 'true');

const regUser = `test_reg_${String(Date.now()).slice(-8)}`;
const regPass = 'MatKhauThu@2026';
let reg = await call('POST', '/api/register', { username: regUser, password: regPass, passwordConfirm: regPass, displayName: 'Tài khoản thử' }, { keepCookie: false });
check('POST /api/register (hợp lệ)', reg.status, 201);
if (reg.status !== 201 || !reg.data) console.log('      raw:', reg.text);
check('   vai trò là user', reg.data?.user?.role, 'user');
check('   có cookie phiên omni_token', /^omni_token=/.test(reg.cookie), 'true');
const regCookie = reg.cookie;
const regId = reg.data?.user?.id;
r = await call('POST', '/api/register', { username: regUser, password: regPass, passwordConfirm: regPass }, { keepCookie: false });
check('POST /api/register (trùng tên) -> 409', r.status, 409);
r = await call('POST', '/api/register', { username: `x_${String(Date.now()).slice(-8)}`, password: 'ngan' }, { keepCookie: false });
check('POST /api/register (mật khẩu ngắn) -> 400', r.status, 400);
check('   thông báo có nói tối thiểu 8 ký tự', /tối thiểu 8/.test(r.text), 'true');
r = await call('GET', '/my', undefined, { useCookie: regCookie, keepCookie: false });
check('GET /my (tài khoản tự đăng ký)', r.status, 200);
r = await call('GET', '/admin', undefined, { useCookie: regCookie, keepCookie: false });
check('GET /admin (người dùng thường) chuyển hướng', r.status, 302);
check('   Location', r.location, '/my');
r = await call('GET', '/campaign', undefined, { useCookie: regCookie, keepCookie: false });
check('GET /campaign (người dùng thường) -> về /my', r.location, '/my');
r = await call('GET', '/api/users', undefined, { useCookie: regCookie, keepCookie: false });
check('GET /api/users (người dùng thường) -> 403', r.status, 403);

r = await call('POST', '/api/login', { username, password: 'sai-mat-khau' });
check('POST /api/login (sai mật khẩu)', r.status, 401);
r = await call('POST', '/api/login', { username: 'khong-ton-tai', password: 'x' });
check('POST /api/login (user lạ)', r.status, 401);

r = await call('POST', '/api/login', { username, password });
check('POST /api/login (đúng)', r.status, 200);
console.log('      ', brief(r.text));
check('   cookie omni_token', /^omni_token=/.test(cookie), 'true');

r = await call('GET', '/api/me');
check('GET /api/me (đã login)', r.status, 200);
console.log('      ', brief(r.text));
r = await call('GET', '/api/campaign');
check('GET /api/campaign (đã login)', r.status, 200);
console.log('      ', brief(r.text));
r = await call('GET', '/');
check('GET / (đã login) -> chuyển vào bảng điều khiển', r.status, 302);
r = await call('GET', '/campaign');
check('GET /campaign (đã login)', r.status, 200);
r = await call('GET', '/admin');
check('GET /admin (đã login, vai trò admin)', r.status, 200);
check('   có nút cấp/thu quyền admin', /data-role="\$\{u\.id\}"/.test(r.text) && /Cấp quyền admin/.test(r.text), 'true');
check('   có hàm changeRole gọi PATCH role', /async function changeRole/.test(r.text) && /JSON\.stringify\(\{ role: toAdmin \? 'admin' : 'user' \}\)/.test(r.text), 'true');

if (regId) {
  r = await call('PATCH', `/api/users/${regId}`, { role: 'admin' });
  check('PATCH /api/users/:id (cấp quyền admin)', r.status, 200);
  check('   vai trò sau khi cấp', r.data?.user?.role, 'admin');
  r = await call('POST', '/api/login', { username: regUser, password: regPass }, { keepCookie: false });
  check('POST /api/login (tài khoản vừa được cấp quyền)', r.status, 200);
  const promoted = r.cookie;
  r = await call('GET', '/admin', undefined, { useCookie: promoted, keepCookie: false });
  check('GET /admin (vừa được cấp quyền)', r.status, 200);
  r = await call('GET', '/api/users', undefined, { useCookie: promoted, keepCookie: false });
  check('GET /api/users (vừa được cấp quyền)', r.status, 200);
  r = await call('PATCH', `/api/users/${regId}`, { role: 'user' });
  check('PATCH /api/users/:id (thu quyền admin)', r.data?.user?.role, 'user');
  r = await call('GET', '/admin', undefined, { useCookie: promoted, keepCookie: false });
  check('GET /admin (đã thu quyền, phiên cũ vẫn bị chặn)', r.location, '/my');
  r = await call('PATCH', `/api/users/${regId}`, { role: 'quantrivien' });
  check('PATCH /api/users/:id (vai trò không hợp lệ) -> 400', r.status, 400);
  r = await call('GET', '/api/me');
  r = await call('PATCH', `/api/users/${r.data?.user?.id}`, { role: 'user' });
  check('PATCH /api/users/:id (tự hạ quyền khi chỉ có 1 admin) -> 400', r.status, 400);
}

if (regId) {
  r = await call('PATCH', `/api/users/${regId}`, { status: 'locked' });
  check('PATCH /api/users/:id (khoá tài khoản)', r.status, 200);
  r = await call('POST', '/api/login', { username: regUser, password: regPass }, { keepCookie: false });
  check('POST /api/login (tài khoản bị khoá) -> 403', r.status, 403);
  r = await call('DELETE', `/api/users/${regId}`);
  check('DELETE /api/users/:id (dọn tài khoản thử)', r.status, 200);
}

r = await call('GET', '/api/me');
const meId = r.data?.user?.id;
check('GET /api/me (admin #1)', r.status, 200);

const adm2 = 'adm2_' + Date.now().toString(36);
const adm2Pass = 'Adm2@' + Date.now().toString(36);
r = await call('POST', '/api/users', { username: adm2, password: adm2Pass, role: 'admin' });
check('POST /api/users (tạo admin #2)', r.status, 201);
const adm2Id = r.data?.user?.id;
r = await call('POST', '/api/login', { username: adm2, password: adm2Pass }, { keepCookie: false });
check('POST /api/login (admin #2, phiên thứ hai)', r.status, 200);
const adm2Cookie = r.cookie;
r = await call('GET', '/admin', undefined, { useCookie: adm2Cookie, keepCookie: false });
check('GET /admin (admin #2 — hai phiên admin song song)', r.status, 200);

r = await call('PATCH', `/api/users/${meId}`, { role: 'user' }, { useCookie: adm2Cookie, keepCookie: false });
check('PATCH /api/users/:id (admin #2 hạ quyền admin #1)', r.data?.user?.role, 'user');
r = await call('GET', '/admin', undefined, { useCookie: adm2Cookie, keepCookie: false });
check('GET /admin (admin #2 — vẫn admin)', r.status, 200);
r = await call('GET', '/api/users', undefined, { useCookie: adm2Cookie, keepCookie: false });
check('GET /api/users (admin #2 — vẫn admin)', r.status, 200);
r = await call('GET', '/admin');
check('GET /admin (phiên admin #1, đã thành user) -> /my', r.location, '/my');
r = await call('GET', '/campaign');
check('GET /campaign (phiên admin #1, đã thành user) -> /my', r.location, '/my');
r = await call('GET', '/my');
check('GET /my (phiên admin #1 — test được tính năng người dùng)', r.status, 200);
r = await call('GET', '/api/campaign');
check('GET /api/campaign (phiên admin #1 — tính năng người dùng)', r.status, 200);

r = await call('PATCH', `/api/users/${meId}`, { role: 'admin' }, { useCookie: adm2Cookie, keepCookie: false });
check('PATCH /api/users/:id (admin #2 cấp lại quyền cho admin #1)', r.data?.user?.role, 'admin');
r = await call('GET', '/admin');
check('GET /admin (admin #1 vào lại được ngay, không cần login lại)', r.status, 200);

r = await call('DELETE', `/api/users/${adm2Id}`);
check('DELETE /api/users/:id (dọn admin #2)', r.status, 200);
r = await call('PATCH', `/api/users/${meId}`, { role: 'user' });
check('PATCH /api/users/:id (tự hạ quyền sau khi chỉ còn 1 admin) -> 400', r.status, 400);

r = await call('POST', '/api/logout', {}, { keepCookie: false });
check('POST /api/logout', r.status, 200);
cookie = '';
r = await call('GET', '/api/me');
check('GET /api/me (sau logout)', r.status, 401);

console.log(`\nKết quả: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
