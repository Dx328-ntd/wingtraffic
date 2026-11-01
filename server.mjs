import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { OmniLogin, Session } from '@omnilogin/sdk';
import { googleSearch, parseTarget } from './workflow/google-search.mjs';
import { browseSite } from './workflow/dwell.mjs';
import { markTouch } from './workflow/human.mjs';
import { Campaign } from './campaign.mjs';
import { RemoteHub } from './remote.mjs';
import { packageManifest } from './package-hash.mjs';
import { validateRegistration, rateLimiter, registrationOpen, normalizeIp } from './auth/register.mjs';
import { gateGuard, clientIp, isExternalRequest } from './gate.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3300;
const OMNI_API_TIMEOUT = Math.max(10000, Number(process.env.OMNI_API_TIMEOUT) || 120000);
const CONFIG_FILE = path.join(ROOT, 'config.json');
const BRIDGES_FILE = path.join(ROOT, 'bridges.json');
const DEFAULT_CONFIG = {
  keyword: 'Omnilogin',
  targetUrl: 'https://www.omnilogin.net',
  maxPages: 5,
  profileId: null,
  closeAfterRun: false,
  dwellMin: 60,
  dwellMax: 120,
  subpages: 1,
  subDwellMin: 20,
  subDwellMax: 45,
};

const makeOmni = () => new OmniLogin({ timeout: OMNI_API_TIMEOUT });
const ENGINE_DATA = process.env.CAMPAIGN_DATA_DIR || path.join(ROOT, 'data');
const campaign = new Campaign(makeOmni(), ENGINE_DATA, { makeOmni });
let pkgManifest = null, pkgManifestAt = 0;
const remoteHub = new RemoteHub(path.join(ENGINE_DATA, 'agents.json'), {
  manifest: () => (Date.now() - pkgManifestAt > 30000 ? (pkgManifest = packageManifest(ROOT), pkgManifestAt = Date.now()) : null, pkgManifest),
});
campaign.setRemote(remoteHub);
const jobs = new Map();
let runningJobId = null;

async function readConfig() {
  try {
    return { ...DEFAULT_CONFIG, ...JSON.parse(await fs.readFile(CONFIG_FILE, 'utf8')) };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}
function toConfig(b) {
  return {
    keyword: String(b.keyword ?? '').trim() || DEFAULT_CONFIG.keyword,
    targetUrl: String(b.targetUrl ?? '').trim(),
    maxPages: Math.min(Math.max(Number(b.maxPages) || DEFAULT_CONFIG.maxPages, 1), 10),
    profileId: b.profileId ? Number(b.profileId) : null,
    closeAfterRun: !!b.closeAfterRun,
    ...toRange(b.dwellMin, b.dwellMax, DEFAULT_CONFIG.dwellMin, DEFAULT_CONFIG.dwellMax, 'dwellMin', 'dwellMax'),
    subpages: Math.min(Math.max(Math.round(num(b.subpages, DEFAULT_CONFIG.subpages)), 0), 4),
    ...toRange(b.subDwellMin, b.subDwellMax, DEFAULT_CONFIG.subDwellMin, DEFAULT_CONFIG.subDwellMax, 'subDwellMin', 'subDwellMax'),
  };
}
function num(v, def) {
  const n = Number(v);
  return v === undefined || v === null || v === '' || !Number.isFinite(n) ? def : n;
}
function toRange(min, max, defMin, defMax, kMin, kMax) {
  let a = Math.min(Math.max(Math.round(num(min, defMin)), 0), 3600);
  let b = Math.min(Math.max(Math.round(num(max, defMax)), 0), 3600);
  if (a > b) [a, b] = [b, a];
  return { [kMin]: a, [kMax]: b };
}
async function writeConfig(cfg) {
  const merged = { ...(await readConfig()), ...cfg };
  await fs.writeFile(CONFIG_FILE, JSON.stringify(merged, null, 2), 'utf8');
  return merged;
}

async function listAllProfiles() {
  const all = [];
  for (let page = 1; page <= 50; page++) {
    const res = await campaign.omni.profiles.list({ page, pageSize: 100, sort: 'name', sortType: 'asc' });
    all.push(...res.docs);
    if (all.length >= res.total || res.docs.length === 0) break;
  }
  return all.map(p => ({ id: p.id, name: p.name, group: p.group?.name || '', tags: p.tags || [] }));
}

async function readBridges() {
  try { return JSON.parse(await fs.readFile(BRIDGES_FILE, 'utf8')); } catch { return {}; }
}

let repoMod = null;
async function loadRepo() {
  if (!repoMod) repoMod = await import('./database/repo.mjs');
  return repoMod;
}

let apiMod = null;

async function resumeAllCampaigns(user) {
  const repo = await loadRepo();
  const rows = repo.campaigns.list({ approval: 'approved', limit: 1000 })
    .filter(c => ['idle', 'paused', 'stopped', 'done'].includes(c.status));
  for (const c of rows) repo.campaigns.setStatus(c.id, 'running', user?.id ?? null);
  repo.audit.add({ actorId: user?.id ?? null, actorRole: user?.role ?? null, action: 'run', entity: 'settings', note: `Bật lại ${rows.length} chiến dịch đã duyệt.` });
  await campaign.syncTasks();
  return rows.length;
}

async function pauseAllCampaigns(user) {
  const repo = await loadRepo();
  const rows = repo.campaigns.list({ status: 'running', limit: 1000 });
  for (const c of rows) repo.campaigns.setStatus(c.id, 'paused', user?.id ?? null);
  repo.audit.add({ actorId: user?.id ?? null, actorRole: user?.role ?? null, action: 'stop', entity: 'settings', note: `Tạm dừng ${rows.length} chiến dịch đang chạy.` });
  await campaign.syncTasks();
  return rows.length;
}

function actorFor(user) {
  if (user) return user;
  return AUTH_REQUIRED ? null : { id: null, username: 'dev', role: 'admin' };
}

async function handleApi(req, res, url, user) {
  if (!apiMod) apiMod = await import('./api.mjs');
  return apiMod.handleApi({ req, res, url, actor: actorFor(user), campaign, send, readBody });
}
async function saveBridge(profileId, url) {
  const b = await readBridges();
  if (url) b[profileId] = url; else delete b[profileId];
  await fs.writeFile(BRIDGES_FILE, JSON.stringify(b, null, 2), 'utf8');
}

async function connectProfile(profileId, log) {
  if (await campaign.omni.rest.browser.isActive(profileId)) {
    const url = (await readBridges())[profileId];
    if (url) {
      try {
        const s = new Session(url);
        await s.connect();
        await s.page.url();
        log(`Profile #${profileId} đang mở — gắn lại vào phiên hiện có.`);
        return s;
      } catch {
      }
    }
    log(`Profile #${profileId} đang mở nhưng không gắn lại được — đóng và mở lại.`);
    await campaign.omni.rest.browser.stop(profileId);
    await new Promise(r => setTimeout(r, 2000));
  }
  log(`Mở profile #${profileId} (có giao diện, không headless) ...`);
  const { session, result } = await campaign.omni.open(profileId, { headless: false });
  campaign.omni.sessions.delete(profileId);
  await saveBridge(profileId, result.bridge_url);
  log('Đã kết nối OmniBridge.');
  return session;
}

async function runJob(job, { profileId, keyword, targetUrl, maxPages, closeAfterRun, dwellMin, dwellMax, subpages, subDwellMin, subDwellMax }) {
  const log = msg => {
    const line = `[${new Date().toLocaleTimeString('vi-VN')}] ${msg}`;
    job.logs.push(line);
    console.log(`[job ${job.id}] ${msg}`);
  };
  let session;
  try {
    session = await connectProfile(profileId, log);
    const os = await campaign.omni.profiles.get(profileId).then(p => p?.fingerprint?.operating_system || '', () => '');
    if (os === 'android' || os === 'iphone') {
      markTouch(session.page);
      log(`Profile di động (${os}) — dùng chạm/vuốt thật thay cho chuột.`);
    }
    job.result = await googleSearch(session.page, { keyword, targetUrl, maxPages, tabs: session.tabs, log });
    if (job.result.landed && dwellMax > 0) {
      job.result.visit = await browseSite(session.page, { dwellMin, dwellMax, subpages, subDwellMin, subDwellMax, tabs: session.tabs, log });
    }
    job.status = 'done';
  } catch (err) {
    job.status = 'error';
    job.error = err?.message || String(err);
    log(`✖ Lỗi: ${job.error}`);
  } finally {
    try {
      if (session) await session.disconnect();
      if (closeAfterRun) {
        await campaign.omni.rest.browser.stop(profileId);
        await saveBridge(profileId, null);
        log('Đã đóng profile.');
      }
    } catch (e) {
      log(`Cảnh báo khi đóng: ${e.message}`);
    }
    job.finishedAt = Date.now();
    runningJobId = null;
  }
}

function send(res, status, body, type = 'application/json; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
  return true;
}
async function readBody(req) {
  let data = '';
  for await (const chunk of req) data += chunk;
  return data ? JSON.parse(data) : {};
}

const TOKEN_COOKIE = process.env.AUTH_COOKIE || 'omni_token';
const TOKEN_MAX_AGE = 7 * 24 * 60 * 60;
const AUTH_REQUIRED = process.env.AUTH_REQUIRED !== '0';
const PUBLIC_URL = String(process.env.PUBLIC_URL || `http://localhost:${PORT}`).replace(/\/+$/, '');
const PUBLIC_URL_TOKEN = '{{PUBLIC_URL}}';

const REGISTER_OPEN = registrationOpen();
const loginFailByUser = rateLimiter({ limit: 8, windowMs: 10 * 60 * 1000 });
const loginFailByIp = rateLimiter({ limit: 30, windowMs: 10 * 60 * 1000 });
const registerLimiter = rateLimiter({ limit: Math.max(1, Number(process.env.REGISTER_PER_10MIN) || 3), windowMs: 10 * 60 * 1000 });
const PAGES = { '/gioi-thieu': 'portal.html', '/bang-gia': 'pricing.html', '/test': 'index.html', '/campaign': 'campaign.html', '/login': 'login.html', '/my': 'my.html', '/admin': 'admin.html' };
const ASSETS = new Map([
  ['/ui.css', ['public/ui.css', 'text/css; charset=utf-8']],
  ['/ui.js', ['public/ui.js', 'text/javascript; charset=utf-8']],
  ['/logo-icon.png', ['public/logo-icon.png', 'image/png']],
  ['/logo-full.png', ['public/logo-full.png', 'image/png']],
  ['/favicon.png', ['public/favicon.png', 'image/png']],
  ['/wt-badge.js', ['public/wt-badge.js', 'text/javascript; charset=utf-8']],
  ['/ui-admin.js', ['public/ui-admin.js', 'text/javascript; charset=utf-8']],
]);
const PUBLIC_PATHS = new Set(['/', '/gioi-thieu', '/favicon.svg', '/favicon.ico', '/favicon.png', '/logo-icon.png', '/logo-full.png', '/wt-badge.js', '/ui.css', '/ui.js', '/api/register', '/robots.txt', '/sitemap.xml', '/login', '/api/login', '/api/logout', '/api/health']);
const LEGACY_ADMIN_API = /^\/api\/(profiles|config|run|job\/[^/]+|campaign(\/[a-z-]+)?)$/;
const FONT_RE =/^\/fonts\/bevietnampro-(400|500|600|700|800)-(latin|vietnamese)\.woff2$/;
const ADMIN_PAGES = new Set(['/admin', '/campaign', '/test']);
let authDeps = null;

function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

async function loadAuthDeps() {
  if (!authDeps) {
    const auth = await import('./auth/auth.mjs');
    const { db } = await import('./database/init.mjs');
    authDeps = {
      auth,
      findUser: db.prepare('SELECT id, username, password_hash, role, status FROM users WHERE username = ?'),
      findById: db.prepare('SELECT id, username, role, pw_changed_at FROM users WHERE id = ?'),
    };
  }
  return authDeps;
}

async function loadGateDeps() {
  const d = await loadAuthDeps();
  return { repo: await import('./database/repo.mjs'), auth: d.auth };
}

function notFoundPage(user) {
  const home = user ? (user.role === 'admin' ? '/admin' : '/my') : '/login';
  const label = user ? 'Về trang quản lý' : 'Về trang đăng nhập';
  return `<!DOCTYPE html><html lang="vi"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex" /><link rel="icon" type="image/png" href="/favicon.png" /><title>Không tìm thấy trang — WingTraffic</title>
<style>
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #f2f6f5; color: #1f2937; font: 16px/1.5 "Segoe UI", system-ui, sans-serif; text-align: center; }
  .box { width: min(440px, calc(100% - 32px)); background: #fff; border: 1px solid #cfd9d6; border-radius: 14px; padding: 34px 26px; box-shadow: 0 8px 28px rgba(15,118,110,.12); }
  .code { font-size: 64px; font-weight: 800; line-height: 1; background: linear-gradient(140deg, #0f766e, #0e7490); -webkit-background-clip: text; background-clip: text; color: transparent; }
  h1 { margin: 10px 0 6px; font-size: 20px; } p { margin: 0 0 20px; color: #5f6f6d; }
  a { display: inline-block; padding: 10px 20px; border-radius: 8px; background: #0f766e; color: #fff; text-decoration: none; font-weight: 600; }
  a:hover { background: #115e59; }
  @media (prefers-color-scheme: dark) { body { background: #0e1a1b; color: #e5eeec; } .box { background: #15262a; border-color: #2f4649; } p { color: #94a8a5; } }
</style></head><body><div class="box"><div class="code">404</div><h1>Không tìm thấy trang này</h1><p>Địa chỉ bạn mở không tồn tại hoặc đã được chuyển đi.</p><a href="${home}">${label}</a></div></body></html>`;
}

async function currentUser(req) {
  let deps;
  try {
    deps = await loadAuthDeps();
  } catch (e) {
    if (AUTH_REQUIRED) throw httpError(503, `Chưa cài đủ thư viện đăng nhập (bcrypt, jsonwebtoken, better-sqlite3): ${e.message}`);
    return null;
  }
  try {
    const { id, iat } = deps.auth.requireAuth(req);
    const row = deps.findById.get(Number(id));
    if (!row) return null;
    if (deps.auth.tokenIsStale(iat, row.pw_changed_at)) return null;
    return { id: row.id, username: row.username, role: row.role };
  } catch {
    return null;
  }
}

async function requireUser(req, { roles } = {}) {
  const user = await currentUser(req);
  if (!user) throw httpError(401, 'Chưa đăng nhập hoặc phiên đã hết hạn.');
  if (roles && roles.length && !roles.includes(user.role)) {
    throw httpError(403, `Không đủ quyền (cần vai trò: ${roles.join(', ')}).`);
  }
  return user;
}

function setTokenCookie(res, token, req) {
  const parts = [`${TOKEN_COOKIE}=${token}`, 'HttpOnly', 'Path=/', 'SameSite=Lax', `Max-Age=${TOKEN_MAX_AGE}`];
  const viaHttps = req && (String(req.headers['x-forwarded-proto'] || '').includes('https') || /"scheme":"https"/.test(String(req.headers['cf-visitor'] || '')));
  if (process.env.COOKIE_SECURE === '1' || viaHttps) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

function clearTokenCookie(res) {
  res.setHeader('Set-Cookie', `${TOKEN_COOKIE}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0`);
}

function redirect(res, to) {
  res.writeHead(302, { Location: to, 'Cache-Control': 'no-store' });
  res.end();
}

async function handleMachines(req, res, url, user) {
  const audit = async note => { try { const repo = await loadRepo(); repo.audit.add({ actorId: user?.id ?? null, actorRole: user?.role ?? null, action: 'machine', entity: 'settings', note }); } catch {  } };
  const m = /^\/api\/machines(?:\/([0-9a-f]{8}))?(?:\/(key|enable))?$/.exec(url.pathname);
  if (!m) return send(res, 404, { error: 'Không có đường dẫn này.' });
  const [, id, sub] = m;
  try {
    if (!id && req.method === 'GET') return send(res, 200, { machines: remoteHub.summary(), serverUrl: PUBLIC_URL, localRun: campaign.localRun() });
    if (!id && req.method === 'POST') {
      const b = await readBody(req);
      const { agent, key } = await remoteHub.create(b.name);
      await audit(`Tạo máy phụ "${agent.name}".`);
      return send(res, 201, { machine: remoteHub.view(agent), key });
    }
    if (id && !sub && req.method === 'DELETE') {
      const name = remoteHub.agents.get(id)?.name;
      await remoteHub.remove(id);
      await audit(`Xoá máy phụ "${name}".`);
      return send(res, 200, { ok: true });
    }
    if (id && sub === 'key' && req.method === 'POST') {
      const { agent, key } = await remoteHub.rotateKey(id);
      await audit(`Đổi khoá máy phụ "${agent.name}".`);
      return send(res, 200, { machine: remoteHub.view(agent), key });
    }
    if (id && sub === 'enable' && req.method === 'POST') {
      const b = await readBody(req);
      const agent = await remoteHub.setEnabled(id, b.enabled !== false);
      await audit(`${agent.enabled ? 'Bật' : 'Tắt'} máy phụ "${agent.name}".`);
      return send(res, 200, { machine: remoteHub.view(agent) });
    }
    return send(res, 405, { error: 'Phương thức không hỗ trợ.' });
  } catch (e) {
    return send(res, e.status || 500, { error: e.message });
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  if (String(req.headers['x-forwarded-proto'] || '').includes('https') || /"scheme":"https"/.test(String(req.headers['cf-visitor'] || ''))) {
    res.setHeader('Strict-Transport-Security', 'max-age=15552000');
  }
  try {
    if (url.pathname.startsWith('/api/agent/') && await remoteHub.handle(req, res, url, { clientIp })) return;
    if (await gateGuard({ req, res, url, loadDeps: loadGateDeps })) return;
    let user = await currentUser(req);
    const external = isExternalRequest(req);
    if (external && process.env.ADMIN_EXTERNAL !== '1') {
      if (user?.role === 'admin') user = null;
      if (ADMIN_PAGES.has(url.pathname)) return send(res, 404, notFoundPage(null), 'text/html; charset=utf-8');
    }
    if (AUTH_REQUIRED && LEGACY_ADMIN_API.test(url.pathname) && user?.role !== 'admin') {
      return send(res, user ? 403 : 401, { error: user ? 'Chỉ quản trị viên được dùng chức năng này.' : 'Chưa đăng nhập hoặc phiên đã hết hạn.' });
    }
    if (url.pathname === '/api/machines' || url.pathname.startsWith('/api/machines/')) {
      if (AUTH_REQUIRED && user?.role !== 'admin') return send(res, user ? 403 : 401, { error: user ? 'Chỉ quản trị viên được dùng chức năng này.' : 'Chưa đăng nhập hoặc phiên đã hết hạn.' });
      return await handleMachines(req, res, url, user);
    }
    if (AUTH_REQUIRED && !user && !PUBLIC_PATHS.has(url.pathname) && !FONT_RE.test(url.pathname)) {
      if (url.pathname.startsWith('/api/')) return send(res, 401, { error: 'Chưa đăng nhập hoặc phiên đã hết hạn.' });
      return redirect(res, `/login?next=${encodeURIComponent(url.pathname)}`);
    }
    if ((req.method === 'GET' || req.method === 'HEAD') && url.pathname === '/') {
      if (user) return redirect(res, user.role === 'admin' ? '/admin' : '/my');
      return redirect(res, AUTH_REQUIRED ? '/login' : '/admin');
    }
    if (req.method === 'GET' && (url.pathname === '/favicon.svg' || url.pathname === '/favicon.ico')) {
      return redirect(res, '/favicon.png');
    }
    if ((req.method === 'GET' || req.method === 'HEAD') && FONT_RE.test(url.pathname)) {
      const buf = await fs.readFile(path.join(ROOT, 'public', url.pathname));
      res.writeHead(200, { 'Content-Type': 'font/woff2', 'Cache-Control': 'public, max-age=31536000, immutable' });
      return res.end(req.method === 'HEAD' ? undefined : buf);
    }
    if (url.pathname === '/ui-admin.js' && AUTH_REQUIRED && user?.role !== 'admin') {
      return send(res, 404, notFoundPage(user), 'text/html; charset=utf-8');
    }
    if (req.method === 'GET' && ASSETS.has(url.pathname)) {
      const [rel, type] = ASSETS.get(url.pathname);
      return send(res, 200, await fs.readFile(path.join(ROOT, rel)), type);
    }
    if (req.method === 'GET' && PAGES[url.pathname]) {
      if (ADMIN_PAGES.has(url.pathname) && AUTH_REQUIRED && user?.role !== 'admin') return redirect(res, '/my');
      const buf = await fs.readFile(path.join(ROOT, 'public', PAGES[url.pathname]));
      const html = buf.includes(PUBLIC_URL_TOKEN) ? buf.toString('utf8').split(PUBLIC_URL_TOKEN).join(PUBLIC_URL) : buf;
      return send(res, 200, html, 'text/html; charset=utf-8');
    }
    if (await handleApi(req, res, url, user)) return;
    if (req.method === 'GET' && url.pathname === '/api/me') {
      return user ? send(res, 200, { ok: true, user }) : send(res, 401, { error: 'Chưa đăng nhập.' });
    }
    if (req.method === 'GET' && url.pathname === '/api/health') {
      return send(res, 200, { ok: true });
    }
    if (req.method === 'POST' && url.pathname === '/api/logout') {
      clearTokenCookie(res);
      return send(res, 200, { ok: true });
    }
    if (req.method === 'GET' && url.pathname === '/api/profiles') {
      return send(res, 200, { profiles: await listAllProfiles() });
    }
    if (req.method === 'GET' && url.pathname === '/api/config') {
      return send(res, 200, await readConfig());
    }
    if (req.method === 'POST' && url.pathname === '/api/config') {
      return send(res, 200, await writeConfig(toConfig(await readBody(req))));
    }
    if (req.method === 'POST' && url.pathname === '/api/login') {
      const body = await readBody(req).catch(() => null);
      if (!body || typeof body !== 'object') return send(res, 400, { error: 'Dữ liệu gửi lên phải là JSON.' });
      const username = String(body.username ?? '').trim();
      const password = String(body.password ?? '');
      if (!username || !password) return send(res, 400, { error: 'Thiếu username hoặc password.' });

      let deps;
      try {
        deps = await loadAuthDeps();
      } catch (e) {
        return send(res, 503, { error: `Chưa cài đủ thư viện đăng nhập (bcrypt, jsonwebtoken, better-sqlite3): ${e.message}` });
      }

      const ip = clientIp(req), userKey = `${ip}|${username.toLowerCase()}`;
      const lim = loginFailByUser.check(userKey);
      const limIp = loginFailByIp.check(ip);
      if (!lim.ok || !limIp.ok) {
        if (lim.ok) loginFailByUser.release(userKey);
        if (limIp.ok) loginFailByIp.release(ip);
        const wait = Math.max(lim.retryAfterSec || 0, limIp.retryAfterSec || 0);
        res.setHeader('Retry-After', String(wait));
        return send(res, 429, { error: `Đăng nhập sai quá nhiều lần. Vui lòng thử lại sau ${Math.max(1, Math.ceil(wait / 60))} phút.` });
      }
      const user = deps.findUser.get(username);
      if (!user || !(await deps.auth.verifyPassword(password, user.password_hash))) {
        return send(res, 401, { error: 'Sai tên đăng nhập hoặc mật khẩu.' });
      }
      if (user.role === 'admin' && isExternalRequest(req) && process.env.ADMIN_EXTERNAL !== '1') {
        return send(res, 401, { error: 'Sai tên đăng nhập hoặc mật khẩu.' });
      }
      loginFailByUser.release(userKey);
      loginFailByIp.release(ip);
      if (user.status && user.status !== 'active') {
        return send(res, 403, { error: 'Tài khoản đang bị khoá. Vui lòng liên hệ quản trị viên.' });
      }

      let token;
      try {
        token = deps.auth.generateToken(user.id, user.role);
      } catch (e) {
        return send(res, 500, { error: e.message });
      }
      setTokenCookie(res, token, req);
      try {
        const { users } = await import('./database/repo.mjs');
        users.touchLogin(user.id);
      } catch {  }
      return send(res, 200, { ok: true, user: { id: user.id, username: user.username, role: user.role } });
    }
    if (req.method === 'POST' && url.pathname === '/api/register') {
      if (!REGISTER_OPEN) return send(res, 403, { error: 'Đăng ký đang tạm đóng. Vui lòng liên hệ quản trị viên để được cấp tài khoản.' });
      const ip = normalizeIp(req.headers['x-forwarded-for']?.split(',')[0] || req.socket.remoteAddress);
      const gate = registerLimiter.check(ip);
      if (!gate.ok) {
        res.setHeader('Retry-After', String(gate.retryAfterSec));
        return send(res, 429, { error: `Bạn đã thử đăng ký quá nhiều lần. Vui lòng thử lại sau ${gate.retryAfterSec} giây.` });
      }
      let reg;
      try {
        reg = validateRegistration(await readBody(req).catch(() => null));
      } catch (e) {
        registerLimiter.release(ip);
        return send(res, e.status || 400, { error: e.message });
      }

      let deps;
      try {
        deps = await loadAuthDeps();
      } catch (e) {
        registerLimiter.release(ip);
        return send(res, 503, { error: `Chưa cài đủ thư viện đăng nhập (bcrypt, jsonwebtoken, better-sqlite3): ${e.message}` });
      }
      if (deps.findUser.get(reg.username)) {
        registerLimiter.release(ip);
        return send(res, 409, { error: `Tên đăng nhập "${reg.username}" đã tồn tại, hãy chọn tên khác.` });
      }

      let created;
      try {
        const { users, notifications, audit } = await import('./database/repo.mjs');
        const info = users.create({
          username: reg.username,
          passwordHash: await deps.auth.hashPassword(reg.password),
          role: 'user',
          displayName: reg.displayName,
        });
        created = users.byId(info.lastInsertRowid);
        users.touchLogin(created.id);
        notifications.add({ userId: created.id, title: 'Chào mừng bạn đến với WingTraffic', body: 'Hãy tạo chiến dịch đầu tiên ở mục “Chiến dịch của tôi” — chiến dịch sẽ chờ quản trị viên duyệt rồi tự chạy theo chỉ tiêu.' });
        notifications.add({ forRole: 'admin', title: `Tài khoản mới tự đăng ký: ${created.username}`, body: `${created.display_name ? created.display_name + ' — ' : ''}IP ${ip}.` });
        audit.add({ actorId: created.id, actorRole: 'user', action: 'create', entity: 'user', entityId: created.id, after: { id: created.id, username: created.username, role: created.role, status: created.status }, note: `Tự đăng ký qua cổng công khai (IP ${ip}).` });
      } catch (e) {
        registerLimiter.release(ip);
        return send(res, 500, { error: `Không tạo được tài khoản: ${e.message}` });
      }

      let token;
      try {
        token = deps.auth.generateToken(created.id, created.role);
      } catch (e) {
        return send(res, 201, { ok: true, user: { id: created.id, username: created.username, role: created.role }, warning: `Chưa tạo được phiên đăng nhập: ${e.message}` });
      }
      setTokenCookie(res, token, req);
      return send(res, 201, { ok: true, user: { id: created.id, username: created.username, role: created.role } });
    }

    if (req.method === 'GET' && url.pathname === '/robots.txt') {
      const txt = [
        'User-agent: *',
        'Allow: /gioi-thieu',
        'Disallow: /',
        '',
        `Sitemap: ${PUBLIC_URL}/sitemap.xml`,
        '',
      ].join('\n');
      return send(res, 200, txt, 'text/plain; charset=utf-8');
    }
    if (req.method === 'GET' && url.pathname === '/sitemap.xml') {
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>${PUBLIC_URL}/gioi-thieu</loc>
    <lastmod>${new Date().toISOString().slice(0, 10)}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>1.0</priority>
  </url>
</urlset>
`;
      return send(res, 200, xml, 'application/xml; charset=utf-8');
    }
    if (req.method === 'POST' && url.pathname === '/api/run') {
      if (runningJobId) return send(res, 409, { error: 'Đang có một lượt chạy khác, vui lòng đợi.' });
      const cfg = await writeConfig(toConfig(await readBody(req)));
      try {
        parseTarget(cfg.targetUrl);
      } catch (e) {
        return send(res, 400, { error: e.message });
      }
      if (!cfg.profileId) return send(res, 400, { error: 'Chưa chọn profile OmniLogin.' });
      const job = { id: String(Date.now()), status: 'running', logs: [], result: null, error: null };
      jobs.set(job.id, job);
      runningJobId = job.id;
      runJob(job, cfg);
      return send(res, 202, { jobId: job.id });
    }
    if (req.method === 'GET' && url.pathname === '/api/campaign') {
      return send(res, 200, campaign.status());
    }
    if (req.method === 'POST' && url.pathname === '/api/campaign') {
      try {
        const body = await readBody(req);
        if (campaign.dbMode) delete body.tasks;
        await campaign.update(body);
      } catch (e) {
        return send(res, 400, { error: e.message });
      }
      return send(res, 200, campaign.status());
    }
    if (req.method === 'POST' && url.pathname === '/api/campaign/start') {
      try {
        if (campaign.dbMode) {
          const n = await resumeAllCampaigns(user);
          campaign.event(`▶ Bật lại ${n} chiến dịch đã duyệt (chế độ CSDL).`);
        } else {
          await campaign.start();
        }
      } catch (e) {
        return send(res, 400, { error: e.message });
      }
      return send(res, 200, campaign.status());
    }
    if (req.method === 'POST' && url.pathname === '/api/campaign/stop') {
      if (campaign.dbMode) {
        const n = await pauseAllCampaigns(user);
        campaign.event(`■ Tạm dừng ${n} chiến dịch đang chạy (chế độ CSDL).`);
      } else {
        await campaign.stop();
      }
      return send(res, 200, campaign.status());
    }
    if (req.method === 'POST' && url.pathname === '/api/campaign/telegram-test') {
      try {
        await campaign.testTelegram();
        return send(res, 200, { ok: true });
      } catch (e) {
        return send(res, 400, { error: e.message });
      }
    }
    if (req.method === 'POST' && url.pathname === '/api/campaign/telegram-report') {
      try {
        await campaign.sendDailyReport();
        return send(res, 200, { ok: true });
      } catch (e) {
        return send(res, 400, { error: e.message });
      }
    }
    if (req.method === 'POST' && url.pathname === '/api/campaign/omnilogin') {
      const up = await campaign.checkOmniLogin({ force: true });
      return send(res, 200, { up, message: campaign.omni_.message });
    }
    const m = url.pathname.match(/^\/api\/job\/(\w+)$/);
    if (req.method === 'GET' && m) {
      const job = jobs.get(m[1]);
      return job ? send(res, 200, job) : send(res, 404, { error: 'Không tìm thấy job' });
    }
    if (req.method === 'GET' && !url.pathname.startsWith('/api/') && String(req.headers.accept || '').includes('text/html')) {
      return send(res, 404, notFoundPage(user), 'text/html; charset=utf-8');
    }
    send(res, 404, { error: 'Not found' });
  } catch (err) {
    const msg = err?.message || String(err);
    const status = Number(err?.status) || 500;
    if (res.headersSent) {
      console.error(`[api] ${req.method} ${url.pathname}: ${msg}`);
      return void res.end();
    }
    if (status < 500) return send(res, status, { error: msg });
    const hint = /ECONNREFUSED|fetch failed/i.test(msg)
      ? ' — Hãy mở OmniLogin desktop và bật Bridge API (Settings → API, cổng 35353).'
      : '';
    console.error(`[api] ${req.method} ${url.pathname}: ${msg}`);
    send(res, 500, { error: msg + hint });
  }
});

server.listen(PORT, () => console.log(`WingTraffic Google Search: http://localhost:${PORT}  |  Chiến dịch: http://localhost:${PORT}/campaign`));

import('./backup.mjs').then(m => m.startAutoBackup()).catch(e => console.error('[backup] Không bật được sao lưu tự động:', e.message));

await remoteHub.load();
await campaign.load();
if (campaign.localRun()) {
  await campaign.checkOmniLogin({ force: true }).catch(e => campaign.event(`Kiểm tra OmniLogin lỗi: ${e.message}`));
  await campaign.cleanupOrphans();
}
campaign.startBackground();
if (campaign.running) campaign.event('Tiếp tục chiến dịch đang chạy trước khi server tắt.');
campaign.schedule();

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, async () => {
    console.log('Đang dọn profile tạm trước khi thoát...');
    await campaign.shutdown().catch(() => {});
    process.exit(0);
  });
}
