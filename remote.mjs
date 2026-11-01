import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { rateLimiter } from './auth/register.mjs';
import { manifestDiff } from './package-hash.mjs';

export const ONLINE_MS = 20000;
export const PICKUP_MS = 30000;
export const RUNNING_GRACE_MS = 20000;
export const REPORT_GRACE_MS = 60000;
export const LOST_MS = 180000;
const MAX_BODY = 1024 * 1024;
const MAX_AGENTS = 50;
const NAME_RE = /^[\p{L}\p{N} ._-]{2,40}$/u;
const today = () => new Date().toLocaleDateString('sv-SE');

const sha256 = s => crypto.createHash('sha256').update(String(s)).digest('hex');
const safeEq = (a, b) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && crypto.timingSafeEqual(x, y); };
const newKey = () => `wt_${crypto.randomBytes(24).toString('base64url')}`;

export class RemoteHub {
  constructor(file, { now = Date.now, manifest = () => null } = {}) {
    this.file = file;
    this.now = now;
    this.manifest = manifest;
    this.agents = new Map();
    this.jobs = new Map();
    this.cancelQueue = new Map();
    this.failLimiter = rateLimiter({ limit: 20, windowMs: 10 * 60 * 1000 });
    this.seq = 0;
  }

  async load() {
    try {
      const data = JSON.parse(await fs.readFile(this.file, 'utf8'));
      for (const a of data.agents || []) {
        if (!a?.id || !a.keyHash) continue;
        this.agents.set(a.id, { id: a.id, name: a.name, keyHash: a.keyHash, enabled: a.enabled !== false, createdAt: a.createdAt, lastSeen: 0, info: {}, running: [], day: { date: today(), ok: 0, fail: 0 } });
      }
    } catch {  }
  }

  async save() {
    const agents = [...this.agents.values()].map(a => ({ id: a.id, name: a.name, keyHash: a.keyHash, enabled: a.enabled, createdAt: a.createdAt }));
    await fs.writeFile(this.file, JSON.stringify({ agents }, null, 2), 'utf8');
  }

  async create(name) {
    name = String(name || '').trim();
    if (!NAME_RE.test(name)) throw Object.assign(new Error('Tên máy phụ 2–40 ký tự (chữ, số, khoảng trắng, . _ -).'), { status: 400 });
    if ([...this.agents.values()].some(a => a.name.toLowerCase() === name.toLowerCase())) throw Object.assign(new Error('Đã có máy phụ trùng tên.'), { status: 409 });
    if (this.agents.size >= MAX_AGENTS) throw Object.assign(new Error(`Tối đa ${MAX_AGENTS} máy phụ.`), { status: 400 });
    const key = newKey();
    const agent = { id: crypto.randomBytes(4).toString('hex'), name, keyHash: sha256(key), enabled: true, createdAt: new Date().toISOString(), lastSeen: 0, info: {}, running: [], day: { date: today(), ok: 0, fail: 0 } };
    this.agents.set(agent.id, agent);
    await this.save();
    return { agent, key };
  }

  async rotateKey(id) {
    const a = this.agents.get(id);
    if (!a) throw Object.assign(new Error('Không có máy phụ này.'), { status: 404 });
    const key = newKey();
    a.keyHash = sha256(key);
    a.lastSeen = 0;
    this.failJobsOf(id, 'Khoá máy phụ vừa được đổi.');
    await this.save();
    return { agent: a, key };
  }

  async setEnabled(id, enabled) {
    const a = this.agents.get(id);
    if (!a) throw Object.assign(new Error('Không có máy phụ này.'), { status: 404 });
    a.enabled = !!enabled;
    if (!a.enabled) this.failJobsOf(id, 'Máy phụ đã bị tắt.');
    await this.save();
    return a;
  }

  async remove(id) {
    if (!this.agents.has(id)) throw Object.assign(new Error('Không có máy phụ này.'), { status: 404 });
    this.failJobsOf(id, 'Máy phụ đã bị xoá.');
    this.agents.delete(id);
    this.cancelQueue.delete(id);
    await this.save();
  }

  view(a) {
    const online = this.isOnline(a);
    const jobs = [...this.jobs.values()].filter(j => j.agentId === a.id);
    if (a.day.date !== today()) a.day = { date: today(), ok: 0, fail: 0 };
    return {
      id: a.id, name: a.name, enabled: a.enabled, createdAt: a.createdAt, online,
      lastSeen: a.lastSeen ? new Date(a.lastSeen).toISOString() : null,
      threads: Number(a.info.threads) || 0,
      freeSlots: online ? this.freeSlots(a) : [],
      omniUp: a.info.omniUp ?? null,
      freeMemMB: a.info.freeMemMB ?? null, totalMemMB: a.info.totalMemMB ?? null, cpuPct: a.info.cpuPct ?? null,
      version: a.info.version || '', host: a.info.host || '',
      outdated: a.info.files ? manifestDiff(a.info.files, this.manifest()) : null,
      busy: jobs.length,
      today: { ok: a.day.ok, fail: a.day.fail },
    };
  }

  summary() {
    return [...this.agents.values()].map(a => this.view(a));
  }

  isOnline(a) { return a.enabled && a.lastSeen > 0 && this.now() - a.lastSeen < ONLINE_MS; }
  onlineAgents() { return [...this.agents.values()].filter(a => this.isOnline(a)); }

  capacity() { return this.onlineAgents().reduce((n, a) => n + (Number(a.info.threads) || 0), 0); }

  freeSlots(a) {
    const used = new Set([...this.jobs.values()].filter(j => j.agentId === a.id).map(j => j.slot));
    return (Array.isArray(a.info.freeSlots) ? a.info.freeSlots : []).filter(s => Number.isInteger(s) && s >= 1 && s <= 64 && !used.has(s));
  }

  dispatch(agent, slot, payload, { onProgress = null } = {}) {
    const id = `j${Date.now().toString(36)}${(++this.seq).toString(36)}`;
    let resolve;
    const promise = new Promise(r => { resolve = r; });
    this.jobs.set(id, { id, agentId: agent.id, slot, payload, state: 'queued', createdAt: this.now(), sentAt: 0, seenRunningAt: 0, resolve, onProgress });
    return { id, promise };
  }

  settle(job, res) {
    if (!this.jobs.delete(job.id)) return false;
    job.resolve(res);
    return true;
  }

  cancel(jobId) {
    const job = this.jobs.get(jobId);
    if (!job) return;
    if (job.state !== 'queued') {
      if (!this.cancelQueue.has(job.agentId)) this.cancelQueue.set(job.agentId, new Set());
      this.cancelQueue.get(job.agentId).add(jobId);
    }
    this.settle(job, { status: 'cancelled', cancelled: true, ip: '', error: 'Đã huỷ: chiến dịch bị dừng.' });
  }

  failJobsOf(agentId, why) {
    for (const job of [...this.jobs.values()]) {
      if (job.agentId === agentId) this.settle(job, { status: 'error', ip: '', error: why, lost: true });
    }
  }

  sweep() {
    const t = this.now();
    for (const job of [...this.jobs.values()]) {
      const a = this.agents.get(job.agentId);
      if (!a || !a.enabled) { this.settle(job, { status: 'error', ip: '', error: 'Máy phụ không còn hoạt động.', lost: true }); continue; }
      if (job.state === 'queued') {
        if (t - job.createdAt > PICKUP_MS) this.settle(job, { status: 'error', ip: '', error: `Máy phụ "${a.name}" không nhận lượt (offline?).`, lost: true });
      } else if (t - a.lastSeen > LOST_MS) {
        this.settle(job, { status: 'error', ip: '', error: `Mất liên lạc với máy phụ "${a.name}" hơn ${Math.round(LOST_MS / 60000)} phút.`, lost: true });
      } else if (job.state === 'running' && a.lastSeen - (job.lastReportedAt || job.seenRunningAt) > REPORT_GRACE_MS) {
        this.settle(job, { status: 'error', ip: '', error: `Máy phụ "${a.name}" khởi động lại, mất lượt đang chạy.`, lost: true });
      } else if (job.state === 'sent' && !job.seenRunningAt && t - job.sentAt > RUNNING_GRACE_MS && a.lastSeen > job.sentAt + 1000) {
        this.settle(job, { status: 'error', ip: '', error: `Máy phụ "${a.name}" khởi động lại, mất lượt đang chạy.`, lost: true });
      }
    }
  }

  authenticate(req) {
    const m = /^Bearer\s+(\S+)$/i.exec(String(req.headers.authorization || ''));
    if (!m) return null;
    const h = sha256(m[1]);
    for (const a of this.agents.values()) if (safeEq(a.keyHash, h)) return a;
    return null;
  }

  async handle(req, res, url, { clientIp = () => '' } = {}) {
    const p = url.pathname;
    if (p !== '/api/agent/poll' && p !== '/api/agent/result') return false;
    const json = (status, body) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(body)); return true; };
    if (req.method !== 'POST') return json(405, { error: 'Chỉ nhận POST.' });
    const ip = clientIp(req);
    const agent = this.authenticate(req);
    if (!agent) {
      const lim = this.failLimiter.check(ip);
      return json(lim.ok ? 401 : 429, { error: lim.ok ? 'Khoá máy phụ không đúng.' : 'Sai khoá quá nhiều lần, thử lại sau.' });
    }
    if (!agent.enabled) return json(403, { error: 'Máy phụ này đã bị tắt ở máy chính.' });
    let body;
    try { body = await readJson(req); } catch (e) { return json(e.status || 400, { error: e.message }); }
    agent.lastSeen = this.now();
    if (p === '/api/agent/result') return json(200, this.onResult(agent, body));
    return json(200, this.onPoll(agent, body));
  }

  onPoll(agent, body) {
    const info = body?.info && typeof body.info === 'object' ? body.info : {};
    agent.info = {
      threads: clampInt(info.threads, 0, 64), freeSlots: (Array.isArray(info.freeSlots) ? info.freeSlots : []).map(Number).filter(Number.isInteger).slice(0, 64),
      omniUp: typeof info.omniUp === 'boolean' ? info.omniUp : null,
      freeMemMB: numOrNull(info.freeMemMB), totalMemMB: numOrNull(info.totalMemMB), cpuPct: numOrNull(info.cpuPct),
      version: String(info.version || '').slice(0, 20), host: String(info.host || '').slice(0, 60),
      files: cleanManifest(info.files),
    };
    const running = Array.isArray(body?.running) ? body.running.slice(0, 64) : [];
    const t = this.now();
    for (const r of running) {
      const job = this.jobs.get(String(r?.jobId));
      if (!job || job.agentId !== agent.id) continue;
      job.state = 'running';
      job.seenRunningAt = t;
      job.lastReportedAt = t;
      try { job.onProgress?.({ step: String(r.step || '').slice(0, 80), ip: String(r.ip || '').slice(0, 60), profileName: r.profileName ? String(r.profileName).slice(0, 80) : '', logs: (Array.isArray(r.logs) ? r.logs : []).slice(-60).map(x => String(x).slice(0, 300)), captchaWaiting: !!r.captchaWaiting, ramMB: numOrNull(r.ramMB), cpuPct: numOrNull(r.cpuPct) }); } catch {  }
    }
    const jobs = [];
    for (const job of this.jobs.values()) {
      if (job.agentId !== agent.id || job.state !== 'queued') continue;
      job.state = 'sent';
      job.sentAt = t;
      jobs.push({ id: job.id, slot: job.slot, payload: job.payload });
    }
    const cancel = [...(this.cancelQueue.get(agent.id) || [])];
    this.cancelQueue.delete(agent.id);
    this.sweep();
    return { ok: true, jobs, cancel, now: new Date(t).toISOString() };
  }

  onResult(agent, body) {
    const job = this.jobs.get(String(body?.jobId));
    if (!job || job.agentId !== agent.id) return { ok: true, ignored: true };
    let res = body.result;
    if (!res || typeof res !== 'object' || typeof res.status !== 'string') res = { status: 'error', ip: '', error: 'Máy phụ trả kết quả không hợp lệ.' };
    if (agent.day.date !== today()) agent.day = { date: today(), ok: 0, fail: 0 };
    if (res.status === 'ok') agent.day.ok++; else if (res.status !== 'cancelled') agent.day.fail++;
    this.settle(job, res);
    return { ok: true };
  }
}

function cleanManifest(m) {
  if (!m || typeof m !== 'object' || Array.isArray(m)) return null;
  const out = {};
  for (const [k, v] of Object.entries(m).slice(0, 64)) out[String(k).slice(0, 80)] = v == null ? null : String(v).slice(0, 16);
  return out;
}
function clampInt(v, min, max) { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(Math.max(n, min), max) : 0; }
function numOrNull(v) { const n = Number(v); return v === undefined || v === null || v === '' || !Number.isFinite(n) ? null : n; }

async function readJson(req) {
  let data = '';
  for await (const chunk of req) {
    data += chunk;
    if (data.length > MAX_BODY) throw Object.assign(new Error('Dữ liệu quá lớn.'), { status: 413 });
  }
  try { return data ? JSON.parse(data) : {}; } catch { throw Object.assign(new Error('JSON không hợp lệ.'), { status: 400 }); }
}
