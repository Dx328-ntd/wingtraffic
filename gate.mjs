import crypto from 'node:crypto';
import { rateLimiter, normalizeIp } from './auth/register.mjs';

export const GATE_COOKIE = 'omni_gate';
export const GATE_PATH = '/__cong';
export const GATE_TTL_SEC = 12 * 60 * 60;
export const GATE_MIN_PASSWORD = 6;
export const GATE_MAX_PASSWORD = 72;
export const GATE_OPEN_PATHS = new Set(['/wt-badge.js', '/logo-icon.png']);
const K_ENABLED = 'gate_enabled';
const K_HASH = 'gate_password_hash';
const LOOPBACK = new Set(['127.0.0.1', '::1']);
const PROCESS_SECRET = crypto.randomBytes(32).toString('hex');

const failLimiter = rateLimiter({ limit: 8, windowMs: 10 * 60 * 1000 });

export function clientIp(req) {
  const h = req.headers || {};
  const raw = h['cf-connecting-ip'] || String(h['x-forwarded-for'] || '').split(',')[0].trim() || req.socket?.remoteAddress || '';
  return normalizeIp(raw);
}

export function isExternalRequest(req) {
  const h = req.headers || {};
  if (h['cf-ray'] || h['cf-connecting-ip'] || h['x-forwarded-for'] || h['x-real-ip'] || h.forwarded) return true;
  const addr = normalizeIp(req.socket?.remoteAddress);
  return !LOOPBACK.has(addr);
}

export function readGate(repo) {
  const enabled = repo.settings.get(K_ENABLED) !== '0';
  const hash = repo.settings.get(K_HASH) || '';
  return { enabled, hash, hasPassword: !!hash };
}

export async function writeGate(repo, auth, { enabled, password }, byId = null) {
  if (typeof enabled === 'boolean') repo.settings.set(K_ENABLED, enabled ? '1' : '0', byId);
  const pw = password == null ? '' : String(password);
  if (pw) {
    if (pw.length < GATE_MIN_PASSWORD) throw Object.assign(new Error(`Mật khẩu truy cập cần ít nhất ${GATE_MIN_PASSWORD} ký tự.`), { status: 400 });
    if (pw.length > GATE_MAX_PASSWORD) throw Object.assign(new Error(`Mật khẩu truy cập tối đa ${GATE_MAX_PASSWORD} ký tự.`), { status: 400 });
    repo.settings.set(K_HASH, await auth.hashPassword(pw), byId);
  }
  const g = readGate(repo);
  return { enabled: g.enabled, hasPassword: g.hasPassword };
}

function cookieKey(hash) {
  return crypto.createHash('sha256').update(`${process.env.JWT_SECRET || PROCESS_SECRET}|gate|${hash}`).digest();
}
const sign = (hash, exp) => crypto.createHmac('sha256', cookieKey(hash)).update(String(exp)).digest('hex');

export function makeGateCookieValue(hash, nowMs = Date.now()) {
  const exp = Math.floor(nowMs / 1000) + GATE_TTL_SEC;
  return `${exp}.${sign(hash, exp)}`;
}
export function checkGateCookieValue(value, hash, nowMs = Date.now()) {
  const m = /^(\d{9,12})\.([0-9a-f]{64})$/.exec(String(value || ''));
  if (!m || !hash) return false;
  if (Number(m[1]) * 1000 < nowMs) return false;
  const want = Buffer.from(sign(hash, m[1]), 'hex');
  const got = Buffer.from(m[2], 'hex');
  return want.length === got.length && crypto.timingSafeEqual(want, got);
}
function cookieFrom(req, name) {
  for (const part of String(req.headers?.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return '';
}

export function safeNext(next) {
  const s = String(next || '');
  return s.startsWith('/') && !s.startsWith('//') && !s.startsWith('/\\') && !s.startsWith(GATE_PATH) ? s.slice(0, 300) : '/';
}

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function gatePage({ next = '/', error = '', closed = false } = {}) {
  const form = closed
    ? '<p class="note">Trang đang <b>tạm đóng</b>. Vui lòng liên hệ người đã gửi địa chỉ này cho bạn để được mở.</p>'
    : `<form method="post" action="${GATE_PATH}" autocomplete="off">
         <input type="hidden" name="next" value="${esc(next)}" />
         <label for="pw">Mật khẩu truy cập</label>
         <input id="pw" name="password" type="password" required autofocus autocomplete="current-password" placeholder="Nhập mật khẩu được gửi cho bạn" />
         <button type="submit">Vào</button>
       </form>`;
  return `<!DOCTYPE html><html lang="vi"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex, nofollow" /><title>WingTraffic — Mật khẩu truy cập</title>
<style>
  :root { color-scheme: light dark; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #f2f6f5; color: #1f2937; font: 16px/1.5 "Segoe UI", system-ui, sans-serif; }
  .box { width: min(420px, calc(100% - 32px)); background: #fff; border: 1px solid #cfd9d6; border-radius: 14px; padding: 28px 26px; box-shadow: 0 8px 28px rgba(15,118,110,.12); }
  .logo { display: flex; align-items: center; gap: 10px; font-weight: 700; font-size: 20px; margin-bottom: 4px; }
  .logo i { display: grid; place-items: center; width: 34px; height: 34px; border-radius: 10px; background: linear-gradient(140deg, #0f766e, #0e7490); color: #fff; font-style: normal; }
  p.sub { margin: 0 0 18px; color: #5f6f6d; font-size: 14px; }
  label { display: block; font-weight: 600; font-size: 14px; margin-bottom: 6px; }
  input[type=password] { width: 100%; box-sizing: border-box; padding: 11px 12px; font-size: 16px; border: 1px solid #cfd9d6; border-radius: 8px; background: #fff; color: inherit; }
  input[type=password]:focus { outline: 3px solid rgba(15,118,110,.3); border-color: #0f766e; }
  button { margin-top: 14px; width: 100%; padding: 11px; font-size: 16px; font-weight: 600; color: #fff; background: #0f766e; border: 0; border-radius: 8px; cursor: pointer; }
  button:hover { background: #115e59; }
  .err { margin: 0 0 12px; padding: 9px 12px; border-radius: 8px; background: #fdecec; color: #991b1b; font-size: 14px; }
  .note { margin: 0; color: #374151; }
  @media (prefers-color-scheme: dark) { body { background: #0e1a1b; color: #e5eeec; } .box { background: #15262a; border-color: #2f4649; } input[type=password] { background: #1c3236; border-color: #2f4649; } p.sub { color: #94a8a5; } .err { background: #3a1d1d; color: #fca5a5; } .note { color: #cbd8d6; } }
</style></head><body><div class="box">
  <div class="logo"><i>W</i> WingTraffic</div>
  <p class="sub">Khu vực truy cập giới hạn. Nhập mật khẩu để tiếp tục.</p>
  ${error ? `<div class="err" role="alert">${esc(error)}</div>` : ''}
  ${form}
</div></body></html>`;
}

async function readForm(req, limit = 4096) {
  let data = '';
  for await (const chunk of req) { data += chunk; if (data.length > limit) throw Object.assign(new Error('Dữ liệu quá lớn.'), { status: 413 }); }
  return Object.fromEntries(new URLSearchParams(data));
}

function sendHtml(res, status, html, extra = {}) {
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow', ...extra });
  res.end(html);
  return true;
}

export async function gateGuard({ req, res, url, loadDeps }) {
  if (!isExternalRequest(req)) return false;
  if ((req.method === 'GET' || req.method === 'HEAD') && GATE_OPEN_PATHS.has(url.pathname)) return false;
  let g;
  try {
    const { repo } = await loadDeps();
    g = readGate(repo);
  } catch {
    return sendHtml(res, 503, gatePage({ closed: true }));
  }
  if (!g.enabled) return false;
  if (!g.hasPassword) {
    if (url.pathname.startsWith('/api/')) { res.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify({ error: 'Trang đang tạm đóng.' })); return true; }
    return sendHtml(res, 503, gatePage({ closed: true }));
  }
  if (checkGateCookieValue(cookieFrom(req, GATE_COOKIE), g.hash)) return false;

  const ip = clientIp(req);
  if (req.method === 'POST' && url.pathname === GATE_PATH) {
    const secure = String(req.headers['x-forwarded-proto'] || '').includes('https') || /"scheme":"https"/.test(String(req.headers['cf-visitor'] || ''));
    let form = {};
    try { form = await readForm(req); } catch (e) { return sendHtml(res, e.status || 400, gatePage({ error: e.message })); }
    const next = safeNext(form.next);
    const limit = failLimiter.check(ip);
    if (!limit.ok) return sendHtml(res, 429, gatePage({ next, error: `Nhập sai quá nhiều lần. Thử lại sau ${Math.ceil(limit.retryAfterSec / 60)} phút.` }), { 'Retry-After': String(limit.retryAfterSec) });
    let ok = false;
    try { const { auth } = await loadDeps(); ok = await auth.verifyPassword(String(form.password || ''), g.hash); } catch { ok = false; }
    if (!ok) return sendHtml(res, 401, gatePage({ next, error: 'Mật khẩu chưa đúng.' }));
    failLimiter.release(ip);
    res.writeHead(303, {
      Location: next, 'Cache-Control': 'no-store',
      'Set-Cookie': `${GATE_COOKIE}=${makeGateCookieValue(g.hash)}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${GATE_TTL_SEC}${secure ? '; Secure' : ''}`,
    });
    res.end();
    return true;
  }
  if (url.pathname.startsWith('/api/')) {
    res.writeHead(401, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ error: 'Cần nhập mật khẩu truy cập.', gate: true }));
    return true;
  }
  return sendHtml(res, 401, gatePage({ next: safeNext(url.pathname + url.search) }));
}
