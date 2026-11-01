import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUB = path.join(ROOT, 'public');
const PAGES = ['portal.html', 'pricing.html', 'login.html', 'index.html', 'campaign.html', 'my.html', 'admin.html'];

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name} ${extra}`); }
};
const read = f => fs.readFileSync(path.join(PUB, f), 'utf8');
const inlineScripts = html => [...html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/gi)]
  .filter(m => !/\bsrc=/.test(m[1]) && (!/\btype=/.test(m[1]) || /type="(?:text\/javascript|module|application\/javascript)"/.test(m[1])))
  .map(m => m[2]);
const idsIn = html => new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]));
const refsIn = src => new Set([...src.matchAll(/(?:\$\(|getElementById\()\s*'([^']+)'\s*\)/g)]
  .map(m => m[1])
  .filter(s => /^[\w-]+$/.test(s)));
const APP_MAIN = new Set(['index.html', 'campaign.html', 'my.html', 'admin.html']);
const INJECTED = new Set(['wtNav', 'wtUser', 'wtLogout', 'wtTheme', 'wtToasts', 'wtPromptIn']);

console.log('\n== Giao diện: bộ dùng chung và từng trang ==');
const uiCss = read('ui.css');
const uiJs = read('ui.js');

for (const page of PAGES) {
  const html = read(page);
  const scripts = inlineScripts(html);
  ok(`${page}: nạp /ui.css`, /<link[^>]+href="\/ui\.css"/.test(html));
  ok(`${page}: nạp /ui.js`, /<script[^>]+src="\/ui\.js"/.test(html));
  ok(`${page}: có khung <main>`, APP_MAIN.has(page) ? /<main[^>]*class="[^"]*\bmain\b/.test(html) : /<main\b/.test(html));

  const cnt = re => (html.match(re) || []).length;
  ok(`${page}: thẻ <style> / <script> / <main> / <body> đóng đủ`,
    cnt(/<style[\s>]/gi) === cnt(/<\/style>/gi) && cnt(/<script[\s>]/gi) === cnt(/<\/script>/gi)
    && cnt(/<main[\s>]/gi) === cnt(/<\/main>/gi) && cnt(/<body[\s>]/gi) === 1 && cnt(/<\/body>/gi) === 1 && cnt(/<\/head>/gi) === 1);

  let bad = '';
  scripts.forEach((src, i) => {
    try { new vm.Script(src, { filename: `${page}#script${i + 1}` }); }
    catch (e) { bad = `script${i + 1}: ${e.message}`; }
  });
  ok(`${page}: script hợp lệ cú pháp (${scripts.length} khối)`, !bad, bad);

  const ids = idsIn(html);
  const refs = new Set();
  scripts.forEach(src => refsIn(src).forEach(r => refs.add(r)));
  const missing = [...refs].filter(r => !ids.has(r) && !INJECTED.has(r));
  ok(`${page}: mọi id script gọi đều có trong HTML`, missing.length === 0, missing.length ? `thiếu: ${missing.join(', ')}` : '');

  ok(`${page}: không dùng alert()/confirm() gốc`, !/(^|[^.\w])(alert|confirm)\s*\(/.test(scripts.join('\n')));

  ok(`${page}: không tự định nghĩa lại token --primary`, !/--primary\s*:/.test(html));
}

console.log('\n== Trang bảng giá /bang-gia (public/pricing.html) ==');
const pricing = read('pricing.html');
ok('không còn thẻ gói (mô hình gói đã gỡ)', (pricing.match(/class="plan[ "]/g) || []).length === 0 && !pricing.includes('plan-flag'));
ok('không còn số liệu gói tháng/năm (tắt JS vẫn đọc đủ)', ['data-m-txt', 'data-y-txt', 'data-ytotal-txt', 'data-ysave-txt']
  .every(a => (pricing.match(new RegExp(a, 'g')) || []).length === 0));
ok('có bảng giá theo lượt + bậc giảm giá', pricing.includes('price-tbl') && pricing.includes('Giảm theo số lượng'));
ok('không còn bảng so sánh gói', !pricing.includes('cmp-tbl'));
ok('có FAQ dạng <details> (mở được, tốt cho SEO)', (pricing.match(/<details class="note">/g) || []).length === 6);
ok('không còn form gửi yêu cầu gói (đã thay bằng khối bắt đầu chạy)',
  !pricing.includes('id="askPlan"') && pricing.includes('id="bat-dau"'),
  'thiếu khối bắt đầu chạy');
ok('có JSON-LD cho Google', pricing.includes('"@type": "Product"') && pricing.includes('"@type": "FAQPage"')
  && pricing.includes('"@type": "BreadcrumbList"'));
ok('canonical + OG trỏ /bang-gia', pricing.includes('rel="canonical" href="{{PUBLIC_URL}}/bang-gia"'));
ok('được phép lập chỉ mục (khác 4 trang trong app)', /name="robots" content="index, follow/.test(pricing));
ok('có khối bắt đầu chạy dẫn tới đăng ký/đăng nhập', pricing.includes('href="/gioi-thieu#dang-ky"') && pricing.includes('href="/login"'));
ok('JS trang bảng giá chỉ còn nút sáng/tối (gắn vào sự kiện bấm, không đổi chế độ mỗi lần tải trang)', /addEventListener\('click', function \(\) \{ window\.WingTrafficUI\.themeButton\(\)/.test(pricing) && !/^\s*window\.WingTrafficUI\.themeButton\(\);/m.test(pricing));
ok('trang công khai chỉ có 3 chức năng: đăng ký / đăng nhập / bảng giá (không lộ /my /admin /campaign /test)',
  ['pricing.html','portal.html','login.html'].every(n => { const h = fs.readFileSync(path.join(ROOT, 'public', n), 'utf8'); return h.includes('/gioi-thieu#dang-ky') || n === 'portal.html' ? !/href="\/(my|admin|campaign|test)"|seed:admin|OmniLogin/.test(n === 'pricing.html' ? h.replace(/OmniLogin/g, '') : h) : false; }));
ok('có bảng NIÊM YẾT theo loại traffic (4 thẻ × 4 mốc thời gian ở lại)',
  (pricing.match(/class="tp" data-kind="/g) || []).length === 4 && (pricing.match(/data-tp="/g) || []).length === 16);
ok('mỗi thẻ traffic có nút "Mua ngay" trỏ tới khối bắt đầu chạy (tắt JS vẫn bấm được)',
  (pricing.match(/class="btn primary buy" href="#bat-dau"/g) || []).length === 4);
ok('nêu ngày hiệu lực của bảng giá niêm yết', /Giá trên được áp dụng từ ngày/.test(pricing));
ok('ghi rõ đơn vị tính là lượt xem + mốc thời gian ở lại',
  pricing.includes('Giá / lượt xem') && pricing.includes('60 giây'));

console.log('\n== ui.css: thành phần cốt lõi ==');
const CORE_CSS = ['main', 'page-head', 'card', 'card-head', 'toolbar', 'btn', 'badge', 'alert', 'msg', 'fields', 'hint',
  'tabs', 'toast', 'modal', 'tbl-wrap', 'note', 'sticky-bar', 'pbar', 'prog', 'empty-state', 'skeleton', 'hours', 'kv',
  'price-grid', 'plan', 'plan-flag', 'plan-price', 'price-tbl', 'cmp-tbl', 'seg', 'trust-grid', 'quote', 'faq', 'meter', 'plan-card',
  'tp-grid', 'tp', 'tp-head', 'tp-tbl'];
ok('ui.css định nghĩa đủ thành phần cốt lõi', CORE_CSS.every(c => uiCss.includes('.' + c)),
  CORE_CSS.filter(c => !uiCss.includes('.' + c)).join(', '));
ok('ui.css có chế độ tối theo hệ thống', /prefers-color-scheme:\s*dark/.test(uiCss));
ok('ui.css có chế độ tối/sáng do người dùng chọn', /html\[data-theme="dark"\]/.test(uiCss) && /html\[data-theme="light"\]/.test(uiCss));
ok('ui.css có responsive cho màn hình nhỏ', /@media \(max-width: 620px\)/.test(uiCss));
ok('ui.css có kiểu in ấn', /@media print/.test(uiCss));
ok('ui.css tôn trọng prefers-reduced-motion', /prefers-reduced-motion/.test(uiCss));

console.log('\n== ui.js: chạy được và đủ hàm dùng chung ==');
function bootUi() {
  const store = new Map();
  const el = () => ({
    hidden: false, dataset: {}, style: {}, classList: { add() {}, remove() {}, toggle() {} },
    addEventListener() {}, setAttribute() {}, removeAttribute() {}, appendChild() {}, remove() {}, focus() {},
    querySelector() { return el(); }, querySelectorAll() { return []; },
  });
  const doc = {
    readyState: 'complete', documentElement: { setAttribute() {}, removeAttribute() {} },
    body: el(), addEventListener() {}, removeEventListener() {},
    getElementById() { return null; }, querySelector() { return null; }, querySelectorAll() { return []; },
    createElement() { return el(); },
  };
  const sandbox = {
    window: { addEventListener() {}, localStorage: null },
    document: doc,
    localStorage: { getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, v), removeItem: k => store.delete(k) },
    navigator: {}, location: { replace() {}, pathname: '/', search: '', hash: '' },
    setTimeout: () => 0, clearTimeout: () => {}, fetch: async () => ({ ok: true, status: 200, json: async () => ({}) }),
    Promise, Intl, Date, Math, JSON, Number, String, Array, Set, Object, RegExp, isNaN, console,
  };
  sandbox.window.localStorage = sandbox.localStorage;
  vm.createContext(sandbox);
  new vm.Script(uiJs, { filename: 'ui.js' }).runInContext(sandbox);
  return sandbox.window.WingTrafficUI;
}
let UI = null, bootErr = '';
try { UI = bootUi(); } catch (e) { bootErr = e.message; }
ok('ui.js nạp không lỗi', !!UI, bootErr);
if (UI) {
  const fns = ['$', '$$', 'esc', 'clock', 'dur', 'num', 'pct', 'ago', 'when', 'node', 'ready', 'debounce',
    'api', 'withButton', 'toast', 'ok', 'fail', 'confirm', 'prompt', 'theme', 'themeButton', 'mount',
    'shortcuts', 'tabs', 'filterTable', 'sortTable', 'guard', 'copy', 'bindCopyButtons', 'shell', 'setSideBadge'];
  const missing = fns.filter(f => typeof UI[f] !== 'function');
  ok(`ui.js có đủ ${fns.length} hàm dùng chung`, missing.length === 0, missing.join(', '));
  ok('esc() chống XSS cơ bản', UI.esc('<b>"a"&\'b\'</b>') === '&lt;b&gt;&quot;a&quot;&amp;&#39;b&#39;&lt;/b&gt;');
  ok('clock() đổi giây -> m:ss', UI.clock(65) === '1:05' && UI.clock(0) === '0:00');
  ok('dur() đọc được theo phút/giờ', UI.dur(45) === '45 giây' && UI.dur(150) === '2 phút 30 giây' && UI.dur(3900) === '1 giờ 5 phút');
  ok('ago() xử lý giá trị rỗng', UI.ago(null) === '—');
  ok('pct() chia 0 trả về gạch ngang', UI.pct(3, 0) === '—' && UI.pct(1, 4) === '25%');
}

console.log('\n== server.mjs: phục vụ tài nguyên giao diện ==');
const server = fs.readFileSync(path.join(ROOT, 'server.mjs'), 'utf8');
ok('server.mjs khai báo /ui.css -> public/ui.css', /'\/ui\.css',\s*\['public\/ui\.css',\s*'text\/css; charset=utf-8'\]/.test(server));
ok('server.mjs khai báo /ui.js -> public/ui.js', /'\/ui\.js',\s*\['public\/ui\.js',\s*'text\/javascript; charset=utf-8'\]/.test(server));
ok('hai file này mở cho cả khách chưa đăng nhập', /'\/ui\.css', '\/ui\.js'/.test(server));
ok('có route phục vụ ASSETS trước khi tới PAGES', server.indexOf('ASSETS.has(url.pathname)') < server.indexOf('PAGES[url.pathname]'));
ok("server.mjs có route '/bang-gia' -> public/pricing.html", /'\/bang-gia':\s*'pricing\.html'/.test(server));
ok("bảng giá chỉ dành cho người đã đăng nhập (không có trong PUBLIC_PATHS), API gói đã gỡ", !/PUBLIC_PATHS = new Set\(\[[^\]]*'\/bang-gia'[^\]]*\]/.test(server)
  && !server.includes("'/api/plans'"));
ok('robots.txt không mở /bang-gia', !server.includes("'Allow: /bang-gia'"));
ok('sitemap.xml không còn /bang-gia', !server.includes('<loc>${PUBLIC_URL}/bang-gia</loc>'));

console.log('\n== api.mjs: mô hình gói/license đã gỡ ==');
const api = fs.readFileSync(path.join(ROOT, 'api.mjs'), 'utf8');
ok('không còn route gói', !/p === '\/api\/(plans|my-plan|plan-request)'/.test(api));
ok('không còn handlePlans trong danh sách handler', !/handlePlans/.test(api));
ok('không còn hạn mức max_slots/maxSlots', !/max_slots|maxSlots/.test(api));
ok('không import plans.mjs và file đó đã xoá', !api.includes('plans.mjs') && !fs.existsSync(path.join(ROOT, 'plans.mjs')));
ok('NEW_PATHS không còn nhánh plans/my-plan/plan-request', !/plans\|my-plan\|plan-request/.test(api));

console.log('\n== ví & ngân sách (mục 21 HDSD) ==');
const myHtml = read('my.html');
const adminHtml = read('admin.html');
const walletSrc = fs.readFileSync(path.join(ROOT, 'wallet.mjs'), 'utf8');
ok('/my: thanh bên Aurora có menu (Thống kê, Chiến dịch, Tạo chiến dịch, Ngân sách, Bảng giá, Tài khoản) + nút "Tạo chiến dịch" màu cam ở thanh trên',
  myHtml.includes('<aside class="app-side" id="appSide"') && myHtml.includes('<header class="app-top">') && myHtml.includes('class="btn cta" href="#tao-chien-dich"')
  && ['thong-ke', 'chien-dich', 'tao-chien-dich', 'ngan-sach', 'bang-gia', 'tai-khoan-cua-toi'].every(v => myHtml.includes(`data-nav="${v}"`))
  && !myHtml.includes('data-nav="thong-bao"'));
ok('/my: có thanh trên (chuông thông báo, chế độ sáng/tối, menu tài khoản, đăng xuất; sideToggle/sideBack giữ ẩn cho WingTrafficUI.shell)',
  ['sideToggle', 'sideBack', 'wtTheme', 'userName', 'btnLogout', 'snNotifBadge', 'uMenu'].every(id => myHtml.includes(`id="${id}"`)));
ok('/my: 4 màn hình (data-view) cho user, dùng khung chung WingTrafficUI.shell; Thông báo mở từ liên kết "Các thông báo khác" (không có mục menu)',
  ['thong-ke', 'chien-dich', 'tao-chien-dich', 'ngan-sach'].every(v => myHtml.includes(`data-view="${v}"`))
  && myHtml.includes("'thong-bao': { title: 'Thông báo', group: null }")
  && myHtml.includes('UI.shell(') && myHtml.includes("notifs: 'thong-bao'") && myHtml.includes('<body class="has-shell my">')
  && /UI\.shell = function/.test(uiJs) && uiJs.includes("addEventListener('hashchange'"));
ok('/my: màn Thống kê có 3 thẻ số liệu màu (đang chạy, lượt hôm nay, số dư) + nút "+ Nạp thêm"',
  myHtml.includes('id="tiles"') && myHtml.includes('Chiến dịch đang chạy') && myHtml.includes('Lượt chạy hôm nay') && myHtml.includes('+ Nạp thêm')
  && myHtml.includes('js-topup'));
ok('/my: màn Thống kê có báo cáo theo ngày (dòng Tổng) + biểu đồ + traffic theo từ khóa',
  ['tblDaily', 'chart', 'chartCampaign', 'chartType', 'chartMonth', 'chFrom', 'chTo'].every(id => myHtml.includes(`id="${id}"`)) && myHtml.includes('function drawDaily')
  && ['Số hiển thị', 'Lượt truy cập', 'Chi phí (đ)', 'Ctr (%)', 'Đồ thị chiến dịch'].every(t => myHtml.includes(t)) && ['1m', '3m', '6m', 'ytd', '1y', 'all'].every(z => myHtml.includes(`data-zoom="${z}"`)));
ok('/my: danh sách chiến dịch có tab lọc theo trạng thái + ô lọc ID/từ khóa/domain + nút "+ Thêm chiến dịch"',
  ['campTabs', 'fId', 'fSearch', 'fDomain', 'btnFind'].every(id => myHtml.includes(`id="${id}"`))
  && myHtml.includes('Không được duyệt') && myHtml.includes('+ Thêm chiến dịch'));
ok('/my: màn Ngân sách có 5 thẻ (còn lại, đã chạy, đã nạp, khuyến mại, tổng) + giao dịch nạp tiền / khuyến mại',
  myHtml.includes('id="balTiles"') && ['Ngân sách còn lại', 'Ngân sách đã chạy', 'Ngân sách đã nạp', 'Khuyến mại', 'Tổng ngân sách'].every(t => myHtml.includes(t))
  && ['txnTabs', 'tblTxn', 'btnWalletReload'].every(id => myHtml.includes(`id="${id}"`)) && myHtml.includes('data-kind="topup"') && myHtml.includes('data-kind="bonus"'));
ok('/my: KHÔNG liệt kê tiền trừ từng chiến dịch (bảng chiến dịch không có cột "Đã chạy"/tiền, không tải giao dịch kind=spend, không đọc wallet.campaigns)',
  !/<table id="tblCampaigns"[^>]*>[\s\S]*?<\/table>/.exec(myHtml)[0].includes('Đã chạy')
  && !myHtml.includes('paintSpent') && !myHtml.includes('kind=spend') && !myHtml.includes('SPENT') && !/WALLET\.(campaigns|txns)/.test(myHtml));
ok('/my: "+ Nạp thêm" mở hộp thoại thông tin ví nhận tiền của admin (có nút Sao chép)',
  ['topupModal', 'topupBody', 'topupClose'].every(id => myHtml.includes(`id="${id}"`)) && myHtml.includes('function openTopup') && myHtml.includes('data-copy='));
ok('trang /my tải ví qua API và cập nhật theo luồng realtime',
  myHtml.includes("api('/api/wallet')") && myHtml.includes('d.wallet.balance !== balLast'));
ok('/my: user KHÔNG thấy Lượt chạy gần đây / Đang chạy / Thông báo / trạng thái engine (DOM nằm trong <div hidden>, không có mục menu)',
  /<div hidden>\s*<details class="card fold" id="runsCard">/.test(myHtml)
  && /<div hidden>\s*<div class="live"/.test(myHtml) && /<div id="annBox" hidden>/.test(myHtml) && myHtml.includes('» Các thông báo khác')
  && !myHtml.includes('href="#thong-bao" data-nav') && myHtml.includes('href="#thong-bao" id="bell"')
  && ['tblRuns', 'tblWorkers', 'liveEvents'].every(id => myHtml.includes(`id="${id}"`))
  && ['notifs', 'btnReadAll'].every(id => myHtml.includes(`id="${id}"`)));
ok('/my: mục quản trị (Quản trị, Cấu hình chạy, Chạy thử) chỉ hiện cho admin', myHtml.includes('id="adminLinks" hidden') && myHtml.includes("$('adminLinks').hidden = me.role !== 'admin'"));
const serverCtl = fs.readFileSync(path.join(ROOT, 'server-control.mjs'), 'utf8');
const startBat = fs.readFileSync(path.join(ROOT, 'start.bat'), 'utf8');
ok('server-control: đọc file .mjs/.env đã sửa sau lúc khởi động (code cũ/mới), file public/ không tính, khởi động lại thoát mã 75 khi chạy bằng start.bat',
  /export function serverStatus/.test(serverCtl) && /export function scheduleRestart/.test(serverCtl) && /RESTART_EXIT_CODE = 75/.test(serverCtl)
  && serverCtl.includes("OMNI_SUPERVISED === '1'") && /SCAN_DIRS = \['', 'workflow', 'database', 'auth'\]/.test(serverCtl) && !serverCtl.includes("'public'"));
ok('API /api/server/status + /api/server/restart chỉ cho admin (adminOnly) và nằm trong NEW_PATHS',
  /p === '\/api\/server\/status'\) \{\s*adminOnly\(\)/.test(api) && /p === '\/api\/server\/restart'\) \{\s*adminOnly\(\)/.test(api) && /settings\|server(\|export)?(\|account)?\)/.test(api));
ok('start.bat đặt OMNI_SUPERVISED=1 và chạy lại server khi thoát mã 75 (cùng cửa sổ)',
  startBat.includes('set "OMNI_SUPERVISED=1"') && startBat.includes(':run') && /if errorlevel 75 if not errorlevel 76/.test(startBat) && startBat.includes('goto run'));
ok('/admin: màn "Máy chủ" (trạng thái code cũ/mới, danh sách file đã sửa, nút Khởi động lại có xác nhận) + biểu ngữ cảnh báo ở Tổng quan + huy hiệu menu',
  adminHtml.includes('data-view="may-chu"') && adminHtml.includes('data-nav="may-chu"') && adminHtml.includes('id="btnSrvRestart"') && adminHtml.includes('id="btnSrvRestart2"')
  && adminHtml.includes('id="srvBanner"') && adminHtml.includes('id="snSrvBadge"') && adminHtml.includes('function restartServer') && adminHtml.includes('/api/server/restart') && adminHtml.includes('CODE CŨ') && adminHtml.includes('CODE MỚI NHẤT'));
ok('Vị trí Google 2 dòng (máy tính trên, điện thoại dưới, "-" khi không có) + cột "Cập nhật vị trí" ở /my và /admin; lịch 15–45 phút ở repo',
  [myHtml, adminHtml].every(h => h.includes('Cập nhật vị trí') && h.includes('function rankTimeText') && h.includes('id="rt${c.id}"') &&h.includes("rankPos(r.desktop)") && h.includes("rankPos(r.mobile)") && h.includes("'-'"))
  && /RANK_MIN_MINUTES = 15/.test(fs.readFileSync(path.join(ROOT, 'database/repo.mjs'), 'utf8')) && /RANK_MAX_MINUTES = 45/.test(fs.readFileSync(path.join(ROOT, 'database/repo.mjs'), 'utf8'))
  && /CREATE TABLE IF NOT EXISTS campaign_ranks/.test(fs.readFileSync(path.join(ROOT, 'database/init.mjs'), 'utf8')));
ok('"/" chuyển hướng: đã đăng nhập -> /admin (admin) hoặc /my (user); chưa đăng nhập -> /login',
  /url\.pathname === '\/'\) \{\s*if \(user\) return redirect\(res, user\.role === 'admin' \? '\/admin' : '\/my'\);\s*return redirect\(res, AUTH_REQUIRED \? '\/login' : '\/admin'\)/.test(server)
  && server.indexOf("url.pathname === '/') {") < server.indexOf('ASSETS.has(url.pathname)'));
ok('trang giới thiệu + form đăng ký nằm ở /gioi-thieu (công khai, canonical/sitemap/robots theo địa chỉ mới)',
  /'\/gioi-thieu': 'portal\.html'/.test(server) && /PUBLIC_PATHS = new Set\(\['\/', '\/gioi-thieu'/.test(server)
  && server.includes('<loc>${PUBLIC_URL}/gioi-thieu</loc>') && server.includes("'Allow: /gioi-thieu'")
  && (p => p.includes('{{PUBLIC_URL}}/gioi-thieu') && !/href="\/"/.test(p))(fs.readFileSync(path.join(ROOT, 'public', 'portal.html'), 'utf8'))
  && !pricing.includes('href="/"'));
ok('server.mjs gọi gateGuard trước cổng đăng nhập (khách ngoài chưa nhập mật khẩu thì không thấy gì)',
  /import \{ gateGuard(, clientIp)?(, isExternalRequest)? \} from '\.\/gate\.mjs'/.test(server) && server.indexOf('gateGuard({ req, res, url') > 0 && server.indexOf('gateGuard({ req, res, url') < server.indexOf('let user = await currentUser(req)', server.indexOf('http.createServer')));
ok('API cũ của engine (/api/campaign, /api/config, /api/run, /api/profiles, /api/job) bị chặn với người không phải admin',
  /LEGACY_ADMIN_API = \/\^\\\/api\\\/\(profiles\|config\|run\|job/.test(server) && /LEGACY_ADMIN_API\.test\(url\.pathname\) && user\?\.role !== 'admin'/.test(server)
  && ['/api/profiles', '/api/config', '/api/run', '/api/job/1', '/api/campaign', '/api/campaign/start', '/api/campaign/stop', '/api/campaign/telegram-test', '/api/campaign/omnilogin']
    .every(p => new RegExp(server.match(/LEGACY_ADMIN_API = (\/.*\/);/)[1].slice(1, -1)).test(p))
  && !new RegExp(server.match(/LEGACY_ADMIN_API = (\/.*\/);/)[1].slice(1, -1)).test('/api/campaigns'));
ok('qua tunnel/tên miền: tài khoản admin vô hiệu + trang /admin /campaign /test trả 404 + admin không đăng nhập được (ADMIN_EXTERNAL=1 mới mở)',
  /external && process\.env\.ADMIN_EXTERNAL !== '1'/.test(server) && /if \(user\?\.role === 'admin'\) user = null/.test(server)
  && /user\.role === 'admin' && isExternalRequest\(req\) && process\.env\.ADMIN_EXTERNAL !== '1'/.test(server));
ok('cookie đăng nhập có Secure khi đi qua HTTPS (x-forwarded-proto / cf-visitor)', /setTokenCookie\(res, token, req\)/.test(server) && /viaHttps/.test(server));
ok('API /api/server/gate chỉ cho admin (adminOnly), không trả mật khẩu/hash',
  /p === '\/api\/server\/gate'\) \{\s*adminOnly\(\)/.test(api) && /readGate\(repo\)/.test(api) && !/password_hash[^\n]*send\(/.test(api.slice(api.indexOf("'/api/server/gate'"), api.indexOf("'/api/server/gate'") + 1600)));
ok('/admin → Máy chủ có khung cài mật khẩu truy cập từ ngoài (bật/tắt, mật khẩu mới, tạo ngẫu nhiên, sao chép, lưu)',
  ['gateCard', 'gateEnabled', 'gatePass', 'btnGateGen', 'btnGateCopy', 'btnGateSave', 'gateState'].every(id => adminHtml.includes(`id="${id}"`)) && adminHtml.includes('/api/server/gate') && adminHtml.includes('function saveGate'));
ok('/admin: màn "Chi tiết tài khoản" (thông tin + thao tác quản lý, 5 thẻ số liệu, tiến độ từng chiến dịch, traffic 30 ngày, giao dịch, lượt chạy gần đây)',
  adminHtml.includes('data-view="tai-khoan-chi-tiet"') && ['udHead', 'udTiles', 'tblUdCamps', 'udChart', 'tblUdDaily', 'tblUdTxn', 'tblUdRuns'].every(id => adminHtml.includes(`id="${id}"`))
  && adminHtml.includes('/api/users/${id}/progress') && adminHtml.includes('function loadUserDetail') && adminHtml.includes('function udAction') && /nav: 'tai-khoan'/.test(adminHtml));
ok('/admin: bảng Tài khoản có nút "Quản lý" và tên đăng nhập bấm được dẫn tới chi tiết', adminHtml.includes('href="#tai-khoan-chi-tiet/${u.id}"') && adminHtml.includes('>Quản lý</a>'));
ok('khung điều hướng hỗ trợ hash có tham số (#màn/giá-trị) và mục menu cha (nav)', /var i = h\.indexOf\('\/'\)/.test(uiJs) && uiJs.includes('cfg.onView(name, arg || \'\')') && uiJs.includes('views[name].nav || name'));
ok('API tiến độ tài khoản chỉ cho admin (handleUsers có adminOnly) và tính tổng/tiền đã trừ từng chiến dịch',
  /\/progress\$\//.test(api) && /progressByUser/.test(api) && /progressByUser: userId =>/.test(fs.readFileSync(path.join(ROOT, 'database', 'repo.mjs'), 'utf8')));
ok('/my: nút "Xoá" được thay bằng "Ẩn" (+ "Bỏ ẩn"), có tab "Đã ẩn", không còn gọi DELETE chiến dịch',
  myHtml.includes('data-hide=') && myHtml.includes('data-unhide=') && myHtml.includes('function hideCampaign') && myHtml.includes("['hidden', 'Đã ẩn'")
  && !myHtml.includes('data-del=') && !myHtml.includes('removeCampaign') && !/method: 'DELETE'/.test(myHtml) && myHtml.includes('/hide`'));
ok('/my: nút "Xuất Excel" (mọi chiến dịch, kể cả đã ẩn, từ khi tạo tài khoản) trỏ tới /api/export/campaigns.xlsx', myHtml.includes('id="btnExport"') && myHtml.includes('href="/api/export/campaigns.xlsx"'));
ok('API: khách gọi DELETE chiến dịch bị 403; có /hide cho chủ sở hữu; chiến dịch ẩn không chạy/sửa được; xuất Excel có kiểm quyền',
  /if \(!isAdmin\) throw fail\(403, 'Bạn không xoá được chiến dịch/.test(api) && /\/hide\$\//.test(api) && api.includes('Chiến dịch đang ẩn — hãy bỏ ẩn trước khi chạy') && api.includes('Chiến dịch đang ẩn — hãy bỏ ẩn trước khi sửa')
  && /handleExport/.test(api) && /\/api\/export\/campaigns\.xlsx/.test(api));
ok('/admin: chiến dịch khách đã ẩn được gắn nhãn; có nút xuất Excel từng tài khoản (danh sách + chi tiết) và nhắc xuất trước khi xoá tài khoản',
  adminHtml.includes('khách đã ẩn') && (adminHtml.match(/\/api\/export\/campaigns\.xlsx\?userId=/g) || []).length >= 2 && adminHtml.includes('trước khi xoá'));
ok('đăng nhập có giới hạn thử sai (8 lần/10 phút theo IP+tên, 30 lần/10 phút theo IP) và trả 429 + Retry-After',
  /loginFailByUser = rateLimiter\(\{ limit: 8/.test(server) && /loginFailByIp = rateLimiter\(\{ limit: 30/.test(server) && /send\(res, 429/.test(server) && server.indexOf('loginFailByUser.check') < server.indexOf('deps.findUser.get(username)'));
ok('token cấp trước lần đổi mật khẩu bị thu hồi: server kiểm tokenIsStale, auth trả iat, đổi/đặt lại mật khẩu ghi pw_changed_at',
  server.includes('deps.auth.tokenIsStale(iat, row.pw_changed_at)') && /export function tokenIsStale/.test(fs.readFileSync(path.join(ROOT, 'auth', 'auth.mjs'), 'utf8')) && (api.match(/pw_changed_at: Date\.now\(\)|patch\.pw_changed_at = Date\.now\(\)/g) || []).length >= 2);
ok('trang 404 có giao diện (cho trình duyệt) + favicon logo WingTraffic (/favicon.png) dùng chung mọi trang; /favicon.svg, /favicon.ico chuyển hướng sang đó',
  server.includes('function notFoundPage') && server.includes("url.pathname === '/favicon.svg'") && server.includes("redirect(res, '/favicon.png')")
  && /rel = 'icon'/.test(uiJs) && /'\/favicon\.png'/.test(uiJs)
  && ['/logo-icon.png', '/logo-full.png', '/favicon.png'].every(p => server.includes(`'${p}'`) && fs.existsSync(path.join(ROOT, 'public', p.slice(1)))));
ok('sao lưu CSDL tự động khi server chạy + admin tải/xem danh sách ở Máy chủ',
  server.includes('startAutoBackup') && adminHtml.includes('id="tblBackups"') && adminHtml.includes('/api/server/backup') && adminHtml.includes('function loadBackups') && fs.existsSync(path.join(ROOT, 'backup.mjs')));
ok('/my: trang "Tài khoản của tôi" (đổi tên hiển thị, đổi mật khẩu) nằm trong menu Tài khoản & Nạp tiền',
  myHtml.includes('data-view="tai-khoan-cua-toi"') && myHtml.includes('data-nav="tai-khoan-cua-toi"') && ['acName', 'acCur', 'acNew', 'acNew2', 'btnAcPass', 'btnAcName'].every(id => myHtml.includes(`id="${id}"`)) && myHtml.includes('/api/account/password') && myHtml.includes('function changeAccountPassword'));
ok('/admin: doanh thu ở Tổng quan, duyệt hàng loạt ở Chờ duyệt',
  ['revTiles', 'tblTopUsers', 'pendAll', 'btnApproveSel'].every(id => adminHtml.includes(`id="${id}"`)) && adminHtml.includes('/api/stats/revenue') && adminHtml.includes('function approveMany') && adminHtml.includes('class="pendChk"'));
ok('engine báo khách sắp hết số dư (một lần/ngày) trước khi chiến dịch tạm dừng', /warnLowBalance\(task, amount\)/.test(fs.readFileSync(path.join(ROOT, 'campaign.mjs'), 'utf8')) && /Số dư sắp hết/.test(fs.readFileSync(path.join(ROOT, 'campaign.mjs'), 'utf8')));
ok('có script cài / gỡ tự khởi động cùng Windows (Task Scheduler)', fs.existsSync(path.join(ROOT, 'tu-khoi-dong', 'cai-tu-khoi-dong.bat')) && fs.existsSync(path.join(ROOT, 'tu-khoi-dong', 'go-tu-khoi-dong.bat')) && /schtasks \/Create/.test(fs.readFileSync(path.join(ROOT, 'tu-khoi-dong', 'cai-tu-khoi-dong.bat'), 'utf8')));
const ADMIN_VIEWS = ['tong-quan', 'cho-duyet', 'chien-dich', 'tai-khoan', 'nap-tien', 'giao-dich', 'thong-bao', 'nhat-ky'];
ok('/admin: thanh bên + thanh trên + 8 màn hình (data-nav / data-view) dùng khung chung WingTrafficUI.shell',
  adminHtml.includes('<body class="has-shell">') && adminHtml.includes('id="appSide"') && adminHtml.includes('id="sideToggle"')
  && ADMIN_VIEWS.every(v => adminHtml.includes(`data-nav="${v}"`) && adminHtml.includes(`data-view="${v}"`))
  && adminHtml.includes('UI.shell('));
ok('/admin: màn Tổng quan có thẻ màu (đang chạy, chờ duyệt, lượt hôm nay, tài khoản, tổng số dư) + bảng theo ngày + luồng đang chạy',
  ['tiles', 'tblDaily', 'chart', 'tblWorkers', 'btnStartAll', 'btnStopAll'].every(id => adminHtml.includes(`id="${id}"`))
  && ['Chiến dịch đang chạy', 'Chờ duyệt', 'Lượt chạy hôm nay', 'Tài khoản hoạt động', 'Tổng số dư của khách'].every(t => adminHtml.includes(t)));
ok('/admin: sửa chiến dịch là hộp thoại (modal) có Lưu / Duyệt & chạy / Từ chối / Xoá hẳn',
  /<div class="modal wide" id="editCard" hidden>/.test(adminHtml) && ['btnSaveEdit', 'btnApprove', 'btnReject', 'btnDelete', 'btnCloseEdit'].every(id => adminHtml.includes(`id="${id}"`)));
ok('/admin: từ chối chiến dịch và đặt lại mật khẩu dùng hộp thoại của app (UI.prompt), không dùng prompt() gốc',
  adminHtml.includes('UI.prompt(') && !/(^|[^.\w])prompt\s*\(/.test(adminHtml.replace(/<script src[^>]*><\/script>/g, '')));
ok('/admin: huy hiệu chờ duyệt + thông báo trên thanh bên', ['snPendBadge', 'snNotifBadge'].every(id => adminHtml.includes(`id="${id}"`)) && adminHtml.includes('UI.setSideBadge('));
ok('ui.css: có quy tắc điện thoại (≤900px vùng bấm + ô nhập 16px; ≤900px bảng thành thẻ; ≤620px thẻ số liệu 2 cột)',
  /@media \(max-width: 900px\)[^{]*\{[^@]*font-size: 16px/.test(uiCss) && uiCss.includes('.btn { min-height: 40px; }')
  && /@media \(max-width: 900px\) \{\s+\.tbl-wrap\.stack/.test(uiCss) && uiCss.includes('.tbl-stack td::before { content: attr(data-label)')
  && /@media \(max-width: 620px\)[^{]*\{[^@]*\.tiles, \.tiles\.t5 \{ grid-template-columns: 1fr 1fr/.test(uiCss));
for (const [page, html, ids] of [['my', myHtml, ['tblCampaigns', 'tblTxn']], ['admin', adminHtml, ['tblPending', 'tblCampaigns', 'tblUsers', 'tblWallet']]]) {
  ok(`/${page}: bảng thao tác dùng tbl-stack + nhãn cột data-label (hiện thành thẻ trên điện thoại)`,
    ids.every(id => new RegExp(`<table id="${id}" class="tbl-stack">`).test(html))
    && (html.match(/data-label="[^"]*"/g) || []).length >= ids.length * 5
    && (html.match(/<div class="tbl-wrap stack">/g) || []).length >= ids.length);
  ok(`/${page}: biểu đồ vẽ theo bề rộng khung + vẽ lại khi đổi cỡ màn hình (chữ trục đọc được trên điện thoại)`,
    html.includes('el.clientWidth') && html.includes('function redrawChart') && html.includes("addEventListener('resize'") && !html.includes('const W = 1000'));
}
ok('ui.js có UI.shell + UI.setSideBadge; ui.css có khung ứng dụng (thanh bên, thanh trên, thẻ màu, thu gọn trên điện thoại)',
  /UI\.shell = function/.test(uiJs) && /UI\.setSideBadge = function/.test(uiJs)
  && ['.app-side', '.app-top', '.tile', '.sn-group', '.ctabs', '.pill'].every(c => uiCss.includes(c)) && /body\.side-open \.app-side/.test(uiCss));
ok('trang /admin có đủ ô của ví nhận tiền + nạp tiền + điều chỉnh',
  ['walletUsdtAddress', 'walletUsdtNetwork', 'walletUsdtRate', 'walletBankName', 'walletAccountNo', 'walletAccountName', 'walletNote', 'btnSaveWallet',
    'payUser', 'topUsdt', 'topRate', 'topNote', 'btnTopup', 'adjAmount', 'adjNote', 'btnAdjust'].every(id => adminHtml.includes(`id="${id}"`)));
ok('trang /admin có sổ giao dịch ví + bộ lọc',
  ['tblWallet', 'walletUserFilter', 'walletKindFilter', 'btnWalletTxns', 'txnCount'].every(id => adminHtml.includes(`id="${id}"`)));
ok('bảng tài khoản ở /admin có cột Số dư và Đã chạy',
  adminHtml.includes('<th class="num">Số dư</th>') && adminHtml.includes('<th class="num">Đã chạy</th>'));
ok('api.mjs có đủ route ví', /'\/api\/wallet\/topup'/.test(api) && /'\/api\/wallet\/adjust'/.test(api) && /'\/api\/settings\/wallet'/.test(api)
  && /wallet\|settings/.test(api));
ok('server.mjs không cần route ví riêng (api.mjs lo hết)', !/\/api\/wallet/.test(server));
ok('wallet.mjs có luật "lượt nào mới trừ tiền"', /chargeableRun/.test(walletSrc) && /visitCost/.test(walletSrc));
ok('engine trừ tiền + tạm dừng khi ví hết tiền (campaign.mjs)',
  /chargeVisit/.test(fs.readFileSync(path.join(ROOT, 'campaign.mjs'), 'utf8'))
  && /pauseForWallet/.test(fs.readFileSync(path.join(ROOT, 'campaign.mjs'), 'utf8')));
ok('engine chỉ lấy chiến dịch khi ví còn đủ tiền (campaign-store.mjs)',
  /walletAfford/.test(fs.readFileSync(path.join(ROOT, 'campaign-store.mjs'), 'utf8')));
ok('bảng chiến dịch ở /my có cột "Vị trí Google" (tách máy tính / di động)',
  myHtml.includes('<th class="ctr">Vị trí Google</th>') && myHtml.includes('rankText('));
ok('bảng lượt chạy ở /my có cột "Thiết bị"', myHtml.includes('<th>Thiết bị</th>') && myHtml.includes('deviceLabel('));
ok('bảng chiến dịch ở /admin có cột "Vị trí Google"', adminHtml.includes('<th>Vị trí Google</th>') && adminHtml.includes('paintRanks()'));
ok('hai trang dặn KHÔNG dán URL vào ô từ khóa + tự tách khi dán',
  myHtml.includes('đừng dán URL') && adminHtml.includes('đừng dán URL')
  && myHtml.includes("bindKeywordSplit('fKeyword', 'fUrl')") && adminHtml.includes("bindKeywordSplit('eKeyword', 'eUrl')"));
ok('luật tách URL khỏi từ khóa nằm ở campaign-types.mjs và api.mjs dùng lại',
  /export function splitKeywordUrl/.test(fs.readFileSync(path.join(ROOT, 'campaign-types.mjs'), 'utf8')) && /splitKeywordUrl/.test(api));
ok('log/ lỗi "không thấy URL" kèm tên miền đã thấy (phân biệt sai từ khóa vs URL chưa lên hạng)',
  /Tên miền đã thấy/.test(fs.readFileSync(path.join(ROOT, 'workflow', 'google-search.mjs'), 'utf8'))
  && /Không tìm thấy URL/.test(fs.readFileSync(path.join(ROOT, 'workflow', 'worker.mjs'), 'utf8')));
ok('có lệnh sửa dữ liệu cũ + ghi vị trí theo thiết bị trong CSDL',
  fs.existsSync(path.join(ROOT, 'database/fix-keywords.mjs')) && /db:fix-keywords/.test(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
  && /device_kind/.test(fs.readFileSync(path.join(ROOT, 'database', 'init.mjs'), 'utf8')));
ok('có ô "Kiểu truy vấn gõ lên Google" (Chỉ từ khóa / Từ khóa + tên miền) ở /my và /admin',
  myHtml.includes('id="fQueryMode"') && myHtml.includes('id="eQueryMode"') && adminHtml.includes('id="eQueryMode"')
  && /queryModes/.test(myHtml) && /queryModes/.test(adminHtml)
  && /QUERY_MODES/.test(fs.readFileSync(path.join(ROOT, 'campaign-types.mjs'), 'utf8'))
  && /queryModes: QUERY_MODES/.test(api));
ok('engine gõ truy vấn theo kiểu truy vấn + lưu lại truy vấn đã gõ (site chưa lên hạng)',
  /searchQuery\(\{ keyword, targetUrl: target\?\.raw \|\| '', queryMode \}\)/.test(fs.readFileSync(path.join(ROOT, 'workflow', 'google-search.mjs'), 'utf8'))
  && /query: res\.result\?\.query/.test(fs.readFileSync(path.join(ROOT, 'campaign.mjs'), 'utf8'))
  && /ensureColumn\('runs', 'query'/.test(fs.readFileSync(path.join(ROOT, 'database', 'init.mjs'), 'utf8'))
  && /query_mode/.test(fs.readFileSync(path.join(ROOT, 'database', 'repo.mjs'), 'utf8')));
ok('lượt THẤT BẠI ("không thấy URL") vẫn ghi được truy vấn: lỗi riêng NotFoundError + worker trả `query`',
  /export class NotFoundError extends Error/.test(fs.readFileSync(path.join(ROOT, 'workflow', 'google-search.mjs'), 'utf8'))
  && /throw new NotFoundError\(/.test(fs.readFileSync(path.join(ROOT, 'workflow', 'google-search.mjs'), 'utf8'))
  && /NotFoundError/.test(fs.readFileSync(path.join(ROOT, 'workflow', 'worker.mjs'), 'utf8'))
  && /query: err instanceof NotFoundError \? err\.query/.test(fs.readFileSync(path.join(ROOT, 'workflow', 'worker.mjs'), 'utf8'))
  && /res\.result\?\.query \|\| res\.query/.test(fs.readFileSync(path.join(ROOT, 'campaign.mjs'), 'utf8')));
ok('ô "Luồng chạy song song tối đa" chỉ có ở /admin (user không chọn được; API bỏ qua maxThreads của user)',
  !myHtml.includes('MaxThreads') && !myHtml.includes('fillThreadCaps') && adminHtml.includes('id="eMaxThreads"') && /canSetThreads: isAdmin/.test(api)
  && !myHtml.includes('Luồng chạy song song tối đa') && adminHtml.includes('Luồng chạy song song tối đa')
  && /maxThreadsPerCampaign/.test(adminHtml)
  && /maxThreadsPerCampaign: MAX_THREADS/.test(api));
ok('CSDL + API lưu số luồng riêng của chiến dịch (max_threads) và trả lại cho giao diện',
  /ensureColumn\('campaigns', 'max_threads'/.test(fs.readFileSync(path.join(ROOT, 'database', 'init.mjs'), 'utf8'))
  && /'max_threads'/.test(fs.readFileSync(path.join(ROOT, 'database', 'repo.mjs'), 'utf8'))
  && /maxThreads: 'max_threads'/.test(api) && /maxThreads: Math\.max\(1, Math\.min\(Number\(r\.max_threads\)/.test(api)
  && /Số luồng tối đa của chiến dịch phải trong khoảng/.test(api));
ok('engine cho một chiến dịch chiếm nhiều luồng theo max_threads (đếm luồng đang chạy của từng chiến dịch)',
  /taskThreads\(task\)/.test(fs.readFileSync(path.join(ROOT, 'campaign.mjs'), 'utf8'))
  && /inflight\.get\(t\.id\) \|\| 0\) >= this\.taskThreads\(t\)/.test(fs.readFileSync(path.join(ROOT, 'campaign.mjs'), 'utf8'))
  && /maxThreads: clampInt\(r\.max_threads, 1, MAX_THREADS, 1\)/.test(fs.readFileSync(path.join(ROOT, 'campaign.mjs'), 'utf8'))
  && /capBlocked/.test(fs.readFileSync(path.join(ROOT, 'campaign-pace.mjs'), 'utf8'))
  && /export const MAX_THREADS = 30/.test(fs.readFileSync(path.join(ROOT, 'campaign-pace.mjs'), 'utf8')));

console.log(`\nKết quả: ${pass} PASS, ${fail} FAIL`);
process.exit(fail ? 1 : 0);

