import {
  CAMPAIGN_TYPES, SELECTABLE_CAMPAIGN_TYPES, UNITS, APPROVAL_STATUSES, CAMPAIGN_STATUSES, USER_ROLES, USER_STATUSES,
  getCampaignType, isValidCampaignType, splitKeywordUrl,
  QUERY_MODES, QUERY_MODE_IDS, getQueryMode, isValidQueryMode, searchQuery,
} from './campaign-types.mjs';
import { WALLET_SETTING_KEYS, normalizeWalletSettings, normalizeTopup } from './wallet.mjs';
import { MAX_THREADS } from './campaign-pace.mjs';
import { TRAFFIC_PRICES, PRICE_EFFECTIVE_FROM } from './pricing.mjs';
import { serverStatus, scheduleRestart } from './server-control.mjs';
import { readGate, writeGate } from './gate.mjs';
import { buildCampaignReport } from './export-report.mjs';
import { checkFooterBadge } from './footer-check.mjs';
import { rateLimiter } from './auth/register.mjs';
const SSE_INTERVAL_MS = 3000;

function fail(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

const str = (v, max = 0) => {
  const s = String(v ?? '').trim();
  return max > 0 ? s.slice(0, max) : s;
};
const int = (v, def = 0) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? n : def;
};
const clamp = (n, min, max) => Math.min(Math.max(n, min), max);
const day = n => new Date(Date.now() - n * 86400000).toLocaleDateString('sv-SE');

function stamp(v, { endOfDay = false } = {}) {
  if (v === undefined) return undefined;
  const s = str(v, 19);
  if (!s) return null;
  if (!/^\d{4}-\d{2}-\d{2}([ T]\d{2}:\d{2}(:\d{2})?)?$/.test(s)) {
    throw fail(400, `Mốc thời gian không hợp lệ: "${s}" (cần dạng YYYY-MM-DD hoặc YYYY-MM-DD HH:MM).`);
  }
  const [d, t] = s.replace('T', ' ').split(' ');
  if (!t) return `${d} ${endOfDay ? '23:59:59' : '00:00:00'}`;
  return `${d} ${t.length === 5 ? `${t}:00` : t}`;
}

function url(v) {
  const s = str(v, 500);
  if (!s) throw fail(400, 'URL đích đang trống.');
  let u;
  try {
    u = new URL(s);
  } catch {
    throw fail(400, `URL đích không hợp lệ: "${s}".`);
  }
  if (!/^https?:$/.test(u.protocol)) throw fail(400, 'URL đích phải bắt đầu bằng http:// hoặc https://.');
  return u.toString();
}

function campaignInput(body, { partial = false, canSetThreads = true } = {}) {
  const b = body && typeof body === 'object' ? body : {};
  const has = k => b[k] !== undefined;
  const out = {};
  const split = has('keyword') ? splitKeywordUrl(b.keyword, b.targetUrl) : null;
  if (!partial || has('name')) out.name = str(b.name, 80) || null;
  if (!partial || has('keyword')) {
    const k = split ? split.keyword : str(b.keyword, 200);
    if (!k) {
      throw fail(400, split?.url
        ? 'Ô “Từ khóa” đang chỉ có URL (không có từ khóa). Nhập từ khóa vào ô “Từ khóa” và để URL ở ô “URL đích”.'
        : 'Từ khóa đang trống.');
    }
    out.keyword = k;
  }
  if (!partial || has('targetUrl')) out.targetUrl = url(str(b.targetUrl) || (split && split.url) || '');
  if (!partial || has('queryMode')) {
    const qm = str(b.queryMode, 20) || 'keyword';
    if (!isValidQueryMode(qm)) throw fail(400, `Kiểu truy vấn không hợp lệ: "${qm}" (chỉ nhận ${QUERY_MODE_IDS.join(' | ')}).`);
    out.queryMode = qm;
  }
  if (!canSetThreads) {
    if (!partial) out.maxThreads = 1;
  } else if (!partial || has('maxThreads')) {
    const n = int(b.maxThreads, 1);
    if (n < 1 || n > MAX_THREADS) throw fail(400, `Số luồng tối đa của chiến dịch phải trong khoảng 1–${MAX_THREADS} luồng.`);
    out.maxThreads = n;
  }
  if (!partial || has('type')) {
    const t = str(b.type, 40) || 'search_dwell';
    if (!isValidCampaignType(t)) throw fail(400, `Loại chiến dịch không hợp lệ: "${t}".`);
    out.type = t;
  }
  if (!partial || has('count')) {
    const n = int(b.count, 0);
    if (n < 1 || n > 10000) throw fail(400, 'Chỉ tiêu phải trong khoảng 1–10000 lượt.');
    out.count = n;
  }
  if (!partial || has('unit')) {
    const u = str(b.unit, 10) || 'day';
    if (!UNITS.includes(u)) throw fail(400, `Đơn vị chỉ tiêu không hợp lệ: "${u}" (chỉ nhận ${UNITS.join(' | ')}).`);
    out.unit = u;
  }
  if (!partial || has('priority')) out.priority = clamp(int(b.priority, 0), -100, 100);
  if (!partial || has('note')) out.note = str(b.note, 500) || null;
  if (!partial || has('startAt')) out.startAt = stamp(b.startAt);
  if (!partial || has('endAt')) out.endAt = stamp(b.endAt, { endOfDay: true });
  if (!partial && out.startAt && out.endAt && out.startAt > out.endAt) throw fail(400, 'Thời gian bắt đầu phải trước thời gian kết thúc.');
  return out;
}

const MAX_PENDING = 3;
const MAX_TOTAL = 50;

function createLimits() {
  return { maxPending: MAX_PENDING, maxTotal: MAX_TOTAL };
}

function limitInfo(repo, userId) {
  const me = repo.users.byId(userId);
  if (!me) return null;
  const { maxPending, maxTotal } = createLimits();
  return {
    active: repo.campaigns.activeCount(userId),
    pending: repo.campaigns.pendingCount(userId), maxPending,
    total: repo.campaigns.countByUser(userId), maxTotal,
    todayRuns: repo.runs.todayCountByUser(userId),
  };
}

function toPatch(input, extra = {}) {
  const p = { ...extra };
  const map = { name: 'name', keyword: 'keyword', targetUrl: 'target_url', type: 'type', count: 'count', unit: 'unit', queryMode: 'query_mode', maxThreads: 'max_threads', priority: 'priority', note: 'note', startAt: 'start_at', endAt: 'end_at' };
  for (const [k, col] of Object.entries(map)) if (input[k] !== undefined) p[col] = input[k];
  return p;
}

function toCampaign(r) {
  const t = getCampaignType(r.type);
  return {
    id: r.id,
    userId: r.user_id,
    owner: r.owner,
    ownerName: r.owner_name || null,
    name: r.name,
    keyword: r.keyword,
    targetUrl: r.target_url,
    type: r.type,
    typeLabel: t ? t.label : r.type,
    queryMode: r.query_mode || 'keyword',
    queryModeLabel: (getQueryMode(r.query_mode) || QUERY_MODES[0]).label,
    query: searchQuery({ keyword: r.keyword, targetUrl: r.target_url, queryMode: r.query_mode }),
    maxThreads: Math.max(1, Math.min(Number(r.max_threads) || 1, MAX_THREADS)),
    count: r.count,
    unit: r.unit,
    status: r.status,
    approval: r.approval_status,
    rejectReason: r.reject_reason || null,
    approvedBy: r.approver || null,
    approvedAt: r.approved_at || null,
    priority: r.priority,
    note: r.note || null,
    startAt: r.start_at || null,
    endAt: r.end_at || null,
    createdAt: r.created_at || null,
    footerCheck: { status: r.footer_check || null, note: r.footer_check_note || null, checkedAt: r.footer_checked_at || null },
    hidden: !!r.hidden,
    hiddenAt: r.hidden_at || null,
    updatedAt: r.updated_at || null,
    editor: r.editor || null,
    engine: getCampaignType(r.type)?.engine || null,
    today: {
      attempts: r.today_attempts || 0, ok: r.today_ok || 0, notfound: r.today_notfound || 0,
      captcha: r.today_captcha || 0, error: r.today_error || 0,
    },
  };
}

function toUser(u) {
  return {
    id: u.id, username: u.username, displayName: u.display_name || null, role: u.role, status: u.status,
    lastLoginAt: u.last_login_at || null, createdAt: u.created_at || null,
  };
}

let dbPromise = null;
async function loadDb() {
  if (!dbPromise) {
    dbPromise = import('./database/repo.mjs').catch(e => {
      dbPromise = null;
      throw fail(503, `Chưa cài đủ thư viện CSDL (better-sqlite3): ${e.message}`);
    });
  }
  return dbPromise;
}

async function loadAuth() {
  try {
    return await import('./auth/auth.mjs');
  } catch (e) {
    throw fail(503, `Chưa cài đủ thư viện đăng nhập (bcrypt): ${e.message}`);
  }
}

function myNotifications(repo, user, { unreadOnly = false, limit = 50 } = {}) {
  const max = Math.min(Math.max(Math.round(Number(limit)) || 50, 1), 200);
  const mine = repo.notifications.list({ userId: user.id, unreadOnly, limit: max });
  const roleWide = user.role ? repo.notifications.list({ userId: null, role: user.role, unreadOnly, limit: max }) : [];
  return [...mine, ...roleWide.filter(n => !mine.some(x => x.id === n.id))]
    .sort((a, b) => String(b.at).localeCompare(String(a.at)) || b.id - a.id)
    .slice(0, max);
}

function unreadCount(repo, user) {
  if (!user || user.id == null) return 0;
  return repo.notifications.unreadCount({ userId: user.id }) + (user.role ? repo.notifications.unreadCount({ role: user.role }) : 0);
}

function withEngine(c, campaign) {
  const { activeFrom: a, activeTo: b } = campaign.settings;
  const hours = a < b ? b - a : 24 - a + b;
  return {
    ...c,
    perDay: c.unit === 'hour' ? c.count * hours : c.count,
    activeFrom: a,
    activeTo: b,
  };
}

function ownedCampaign(repo, user, id) {
  const row = repo.campaigns.byId(id);
  if (!row) throw fail(404, 'Không tìm thấy chiến dịch.');
  if (user.role !== 'admin' && row.user_id !== Number(user.id)) throw fail(403, 'Chiến dịch này không thuộc tài khoản của bạn.');
  return row;
}

function hasRuns(repo, id) {
  return repo.runs.recent({ campaignId: id, limit: 1 }).length > 0;
}

function walletSettings(repo) {
  const all = repo.settings.all();
  return normalizeWalletSettings(Object.fromEntries(
    Object.entries(WALLET_SETTING_KEYS).map(([field, key]) => [field, all[key] ?? ''])
  ));
}

function ranksByCampaign(repo, opts = {}) {
  const out = {};
  for (const r of repo.runs.rankByDevice(opts)) {
    (out[r.campaignId] ||= {})[r.deviceKind] = { position: r.position, at: r.at, keyword: r.keyword };
  }
  for (const r of repo.ranks.list(opts)) {
    (out[r.campaignId] ||= {})[r.deviceKind] = { position: r.position, at: r.at };
  }
  return out;
}

const passwordFailLimiter = rateLimiter({ limit: 6, windowMs: 10 * 60 * 1000 });

async function handleAccount(ctx) {
  const { req, res, url, send, readBody, repo, need } = ctx;
  const p = url.pathname;
  if (!p.startsWith('/api/account/')) return false;
  const me = need();

  if (p === '/api/account/profile' && req.method === 'POST') {
    const body = await readBody(req);
    repo.users.update(me.id, { display_name: str(body.displayName, 80) || null });
    repo.audit.add({ actorId: me.id, actorRole: me.role, action: 'update', entity: 'user', entityId: me.id, note: 'Tự đổi tên hiển thị.' });
    return send(res, 200, { ok: true, user: toUser(repo.users.byId(me.id)) });
  }

  if (p === '/api/account/password' && req.method === 'POST') {
    const body = await readBody(req);
    const current = String(body.current ?? ''), next = String(body.password ?? '');
    if (!current) throw fail(400, 'Hãy nhập mật khẩu hiện tại.');
    if (next.length < 8) throw fail(400, 'Mật khẩu mới cần tối thiểu 8 ký tự.');
    if (next.length > 72) throw fail(400, 'Mật khẩu mới tối đa 72 ký tự.');
    if (next === current) throw fail(400, 'Mật khẩu mới phải khác mật khẩu hiện tại.');
    if (body.passwordConfirm !== undefined && String(body.passwordConfirm) !== next) throw fail(400, 'Mật khẩu nhập lại không khớp.');
    const lim = passwordFailLimiter.check(String(me.id));
    if (!lim.ok) throw fail(429, `Nhập sai mật khẩu hiện tại quá nhiều lần. Thử lại sau ${Math.max(1, Math.ceil(lim.retryAfterSec / 60))} phút.`);
    const auth = await loadAuth();
    const row = repo.users.authRow(me.username);
    if (!row || !(await auth.verifyPassword(current, row.password_hash))) throw fail(400, 'Mật khẩu hiện tại chưa đúng.');
    passwordFailLimiter.release(String(me.id));
    repo.users.update(me.id, { password_hash: await auth.hashPassword(next), pw_changed_at: Date.now() });
    res.setHeader('Set-Cookie', `${process.env.AUTH_COOKIE || 'omni_token'}=${auth.generateToken(me.id, me.role)}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${7 * 24 * 3600}${process.env.COOKIE_SECURE === '1' ? '; Secure' : ''}`);
    repo.audit.add({ actorId: me.id, actorRole: me.role, action: 'update', entity: 'user', entityId: me.id, note: 'Tự đổi mật khẩu (các phiên đăng nhập cũ bị thu hồi).' });
    repo.notifications.add({ userId: me.id, title: 'Mật khẩu của bạn vừa được đổi', body: 'Nếu không phải bạn thực hiện, hãy liên hệ quản trị viên ngay.' });
    return send(res, 200, { ok: true, signedOutOthers: true });
  }
  if (p === '/api/account/profile' && req.method === 'GET') return send(res, 200, { ok: true, user: toUser(repo.users.byId(me.id)) });
  return false;
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const fmtLogAt = s => String(s || '').replace(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}:\d{2}).*$/, '$4 $3/$2/$1');
const csvCell = v => {
  let s = String(v ?? '');
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

async function handleRunLog(ctx) {
  const { req, res, url, send, repo, need } = ctx;
  const m = url.pathname.match(/^\/api\/campaigns\/(\d+)\/(log|log\.csv|log-exports)$/);
  if (!m || req.method !== 'GET') return false;
  const user = need();
  const id = Number(m[1]);
  ownedCampaign(repo, user, id);
  const q = url.searchParams;
  const day = v => (DAY_RE.test(String(v || '')) ? String(v) : null);
  const from = day(q.get('from'));
  const to = day(q.get('to'));
  const filter = { campaignId: id, keyword: str(q.get('keyword'), 200) || null, from: from && `${from} 00:00:00`, to: to && `${to} 23:59:59` };

  if (m[2] === 'log-exports') return send(res, 200, { ok: true, exports: repo.runExports.list(id) });

  if (m[2] === 'log') {
    const pageSize = clamp(int(q.get('pageSize'), 50), 10, 200);
    const page = Math.max(int(q.get('page'), 1), 1);
    const { total, rows } = repo.runs.log({ ...filter, limit: pageSize, offset: (page - 1) * pageSize });
    return send(res, 200, {
      ok: true, total, page, pageSize, keywords: repo.runs.logKeywords(id),
      rows: rows.map((r, i) => ({ n: (page - 1) * pageSize + i + 1, keyword: r.keyword || '', ip: r.ip || '', userAgent: r.userAgent || '', at: r.at })),
    });
  }

  const { total, rows } = repo.runs.log({ ...filter, limit: 100000, offset: 0 });
  const lines = [['STT', 'Từ khóa', 'IP', 'User Agent', 'Thời gian'].map(csvCell).join(',')];
  rows.forEach((r, i) => lines.push([i + 1, r.keyword || '', r.ip || '', r.userAgent || '', fmtLogAt(r.at)].map(csvCell).join(',')));
  const body = Buffer.from('﻿' + lines.join('\r\n') + '\r\n', 'utf8');
  const stamp = (await import('./database/repo.mjs')).now().slice(0, 10);
  res.writeHead(200, {
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename="WingTraffic-log-chien-dich-${id}-${stamp}.csv"`,
    'Content-Length': body.length, 'Cache-Control': 'no-store',
  });
  res.end(body);
  repo.runExports.add({ campaignId: id, userId: user.id, keyword: filter.keyword, from, to, rows: total });
  return true;
}

async function handleExport(ctx) {
  const { req, res, url, campaign, repo, need, isAdmin } = ctx;
  if (req.method !== 'GET' || url.pathname !== '/api/export/campaigns.xlsx') return false;
  const me = need();
  const uid = isAdmin && url.searchParams.get('userId') ? Number(url.searchParams.get('userId')) : Number(me.id);
  const urow = repo.users.byId(uid);
  if (!urow) throw fail(404, 'Không tìm thấy tài khoản.');
  const camps = repo.campaigns.list({ userId: uid, limit: 1000 }).map(r => withEngine(toCampaign(r), campaign));
  const stamp = (await import('./database/repo.mjs')).now();
  const buf = buildCampaignReport({
    user: { username: urow.username, displayName: urow.display_name, createdAt: urow.created_at },
    campaigns: camps,
    daily: repo.stats.dailyByCampaign(uid),
    today: stamp.slice(0, 10),
    exportedAt: stamp,
  });
  const safe = String(urow.username).replace(/[^A-Za-z0-9._-]/g, '_');
  res.writeHead(200, {
    'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'Content-Disposition': `attachment; filename="WingTraffic-thong-ke-${safe}-${stamp.slice(0, 10)}.xlsx"`,
    'Content-Length': buf.length, 'Cache-Control': 'no-store',
  });
  res.end(buf);
  repo.audit.add({ actorId: me.id, actorRole: me.role, action: 'export', entity: 'user', entityId: uid, note: 'Xuất Excel thống kê traffic mọi chiến dịch.' });
  return true;
}

async function handleServer(ctx) {
  const { req, res, url, campaign, send, adminOnly, readBody, repo, actor } = ctx;
  const p = url.pathname;
  if (p === '/api/server/backups' && req.method === 'GET') {
    adminOnly();
    return send(res, 200, { ok: true, backups: (await import('./backup.mjs')).listBackups() });
  }
  if (p === '/api/server/backup' && req.method === 'GET') {
    adminOnly();
    const b = await import('./backup.mjs');
    let name = url.searchParams.get('name');
    let file;
    if (name) { file = b.backupFile(name); if (!file) throw fail(404, 'Không tìm thấy bản sao lưu.'); }
    else { name = (await b.createBackup('tay')).name; file = b.backupFile(name); }
    const buf = await (await import('node:fs/promises')).readFile(file);
    res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Disposition': `attachment; filename="${name}"`, 'Content-Length': buf.length, 'Cache-Control': 'no-store' });
    res.end(buf);
    repo.audit.add({ actorId: actor.id, actorRole: actor.role, action: 'export', entity: 'settings', note: `Tải bản sao lưu CSDL ${name}.` });
    return true;
  }

  if (p === '/api/server/gate') {
    adminOnly();
    if (req.method === 'GET') {
      const g = readGate(repo);
      return send(res, 200, { ok: true, enabled: g.enabled, hasPassword: g.hasPassword });
    }
    if (req.method === 'POST') {
      const body = await readBody(req);
      let r;
      try { r = await writeGate(repo, await loadAuth(), { enabled: typeof body.enabled === 'boolean' ? body.enabled : undefined, password: body.password }, actor.id); }
      catch (e) { throw fail(e.status || 400, e.message); }
      repo.audit.add({
        actorId: actor.id, actorRole: actor.role, action: 'update', entity: 'settings',
        after: { gateEnabled: r.enabled, gateHasPassword: r.hasPassword, passwordChanged: !!body.password },
        note: 'Cập nhật cổng mật khẩu truy cập từ ngoài (tunnel/tên miền).',
      });
      return send(res, 200, { ok: true, ...r });
    }
    return false;
  }
  if (req.method === 'GET' && p === '/api/server/status') {
    adminOnly();
    return send(res, 200, { ok: true, ...serverStatus() });
  }
  if (req.method === 'POST' && p === '/api/server/restart') {
    adminOnly();
    const st = serverStatus();
    send(res, 200, { ok: true, restarting: true, supervised: st.supervised, pid: st.pid });
    scheduleRestart(campaign);
    return true;
  }
  return false;
}

async function handleStats(ctx) {
  const { req, res, url, campaign, send, repo, actor, isAdmin } = ctx;
  const p = url.pathname;

  if (req.method === 'GET' && p === '/api/meta') {
    const st = campaign.status();
    return send(res, 200, {
      ok: true,
      types: SELECTABLE_CAMPAIGN_TYPES,
      trafficPrices: TRAFFIC_PRICES,
      priceEffectiveFrom: PRICE_EFFECTIVE_FROM,
      queryModes: QUERY_MODES,
      maxThreadsPerCampaign: MAX_THREADS,
      units: UNITS,
      approvalStatuses: APPROVAL_STATUSES,
      campaignStatuses: CAMPAIGN_STATUSES,
      roles: USER_ROLES,
      userStatuses: USER_STATUSES,
      me: actor,
      engine: {
        running: st.running, dbMode: st.dbMode, dbError: st.dbError, threads: st.maxThreads,
        activeFrom: campaign.settings.activeFrom, activeTo: campaign.settings.activeTo, inActiveHours: st.inActiveHours,
      },
    });
  }

  if (req.method === 'GET' && p === '/api/badges') {
    return send(res, 200, {
      ok: true,
      pending: isAdmin ? repo.campaigns.pendingCount() : null,
      unread: actor ? unreadCount(repo, actor) : 0,
    });
  }

  if (req.method === 'GET' && p === '/api/stats/daily') {
    const user = ctx.need();
    const params = {
      campaignId: url.searchParams.get('campaignId') ? Number(url.searchParams.get('campaignId')) : null,
      userId: isAdmin && url.searchParams.get('userId') ? Number(url.searchParams.get('userId')) : null,
      from: url.searchParams.get('from') || day(int(url.searchParams.get('days'), 30) - 1),
      to: url.searchParams.get('to') || day(0),
      type: isValidCampaignType(url.searchParams.get('type') || '') ? url.searchParams.get('type') : null,
    };
    if (!isAdmin) params.userId = Number(user.id);
    return send(res, 200, { ok: true, ...params, days: repo.stats.daily(params) });
  }

  if (req.method === 'GET' && p === '/api/stats/keywords') {
    const user = ctx.need();
    const params = {
      campaignId: url.searchParams.get('campaignId') ? Number(url.searchParams.get('campaignId')) : null,
      userId: isAdmin && url.searchParams.get('userId') ? Number(url.searchParams.get('userId')) : null,
      from: url.searchParams.get('from') || day(int(url.searchParams.get('days'), 30) - 1),
      to: url.searchParams.get('to') || day(0),
      limit: int(url.searchParams.get('limit'), 200),
    };
    if (!isAdmin || url.searchParams.get('mine') === '1') params.userId = Number(user.id);
    return send(res, 200, { ok: true, ...params, keywords: repo.stats.byKeyword(params) });
  }

  if (req.method === 'GET' && p === '/api/stats/revenue') {
    ctx.adminOnly();
    return send(res, 200, { ok: true, ...repo.stats.revenue() });
  }

  if (req.method === 'GET' && p === '/api/stats/summary') {
    const user = ctx.need();
    const userId = isAdmin && url.searchParams.get('userId') ? Number(url.searchParams.get('userId')) : Number(user.id);
    const summary = repo.stats.summary({ userId: userId || null });
    return send(res, 200, {
      ok: true,
      summary,
      limits: limitInfo(repo, user.id),
      counts: {
        campaigns: repo.campaigns.list({ userId: userId || null, limit: 1000 }).length,
        pending: isAdmin ? repo.campaigns.pendingCount() : null,
      },
    });
  }

  if (req.method === 'GET' && p === '/api/runs') {
    const user = ctx.need();
    const runs = repo.runs.recent({
      campaignId: url.searchParams.get('campaignId') ? Number(url.searchParams.get('campaignId')) : null,
      userId: isAdmin && url.searchParams.get('userId') ? Number(url.searchParams.get('userId')) : Number(user.id),
      limit: int(url.searchParams.get('limit'), 100),
    });
    return send(res, 200, { ok: true, runs });
  }

  return false;
}

let footerChecker = checkFooterBadge;
export function __setFooterChecker(fn) { footerChecker = fn || checkFooterBadge; }

async function runFooterCheck(repo, id, { maxAgeSec = 0 } = {}) {
  const row = repo.campaigns.byId(id);
  if (!row) return { status: 'error', note: 'Không tìm thấy chiến dịch.' };
  if (maxAgeSec > 0 && row.footer_check && row.footer_checked_at && (Date.now() - Date.parse(row.footer_checked_at)) < maxAgeSec * 1000) {
    return { status: row.footer_check, note: row.footer_check_note || '', checkedAt: row.footer_checked_at, cached: true };
  }
  let r;
  try { r = await footerChecker(row.target_url); } catch (e) { r = { status: 'error', note: `Lỗi khi kiểm tra: ${e.message}`, checkedAt: new Date().toISOString() }; }
  try { repo.campaigns.setFooterCheck(id, { status: r.status, note: r.note, at: r.checkedAt }); } catch {  }
  return r;
}

async function handleCampaigns(ctx) {
  const { req, res, url, campaign, send, readBody, repo, need, adminOnly, isAdmin } = ctx;
  const p = url.pathname;

  if (p === '/api/campaigns' && req.method === 'GET') {
    const user = need();
    const scopeUserId = isAdmin && url.searchParams.get('mine') !== '1' ? null : Number(user.id);
    const list = repo.campaigns.list({
      userId: scopeUserId,
      approval: url.searchParams.get('approval') || null,
      status: url.searchParams.get('status') || null,
      q: url.searchParams.get('q') || null,
      limit: int(url.searchParams.get('limit'), 200),
    });
    return send(res, 200, {
      ok: true,
      campaigns: list.map(r => withEngine(toCampaign(r), campaign)),
      ranks: ranksByCampaign(repo, { userId: scopeUserId }),
      limits: limitInfo(repo, user.id),
    });
  }

  if (p === '/api/campaigns' && req.method === 'POST') {
    const user = need();
    const input = campaignInput(await readBody(req), { canSetThreads: isAdmin });
    if (!isAdmin) {
      const me = repo.users.byId(user.id);
      if (me) {
        const { maxPending, maxTotal } = createLimits();
        const pending = repo.campaigns.pendingCount(user.id);
        const total = repo.campaigns.countByUser(user.id);
        if (pending >= maxPending) {
          throw fail(400, `Bạn đang có ${pending} chiến dịch chờ duyệt (tối đa ${maxPending}) — chờ admin duyệt bớt rồi tạo tiếp.`);
        }
        if (total >= maxTotal) {
          throw fail(400, `Bạn đã có ${total}/${maxTotal} chiến dịch (hạn mức lưu trữ của tài khoản) — xoá bớt chiến dịch cũ rồi tạo tiếp.`);
        }
      }
    }
    const r = repo.campaigns.create({ userId: user.id, ...input, priority: isAdmin ? 10 : 0 });
    const row = repo.campaigns.detail(r.lastInsertRowid);
    repo.audit.add({
      actorId: user.id, actorRole: user.role, action: 'create', entity: 'campaign', entityId: row.id,
      after: toCampaign(row), note: `Tạo chiến dịch "${row.keyword}" (${row.count} lượt/${row.unit}).`,
    });
    repo.notifications.add({
      forRole: 'admin', campaignId: row.id,
      title: `Chờ duyệt: "${row.keyword}" của ${user.username}`,
      body: `${row.count} lượt/${row.unit} · ${row.type} · ${row.target_url}`,
    });
    runFooterCheck(repo, row.id).catch(() => {});
    return send(res, 201, { ok: true, campaign: withEngine(toCampaign(row), campaign) });
  }

  const m = p.match(/^\/api\/campaigns\/(\d+)$/);
  if (m) {
    const id = Number(m[1]);

    if (req.method === 'GET') {
      const user = need();
      ownedCampaign(repo, user, id);
      const row = repo.campaigns.detail(id);
      return send(res, 200, {
        ok: true,
        campaign: withEngine(toCampaign(row), campaign),
        runs: repo.runs.recent({ campaignId: id, limit: int(url.searchParams.get('runs'), 50) }),
        daily: repo.stats.daily({ campaignId: id, from: url.searchParams.get('from') || day(29), to: url.searchParams.get('to') || day(0) }),
        keywords: repo.stats.byKeyword({ campaignId: id, limit: 50 }),
        ranks: ranksByCampaign(repo, { campaignId: id })[id] || {},
      });
    }

    if (req.method === 'PATCH') {
      const user = need();
      const row = ownedCampaign(repo, user, id);
      const patch = toPatch(campaignInput(await readBody(req), { partial: true, canSetThreads: isAdmin }));
      if (!isAdmin) {
        if (row.hidden) throw fail(400, 'Chiến dịch đang ẩn — hãy bỏ ẩn trước khi sửa.');
        if (row.approval_status === 'approved' && row.status === 'running') {
          throw fail(400, 'Chiến dịch đang chạy — hãy tạm dừng rồi gửi yêu cầu sửa cho admin.');
        }
        patch.approval_status = 'pending';
        patch.reject_reason = null;
      }
      if (!Object.keys(patch).length) throw fail(400, 'Không có trường nào để cập nhật.');
      repo.campaigns.update(id, patch, user.id);
      const after = repo.campaigns.detail(id);
      repo.audit.add({
        actorId: user.id, actorRole: user.role, action: 'update', entity: 'campaign', entityId: id,
        before: toCampaign(row), after: toCampaign(after),
        note: isAdmin ? 'Admin sửa chiến dịch.' : 'Chủ chiến dịch sửa — chuyển về chờ duyệt lại.',
      });
      if (isAdmin && after.user_id !== Number(user.id)) {
        repo.notifications.add({
          userId: after.user_id, campaignId: id,
          title: `Chiến dịch "${after.keyword}" đã được admin cập nhật`,
          body: `${after.count} lượt/${after.unit} · ${after.type}`,
        });
      } else if (!isAdmin) {
        repo.notifications.add({ forRole: 'admin', campaignId: id, title: `Chờ duyệt lại: "${after.keyword}" của ${user.username}` });
      }
      await campaign.syncTasks();
      if (patch.target_url !== undefined && patch.target_url !== row.target_url) runFooterCheck(repo, id).catch(() => {});
      return send(res, 200, { ok: true, campaign: withEngine(toCampaign(after), campaign) });
    }
  }

  return false;
}

async function handleCampaignActions(ctx) {
  const { req, res, url, campaign, send, readBody, repo, need, adminOnly, isAdmin } = ctx;
  const p = url.pathname;

  const del = p.match(/^\/api\/campaigns\/(\d+)$/);
  if (del && req.method === 'DELETE') {
    const user = need();
    const id = Number(del[1]);
    const row = ownedCampaign(repo, user, id);
    if (!isAdmin) throw fail(403, 'Bạn không xoá được chiến dịch — hãy dùng chức năng Ẩn (dữ liệu thống kê vẫn được giữ).');
    const hard = isAdmin && url.searchParams.get('hard') === '1';
    if (!hard && hasRuns(repo, id)) {
      repo.campaigns.setStatus(id, 'stopped', user.id);
      repo.audit.add({ actorId: user.id, actorRole: user.role, action: 'stop', entity: 'campaign', entityId: id, note: 'Giữ lịch sử nên chỉ dừng chiến dịch.' });
      await campaign.syncTasks();
      return send(res, 200, { ok: true, stopped: true, campaign: withEngine(toCampaign(repo.campaigns.detail(id)), campaign) });
    }
    if (!isAdmin && row.approval_status === 'approved' && ['running', 'paused'].includes(row.status)) {
      throw fail(400, 'Chiến dịch đã được duyệt — hãy tạm dừng rồi xoá, hoặc nhờ admin xoá.');
    }
    repo.campaigns.remove(id);
    repo.audit.add({ actorId: user.id, actorRole: user.role, action: 'delete', entity: 'campaign', entityId: id, before: toCampaign(row) });
    if (!isAdmin) repo.notifications.add({ forRole: 'admin', title: `${user.username} đã xoá chiến dịch "${row.keyword}"`, body: row.target_url });
    await campaign.syncTasks();
    return send(res, 200, { ok: true, deleted: true, id });
  }

  const hid = p.match(/^\/api\/campaigns\/(\d+)\/hide$/);
  if (hid && req.method === 'POST') {
    const user = need();
    const id = Number(hid[1]);
    ownedCampaign(repo, user, id);
    const hidden = (await readBody(req)).hidden !== false;
    repo.campaigns.setHidden(id, hidden, user.id);
    repo.audit.add({ actorId: user.id, actorRole: user.role, action: hidden ? 'hide' : 'unhide', entity: 'campaign', entityId: id, note: hidden ? 'Ẩn chiến dịch (dừng chạy, giữ thống kê).' : 'Bỏ ẩn chiến dịch.' });
    await campaign.syncTasks();
    return send(res, 200, { ok: true, hidden, campaign: withEngine(toCampaign(repo.campaigns.detail(id)), campaign) });
  }

  const fchk = p.match(/^\/api\/campaigns\/(\d+)\/footer-check$/);
  if (fchk && req.method === 'POST') {
    const user = need();
    const id = Number(fchk[1]);
    ownedCampaign(repo, user, id);
    const r = await runFooterCheck(repo, id, { maxAgeSec: 20 });
    return send(res, 200, { ok: true, footer: { status: r.status, note: r.note, checkedAt: r.checkedAt || null }, campaign: withEngine(toCampaign(repo.campaigns.detail(id)), campaign) });
  }

  const act = p.match(/^\/api\/campaigns\/(\d+)\/(status|approve|reject)$/);
  if (act && req.method === 'POST') {
    const id = Number(act[1]);
    const action = act[2];
    const user = need();
    const row = ownedCampaign(repo, user, id);
    const body = await readBody(req);

    if (action !== 'status') {
      adminOnly();
      if (action === 'approve' && row.approval_status === 'approved') throw fail(400, 'Chiến dịch đã được duyệt trước đó.');
      const reason = str(body.reason, 300) || null;
      let footer = null;
      if (action === 'approve') {
        footer = await runFooterCheck(repo, id, { maxAgeSec: 120 });
        if (footer.status !== 'ok') {
          const unreachable = footer.status === 'error';
          row.owner = repo.campaigns.detail(id)?.owner || row.owner;
          repo.notifications.add({
            forRole: 'admin', campaignId: id,
            title: unreachable
              ? `⚠ Chưa kiểm tra được mã footer: chiến dịch #${id} "${row.keyword}" của ${row.owner || 'khách'}`
              : `⚠ Khách chưa cài mã footer WingTraffic: chiến dịch #${id} "${row.keyword}" của ${row.owner || 'khách'}`,
            body: `${row.target_url} — ${footer.note}`,
          });
        }
      }
      repo.campaigns.setApproval(id, { status: action === 'approve' ? 'approved' : 'rejected', byId: user.id, reason });
      if (action === 'approve') repo.campaigns.setStatus(id, 'running', user.id);
      const after = repo.campaigns.detail(id);
      repo.audit.add({
        actorId: user.id, actorRole: user.role, action, entity: 'campaign', entityId: id,
        before: toCampaign(row), after: toCampaign(after), note: reason,
      });
      repo.notifications.add({
        userId: after.user_id, campaignId: id,
        title: action === 'approve'
          ? `Chiến dịch "${after.keyword}" đã được duyệt và đang chạy`
          : `Chiến dịch "${after.keyword}" bị từ chối`,
        body: action === 'approve' ? `${after.count} lượt/${after.unit} · ${after.type}` : (reason || 'Liên hệ admin để biết chi tiết.'),
      });
      await campaign.syncTasks();
      return send(res, 200, { ok: true, campaign: withEngine(toCampaign(after), campaign), footer: footer ? { status: footer.status, note: footer.note } : undefined });
    }

    const wanted = str(body.status, 20);
    if (!CAMPAIGN_STATUSES.includes(wanted)) throw fail(400, `Trạng thái không hợp lệ: "${wanted}" (chỉ nhận ${CAMPAIGN_STATUSES.join(' | ')}).`);
    if (wanted === 'running' && row.hidden) throw fail(400, 'Chiến dịch đang ẩn — hãy bỏ ẩn trước khi chạy.');
    if (wanted === 'running' && row.approval_status !== 'approved') {
      throw fail(400, 'Chiến dịch chưa được duyệt nên chưa chạy được — hãy duyệt trước.');
    }
    repo.campaigns.setStatus(id, wanted, user.id);
    const after = repo.campaigns.detail(id);
    repo.audit.add({
      actorId: user.id, actorRole: user.role, action: wanted === 'running' ? 'run' : 'stop',
      entity: 'campaign', entityId: id, before: { status: row.status }, after: { status: wanted },
    });
    if (isAdmin && after.user_id !== Number(user.id)) {
      repo.notifications.add({ userId: after.user_id, campaignId: id, title: `Admin đổi trạng thái chiến dịch "${after.keyword}" thành ${wanted}` });
    }
    await campaign.syncTasks();
    return send(res, 200, { ok: true, campaign: withEngine(toCampaign(after), campaign) });
  }

  return false;
}

async function handleUsers(ctx) {
  const { req, res, url, campaign, send, readBody, repo, actor, adminOnly } = ctx;
  const p = url.pathname;
  if (!p.startsWith('/api/users')) return false;
  adminOnly();

  if (p === '/api/users' && req.method === 'GET') {
    const list = repo.users.list({
      role: url.searchParams.get('role') || null,
      status: url.searchParams.get('status') || null,
      q: url.searchParams.get('q') || null,
    });
    return send(res, 200, {
      ok: true,
      users: list.map(u => ({
        ...toUser(u),
        todayRuns: repo.runs.todayCountByUser(u.id),
        activeCampaigns: repo.campaigns.activeCount(u.id),
        pendingCampaigns: repo.campaigns.pendingCount(u.id),
        campaigns: repo.campaigns.countByUser(u.id),
        balance: repo.wallet.balanceOf(u.id),
        spent: repo.wallet.spentByUser(u.id),
      })),
    });
  }

  if (p === '/api/users' && req.method === 'POST') {
    const body = await readBody(req);
    const username = str(body.username, 32);
    if (!/^[a-zA-Z0-9._-]{3,32}$/.test(username)) throw fail(400, 'Tên đăng nhập 3–32 ký tự, chỉ gồm chữ, số và . _ -');
    const password = String(body.password ?? '');
    if (password.length < 8) throw fail(400, 'Mật khẩu cần tối thiểu 8 ký tự.');
    const role = USER_ROLES.includes(str(body.role, 10)) ? str(body.role, 10) : 'user';
    if (repo.users.authRow(username)) throw fail(400, `Tên đăng nhập "${username}" đã tồn tại.`);
    const auth = await loadAuth();
    const r = repo.users.create({
      username,
      passwordHash: await auth.hashPassword(password),
      role,
      displayName: str(body.displayName, 80) || null,
    });
    const created = repo.users.byId(r.lastInsertRowid);
    repo.audit.add({ actorId: actor.id, actorRole: actor.role, action: 'create', entity: 'user', entityId: created.id, after: toUser(created), note: `Tạo tài khoản ${created.username} (${created.role}).` });
    repo.notifications.add({ userId: created.id, title: 'Tài khoản của bạn đã được tạo', body: `Vai trò: ${created.role}.` });
    return send(res, 201, { ok: true, user: { ...toUser(created), todayRuns: 0, activeCampaigns: 0, campaigns: 0, balance: 0, spent: 0 } });
  }

  const mp = p.match(/^\/api\/users\/(\d+)\/progress$/);
  if (mp && req.method === 'GET') {
    const uid = Number(mp[1]);
    const urow = repo.users.byId(uid);
    if (!urow) throw fail(404, 'Không tìm thấy tài khoản.');
    const prog = new Map(repo.stats.progressByUser(uid).map(r => [r.campaignId, r]));
    const ranks = ranksByCampaign(repo, { userId: uid });
    const camps = repo.campaigns.list({ userId: uid, limit: 500 }).map(r => {
      const c = withEngine(toCampaign(r), campaign);
      const pg = prog.get(r.id) || {};
      return { ...c, totalAttempts: pg.totalAttempts || 0, totalOk: pg.totalOk || 0, spent: pg.spent || 0, firstRunAt: pg.firstRunAt || null, lastRunAt: pg.lastRunAt || null, ranks: ranks[r.id] || {} };
    });
    const sum = repo.stats.summary({ userId: uid });
    return send(res, 200, {
      ok: true,
      user: {
        ...toUser(urow),
        balance: repo.wallet.balanceOf(uid), spent: repo.wallet.spentByUser(uid),
        todayRuns: repo.runs.todayCountByUser(uid), campaigns: camps.length,
        activeCampaigns: repo.campaigns.activeCount(uid), pendingCampaigns: repo.campaigns.pendingCount(uid),
      },
      summary: { todayAttempts: sum.todayAttempts, todayOk: sum.todayOk, totalAttempts: sum.total, totalOk: sum.totalOk, captcha: sum.captcha, error: sum.error },
      campaigns: camps,
    });
  }

  const m = p.match(/^\/api\/users\/(\d+)$/);
  if (!m) return false;
  const id = Number(m[1]);
  const row = repo.users.byId(id);
  if (!row) throw fail(404, 'Không tìm thấy tài khoản.');

  if (req.method === 'PATCH') {
    const body = await readBody(req);
    const patch = {};
    if (body.displayName !== undefined) patch.display_name = str(body.displayName, 80) || null;
    if (body.role !== undefined) {
      const role = str(body.role, 10);
      if (!USER_ROLES.includes(role)) throw fail(400, `Vai trò không hợp lệ: "${role}".`);
      if (id === actor.id && role !== 'admin') {
        const otherAdmin = repo.users.list({ role: 'admin', status: 'active' }).some(u => u.id !== actor.id);
        if (!otherAdmin) {
          throw fail(400, 'Cần giữ lại ít nhất một quản trị viên: hãy cấp quyền admin cho tài khoản khác trước, hoặc chạy: npm run seed:admin -- <tên> --role admin');
        }
      }
      patch.role = role;
    }
    if (body.status !== undefined) {
      const status = str(body.status, 10);
      if (!USER_STATUSES.includes(status)) throw fail(400, `Trạng thái tài khoản không hợp lệ: "${status}".`);
      if (id === actor.id && status !== 'active') throw fail(400, 'Không thể tự khoá tài khoản của chính mình.');
      patch.status = status;
    }
    if (body.password) {
      const password = String(body.password);
      if (password.length < 8) throw fail(400, 'Mật khẩu cần tối thiểu 8 ký tự.');
      patch.password_hash = await (await loadAuth()).hashPassword(password);
      patch.pw_changed_at = Date.now();
    }
    if (!Object.keys(patch).length) throw fail(400, 'Không có trường nào để cập nhật.');
    repo.users.update(id, patch);
    const after = repo.users.byId(id);
    const action = patch.status === 'locked' ? 'lock' : patch.status === 'active' ? 'unlock' : 'update';
    repo.audit.add({
      actorId: actor.id, actorRole: actor.role, action, entity: 'user', entityId: id,
      before: toUser(row), after: { ...toUser(after), password_hash: undefined },
    });
    repo.notifications.add({
      userId: id, title: `Tài khoản của bạn vừa được admin cập nhật`,
      body: `Vai trò: ${after.role} · trạng thái: ${after.status}.`,
    });
    if (after.status !== 'active') {
      for (const c of repo.campaigns.list({ userId: id, status: 'running' })) repo.campaigns.setStatus(c.id, 'paused', actor.id);
      ctx.campaign.syncTasks();
    }
    return send(res, 200, { ok: true, user: toUser(after) });
  }

  if (req.method === 'DELETE') {
    if (id === actor.id) throw fail(400, 'Không thể xoá tài khoản đang đăng nhập.');
    const admins = repo.users.list({ role: 'admin', status: 'active' });
    if (row.role === 'admin' && admins.length <= 1) throw fail(400, 'Cần giữ lại ít nhất một quản trị viên.');
    repo.users.remove(id);
    repo.audit.add({ actorId: actor.id, actorRole: actor.role, action: 'delete', entity: 'user', entityId: id, before: toUser(row) });
    ctx.campaign.syncTasks();
    return send(res, 200, { ok: true, deleted: true, id });
  }

  return false;
}

async function handleWallet(ctx) {
  const { req, res, url, send, readBody, repo, actor, isAdmin, need, adminOnly } = ctx;
  const p = url.pathname;

  if (p === '/api/settings/wallet') {
    adminOnly();
    if (req.method === 'GET') return send(res, 200, { ok: true, wallet: walletSettings(repo) });
    if (req.method === 'POST') {
      const body = await readBody(req);
      const next = normalizeWalletSettings(body, walletSettings(repo));
      for (const [field, key] of Object.entries(WALLET_SETTING_KEYS)) repo.settings.set(key, String(next[field]), actor.id);
      repo.audit.add({
        actorId: actor.id, actorRole: actor.role, action: 'update', entity: 'settings',
        after: next, note: 'Cập nhật ví nhận tiền của admin (mục 21 HDSD).',
      });
      return send(res, 200, { ok: true, wallet: next });
    }
    return false;
  }

  if (!p.startsWith('/api/wallet')) return false;
  const me = need();
  const receive = walletSettings(repo);

  if (p === '/api/wallet' && req.method === 'GET') {
    const who = isAdmin && url.searchParams.get('userId') ? Number(url.searchParams.get('userId')) : Number(me.id);
    const owner = repo.users.byId(who);
    if (!owner) throw fail(404, 'Không tìm thấy tài khoản.');
    return send(res, 200, {
      ok: true,
      userId: who,
      owner: toUser(owner),
      ...repo.wallet.summary(who),
      campaigns: repo.wallet.spentByCampaign(who),
      txns: repo.wallet.txns({ userId: who, limit: int(url.searchParams.get('limit'), 50) }),
      receive,
    });
  }

  if (p === '/api/wallet/transactions' && req.method === 'GET') {
    const who = isAdmin
      ? (url.searchParams.get('userId') ? Number(url.searchParams.get('userId')) : null)
      : Number(me.id);
    return send(res, 200, {
      ok: true,
      items: repo.wallet.txns({
        userId: who,
        kind: url.searchParams.get('kind') || null,
        limit: int(url.searchParams.get('limit'), 100),
      }),
    });
  }

  if (p === '/api/wallet/topup' && req.method === 'POST') {
    adminOnly();
    const body = await readBody(req);
    const who = Number(body.userId);
    const target = repo.users.byId(who);
    if (!target) throw fail(404, 'Không tìm thấy tài khoản cần nạp tiền.');
    let money;
    try {
      money = normalizeTopup(body, receive);
    } catch (e) {
      throw fail(400, e.message);
    }
    const txn = repo.wallet.credit({
      userId: who, amountVnd: money.amountVnd, usdt: money.usdt, rate: money.rate,
      method: money.method, kind: 'topup', note: money.note, actorId: actor.id,
    });
    if (!txn) throw fail(500, 'Không ghi được giao dịch nạp tiền.');
    repo.audit.add({
      actorId: actor.id, actorRole: actor.role, action: 'topup', entity: 'user', entityId: who,
      after: { amountVnd: money.amountVnd, usdt: money.usdt, rate: money.rate, balance: txn.balanceAfter },
      note: `Nạp ${money.amountVnd.toLocaleString('vi-VN')}đ cho ${target.username}`
        + (money.usdt ? ` (${money.usdt} USDT × ${money.rate}đ)` : '') + '.',
    });
    repo.notifications.add({
      userId: who,
      title: `Đã nạp ${money.amountVnd.toLocaleString('vi-VN')}đ vào số dư`,
      body: (money.usdt ? `${money.usdt} USDT × ${money.rate}đ. ` : '') + `Mã giao dịch ${txn.code}.`
        + (money.note ? ` Ghi chú: ${money.note}` : ''),
    });
    await ctx.campaign.syncTasks();
    return send(res, 201, { ok: true, txn, balance: txn.balanceAfter });
  }

  if (p === '/api/wallet/adjust' && req.method === 'POST') {
    adminOnly();
    const body = await readBody(req);
    const who = Number(body.userId);
    const target = repo.users.byId(who);
    if (!target) throw fail(404, 'Không tìm thấy tài khoản cần điều chỉnh.');
    const amount = int(body.amountVnd, 0);
    if (!amount) throw fail(400, 'Số tiền điều chỉnh phải khác 0.');
    const txn = repo.wallet.adjust({
      userId: who, amountVnd: amount,
      note: str(body.note, 300) || 'Admin điều chỉnh số dư.', actorId: actor.id,
    });
    if (!txn) throw fail(400, 'Số dư không đủ để trừ.');
    repo.audit.add({
      actorId: actor.id, actorRole: actor.role, action: 'adjust', entity: 'user', entityId: who,
      after: { amountVnd: amount, balance: txn.balanceAfter },
      note: `Điều chỉnh số dư ${target.username}: ${amount > 0 ? '+' : ''}${amount.toLocaleString('vi-VN')}đ.`,
    });
    repo.notifications.add({
      userId: who,
      title: `Số dư được điều chỉnh ${amount > 0 ? '+' : ''}${amount.toLocaleString('vi-VN')}đ`,
      body: `Mã giao dịch ${txn.code}. ${txn.note || ''}`.trim(),
    });
    await ctx.campaign.syncTasks();
    return send(res, 200, { ok: true, txn, balance: txn.balanceAfter });
  }

  return false;
}

async function handleNotifications(ctx) {
  const { req, res, url, send, repo, need } = ctx;
  const p = url.pathname;

  if (p === '/api/notifications' && req.method === 'GET') {
    const user = need();
    const items = myNotifications(repo, user, {
      unreadOnly: url.searchParams.get('unread') === '1',
      limit: int(url.searchParams.get('limit'), 50),
    });
    return send(res, 200, { ok: true, unread: unreadCount(repo, user), items });
  }

  if (p === '/api/notifications/read-all' && req.method === 'POST') {
    const user = need();
    const changed = repo.notifications.markAllRead({ userId: user.id })
      + (user.role ? repo.notifications.markAllRead({ role: user.role }) : 0);
    return send(res, 200, { ok: true, changed });
  }

  const m = p.match(/^\/api\/notifications\/(\d+)\/read$/);
  if (m && req.method === 'POST') {
    need();
    return send(res, 200, { ok: true, changed: repo.notifications.markRead(Number(m[1])) });
  }

  return false;
}

async function handleAudit(ctx) {
  const { req, res, url, send, repo, adminOnly } = ctx;
  if (url.pathname !== '/api/audit' || req.method !== 'GET') return false;
  adminOnly();
  const items = repo.audit.list({
    entity: url.searchParams.get('entity') || null,
    entityId: url.searchParams.get('entityId') ? Number(url.searchParams.get('entityId')) : null,
    limit: int(url.searchParams.get('limit'), 100),
  });
  return send(res, 200, { ok: true, items });
}

function streamEvents(ctx) {
  const { req, res, campaign, actor } = ctx;
  const isAdmin = actor?.role === 'admin';
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-store, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  const push = payload => {
    try {
      res.write(`data: ${JSON.stringify(payload)}\n\n`);
    } catch {
    }
  };
  const snapshot = () => {
    const st = campaign.status();
    const mine = t => isAdmin || t.userId == null || t.userId === actor?.id;
    const tasks = st.tasks.filter(mine);
    const ids = new Set(tasks.map(t => t.id));
    return {
      type: 'status',
      at: Date.now(),
      running: st.running,
      dbMode: st.dbMode,
      inActiveHours: st.inActiveHours,
      quotaBlocked: st.quotaBlocked,
      threads: st.maxThreads,
      tasks: tasks.map(t => ({
        id: t.id, dbId: t.dbId, keyword: t.keyword, type: t.type, unit: t.unit, count: t.count,
        due: t.due, doneNow: t.doneNow, dbToday: t.dbToday, ownerId: t.userId,
        today: t.today,
      })),
      workers: st.workers.filter(w => ids.has(w.taskId)).map(w => ({
        slot: w.slot, taskId: w.taskId, keyword: w.keyword, step: w.step, ip: w.ip,
        elapsed: w.elapsed, captchaLeft: w.captchaLeft, res: w.res ? { ramMB: w.res.ramMB, cpuPct: w.res.cpuPct } : null,
      })),
      events: st.events.slice(0, 8),
    };
  };

  let repo = null;
  const tick = async () => {
    try {
      if (!repo) repo = await import('./database/repo.mjs').catch(() => null);
      const badge = repo && actor?.id != null
        ? { unread: unreadCount(repo, actor), pending: isAdmin ? repo.campaigns.pendingCount() : null }
        : null;
      let wallet = null;
      if (repo && actor?.id != null) {
        try { wallet = repo.wallet.summary(actor.id); } catch { wallet = null; }
      }
      push({ ...snapshot(), badge, wallet });
    } catch (e) {
      push({ type: 'error', error: e.message });
    }
  };
  push(snapshot());
  const timer = setInterval(tick, SSE_INTERVAL_MS);
  req.on('close', () => clearInterval(timer));
  res.on('error', () => clearInterval(timer));
}

const NEW_PATHS = /^\/(campaigns|users|meta|badges|stats|runs|notifications|audit|wallet|settings|server|export|account)(\/|$)/;

export async function handleApi(ctx) {
  const { req, res, url } = ctx;
  const p = url.pathname;
  if (!p.startsWith('/api/')) return false;
  if (req.method === 'GET' && p === '/api/events') {
    streamEvents(ctx);
    return true;
  }
  if (!NEW_PATHS.test(p.slice(4))) return false;

  const repo = await loadDb();
  const actor = ctx.actor || null;
  const isAdmin = actor?.role === 'admin';
  const scope = {
    ...ctx, repo, actor, isAdmin,
    need: () => {
      if (!actor || actor.id == null) throw fail(401, 'Cần đăng nhập bằng tài khoản thật để dùng chức năng này.');
      return actor;
    },
    adminOnly: () => {
      if (!isAdmin) throw fail(403, 'Chỉ quản trị viên được dùng chức năng này.');
      return actor;
    },
  };
  const handlers = [handleServer, handleExport, handleRunLog, handleAccount, handleStats, handleCampaigns, handleCampaignActions, handleUsers, handleWallet, handleNotifications, handleAudit];
  for (const h of handlers) if (await h(scope)) return true;
  return false;
}
