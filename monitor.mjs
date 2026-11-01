import os from 'node:os';
import { execFile } from 'node:child_process';

const PS_SCRIPT = `
$procs = Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" | ForEach-Object { @{ id = $_.ProcessId; p = $_.ParentProcessId; ws = [int64]$_.WorkingSetSize; t = [int64]$_.KernelModeTime + [int64]$_.UserModeTime } }
$wins = Get-Process chrome -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle } | ForEach-Object { @{ id = $_.Id; title = $_.MainWindowTitle } }
@{ procs = @($procs); wins = @($wins) } | ConvertTo-Json -Depth 4 -Compress`;

function run(cmd, args, timeout = 20000) {
  return new Promise(resolve => {
    execFile(cmd, args, { windowsHide: true, timeout, maxBuffer: 8 * 1024 * 1024 }, (err, stdout) => resolve(err ? '' : String(stdout)));
  });
}

async function netBytes() {
  const out = await run('netstat', ['-e']);
  const m = out.match(/Bytes\s+(\d+)\s+(\d+)/i);
  return m ? Number(m[1]) + Number(m[2]) : null;
}

function cpuTimes() {
  let idle = 0, total = 0;
  for (const c of os.cpus()) {
    for (const [k, v] of Object.entries(c.times)) { total += v; if (k === 'idle') idle += v; }
  }
  return { idle, total };
}

export class ResourceMonitor {
  constructor() {
    this.prev = null;
    this.system = { cpuPct: null, netKBps: null, freeMemMB: null, at: null };
    this.byProfile = new Map();
    this.busy = false;
  }

  async sample(names = []) {
    if (this.busy || process.platform !== 'win32') return;
    this.busy = true;
    try {
      const at = Date.now();
      const [raw, net] = await Promise.all([
        run('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(PS_SCRIPT, 'utf16le').toString('base64')]),
        netBytes(),
      ]);
      const cpu = cpuTimes();
      let data = { procs: [], wins: [] };
      try { data = JSON.parse(raw || '{}'); } catch {}
      const procs = [].concat(data.procs || []).filter(Boolean);
      const wins = [].concat(data.wins || []).filter(Boolean);

      const children = new Map();
      for (const p of procs) {
        if (!children.has(p.p)) children.set(p.p, []);
        children.get(p.p).push(p);
      }
      const byId = new Map(procs.map(p => [p.id, p]));
      const cpuByPid = new Map(procs.map(p => [p.id, p.t]));
      const dtSec = this.prev ? (at - this.prev.at) / 1000 : 0;
      const cores = os.cpus().length;

      const result = new Map();
      for (const name of names) {
        const win = wins.find(w => w.title === name || w.title.startsWith(`${name} |`) || w.title.startsWith(`${name} -`));
        if (!win || !byId.has(win.id)) continue;
        let ws = 0, cpuDelta = 0, count = 0;
        const stack = [byId.get(win.id)];
        while (stack.length) {
          const p = stack.pop();
          ws += p.ws;
          count++;
          const before = this.prev?.cpuByPid.get(p.id);
          if (before !== undefined && p.t >= before) cpuDelta += p.t - before;
          stack.push(...(children.get(p.id) || []));
        }
        result.set(name, {
          ramMB: Math.round(ws / 1048576),
          cpuPct: dtSec ? Math.round(((cpuDelta / 1e7) / dtSec / cores) * 1000) / 10 : null,
          procs: count,
        });
      }
      this.byProfile = result;

      this.system = {
        cpuPct: this.prev ? Math.round((1 - (cpu.idle - this.prev.cpu.idle) / Math.max(1, cpu.total - this.prev.cpu.total)) * 100) : null,
        netKBps: this.prev && net !== null && this.prev.net !== null && dtSec ? Math.round((net - this.prev.net) / 1024 / dtSec) : null,
        freeMemMB: Math.round(os.freemem() / 1048576),
        at,
      };
      this.prev = { at, cpuByPid, net, cpu };
    } finally {
      this.busy = false;
    }
  }

  of(name) {
    return this.byProfile.get(name) || null;
  }
}
