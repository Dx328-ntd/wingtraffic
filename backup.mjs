import fs from 'node:fs';
import path from 'node:path';
import { db, DB_FILE } from './database/init.mjs';

export const BACKUP_DIR = path.join(path.dirname(DB_FILE), 'backups');
export const KEEP_AUTO = 7;
export const KEEP_MANUAL = 3;
const NAME_RE = /^omni-(auto|tay)-\d{8}-\d{6}\.db$/;
const pad = n => String(n).padStart(2, '0');
const stamp = (d = new Date()) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;

export async function createBackup(kind = 'auto') {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const name = `omni-${kind === 'tay' ? 'tay' : 'auto'}-${stamp()}.db`;
  const dest = path.join(BACKUP_DIR, name);
  await db.backup(dest);
  pruneBackups();
  const st = fs.statSync(dest);
  return { name, size: st.size, at: st.mtime.toISOString(), kind: kind === 'tay' ? 'tay' : 'auto' };
}

export function listBackups() {
  let names = [];
  try { names = fs.readdirSync(BACKUP_DIR).filter(n => NAME_RE.test(n)); } catch { return []; }
  return names.map(name => {
    const st = fs.statSync(path.join(BACKUP_DIR, name));
    return { name, size: st.size, at: st.mtime.toISOString(), kind: name.startsWith('omni-tay-') ? 'tay' : 'auto' };
  }).sort((a, b) => (a.name < b.name ? 1 : -1));
}

export function pruneBackups() {
  const all = listBackups();
  for (const [kind, keep] of [['auto', KEEP_AUTO], ['tay', KEEP_MANUAL]]) {
    for (const b of all.filter(x => x.kind === kind).slice(keep)) {
      try { fs.unlinkSync(path.join(BACKUP_DIR, b.name)); } catch {  }
    }
  }
}

export function backupFile(name) {
  if (!NAME_RE.test(String(name || ''))) return null;
  const p = path.join(BACKUP_DIR, name);
  return fs.existsSync(p) ? p : null;
}

export function startAutoBackup({ hours = 24, log = console.log } = {}) {
  const tick = async () => {
    try {
      const last = listBackups().find(b => b.kind === 'auto');
      if (!last || Date.now() - new Date(last.at).getTime() >= hours * 3600 * 1000) {
        const b = await createBackup('auto');
        log(`[backup] Đã sao lưu CSDL: ${b.name} (${(b.size / 1024).toFixed(0)} KB)`);
      }
    } catch (e) { log(`[backup] Sao lưu lỗi: ${e.message}`); }
  };
  setTimeout(tick, 15000).unref?.();
  const timer = setInterval(tick, 3600 * 1000);
  timer.unref?.();
  return () => clearInterval(timer);
}
