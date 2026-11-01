
const rand = (min, max) => min + Math.random() * (max - min);
const randInt = (min, max) => Math.floor(min + Math.random() * (max - min + 1));
const chance = p => Math.random() < p;
const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
export const sleep = ms => new Promise(r => setTimeout(r, ms));

const lastPos = new WeakMap();

const touchPages = new WeakSet();

export const markTouch = page => { if (page && typeof page === 'object') touchPages.add(page); };
export const isTouch = page => !!(page && typeof page === 'object' && touchPages.has(page));

function cdp(page, params) {
  const rpc = page && page.rpc;
  if (!rpc || typeof rpc.call !== 'function') return Promise.resolve(false);
  try { return rpc.call('cdp.send', params).then(() => true, () => false); } catch { return Promise.resolve(false); }
}

const touchPoint = (x, y) => ({
  x: Math.round(x),
  y: Math.round(y),
  radiusX: randInt(9, 15),
  radiusY: randInt(9, 15),
  rotationAngle: randInt(-12, 12),
  force: rand(0.75, 1),
  id: 0,
});
const viewport = async page => {
  const w = Number(await page.evaluate('window.innerWidth').catch(() => 0)) || 0;
  const h = Number(await page.evaluate('window.innerHeight').catch(() => 0)) || 0;
  return { w: w || 400, h: h || 750 };
};

export async function tap(page, x, y) {
  if (!(await cdp(page, { method: 'Input.dispatchTouchEvent', type: 'touchStart', touchPoints: [touchPoint(x, y)] }))) return false;
  await sleep(rand(45, 130));
  await cdp(page, { method: 'Input.dispatchTouchEvent', type: 'touchEnd', touchPoints: [] });
  return true;
}

export async function swipe(page, dy) {
  const dist = clamp(Math.abs(dy), 120, 1200);
  const { w, h } = await viewport(page);
  const x0 = rand(w * 0.25, w * 0.75);
  const start = dy > 0 ? h * rand(0.65, 0.82) : h * rand(0.2, 0.35);
  const sign = dy > 0 ? -1 : 1;
  const drift = rand(-w * 0.06, w * 0.06);
  if (!(await cdp(page, { method: 'Input.dispatchTouchEvent', type: 'touchStart', touchPoints: [touchPoint(x0, start)] }))) return false;
  const steps = clamp(Math.round(dist / 70), 6, 18);
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const y = start + sign * (dist * t) + rand(-6, 6);
    const x = x0 + drift * t + rand(-4, 4);
    await cdp(page, { method: 'Input.dispatchTouchEvent', type: 'touchMove', touchPoints: [touchPoint(x, y)] });
    const wait = t < 0.15 || t > 0.85 ? rand(22, 55) : rand(12, 34);
    await sleep(chance(0.08) ? wait + rand(40, 90) : wait);
  }
  await sleep(rand(60, 170));
  await cdp(page, { method: 'Input.dispatchTouchEvent', type: 'touchEnd', touchPoints: [] });
  return true;
}

export async function moveMouse(page, x, y) {
  x = Math.round(x);
  y = Math.round(y);
  const vp = await viewport(page).catch(() => ({ w: 1200, h: 700 }));
  const from = lastPos.get(page) || { x: rand(vp.w * 0.25, vp.w * 0.75), y: rand(vp.h * 0.2, vp.h * 0.6) };
  const dx = x - from.x;
  const dy = y - from.y;
  const dist = Math.hypot(dx, dy);
  if (dist < 2) {
    lastPos.set(page, { x, y });
    return;
  }
  const cx = (from.x + x) / 2 + rand(-0.22, 0.22) * dist + rand(-30, 30);
  const cy = (from.y + y) / 2 + rand(-0.22, 0.22) * dist + rand(-30, 30);
  const n = clamp(Math.round(dist / 26), 3, 26);
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    const e = t < 0.5 ? 2 * t * t : 1 - ((-2 * t + 2) ** 2) / 2;
    const px = ((1 - e) ** 2) * from.x + 2 * (1 - e) * e * cx + (e ** 2) * x + rand(-1.5, 1.5);
    const py = ((1 - e) ** 2) * from.y + 2 * (1 - e) * e * cy + (e ** 2) * y + rand(-1.5, 1.5);
    await page.mouse.move(Math.round(px), Math.round(py), { steps: i === 1 ? randInt(3, 8) : 1 });
    let wait = t < 0.12 || t > 0.88 ? rand(12, 34) : rand(6, 20);
    if (i > 1 && i < n && chance(0.06)) wait += rand(50, 140);
    await sleep(wait);
  }
  if (dist > 60 && chance(0.12)) {
    const ux = dx / dist;
    const uy = dy / dist;
    const over = rand(6, 26);
    await page.mouse.move(Math.round(x + ux * over + rand(-3, 3)), Math.round(y + uy * over + rand(-3, 3)), { steps: randInt(2, 4) });
    await sleep(rand(20, 60));
    await page.mouse.move(x + randInt(-1, 1), y + randInt(-1, 1), { steps: randInt(2, 4) });
    await sleep(rand(20, 50));
  }
  lastPos.set(page, { x, y });
}

async function clickAt(page, x, y) {
  const m = page.mouse;
  if (m && typeof m.down === 'function' && typeof m.up === 'function') {
    try {
      await m.down({ humanize: false });
      await sleep(rand(55, 145));
      await m.up({ humanize: false });
      return true;
    } catch {
      await m.up({ humanize: false }).catch(() => {});
    }
  }
  return m.click(x, y, { humanize: false });
}

export async function clickLocator(page, locator) {
  const b = await locator.boundingBox();
  if (!b || b.width <= 0 || b.height <= 0) return locator.click({ humanize: false });
  const x = Math.round(b.x + b.width * rand(0.32, 0.68));
  const y = Math.round(b.y + b.height * rand(0.35, 0.65));
  if (isTouch(page)) {
    await sleep(rand(120, 340));
    return tap(page, x + rand(-2, 2), y + rand(-2, 2));
  }
  await moveMouse(page, x, y);
  await sleep(rand(90, 300));
  await page.mouse.move(x + randInt(-2, 2), y + randInt(-2, 2), { steps: 2 }).catch(() => {});
  return clickAt(page, x, y);
}

export async function pressKey(page, key, { before = rand(180, 600) } = {}) {
  await sleep(before);
  try { await page.keyboard.press(key); return true; } catch { return false; }
}

const KEY_FOR = { ' ': 'Space', '\n': 'Enter', '\t': 'Tab' };
const NEIGHBOURS = {
  a: 's', b: 'v', c: 'v', d: 's', e: 'r', f: 'g', g: 'h', h: 'j', i: 'o', j: 'k', k: 'l', l: 'k',
  m: 'n', n: 'm', o: 'p', p: 'o', q: 'w', r: 't', s: 'd', t: 'y', u: 'i', v: 'b', w: 'e', x: 'z',
  y: 'u', z: 'x',
};

async function pressChar(page, ch) {
  const key = KEY_FOR[ch] || ch;
  try { await page.keyboard.press(key); return true; } catch {  }
  try { await page.keyboard.insertText(ch); return true; } catch { return false; }
}

export async function typeText(page, text, { typos = true, typoChance = 0.25 } = {}) {
  let typoDone = false;
  for (const ch of String(text ?? '')) {
    const wrong = typos && !typoDone && chance(typoChance) && NEIGHBOURS[ch.toLowerCase()];
    if (wrong) {
      typoDone = true;
      await sleep(rand(80, 200));
      await pressChar(page, NEIGHBOURS[ch.toLowerCase()]);
      await sleep(rand(120, 320));
      try { await page.keyboard.press('Backspace'); } catch {  }
      await sleep(rand(90, 220));
    }
    if (!(await pressChar(page, ch))) return false;
    let wait = rand(45, 130);
    if (ch === ' ') wait += rand(40, 120);
    else if ('.,;:!?-_/'.includes(ch)) wait += rand(20, 80);
    if (chance(0.05)) wait += rand(250, 700);
    await sleep(wait);
  }
  return true;
}

export async function wheel(page, dy) {
  const total = Math.round(Number(dy) || 0);
  if (!total) return false;
  if (isTouch(page)) return swipe(page, total);
  const sign = total > 0 ? 1 : -1;
  const notches = clamp(Math.round(Math.abs(total) / rand(90, 170)), 1, 12);
  let left = Math.abs(total);
  for (let i = 0; i < notches && left > 0; i++) {
    const each = left / (notches - i);
    const maxStep = Math.max(1, left - (notches - i - 1));
    const step = Math.min(maxStep, Math.max(1, Math.round(each * rand(0.7, 1.3))));
    await page.mouse.wheel(0, sign * step, { humanize: false }).catch(() => false);
    left -= step;
    if (left <= 0) break;
    await sleep(chance(0.15) ? rand(140, 380) : rand(22, 70));
  }
  if (left > 0) await page.mouse.wheel(0, sign * left, { humanize: false }).catch(() => false);
  return true;
}

export async function idleFidget(page, { w = 0, h = 0 } = {}) {
  if (!page) return false;
  if (isTouch(page)) {
    if (!chance(0.35)) return false;
    const dir = chance(0.5) ? 1 : -1;
    return swipe(page, dir * rand(90, 160));
  }
  const vp = w && h ? { w, h } : await viewport(page).catch(() => ({ w: 1200, h: 700 }));
  const from = lastPos.get(page) || { x: vp.w * 0.5, y: vp.h * 0.4 };
  for (let i = randInt(1, 3); i > 0; i--) {
    await moveMouse(page, clamp(from.x + rand(-70, 70), 20, vp.w - 20), clamp(from.y + rand(-50, 50), 60, vp.h * 0.8));
    await sleep(rand(220, 900));
  }
  if (chance(0.3)) await wheel(page, randInt(30, 90) * (chance(0.3) ? -1 : 1));
  return true;
}

