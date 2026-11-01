import { solveGoogleSorryWithCapSolver } from './capsolver.mjs';
import { clickLocator, sleep } from './human.mjs';

const parse = url => { try { return new URL(url); } catch { return null; } };
const isSorry = u => !!u && (u.pathname.startsWith('/sorry')
  || u.hostname.startsWith('ipv4.google') || u.hostname.startsWith('ipv6.google'));

async function readSitekey(page) {
  return page.evaluate(() => {
    let sitekey = '';
    let dataS = '';

    const el = document.querySelector('.g-recaptcha, [data-sitekey]');
    if (el) {
      sitekey = el.getAttribute('data-sitekey') || '';
      dataS = el.getAttribute('data-s') || '';
    }

    if (!sitekey && window.___grecaptcha_cfg) {
      try {
        const clients = window.___grecaptcha_cfg.clients || {};
        for (const k in clients) {
          const c = clients[k];
          for (const kk in c) {
            const v = c[kk];
            if (v && typeof v === 'object' && v.sitekey) {
              sitekey = v.sitekey;
              break;
            }
          }
          if (sitekey) break;
        }
      } catch {}
    }

    if (!sitekey) {
      const m = document.documentElement.innerHTML.match(/data-sitekey=["']([^"']+)["']/);
      if (m) sitekey = m[1];
    }
    if (!dataS) {
      const m = document.documentElement.innerHTML.match(/data-s=["']([^"']+)["']/);
      if (m) dataS = m[1];
    }

    return { sitekey, dataS };
  });
}

export async function solveGoogleSorry(page, { apiKey, log = console.log, timeout = 120 }) {
  try {
    log('  🤖 CapSolver: đang đọc sitekey và data-s từ trang /sorry ...');

    let info = null;
    for (let i = 0; i < 6; i++) {
      info = await readSitekey(page);
      if (info && info.sitekey) break;
      log(`  Đọc lần ${i + 1}: chưa thấy sitekey, chờ 2s ...`);
      await new Promise(r => setTimeout(r, 2000));
    }

    if (!info || !info.sitekey) {
      log('  ⚠ Không tìm thấy sitekey trên trang /sorry (đã thử 3 cách, 6 lần).');
      try {
        const html = await page.content();
        const fs = await import('node:fs/promises');
        await fs.writeFile('C:\\CONG VIEC\\CLOUD CODE\\Omni\\sorry-debug.html', html, 'utf8');
        log('  📄 Đã lưu HTML để debug: sorry-debug.html');
      } catch (e) { log(`  Không dump được HTML: ${e.message}`); }
      return false;
    }

    const pageUrl = await page.url();
    const userAgent = await page.evaluate(() => navigator.userAgent).catch(() => '');
    log(`  sitekey: ${info.sitekey.slice(0, 30)}... | data-s: ${info.dataS ? 'có (' + info.dataS.length + ' ký tự)' : 'KHÔNG CÓ'}`);

    const token = await solveGoogleSorryWithCapSolver({
      apiKey,
      sitekey: info.sitekey,
      url: pageUrl,
      dataS: info.dataS,
      userAgent,
      log,
      timeout,
    });

    log('  Đang chèn token vào form /sorry ...');

    await page.evaluate((t) => {
      const ta = document.querySelector('#g-recaptcha-response, textarea[name="g-recaptcha-response"]');
      if (ta) {
        ta.value = t;
        ta.style.display = 'block';
      }
      window.__g_recaptcha_response = t;
      const el = document.querySelector('.g-recaptcha, [data-sitekey]');
      const cb = el && el.getAttribute('data-callback');
      if (cb && typeof window[cb] === 'function') {
        try { window[cb](t); } catch {}
      }
    }, token);

    let clicked = false;
    try {
      const submit = page.locator('button[type="submit"], input[type="submit"], #submit').first();
      if ((await submit.count()) && (await submit.isVisible())) {
        await clickLocator(page, submit);
        clicked = true;
      }
    } catch { clicked = false; }
    if (clicked) {
      await sleep(1500);
      clicked = !isSorry(parse(await page.url()));
    }
    if (!clicked) {
      await page.evaluate(() => {
        const btn = document.querySelector('button[type="submit"], input[type="submit"], #submit');
        if (btn) { btn.click(); return; }
        const form = document.querySelector('form');
        if (form) form.submit();
      });
    }

    const start = Date.now();
    while (Date.now() - start < 30000) {
      await new Promise(r => setTimeout(r, 1500));
      if (!isSorry(parse(await page.url()))) {
        log('  ✔ CapSolver đã giải xong /sorry.');
        return true;
      }
    }
    log('  ✖ CapSolver giải xong nhưng Google vẫn giữ /sorry.');
    return false;
  } catch (e) {
    log(`  CapSolver lỗi: ${e.message}`);
    return false;
  }
}