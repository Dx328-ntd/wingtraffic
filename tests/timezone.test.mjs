// Một quy ước thời gian cho cả hệ thống:
//  - CSDL (created_at, last_login_at, runs.at...) ghi UTC.
//  - Nhật ký engine + giao diện hiển thị theo APP_TZ (mặc định Asia/Ho_Chi_Minh).
// Test này chạy được bất kể múi giờ của máy: chạy `TZ=Europe/Paris node tests/timezone.test.mjs`
// để thấy cách cũ (new Date() giờ máy) lệch còn cách mới thì không.
import vm from 'node:vm';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

let failed = 0;
const check = (name, got, want) => {
  const ok = String(got) === String(want);
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `\n        got=${got}\n        want=${want}`}`);
};

// ---------- 1. time.mjs ----------
const { now, today, stamp, inAppTz, APP_TZ } = await import('../time.mjs');
const d = new Date('2026-11-01T11:39:32Z');

check('APP_TZ mặc định là Asia/Ho_Chi_Minh', APP_TZ, 'Asia/Ho_Chi_Minh');
check('now() ghi UTC, không phụ thuộc TZ máy chủ', now(d), '2026-11-01 11:39:32');
check('today() là ngày UTC (khớp date(runs.at))', today(d), '2026-11-01');
check('stamp() cho nhật ký theo APP_TZ (UTC+7)', stamp(d), '18:39:32');
check('inAppTz() = UTC+7', inAppTz(d), '2026-11-01 18:39:32');

// ---------- 2. helper hiển thị trong public/ui.js ----------
const el = () => ({
  style: {}, dataset: {}, classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
  addEventListener() {}, appendChild() {}, removeChild() {}, querySelector: () => null,
  querySelectorAll: () => [], setAttribute() {}, insertBefore() {}, remove() {}, focus() {}, select() {},
  content: { firstElementChild: null }, innerHTML: '', textContent: '', hidden: false, title: '',
});
const sandbox = {
  console, Date, Math, JSON, Intl, Number, String, Boolean, Array, Object, RegExp, Error, isNaN, parseInt, parseFloat,
  setTimeout, clearTimeout, Promise, Uint32Array, URL,
  localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  navigator: {},
  location: { pathname: '/my', search: '', hash: '', replace() {} },
  document: {
    documentElement: { setAttribute() {}, removeAttribute() {}, getAttribute: () => null },
    head: { appendChild() {} },
    body: { appendChild() {}, insertBefore() {}, classList: { add() {}, remove() {} }, firstChild: null },
    getElementById: () => null, querySelector: () => null, querySelectorAll: () => [],
    createElement: el, addEventListener() {}, readyState: 'complete',
  },
};
sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(`${ROOT}public/ui.js`, 'utf8'), sandbox, { filename: 'ui.js' });
const UI = sandbox.window.WingTrafficUI;

check('UI.TZ', UI.TZ, 'Asia/Ho_Chi_Minh');
check('UI.atShort: chuỗi UTC của CSDL -> giờ VN', UI.atShort('2026-11-01 11:39:32'), '18:39 01/11');
check('UI.atDay: ngày theo giờ VN', UI.atDay('2026-11-01'), '01/11/2026');
check('UI.atTime', UI.atTime('2026-11-01 11:39:32'), '18:39:32');
check('UI.atShort nhận epoch ms (khung SSE)', UI.atShort(Date.parse('2026-11-01T11:39:32Z')), '18:39 01/11');
check('UI.atShort rỗng -> gạch ngang', UI.atShort(null), '—');
check('UI.dbTime giữ nguyên ISO có Z', UI.dbTime('2026-11-01T11:39:32Z').toISOString(), '2026-11-01T11:39:32.000Z');

// ---------- 3. wt-badge.js: thứ tự ưu tiên khi chèn badge ----------
function badgeRun({ inHead }) {
  const script = { src: 'https://wingtraffic.tech/wt-badge.js', parentNode: null };
  const head = el(); const body = el();
  script.parentNode = inHead ? head : body;
  const calls = { mounted: 0, domReady: 0 };
  const doc = {
    currentScript: script, head, body, documentElement: el(), readyState: 'loading',
    getElementById: () => null, querySelector: () => script, querySelectorAll: () => [],
    createElement: el,
    addEventListener: ev => { if (ev === 'DOMContentLoaded') calls.domReady++; },
  };
  body.insertBefore = () => { calls.mounted++; };
  const ctx = {
    console, Date, Math, JSON, Number, String, Object, Array, RegExp, Error, isNaN, parseInt, URL,
    setTimeout, clearTimeout, Uint32Array, Promise, document: doc,
    navigator: { clipboard: { writeText: () => Promise.resolve() } },
    sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    localStorage: { removeItem() {} },
  };
  ctx.window = ctx;
  ctx.window.crypto = { getRandomValues: a => { a[0] = 7; return a; } };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(`${ROOT}public/wt-badge.js`, 'utf8'), ctx, { filename: 'wt-badge.js' });
  return calls;
}
const inBody = badgeRun({ inHead: false });
check('badge đặt trong <body> -> chèn ngay', inBody.mounted, 1);
const inHead = badgeRun({ inHead: true });
check('badge đặt trong <head> -> KHÔNG chèn khi body chưa sẵn sàng', inHead.mounted, 0);
check('badge đặt trong <head> -> chờ DOMContentLoaded', inHead.domReady, 1);

console.log(`\n${failed ? `${failed} kiểm tra THẤT BẠI` : 'Tất cả kiểm tra PASS'}`);
process.exit(failed ? 1 : 0);
