
export const USERNAME_RE = /^[a-zA-Z0-9._-]{3,32}$/;
export const MIN_PASSWORD = 8;
export const MAX_PASSWORD = 72;
export const MAX_DISPLAY_NAME = 80;

export class RegisterError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'RegisterError';
    this.status = status;
  }
}

export function registrationOpen(env = process.env) {
  return env.REGISTER_OPEN !== '0';
}

export function normalizeIp(ip) {
  return String(ip || 'unknown').trim().replace(/^::ffff:/i, '') || 'unknown';
}

export function validateRegistration(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new RegisterError(400, 'Dữ liệu gửi lên phải là JSON dạng đối tượng.');
  }
  const username = String(body.username ?? '').trim();
  const password = String(body.password ?? '');
  if (!username) throw new RegisterError(400, 'Thiếu tên đăng nhập.');
  if (!USERNAME_RE.test(username)) {
    throw new RegisterError(400, 'Tên đăng nhập 3–32 ký tự, chỉ gồm chữ, số và . _ -');
  }
  if (!password) throw new RegisterError(400, 'Thiếu mật khẩu.');
  if (password.length < MIN_PASSWORD) throw new RegisterError(400, `Mật khẩu cần tối thiểu ${MIN_PASSWORD} ký tự.`);
  if (password.length > MAX_PASSWORD) throw new RegisterError(400, `Mật khẩu tối đa ${MAX_PASSWORD} ký tự.`);
  const confirm = body.passwordConfirm;
  if (confirm !== undefined && confirm !== null && String(confirm) !== password) {
    throw new RegisterError(400, 'Mật khẩu nhập lại không khớp.');
  }
  const displayName = String(body.displayName ?? '').trim().slice(0, MAX_DISPLAY_NAME) || null;
  return { username, password, displayName };
}

export function rateLimiter({ limit = 3, windowMs = 10 * 60 * 1000, now = Date.now } = {}) {
  const hits = new Map();
  const fresh = (key, t) => (hits.get(key) || []).filter(ts => t - ts < windowMs);
  return {
    check(ip) {
      const key = normalizeIp(ip);
      const t = now();
      const kept = fresh(key, t);
      if (kept.length >= limit) {
        hits.set(key, kept);
        return { ok: false, retryAfterSec: Math.max(1, Math.ceil((windowMs - (t - kept[0])) / 1000)) };
      }
      kept.push(t);
      hits.set(key, kept);
      return { ok: true, retryAfterSec: 0 };
    },
    release(ip) {
      const key = normalizeIp(ip);
      const kept = fresh(key, now());
      kept.pop();
      if (kept.length) hits.set(key, kept); else hits.delete(key);
    },
    size() {
      return hits.size;
    },
    clear() {
      hits.clear();
    },
  };
}
