const [, , portArg, username = 'admin', password = ''] = process.argv;
const base = `http://localhost:${portArg || 3300}`;
let pass = 0;
let fail = 0;

async function call(method, path, body, cookie = '') {
  const headers = {};
  if (body) headers['Content-Type'] = 'application/json';
  if (cookie) headers.Cookie = cookie;
  const res = await fetch(base + path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    redirect: 'manual',
  });
  const set = res.headers.get('set-cookie');
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

let r = await call('POST', '/api/login', { username, password });
check('POST /api/login (admin)', r.status, 200);
const adminCookie = r.cookie;
r = await call('GET', '/admin', null, adminCookie);
check('GET /admin (admin)', r.status, 200);
check('   có nút Cấp/Thu quyền admin', /data-role="\$\{u\.id\}"/.test(r.text) && /Cấp quyền admin/.test(r.text), 'true');
check('   có hàm changeRole', /async function changeRole/.test(r.text), 'true');
check('   có ghi chú chạy song song admin + user', /song song admin \+ user/.test(r.text), 'true');
check('   có ghi chú "admin duy nhất"', /admin duy nhất/.test(r.text), 'true');
r = await call('GET', '/api/me', null, adminCookie);
check('GET /api/me (admin)', r.status, 200);
const meId = r.data?.user?.id;

const ts = Date.now().toString(36);
const name2 = `smoke_admin_${ts}`;
const pass2 = `Smoke@${ts}`;
r = await call('POST', '/api/users', { username: name2, password: pass2, role: 'admin' }, adminCookie);
check('POST /api/users (tạo admin tạm)', r.status, 201);
const id2 = r.data?.user?.id;
r = await call('POST', '/api/login', { username: name2, password: pass2 });
check('POST /api/login (phiên admin thứ hai)', r.status, 200);
const cookie2 = r.cookie;
r = await call('GET', '/admin', null, cookie2);
check('GET /admin (phiên admin thứ hai)', r.status, 200);
r = await call('GET', '/admin', null, adminCookie);
check('GET /admin (phiên admin thứ nhất — song song)', r.status, 200);

r = await call('PATCH', `/api/users/${id2}`, { role: 'user' }, cookie2);
check('PATCH /api/users/:id (admin tạm tự hạ quyền khi còn admin khác)', r.data?.user?.role, 'user');
r = await call('GET', '/admin', null, cookie2);
check('GET /admin (phiên vừa hạ quyền) -> /my', r.location, '/my');
r = await call('GET', '/campaign', null, cookie2);
check('GET /campaign (phiên vừa hạ quyền) -> /my', r.location, '/my');
r = await call('GET', '/my', null, cookie2);
check('GET /my (phiên user — dùng song song được)', r.status, 200);
r = await call('GET', '/api/campaign', null, cookie2);
check('GET /api/campaign (phiên user)', r.status, 200);
r = await call('GET', '/admin', null, adminCookie);
check('GET /admin (phiên admin thứ nhất vẫn nguyên quyền)', r.status, 200);

r = await call('PATCH', `/api/users/${id2}`, { role: 'admin' }, adminCookie);
check('PATCH /api/users/:id (cấp lại quyền admin cho tài khoản tạm)', r.data?.user?.role, 'admin');
r = await call('GET', '/admin', null, cookie2);
check('GET /admin (tài khoản tạm vào lại được ngay)', r.status, 200);
r = await call('PATCH', `/api/users/${id2}`, { role: 'user' }, adminCookie);
check('PATCH /api/users/:id (thu quyền admin của tài khoản tạm)', r.data?.user?.role, 'user');

r = await call('DELETE', `/api/users/${id2}`, null, adminCookie);
check('DELETE /api/users/:id (dọn admin tạm)', r.status, 200);
r = await call('GET', '/api/users', null, adminCookie);
check('   tài khoản tạm đã biến mất', (r.data?.users || []).some(u => u.id === id2), 'false');

console.log(`\nKết quả: ${pass} pass, ${fail} fail   (tài khoản #${meId} "${username}" không bị đổi vai trò)`);
process.exit(fail ? 1 : 0);
