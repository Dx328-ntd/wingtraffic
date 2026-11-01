import {
  validateRegistration, registrationOpen, rateLimiter, normalizeIp,
  RegisterError, USERNAME_RE, MIN_PASSWORD, MAX_PASSWORD, MAX_DISPLAY_NAME,
} from '../auth/register.mjs';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name} ${extra}`); }
};
const errOf = fn => { try { fn(); return null; } catch (e) { return e; } };
const is400 = (e, fragment = '') => e instanceof RegisterError && e.status === 400 && String(e.message).includes(fragment);

const valid = { username: 'nguyenvana', password: 'matkhau123', displayName: 'Nguyễn Văn A' };

ok('USERNAME_RE nhận tên hợp lệ', USERNAME_RE.test('user_01.a-b'));
ok('USERNAME_RE chặn khoảng trắng', !USERNAME_RE.test('user 01'));
ok('USERNAME_RE chặn ký tự lạ', !USERNAME_RE.test('user@01'));
ok('MIN_PASSWORD = 8 (khớp api.mjs)', MIN_PASSWORD === 8);
ok('MAX_PASSWORD = 72 (giới hạn bcrypt)', MAX_PASSWORD === 72);

const r1 = validateRegistration(valid);
ok('hợp lệ -> trả đủ trường', r1.username === 'nguyenvana' && r1.password === 'matkhau123' && r1.displayName === 'Nguyễn Văn A');
ok('trả đủ 3 trường, không còn hạn mức chạy song song', Object.keys(r1).join(',') === 'username,password,displayName');
const r2 = validateRegistration({ username: '  user02  ', password: 'matkhau123', displayName: '  Tên  ' });
ok('cắt khoảng trắng ở tên đăng nhập + tên hiển thị', r2.username === 'user02' && r2.displayName === 'Tên');
ok('không có tên hiển thị -> null', validateRegistration({ username: 'user03', password: 'matkhau123' }).displayName === null);
ok('tên hiển thị trắng -> null', validateRegistration({ username: 'user03', password: 'matkhau123', displayName: '   ' }).displayName === null);
ok('tên hiển thị bị cắt còn 80 ký tự', validateRegistration({ username: 'user03', password: 'matkhau123', displayName: 'x'.repeat(200) }).displayName.length === MAX_DISPLAY_NAME);

ok('thiếu mật khẩu -> 400', is400(errOf(() => validateRegistration({ username: 'user04' })), 'Thiếu mật khẩu'));
ok('mật khẩu 7 ký tự -> 400', is400(errOf(() => validateRegistration({ username: 'user04', password: '1234567' })), 'tối thiểu 8'));
ok('mật khẩu 8 ký tự -> hợp lệ', validateRegistration({ username: 'user04', password: '12345678' }).password === '12345678');
ok('mật khẩu 73 ký tự -> 400', is400(errOf(() => validateRegistration({ username: 'user04', password: 'x'.repeat(73) })), 'tối đa 72'));
ok('mật khẩu 72 ký tự -> hợp lệ', validateRegistration({ username: 'user04', password: 'x'.repeat(72) }).password.length === 72);
ok('nhập lại mật khẩu khớp -> hợp lệ', validateRegistration({ username: 'user04', password: 'matkhau123', passwordConfirm: 'matkhau123' }).username === 'user04');
ok('nhập lại mật khẩu lệch -> 400', is400(errOf(() => validateRegistration({ username: 'user04', password: 'matkhau123', passwordConfirm: 'khac12345' })), 'không khớp'));

ok('thiếu tên đăng nhập -> 400', is400(errOf(() => validateRegistration({ password: 'matkhau123' })), 'Thiếu tên đăng nhập'));
ok('tên đăng nhập 2 ký tự -> 400', is400(errOf(() => validateRegistration({ username: 'ab', password: 'matkhau123' })), '3–32'));
ok('tên đăng nhập 33 ký tự -> 400', is400(errOf(() => validateRegistration({ username: 'a'.repeat(33), password: 'matkhau123' })), '3–32'));
ok('tên đăng nhập có @ -> 400', is400(errOf(() => validateRegistration({ username: 'user@x', password: 'matkhau123' })), '3–32'));

for (const [label, body] of [['null', null], ['mảng', []], ['chuỗi', 'abc'], ['số', 5]]) {
  ok(`body ${label} -> 400`, is400(errOf(() => validateRegistration(body)), 'JSON dạng đối tượng'));
}

ok('không trả maxSlots (mô hình gói đã gỡ)', !('maxSlots' in r1));
ok('không còn hạn mức lượt/ngày (engine đã gỡ)', !('dailyQuota' in validateRegistration(valid, { dailyQuota: 20 })));

ok('mặc định MỞ đăng ký', registrationOpen({}) === true);
ok('REGISTER_OPEN=1 -> MỞ', registrationOpen({ REGISTER_OPEN: '1' }) === true);
ok('REGISTER_OPEN=0 -> ĐÓNG', registrationOpen({ REGISTER_OPEN: '0' }) === false);

ok('bỏ tiền tố ::ffff:', normalizeIp('::ffff:203.0.113.9') === '203.0.113.9');
ok('IP rỗng -> unknown', normalizeIp('') === 'unknown' && normalizeIp(undefined) === 'unknown');

let clock = 1_000_000;
const rl = rateLimiter({ limit: 3, windowMs: 600000, now: () => clock });
ok('3 lần đầu được phép', rl.check('1.1.1.1').ok && rl.check('1.1.1.1').ok && rl.check('1.1.1.1').ok);
const blocked = rl.check('1.1.1.1');
ok('lần thứ 4 bị chặn', blocked.ok === false);
ok('có Retry-After (giây)', blocked.retryAfterSec > 0 && blocked.retryAfterSec <= 600);
ok('IP khác không bị ảnh hưởng', rl.check('2.2.2.2').ok === true);
ok('IPv4-mapped IPv6 tính cùng một IP', rl.check('::ffff:1.1.1.1').ok === false);
const rl2 = rateLimiter({ limit: 2, windowMs: 600000, now: () => clock });
rl2.check('3.3.3.3');
rl2.check('3.3.3.3');
rl2.release('3.3.3.3');
ok('release trả lại lượt đã dùng', rl2.check('3.3.3.3').ok === true && rl2.check('3.3.3.3').ok === false);
clock += 600001;
ok('hết cửa sổ -> được phép lại', rl.check('1.1.1.1').ok === true);
ok('size đếm số IP đang theo dõi', rl.size() >= 2);
rl.clear();
ok('clear xoá bộ đếm', rl.size() === 0);

console.log(`\nKết quả: ${pass} PASS, ${fail} FAIL`);
process.exit(fail ? 1 : 0);
