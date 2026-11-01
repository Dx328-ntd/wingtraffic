import os from 'node:os';
import { Session } from '@omnilogin/sdk';
import { googleSearch, CaptchaError, NotFoundError, VerifyError } from './google-search.mjs';
import { browseSite } from './dwell.mjs';
import { sleep, markTouch } from './human.mjs';

export const WORKER_PREFIX = 'omni-w-';
export const POOL_PREFIX = 'omni-pool-';

const SCREENS = ['1366x768', '1536x864', '1920x1080', '1440x900', '1600x900', '1280x720'];
const pickScreen = () => SCREENS[Math.floor(Math.random() * SCREENS.length)];

const MOBILE_SCREENS = {
  android: ['360x800', '393x852', '412x915', '385x812', '384x854'],
  iphone: ['375x812', '390x844', '414x896', '428x926'],
};
const pickFrom = list => list[Math.floor(Math.random() * list.length)];

export const MOBILE_SHARE = 30;

export function mobilePct(settings = {}) {
  return Number.isFinite(Number(settings.mobilePercent))
    ? Math.min(100, Math.max(0, Number(settings.mobilePercent)))
    : MOBILE_SHARE;
}

export const IMPRESSION_EVERY = 20;

export function impressionAt(index, every = IMPRESSION_EVERY) {
  const n = Math.max(1, Math.floor(Number(index) || 1));
  const e = Math.max(0, Math.floor(Number(every) || 0));
  if (!e) return false;
  return Math.floor(n / e) > Math.floor((n - 1) / e);
}

export function deviceKindAt(index, pct = MOBILE_SHARE) {
  const n = Math.max(1, Math.floor(Number(index) || 1));
  const p = Math.min(100, Math.max(0, Number(pct) || 0));
  return Math.floor(n * p / 100) > Math.floor((n - 1) * p / 100) ? 'mobile' : 'desktop';
}

export function pickDevice(settings = {}, kind = '') {
  const mode = settings.device === 'mobile' || settings.device === 'mixed' ? settings.device : 'desktop';
  const pct = mobilePct(settings);
  const mobile = kind === 'mobile' ? true
    : kind === 'desktop' ? false
    : mode === 'mobile' || (mode === 'mixed' && Math.random() * 100 < pct);
  if (!mobile) return { kind: 'desktop', os: 'window', screen: pickScreen(), slug: '', label: 'máy tính' };
  const ios = Math.random() < 0.25;
  const osName = ios ? 'iphone' : 'android';
  const screen = pickFrom(MOBILE_SCREENS[osName]);
  return { kind: 'mobile', os: osName, screen, slug: ios ? 'i' : 'a', label: `${ios ? 'iPhone' : 'Android'} ${screen}` };
}

const pickScreenFor = device => (device.kind === 'mobile' ? pickFrom(MOBILE_SCREENS[device.os]) : pickScreen());

function buildProxy(proxy) {
  const session = Math.floor(Math.random() * 9e6) + 1e6;
  const parts = [proxy.userBase, proxy.country, session].filter(Boolean);
  return {
    session,
    input: {
      name: `ws-${proxy.country || 'any'}-${session}`,
      proxy_type: proxy.type || 'HTTP',
      host: proxy.host,
      port: Number(proxy.port),
      user_name: parts.join('-'),
      password: proxy.password,
    },
  };
}

async function readIp(page) {
  try {
    await page.goto('https://api.ipify.org/?format=json', { waitUntil: 'load', timeout: 20000 });
    const text = String(await page.evaluate(() => document.body.innerText));
    return JSON.parse(text).ip || '';
  } catch {
    return '';
  }
}

async function readUserAgent(page) {
  try {
    return String((await page.evaluate('navigator.userAgent')) ?? '');
  } catch {
    return '';
  }
}

async function directVisit(page, { targetUrl, log }) {
  const url = String(targetUrl || '').trim();
  if (!/^https?:\/\//i.test(url)) throw new Error('URL đích không hợp lệ.');
  log(`Bước: Mở trực tiếp ${url}`);
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  return { landed: true, matched: null, direct: true, url: await page.url().catch(() => url) };
}

export class ProfileLimitError extends Error {}
export class ProfileQuotaError extends Error {}

async function createProfile(omni, name, proxyInput, device) {
  const base = {
    operating_system: device.os,
    browser_type: 'chrome',
    lang: 'vi-VN',
    timezone: true,
    web_rtc: 'automatic',
  };
  const make = fingerprints => omni.profiles.create({ name, fingerprints, embedded_proxy: proxyInput });
  const mapErr = e => {
    if (/giới hạn số profile/i.test(e.message)) throw new ProfileLimitError('Gói OmniLogin đã đạt số profile tối đa.');
    if (/Code 429|quá nhiều lần/i.test(e.message)) throw new ProfileQuotaError(e.message);
    throw e;
  };
  try {
    return await make({ ...base, screen_resolution: device.screen });
  } catch (e) {
    if (!/resolution|screen|phân giải/i.test(e.message)) mapErr(e);
    try {
      return await make(base);
    } catch (e2) {
      return mapErr(e2);
    }
  }
}

async function stopIfActive(omni, id) {
  try {
    if (await omni.rest.browser.isActive(id)) {
      await omni.rest.browser.stop(id);
      await sleep(1500);
    }
  } catch {}
}

async function connectBridge(url) {
  const session = new Session(url);
  await session.connect();
  return session;
}

const OPEN_ATTEMPTS = 2;
const OPEN_RETRY_WAIT_MS = 5000;

export async function openProfile(omni, lease, { headless = false, log = () => {}, retryWaitMs = OPEN_RETRY_WAIT_MS } = {}, connect = connectBridge) {
  let lastErr = null;
  for (let attempt = 1; attempt <= OPEN_ATTEMPTS; attempt++) {
    const t0 = Date.now();
    try {
      const raw = await omni.rest.browser.open(lease.id, { launchBridge: true, headless: !!headless });
      if (!raw?.status) throw new Error(raw?.message || raw?.bridge_error || `OmniLogin không mở được profile #${lease.id}.`);
      if (!raw.bridge_url) {
        throw new Error(raw.bridge_error
          ? `OmniLogin không cấp được bridge: ${raw.bridge_error}`
          : 'OmniLogin không cấp được bridge (process omniBridge chưa sẵn sàng).');
      }
      const session = await connect(raw.bridge_url);
      log(`Đã mở trình duyệt (${Math.round((Date.now() - t0) / 1000)}s, bridge sẵn sàng).`);
      return session;
    } catch (e) {
      lastErr = e;
      log(`✖ Không mở được trình duyệt: ${e.message}`);
      if (/Code 404|không tìm thấy profile/i.test(e.message) || isChangeIpError(e.message) || attempt >= OPEN_ATTEMPTS) break;
      await stopIfActive(omni, lease.id);
      log(`↻ Đóng profile lỗi, chờ ${Math.round(retryWaitMs / 1000)}s cho OmniLogin ổn định rồi mở lại...`);
      await sleep(retryWaitMs);
    }
  }
  throw lastErr;
}

async function leaseFresh(omni, px, log, device) {
  const p = await createProfile(omni, `${WORKER_PREFIX}${Date.now()}-${px.session}`, px.input, device);
  log(`Tạo profile tạm #${p.id} — proxy ${px.label}${px.label.includes('(xoay') ? `, session ${px.session}` : ''}.`);
  return { id: p.id, name: p.name, pooled: false, release: () => destroyProfile(omni, p.id, log) };
}

const mobileTwins = new Map();

async function mobileTwinOf(omni, found, device, log) {
  const name = `${found.name}-${device.os}`;
  let id = mobileTwins.get(name);
  if (!id) {
    const twin = (await omni.profiles.list({ q: name, pageSize: 20 })).docs.find(d => d.name === name);
    if (twin) id = twin.id;
  }
  if (!id) {
    const made = await omni.profiles.clone(found.id, { name });
    id = made.id;
    log(`Tạo bản di động ${name} (#${id}) từ profile "${found.name}" — giữ nguyên proxy.`);
  }
  await stopIfActive(omni, id);
  await omni.profiles.update(id, { fingerprint: { operating_system: device.os, screen_resolution: device.screen } });
  mobileTwins.set(name, id);
  return { id, name };
}

async function leaseOmniProfile(omni, px, log, device) {
  const found = (await omni.profiles.list({ q: px.profileName, pageSize: 20 })).docs.find(d => d.name === px.profileName);
  if (!found) throw new Error(`Không tìm thấy profile OmniLogin "${px.profileName}" — kiểm tra tên profile trong app OmniLogin.`);
  let target = { id: found.id, name: px.profileName };
  if (device?.kind === 'mobile') {
    try {
      target = await mobileTwinOf(omni, found, device, log);
    } catch (e) {
      log(`⚠ Không tạo được bản di động của "${px.profileName}" (${e.message}) — lượt này dùng profile máy tính.`);
    }
  }
  await stopIfActive(omni, target.id);
  log(`Dùng profile OmniLogin "${target.name}" (#${target.id}) — IP xoay do app quản lý.`);
  return {
    id: target.id, name: target.name, pooled: true,
    release: async () => { await stopIfActive(omni, target.id); },
  };
}

const poolState = new Map();

async function leasePool(omni, slot, px, settings, log, device) {
  const name = `${POOL_PREFIX}${device.slug}${slot}`;
  let st = poolState.get(name);
  if (!st) {
    const found = (await omni.profiles.list({ q: name, pageSize: 20 })).docs.find(d => d.name === name);
    if (found) st = { id: found.id, name, runs: 0 };
  }
  if (st && settings.recycleAfter > 0 && st.runs >= settings.recycleAfter) {
    log(`Profile ${name} đã dùng ${st.runs} lượt — tạo lại để có dấu vân tay mới.`);
    await destroyProfile(omni, st.id, log);
    st = null;
  }
  if (!st) {
    const p = await createProfile(omni, name, px.input, device);
    st = { id: p.id, name, runs: 0 };
    log(`Tạo profile cố định ${name} (#${p.id}).`);
  } else {
    await stopIfActive(omni, st.id);
    await omni.profiles.setEmbeddedProxy([st.id], px.input);
    await omni.profiles.update(st.id, { fingerprint: { screen_resolution: pickScreenFor(device) } }).catch(() => {});
    log(`Dùng lại ${name} (#${st.id}, lượt thứ ${st.runs + 1}) — proxy ${px.label}${px.label.includes('(xoay') ? `, session ${px.session}` : ''}.`);
  }
  poolState.set(slot, st);
  st.runs++;
  return {
    id: st.id, name, pooled: true,
    release: async () => {
      await stopIfActive(omni, st.id);
    },
  };
}

function originOf(u) {
  try { const x = new URL(u); return /^https?:$/.test(x.protocol) ? x.origin : ''; } catch { return ''; }
}

export const isGoogleHost = v => {
  const h = String(v || '').replace(/^https?:\/\//i, '').replace(/[/:].*$/, '').replace(/^\./, '');
  return /^([a-z0-9-]+\.)*google\.(com(\.[a-z]{2})?|[a-z]{2})$/i.test(h);
};
const GOOGLE_KEEP_STORAGE_TYPES = 'indexeddb,cache_storage,service_workers,websql,file_systems';

const GOOGLE_ORIGINS = ['https://www.google.com', 'https://google.com', 'https://www.google.com.vn', 'https://google.com.vn', 'https://consent.google.com', 'https://accounts.google.com'];

export async function wipeBrowserData(session, log, { targetUrl = '' } = {}) {
  const rpc = session?.page?.rpc;
  if (!rpc || typeof rpc.call !== 'function') return;
  const send = async params => { try { await rpc.call('cdp.send', params); return true; } catch { return false; } };
  try {
    const state = await session.cookies.getStorageState().catch(() => ({ origins: [] }));
    const origins = new Set(GOOGLE_ORIGINS);
    for (const o of state.origins || []) if (o?.origin) origins.add(o.origin);
    for (const u of [targetUrl, await session.page.url().catch(() => '')]) { const o = originOf(u); if (o) origins.add(o); }
    const cacheOk = await send({ method: 'Network.clearBrowserCache' });
    let cleared = 0;
    for (const origin of origins) {
      const types = isGoogleHost(origin) ? GOOGLE_KEEP_STORAGE_TYPES : 'all';
      if (await send({ method: 'Storage.clearDataForOrigin', origin, storageTypes: types })) cleared++;
    }
    if (!cacheOk && !cleared) log('Cảnh báo: bridge không hỗ trợ lệnh xóa cache/IndexedDB — bỏ qua bước này.');
    else log(`Đã xóa ${cacheOk ? 'cache trình duyệt' : 'KHÔNG xóa được cache trình duyệt'}, IndexedDB/cache storage của ${cleared}/${origins.size} origin.`);
  } catch (e) {
    log(`Cảnh báo: không xóa hết cache/IndexedDB (${e.message}).`);
  }
}

export async function wipeSession(session, log) {
  try {
    await sleep(800);
    const state = await session.cookies.getStorageState().catch(() => ({ cookies: [], origins: [] }));
    const listed = await session.cookies.list().catch(() => []);
    const before = Math.max(state.cookies?.length || 0, listed.length);
    const keep = (listed.length ? listed : state.cookies || []).filter(c => isGoogleHost(c.domain));
    await session.cookies.clear();
    if (keep.length) await session.cookies.add(keep).catch(e => log(`Cảnh báo: không đặt lại được cookie Google (${e.message}).`));
    const origins = (state.origins || []).filter(o => !isGoogleHost(o.origin)).map(o => ({ origin: o.origin, localStorage: [] }));
    if (origins.length) await session.cookies.setStorageState({ cookies: [], origins });
    let left = (await session.cookies.list().catch(() => [])).filter(c => !isGoogleHost(c.domain)).length;
    if (left) {
      const kept2 = (await session.cookies.list().catch(() => [])).filter(c => isGoogleHost(c.domain));
      await session.cookies.clear();
      if (kept2.length) await session.cookies.add(kept2).catch(() => {});
      left = (await session.cookies.list().catch(() => [])).filter(c => !isGoogleHost(c.domain)).length;
    }
    log(`Đã xóa ${before - keep.length} cookie (giữ ${keep.length} cookie Google), storage của ${origins.length} site${left ? ` — còn sót ${left} cookie` : ''}.`);
  } catch (e) {
    log(`Cảnh báo: không xóa hết dữ liệu phiên cũ (${e.message}).`);
  }
}

async function diagnoseLost(omni, session, profileId) {
  if (!session) return null;
  const ok = await Promise.race([
    session.page.url().then(u => typeof u === 'string' && u !== '', () => false),
    sleep(8000).then(() => false),
  ]);
  if (ok) return null;
  const up = await omni.rest.browser.isActive(profileId).catch(() => false);
  const freeMB = Math.round(os.freemem() / 1048576);
  return up
    ? `Mất kết nối tới tab trình duyệt (tab bị đóng/treo; RAM trống ${freeMB} MB)`
    : `Trình duyệt profile đã tắt giữa chừng (có thể crash do thiếu RAM — trống ${freeMB} MB, hoặc bị đóng tay)`;
}

const CAPTCHA_RETRIES = 2;

const fmtDur = ms => (ms < 60000 ? `${Math.max(1, Math.round(ms / 1000))} giây` : `${Math.round(ms / 60000)} phút`);

export const ATTEMPT_MIN_MS = 10 * 60000;
export const ATTEMPT_MAX_MS = 90 * 60000;

export function attemptTimeoutMs(settings = {}) {
  const dwell = Math.max(0, settings.dwellMax || 0) + Math.max(0, settings.subpages || 0) * Math.max(0, settings.subDwellMax || 0);
  const captcha = settings.captchaMode === 'manual' && !settings.headless ? Math.max(0, settings.captchaWaitMin || 0) * 60 : 120;
  return Math.min(ATTEMPT_MAX_MS, Math.max(ATTEMPT_MIN_MS, (dwell + captcha + 300) * 1000));
}

async function withTimeout(promise, ms, onTimeout) {
  let timer;
  const guard = new Promise((_, reject) => {
    timer = setTimeout(() => {
      try { onTimeout?.(); } catch {}
      const err = new Error(`Lượt chạy vượt ${fmtDur(ms)} không có phản hồi từ trình duyệt — đóng profile và thử lại.`);
      err.timedOut = true;
      reject(err);
    }, ms);
  });
  try { return await Promise.race([promise, guard]); }
  finally { clearTimeout(timer); }
}

export function isChangeIpError(msg = '') {
  return /change\s*IP\s*URL/i.test(String(msg));
}
export const CHANGE_IP_WAIT_MS = 60000;
const CHANGE_IP_HINT = ' — profile đang bật "Đổi IP khi mở" (Change IP) trong OmniLogin; tắt tuỳ chọn này cho profile (engine đã tự chờ IP xoay giữa 2 lượt).';

export function isTargetNetworkError(msg = '') {
  return /ERR_CONNECTION_(CLOSED|RESET|REFUSED|ABORTED)|ERR_TUNNEL_CONNECTION_FAILED|ERR_PROXY_CONNECTION_FAILED|ERR_EMPTY_RESPONSE|ERR_SSL_PROTOCOL_ERROR|ECONNRESET|ECONNREFUSED|EPROTO|ETIMEDOUT|socket disconnected|trang đích không mở|Proxy không kết nối được/i.test(String(msg));
}

export function makeCancel() {
  return { cancelled: false, hook: null, abort() { this.cancelled = true; try { this.hook?.(); } catch {  } } };
}

export async function runVisit(omni, opts) {
  let res;
  let lostRetried = false;
  let errRetried = false;
  let netRetries = 0;
  let changeIpRetried = false;
  const changeIpWait = opts.changeIpWaitMs ?? CHANGE_IP_WAIT_MS;
  const timeout = Number(opts.attemptTimeout) > 0 ? Number(opts.attemptTimeout) : attemptTimeoutMs(opts.settings);
  const cancel = opts.cancel || null;
  const isCancelled = () => !!(cancel && cancel.cancelled);
  const cancelledRes = (prev, attempt) => ({ ...(prev || {}), status: 'cancelled', cancelled: true, ip: prev?.ip || '', error: 'Đã huỷ: chiến dịch bị dừng.', attempts: attempt });
  for (let attempt = 1; attempt <= 1 + CAPTCHA_RETRIES; attempt++) {
    if (isCancelled()) { res = cancelledRes(res, attempt - 1); break; }
    let leaseId = null;
    const onLease = opts.onLease;
    let wake;
    const woke = new Promise(r => { wake = r; });
    const closeBrowser = () => { if (leaseId) stopIfActive(omni, leaseId).catch(() => {}); };
    if (cancel) cancel.hook = () => { closeBrowser(); wake(); };
    const base = opts.attemptTimeout === 0 ? attemptOnce(omni, opts) : withTimeout(
      attemptOnce(omni, {
        ...opts,
        onLease: (name, id) => { leaseId = id ?? leaseId; onLease?.(name); if (isCancelled()) closeBrowser(); },
      }),
      timeout,
      closeBrowser,
    );
    let run = base;
    if (cancel) {
      base.catch(() => {});
      run = Promise.race([base, woke.then(() => { const e = new Error('Đã huỷ: chiến dịch bị dừng.'); e.cancelled = true; throw e; })]);
      if (isCancelled()) wake();
    }
    try {
      res = await run;
    } catch (e) {
      res = { status: 'error', ip: '', error: e.message, lost: true, timedOut: !e.cancelled, cancelled: !!e.cancelled };
    }
    res.attempts = attempt;
    if (isCancelled()) {
      if (res.status === 'error' || res.lost) res = cancelledRes(res, attempt);
      break;
    }
    if (res.lost && !lostRetried) {
      lostRetried = true;
      opts.log('↻ Mở lại trình duyệt và chạy lại lượt.');
      continue;
    }
    if (res.status === 'error' && !res.timedOut && isChangeIpError(res.error)) {
      if (!changeIpRetried) {
        changeIpRetried = true;
        opts.log(`⏳ OmniLogin không gọi được URL đổi IP (${res.error}) — chờ ${Math.round(changeIpWait / 1000)}s rồi thử lại.`);
        for (let waited = 0; waited < changeIpWait && !isCancelled(); waited += 500) await new Promise(r => setTimeout(r, Math.min(500, changeIpWait - waited)));
        continue;
      }
      res.error = String(res.error) + CHANGE_IP_HINT;
      opts.log(`✖ ${res.error}`);
      break;
    }
    if (res.status === 'error' && !res.timedOut) {
      const netFail = isTargetNetworkError(res.error) || !!res.verify;
      const canRetry = netFail ? netRetries < CAPTCHA_RETRIES : !errRetried;
      if (netFail) netRetries++; else errRetried = true;
      if (canRetry) {
        opts.log(`↻ Lỗi hạ tầng (${res.error}) — đổi IP và thử lại (lần ${attempt + 1}/${1 + CAPTCHA_RETRIES}).`);
        continue;
      }
      break;
    }
    if (res.status !== 'captcha') break;
    if (attempt <= CAPTCHA_RETRIES) opts.log(`↻ Đổi IP mới và thử lại (lần ${attempt + 1}/${1 + CAPTCHA_RETRIES}).`);
  }
  return res;
}

async function bringToFront(session) {
  try {
    const url = await session.page.url();
    const tabs = (await session.tabs.list()).pages;
    const tab = tabs.find(t => t.url === url) || tabs[0];
    if (tab) await session.page.browser.bringToFront(tab.targetId);
  } catch {}
}

async function attemptOnce(omni, opts) {
  const { proxyPool, onLease = () => {} } = opts;
  const px = proxyPool ? proxyPool.next(opts.slot, opts.profileName) : { ...buildProxy(opts.settings.proxy), label: opts.settings.proxy.host };
  const seen = { reached: false, captcha: false };
  const log = msg => {
    if (/Bước: (Trang chủ Google|Trang kết quả|Google chặn)/.test(msg)) seen.reached = true;
    if (/Bước: Google chặn \(captcha/.test(msg)) seen.captcha = true;
    opts.log(msg);
  };
  const res = await attemptInner(omni, { ...opts, log, onLease }, px);
  if (proxyPool) {
    const benched = proxyPool.report(px.label, {
      reached: seen.reached,
      captcha: seen.captcha || res.status === 'captcha',
      proxyFail: !res.lost && !['limit', 'quota'].includes(res.status)
        && (!res.ip || isTargetNetworkError(res.error)),
      ok: res.status === 'ok',
    });
    if (benched) opts.log(`⚠ ${benched}`);
  }
  res.proxy = px.label;
  return res;
}

async function attemptInner(omni, { slot, keyword, targetUrl, queryMode, settings, solver, log, onStep = () => {}, onCaptcha = () => {}, onLease, openSession, device: preset }, px) {
  const { maxPages } = settings;
  const device = preset || pickDevice(settings);
  const headless = !!settings.headless && device.kind === 'desktop';
  let lease = null;
  let session = null;
  let ip = '';
  let ua = '';
  try {
    onStep('Chuẩn bị profile');
    lease = px.mode === 'omni'
      ? await leaseOmniProfile(omni, px, log, device)
      : settings.profileMode === 'pool'
        ? await leasePool(omni, slot, px, settings, log, device)
        : await leaseFresh(omni, px, log, device);
    onLease(lease.name, lease.id);

    onStep('Mở trình duyệt');
    session = await openProfile(omni, lease, { headless, log }, openSession || connectBridge);
    if (lease.pooled) {
      await wipeSession(session, log);
      await wipeBrowserData(session, log, { targetUrl });
    }
    ua = await readUserAgent(session.page);
    if (device.kind === 'mobile') {
      markTouch(session.page);
      log(`Thiết bị: ${device.label}${settings.headless ? ' (bỏ "Chạy ẩn" vì lượt di động cần cửa sổ thật)' : ''}.`);
      log(/Mobile/i.test(ua) ? `UA di động: ${ua}` : `⚠ UA không phải di động (${ua || 'không đọc được'}) — kiểm tra lại profile OmniLogin.`);
    } else {
      log(`Thiết bị: ${device.label}.`);
    }

    ip = await readIp(session.page);
    log(ip ? `IP: ${ip}` : 'Không đọc được IP (proxy có thể lỗi).');
    if (!ip) throw new Error('Proxy không kết nối được.');

    onStep(settings.skipSearch ? 'Mở URL trực tiếp' : settings.impressionOnly ? 'Tìm Google (chỉ hiển thị)' : 'Tìm Google');
    const manual = settings.captchaMode === 'manual' && !headless;
    const result = settings.skipSearch
      ? await directVisit(session.page, { keyword, targetUrl, log })
      : await googleSearch(session.page, {
        keyword, targetUrl, maxPages, tabs: session.tabs, log,
        queryMode,
        impressionOnly: !!settings.impressionOnly,
        captchaWaitMs: manual ? settings.captchaWaitMin * 60000 : 0,
        solver,
        onCaptcha: async waiting => {
          onStep(waiting ? 'Chờ giải captcha' : 'Tìm Google');
          if (waiting) await bringToFront(session);
          onCaptcha(waiting, { profileName: lease.name });
        },
      });
    if (result.landed && !result.impression && !settings.skipVisit && settings.dwellMax > 0) {
      onStep('Ở lại trên site');
      result.visit = await browseSite(session.page, { ...settings, tabs: session.tabs, log });
    }
    return { status: 'ok', ip, ua, device: device.label, deviceKind: device.kind, result };
  } catch (err) {
    let msg = err?.message || String(err);
    const notFound = err instanceof NotFoundError || /Không tìm thấy URL/.test(msg);
    const status = err instanceof CaptchaError ? 'captcha'
      : err instanceof ProfileLimitError ? 'limit'
      : err instanceof ProfileQuotaError ? 'quota'
      : notFound ? 'notfound' : 'error';
    const lost = status === 'error' && lease ? await diagnoseLost(omni, session, lease.id) : null;
    if (lost) msg = `${lost}. Lỗi gốc: ${msg}`;
    log(`✖ ${msg}`);
    return {
      status, ip, ua, device: device.label, deviceKind: device.kind, error: msg, lost: !!lost, verify: err instanceof VerifyError,
      query: err instanceof NotFoundError ? err.query : null,
    };
  } finally {
    onStep('Dọn dẹp');
    try { if (session) await session.disconnect(); } catch {}
    if (lease) await lease.release();
  }
}

export async function destroyProfile(omni, profileId, log = () => {}) {
  await stopIfActive(omni, profileId);
  for (const [slot, st] of poolState) if (st.id === profileId) poolState.delete(slot);
  for (let i = 0; i < 3; i++) {
    try {
      await omni.profiles.delete(profileId, true);
      return;
    } catch (e) {
      if (i === 2) log(`Cảnh báo: không xóa được profile #${profileId}: ${e.message}`);
      await sleep(2000);
    }
  }
}