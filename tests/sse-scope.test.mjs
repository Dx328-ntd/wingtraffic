// /api/events (SSE) và /api/meta không được rò thông tin vận hành sang người dùng thường:
//  - chỉ chiến dịch/luồng của chính người đang xem (chiến dịch không có chủ = chỉ admin);
//  - dbMode/dbError/trần luồng/quotaBlocked chỉ admin nhận;
//  - nhật ký engine (IP, tên dịch vụ nội bộ, lỗi hạ tầng) chỉ admin nhận đủ, người dùng chỉ
//    nhận dòng liên quan tới từ khóa của mình.
// Test trích thẳng hàm streamEvents từ api.mjs và chạy nó, không cần server/CSDL.
import fs from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const src = fs.readFileSync(`${ROOT}api.mjs`, 'utf8');

let failed = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `\n        got =${JSON.stringify(got)}\n        want=${JSON.stringify(want)}`}`);
};

const start = src.indexOf('function streamEvents(ctx) {');
const end = src.indexOf('const NEW_PATHS', start);
if (start < 0 || end < 0) { console.log('FAIL  không trích được streamEvents từ api.mjs'); process.exit(1); }
const fnSrc = src.slice(start, end);

const status = () => ({
  running: true, dbMode: true, dbError: 'SQLITE_BUSY', quotaBlocked: false, maxThreads: 7, inActiveHours: true,
  tasks: [
    { id: 't1', dbId: 11, userId: 5, keyword: 'kèo nhà cái', type: 'search_dwell', unit: 'day', count: 10, due: 1, doneNow: 1, dbToday: 1, today: 1 },
    { id: 't2', dbId: 12, userId: 9, keyword: 'của người khác', type: 'search_dwell', unit: 'day', count: 5, due: 0, doneNow: 0, dbToday: 0, today: 0 },
    { id: 't3', dbId: 13, userId: null, keyword: 'chiến dịch mồ côi', type: 'direct_visit', unit: 'day', count: 1, due: 0, doneNow: 0, dbToday: 0, today: 0 },
  ],
  workers: [
    { taskId: 't1', slot: '1', keyword: 'kèo nhà cái', step: 'Đang đọc', ip: '1.2.3.4', elapsed: 12, captchaLeft: 0, res: { ramMB: 300, cpuPct: 4 } },
    { taskId: 't2', slot: '2', keyword: 'của người khác', step: 'Đang đọc', ip: '5.6.7.8', elapsed: 30, captchaLeft: 0, res: null },
  ],
  events: [
    '[18:00:00] Luồng 1: bắt đầu "kèo nhà cái".',
    '[18:00:01] Luồng 2: bắt đầu "của người khác".',
    '[18:00:02] ⚠ Không kết nối được OmniLogin (cổng 35353).',
    '[18:00:03] Không dọn được profile: fetch failed',
    '[18:00:04] CSDL sẵn sàng — từ khóa lấy từ bảng campaigns',
  ],
});

function frame(actor) {
  const payloads = [];
  const res = {
    writeHead() {}, on() {}, end() {},
    write(line) { const m = /^data: (.*)\n\n$/s.exec(line); if (m) payloads.push(JSON.parse(m[1])); },
  };
  const sandbox = {
    console, Date, Math, JSON, Number, String, Object, Array, RegExp, Error, isNaN, parseInt, Promise, Set, Map,
    setTimeout, clearTimeout, clearInterval, setInterval, queueMicrotask,
    ctx: { req: { on() {} }, res, campaign: { status }, actor },
  };
  vm.createContext(sandbox);
  vm.runInContext(`
    const unreadCount = () => 3;
    const SSE_INTERVAL_MS = 100000;
    ${fnSrc}
    streamEvents(ctx);
  `, sandbox, { filename: 'streamEvents-extract.js' });
  return payloads[0];
}

const user = frame({ id: 5, username: 'nguoidung', role: 'user' });
const admin = frame({ id: 1, username: 'quantri', role: 'admin' });

check('người dùng: chỉ thấy chiến dịch của mình', user.tasks.map(t => t.keyword), ['kèo nhà cái']);
check('người dùng: không thấy chiến dịch người khác', user.tasks.some(t => t.keyword === 'của người khác'), false);
check('người dùng: không thấy chiến dịch không có chủ', user.tasks.some(t => t.keyword === 'chiến dịch mồ côi'), false);
check('người dùng: luồng chỉ của mình', user.workers.map(w => w.keyword), ['kèo nhà cái']);
check('người dùng: KHÔNG nhận dbMode', 'dbMode' in user, false);
check('người dùng: KHÔNG nhận dbError', 'dbError' in user, false);
check('người dùng: KHÔNG nhận trần luồng', 'threads' in user, false);
check('người dùng: KHÔNG nhận quotaBlocked', 'quotaBlocked' in user, false);
check('người dùng: log chỉ dòng thuộc từ khóa của mình', user.events, ['[18:00:00] Luồng 1: bắt đầu "kèo nhà cái".']);
check('người dùng: log không lộ OmniLogin/cổng nội bộ', user.events.some(l => String(l).includes('OmniLogin')), false);
check('người dùng: log không lộ lỗi profile/CSDL', user.events.some(l => /profile|CSDL/.test(String(l))), false);
check('người dùng: vẫn nhận trạng thái chạy để hiển thị', [user.running, user.inActiveHours], [true, true]);
check('người dùng: khung chỉ có các khóa an toàn', Object.keys(user).sort(), ['at', 'events', 'inActiveHours', 'running', 'tasks', 'type', 'workers']);

check('admin: thấy đủ chiến dịch', admin.tasks.length, 3);
check('admin: nhận dbMode/dbError/trần luồng', [admin.dbMode, admin.dbError, admin.threads], [true, 'SQLITE_BUSY', 7]);
check('admin: nhận đủ log vận hành', admin.events.length, 5);

// /api/meta: khối engine phải rẽ nhánh theo vai trò
const mStart = src.indexOf("if (req.method === 'GET' && p === '/api/meta')");
const mEnd = src.indexOf("if (req.method === 'GET' && p === '/api/badges')", mStart);
const metaSrc = src.slice(mStart, mEnd);
const adminBranch = metaSrc.slice(metaSrc.indexOf('? {'), metaSrc.indexOf(': { running: st.running'));
const userBranch = metaSrc.slice(metaSrc.indexOf(': { running: st.running'));
check('/api/meta: có rẽ nhánh theo vai trò', metaSrc.includes('engine: isAdmin'), true);
check('/api/meta: dbMode chỉ trong nhánh admin', adminBranch.includes('dbMode') && !userBranch.includes('dbMode'), true);
check('/api/meta: dbError chỉ trong nhánh admin', adminBranch.includes('dbError') && !userBranch.includes('dbError'), true);
check('/api/meta: trần luồng chỉ trong nhánh admin', adminBranch.includes('threads') && !userBranch.includes('threads'), true);
check('/api/meta: người dùng vẫn thấy running + inActiveHours', userBranch.includes('running') && userBranch.includes('inActiveHours'), true);

console.log(`\n${failed ? `${failed} kiểm tra THẤT BẠI` : 'Tất cả kiểm tra PASS'}`);
process.exit(failed ? 1 : 0);
