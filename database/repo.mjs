import { db } from './init.mjs';
import { txnCode } from '../wallet.mjs';

export function now() {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

export function today() {
  return now().slice(0, 10);
}

const USER_FIELDS = ['username', 'password_hash', 'pw_changed_at', 'role', 'display_name', 'status', 'daily_quota', 'last_login_at'];
const CAMPAIGN_FIELDS = ['name', 'keyword', 'target_url', 'type', 'count', 'unit', 'query_mode', 'max_threads', 'status', 'approval_status', 'reject_reason', 'approved_by', 'approved_at', 'priority', 'note', 'start_at', 'end_at', 'updated_at', 'updated_by'];

function updateRow(table, allowed, id, patch) {
  const data = {};
  for (const k of allowed) if (patch && patch[k] !== undefined) data[k] = patch[k];
  const keys = Object.keys(data);
  if (!keys.length) return 0;
  const sql = `UPDATE ${table} SET ${keys.map(k => `${k} = @${k}`).join(', ')} WHERE id = @id`;
  return db.prepare(sql).run({ ...data, id: Number(id) }).changes;
}

const like = q => (q ? `%${q}%` : null);

const bit = v => (v ? 1 : 0);

export const users = {
  byId: id => db.prepare('SELECT id, username, display_name, role, status, daily_quota, last_login_at, created_at FROM users WHERE id = ?').get(Number(id)) || null,
  authRow: username => db.prepare('SELECT id, username, password_hash, role, status, display_name FROM users WHERE username = ?').get(String(username)) || null,
  list: ({ role = null, status = null, q = null } = {}) => db.prepare(`
    SELECT id, username, display_name, role, status, daily_quota, last_login_at, created_at
    FROM users
    WHERE (@role IS NULL OR role = @role)
      AND (@status IS NULL OR status = @status)
      AND (@like IS NULL OR username LIKE @like OR display_name LIKE @like)
    ORDER BY (role = 'admin') DESC, username
  `).all({ role, status, like: like(q) }),
  create: ({ username, passwordHash, role = 'user', displayName = null, dailyQuota = 0 }) => db.prepare(
    'INSERT INTO users (username, password_hash, role, display_name, daily_quota) VALUES (?, ?, ?, ?, ?)'
  ).run(String(username), String(passwordHash), String(role), displayName || null, Math.max(0, Number(dailyQuota) || 0)),
  update: (id, patch) => updateRow('users', USER_FIELDS, id, patch),
  setPassword: (id, hash) => db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(String(hash), Number(id)).changes,
  touchLogin: id => db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').run(now(), Number(id)).changes,
  remove: id => db.prepare('DELETE FROM users WHERE id = ?').run(Number(id)).changes,
};

const CAMPAIGN_SELECT = `
  SELECT c.*, u.username AS owner, u.display_name AS owner_name, a.username AS approver, e.username AS editor,
         COALESCE(d.attempts, 0) AS today_attempts, COALESCE(d.ok, 0) AS today_ok,
         COALESCE(d.notfound, 0) AS today_notfound, COALESCE(d.captcha, 0) AS today_captcha,
         COALESCE(d.error, 0) AS today_error
  FROM campaigns c
  JOIN users u ON u.id = c.user_id
  LEFT JOIN users a ON a.id = c.approved_by
  LEFT JOIN users e ON e.id = c.updated_by
  LEFT JOIN campaign_stats_daily d ON d.campaign_id = c.id AND d.day = date('now', 'localtime')
`;

export const campaigns = {
  byId: id => db.prepare('SELECT * FROM campaigns WHERE id = ?').get(Number(id)) || null,
  detail: id => db.prepare(`${CAMPAIGN_SELECT} WHERE c.id = @id`).get({ id: Number(id) }) || null,
  list: ({ userId = null, approval = null, status = null, q = null, limit = 200 } = {}) => db.prepare(`
    ${CAMPAIGN_SELECT}
    WHERE (@userId IS NULL OR c.user_id = @userId)
      AND (@approval IS NULL OR c.approval_status = @approval)
      AND (@status IS NULL OR c.status = @status)
      AND (@like IS NULL OR c.keyword LIKE @like OR c.target_url LIKE @like OR c.name LIKE @like)
    ORDER BY (c.approval_status = 'pending') DESC, c.priority DESC, c.id DESC
    LIMIT @limit
  `).all({ userId, approval, status, like: like(q), limit: Math.min(Math.max(Number(limit) || 200, 1), 1000) }),
  runnable: () => db.prepare(`${CAMPAIGN_SELECT} WHERE c.approval_status = 'approved' AND c.status = 'running' AND c.hidden = 0 AND u.status = 'active' ORDER BY c.priority DESC, c.id`).all(),
  pendingCount: (userId = null) => db.prepare(`
    SELECT COUNT(*) AS n FROM campaigns
    WHERE approval_status = 'pending' AND hidden = 0 AND (@userId IS NULL OR user_id = @userId)
  `).get({ userId: userId == null ? null : Number(userId) }).n,
  countByUser: userId => db.prepare('SELECT COUNT(*) AS n FROM campaigns WHERE user_id = ? AND hidden = 0').get(Number(userId)).n,
  activeCount: userId => db.prepare("SELECT COUNT(*) AS n FROM campaigns WHERE user_id = ? AND status IN ('running', 'paused')").get(Number(userId)).n,
  create: row => db.prepare(`
    INSERT INTO campaigns (user_id, name, keyword, target_url, type, count, unit, priority, note, start_at, end_at,
                           status, approval_status, query_mode, max_threads, created_at, updated_at, updated_by)
    VALUES (@userId, @name, @keyword, @targetUrl, @type, @count, @unit, @priority, @note, @startAt, @endAt,
            'idle', 'pending', @queryMode, @maxThreads, @at, @at, @userId)
  `).run({
    userId: Number(row.userId), name: row.name || null, keyword: String(row.keyword), targetUrl: String(row.targetUrl),
    type: String(row.type || 'search_dwell'), count: Math.max(0, Number(row.count) || 0), unit: String(row.unit || 'day'),
    priority: Number(row.priority) || 0, note: row.note || null, startAt: row.startAt || null, endAt: row.endAt || null, at: now(),
    queryMode: row.queryMode === 'keyword_domain' ? 'keyword_domain' : 'keyword',
    maxThreads: Math.max(1, Number(row.maxThreads) || 1),
  }),
  update: (id, patch, actorId = null) => {
    const data = { ...patch, updated_at: now() };
    if (actorId != null) data.updated_by = Number(actorId);
    return updateRow('campaigns', CAMPAIGN_FIELDS, id, data);
  },
  setApproval: (id, { status, byId = null, reason = null }) => db.prepare(`
    UPDATE campaigns SET approval_status = @status, approved_by = @byId, approved_at = @at,
                         reject_reason = @reason, updated_at = @at, updated_by = @byId
    WHERE id = @id
  `).run({ id: Number(id), status: String(status), byId: byId == null ? null : Number(byId), reason: reason || null, at: now() }).changes,
  setStatus: (id, status, actorId = null) => db.prepare(
    'UPDATE campaigns SET status = @status, updated_at = @at, updated_by = @byId WHERE id = @id'
  ).run({ id: Number(id), status: String(status), at: now(), byId: actorId == null ? null : Number(actorId) }).changes,
  setHidden: (id, hidden, actorId = null) => db.prepare(`
    UPDATE campaigns SET hidden = @h, hidden_at = CASE WHEN @h = 1 THEN @at ELSE NULL END,
      status = CASE WHEN @h = 1 AND status IN ('running', 'paused', 'done') THEN 'stopped' ELSE status END,
      updated_at = @at, updated_by = @byId
    WHERE id = @id
  `).run({ id: Number(id), h: hidden ? 1 : 0, at: now(), byId: actorId == null ? null : Number(actorId) }).changes,
  setFooterCheck: (id, { status, note = null, at = null }) => db.prepare(`UPDATE campaigns SET footer_check = @status, footer_check_note = @note, footer_checked_at = @at WHERE id = @id`).run({ id: Number(id), status: status ? String(status) : null, note: note || null, at: at || (status ? now() : null) }).changes,
  remove: id => db.prepare('DELETE FROM campaigns WHERE id = ?').run(Number(id)).changes,
};

const num = v => (v === undefined || v === null || v === '' || Number.isNaN(Number(v)) ? null : Number(v));

const insertRun = db.prepare(`
  INSERT INTO runs (campaign_id, user_id, keyword, query, target_url, at, status, ip, seconds, position, on_site,
                    pages, attempts, captchas, proxy, ram_peak_mb, cpu_avg, error, impression, device_kind, device, user_agent)
  VALUES (@campaignId, @userId, @keyword, @query, @targetUrl, @at, @status, @ip, @seconds, @position, @onSite,
          @pages, @attempts, @captchas, @proxy, @ramPeakMb, @cpuAvg, @error, @impression, @deviceKind, @device, @userAgent)
`);
const bumpDaily = db.prepare(`
  INSERT INTO campaign_stats_daily (campaign_id, day, ok, notfound, captcha, error, attempts)
  VALUES (@campaignId, @day, @ok, @notfound, @captcha, @error, @attempts)
  ON CONFLICT(campaign_id, day) DO UPDATE SET
    ok = ok + @ok, notfound = notfound + @notfound, captcha = captcha + @captcha,
    error = error + @error, attempts = attempts + @attempts
`);
export const RANK_MIN_MINUTES = 15;
export const RANK_MAX_MINUTES = 45;
const pad2 = n => String(n).padStart(2, '0');
const fmtLocal = d => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
const parseLocal = s => {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(String(s || ''));
  return m ? new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) : new Date();
};
export function nextRankAt(fromAt, rand = Math.random) {
  const mins = RANK_MIN_MINUTES + rand() * (RANK_MAX_MINUTES - RANK_MIN_MINUTES);
  return fmtLocal(new Date(parseLocal(fromAt).getTime() + Math.round(mins * 60000)));
}
const getRankRow = db.prepare('SELECT next_at AS nextAt FROM campaign_ranks WHERE campaign_id = ? AND device_kind = ?');
const upsertRank = db.prepare(`
  INSERT INTO campaign_ranks (campaign_id, device_kind, position, at, next_at)
  VALUES (@campaignId, @deviceKind, @position, @at, @nextAt)
  ON CONFLICT(campaign_id, device_kind) DO UPDATE SET position = @position, at = @at, next_at = @nextAt
`);
function considerRank(row) {
  if (!row.campaignId || !row.deviceKind || !row.query || !['ok', 'notfound'].includes(row.status)) return;
  const cur = getRankRow.get(Number(row.campaignId), String(row.deviceKind));
  if (cur && String(row.at) < cur.nextAt) return;
  upsertRank.run({
    campaignId: Number(row.campaignId), deviceKind: String(row.deviceKind),
    position: row.status === 'ok' ? num(row.position) : null, at: row.at, nextAt: nextRankAt(row.at),
  });
}

const recordTx = db.transaction(row => {
  insertRun.run({
    campaignId: num(row.campaignId), userId: num(row.userId), keyword: row.keyword || null, targetUrl: row.targetUrl || null,
    query: row.query || null,
    at: row.at, status: row.status, ip: row.ip || null, seconds: num(row.seconds), position: num(row.position),
    onSite: row.onSite == null ? null : bit(row.onSite), pages: num(row.pages), attempts: num(row.attempts),
    captchas: num(row.captchas), proxy: row.proxy || null, ramPeakMb: num(row.ramPeakMb), cpuAvg: num(row.cpuAvg), error: row.error || null,
    impression: row.impression ? 1 : null,
    deviceKind: row.deviceKind || null,
    device: row.device || null,
    userAgent: row.userAgent ? String(row.userAgent).slice(0, 400) : null,
  });
  if (row.campaignId) {
    bumpDaily.run({
      campaignId: Number(row.campaignId), day: String(row.at).slice(0, 10),
      ok: bit(row.status === 'ok'), notfound: bit(row.status === 'notfound'), captcha: bit(row.status === 'captcha'),
      error: bit(row.status === 'error'), attempts: bit(row.counted),
    });
    considerRank(row);
  }
  return true;
});

export const ranks = {
  list: ({ userId = null, campaignId = null } = {}) => db.prepare(`
    SELECT k.campaign_id AS campaignId, k.device_kind AS deviceKind, k.position AS position, k.at AS at, k.next_at AS nextAt
    FROM campaign_ranks k
    JOIN campaigns c ON c.id = k.campaign_id
    WHERE (@userId IS NULL OR c.user_id = @userId) AND (@campaignId IS NULL OR k.campaign_id = @campaignId)
    ORDER BY k.campaign_id, k.device_kind
  `).all({ userId: num(userId), campaignId: num(campaignId) }),
};

export const runs = {
  record: row => {
    const at = row.at || now();
    const status = String(row.status || 'error');
    return recordTx({ ...row, at, status, counted: ['ok', 'notfound', 'captcha'].includes(status) ? 1 : 0 });
  },
  recent: ({ campaignId = null, userId = null, limit = 100 } = {}) => db.prepare(`
    SELECT r.*, c.keyword AS campaign_keyword, c.target_url AS campaign_url, u.username AS owner
    FROM runs r
    LEFT JOIN campaigns c ON c.id = r.campaign_id
    LEFT JOIN users u ON u.id = r.user_id
    WHERE (@campaignId IS NULL OR r.campaign_id = @campaignId)
      AND (@userId IS NULL OR r.user_id = @userId)
    ORDER BY r.at DESC, r.id DESC
    LIMIT @limit
  `).all({ campaignId, userId, limit: Math.min(Math.max(Number(limit) || 100, 1), 500) }),
  log: ({ campaignId, keyword = null, from = null, to = null, limit = 50, offset = 0 }) => {
    const p = { campaignId: Number(campaignId), keyword: keyword || null, from: from || null, to: to || null };
    const where = `r.campaign_id = @campaignId AND r.status = 'ok' AND COALESCE(r.impression, 0) = 0
      AND (@keyword IS NULL OR COALESCE(r.keyword, c.keyword) = @keyword)
      AND (@from IS NULL OR r.at >= @from) AND (@to IS NULL OR r.at <= @to)`;
    const total = db.prepare(`SELECT COUNT(*) AS n FROM runs r JOIN campaigns c ON c.id = r.campaign_id WHERE ${where}`).get(p).n;
    const rows = db.prepare(`
      SELECT r.id, COALESCE(r.keyword, c.keyword) AS keyword, r.ip, r.user_agent AS userAgent, r.at
      FROM runs r JOIN campaigns c ON c.id = r.campaign_id
      WHERE ${where}
      ORDER BY r.at DESC, r.id DESC
      LIMIT @limit OFFSET @offset
    `).all({ ...p, limit: Math.min(Math.max(Number(limit) || 50, 1), 100000), offset: Math.max(Number(offset) || 0, 0) });
    return { total, rows };
  },
  logKeywords: campaignId => db.prepare(`
    SELECT DISTINCT COALESCE(r.keyword, c.keyword) AS keyword
    FROM runs r JOIN campaigns c ON c.id = r.campaign_id
    WHERE r.campaign_id = ? AND r.status = 'ok' AND COALESCE(r.impression, 0) = 0
    ORDER BY keyword
  `).all(Number(campaignId)).map(r => r.keyword).filter(Boolean),
  todayCount: (campaignId, day = today()) => {
    const row = db.prepare('SELECT attempts FROM campaign_stats_daily WHERE campaign_id = ? AND day = ?').get(Number(campaignId), String(day));
    return row ? row.attempts : 0;
  },
  todayCountByUser: (userId, day = today()) => db.prepare(
    'SELECT COUNT(*) AS n FROM runs WHERE user_id = ? AND at >= ? AND at <= ?'
  ).get(Number(userId), `${day} 00:00:00`, `${day} 23:59:59`).n,

  rankByDevice: ({ userId = null, campaignId = null } = {}) => db.prepare(`
    SELECT r.campaign_id AS campaignId, r.device_kind AS deviceKind, r.position AS position,
           r.at AS at, COALESCE(r.keyword, c.keyword) AS keyword
    FROM runs r
    LEFT JOIN campaigns c ON c.id = r.campaign_id
    WHERE r.position IS NOT NULL AND r.device_kind IS NOT NULL
      AND (@userId IS NULL OR r.user_id = @userId)
      AND (@campaignId IS NULL OR r.campaign_id = @campaignId)
      AND r.id IN (
        SELECT MAX(id) FROM runs
        WHERE position IS NOT NULL AND device_kind IS NOT NULL
          AND (@userId IS NULL OR user_id = @userId)
          AND (@campaignId IS NULL OR campaign_id = @campaignId)
        GROUP BY campaign_id, device_kind
      )
    ORDER BY r.campaign_id, r.device_kind
  `).all({ userId: num(userId), campaignId: num(campaignId) }),
};

export const runExports = {
  add: ({ campaignId, userId = null, keyword = null, from = null, to = null, rows = 0 }) => db.prepare(`
    INSERT INTO run_exports (campaign_id, user_id, at, keyword, from_day, to_day, rows)
    VALUES (@campaignId, @userId, @at, @keyword, @from, @to, @rows)
  `).run({ campaignId: Number(campaignId), userId: num(userId), at: now(), keyword: keyword || null, from: from || null, to: to || null, rows: Number(rows) || 0 }).lastInsertRowid,
  list: (campaignId, limit = 50) => db.prepare(`
    SELECT e.id, e.at, e.keyword, e.from_day AS fromDay, e.to_day AS toDay, e.rows, u.username AS by
    FROM run_exports e LEFT JOIN users u ON u.id = e.user_id
    WHERE e.campaign_id = ? ORDER BY e.at DESC, e.id DESC LIMIT ?
  `).all(Number(campaignId), Math.min(Math.max(Number(limit) || 50, 1), 200)),
};

export const stats = {
  daily: ({ campaignId = null, userId = null, from = null, to = null, type = null } = {}) => {
    const rows = db.prepare(`
    SELECT s.day,
           SUM(s.attempts) AS attempts, SUM(s.ok) AS ok, SUM(s.notfound) AS notfound,
           SUM(s.captcha) AS captcha, SUM(s.error) AS error
    FROM campaign_stats_daily s
    JOIN campaigns c ON c.id = s.campaign_id
    WHERE (@campaignId IS NULL OR s.campaign_id = @campaignId)
      AND (@userId IS NULL OR c.user_id = @userId)
      AND (@type IS NULL OR c.type = @type)
      AND (@from IS NULL OR s.day >= @from)
      AND (@to IS NULL OR s.day <= @to)
    GROUP BY s.day
    ORDER BY s.day
  `).all({ campaignId, userId, type: type || null, from: from || null, to: to || null });
    const spent = new Map(db.prepare(`
      SELECT substr(t.at, 1, 10) AS day, COALESCE(SUM(-t.amount), 0) AS spent
      FROM wallet_txns t
      JOIN campaigns c ON c.id = t.campaign_id
      WHERE t.kind = 'spend' AND t.status = 'success'
        AND (@campaignId IS NULL OR t.campaign_id = @campaignId)
        AND (@userId IS NULL OR c.user_id = @userId)
        AND (@type IS NULL OR c.type = @type)
        AND (@from IS NULL OR substr(t.at, 1, 10) >= @from)
        AND (@to IS NULL OR substr(t.at, 1, 10) <= @to)
      GROUP BY substr(t.at, 1, 10)
    `).all({ campaignId, userId, type: type || null, from: from || null, to: to || null }).map(r => [r.day, r.spent]));
    const days = new Set(rows.map(r => r.day));
    for (const [d, v] of spent) if (!days.has(d)) rows.push({ day: d, attempts: 0, ok: 0, notfound: 0, captcha: 0, error: 0 });
    rows.forEach(r => { r.spent = spent.get(r.day) || 0; });
    return rows.sort((a, b) => (a.day < b.day ? -1 : 1));
  },
  byKeyword: ({ userId = null, campaignId = null, from = null, to = null, limit = 200 } = {}) => db.prepare(`
    SELECT COALESCE(r.keyword, c.keyword) AS keyword, c.target_url AS targetUrl,
           COUNT(*) AS attempts, SUM(r.status = 'ok') AS ok, SUM(r.status = 'notfound') AS notfound,
           SUM(r.status = 'captcha') AS captcha, SUM(r.status = 'error') AS error
    FROM runs r
    LEFT JOIN campaigns c ON c.id = r.campaign_id
    WHERE (@userId IS NULL OR r.user_id = @userId)
      AND (@campaignId IS NULL OR r.campaign_id = @campaignId)
      AND (@from IS NULL OR r.at >= @from)
      AND (@to IS NULL OR r.at <= @to)
    GROUP BY COALESCE(r.keyword, c.keyword), c.target_url
    ORDER BY attempts DESC
    LIMIT @limit
  `).all({
    userId, campaignId,
    from: from ? `${from} 00:00:00` : null, to: to ? `${to} 23:59:59` : null,
    limit: Math.min(Math.max(Number(limit) || 200, 1), 1000),
  }),
  revenue: () => {
    const day = today(), monthStart = day.slice(0, 8) + '01';
    const dayMinus = n => { const d = new Date(Date.now() - n * 86400000), p = x => String(x).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; };
    const pick = (kind, from) => { const r = db.prepare(`SELECT COALESCE(SUM(${kind === 'spend' ? '-amount' : 'amount'}), 0) AS v, COUNT(*) AS n FROM wallet_txns WHERE kind = @kind AND status = 'success' AND (@from IS NULL OR substr(at, 1, 10) >= @from)`).get({ kind, from }); return { amount: r.v, count: r.n }; };
    const byDay = db.prepare(`
      SELECT substr(at, 1, 10) AS day, COALESCE(SUM(-amount), 0) AS spent, COUNT(*) AS visits
      FROM wallet_txns WHERE kind = 'spend' AND status = 'success' AND substr(at, 1, 10) >= @from
      GROUP BY substr(at, 1, 10) ORDER BY day
    `).all({ from: dayMinus(29) });
    const top = db.prepare(`
      SELECT u.id AS userId, u.username AS username, COALESCE(SUM(-t.amount), 0) AS spent, COUNT(*) AS visits
      FROM wallet_txns t JOIN users u ON u.id = t.user_id
      WHERE t.kind = 'spend' AND t.status = 'success' AND substr(t.at, 1, 10) >= @from
      GROUP BY t.user_id ORDER BY spent DESC LIMIT 5
    `).all({ from: dayMinus(29) });
    return {
      spent: { today: pick('spend', day), last7: pick('spend', dayMinus(6)), month: pick('spend', monthStart), total: pick('spend', null) },
      topup: { today: pick('topup', day), last7: pick('topup', dayMinus(6)), month: pick('topup', monthStart), total: pick('topup', null) },
      byDay, top,
    };
  },
  dailyByCampaign: userId => {
    const rows = db.prepare(`
      SELECT s.campaign_id AS campaignId, s.day AS day, s.attempts AS attempts, s.ok AS ok, s.notfound AS notfound, s.captcha AS captcha, s.error AS error
      FROM campaign_stats_daily s JOIN campaigns c ON c.id = s.campaign_id
      WHERE c.user_id = ? ORDER BY s.day, s.campaign_id
    `).all(Number(userId)).map(r => ({ ...r, spent: 0 }));
    const idx = new Map(rows.map(r => [`${r.campaignId}|${r.day}`, r]));
    const spent = db.prepare(`
      SELECT t.campaign_id AS campaignId, substr(t.at, 1, 10) AS day, COALESCE(SUM(-t.amount), 0) AS spent
      FROM wallet_txns t JOIN campaigns c ON c.id = t.campaign_id
      WHERE c.user_id = ? AND t.kind = 'spend' AND t.status = 'success'
      GROUP BY t.campaign_id, substr(t.at, 1, 10)
    `).all(Number(userId));
    for (const sp of spent) {
      const k = `${sp.campaignId}|${sp.day}`;
      if (idx.has(k)) idx.get(k).spent = sp.spent;
      else { const r = { campaignId: sp.campaignId, day: sp.day, attempts: 0, ok: 0, notfound: 0, captcha: 0, error: 0, spent: sp.spent }; rows.push(r); idx.set(k, r); }
    }
    return rows.sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : a.campaignId - b.campaignId));
  },
  progressByUser: userId => db.prepare(`
    SELECT c.id AS campaignId,
      COALESCE((SELECT SUM(s.attempts) FROM campaign_stats_daily s WHERE s.campaign_id = c.id), 0) AS totalAttempts,
      COALESCE((SELECT SUM(s.ok) FROM campaign_stats_daily s WHERE s.campaign_id = c.id), 0) AS totalOk,
      COALESCE((SELECT SUM(-t.amount) FROM wallet_txns t WHERE t.campaign_id = c.id AND t.kind = 'spend' AND t.status = 'success'), 0) AS spent,
      (SELECT MIN(r.at) FROM runs r WHERE r.campaign_id = c.id) AS firstRunAt,
      (SELECT MAX(r.at) FROM runs r WHERE r.campaign_id = c.id) AS lastRunAt
    FROM campaigns c
    WHERE c.user_id = ?
    ORDER BY c.id DESC
  `).all(Number(userId)),
  summary: ({ userId = null } = {}) => {
    const day = today();
    const row = db.prepare(`
      SELECT COUNT(*) AS total,
             SUM(r.status = 'ok') AS total_ok,
             SUM(r.at >= @start AND r.at <= @end) AS today_attempts,
             SUM(r.status = 'ok' AND r.at >= @start AND r.at <= @end) AS today_ok,
             SUM(r.status = 'captcha') AS captcha,
             SUM(r.status = 'error') AS error
      FROM runs r
      WHERE (@userId IS NULL OR r.user_id = @userId)
    `).get({ userId, start: `${day} 00:00:00`, end: `${day} 23:59:59` });
    return {
      total: row.total || 0,
      totalOk: row.total_ok || 0,
      todayAttempts: row.today_attempts || 0,
      todayOk: row.today_ok || 0,
      captcha: row.captcha || 0,
      error: row.error || 0,
    };
  },
};

export const audit = {
  add: ({ actorId = null, actorRole = null, action, entity, entityId = null, before = null, after = null, note = null }) =>
    db.prepare(`
      INSERT INTO audit_logs (actor_id, actor_role, action, entity, entity_id, before_json, after_json, note, at)
      VALUES (@actorId, @actorRole, @action, @entity, @entityId, @before, @after, @note, @at)
    `).run({
      actorId: num(actorId), actorRole: actorRole || null, action: String(action), entity: String(entity),
      entityId: num(entityId), before: before == null ? null : JSON.stringify(before),
      after: after == null ? null : JSON.stringify(after), note: note || null, at: now(),
    }),
  list: ({ entity = null, entityId = null, limit = 100 } = {}) => db.prepare(`
    SELECT l.*, u.username AS actor
    FROM audit_logs l
    LEFT JOIN users u ON u.id = l.actor_id
    WHERE (@entity IS NULL OR l.entity = @entity)
      AND (@entityId IS NULL OR l.entity_id = @entityId)
    ORDER BY l.at DESC, l.id DESC
    LIMIT @limit
  `).all({ entity, entityId, limit: Math.min(Math.max(Number(limit) || 100, 1), 500) }),
};

export const notifications = {
  add: ({ userId = null, forRole = null, campaignId = null, title, body = null }) => db.prepare(
    'INSERT INTO notifications (user_id, for_role, campaign_id, title, body, at) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(num(userId), forRole || null, num(campaignId), String(title), body || null, now()),
  list: ({ userId = null, role = null, unreadOnly = false, limit = 50 } = {}) => db.prepare(`
    SELECT * FROM notifications
    WHERE (@userId IS NULL OR user_id = @userId)
      AND (@role IS NULL OR for_role = @role)
      AND (@unreadOnly = 0 OR read_at IS NULL)
    ORDER BY at DESC, id DESC
    LIMIT @limit
  `).all({ userId: num(userId), role: role || null, unreadOnly: bit(unreadOnly), limit: Math.min(Math.max(Number(limit) || 50, 1), 200) }),
  unreadCount: ({ userId = null, role = null } = {}) => db.prepare(`
    SELECT COUNT(*) AS n FROM notifications
    WHERE read_at IS NULL
      AND (@userId IS NULL OR user_id = @userId)
      AND (@role IS NULL OR for_role = @role)
  `).get({ userId: num(userId), role: role || null }).n,
  markRead: id => db.prepare('UPDATE notifications SET read_at = ? WHERE id = ?').run(now(), Number(id)).changes,
  markAllRead: ({ userId = null, role = null } = {}) => db.prepare(`
    UPDATE notifications SET read_at = @at
    WHERE read_at IS NULL
      AND (@userId IS NULL OR user_id = @userId)
      AND (@role IS NULL OR for_role = @role)
  `).run({ userId: num(userId), role: role || null, at: now() }).changes,
};

const MAX_TXN_VND = 100000000000;

const ensureWallet = db.prepare(`
  INSERT INTO wallets (user_id, balance, updated_at) VALUES (@userId, 0, @at)
  ON CONFLICT(user_id) DO NOTHING
`);
const readBalanceRow = db.prepare('SELECT balance FROM wallets WHERE user_id = ?');
const writeBalance = db.prepare('UPDATE wallets SET balance = @balance, updated_at = @at WHERE user_id = @userId');
const insertTxn = db.prepare(`
  INSERT INTO wallet_txns (user_id, kind, amount, usdt, rate, method, status, campaign_id, balance_after, note, actor_id, at)
  VALUES (@userId, @kind, @amount, @usdt, @rate, @method, @status, @campaignId, @balanceAfter, @note, @actorId, @at)
`);
const setTxnCode = db.prepare('UPDATE wallet_txns SET code = ? WHERE id = ?');

const addTxnTx = db.transaction(entry => {
  const userId = Number(entry.userId);
  const at = entry.at || now();
  const amount = Math.round(Number(entry.amount) || 0);
  ensureWallet.run({ userId, at });
  const current = readBalanceRow.get(userId).balance;
  const balanceAfter = current + amount;
  if (balanceAfter < 0) return null;
  writeBalance.run({ userId, balance: balanceAfter, at });
  const info = insertTxn.run({
    userId, kind: String(entry.kind || 'adjust'), amount,
    usdt: entry.usdt == null ? null : Number(entry.usdt), rate: num(entry.rate),
    method: entry.method || null, status: String(entry.status || 'success'),
    campaignId: num(entry.campaignId), balanceAfter,
    note: entry.note || null, actorId: num(entry.actorId), at,
  });
  const code = txnCode(info.lastInsertRowid);
  setTxnCode.run(code, info.lastInsertRowid);
  return {
    id: Number(info.lastInsertRowid), code, userId, kind: String(entry.kind || 'adjust'), amount,
    usdt: entry.usdt == null ? null : Number(entry.usdt), rate: num(entry.rate),
    method: entry.method || null, status: String(entry.status || 'success'),
    campaignId: num(entry.campaignId), balanceAfter, note: entry.note || null, at,
  };
});

export function walletBalance(userId) {
  const row = readBalanceRow.get(Number(userId));
  return row ? row.balance : 0;
}

export const wallet = {
  balanceOf: walletBalance,

  summary: userId => {
    const id = Number(userId);
    const row = db.prepare(`
      SELECT COALESCE(SUM(CASE WHEN kind = 'topup' AND amount > 0 THEN amount END), 0) AS topped_up,
             COALESCE(SUM(CASE WHEN kind = 'bonus' AND amount > 0 THEN amount END), 0) AS bonus,
             COALESCE(SUM(CASE WHEN kind = 'spend' THEN -amount END), 0) AS spent
      FROM wallet_txns
      WHERE user_id = ? AND status = 'success'
    `).get(id);
    return {
      balance: walletBalance(id),
      toppedUp: row.topped_up || 0,
      bonus: row.bonus || 0,
      spent: row.spent || 0,
      total: (row.topped_up || 0) + (row.bonus || 0),
    };
  },

  spentByUser: userId => db.prepare(
    "SELECT COALESCE(SUM(-amount), 0) AS spent FROM wallet_txns WHERE user_id = ? AND kind = 'spend' AND status = 'success'"
  ).get(Number(userId)).spent || 0,

  spentByCampaign: userId => db.prepare(`
    SELECT t.campaign_id AS id, c.keyword AS keyword, COALESCE(SUM(-t.amount), 0) AS spent
    FROM wallet_txns t
    LEFT JOIN campaigns c ON c.id = t.campaign_id
    WHERE t.user_id = @userId AND t.campaign_id IS NOT NULL AND t.kind = 'spend' AND t.status = 'success'
    GROUP BY t.campaign_id
    ORDER BY spent DESC
  `).all({ userId: Number(userId) }),

  txns: ({ userId = null, campaignId = null, kind = null, limit = 100 } = {}) => db.prepare(`
    SELECT t.*, u.username AS owner, c.keyword AS campaign_keyword
    FROM wallet_txns t
    LEFT JOIN users u ON u.id = t.user_id
    LEFT JOIN campaigns c ON c.id = t.campaign_id
    WHERE (@userId IS NULL OR t.user_id = @userId)
      AND (@campaignId IS NULL OR t.campaign_id = @campaignId)
      AND (@kind IS NULL OR t.kind = @kind)
    ORDER BY t.at DESC, t.id DESC
    LIMIT @limit
  `).all({
    userId: num(userId), campaignId: num(campaignId), kind: kind || null,
    limit: Math.min(Math.max(Number(limit) || 100, 1), 500),
  }),

  credit: ({ userId, amountVnd, usdt = null, rate = null, method = null, kind = 'topup', status = 'success', campaignId = null, note = null, actorId = null, at = null }) => {
    const amount = Math.round(Number(amountVnd) || 0);
    if (!(amount > 0)) throw new Error('Số tiền nạp phải lớn hơn 0.');
    if (amount > MAX_TXN_VND) throw new Error('Số tiền một giao dịch quá lớn.');
    return addTxnTx({ userId, kind, amount, usdt, rate, method, status, campaignId, note, actorId, at });
  },

  spend: ({ userId, amountVnd, kind = 'spend', campaignId = null, note = null, actorId = null, at = null }) => {
    const amount = Math.round(Number(amountVnd) || 0);
    if (!(amount > 0)) return null;
    return addTxnTx({ userId, kind, amount: -amount, method: 'manual', campaignId, note, actorId, at });
  },

  adjust: ({ userId, amountVnd, note = null, actorId = null, at = null }) => {
    const amount = Math.round(Number(amountVnd) || 0);
    if (!amount) throw new Error('Số tiền điều chỉnh phải khác 0.');
    if (Math.abs(amount) > MAX_TXN_VND) throw new Error('Số tiền một giao dịch quá lớn.');
    return addTxnTx({ userId, kind: 'adjust', amount, method: 'manual', note, actorId, at });
  },
};

export const settings = {
  all: () => Object.fromEntries(db.prepare('SELECT key, value FROM settings').all().map(r => [r.key, r.value])),
  get: key => {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(String(key));
    return row ? row.value : null;
  },
  set: (key, value, byId = null) => db.prepare(`
    INSERT INTO settings (key, value, updated_at, updated_by) VALUES (@key, @value, @at, @byId)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by
  `).run({ key: String(key), value: value == null ? null : String(value), at: now(), byId: num(byId) }).changes,
};
