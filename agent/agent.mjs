import os from 'node:os';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { OmniLogin } from '@omnilogin/sdk';
import { runVisit, makeCancel, destroyProfile, WORKER_PREFIX, POOL_PREFIX } from '../workflow/worker.mjs';
import { ProxyPool, omniNames } from '../proxy-pool.mjs';
import { packageManifest } from '../package-hash.mjs';
import { ensureOmniLogin, omniApiUp } from '../omnilogin-launcher.mjs';
import { ResourceMonitor } from '../monitor.mjs';

export const AGENT_VERSION = '1.0';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_FILE = process.env.AGENT_CONFIG || path.join(HERE, 'agent.config.json');
const DATA_DIR = path.join(HERE, 'data');
const MEM_SETTLE_MS = 90000;
const OMNI_API_TIMEOUT = Math.max(10000, Number(process.env.OMNI_API_TIMEOUT) || 120000);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const today = () => new Date().toLocaleDateString('sv-SE');
const stamp = () => new Date().toLocaleTimeString('vi-VN');
const say = m => console.log(`[${stamp()}] ${m}`);
const clampInt = (v, min, max, def) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(Math.max(n, min), max) : def; };

export function normalizeConfig(raw = {}) {
  const server = String(raw.server || '').trim().replace(/\/+$/, '');
  if (!/^https?:\/\/[^\s/]+/i.test(server)) throw new Error('agent.config.json: "server" phải là địa chỉ máy chính, ví dụ https://wingtraffic.tech');
  const key = String(raw.key || '').trim();
  if (!/^wt_[A-Za-z0-9_-]{20,}$/.test(key)) throw new Error('agent.config.json: "key" là khoá máy phụ lấy ở trang quản trị máy chính (bắt đầu bằng wt_).');
  const cfg = {
    server, key,
    threads: clampInt(raw.threads, 1, 64, 3),
    pollMs: clampInt(raw.pollMs, 1000, 30000, 3000),
    headless: raw.headless === undefined ? null : !!raw.headless,
    profileMode: raw.profileMode === 'pool' ? 'pool' : raw.profileMode === 'fresh' ? 'fresh' : null,
    minFreeMemMB: clampInt(raw.minFreeMemMB, 200, 16000, 800),
    memPerThreadMB: clampInt(raw.memPerThreadMB, 0, 4096, 650),
    autoLaunchOmni: raw.autoLaunchOmni !== false,
    omniloginPath: String(raw.omniloginPath || '').trim(),
    proxy: null,
  };
  if (raw.proxy && typeof raw.proxy === 'object') {
    const p = raw.proxy;
    cfg.proxy = {
      mode: p.mode === 'omni' ? 'omni' : 'webshare',
      type: ['HTTP', 'HTTPS', 'Socks5'].includes(p.type) ? p.type : 'HTTP',
      host: String(p.host || '').trim(), port: clampInt(p.port, 1, 65535, 80),
      userBase: String(p.userBase || '').trim(), password: String(p.password || ''),
      country: String(p.country || '').trim().toUpperCase(),
      profiles: Array.isArray(p.profiles) ? p.profiles.map(s => String(s).trim()).filter(Boolean) : [],
      rotateSec: clampInt(p.rotateSec, 10, 86400, 305),
    };
  }
  return cfg;
}

export class Agent {
  constructor(cfg, deps = {}) {
    this.cfg = cfg;
    this.omni = deps.omni || null;
    this.fetchFn = deps.fetchFn || fetch;
    this.run = deps.run || runVisit;
    this.pool = deps.pool || new ProxyPool(path.join(DATA_DIR, 'proxy-stats.json'));
    this.monitor = deps.monitor || new ResourceMonitor();
    this.jobs = new Map();
    this.lastRun = {};
    this.lastProfile = {};
    this.limitCap = null; this.limitAt = 0;
    this.centralProxy = null;
    this.quotaDay = null;
    this.omni_ = { up: null, checkedAt: 0, launching: false, lastLaunchAt: 0 };
    this.stopped = false;
    this.authFailed = false;
    this.pending = new Set();
  }

  proxyCfg(central) { return this.cfg.proxy || central || null; }
  isOmniProxy(central) { return this.proxyCfg(central)?.mode === 'omni'; }

  maxThreads() {
    if (this.limitCap !== null && Date.now() - this.limitAt > 600000) this.limitCap = null;
    return this.limitCap === null ? this.cfg.threads : Math.min(this.cfg.threads, this.limitCap);
  }

  freeSlots() {
    if (this.omni_.up === false || this.quotaDay === today() || this.stopped || this.authFailed) return [];
    const px = this.proxyCfg(this.centralProxy);
    const rotateMs = Math.max(10, Number(px?.rotateSec) || 305) * 1000;
    const omniMode = px?.mode === 'omni';
    const rotate = omniMode && omniNames(px).length > this.maxThreads();
    const readyProfiles = rotate ? this.readyProfiles(px, rotateMs).length : 0;
    const freeMB = os.freemem() / 1048576;
    let starting = [...this.jobs.values()].filter(j => Date.now() - j.startedAt < MEM_SETTLE_MS).length;
    const out = [];
    for (let slot = 1; slot <= this.maxThreads(); slot++) {
      if ([...this.jobs.values()].some(j => j.slot === slot)) continue;
      if (rotate) { if (out.length >= readyProfiles) break; }
      else if (omniMode && Date.now() - (this.lastRun[slot] || 0) < rotateMs) continue;
      if (freeMB < this.cfg.minFreeMemMB + starting * this.cfg.memPerThreadMB) break;
      out.push(slot);
      starting++;
    }
    return out;
  }

  readyProfiles(px, rotateMs) {
    const busy = new Set([...this.jobs.values()].map(j => j.profile).filter(Boolean));
    const now = Date.now();
    return omniNames(px)
      .filter(n => !busy.has(n) && now - (this.lastProfile[n] || 0) >= rotateMs)
      .sort((a, b) => (this.lastProfile[a] || 0) - (this.lastProfile[b] || 0));
  }

  async post(pathname, body) {
    const res = await this.fetchFn(`${this.cfg.server}${pathname}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.cfg.key}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(25000),
    });
    const text = await res.text();
    let data = {};
    try { data = text ? JSON.parse(text) : {}; } catch {  }
    if (!res.ok) throw Object.assign(new Error(data.error || `Máy chủ trả mã ${res.status}`), { status: res.status });
    return data;
  }

  info() {
    return {
      threads: this.maxThreads(), freeSlots: this.freeSlots(), omniUp: this.omni_.up,
      freeMemMB: Math.round(os.freemem() / 1048576), totalMemMB: Math.round(os.totalmem() / 1048576),
      cpuPct: this.monitor.system?.cpuPct ?? null, version: AGENT_VERSION, host: os.hostname(),
      files: (this.files ||= packageManifest(path.resolve(HERE, '..'))),
    };
  }

  runningReport() {
    const sending = [...this.pending].filter(id => !this.jobs.has(id)).map(jobId => ({ jobId, step: 'Gửi kết quả', ip: '', logs: [], profileName: '', captchaWaiting: false, ramMB: null, cpuPct: null }));
    return sending.concat([...this.jobs.values()].map(j => ({
      jobId: j.id, step: j.step, ip: j.ip, logs: j.logs.slice(-40), profileName: j.profileName || '',
      captchaWaiting: !!j.captchaWaiting, ramMB: j.res?.ramMB ?? null, cpuPct: j.res?.cpuPct ?? null,
    })));
  }

  async pollOnce() {
    await this.checkOmni();
    const data = await this.post('/api/agent/poll', { info: this.info(), running: this.runningReport() });
    this.authFailed = false;
    for (const id of data.cancel || []) this.jobs.get(id)?.cancel.abort();
    for (const job of data.jobs || []) this.startJob(job);
    return data;
  }

  startJob(job) {
    if (this.jobs.has(job.id)) return;
    const p = job.payload || {};
    const slot = Number(job.slot) || 1;
    const cancel = makeCancel();
    const central = p.settings || {};
    this.centralProxy = central.proxy || this.centralProxy;
    const proxy = this.proxyCfg(central.proxy);
    const rotate = proxy?.mode === 'omni' && omniNames(proxy).length > this.maxThreads();
    const profile = rotate ? (this.readyProfiles(proxy, Math.max(10, Number(proxy.rotateSec) || 305) * 1000)[0] || null) : null;
    const w = { id: job.id, slot, profile, cancel, step: 'Chuẩn bị', ip: '', logs: [], profileName: '', startedAt: Date.now(), captchaWaiting: false, res: null };
    this.jobs.set(job.id, w);
    this.lastRun[slot] = Date.now();
    if (profile) this.lastProfile[profile] = Date.now();
    this.pool.configure(proxy);
    const settings = {
      ...central, proxy,
      ...(this.cfg.headless === null ? {} : { headless: this.cfg.headless }),
      ...(this.cfg.profileMode ? { profileMode: this.cfg.profileMode } : {}),
      minFreeMemMB: this.cfg.minFreeMemMB, memPerThreadMB: this.cfg.memPerThreadMB,
    };
    const log = msg => {
      w.logs.push(`[${stamp()}] ${msg}`);
      if (w.logs.length > 60) w.logs.shift();
      if (/^IP: /.test(msg)) w.ip = msg.slice(4);
    };
    say(`Luồng ${slot}: nhận lượt "${p.keyword}" (${job.id}).`);
    Promise.resolve()
      .then(() => this.run(this.omni, {
        slot, profileName: profile || undefined, keyword: p.keyword, targetUrl: p.targetUrl, queryMode: p.queryMode, settings,
        solver: p.solver || null, proxyPool: this.pool, device: p.device, cancel,
        onLease: name => { w.profileName = name; },
        log, onStep: s => { w.step = s; },
        onCaptcha: waiting => { w.captchaWaiting = !!waiting; },
      }))
      .catch(e => ({ status: 'error', ip: w.ip, error: e.message }))
      .then(res => this.finishJob(w, res));
  }

  async finishJob(w, res) {
    this.jobs.delete(w.id);
    say(`Luồng ${w.slot}: xong "${res.status}"${res.ip ? ` (IP ${res.ip})` : ''}${res.error ? ` — ${res.error}` : ''}`);
    if (res.status === 'quota') this.quotaDay = today();
    if (res.status === 'limit') { this.limitCap = Math.max(1, this.jobs.size); this.limitAt = Date.now(); }
    try { await this.pool.save(); } catch {  }
    const out = { ...res, metrics: { ramPeakMB: w.res?.ramMB ?? null, cpuAvg: w.res?.cpuPct ?? null } };
    this.pending.add(w.id);
    for (let i = 0; i < 12 && !this.stopped; i++) {
      try { await this.post('/api/agent/result', { jobId: w.id, result: out }); break; }
      catch (e) {
        if (e.status === 401 || e.status === 403) break;
        await sleep(i < 3 ? 2000 : 10000);
      }
    }
    this.pending.delete(w.id);
  }

  async checkOmni() {
    const o = this.omni_;
    if (o.launching || Date.now() - o.checkedAt < 30000) return;
    o.checkedAt = Date.now();
    if (await omniApiUp()) {
      if (o.up === false) say('✔ OmniLogin đã hoạt động trở lại.');
      o.up = true;
      return;
    }
    if (o.up !== false) say('⚠ Không kết nối được OmniLogin (cổng 35353).');
    o.up = false;
    if (!this.cfg.autoLaunchOmni || Date.now() - o.lastLaunchAt < 180000) return;
    o.launching = true; o.lastLaunchAt = Date.now();
    try {
      const r = await ensureOmniLogin({ exePath: this.cfg.omniloginPath, log: say });
      o.up = r.up;
      say(`${r.up ? '✔' : '✖'} ${r.message}`);
      if (r.up && r.launched) await this.cleanupOrphans();
    } finally { o.launching = false; }
  }

  async cleanupOrphans() {
    try {
      const all = [];
      for (const prefix of [WORKER_PREFIX, POOL_PREFIX]) {
        all.push(...(await this.omni.profiles.list({ q: prefix, pageSize: 200 })).docs.filter(p => p.name.startsWith(prefix)));
      }
      let removed = 0;
      for (const p of all) {
        if (p.name.startsWith(POOL_PREFIX) && this.cfg.profileMode === 'pool') {
          if (await this.omni.rest.browser.isActive(p.id).catch(() => false)) await this.omni.rest.browser.stop(p.id).catch(() => {});
          continue;
        }
        await destroyProfile(this.omni, p.id);
        removed++;
      }
      if (removed) say(`Đã dọn ${removed} profile không dùng tới.`);
    } catch (e) { say(`Không dọn được profile: ${e.message}`); }
  }

  async sampleResources() {
    const names = [...this.jobs.values()].map(j => j.profileName).filter(Boolean);
    await this.monitor.sample(names);
    for (const j of this.jobs.values()) j.res = j.profileName ? this.monitor.of(j.profileName) : null;
  }

  async start() {
    await fs.mkdir(DATA_DIR, { recursive: true });
    await this.pool.load();
    this.omni = this.omni || new OmniLogin({ timeout: OMNI_API_TIMEOUT });
    say(`Máy phụ khởi động — máy chính ${this.cfg.server}, tối đa ${this.cfg.threads} luồng.`);
    await this.checkOmni();
    if (this.omni_.up) await this.cleanupOrphans();
    this.monTimer = setInterval(() => this.sampleResources().catch(() => {}), 15000);
    let failStreak = 0;
    while (!this.stopped) {
      try {
        await this.pollOnce();
        if (failStreak) say('✔ Đã kết nối lại máy chính.');
        failStreak = 0;
      } catch (e) {
        failStreak++;
        if (e.status === 401 || e.status === 403) {
          this.authFailed = true;
          say(`✖ Máy chính từ chối: ${e.message}. Kiểm tra "key" trong agent.config.json (hoặc máy này đã bị tắt ở máy chính). Thử lại sau 30 giây.`);
          await sleep(30000);
        } else if (failStreak === 1 || failStreak % 20 === 0) {
          say(`⚠ Không gọi được máy chính (${e.message}). Các lượt đang chạy vẫn tiếp tục; sẽ thử lại.`);
        }
      }
      await sleep(failStreak ? Math.min(30000, this.cfg.pollMs * (1 + failStreak)) : this.cfg.pollMs);
    }
  }

  async stop() {
    this.stopped = true;
    clearInterval(this.monTimer);
    for (const j of this.jobs.values()) j.cancel.abort();
    await this.pool.save().catch(() => {});
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let cfg;
  try { cfg = normalizeConfig(JSON.parse(await fs.readFile(CONFIG_FILE, 'utf8'))); }
  catch (e) {
    console.error(e.code === 'ENOENT' ? `Chưa có file cấu hình: ${CONFIG_FILE}\nSao chép agent.config.example.json thành agent.config.json rồi điền "server" và "key".` : `Cấu hình lỗi: ${e.message}`);
    process.exit(1);
  }
  const agent = new Agent(cfg);
  for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, async () => { say('Đang dừng máy phụ...'); await agent.stop(); process.exit(0); });
  await agent.start();
}
