import { pollUntil } from './runner.mjs';
import { clickLocator, moveMouse, wheel, isTouch, idleFidget } from './human.mjs';

const SKIP_HREF = /\.(pdf|zip|rar|apk|exe|jpe?g|png|gif|webp|svg|mp4|mp3)(\?|$)|\/(wp-admin|wp-login|login|logout|dang-nhap|dang-ky|register|cart|checkout)\b/i;

const rand = (min, max) => min + Math.random() * (max - min);
const randInt = (min, max) => Math.floor(rand(min, max + 1));
const sleep = ms => new Promise(r => setTimeout(r, ms));
export const hostOf = url => { try { return new URL(url).hostname.replace(/^www\./i, '').toLowerCase(); } catch { return ''; } };

export async function browseSite(page, { dwellMin, dwellMax, subpages, subDwellMin, subDwellMax, tabs, log = console.log }) {
  const stayOnPage = (ms, label) => stayOn(page, ms, label, log);
  const startUrl = await page.url();
  const siteHost = hostOf(startUrl);
  const visited = [];
  const t0 = Date.now();

  log(`⑤ Ở lại trên site (${dwellMin}–${dwellMax} giây, ${subpages} trang con) ...`);
  visited.push(await stayOnPage(rand(dwellMin, dwellMax) * 1000, 'Trang đích'));

  for (let i = 1; i <= subpages; i++) {
    let link = null;
    for (let tries = 0; tries < 3 && !link; tries++) {
      link = await pickInternalLink(page, siteHost, tries === 0 ? visited.map(v => v.url) : []);
      if (!link) {
        log('  Không thấy liên kết nội bộ nào trong khung nhìn — cuộn lại đầu trang rồi thử lại.');
        await backToTop(page);
        await sleep(rand(700, 1500));
      }
    }
    if (!link) {
      log('  Hết liên kết để vào — nán lại đọc tiếp trang hiện tại thay vì kết thúc sớm.');
      visited.push(await stayOnPage(rand(subDwellMin, subDwellMax) * 1000, `Nán lại ${i}`));
      continue;
    }

    log(`  → Bấm trang con ${i}: ${link.text || link.href}`);
    const before = await page.url();
    const pad = async why => {
      log(`  ⚠ ${why} — nán lại đọc tiếp.`);
      visited.push(await stayOnPage(rand(5000, 15000), `Nán lại ${i}`));
    };
    try {
      await clickPicked(page, tabs, log);
    } catch (e) {
      await pad(`Không bấm được trang con (${e.message})`);
      continue;
    }
    try {
      await pollUntil(async () => (await page.url()) !== before, { timeout: 20000 });
      await page.waitForLoadState('load').catch(() => {});
    } catch {
      await pad('Đã bấm nhưng trang không chuyển trong 20 giây');
      continue;
    }
    if (hostOf(await page.url()) !== siteHost) {
      log(`  ⚠ Trang con chuyển sang domain khác (${await page.url()}), dừng xem trang con.`);
      break;
    }
    visited.push(await stayOnPage(rand(subDwellMin, subDwellMax) * 1000, `Trang con ${i}`));
  }

  const totalSeconds = Math.round((Date.now() - t0) / 1000);
  log(`✔ Tổng thời gian trên site: ${totalSeconds} giây, đã xem ${visited.length} trang.`);
  return { totalSeconds, pages: visited };
}

async function stayOn(page, durationMs, label, log) {
  const url = await page.url();
  const title = await page.title().catch(() => '');
  const start = Date.now();
  const deadline = start + durationMs;
  const vh = Number(await page.evaluate('window.innerHeight').catch(() => 0)) || 700;
  const vw = Number(await page.evaluate('window.innerWidth').catch(() => 0)) || 1200;
  let maxDepth = 0;
  let watchedVideo = false;

  await sleep(rand(1500, 3500));
  while (Date.now() < deadline) {
    let view = null;
    try {
      view = await readViewport(page);
      if (view) {
        maxDepth = Math.max(maxDepth, view.depth);
        if (!watchedVideo && view.videoSec >= 5) {
          watchedVideo = true;
          log(`  ${label}: xem video ${view.videoSec} giây.`);
          await watchVideo(page, view.videoSec * 1000, deadline, { w: vw, h: vh });
          continue;
        }
        const atBottom = view.depth >= 0.98;
        const r = Math.random();
        if (atBottom) {
          if (r < 0.5) await wheel(page, -randInt(vh * 0.6, vh * 1.8));
        } else if (r < 0.12 && view.y > vh) {
          await wheel(page, -randInt(120, 400));
        } else if (r < 0.35) {
          for (let k = randInt(2, 4); k > 0; k--) {
            await wheel(page, randInt(250, 600));
            await sleep(rand(120, 350));
          }
        } else {
          await wheel(page, randInt(80, 260));
        }
        if (!isTouch(page) && Math.random() < 0.25) await moveMouse(page, randInt(vw * 0.2, vw * 0.8), randInt(vh * 0.2, vh * 0.7));
      }
    } catch {
    }
    const pause = readingPause(view, Math.max(2500, (deadline - start) / 8));
    const budget = Math.min(pause, Math.max(0, deadline - Date.now()));
    const idleFrom = Date.now();
    if (budget > 1500 && Math.random() < 0.5) await idleFidget(page, { w: vw, h: vh });
    await sleep(Math.max(0, budget - (Date.now() - idleFrom)));
  }
  try { maxDepth = Math.max(maxDepth, (await readViewport(page)).depth); } catch {}

  const seconds = Math.round((Date.now() - start) / 1000);
  log(`  ${label}: ở lại ${seconds} giây, cuộn tới ${Math.round(maxDepth * 100)}% trang — ${url}`);
  return { label, url, title, seconds, scrollDepth: Math.round(maxDepth * 100) };
}

async function backToTop(page) {
  try { await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' })); } catch {}
}

function readingPause(view, capMs) {
  if (!view) return Math.min(rand(700, 2800), capMs);
  const fromText = view.words ? (view.words / rand(420, 760)) * 60000 : 0;
  const fromMedia = view.media ? rand(800, 2200) : 0;
  const look = rand(400, 900);
  return Math.min(12000, Math.max(700, fromText + fromMedia + look), capMs);
}

async function watchVideo(page, ms, deadline, size) {
  const until = Math.min(Date.now() + ms, deadline);
  while (Date.now() < until) {
    const chunk = Math.min(until - Date.now(), rand(3000, 6000));
    try {
      if (!isTouch(page) && Math.random() < 0.5) {
        await moveMouse(page, randInt(size.w * 0.2, size.w * 0.8), randInt(size.h * 0.2, size.h * 0.7));
      }
    } catch {}
    await sleep(chunk);
  }
}

async function readViewport(page) {
  return page.evaluate(readViewportInPage).catch(() => null);
}

export function readViewportInPage() {
  const vh = window.innerHeight, vw = window.innerWidth;
  const inView = r => r.width > 0 && r.height > 0 && r.bottom > 60 && r.top < vh - 40 && r.right > 0 && r.left < vw;
  const BLOCK = 'p, li, h1, h2, h3, h4, h5, h6, blockquote, td, th, dd, dt, figcaption, summary';
  let words = 0;
  for (const el of document.querySelectorAll(BLOCK)) {
    if (el.querySelector(BLOCK)) continue;
    if (!inView(el.getBoundingClientRect())) continue;
    const t = (el.innerText || '').trim();
    if (t.length < 20) continue;
    words += t.split(/\s+/).length;
  }
  let media = 0;
  for (const m of document.querySelectorAll('img, picture, figure, video, iframe')) {
    if (inView(m.getBoundingClientRect())) media++;
  }
  let videoSec = 0;
  for (const v of document.querySelectorAll('video')) {
    if (!inView(v.getBoundingClientRect()) || v.paused) continue;
    const d = Number(v.duration);
    if (!Number.isFinite(d) || d <= 0 || d > 3600) continue;
    const watched = d * (0.25 + Math.random() * 0.35) - v.currentTime;
    if (watched > 3) videoSec = Math.max(videoSec, Math.min(Math.round(watched), 180));
  }
  const sh = document.documentElement.scrollHeight, y = window.scrollY;
  return {
    words: Math.min(words, 1200), media, videoSec, y, vh, vw,
    depth: sh > 0 ? Math.min(1, (y + vh) / sh) : 1,
  };
}

async function pickInternalLink(page, siteHost, visitedUrls) {
  return page.evaluate(({ host, visitedUrls, skipSrc }) => {
    const norm = s => s.replace(/[#?].*$/, '').replace(/\/+$/, '');
    const visited = new Set(visitedUrls.map(norm));
    const here = norm(location.origin + location.pathname);
    const skip = new RegExp(skipSrc, 'i');
    document.querySelectorAll('[data-omni-pick]').forEach(a => a.removeAttribute('data-omni-pick'));
    const cands = [];
    for (const a of document.querySelectorAll('a[href]')) {
      let u;
      try { u = new URL(a.href, location.href); } catch { continue; }
      if (!/^https?:$/.test(u.protocol)) continue;
      if (u.hostname.replace(/^www\./i, '').toLowerCase() !== host) continue;
      const clean = norm(u.origin + u.pathname);
      if (visited.has(clean) || clean === here) continue;
      if (skip.test(u.href) || a.closest('[hidden],[aria-hidden="true"]')) continue;
      const r = a.getBoundingClientRect();
      const st = getComputedStyle(a);
      if (r.width < 20 || r.height < 8 || st.visibility === 'hidden' || st.display === 'none') continue;
      const text = (a.innerText || a.title || '').trim().replace(/\s+/g, ' ');
      if (!text) continue;
      const inContent = !!a.closest('main, article, .content, #content, .entry-content, .post, section');
      const inChrome = !!a.closest('header, nav, footer, .menu, .navbar');
      cands.push({ a, href: u.href, text: text.slice(0, 80), w: inContent && !inChrome ? 3 : inChrome ? 1 : 2 });
    }
    if (!cands.length) return null;
    let pick = Math.random() * cands.reduce((s, c) => s + c.w, 0);
    const c = cands.find(x => (pick -= x.w) <= 0) || cands[cands.length - 1];
    c.a.setAttribute('data-omni-pick', '1');
    c.a.removeAttribute('target');
    return { href: c.href, text: c.text };
  }, { host: siteHost, visitedUrls, skipSrc: SKIP_HREF.source });
}

const hitTest = (page, tryClose = false) => page.evaluate(tryClose => {
  const a = document.querySelector('a[data-omni-pick="1"]');
  if (!a) return { ok: false, y: 0 };
  const r = a.getBoundingClientRect();
  const cx = r.x + r.width / 2, cy = r.y + r.height / 2;
  const inView = cy > 60 && cy < innerHeight * 0.82 && cx > 0 && cx < innerWidth;
  const top = inView ? document.elementFromPoint(cx, cy) : null;
  const ok = !!top && a.contains(top);
  let blocker = null;
  if (top && !ok) {
    for (let e = top; e && e !== document.body; e = e.parentElement) {
      const pos = getComputedStyle(e).position;
      if (pos === 'fixed' || pos === 'sticky') { blocker = e; break; }
    }
    if (blocker && tryClose) {
      const btn = blocker.querySelector('[class*="close" i], [id*="close" i], [aria-label*="close" i], [aria-label*="đóng" i], .btn-close');
      if (btn) btn.click(); else if (!blocker.contains(a)) blocker.style.setProperty('display', 'none', 'important');
    }
  }
  return { ok, y: Math.round(cy), vh: innerHeight, blocker: blocker ? `${blocker.tagName}.${blocker.className}`.slice(0, 60) : null };
}, tryClose);

async function clickPicked(page, tabs, log) {
  const el = page.locator('a[data-omni-pick="1"]').first();
  for (let i = 0; i < 5; i++) {
    const h = await hitTest(page, true);
    if (h.ok) break;
    if (h.blocker) {
      log(`  Liên kết bị che bởi ${h.blocker} — đóng/ẩn lớp che.`);
    } else if (i < 2 && h.vh) {
      await wheel(page, h.y - h.vh * 0.45);
    } else {
      await page.evaluate(() => document.querySelector('a[data-omni-pick="1"]')?.scrollIntoView({ block: 'center' }));
    }
    await sleep(rand(600, 1000));
  }
  let last = null;
  await pollUntil(async () => {
    const b = await el.boundingBox();
    const same = !!b && !!last && Math.abs(b.y - last.y) < 2 && Math.abs(b.x - last.x) < 2;
    last = b;
    return same;
  }, { timeout: 5000, interval: 300 }).catch(() => {});
  await sleep(rand(400, 1200));

  const before = await page.url();
  const tabsBefore = tabs ? (await tabs.list()).pages.map(t => t.targetId) : [];
  const myTab = tabs ? (await tabs.list()).pages.find(t => t.url === before)?.targetId : null;
  if ((await hitTest(page)).ok) {
    await clickLocator(page, el);
    await pollUntil(async () => (await page.url()) !== before, { timeout: 6000 }).catch(() => {});
    if ((await page.url()) === before) {
      await clickLocator(page, el);
      await pollUntil(async () => (await page.url()) !== before, { timeout: 5000 }).catch(() => {});
    }
    await closeStrayTabs(page, tabs, tabsBefore, myTab, log);
  }
  if ((await page.url()) === before) {
    log('  Bấm 2 lần không chuyển trang — bấm liên kết bằng JS.');
    await page.evaluate(() => document.querySelector('a[data-omni-pick="1"]')?.click());
  }
}

async function closeStrayTabs(page, tabs, tabsBefore, myTab, log) {
  if (!tabs) return;
  const stray = (await tabs.list()).pages.filter(t => !tabsBefore.includes(t.targetId));
  for (const t of stray) {
    log(`  ⚠ Đóng tab quảng cáo bật ra: ${hostOf(t.url) || t.url}`);
    await tabs.close(t.targetId).catch(() => {});
  }
  if (stray.length && myTab) await tabs.activate(myTab).catch(() => {});
}
