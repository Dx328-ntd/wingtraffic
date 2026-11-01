import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runVisit, makeCancel, destroyProfile, WORKER_PREFIX, POOL_PREFIX, pickDevice, deviceKindAt, mobilePct, MOBILE_SHARE, IMPRESSION_EVERY, impressionAt, attemptTimeoutMs } from './workflow/worker.mjs';
import { notifyWindows, focusProfileWindow } from './notify.mjs';
import { ProxyPool, pickRotateProfile } from './proxy-pool.mjs';
import { ensureOmniLogin, omniApiUp, detectRunningExe } from './omnilogin-launcher.mjs';
import { sendTelegram, dailyReport, esc } from './telegram.mjs';
import { ResourceMonitor } from './monitor.mjs';
import { sessionParams, paceInfo, MAX_DWELL_SEC, MAX_SUBPAGES, MAX_THREADS } from './campaign-pace.mjs';
import { isValidQueryMode } from './campaign-types.mjs';
import { store } from './campaign-store.mjs';
import { chargeableRun, visitCost } from './wallet.mjs';

const TICK_MS = 5000;
const MEM_SETTLE_MS = 90000;
const RECENT_RUNS = 200;
const WORKER_LOG_LINES = 60;

export const DEFAULT_SETTINGS = {
  localRun: true,
  threads: 3,
  maxPages: 5,
  dwellMin: 60,
  dwellMax: 120,
  subpages: 1,
  subDwellMin: 20,
  subDwellMax: 45,
  headless: false,
  device: 'mixed',
  mobilePercent: MOBILE_SHARE,
  impressionEvery: IMPRESSION_EVERY,
  activeFrom: 7,
  activeTo: 23,
  minFreeMemMB: 800,
  memPerThreadMB: 650,
  profileMode: 'pool',
  recycleAfter: 20,
  captchaMode: 'manual',
  captchaWaitMin: 3,
  solverApiKey: '',
  proxy: {
    type: 'HTTP', host: 'p.webshare.io', port: 80, userBase: '', password: '', country: 'VN',
    mode: 'webshare', profiles: [], rotateSec: 305,
  },
  autoLaunchOmni: true,
  omniloginPath: '',
  telegram: { token: '', chatId: '', events: true, captchaAlerts: false, dailyHour: 23 },
};

const rand = (min, max) => min + Math.random() * (max - min);
const today = () => new Date().toLocaleDateString('sv-SE');
const clampInt = (v, min, max, def) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(Math.max(n, min), max) : def;
};

const FETCH_FAIL_RECONNECT = 5;

export class Campaign {
  constructor(omni, dataDir, { makeOmni = null } = {}) {
    this.omni = omni;
    this.makeOmni = makeOmni;
    this.fetchFailStreak = 0;
    this.dataDir = dataDir;
    this.file = path.join(dataDir, 'campaign.json');
    this.statsFile = path.join(dataDir, 'stats.json');
    this.runsFile = path.join(dataDir, 'runs.jsonl');
    this.settings = structuredClone(DEFAULT_SETTINGS);
    this.tasks = [];
    this.running = false;
    this.stats = {};
    this.lastStart = {};
    this.backoff = {};
    this.workers = new Map();
    this.writeChain = Promise.resolve();
    this.recent = [];
    this.events = [];
    this.timer = null;
    this.lastMemWarn = 0;
    this.limitCap = null;
    this.limitAt = 0;
    this.quotaDay = null;
    this.proxyPool = new ProxyPool(path.join(dataDir, 'proxy-stats.json'));
    this.monitor = new ResourceMonitor();
    this.metaFile = path.join(dataDir, 'meta.json');
    this.meta = { lastReportDate: null };
    this.omni_ = { up: null, checkedAt: 0, launching: false, lastLaunchAt: 0, message: '' };
    this.houseTimer = null;
    this.monitorTimer = null;
    this.dbMode = false;
    this.fileTasks = [];
    this.doneMarked = new Set();
    this.dayMark = today();
    this.dbWarnAt = 0;
    this.deviceSeq = { hour: 0, day: 0 };
    this.deviceDone = { date: today(), desktop: 0, mobile: 0 };
    this.impressionSeq = 0;
    this.impressionDone = { date: today(), count: 0 };
    this.walletWarned = new Set();
    this.lowBalanceWarned = new Set();
    this.omniLastRun = {};
    this.omniProfileLast = {};
    this.remote = null;
    this.remoteWorkers = new Map();
    this.agentQuotaDay = {};
  }

  setRemote(hub) { this.remote = hub; }

  localRun() { return this.settings.localRun !== false; }

  totalThreads() {
    return (this.localRun() ? this.maxThreads() : 0) + (this.remote ? this.remote.capacity() : 0);
  }

  allWorkers() { return [...this.workers.values(), ...this.remoteWorkers.values()]; }

  nextDevice(task) {
    const s = this.settings;
    if (s.device !== 'mixed') return pickDevice(s);
    const series = task?.unit === 'hour' ? 'hour' : 'day';
    this.deviceSeq[series] += 1;
    const kind = deviceKindAt(this.deviceSeq[series], s.mobilePercent);
    return pickDevice(s, kind);
  }

  devicePlan() {
    const pct = mobilePct(this.settings);
    if (this.deviceDone.date !== today()) this.deviceDone = { date: today(), desktop: 0, mobile: 0 };
    return {
      mode: this.settings.device,
      mobilePercent: this.settings.device === 'mobile' ? 100 : this.settings.device === 'mixed' ? pct : 0,
      desktopPercent: this.settings.device === 'desktop' ? 100 : this.settings.device === 'mixed' ? 100 - pct : 0,
      desktop: this.deviceDone.desktop,
      mobile: this.deviceDone.mobile,
      seq: { hour: this.deviceSeq.hour, day: this.deviceSeq.day },
    };
  }

  impressionEvery() {
    return clampInt(this.settings.impressionEvery, 0, 100, IMPRESSION_EVERY);
  }

  nextImpression(task) {
    const p = this.taskParams(task);
    if (p.skipSearch || p.skipVisit) return false;
    const every = this.impressionEvery();
    if (!every) return false;
    this.impressionSeq += 1;
    return impressionAt(this.impressionSeq, every);
  }

  impressionPlan() {
    if (this.impressionDone.date !== today()) this.impressionDone = { date: today(), count: 0 };
    return { every: this.impressionEvery(), seq: this.impressionSeq, today: this.impressionDone.count };
  }

  taskParams(task) {
    return sessionParams(task?.type, this.settings);
  }

  paceOf(task) {
    const pace = paceInfo(task, task?.type, this.settings);
    const guardMs = attemptTimeoutMs({ ...this.settings, ...this.taskParams(task) });
    return {
      ...pace,
      needSec: pace.sessionSec,
      guardMin: Math.round(guardMs / 60000),
      exceedGuard: pace.sessionSec * 1000 > guardMs,
    };
  }

  async syncTasks() {
    if (!this.dbMode) return false;
    const sig = t => `${t.id}:${t.keyword}:${t.queryMode}:${t.count}:${t.unit}:${t.type}:${t.maxThreads}`;
    const before = this.tasks.map(sig).join('|');
    this.tasks = store.runnable().map(r => ({
      id: `db:${r.id}`,
      dbId: r.id,
      userId: r.user_id,
      keyword: String(r.keyword || '').trim(),
      targetUrl: String(r.target_url || '').trim(),
      queryMode: isValidQueryMode(r.query_mode) ? r.query_mode : 'keyword',
      count: clampInt(r.count, 0, 10000, 0),
      unit: r.unit === 'hour' ? 'hour' : 'day',
      type: r.type || 'search_dwell',
      maxThreads: clampInt(r.max_threads, 1, MAX_THREADS, 1),
      name: r.name || '',
      enabled: true,
    })).filter(t => t.keyword && t.targetUrl);
    const after = this.tasks.map(sig).join('|');
    this.running = this.tasks.length > 0;
    if (before !== after) {
      this.event(`↻ Danh sách chiến dịch từ CSDL: ${this.tasks.length} đang chạy (${this.tasks.map(t => t.keyword).join(', ') || 'trống'}).`);
    }
    this.cancelStoppedWorkers();
    return true;
  }

  cancelStoppedWorkers() {
    for (const w of this.allWorkers()) {
      if (!w.cancel || w.cancel.cancelled || !w.dbId) continue;
      const row = store.byId(w.dbId);
      if (!row) continue;
      if (!['paused', 'stopped'].includes(row.status) && row.approval_status === 'approved') continue;
      w.cancel.abort();
      w.step = 'Đang huỷ vì chiến dịch đã dừng…';
      this.event(`■ Luồng ${w.slot}: chiến dịch "${w.keyword}" đã dừng — huỷ lượt đang chạy (không ghi nhận, không trừ tiền).`);
    }
  }

  recordDb(task, rec, res) {
    if (!task?.dbId) return;
    const ok = store.record({
      campaignId: task.dbId, userId: task.userId, status: res.status,
      keyword: task.keyword, targetUrl: task.targetUrl,
      ip: res.ip || null, seconds: rec.seconds,
      position: res.result?.matched ? Number(res.result.matched.position) || null : null,
      onSite: rec.onSite || null, pages: rec.pages || null,
      impression: rec.impression || null,
      query: res.result?.query || res.query || null,
      deviceKind: res.deviceKind || null, device: res.device || null, userAgent: res.ua || null,
      attempts: rec.attempts, captchas: rec.captchas, proxy: res.proxy || null,
      ramPeakMb: rec.ramPeakMB, cpuAvg: rec.cpuAvg, error: rec.error || null,
    });
    if (!ok && Date.now() - this.dbWarnAt > 60000) {
      this.dbWarnAt = Date.now();
      this.event(`⚠ Không ghi được lượt chạy vào CSDL (${store.lastError() || store.error() || 'lỗi không xác định'}).`);
    }
    if (ok) this.chargeVisit(task, res);
  }

  chargeVisit(task, res) {
    if (!task?.dbId || !chargeableRun(res)) return true;
    const amount = visitCost(task.type);
    if (!(amount > 0)) return true;
    const m = res.result?.matched;
    const paid = store.walletSpend({
      userId: task.userId, campaignId: task.dbId, amountVnd: amount,
      note: `${task.keyword}${m ? ` · vị trí Tr.${m.page} #${m.position}` : ''}`,
    });
    if (paid) { this.warnLowBalance(task, amount); return true; }
    this.pauseForWallet(task, amount);
    return false;
  }

  warnLowBalance(task, cost) {
    const bal = store.balanceOf(task.userId);
    if (bal == null || !(cost > 0)) return;
    if (bal >= Math.max(50000, cost * 100) || bal < cost) return;
    const key = `${task.userId}#${today()}`;
    if (this.lowBalanceWarned.has(key)) return;
    this.lowBalanceWarned.add(key);
    store.notify({
      userId: task.userId, campaignId: task.dbId,
      title: 'Số dư sắp hết',
      body: `Số dư còn ${Number(bal).toLocaleString('vi-VN')}đ (đủ khoảng ${Math.floor(bal / cost)} lượt). Hãy nạp thêm ở mục Ngân sách để chiến dịch không bị tạm dừng.`,
    });
  }

  pauseForWallet(task, amount) {
    const key = `${task.dbId}#${today()}`;
    this.event(`⛔ Ví không đủ ${amount}đ cho lượt kế tiếp — tạm dừng chiến dịch "${task.keyword}".`);
    if (this.walletWarned.has(key)) return;
    this.walletWarned.add(key);
    store.setStatus(task.dbId, 'paused');
    store.notify({
      userId: task.userId, campaignId: task.dbId,
      title: `Tạm dừng "${task.keyword}": ví đã hết tiền`,
      body: `Một lượt tốn ${amount}đ nhưng số dư không đủ. Nạp thêm tiền ở mục “Số dư & nạp tiền” rồi bật lại chiến dịch.`,
    });
    store.notify({
      forRole: 'admin', campaignId: task.dbId,
      title: `Ví hết tiền: chiến dịch "${task.keyword}" đã tạm dừng`,
      body: `Chủ tài khoản #${task.userId} cần được nạp thêm tiền rồi bật lại chiến dịch.`,
    });
  }

  markDoneIfReached(task) {
    if (!task?.dbId || task.unit === 'hour') return;
    const key = `${task.dbId}#${today()}`;
    if (this.doneMarked.has(key)) return;
    if (store.todayCount(task.dbId) < task.count) return;
    const cur = store.byId(task.dbId)?.status;
    if (cur === 'done') {
      this.doneMarked.add(key);
      return;
    }
    if (cur !== 'running') return;
    this.doneMarked.add(key);
    store.setStatus(task.dbId, 'done');
    store.notify({
      userId: task.userId, campaignId: task.dbId,
      title: `Chiến dịch "${task.keyword}" đã đủ ${task.count} lượt hôm nay`,
      body: 'Chiến dịch tự tạm dừng và sẽ chạy tiếp vào ngày mai.',
    });
    this.event(`✔ Chiến dịch "${task.keyword}" đã đủ ${task.count} lượt hôm nay — tạm dừng tới mai.`);
  }

  async resetDailyDone() {
    if (!this.dbMode) return 0;
    const rows = store.byStatus('done').filter(r => (r.today_attempts || 0) < Number(r.count || 0));
    let n = 0;
    for (const r of rows) {
      store.setStatus(r.id, 'running');
      this.doneMarked.delete(`${r.id}#${today()}`);
      n++;
    }
    if (n) this.event(`↻ Mở lại ${n} chiến dịch đã xong của ngày trước.`);
    return n;
  }

  notify(text, { kind = 'event' } = {}) {
    const tg = this.settings.telegram;
    if (!tg.token || !tg.chatId) return;
    if (kind === 'event' && !tg.events) return;
    if (kind === 'captcha' && !tg.captchaAlerts) return;
    sendTelegram(tg, text).catch(e => this.event(`Không gửi được Telegram: ${e.message}`));
  }

  async testTelegram() {
    await sendTelegram(this.settings.telegram, `✅ <b>WingTraffic</b>: kết nối Telegram thành công (${esc(new Date().toLocaleString('vi-VN'))}).`);
  }

  async sendDailyReport() {
    const st = this.status();
    await sendTelegram(this.settings.telegram, dailyReport({ date: today(), tasks: st.tasks, proxies: st.proxyStats.proxies, hours: st.proxyStats.hours, running: st.running }));
  }

  async checkOmniLogin({ force = false } = {}) {
    const o = this.omni_;
    if (o.launching) return o.up;
    if (!force && Date.now() - o.checkedAt < 30000) return o.up;
    o.checkedAt = Date.now();
    const up = await omniApiUp();
    if (up) {
      if (o.up === false) this.event('✔ OmniLogin đã hoạt động trở lại.');
      o.up = true;
      o.message = 'OmniLogin đang chạy.';
      if (!this.settings.omniloginPath) {
        const exe = await detectRunningExe();
        if (exe) { this.settings.omniloginPath = exe; await this.save(); }
      }
      return true;
    }
    if (o.up !== false) {
      this.event('⚠ Không kết nối được OmniLogin (cổng 35353).');
      this.notify('⚠ <b>WingTraffic</b>: OmniLogin không phản hồi (cổng 35353).');
    }
    o.up = false;
    if (!this.settings.autoLaunchOmni || Date.now() - o.lastLaunchAt < 180000) return false;
    o.launching = true;
    o.lastLaunchAt = Date.now();
    try {
      const r = await ensureOmniLogin({ exePath: this.settings.omniloginPath, log: m => this.event(m) });
      o.up = r.up;
      o.message = r.message;
      this.event(`${r.up ? '✔' : '✖'} ${r.message}`);
      this.notify(`${r.up ? '✔' : '✖'} <b>WingTraffic</b>: ${esc(r.message)}`);
      if (r.up && r.launched) await this.cleanupOrphans();
      return r.up;
    } finally {
      o.launching = false;
    }
  }

  startBackground() {
    if (!this.houseTimer) {
      this.houseTimer = setInterval(() => this.housekeeping().catch(e => this.event(`Lỗi việc nền: ${e.message}`)), 60000);
    }
    if (!this.monitorTimer) {
      this.monitorTimer = setInterval(() => this.sampleResources().catch(() => {}), 15000);
    }
  }

  async sampleResources() {
    const names = [...this.workers.values()].map(w => w.profileName).filter(Boolean);
    await this.monitor.sample(names);
    for (const w of this.workers.values()) {
      const r = w.profileName ? this.monitor.of(w.profileName) : null;
      w.res = r;
      if (!r) continue;
      w.ramPeak = Math.max(w.ramPeak || 0, r.ramMB);
      if (r.cpuPct !== null) { w.cpuSum = (w.cpuSum || 0) + r.cpuPct; w.cpuN = (w.cpuN || 0) + 1; }
    }
  }

  async housekeeping() {
    if (this.running && this.localRun()) await this.checkOmniLogin();
    const day = today();
    if (this.dayMark !== day) {
      this.dayMark = day;
      if (this.dbMode) {
        await this.resetDailyDone();
        await this.syncTasks();
      }
    }
    const tg = this.settings.telegram;
    const now = new Date();
    if (tg.token && tg.chatId && now.getHours() === tg.dailyHour && this.meta.lastReportDate !== today()) {
      this.meta.lastReportDate = today();
      await fs.writeFile(this.metaFile, JSON.stringify(this.meta), 'utf8').catch(() => {});
      await this.sendDailyReport().catch(e => this.event(`Không gửi được báo cáo ngày: ${e.message}`));
    }
    await this.proxyPool.save();
  }

  maxThreads() {
    if (this.limitCap !== null && Date.now() - this.limitAt > 600000) this.limitCap = null;
    return this.limitCap === null ? this.settings.threads : Math.min(this.settings.threads, this.limitCap);
  }

  isOmniProxy() {
    return this.settings.proxy?.mode === 'omni';
  }

  omniProfiles() {
    return (this.settings.proxy?.profiles || []).map(s => String(s).trim()).filter(Boolean);
  }

  rotateSecMs() {
    return Math.max(10, Number(this.settings.proxy?.rotateSec) || 305) * 1000;
  }

  omniThreads() {
    return Math.max(1, Math.min(this.maxThreads(), this.omniProfiles().length));
  }

  omniRotate() {
    return this.isOmniProxy() && this.omniProfiles().length > this.maxThreads();
  }

  omniReady(slot) {
    const last = this.omniLastRun[slot] || 0;
    return Date.now() - last >= this.rotateSecMs();
  }

  async load() {
    await fs.mkdir(this.dataDir, { recursive: true });
    try {
      const c = JSON.parse(await fs.readFile(this.file, 'utf8'));
      this.settings = normalizeSettings(c.settings);
      this.fileTasks = normalizeTasks(c.tasks);
      this.tasks = [...this.fileTasks];
      this.running = !!c.running;
    } catch {}
    try { this.stats = JSON.parse(await fs.readFile(this.statsFile, 'utf8')); } catch {}
    try {
      const lines = (await fs.readFile(this.runsFile, 'utf8')).trim().split('\n').slice(-RECENT_RUNS);
      this.recent = lines.filter(Boolean).map(l => JSON.parse(l)).reverse();
    } catch {}
    try { this.meta = { ...this.meta, ...JSON.parse(await fs.readFile(this.metaFile, 'utf8')) }; } catch {}
    await this.proxyPool.load();
    this.proxyPool.configure(this.settings.proxy);
    this.dbMode = await store.init();
    if (this.dbMode) {
      this.event(`CSDL sẵn sàng — từ khóa lấy từ bảng campaigns (bỏ qua ${this.fileTasks.length} từ khóa trong campaign.json).`);
      await this.syncTasks();
      await this.resetDailyDone();
    } else if (store.error()) {
      this.event(`⚠ Không dùng được CSDL (${store.error()}) — chạy danh sách từ khóa trong campaign.json.`);
    }
  }
  async save() {
    const tasks = this.dbMode ? this.fileTasks : this.tasks;
    const json = JSON.stringify({ settings: this.settings, tasks, running: this.running }, null, 2);
    return this.queueWrite(() => fs.writeFile(this.file, json, 'utf8'));
  }
  async saveStats() {
    const json = JSON.stringify(this.stats, null, 2);
    return this.queueWrite(() => fs.writeFile(this.statsFile, json, 'utf8'));
  }

  queueWrite(fn) {
    const next = this.writeChain.then(fn, fn);
    this.writeChain = next.catch(e => this.event(`⚠ Không ghi được file: ${e.message}`));
    return next;
  }

  event(msg) {
    const line = `[${new Date().toLocaleTimeString('vi-VN')}] ${msg}`;
    this.events.unshift(line);
    this.events.length = Math.min(this.events.length, 100);
    console.log(`[campaign] ${msg}`);
  }

  async update({ settings, tasks }) {
    if (settings?.proxy && (!settings.proxy.password || /^•+$/.test(settings.proxy.password))) delete settings.proxy.password;
    if (settings?.solverApiKey === '' || /^•+$/.test(settings?.solverApiKey || '')) delete settings.solverApiKey;
    if (settings?.telegram && (!settings.telegram.token || /^•+$/.test(settings.telegram.token))) delete settings.telegram.token;
    if (settings) {
      this.settings = normalizeSettings({
        ...this.settings, ...settings,
        proxy: { ...this.settings.proxy, ...(settings.proxy || {}) },
        telegram: { ...this.settings.telegram, ...(settings.telegram || {}) },
      });
      this.proxyPool.configure(this.settings.proxy);
    }
    if (tasks) {
      if (this.dbMode) throw new Error('Danh sách từ khóa giờ quản lý theo từng chiến dịch — dùng trang "Chiến dịch của tôi".');
      this.tasks = normalizeTasks(tasks);
    }
    await this.save();
  }

  async cleanupOrphans({ keepPool = true } = {}) {
    try {
      const all = [];
      for (const prefix of [WORKER_PREFIX, POOL_PREFIX]) {
        all.push(...(await this.omni.profiles.list({ q: prefix, pageSize: 200 })).docs.filter(p => p.name.startsWith(prefix)));
      }
      const busy = new Set([...this.workers.values()].map(w => `${POOL_PREFIX}${w.slot}`));
      let removed = 0;
      for (const p of all) {
        if (p.name.startsWith(POOL_PREFIX)) {
          if (busy.has(p.name)) continue;
          const slot = Number(p.name.slice(POOL_PREFIX.length));
          const keep = keepPool && this.settings.profileMode === 'pool' && slot >= 1 && slot <= this.settings.threads;
          if (keep) {
            if (await this.omni.rest.browser.isActive(p.id).catch(() => false)) await this.omni.rest.browser.stop(p.id).catch(() => {});
            continue;
          }
        }
        await destroyProfile(this.omni, p.id);
        removed++;
      }
      if (removed) this.event(`Đã dọn ${removed} profile không dùng tới.`);
    } catch (e) {
      this.event(`Không dọn được profile: ${e.message}`);
    }
  }

  async start() {
    const proxyErr = this.localRun() ? this.proxyPool.validate() : null;
    if (proxyErr) throw new Error(proxyErr);
    if (!this.isOmniProxy() && !String(this.settings.proxy.country || '').trim()) {
      this.event('⚠ Proxy xoay chưa điền "Quốc gia": nhà cung cấp sẽ trả IP ngẫu nhiên nhiều nước, không khớp dấu vân tay vi-VN. Nên điền VN.');
    }
    if (this.settings.threads > 1 && this.settings.captchaMode === 'manual' && !this.settings.headless) {
      this.event(`⚠ ${this.settings.threads} luồng mà vẫn giải captcha tay: nhiều cửa sổ captcha cùng lúc rất khó theo kịp. Nên chọn CapSolver hoặc bật "Chạy ẩn".`);
    }
    if (this.settings.threads > 2 && this.settings.profileMode === 'fresh') {
      this.event('⚠ "Tạo mới mỗi lượt" tốn hạn mức tạo profile của OmniLogin và nặng máy khi chạy nhiều luồng — nên chuyển sang "Dùng lại nhóm cố định" và tăng "Tạo lại profile sau".');
    }
    if (!this.tasks.some(t => t.enabled && t.count > 0)) throw new Error('Danh sách từ khóa trống.');
    if (this.localRun() && !(await this.checkOmniLogin({ force: true }))) throw new Error(`OmniLogin chưa sẵn sàng: ${this.omni_.message}`);
    if (this.settings.captchaMode === 'capsolver' && !this.settings.solverApiKey) throw new Error('Chưa nhập CapSolver API key.');
    if (this.settings.device !== 'desktop' && this.settings.headless) {
      this.event('⚠ Đang bật "Chạy ẩn" nhưng có lượt chạy bằng di động: emulation di động chỉ đúng khi mở cửa sổ thật (chế độ ẩn sai viewport, không cuộn được) — các lượt di động sẽ tự bỏ "Chạy ẩn".');
    }
    this.running = true;
    await this.save();
    if (this.localRun() && !this.workers.size) await this.cleanupOrphans();
    const mode = this.isOmniProxy()
      ? (this.omniRotate()
        ? `${this.omniThreads()} luồng song song, XOAY TUA ${this.omniProfiles().length} profile OmniLogin (mỗi lượt lấy profile nghỉ lâu nhất, chờ đổi IP mỗi ${Math.round(this.rotateSecMs() / 1000)}s)`
        : `${this.omniThreads()} luồng song song, mỗi luồng gắn 1 profile OmniLogin (chờ đổi IP mỗi ${Math.round(this.rotateSecMs() / 1000)}s)`)
      : this.settings.profileMode === 'pool' ? `dùng lại ${this.settings.threads} profile cố định` : 'tạo profile mới mỗi lượt';
    this.event(`▶ Bắt đầu chiến dịch: ${this.tasks.filter(t => t.enabled).length} từ khóa, tối đa ${this.settings.threads} luồng, ${mode}, thiết bị ${this.deviceLabel()}, captcha=${this.settings.captchaMode}.`);
    this.notify(`▶ <b>WingTraffic</b>: bắt đầu chiến dịch — ${this.tasks.filter(t => t.enabled).length} từ khóa, ${this.settings.threads} luồng.`);
    this.schedule();
  }

  async stop() {
    this.running = false;
    await this.save();
    this.event(`■ Dừng chiến dịch — ${this.workers.size} luồng đang chạy sẽ chạy nốt lượt hiện tại.`);
    this.notify('■ <b>WingTraffic</b>: đã dừng chiến dịch.');
  }

  schedule() {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick().catch(e => this.event(`Lỗi lập lịch: ${e.message}`)), TICK_MS);
    this.tick().catch(() => {});
  }

  async tick() {
    await this.syncTasks();
    if (!this.running) return;
    if (!inActiveHours(this.settings)) return;
    this.remote?.sweep();
    await this.tickRemote();
    if (this.localRun()) await this.tickLocal();
  }

  async tickRemote() {
    if (!this.remote) return;
    const lanes = [];
    for (const agent of this.remote.onlineAgents()) {
      if (this.agentQuotaDay[agent.id] === today()) continue;
      lanes.push({ agent, slots: this.remote.freeSlots(agent) });
    }
    for (let i = 0; lanes.some(l => i < l.slots.length); i++) {
      for (const l of lanes) {
        if (i >= l.slots.length) continue;
        const task = this.pickTask();
        if (!task) return;
        this.launchRemote(task, l.agent, l.slots[i]);
      }
    }
  }

  async tickLocal() {
    if (this.quotaDay === today()) return;
    if (this.workers.size < this.maxThreads() && !(await this.checkOmniLogin())) return;
    if (this.isOmniProxy()) { await this.tickOmni(); return; }
    while (this.workers.size < this.maxThreads()) {
      const freeMB = os.freemem() / 1048576;
      const starting = [...this.workers.values()].filter(w => Date.now() - w.startedAt < MEM_SETTLE_MS).length;
      const needMB = memNeededMB(this.settings, starting);
      if (freeMB < needMB) {
        if (Date.now() - this.lastMemWarn > 60000) {
          this.event(`⚠ RAM trống ${Math.round(freeMB)} MB < ${Math.round(needMB)} MB cần thiết (${this.settings.minFreeMemMB} sàn${starting ? ` + ${starting}×${this.settings.memPerThreadMB} cho luồng vừa mở` : ''}) — tạm chưa mở thêm luồng (${this.workers.size} đang chạy).`);
          this.lastMemWarn = Date.now();
        }
        return;
      }
      const task = this.pickTask();
      if (!task) return;
      this.launch(task);
      await new Promise(r => setTimeout(r, rand(3000, 8000)));
      if (!this.running) return;
    }
  }

  async tickOmni() {
    for (let slot = 1; slot <= this.omniThreads(); slot++) {
      if (!this.running) return;
      if (this.workers.has(slot)) continue;
      const rotateProfile = this.omniRotate()
        ? pickRotateProfile(this.omniProfiles(), new Set([...this.workers.values()].map(w => w.profile).filter(Boolean)), this.omniProfileLast, this.rotateSecMs())
        : null;
      if (this.omniRotate()) { if (!rotateProfile) return; }
      else if (!this.omniReady(slot)) continue;
      const freeMB = os.freemem() / 1048576;
      const starting = [...this.workers.values()].filter(w => Date.now() - w.startedAt < MEM_SETTLE_MS).length;
      const needMB = memNeededMB(this.settings, starting);
      if (freeMB < needMB) {
        if (Date.now() - this.lastMemWarn > 60000) {
          this.event(`⚠ RAM trống ${Math.round(freeMB)} MB < ${Math.round(needMB)} MB cần thiết (${this.settings.minFreeMemMB} sàn${starting ? ` + ${starting}×${this.settings.memPerThreadMB} cho luồng vừa mở` : ''}) — tạm chưa mở thêm luồng (${this.workers.size} đang chạy).`);
          this.lastMemWarn = Date.now();
        }
        return;
      }
      const task = this.pickTask();
      if (!task) return;
      this.launch(task, slot, rotateProfile);
      this.omniLastRun[slot] = Date.now();
      if (rotateProfile) this.omniProfileLast[rotateProfile] = Date.now();
      await new Promise(r => setTimeout(r, rand(3000, 8000)));
    }
  }

  dayStats(taskId, date = today()) {
    const d = (this.stats[date] ||= {});
    const s = (d[taskId] ||= { ok: 0, notfound: 0, captcha: 0, error: 0 });
    s.byHour ||= {};
    return s;
  }

  doneToday(taskId) {
    const s = this.dayStats(taskId);
    return s.ok + s.notfound + s.captcha;
  }

  doneThisHour(taskId) {
    return this.dayStats(taskId).byHour[new Date().getHours()] || 0;
  }

  dueCount(t, now = new Date()) {
    const n = t.count;
    if (n <= 0) return 0;
    let start, len, key;
    if (t.unit === 'hour') {
      if (!inActiveHours(this.settings)) return 0;
      start = new Date(now); start.setMinutes(0, 0, 0);
      len = 3600000;
      key = `${today()}#${now.getHours()}`;
    } else {
      const { activeFrom: a, activeTo: b } = this.settings;
      const [fromH, toH] = a < b ? [a, b] : [0, 24];
      start = new Date(now); start.setHours(fromH, 0, 0, 0);
      len = (toH - fromH) * 3600000;
      key = today();
    }
    const elapsed = now - start;
    if (elapsed < 0) return 0;
    if (elapsed >= len) return n;
    const interval = len / n;
    let due = 0;
    for (let i = 0; i < n; i++) {
      const jitter = (seeded(`${t.id}|${key}|${i}`) - 0.5) * 0.6;
      if ((i + 0.5 + jitter) * interval <= elapsed) due++;
      else break;
    }
    return due;
  }

  pickTask() {
    const now = Date.now();
    const inflight = new Map();
    for (const w of this.allWorkers()) inflight.set(w.taskId, (inflight.get(w.taskId) || 0) + 1);
    const eligible = [];
    for (const t of this.tasks) {
      if (!t.enabled || t.count <= 0) continue;
      if ((inflight.get(t.id) || 0) >= this.taskThreads(t)) continue;
      if ((this.backoff[t.id] || 0) > now) continue;
      const done = t.unit === 'hour' ? this.doneThisHour(t.id) : this.doneToday(t.id);
      const behind = this.dueCount(t) - done;
      if (behind <= 0) continue;
      eligible.push({ t, behind, ratio: done / t.count });
    }
    if (!eligible.length) return null;
    eligible.sort((a, b) => b.behind - a.behind || a.ratio - b.ratio || Math.random() - 0.5);
    return eligible[0].t;
  }

  taskThreads(task) {
    const own = clampInt(task?.maxThreads, 1, MAX_THREADS, 1);
    return Math.max(1, Math.min(own, Math.max(1, this.totalThreads())));
  }

  dailyTarget(t) {
    if (t.unit !== 'hour') return t.count;
    const { activeFrom: a, activeTo: b } = this.settings;
    return t.count * (a < b ? b - a : 24 - a + b);
  }

  deviceLabel() {
    if (this.settings.device === 'mobile') return 'di động (Android/iPhone)';
    if (this.settings.device === 'mixed') {
      const pct = mobilePct(this.settings);
      return `hỗn hợp ${100 - pct}% máy tính / ${pct}% di động`;
    }
    return 'máy tính';
  }

  launch(task, forcedSlot = null, profile = null) {
    const slot = forcedSlot ?? firstFreeSlot(this.workers);
    const device = this.nextDevice(task);
    const impressionOnly = this.nextImpression(task);
    const cancel = makeCancel();
    const w = { slot, profile, taskId: task.id, dbId: task.dbId, cancel, keyword: task.keyword, targetUrl: task.targetUrl, queryMode: task.queryMode, step: 'Chuẩn bị', ip: '', device: device.label, impressionOnly, startedAt: Date.now(), logs: [], captchaSince: null };
    this.workers.set(slot, w);
    this.lastStart[task.id] = Date.now();
    const log = msg => {
      w.logs.push(`[${new Date().toLocaleTimeString('vi-VN')}] ${msg}`);
      if (w.logs.length > WORKER_LOG_LINES) w.logs.shift();
      if (/^IP: /.test(msg)) w.ip = msg.slice(4);
    };
    this.event(`Luồng ${slot}: bắt đầu "${task.keyword}"${impressionOnly ? ' (lượt chỉ hiển thị — không bấm vào kết quả)' : ''}.`);
    const onCaptcha = (waiting, info = {}) => {
      if (waiting) {
        focusProfileWindow(info.profileName);
        w.captchaSince = Date.now();
        w.captchas = (w.captchas || 0) + 1;
        this.event(`⚠ Luồng ${slot}: Google captcha ("${task.keyword}", IP ${w.ip || '?'}) — chờ giải tay tối đa ${this.settings.captchaWaitMin} phút.`);
        notifyWindows(`WingTraffic — luồng ${slot} cần giải captcha`, `"${task.keyword}" · IP ${w.ip || '?'} · chờ ${this.settings.captchaWaitMin} phút, cửa sổ đã được đưa lên trước.`);
        this.notify(`⚠ <b>WingTraffic</b>: luồng ${slot} cần giải captcha — "${esc(task.keyword)}", chờ ${this.settings.captchaWaitMin} phút.`, { kind: 'captcha' });
      } else if (w.captchaSince) {
        this.event(`Luồng ${slot}: kết thúc chờ captcha sau ${Math.round((Date.now() - w.captchaSince) / 1000)}s.`);
        w.captchaSince = null;
      }
    };
    runVisit(this.omni, {
      slot, profileName: profile || undefined, keyword: task.keyword, targetUrl: task.targetUrl, queryMode: task.queryMode,
      settings: { ...this.settings, ...this.taskParams(task), impressionOnly },
      solver: this.settings.captchaMode === 'capsolver' && this.settings.solverApiKey
        ? { apiKey: this.settings.solverApiKey, type: 'capsolver' } : null,
      proxyPool: this.proxyPool,
      device,
      cancel,
      onLease: name => { w.profileName = name; },
      log, onStep: s => { w.step = s; }, onCaptcha,
    })
      .then(res => this.finish(w, task, res))
      .catch(e => this.finish(w, task, { status: 'error', ip: w.ip, error: e.message }));
  }

  remoteSettings(task, impressionOnly) {
    const { telegram, ...rest } = this.settings;
    return { ...structuredClone(rest), ...this.taskParams(task), impressionOnly };
  }

  launchRemote(task, agent, slot) {
    const device = this.nextDevice(task);
    const impressionOnly = this.nextImpression(task);
    const cancel = makeCancel();
    const key = `${agent.id}:${slot}`;
    const w = { slot: `${agent.name} #${slot}`, key, remote: { id: agent.id, name: agent.name }, taskId: task.id, dbId: task.dbId, cancel, keyword: task.keyword, targetUrl: task.targetUrl, queryMode: task.queryMode, step: 'Chờ máy phụ nhận', ip: '', device: device.label, impressionOnly, startedAt: Date.now(), logs: [], captchaSince: null };
    this.remoteWorkers.set(key, w);
    this.lastStart[task.id] = Date.now();
    this.event(`Luồng ${w.slot}: bắt đầu "${task.keyword}"${impressionOnly ? ' (lượt chỉ hiển thị — không bấm vào kết quả)' : ''}.`);
    const payload = {
      slot, keyword: task.keyword, targetUrl: task.targetUrl, queryMode: task.queryMode,
      settings: this.remoteSettings(task, impressionOnly),
      solver: this.settings.captchaMode === 'capsolver' && this.settings.solverApiKey ? { apiKey: this.settings.solverApiKey, type: 'capsolver' } : null,
      device,
    };
    const job = this.remote.dispatch(agent, slot, payload, {
      onProgress: p => {
        w.step = p.step || w.step;
        if (p.ip) w.ip = p.ip;
        if (p.profileName) w.profileName = p.profileName;
        if (p.logs?.length) w.logs = p.logs;
        if (p.ramMB != null) w.ramPeak = Math.max(w.ramPeak || 0, p.ramMB);
        if (p.cpuPct != null) { w.cpuSum = (w.cpuSum || 0) + p.cpuPct; w.cpuN = (w.cpuN || 0) + 1; }
        if (p.captchaWaiting && !w.captchaSince) { w.captchaSince = Date.now(); w.captchas = (w.captchas || 0) + 1; }
        else if (!p.captchaWaiting) w.captchaSince = null;
      },
    });
    cancel.hook = () => this.remote.cancel(job.id);
    job.promise.then(res => this.finish(w, task, res)).catch(e => this.finish(w, task, { status: 'error', ip: w.ip, error: e.message }));
  }

  trackFetchFail(res) {
    if (res.status === 'error' && /fetch failed/i.test(res.error || '')) this.fetchFailStreak++;
    else if (res.status !== 'cancelled') this.fetchFailStreak = 0;
    if (this.fetchFailStreak >= FETCH_FAIL_RECONNECT && this.makeOmni) this.reconnectOmni();
  }

  reconnectOmni() {
    const n = this.fetchFailStreak;
    this.fetchFailStreak = 0;
    try { this.omni = this.makeOmni(); } catch (e) { this.event(`✖ Không tạo lại được kết nối OmniLogin: ${e.message}`); return; }
    this.omni_.checkedAt = 0;
    this.event(`🔄 ${n} lượt liên tiếp lỗi "fetch failed" — đã TẠO LẠI kết nối tới OmniLogin. Nếu vẫn lỗi tiếp, hãy tắt và mở lại OmniLogin.`);
    this.notify(`🔄 <b>WingTraffic</b>: ${n} lượt liên tiếp lỗi "fetch failed" — đã tạo lại kết nối OmniLogin.`);
  }

  async finish(w, task, res) {
    if (w.remote) this.remoteWorkers.delete(w.key); else this.workers.delete(w.slot);
    if (res.status === 'cancelled') {
      delete this.lastStart[task.id];
      this.event(`Luồng ${w.slot}: đã huỷ lượt "${task.keyword}" (${Math.round((Date.now() - w.startedAt) / 1000)}s) vì chiến dịch đã dừng.`);
      return;
    }
    if (!w.remote) this.trackFetchFail(res);
    if (w.remote && res.status === 'quota') {
      this.agentQuotaDay[w.remote.id] = today();
      delete this.lastStart[task.id];
      this.event(`⛔ Máy phụ "${w.remote.name}": hết lượt tạo profile OmniLogin trong ngày — máy này nghỉ tới ngày mai, các máy khác vẫn chạy.`);
      this.notify(`⛔ <b>WingTraffic</b>: máy phụ ${esc(w.remote.name)} hết lượt tạo profile OmniLogin trong ngày.`);
      return;
    }
    if (w.remote && res.status === 'limit') {
      delete this.lastStart[task.id];
      this.event(`⚠ Máy phụ "${w.remote.name}": gói OmniLogin hết chỗ profile — máy phụ tự giảm số luồng.`);
      return;
    }
    if (res.status === 'quota') {
      this.quotaDay = today();
      delete this.lastStart[task.id];
      this.event(`⛔ OmniLogin: đã hết lượt tạo profile trong ngày ("${res.error}"). Tạm ngừng mở luồng mới tới ngày mai.`);
      this.notify('⛔ <b>WingTraffic</b>: hết lượt tạo profile OmniLogin trong ngày — tạm ngừng tới ngày mai.');
      return;
    }
    if (res.status === 'limit') {
      this.limitCap = Math.max(1, this.workers.size);
      this.limitAt = Date.now();
      delete this.lastStart[task.id];
      this.event(`⚠ Gói OmniLogin đã đạt số profile tối đa — tạm chạy ${this.limitCap} luồng. Nâng gói hoặc xóa bớt profile để chạy nhiều luồng hơn.`);
      this.notify(`⚠ <b>WingTraffic</b>: gói OmniLogin hết chỗ profile — tạm chạy ${this.limitCap} luồng.`);
      return;
    }
    if (/Bridge API is disabled/i.test(res.error || '')) {
      this.event('⛔ OmniLogin đang tắt Bridge API — bật trong Preferences → Enable Bridge API.');
      this.notify('⛔ <b>WingTraffic</b>: OmniLogin đang tắt Bridge API — cần bật trong Preferences → Enable Bridge API.');
    } else if (/không cấp được bridge|Bridge URL not returned/i.test(res.error || '')) {
      this.event('⚠ OmniLogin không cấp được Bridge (process omniBridge chưa sẵn sàng) — đã thử lại; lặp lại nhiều lần thì tắt và mở lại OmniLogin.');
    }
    const started = new Date(w.startedAt);
    const s = this.dayStats(task.id, started.toLocaleDateString('sv-SE'));
    s[res.status] = (s[res.status] || 0) + 1;
    if (['ok', 'notfound', 'captcha'].includes(res.status)) s.byHour[started.getHours()] = (s.byHour[started.getHours()] || 0) + 1;
    if (res.status === 'error' && !res.verify) this.backoff[task.id] = Date.now() + 120000;
    const r = res.result || {};
    const rec = {
      at: new Date().toISOString(),
      keyword: task.keyword,
      targetUrl: task.targetUrl,
      query: r.query || res.query || '',
      status: res.status,
      impression: !!r.impression,
      ip: res.ip,
      seconds: Math.round((Date.now() - w.startedAt) / 1000),
      position: r.matched ? `Tr.${r.matched.page} #${r.matched.position}` : '',
      onSite: r.visit ? r.visit.totalSeconds : 0,
      pages: r.visit ? r.visit.pages.length : 0,
      error: res.error || '',
      agent: w.remote?.name || '',
      attempts: res.attempts || 1,
      captchas: w.captchas || 0,
      proxy: res.proxy || '',
      device: res.device || '',
      ramPeakMB: w.ramPeak || null,
      cpuAvg: w.cpuN ? Math.round((w.cpuSum / w.cpuN) * 10) / 10 : null,
      logs: res.status === 'ok' ? undefined : w.logs.slice(-40),
    };
    this.recent.unshift(rec);
    this.recent.length = Math.min(this.recent.length, RECENT_RUNS);
    this.countDevice(res);
    this.countImpression(res);
    this.recordDb(task, rec, res);
    if (task.dbId && res.status === 'captcha') {
      store.notify({
        userId: task.userId, campaignId: task.dbId,
        title: `Captcha khi chạy "${task.keyword}"`,
        body: `IP ${res.ip || '?'} — lượt này được thử lại với IP khác.`,
      });
    }
    const label = res.status === 'ok' && r.impression ? '👁 chỉ hiển thị'
      : { ok: '✔', notfound: '✖ không thấy URL', captcha: '⚠ captcha', error: '✖ lỗi' }[res.status];
    this.event(`Luồng ${w.slot}: ${label} "${task.keyword}" (${rec.seconds}s${rec.position ? ', ' + rec.position : ''}${res.ip ? ', IP ' + res.ip : ''}${rec.device ? ', ' + rec.device : ''}).`);
    try {
      await this.saveStats();
      await fs.appendFile(this.runsFile, JSON.stringify(rec) + '\n', 'utf8');
      await this.proxyPool.save();
    } catch {}
    this.markDoneIfReached(task);
  }

  countDevice(res) {
    if (this.deviceDone.date !== today()) this.deviceDone = { date: today(), desktop: 0, mobile: 0 };
    const kind = res.deviceKind || (/máy tính/i.test(res.device || '') ? 'desktop' : 'mobile');
    if (this.deviceDone[kind] !== undefined) this.deviceDone[kind] += 1;
  }

  countImpression(res) {
    if (this.impressionDone.date !== today()) this.impressionDone = { date: today(), count: 0 };
    if (res?.result?.impression) this.impressionDone.count += 1;
  }

  async shutdown() {
    clearInterval(this.timer);
    clearInterval(this.houseTimer);
    clearInterval(this.monitorTimer);
    this.workers.clear();
    this.remoteWorkers.clear();
    await this.proxyPool.save();
    await this.cleanupOrphans();
  }

  status() {
    const date = today();
    return {
      running: this.running,
      dbMode: this.dbMode,
      dbError: store.error() || null,
      inActiveHours: inActiveHours(this.settings),
      maxThreads: this.maxThreads(),
      quotaBlocked: this.quotaDay === today(),
      limitCap: this.limitCap,
      freeMemMB: Math.round(os.freemem() / 1048576),
      totalMemMB: Math.round(os.totalmem() / 1048576),
      settings: {
        ...this.settings,
        solverApiKey: this.settings.solverApiKey ? '••••••' : '',
        proxy: { ...this.settings.proxy, password: this.settings.proxy.password ? '••••••' : '' },
        telegram: { ...this.settings.telegram, token: this.settings.telegram.token ? '••••••' : '' },
      },
      omni: { up: this.omni_.up, message: this.omni_.message, launching: this.omni_.launching },
      deviceStats: this.devicePlan(),
      impressionStats: this.impressionPlan(),
      system: this.monitor.system,
      proxyStats: this.proxyPool.stats(),
      tasks: this.tasks.map(t => ({
        ...t,
        today: this.dayStats(t.id, date),
        perDay: this.dailyTarget(t),
        due: this.dueCount(t),
        doneNow: t.unit === 'hour' ? this.doneThisHour(t.id) : this.doneToday(t.id),
        dbToday: t.dbId ? store.todayCount(t.dbId) : null,
        pace: this.paceOf(t),
      })),
      localRun: this.localRun(),
      totalThreads: this.totalThreads(),
      agents: this.remote ? this.remote.summary() : [],
      workers: this.allWorkers().sort((a, b) => String(a.slot).localeCompare(String(b.slot), undefined, { numeric: true })).map(w => ({
        ...w,
        elapsed: Math.round((Date.now() - w.startedAt) / 1000),
        captchaLeft: w.captchaSince ? Math.max(0, Math.round((w.captchaSince + this.settings.captchaWaitMin * 60000 - Date.now()) / 1000)) : null,
      })),
      recent: this.recent.slice(0, 50),
      events: this.events.slice(0, 40),
    };
  }
}

function normalizeSettings(s = {}) {
  const d = DEFAULT_SETTINGS;
  let dwellMin = clampInt(s.dwellMin, 0, MAX_DWELL_SEC, d.dwellMin), dwellMax = clampInt(s.dwellMax, 0, MAX_DWELL_SEC, d.dwellMax);
  if (dwellMin > dwellMax) [dwellMin, dwellMax] = [dwellMax, dwellMin];
  let subDwellMin = clampInt(s.subDwellMin, 0, MAX_DWELL_SEC, d.subDwellMin), subDwellMax = clampInt(s.subDwellMax, 0, MAX_DWELL_SEC, d.subDwellMax);
  if (subDwellMin > subDwellMax) [subDwellMin, subDwellMax] = [subDwellMax, subDwellMin];
  const p = { ...d.proxy, ...(s.proxy || {}) };
  const tg = { ...d.telegram, ...(s.telegram || {}) };
  return {
    localRun: s.localRun !== false,
    autoLaunchOmni: s.autoLaunchOmni !== false,
    omniloginPath: String(s.omniloginPath || '').trim(),
    telegram: {
      token: String(tg.token || '').trim(),
      chatId: String(tg.chatId || '').trim(),
      events: tg.events !== false,
      captchaAlerts: !!tg.captchaAlerts,
      dailyHour: clampInt(tg.dailyHour, 0, 23, d.telegram.dailyHour),
    },
    threads: clampInt(s.threads, 1, MAX_THREADS, d.threads),
    maxPages: clampInt(s.maxPages, 1, 10, d.maxPages),
    dwellMin, dwellMax, subDwellMin, subDwellMax,
    subpages: clampInt(s.subpages, 0, MAX_SUBPAGES, d.subpages),
    headless: !!s.headless,
    device: ['desktop', 'mobile', 'mixed'].includes(s.device) ? s.device : d.device,
    mobilePercent: clampInt(s.mobilePercent, 0, 100, d.mobilePercent),
    impressionEvery: clampInt(s.impressionEvery, 0, 100, d.impressionEvery),
    activeFrom: clampInt(s.activeFrom, 0, 23, d.activeFrom),
    activeTo: clampInt(s.activeTo, 1, 24, d.activeTo),
    minFreeMemMB: clampInt(s.minFreeMemMB, 200, 16000, d.minFreeMemMB),
    memPerThreadMB: clampInt(s.memPerThreadMB, 0, 4096, d.memPerThreadMB),
    profileMode: s.profileMode === 'fresh' ? 'fresh' : 'pool',
    recycleAfter: clampInt(s.recycleAfter, 0, 1000, d.recycleAfter),
    captchaMode: ['rotate', 'capsolver'].includes(s.captchaMode) ? s.captchaMode : 'manual',
    captchaWaitMin: clampInt(s.captchaWaitMin, 1, 15, d.captchaWaitMin),
    solverApiKey: String(s.solverApiKey || '').trim(),
    proxy: {
      mode: p.mode === 'omni' ? 'omni' : 'webshare',
      type: ['HTTP', 'HTTPS', 'Socks5'].includes(p.type) ? p.type : 'HTTP',
      host: String(p.host || '').trim(),
      port: clampInt(p.port, 1, 65535, 80),
      userBase: String(p.userBase || '').trim(),
      password: String(p.password || ''),
      country: String(p.country || '').trim().toUpperCase(),
      profiles: Array.isArray(p.profiles) ? p.profiles.map(s => String(s).trim()).filter(Boolean) : [],
      rotateSec: clampInt(p.rotateSec, 10, 86400, 305),
    },
  };
}

function normalizeTasks(list = []) {
  return list
    .map(t => ({
      id: String(t.id || `${t.keyword}|${t.targetUrl}`),
      keyword: String(t.keyword || '').trim(),
      targetUrl: String(t.targetUrl || '').trim(),
      count: clampInt(t.count ?? t.perDay, 0, 10000, 10),
      unit: t.unit === 'hour' ? 'hour' : 'day',
      enabled: t.enabled !== false,
    }))
    .filter(t => t.keyword && t.targetUrl);
}

export function memNeededMB({ minFreeMemMB, memPerThreadMB } = {}, starting = 0) {
  return (Number(minFreeMemMB) || 0) + Math.max(0, starting) * (Number(memPerThreadMB) || 0);
}

function inActiveHours({ activeFrom, activeTo }) {
  const h = new Date().getHours();
  return activeFrom < activeTo ? h >= activeFrom && h < activeTo : h >= activeFrom || h < activeTo;
}

function seeded(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  return ((h >>> 0) % 100000) / 100000;
}

function firstFreeSlot(map) {
  for (let i = 1; ; i++) if (!map.has(i)) return i;
}