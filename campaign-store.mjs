import { visitPrice } from './pricing.mjs';

let repo = null;
let loadError = null;
let lastError = null;

function inWindow(row, at = null) {
  const t = at || nowStamp();
  if (row.start_at && String(row.start_at) > t) return false;
  if (row.end_at && String(row.end_at) < t) return false;
  return true;
}

function nowStamp() {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function guard(fn, fallback) {
  try {
    return fn();
  } catch (e) {
    lastError = e.message;
    if (!guard.warned) {
      guard.warned = true;
      console.error(`[store] Lỗi CSDL: ${e.message}`);
    }
    return fallback;
  }
}

function walletAfford(userId, amount) {
  const price = Number(amount) || 0;
  if (price <= 0) return true;
  try {
    return repo.wallet.balanceOf(userId) >= price;
  } catch {
    return true;
  }
}

export const store = {
  async init() {
    if (repo || loadError) return !!repo;
    try {
      repo = await import('./database/repo.mjs');
    } catch (e) {
      loadError = e;
    }
    return !!repo;
  },

  available: () => !!repo,

  error: () => (loadError ? loadError.message : ''),

  lastError: () => lastError || '',

  runnable: () => (repo
    ? guard(() => repo.campaigns.runnable()
      .filter(r => inWindow(r))
      .filter(r => walletAfford(r.user_id, visitPrice(r.type))), [])
    : []),

  byStatus: (status, limit = 500) => (repo ? guard(() => repo.campaigns.list({ status, limit }).filter(r => inWindow(r)), []) : []),

  byId: id => (repo ? guard(() => repo.campaigns.detail(id), null) : null),

  todayCount: (campaignId, day = null) => (repo ? guard(() => (day ? repo.runs.todayCount(campaignId, day) : repo.runs.todayCount(campaignId)), 0) : 0),

  record: row => (repo ? guard(() => repo.runs.record(row), false) : false),

  setStatus: (id, status, actorId = null) => (repo ? guard(() => repo.campaigns.setStatus(id, status, actorId), 0) : 0),

  notify: ({ userId = null, forRole = null, campaignId = null, title, body = null }) =>
    (repo ? guard(() => repo.notifications.add({ userId, forRole, campaignId, title, body }), false) : false),

  wallet: userId => (repo ? guard(() => repo.wallet.summary(userId), null) : null),

  walletSpend: input => (repo ? guard(() => repo.wallet.spend(input) !== null, true) : true),

  balanceOf: userId => (repo ? guard(() => repo.wallet.balanceOf(userId), null) : null),

  audit: entry => (repo ? guard(() => repo.audit.add(entry), false) : false),
};
