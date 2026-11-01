import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
export const BOOT_AT = Date.now();
export const RESTART_EXIT_CODE = 75;
const SCAN_DIRS = ['', 'workflow', 'database', 'auth'];

const isCode = name => /\.mjs$/.test(name) || name === '.env';

export function changedSinceBoot() {
  const out = [];
  for (const dir of SCAN_DIRS) {
    let names = [];
    try { names = fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true }); } catch { continue; }
    for (const d of names) {
      if (!d.isFile() || !isCode(d.name)) continue;
      const rel = dir ? `${dir}/${d.name}` : d.name;
      try {
        const m = fs.statSync(path.join(ROOT, rel)).mtimeMs;
        if (m > BOOT_AT + 1000) out.push({ file: rel, at: new Date(m).toISOString() });
      } catch {  }
    }
  }
  return out.sort((a, b) => (a.at < b.at ? 1 : -1));
}

function readVersion() {
  try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'version.json'), 'utf8')); } catch { return { version: 'dev', builtAt: null }; }
}

export function serverStatus() {
  const changed = changedSinceBoot();
  return {
    version: readVersion().version || 'dev',
    versionBuiltAt: readVersion().builtAt || null,
    pid: process.pid,
    bootAt: new Date(BOOT_AT).toISOString(),
    uptimeSec: Math.round((Date.now() - BOOT_AT) / 1000),
    node: process.version,
    supervised: process.env.OMNI_SUPERVISED === '1',
    stale: changed.length > 0,
    changed: changed.slice(0, 30),
  };
}

export function scheduleRestart(campaign) {
  console.log('[server] Quản trị viên yêu cầu khởi động lại server...');
  setTimeout(async () => {
    try { await campaign?.shutdown?.(); } catch (e) { console.error('[server] Dọn profile tạm lỗi:', e.message); }
    if (process.env.OMNI_SUPERVISED === '1') process.exit(RESTART_EXIT_CODE);
    const relaunch = `setTimeout(() => { require('child_process').spawn(process.execPath, ['--env-file-if-exists=.env', 'server.mjs'], `
      + `{ cwd: ${JSON.stringify(ROOT)}, detached: true, stdio: 'ignore', windowsHide: true }).unref(); }, 3000);`;
    spawn(process.execPath, ['-e', relaunch], { cwd: ROOT, detached: true, stdio: 'ignore', windowsHide: true }).unref();
    process.exit(0);
  }, 400);
}
