import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFile } from 'node:child_process';

const API = 'http://localhost:35353';
const DEFAULT_EXE = path.join(os.homedir(), 'AppData', 'Local', 'Programs', 'omnilogin', 'Omnilogin.exe');
const sleep = ms => new Promise(r => setTimeout(r, ms));

export async function omniApiUp(timeoutMs = 3000) {
  try {
    const res = await fetch(`${API}/profiles?page=1&pageSize=1`, { signal: AbortSignal.timeout(timeoutMs) });
    return res.ok;
  } catch {
    return false;
  }
}

export function detectRunningExe() {
  return new Promise(resolve => {
    if (process.platform !== 'win32') return resolve('');
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      "(Get-Process Omnilogin -ErrorAction SilentlyContinue | Where-Object Path | Select-Object -First 1).Path"],
    { windowsHide: true, timeout: 15000 }, (err, stdout) => resolve(err ? '' : String(stdout).trim()));
  });
}

export function resolveExe(configured) {
  for (const p of [configured, DEFAULT_EXE]) if (p && fs.existsSync(p)) return p;
  return '';
}

export async function ensureOmniLogin({ exePath = '', waitMs = 120000, log = () => {} } = {}) {
  if (await omniApiUp()) return { up: true, launched: false, exe: exePath, message: 'OmniLogin đang chạy.' };
  const exe = resolveExe(exePath);
  if (!exe) {
    return { up: false, launched: false, exe: '', message: 'OmniLogin chưa chạy và không tìm thấy Omnilogin.exe — hãy mở tay hoặc nhập đường dẫn trong cài đặt.' };
  }
  log(`OmniLogin chưa chạy — đang mở ${exe} ...`);
  try {
    const p = spawn(exe, [], { detached: true, stdio: 'ignore', cwd: path.dirname(exe) });
    p.unref();
  } catch (e) {
    return { up: false, launched: false, exe, message: `Không mở được OmniLogin: ${e.message}` };
  }
  const deadline = Date.now() + waitMs;
  while (Date.now() < deadline) {
    await sleep(3000);
    if (await omniApiUp()) {
      await sleep(5000);
      return { up: true, launched: true, exe, message: 'Đã mở OmniLogin, API sẵn sàng.' };
    }
  }
  return { up: false, launched: true, exe, message: `Đã mở OmniLogin nhưng API cổng 35353 chưa lên sau ${Math.round(waitMs / 1000)}s (kiểm tra đăng nhập / cài đặt API).` };
}
