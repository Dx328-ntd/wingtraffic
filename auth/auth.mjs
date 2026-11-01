import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';

export const BCRYPT_ROUNDS = Number(process.env.BCRYPT_ROUNDS) || 12;
export const TOKEN_TTL = process.env.JWT_EXPIRES_IN || '7d';
export const JWT_ALGORITHM = 'HS256';
export const ROLE_DEFAULT = 'user';

function resolveSecret(secret) {
  const s = secret || process.env.JWT_SECRET;
  if (!s || s.length < 16) {
    throw new Error('Thiếu JWT_SECRET (tối thiểu 16 ký tự) — đặt biến môi trường trước khi phát hành token.');
  }
  return s;
}

export async function hashPassword(pwd, { rounds = BCRYPT_ROUNDS } = {}) {
  const s = String(pwd ?? '');
  if (!s) throw new Error('Mật khẩu đang trống.');
  return bcrypt.hash(s, Math.min(Math.max(Math.round(rounds) || BCRYPT_ROUNDS, 10), 15));
}

export async function verifyPassword(pwd, hash) {
  const s = String(pwd ?? '');
  if (!s || typeof hash !== 'string' || !hash) return false;
  try {
    return await bcrypt.compare(s, hash);
  } catch {
    return false;
  }
}

export function generateToken(userId, role = ROLE_DEFAULT, { secret, expiresIn = TOKEN_TTL } = {}) {
  if (userId === undefined || userId === null || userId === '') {
    throw new Error('Thiếu userId để phát hành token.');
  }
  const r = String(role || ROLE_DEFAULT).trim() || ROLE_DEFAULT;
  return jwt.sign({ sub: String(userId), role: r }, resolveSecret(secret), {
    algorithm: JWT_ALGORITHM,
    expiresIn,
  });
}

export const TOKEN_COOKIE = process.env.AUTH_COOKIE || 'omni_token';

export class AuthError extends Error {
  constructor(message, status = 401) {
    super(message);
    this.name = 'AuthError';
    this.status = status;
  }
}

export function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    if (!k) continue;
    const v = part.slice(i + 1).trim();
    try {
      out[k] = decodeURIComponent(v);
    } catch {
      out[k] = v;
    }
  }
  return out;
}

export function tokenFromRequest(req, name = TOKEN_COOKIE) {
  const header = req && typeof req === 'object' ? req.headers?.cookie : req;
  return parseCookies(header)[name] || null;
}

export function verifyToken(token, { secret, req } = {}) {
  const raw = token || tokenFromRequest(req);
  if (!raw) throw new AuthError('Chưa đăng nhập.');
  let payload;
  try {
    payload = jwt.verify(raw, resolveSecret(secret), { algorithms: [JWT_ALGORITHM] });
  } catch (e) {
    throw new AuthError(
      e?.name === 'TokenExpiredError' ? 'Phiên đăng nhập đã hết hạn, hãy đăng nhập lại.' : 'Token không hợp lệ.',
    );
  }
  if (!payload?.sub) throw new AuthError('Token thiếu thông tin người dùng.');
  return { id: String(payload.sub), role: String(payload.role || ROLE_DEFAULT), iat: Number(payload.iat) || 0 };
}

export function tokenIsStale(iat, pwChangedAt) {
  const t = Number(pwChangedAt) || 0;
  return t > 0 && Number(iat) < Math.floor(t / 1000);
}

export function requireRole(user, ...roles) {
  const list = roles.flat().filter(Boolean).map(String);
  if (list.length && !list.includes(String(user?.role))) {
    throw new AuthError(`Không đủ quyền (cần vai trò: ${list.join(', ')}).`, 403);
  }
  return user;
}

export function requireAuth(req, { secret, roles } = {}) {
  return requireRole(verifyToken(null, { secret, req }), ...(roles || []));
}
