import { engineParams } from './campaign-types.mjs';

export const SESSION_OVERHEAD_SEC = 30;

export const MAX_DWELL_SEC = 3600;
export const MAX_SUBPAGES = 4;

export const MAX_THREADS = 30;

export function sessionParams(type, settings = {}) {
  if (!type) return {};
  const p = engineParams(type);
  return {
    skipSearch: !!p.skipSearch,
    skipVisit: !!p.skipVisit,
    maxPages: p.maxPages || settings.maxPages,
    dwellMin: p.dwellMin,
    dwellMax: p.dwellMax,
    subpages: p.subpages,
    subDwellMin: p.subDwellMin,
    subDwellMax: p.subDwellMax,
  };
}

function num(v, def = 0) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : def;
}

export function sessionSeconds(type, settings = {}) {
  const p = sessionParams(type, settings);
  if (p.skipVisit) return SESSION_OVERHEAD_SEC;
  const dwell = num(p.dwellMax, num(settings.dwellMax, 0));
  const subpages = p.subpages === undefined ? num(settings.subpages, 0) : Math.max(0, Math.round(Number(p.subpages) || 0));
  const subMax = num(p.subDwellMax, num(settings.subDwellMax, 0));
  return Math.round(dwell + subpages * subMax + SESSION_OVERHEAD_SEC);
}

export function paceInfo(task, type, settings = {}) {
  const count = Math.max(0, Math.round(Number(task?.count) || 0));
  const unit = task?.unit === 'hour' ? 'hour' : 'day';
  const from = Math.min(23, Math.max(0, Math.round(Number(settings.activeFrom) || 0)));
  const rawTo = Math.round(Number(settings.activeTo));
  const to = Number.isFinite(rawTo) && rawTo > 0 ? Math.min(24, rawTo) : 24;
  const unitSec = unit === 'hour' ? 3600 : (from < to ? to - from : 24) * 3600;
  const intervalSec = count > 0 ? unitSec / count : null;
  const sessionSec = sessionSeconds(type, settings);
  const globalThreads = Math.max(1, Math.min(Math.round(Number(settings.threads) || 1), MAX_THREADS));
  const maxThreads = Math.max(1, Math.min(Math.round(Number(task?.maxThreads) || globalThreads), MAX_THREADS));
  const threads = Math.min(globalThreads, maxThreads);
  const needThreads = intervalSec ? Math.max(1, Math.ceil(sessionSec / intervalSec)) : 0;
  return {
    unit, count, unitSec, intervalSec, sessionSec, threads, needThreads,
    globalThreads,
    maxThreads,
    sessionMin: Math.round(sessionSec / 60 * 10) / 10,
    intervalMin: intervalSec ? Math.round(intervalSec / 60 * 10) / 10 : null,
    overloaded: !!intervalSec && needThreads > threads,
    capBlocked: !!intervalSec && needThreads > threads && globalThreads > threads,
  };
}

