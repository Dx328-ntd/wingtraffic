
import fs from 'node:fs/promises';
import path from 'node:path';
import { execSync } from 'node:child_process';

const ROOT = process.cwd();
const WF   = path.join(ROOT, 'workflow');
const PUB  = path.join(ROOT, 'public');

const CAPTCHA_MJS = `// Giải captcha Google /sorry bằng NopeCHA (chỉ dùng cho lần tìm kiếm đầu tiên).
import { Configuration, NopeCHAApi } from 'nopecha';
import { pollUntil } from './runner.mjs';

let client = null;
let clientKey = '';

function getNopecha(apiKey) {
  if (!apiKey) throw new Error('Chưa cấu hình NopeCHA API key.');
  if (!client || clientKey !== apiKey) {
    client = new NopeCHAApi(new Configuration({ apiKey }));
    clientKey = apiKey;
  }
  return client;
}

const parse = url => { try { return new URL(url); } catch { return null; } };
const isSorry = u => !!u && (u.pathname.startsWith('/sorry')
  || u.hostname.startsWith('ipv4.google') || u.hostname.startsWith('ipv6.google'));

export async function solveGoogleSorry(page, { apiKey, log = console.log, timeout = 90 }) {
  try {
    log('  🤖 NopeCHA: đang đọc ảnh captcha trên trang /sorry ...');
    const img = page.locator('img#captcha, img[src*="captcha"], form img').first();
    if (!(await img.count())) { log('  NopeCHA: không tìm thấy ảnh captcha.'); return false; }
    const src = await img.getAttribute('src');
    if (!src) { log('  NopeCHA: ảnh captcha không có src.'); return false; }
    const imgUrl = /^https?:/i.test(src) ? src : new URL(src, await page.url()).href;

    log('  NopeCHA: gửi ảnh sang API ...');
    const call = getNopecha(apiKey).solveRecognition({ type: 'textcaptcha', image_urls: [imgUrl] });
    const text = await Promise.race([
      call,
      new Promise((_, rej) => setTimeout(() => rej(new Error('timeout ' + timeout + 's')), timeout * 1000)),
    ]);
    if (!text || typeof text !== 'string') { log('  NopeCHA: không trả về kết quả.'); return false; }
    log('  NopeCHA trả về: "' + text + '"');

    const input = page.locator('input[name="captcha"], input#captcha, input[type="text"]').first();
    if (!(await input.count())) { log('  NopeCHA: không tìm thấy ô nhập captcha.'); return false; }
    await input.fill(text);
    const submit = page.locator('input[type="submit"], button[type="submit"]').first();
    if (await submit.count()) await submit.click();
    else await input.press('Enter');

    const ok = await pollUntil(async () => !isSorry(parse(await page.url())),
      { timeout: 30000, interval: 1500 }).then(() => true).catch(() => false);
    log(ok ? '  ✔ NopeCHA đã giải xong /sorry.' : '  ✖ NopeCHA giải sai hoặc Google vẫn giữ /sorry.');
    return ok;
  } catch (e) {
    log('  NopeCHA lỗi: ' + e.message);
    return false;
  }
}
`;

const PACKAGE_JSON = `{
  "name": "omni-google-search",
  "version": "1.0.0",
  "description": "Tim kiem Google bang tu khoa tren profile OmniLogin",
  "scripts": { "start": "node server.mjs" },
  "keywords": [],
  "author": "",
  "license": "ISC",
  "dependencies": {
    "@omnilogin/sdk": "^0.1.0",
    "nopecha": "^0.0.5"
  },
  "type": "module",
  "main": "server.mjs"
}
`;

async function write(rel, content) {
  const full = path.join(ROOT, rel);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, content, 'utf8');
  console.log('  ✔ ' + rel);
}

function must(cond, msg) { if (!cond) throw new Error(msg); }

console.log('Kiểm tra thư mục dự án: ' + ROOT);
for (const f of ['server.mjs', 'campaign.mjs', 'notify.mjs', 'workflow/google-search.mjs', 'workflow/worker.mjs', 'public/campaign.html']) {
  try { await fs.access(path.join(ROOT, f)); }
  catch { throw new Error('Thiếu file gốc: ' + f + ' — bạn đang chạy patch.mjs sai thư mục?'); }
}
console.log('  → Đủ file gốc, bắt đầu patch.');
console.log('');

console.log('Đang ghi các file đã sửa:');
await write('workflow/captcha.mjs', CAPTCHA_MJS);
await write('package.json', PACKAGE_JSON);

{
  const p = path.join(WF, 'google-search.mjs');
  let src = await fs.readFile(p, 'utf8');
  const before = src;

  if (!src.includes("from './captcha.mjs'")) {
    src = src.replace(
      /import \{ clickLocator, wheel \} from '\.\/human\.mjs';/,
      "import { clickLocator, wheel } from './human.mjs';\nimport { solveGoogleSorry } from './captcha.mjs';"
    );
  }

  src = src.replace(
    /export async function googleSearch\(page, \{ keyword, targetUrl, maxPages = 5, tabs, captchaWaitMs = CAPTCHA_WAIT_MS, onCaptcha = \(\) => \{\}, log = console\.log \}\) \{/,
    'export async function googleSearch(page, { keyword, targetUrl, maxPages = 5, tabs, captchaWaitMs = CAPTCHA_WAIT_MS, onCaptcha = () => {}, nopecha = null, log = console.log }) {'
  );

  const oldExec = `      execute: async () => {
        if (!captchaWaitMs) throw new CaptchaError('Google hiện captcha (/sorry) — bỏ lượt này.');
        log(\`  ⚠ Google hiện captcha. Hãy giải captcha trên cửa sổ trình duyệt profile (chờ tối đa \${captchaWaitMs / 60000} phút)...\`);
        await Promise.resolve(onCaptcha(true)).catch(() => {});
        try {
          await pollUntil(async () => !isSorry(await currentUrl()), { timeout: captchaWaitMs, interval: 1500 });
        } catch {
          throw new CaptchaError('Hết thời gian chờ giải captcha của Google.');
        } finally {
          await Promise.resolve(onCaptcha(false)).catch(() => {});
        }
        log('  ✓ Đã qua captcha, tiếp tục.');
        return { ok: true };
      },`;
  const newExec = `      execute: async () => {
        if (nopecha?.apiKey) {
          const solved = await solveGoogleSorry(page, { apiKey: nopecha.apiKey, log });
          if (solved) return { ok: true };
          log('  NopeCHA không giải được — chuyển sang chế độ dự phòng.');
        }
        if (!captchaWaitMs) throw new CaptchaError('Google hiện captcha (/sorry) — bỏ lượt này.');
        log(\`  ⚠ Google hiện captcha. Hãy giải captcha trên cửa sổ trình duyệt profile (chờ tối đa \${captchaWaitMs / 60000} phút)...\`);
        await Promise.resolve(onCaptcha(true)).catch(() => {});
        try {
          await pollUntil(async () => !isSorry(await currentUrl()), { timeout: captchaWaitMs, interval: 1500 });
        } catch {
          throw new CaptchaError('Hết thời gian chờ giải captcha của Google.');
        } finally {
          await Promise.resolve(onCaptcha(false)).catch(() => {});
        }
        log('  ✓ Đã qua captcha, tiếp tục.');
        return { ok: true };
      },`;
  if (!src.includes(oldExec)) {
    throw new Error('Không tìm thấy bước captcha cũ trong workflow/google-search.mjs — bản của bạn khác bản gốc tôi giả định. Gửi đoạn log này cho tôi để chỉnh patch.');
  }
  src = src.replace(oldExec, newExec);

  must(src !== before, 'Patch google-search.mjs không thay đổi gì.');
  await fs.writeFile(p, src, 'utf8');
  console.log('  ✔ workflow/google-search.mjs (patched)');
}

{
  const p = path.join(ROOT, 'campaign.mjs');
  let src = await fs.readFile(p, 'utf8');

  if (!src.includes('nopechaApiKey')) {
    src = src.replace(
      /captchaMode: 'manual', \/\/ manual = giữ trình duyệt, báo người dùng giải tay; rotate = đổi IP ngay\s*\n\s*captchaWaitMin: 3, \/\/ số phút chờ giải tay trước khi đổi IP/,
      "captchaMode: 'manual', // manual = chờ tay; nopecha = thử NopeCHA trước rồi chờ tay; rotate = đổi IP ngay\n  captchaWaitMin: 3,\n  nopechaApiKey: '',"
    );
  }

  if (!/nopechaApiKey: String/.test(src)) {
    src = src.replace(
      /captchaMode: s\.captchaMode === 'rotate' \? 'rotate' : 'manual',\s*\n\s*captchaWaitMin: clampInt\(s\.captchaWaitMin, 1, 15, d\.captchaWaitMin\),/,
      "captchaMode: ['rotate', 'nopecha'].includes(s.captchaMode) ? s.captchaMode : 'manual',\n    captchaWaitMin: clampInt(s.captchaWaitMin, 1, 15, d.captchaWaitMin),\n    nopechaApiKey: String(s.nopechaApiKey || '').trim(),"
    );
  }

  if (!src.includes("delete settings.nopechaApiKey")) {
    src = src.replace(
      /(if \(settings\?\.proxy && \(!settings\.proxy\.password \|\| \/\^•\+\$\/\.test\(settings\.proxy\.password\)\)\) delete settings\.proxy\.password;)/,
      "$1\n    if (settings?.nopechaApiKey === '' || /^•+$/.test(settings?.nopechaApiKey || '')) delete settings.nopechaApiKey;"
    );
  }

  src = src.replace(
    /runVisit\(this\.omni, \{ slot, keyword: task\.keyword, targetUrl: task\.targetUrl, settings: this\.settings, log, onStep: s => \{ w\.step = s; \}, onCaptcha \}\)/,
    "runVisit(this.omni, {\n      slot, keyword: task.keyword, targetUrl: task.targetUrl, settings: this.settings,\n      nopecha: this.settings.captchaMode === 'nopecha' && this.settings.nopechaApiKey\n        ? { apiKey: this.settings.nopechaApiKey } : null,\n      log, onStep: s => { w.step = s; }, onCaptcha,\n    })"
  );

  src = src.replace(
    /settings: \{ \.\.\.this\.settings, proxy: \{ \.\.\.this\.settings\.proxy, password: this\.settings\.proxy\.password \? '••••••' : '' \} \},/,
    "settings: { ...this.settings, nopechaApiKey: this.settings.nopechaApiKey ? '••••••' : '', proxy: { ...this.settings.proxy, password: this.settings.proxy.password ? '••••••' : '' } },"
  );

  await fs.writeFile(p, src, 'utf8');
  console.log('  ✔ campaign.mjs (patched)');
}

{
  const p = path.join(WF, 'worker.mjs');
  let src = await fs.readFile(p, 'utf8');

  src = src.replace(
    /async function attemptOnce\(omni, \{ slot, keyword, targetUrl, settings, log, onStep = \(\) => \{\}, onCaptcha = \(\) => \{\} \}\) \{/,
    'async function attemptOnce(omni, { slot, keyword, targetUrl, settings, nopecha, log, onStep = () => {}, onCaptcha = () => {} }) {'
  );

  src = src.replace(
    /const result = await googleSearch\(session\.page, \{\s*\n\s*keyword, targetUrl, maxPages, tabs: session\.tabs, log,\s*\n\s*captchaWaitMs: manual \? settings\.captchaWaitMin \* 60000 : 0,/,
    "const result = await googleSearch(session.page, {\n      keyword, targetUrl, maxPages, tabs: session.tabs, log,\n      captchaWaitMs: manual ? settings.captchaWaitMin * 60000 : 0,\n      nopecha,"
  );

  await fs.writeFile(p, src, 'utf8');
  console.log('  ✔ workflow/worker.mjs (patched)');
}

{
  const p = path.join(PUB, 'campaign.html');
  let src = await fs.readFile(p, 'utf8');

  if (!src.includes('capsolver')) {
  src = src.replace(
    /<div><label for="captchaMode">Khi gặp captcha<\/label><select id="captchaMode"><option value="manual">Chờ tôi giải tay<\/option><option value="rotate">Đổi IP ngay<\/option><\/select><\/div>/,
    '<div><label for="captchaMode">Khi gặp captcha</label><select id="captchaMode"><option value="manual">Chờ tôi giải tay</option><option value="nopecha">Tự động NopeCHA (fallback: chờ tay)</option><option value="rotate">Đổi IP ngay</option></select></div>\n        <div><label for="nopechaApiKey">NopeCHA API key</label><input type="password" id="nopechaApiKey" placeholder="(để trống = không dùng)" /></div>'
  );

  src = src.replace(
    /\$\('pxPass'\)\.value = ''; \$\('pxPass'\)\.placeholder = s\.proxy\.password \? '\(đã lưu — để trống = giữ nguyên\)' : '\(chưa có\)';/,
    "$('pxPass').value = ''; $('pxPass').placeholder = s.proxy.password ? '(đã lưu — để trống = giữ nguyên)' : '(chưa có)';\n    $('nopechaApiKey').value = ''; $('nopechaApiKey').placeholder = s.nopechaApiKey ? '(đã lưu — để trống = giữ nguyên)' : '(chưa có)';"
  );

  src = src.replace(
    /captchaMode: \$\('captchaMode'\)\.value, captchaWaitMin: num\('captchaWaitMin'\),/,
    "captchaMode: $('captchaMode').value, captchaWaitMin: num('captchaWaitMin'), nopechaApiKey: $('nopechaApiKey').value,"
  );
  } else {
    console.log('  • public/campaign.html đã ở bản CapSolver — bỏ qua patch NopeCHA cũ.');
  }

  await fs.writeFile(p, src, 'utf8');
  console.log('  ✔ public/campaign.html (patched)');
}

const zipName = 'omni-google-search-patched.zip';
console.log('\nĐang nén thành ' + zipName + ' ...');
try {
  execSync(
    'tar -a -c -f "' + zipName + '" --exclude=node_modules --exclude=data --exclude=export --exclude=' + zipName + ' .',
    { stdio: 'inherit', cwd: ROOT }
  );
  console.log('\n✅ Xong. File ZIP: ' + path.join(ROOT, zipName));
} catch (e) {
  console.error('\n⚠ Không nén được tự động: ' + e.message);
  console.error('Bạn có thể tự nén thư mục này bằng tay.');
}

console.log('\nBước tiếp theo:');
console.log('  npm install    # cài thư viện nopecha vừa thêm');
console.log('  npm start      # chạy app');