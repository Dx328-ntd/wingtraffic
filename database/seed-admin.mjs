import { hashPassword } from '../auth/auth.mjs';
import { db, DB_FILE } from './init.mjs';

const USERNAME_RE = /^[a-zA-Z0-9._-]{3,32}$/;
const MIN_PASSWORD = 8;

const args = process.argv.slice(2);

function usage(msg) {
  if (msg) console.error(`✖ ${msg}`);
  console.error('Dùng: node database/seed-admin.mjs <username> <password> [--role admin|user]');
  console.error('      node database/seed-admin.mjs --list');
  process.exit(msg ? 1 : 0);
}

function listUsers() {
  const rows = db.prepare('SELECT id, username, role, created_at FROM users ORDER BY id').all();
  console.log(`CSDL: ${DB_FILE}`);
  if (!rows.length) return console.log('Chưa có tài khoản nào — tạo bằng: node database/seed-admin.mjs <username> <password> --role admin');
  console.log(`Tài khoản (${rows.length}):`);
  for (const r of rows) console.log(`  #${r.id}  ${r.username}  [${r.role}]  tạo ${r.created_at}`);
}

if (args.includes('--list')) {
  listUsers();
  process.exit(0);
}

const roleFlag = args.indexOf('--role');
const role = (roleFlag >= 0 ? args[roleFlag + 1] : 'admin') || 'admin';
const positional = args.filter((a, i) => !a.startsWith('--') && !(roleFlag >= 0 && i === roleFlag + 1));
const username = (positional[0] || '').trim();
const password = positional[1] || process.env.OMNI_PASSWORD || '';

if (!username || !password) usage('Thiếu username hoặc password.');
if (!USERNAME_RE.test(username)) usage('Username chỉ gồm chữ, số, . _ - và dài 3–32 ký tự.');
if (password.length < MIN_PASSWORD) usage(`Mật khẩu phải dài ít nhất ${MIN_PASSWORD} ký tự.`);
if (!['user', 'admin'].includes(role)) usage("--role chỉ nhận 'user' hoặc 'admin'.");

const hash = await hashPassword(password, { rounds: Number(process.env.BCRYPT_ROUNDS) || 12 });
const existing = db.prepare('SELECT id, role FROM users WHERE username = ?').get(username);

if (existing) {
  db.prepare('UPDATE users SET password_hash = ?, role = ? WHERE id = ?').run(hash, role, existing.id);
  console.log(`✔ Đã cập nhật tài khoản "${username}" (#${existing.id}) — vai trò ${existing.role} -> ${role}, mật khẩu mới đã lưu.`);
} else {
  const info = db.prepare('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)').run(username, hash, role);
  console.log(`✔ Đã tạo tài khoản "${username}" (#${info.lastInsertRowid}, vai trò ${role}).`);
}

console.log(`  CSDL: ${DB_FILE}`);
if (!process.env.JWT_SECRET) {
  console.log('  ⚠ Chưa thấy JWT_SECRET trong môi trường — /api/login sẽ lỗi cho tới khi đặt JWT_SECRET (>= 16 ký tự, nên >= 32).');
}
