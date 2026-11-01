import { runWorkflow, pollUntil } from './runner.mjs';
import { clickLocator, wheel, isTouch, typeText, moveMouse } from './human.mjs';
import { solveGoogleSorry } from './captcha.mjs';
import { searchQuery } from '../campaign-types.mjs';

const GOOGLE_HOME = 'https://www.google.com/';
const CAPTCHA_WAIT_MS = 180000;
const ENTER_WAIT_MS = 15000;

export class CaptchaError extends Error {}

export class VerifyError extends Error {}
const VERIFY_RE = /Đang xác minh yêu cầu|Verifying (your request|that you)/i;

export class NotFoundError extends Error {
  constructor(message, { keyword = '', query = '', seen = [] } = {}) {
    super(message);
    this.name = 'NotFoundError';
    this.keyword = keyword;
    this.query = query;
    this.seen = seen;
  }
}

const SEARCH_BOX ='textarea[name="q"], input[name="q"]';

export const RESULT_LINK_SELECTOR = '#search a:has(h3), #rso a:has(h3), #rso a:has([role="heading"])';
const RESULT_TITLE_SELECTOR = 'h3, [role="heading"]';
const resultLinks = page => page.locator(RESULT_LINK_SELECTOR);

const CONSENT_TEXTS = ['Accept all', 'Chấp nhận tất cả', 'Tout accepter', 'Alle akzeptieren', 'Aceptar todo', 'I agree'];

const SOURCE_DOMAINS = {
  youtube: 'www.youtube.com',
  facebook: 'www.facebook.com',
  tiktok: 'www.tiktok.com',
  instagram: 'www.instagram.com',
  linkedin: 'www.linkedin.com',
  x: 'x.com',
  twitter: 'x.com',
  reddit: 'www.reddit.com',
};

function parse(url) {
  try { return new URL(url); } catch { return null; }
}
const isGoogleHost = u => !!u && /(^|\.)google\.[a-z.]+$/i.test(u.hostname);
const isSorry = u => !!u && (u.pathname.startsWith('/sorry') || u.hostname.startsWith('ipv4.google') || u.hostname.startsWith('ipv6.google'));
const isConsent = u => !!u && u.hostname.startsWith('consent.google');
const isResults = u => isGoogleHost(u) && u.pathname === '/search' && u.searchParams.has('q');

export const looksEncryptedQuery = q => /^[A-Za-z0-9_-]{24,}$/.test(String(q || '').trim());

export async function googleSearch(page, { keyword, targetUrl, maxPages = 5, impressionOnly = false, queryMode = 'keyword', tabs, captchaWaitMs = CAPTCHA_WAIT_MS, onCaptcha = () => {}, solver = null, log = console.log }) {
  if (!keyword || !keyword.trim()) throw new Error('Từ khóa đang trống.');
  keyword = keyword.trim();
  const target = parseTarget(targetUrl);
  const query = searchQuery({ keyword, targetUrl: target?.raw || '', queryMode });
  maxPages = Math.min(Math.max(Number(maxPages) || 5, 1), 10);
  log(`① Từ khóa: "${keyword}"${query === keyword ? '' : ` · truy vấn gửi Google: "${query}" (kiểu: từ khóa + tên miền)`}`);
  if (target) log(`  URL cần vào: ${target.raw} (tìm tối đa ${maxPages} trang)`);

  let lastUrl = null;
  const currentUrl = async () => {
    const u = parse(await page.url().catch(() => ''));
    if (u) lastUrl = u;
    return u || lastUrl;
  };
  const onSorry = async () => isSorry(await currentUrl());
  let searched = false;
  let captchaPassed = false;

  async function backToGoogleHome() {
    if (await onSorry()) {
      log('  ⚠ Đang ở trang captcha của Google — không điều hướng để không mất captcha (bước captcha sẽ xử lý).');
      return false;
    }
    await page.goto(GOOGLE_HOME, { waitUntil: 'load' });
    return true;
  }

  const steps = [
    {
      name: 'Mở google.com',
      timeout: 20000,
      check: async () => {
        const u = await currentUrl();
        return !!u && !isGoogleHost(u) && !isConsent(u);
      },
      execute: async () => {
        if (await onSorry()) {
          log('  ⚠ Đang ở trang captcha của Google — không mở lại google.com để không mất captcha.');
          return { ok: false };
        }
        log('② Đang vào google.com ...');
        await page.goto(GOOGLE_HOME, { waitUntil: 'load' });
        return { ok: true };
      },
    },
    {
      name: 'Đồng ý cookie (consent)',
      timeout: 10000,
      check: async () => isConsent(await currentUrl()),
      execute: async () => {
        for (const t of CONSENT_TEXTS) {
          const btn = page.locator(`button:has-text("${t}")`).first();
          if ((await btn.count()) && (await btn.isVisible())) {
            await clickLocator(page, btn);
            await pollUntil(async () => !isConsent(await currentUrl()), { timeout: 15000 });
            return { ok: true };
          }
        }
        return { ok: false };
      },
    },
    {
      name: 'Google chặn (captcha /sorry)',
      timeout: 20000,
      check: async () => isSorry(await currentUrl()),
      execute: async () => {
        if (solver?.apiKey) {
          const solved = await solveGoogleSorry(page, { apiKey: solver.apiKey, log });
          if (solved) {
            captchaPassed = true;
            return { ok: true };
          }
          log('  CapSolver không giải được — chuyển sang chế độ dự phòng.');
        }
        if (!captchaWaitMs) throw new CaptchaError('Google hiện captcha (/sorry) — bỏ lượt này.');
        log(`  ⚠ Google hiện captcha. Hãy giải captcha trên cửa sổ trình duyệt profile (chờ tối đa ${captchaWaitMs / 60000} phút)...`);
        await Promise.resolve(onCaptcha(true)).catch(() => {});
        let clear = 0;
        try {
          await pollUntil(async () => {
            const u = await currentUrl();
            clear = (u && isGoogleHost(u) && !isSorry(u)) ? clear + 1 : 0;
            return clear >= 2;
          }, { timeout: captchaWaitMs, interval: 1500 });
        } catch {
          throw new CaptchaError('Hết thời gian chờ giải captcha của Google.');
        } finally {
          await Promise.resolve(onCaptcha(false)).catch(() => {});
        }
        log('  ✓ Đã qua captcha, tiếp tục.');
        captchaPassed = true;
        return { ok: true };
      },
    },
    {
      name: 'Trang chủ Google — nhập từ khóa',
      timeout: 30000,
      check: async () => {
        const u = await currentUrl();
        if (!isGoogleHost(u) || isResults(u) || isSorry(u)) return false;
        return page.locator(SEARCH_BOX).first().isVisible();
      },
      execute: async () => {
        log(`③ Tìm kiếm Google với truy vấn "${query}"${query === keyword ? '' : ` (từ khóa "${keyword}" + tên miền)`} ...`);
        const box = page.locator(SEARCH_BOX).first();
        await clickLocator(page, box);
        await typeKeyword(page, box, query);
        if ((await box.inputValue()).trim() !== query) {
          log(`  ⚠ Ô tìm kiếm nhận sai nội dung ("${await box.inputValue()}"), nhập lại.`);
          return { ok: false };
        }
        const leftHome = async () => {
          const u = await currentUrl();
          return isResults(u) || isSorry(u);
        };
        await box.press('Enter');
        searched = true;
        const entered = await pollUntil(leftHome, { timeout: ENTER_WAIT_MS }).catch(() => false);
        if (!entered && !(await leftHome())) {
          log(`  Enter không có tác dụng sau ${Math.round(ENTER_WAIT_MS / 1000)}s (vẫn ở trang chủ Google) — gửi form tìm kiếm trực tiếp.`);
          await page.evaluate(sel => document.querySelector(sel)?.form?.requestSubmit(), SEARCH_BOX);
        }
        await pollUntil(leftHome, { timeout: 30000 });
        return { ok: true };
      },
    },
    {
      name: 'Trang kết quả tìm kiếm',
      timeout: 20000,
      check: async () => isResults(await currentUrl()),
      execute: async () => {
        const hasResults = async () => (await page.locator('#search, #rso').count()) > 0;
        await pollUntil(hasResults, { timeout: 10000, interval: 400 }).catch(() => {});
        const onVerify = async () => VERIFY_RE.test(await page.evaluate(() => (document.body?.innerText || '').slice(0, 800)).catch(() => ''));
        if (!(await hasResults().catch(() => false)) && await onVerify()) {
          log('  Google đang xác minh yêu cầu — chờ trang tự chuyển ...');
          const passed = () => pollUntil(async () => (await hasResults()) || !(await onVerify()), { timeout: 20000, interval: 500 }).then(() => true, () => false);
          let ok = await passed();
          if (!ok) {
            log('  Vẫn ở trang xác minh — bấm "Tiếp tục".');
            try { await clickLocator(page, page.locator('button:has-text("Tiếp tục"), a:has-text("Tiếp tục"), button:has-text("Continue")').first()); } catch {  }
            ok = await passed();
          }
          await pollUntil(hasResults, { timeout: 10000, interval: 400 }).catch(() => {});
          if (!(await hasResults().catch(() => false)) && await onVerify()) throw new VerifyError('Google giữ trang "Đang xác minh yêu cầu của bạn" — IP/phiên này bị kiểm tra.');
          log(`  ✓ Đã qua trang xác minh${ok ? '' : ' (sau khi bấm Tiếp tục)'}.`);
        }
        const u = await currentUrl();
        const qs = (u?.searchParams.getAll('q') || []).map(x => x.trim());
        const q = qs[0] || '';
        const sameQuery = qs.some(x => x.toLowerCase() === query.toLowerCase());
        const ownSearch = searched || captchaPassed;
        const encryptedOwn = ownSearch && looksEncryptedQuery(q);
        if (!ownSearch || (!sameQuery && !encryptedOwn)) {
          log(`  Đang ở trang kết quả cũ ("${q}"), quay lại google.com để tìm mới.`);
          await backToGoogleHome();
          return { ok: false };
        }
        if (!sameQuery) {
          const n = await resultLinks(page).count().catch(() => 0);
          if (!n) {
            log('  Trang mã hoá truy vấn nhưng chưa có kết quả tự nhiên — quay lại google.com để tìm lại.');
            await backToGoogleHome();
            return { ok: false };
          }
          log(`  Google mã hoá truy vấn trong URL (q=${q.slice(0, 10)}…) — vẫn quét trang này, không quay lại google.com.`);
        }
        const searchUrl = u.href;
        const results = [];
        let skipLinks = 0;
        let scanned = 0;
        for (let pageNo = 1; pageNo <= maxPages; pageNo++) {
          const found = await collectResults(page, pageNo, target, skipLinks);
          scanned = pageNo;
          results.push(...found.items);
          log(`  Trang ${pageNo}: ${found.items.length} kết quả tự nhiên.`);

          if (!target) break;

          if (found.match) {
            const m = found.match;
            log(`④ Tìm thấy URL yêu cầu ở trang ${pageNo}, vị trí #${m.position}: ${m.href}`);
            if (impressionOnly) {
              await impressionExit(page, tabs, m, pageNo, log);
              return {
                ok: true, done: true,
                data: { keyword, query, url: searchUrl, results, target: target.raw, matched: { page: pageNo, position: m.position, title: m.title, href: m.href }, impression: true },
              };
            }
            log('  Đang bấm vào kết quả ...');
            const landed = await clickResult(page, tabs, m.locator);
            log(`✔ Đã vào trang: ${landed.url}`);
            if (!matchesTarget(landed.url, { ...target, path: '' })) {
              log(`  ⚠ Tên miền trang đích khác URL yêu cầu (${target.host}) — có thể do chuyển hướng.`);
            }
            return {
              ok: true, done: true,
              data: { keyword, query, url: searchUrl, results, target: target.raw, matched: { page: pageNo, position: m.position, title: m.title, href: m.href }, landed },
            };
          }

          if (pageNo === maxPages) break;
          const adv = await nextResults(page, found.totalLinks, log);
          if (!adv) {
            log('  Không còn trang kết quả tiếp theo.');
            break;
          }
          if (adv === 'nav') {
            skipLinks = 0;
            if (isSorry(await currentUrl())) return { ok: false };
          } else {
            skipLinks = found.totalLinks;
          }
        }

        if (target) {
          const seen = [];
          for (const r of results) {
            try {
              const h = new URL(r.href).hostname.replace(/^www\./i, '').toLowerCase();
              if (h && !seen.includes(h)) seen.push(h);
            } catch {  }
          }
          const seenText = (seen.slice(0, 20).join(', ') || '(không có)') + (seen.length > 20 ? ', …' : '');
          log(`  Đã quét ${results.length} kết quả — tên miền thấy được: ${seenText}`);
          throw new NotFoundError(`Không tìm thấy URL "${target.raw}" trong ${scanned} trang kết quả đầu của truy vấn "${query}". Tên miền đã thấy: ${seenText}.`, { keyword, query, seen });
        }
        if (impressionOnly) {
          await impressionExit(page, tabs, null, 1, log);
          return { ok: true, done: true, data: { keyword, query, url: searchUrl, results, impression: true } };
        }
        log(`✔ Hoàn tất: ${results.length} kết quả tự nhiên trên trang 1.`);
        return { ok: true, done: true, data: { keyword, query, url: searchUrl, results } };
      },
    },
  ];

  try {
    return await runWorkflow(steps, { log });
  } catch (e) {
    if (/unknown state|Bị kẹt/.test(e.message)) {
      const cur = await page.url().catch(() => '');
      const title = await page.title().catch(() => '');
      e.message += ` [URL: ${cur.slice(0, 150)} | tiêu đề: ${title.slice(0, 80)}]`;
    }
    throw e;
  }
}

async function nextResults(page, prevLinks, log) {
  const linkCount = () => resultLinks(page).count();
  for (let i = 0; i < 3; i++) {
    await wheel(page, 1500 + Math.random() * 1500);
    await page.waitForTimeout(500 + Math.random() * 500);
  }
  let kind = null;
  await pollUntil(async () => {
    if (await page.locator('a#pnnext').count()) return (kind = 'nav');
    if ((await linkCount()) > prevLinks) return (kind = 'scroll');
    const hasMore = await page.evaluate(() => {
      document.querySelectorAll('[data-omni-more]').forEach(e => e.removeAttribute('data-omni-more'));
      const re = /^(kết quả khác|more results|xem thêm kết quả)$/i;
      const el = [...document.querySelectorAll('a, button, [role="button"]')].find(e => {
        const t = (e.innerText || e.getAttribute('aria-label') || '').trim();
        return re.test(t) && e.getBoundingClientRect().height > 0;
      });
      if (el) el.setAttribute('data-omni-more', '1');
      return !!el;
    });
    if (hasMore) return (kind = 'more');
    await wheel(page, 800);
    return false;
  }, { timeout: 8000, interval: 800 }).catch(() => {});

  if (kind === 'nav') {
    const next = page.locator('a#pnnext').first();
    const before = await page.url();
    await scrollIntoView(page, next);
    await clickLocator(page, next);
    await pollUntil(async () => {
      const cur = await page.url();
      return (cur !== before && isResults(parse(cur))) || isSorry(parse(cur));
    }, { timeout: 30000 });
    return 'nav';
  }
  if (kind === 'more') {
    log('  Trang dùng nút "Kết quả khác" — bấm để tải thêm.');
    const btn = page.locator('[data-omni-more="1"]').first();
    await scrollIntoView(page, btn);
    await clickLocator(page, btn);
    const grew = await pollUntil(async () => (await linkCount()) > prevLinks, { timeout: 12000 }).catch(() => false);
    return grew ? 'more' : null;
  }
  if (kind === 'scroll') {
    log('  Trang dùng kiểu cuộn liên tục — đã tải thêm kết quả.');
    return 'scroll';
  }
  return null;
}

export function parseTarget(raw) {
  raw = String(raw || '').trim();
  if (!raw) return null;
  const u = parse(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  if (!u) throw new Error(`URL yêu cầu không hợp lệ: ${raw}`);
  const host = u.hostname.replace(/^www\./i, '').toLowerCase();
  const pathPart = (u.pathname + u.search).replace(/\/+$/, '');
  return { raw, host, path: pathPart };
}

function matchesTarget(href, target) {
  const u = parse(href);
  if (!u) return false;
  const host = u.hostname.replace(/^www\./i, '').toLowerCase();
  if (host !== target.host && !host.endsWith('.' + target.host)) return false;
  if (!target.path) return true;
  const p = (u.pathname + u.search).replace(/\/+$/, '');
  return host === target.host && p.toLowerCase().startsWith(target.path.toLowerCase());
}

async function collectResults(page, pageNo, target, skip = 0) {
  const linkSel = resultLinks(page);
  let last = -1;
  await pollUntil(async () => {
    const n = await linkSel.count();
    const stable = n > 0 && n === last;
    last = n;
    return stable;
  }, { timeout: 10000, interval: 600 }).catch(() => {});
  const all = await linkSel.all();
  const links = all.slice(skip);
  const items = [];
  let match = null;
  for (const a of links) {
    try {
      const title = (await a.locator(RESULT_TITLE_SELECTOR).first().innerText()).trim();
      if (!title) continue;
      const href = await resolveResultUrl(a);
      if (!href) continue;
      const item = { page: pageNo, position: items.length + 1, title, href };
      if (target && !match && matchesTarget(href, target)) {
        item.matched = true;
        match = { ...item, locator: a };
      }
      items.push(item);
    } catch {
    }
  }
  return { items, match, totalLinks: all.length };
}

export function unwrapGoogleHref(href) {
  const m = /[?&](?:q|url)=([^&]+)/.exec(String(href || ''));
  if (!m) return null;
  let raw = m[1];
  try { raw = decodeURIComponent(raw); } catch {  }
  if (/^https?:/i.test(raw)) return raw;
  try {
    const decoded = Buffer.from(raw.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
    const u = /https?:\/\/[^\s"'<>\\]+/.exec(decoded);
    if (u) return u[0];
  } catch {  }
  return null;
}

export function displayUrlFromText(text) {
  const s = String(text || '');
  const full = /https?:\/\/[^\s]+/i.exec(s);
  if (full) return full[0].replace(/[).,;]+$/, '');
  const bare = /(?:^|[\s(])((?:[a-z0-9-]+\.)+[a-z]{2,24})((?:\/[^\s]*)?)/i.exec(s);
  return bare ? `https://${bare[1]}${(bare[2] || '').replace(/[).,;]+$/, '')}` : null;
}

async function resolveResultUrl(a) {
  const href = await a.getAttribute('href');
  if (href && /^https?:/i.test(href)) return href;

  if (href) {
    const unwrapped = unwrapGoogleHref(href);
    if (unwrapped) return unwrapped;
  }
  const shown = displayUrlFromText(await a.innerText().catch(() => ''));
  if (shown) return shown;

  const cite = a.locator('cite').first();
  if (!(await cite.count())) return null;
  const text = (await cite.innerText()).trim();
  const [origin, ...crumbs] = text.split('›').map(s => s.trim());
  if (!/^(https?:\/\/)?[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(origin)) {
    const lines = (await a.innerText()).split('\n').map(s => s.trim());
    for (const line of lines) {
      const name = line.split('·')[0].trim().toLowerCase();
      if (SOURCE_DOMAINS[name]) return `https://${SOURCE_DOMAINS[name]}`;
    }
    return null;
  }
  const bad = crumbs.findIndex(c => !c || /(\.\.\.|…)$/.test(c) || /\s/.test(c));
  const segs = bad === -1 ? crumbs : crumbs.slice(0, bad);
  return (/^https?:/i.test(origin) ? origin : `https://${origin}`) + (segs.length ? '/' + segs.join('/') : '');
}

async function typeKeyword(page, box, keyword) {
  await page.evaluate(sel => {
    const el = document.querySelector(sel);
    el.focus();
    el.value = '';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }, SEARCH_BOX);
  await page.waitForTimeout(300 + Math.random() * 500);
  await typeText(page, keyword, { typoChance: 0.3 });
  await page.waitForTimeout(400 + Math.random() * 900);
}

async function scrollIntoView(page, el) {
  const vh = Number(await page.evaluate('window.innerHeight')) || 700;
  for (let i = 0; i < 8; i++) {
    const b = await el.boundingBox();
    if (!b) return;
    if (b.y >= 80 && b.y + b.height <= vh - 40) return;
    await wheel(page, b.y - vh / 3);
    await page.waitForTimeout(500);
  }
}

async function hoverPoint(el) {
  const b = await el.boundingBox().catch(() => null);
  if (!b || b.width <= 0 || b.height <= 0) return null;
  return [Math.round(b.x + b.width * (0.3 + Math.random() * 0.4)), Math.round(b.y + b.height * (0.4 + Math.random() * 0.2))];
}

async function impressionExit(page, tabs, match, pageNo, log = () => {}) {
  if (match) {
    log(`👁 Lượt chỉ lấy hiển thị: kết quả đã hiện ở trang ${pageNo} vị trí #${match.position} — không bấm vào.`);
    await scrollIntoView(page, match.locator.locator(RESULT_TITLE_SELECTOR).first()).catch(() => {});
  } else {
    log('👁 Lượt chỉ lấy hiển thị: đã xem trang kết quả — không bấm vào.');
  }
  await page.waitForTimeout(900 + Math.random() * 1600);
  const closed = await closeTab(page, tabs, log);
  log(closed ? '  ↗ Đã thoát tab — lượt này chỉ tính hiển thị, site không nhận truy cập.' : '  ⚠ Không đóng được tab — lượt vẫn kết thúc tại trang kết quả.');
  return closed;
}

export async function closeTab(page, tabs, log = () => {}) {
  if (typeof page?.close === 'function') {
    try {
      await page.close();
      return true;
    } catch (e) {
      log(`  ⚠ page.close() lỗi (${e.message}) — đóng tab qua API của OmniLogin.`);
    }
  }
  if (!tabs) return false;
  try {
    const url = await page.url().catch(() => '');
    const pages = (await tabs.list()).pages || [];
    const me = pages.find(t => t.url === url) || pages[0];
    if (!me) return false;
    await tabs.close(me.targetId);
    return true;
  } catch (e) {
    log(`  ⚠ Không đóng được tab: ${e.message}`);
    return false;
  }
}

async function clickResult(page, tabs, link) {
  const before = tabs ? (await tabs.list()).pages.map(p => p.targetId) : [];
  const urlBefore = await page.url();
  const titleEl = link.locator(RESULT_TITLE_SELECTOR).first();
  await scrollIntoView(page, titleEl);
  const hover = isTouch(page) ? null : await hoverPoint(titleEl);
  if (hover) await moveMouse(page, hover[0], hover[1]);
  await page.waitForTimeout(150 + Math.random() * 400);
  await clickLocator(page, titleEl);

  if (isTouch(page) && !(await pollUntil(async () => (await page.url()) !== urlBefore, { timeout: 8000, interval: 500 }).catch(() => false))) {
    await link.evaluate(el => el.click()).catch(() => {});
  }

  let newTab = null;
  await pollUntil(async () => {
    const u = parse(await page.url());
    if (u && !isGoogleHost(u)) return true;
    if (tabs) {
      newTab = (await tabs.list()).pages.find(p => !before.includes(p.targetId)) || null;
      return !!newTab;
    }
    return false;
  }, { timeout: 30000 }).catch(() => {
    throw new Error('Đã bấm kết quả nhưng trang đích không mở trong 30 giây.');
  });

  if (newTab) {
    await tabs.activate(newTab.targetId);
    return { url: newTab.url, title: newTab.title, newTab: true };
  }
  await page.waitForLoadState('load').catch(() => {});
  return { url: await page.url(), title: await page.title(), newTab: false };
}