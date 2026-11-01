(function () {
  if (window.__wtBadge) return; window.__wtBadge = true;
  var me = document.currentScript || document.querySelector('script[src*="wt-badge.js"]'); if (!me) return;
  var logoUrl = new URL('logo-icon.png', me.src).href;

  var CSS = '.wtb{--wtb-blue:#4fa3f0;--wtb-navy:#132144;display:inline-flex;align-items:center;gap:7px;padding:4px 12px 4px 4px;border-radius:12px;background:var(--wtb-navy);color:#fff;font:13px/1.2 system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif;box-shadow:0 4px 14px rgba(19,33,68,.35);max-width:100%;text-align:left}' +
    '.wtb *,.wtb *::before,.wtb *::after{box-sizing:border-box}' +
    '.wtb-wrap{display:flex!important;justify-content:center;align-items:center;width:100%;margin:0;padding:0;border:0;background:none}' +
    '.wtb-btn{position:relative;width:38px;height:38px;flex:none;padding:0;border:0;border-radius:50%;background:transparent;cursor:pointer;-webkit-tap-highlight-color:transparent}' +
    '.wtb-btn:focus-visible{outline:3px solid #fff;outline-offset:2px}.wtb-btn:disabled{cursor:progress}' +
    '.wtb-logo{position:absolute;left:5px;top:5px;width:28px;height:28px;border-radius:50%;object-fit:cover;display:block;transition:transform .2s}' +
    '.wtb-btn:not(:disabled):hover .wtb-logo{transform:scale(1.08)}' +
    '.wtb-ring{position:absolute;inset:0;width:100%;height:100%;transform:rotate(-90deg)}.wtb-ring circle{fill:none;stroke-width:3}' +
    '.wtb-ring-bg{stroke:rgba(255,255,255,.18)}.wtb-ring-fg{stroke:var(--wtb-blue);stroke-linecap:round;stroke-dasharray:131.95;stroke-dashoffset:131.95;transition:stroke-dashoffset 1s linear}' +
    '.wtb-text{display:flex;flex-direction:column;min-width:0}.wtb-text b{font-size:13px;letter-spacing:-.01em}.wtb-text b span{color:var(--wtb-blue)}' +
    '.wtb-msg{display:none;color:#b9c6e4;font-size:10.5px;white-space:nowrap}.wtb.is-running .wtb-msg,.wtb.is-done .wtb-msg{display:block}' +
    '.wtb{width:auto!important;white-space:nowrap;margin:0;line-height:1.3}.wtb-text{flex:none}.wtb-text b{display:block;margin:0;padding:0;color:#fff;white-space:nowrap}.wtb-text b span{display:inline;margin:0;padding:0}' +
    '.wtb-msg .wtb-code{display:inline-block;margin-left:4px;padding:1px 8px;border-radius:6px;background:#fff;color:var(--wtb-navy);font:700 12px/1.4 Consolas,"Courier New",monospace;letter-spacing:.1em;user-select:all;cursor:copy}' +
    '.wtb.is-running .wtb-msg{color:var(--wtb-blue);font:700 13px/1.2 system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif;font-variant-numeric:tabular-nums}' +
    '.wtb.is-done .wtb-text b{display:none}.wtb.is-done .wtb-msg .wtb-code{margin:0}.wtb.is-done .wtb-ring-fg{stroke:#7be0a6}' +
    '.wtb-count{display:none!important}' +
    '.wtb{gap:7px!important;padding:4px 12px 4px 4px!important;margin:0!important;width:auto!important;min-width:0!important;height:auto!important;text-align:left!important}' +
    '.wtb .wtb-btn{display:block!important;position:relative!important;box-sizing:border-box!important;width:38px!important;min-width:38px!important;max-width:38px!important;height:38px!important;min-height:38px!important;margin:0!important;padding:0!important;border:0!important;border-radius:50%!important;background:transparent!important;box-shadow:none!important;line-height:0!important;float:none!important;flex:none!important}' +
    '.wtb .wtb-ring{position:absolute!important;inset:0!important;width:100%!important;height:100%!important;max-width:none!important;margin:0!important;padding:0!important}' +
    '.wtb .wtb-logo{position:absolute!important;inset:0!important;margin:auto!important;padding:0!important;width:28px!important;height:28px!important;min-width:0!important;max-width:none!important;max-height:none!important;border:0!important;border-radius:50%!important;box-shadow:none!important;float:none!important;object-fit:cover!important}' +
    '.wtb .wtb-text{display:flex!important;flex:none!important;flex-direction:column!important;align-items:flex-start!important;justify-content:center!important;margin:0!important;padding:0!important;width:auto!important;text-align:left!important}' +
    '.wtb .wtb-text b{margin:0!important;padding:0!important;font-size:13px!important;line-height:1.2!important;text-indent:0!important}.wtb.is-done .wtb-text b{display:none!important}' +
    '.wtb .wtb-msg{margin:0!important;padding:0!important;text-indent:0!important}' +
    '@media (prefers-reduced-motion:reduce){.wtb-ring-fg,.wtb-logo{transition:none}}@media (max-width:380px){.wtb-msg{font-size:10px}}';

  var HTML = '<div class="wtb" id="wtb" data-seconds="60">' +
    '<button type="button" class="wtb-btn" id="wtb-btn" aria-describedby="wtb-msg" title="Bấm vào logo để bắt đầu đếm ngược 60 giây">' +
    '<svg class="wtb-ring" viewBox="0 0 48 48" aria-hidden="true"><circle class="wtb-ring-bg" cx="24" cy="24" r="21"></circle><circle class="wtb-ring-fg" id="wtb-fg" cx="24" cy="24" r="21"></circle></svg>' +
    '<img class="wtb-logo" alt="WingTraffic" width="28" height="28" src="' + logoUrl + '"></button>' +
    '<div class="wtb-text"><b>Wing<span>Traffic</span></b><span class="wtb-msg" id="wtb-msg" role="status" aria-live="polite"></span></div>' +
    '<div class="wtb-count" id="wtb-count" aria-hidden="true">60</div></div>';

  function mount() {
    var st = document.createElement('style'); st.id = 'wtb-style'; st.textContent = CSS; (document.head || document.documentElement).appendChild(st);
    var box = document.createElement('div'); box.className = 'wtb-wrap'; box.innerHTML = HTML;
    var host = me.parentNode && me.parentNode !== document.head && me.parentNode !== document.documentElement ? me.parentNode : document.body;
    host.insertBefore(box, host === me.parentNode ? me : null);
    start();
  }

  function start() {
    var root = document.getElementById('wtb'); if (!root) return;
    var btn = document.getElementById('wtb-btn'), fg = document.getElementById('wtb-fg'), msg = document.getElementById('wtb-msg'), cnt = document.getElementById('wtb-count');
    var total = Math.max(1, parseInt(root.getAttribute('data-seconds'), 10) || 60), C = 131.95, timer = null, KEY = 'wtb_state_v1', KEEP_MS = 24 * 3600 * 1000;

    var mem = null;
    try { localStorage.removeItem(KEY); } catch (e) {}
    function load() { try { var s = JSON.parse(sessionStorage.getItem(KEY) || 'null'); return s && typeof s.end === 'number' && Date.now() - s.end < KEEP_MS ? s : null; } catch (e) { return mem && Date.now() - mem.end < KEEP_MS ? mem : null; } }
    function save(s) { mem = s; try { sessionStorage.setItem(KEY, JSON.stringify(s)); } catch (e) {} }

    var LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', DIGITS = '0123456789', ALL = LETTERS + DIGITS;
    function rnd(n) { var a = new Uint32Array(1), lim = Math.floor(4294967296 / n) * n; do { (window.crypto || window.msCrypto).getRandomValues(a); } while (a[0] >= lim); return a[0] % n; }
    function genCode() {
      var out = [LETTERS.charAt(rnd(26)), DIGITS.charAt(rnd(10))], i, j, t;
      for (i = 2; i < 8; i++) out.push(ALL.charAt(rnd(ALL.length)));
      for (i = out.length - 1; i > 0; i--) { j = rnd(i + 1); t = out[i]; out[i] = out[j]; out[j] = t; }
      return out.join('');
    }
    root.__genCode = genCode;

    function copy(text, el) { try { navigator.clipboard.writeText(text).then(function () { var o = el.title; el.title = 'Đã chép!'; setTimeout(function () { el.title = o; }, 1200); }, function () {}); } catch (e) {} }
    function esc(s) { return String(s).replace(/[^A-Z0-9]/g, ''); }
    function paint(left) { cnt.textContent = left; fg.style.strokeDashoffset = String(C * (1 - (total - left) / total)); }
    function showRunning(left) {
      root.classList.remove('is-done'); root.classList.add('is-running'); btn.disabled = true; btn.title = 'Đang đếm ngược';
      paint(left); msg.textContent = left + 's';
    }
    function showDone(code) {
      root.classList.remove('is-running'); root.classList.add('is-done'); btn.disabled = false; btn.title = 'Bấm để đếm lại';
      cnt.textContent = '✓'; fg.style.strokeDashoffset = '0';
      msg.innerHTML = '<span class="wtb-code" title="Bấm để chép mã">' + esc(code) + '</span>';
      msg.querySelector('.wtb-code').addEventListener('click', function () { copy(code, this); });
    }
    function tick(s) {
      var left = Math.ceil((s.end - Date.now()) / 1000);
      if (left <= 0) {
        clearInterval(timer); timer = null;
        var cur = load() || s; if (!cur.code) { cur.code = genCode(); save(cur); }
        return showDone(cur.code);
      }
      showRunning(left);
    }
    function run(s) {
      if (timer) return; fg.style.transition = 'none'; paint(total); void fg.getBoundingClientRect(); fg.style.transition = '';
      tick(s); if (!s.code && s.end > Date.now()) timer = setInterval(function () { tick(load() || s); }, 250);
    }
    btn.addEventListener('click', function () { if (timer) return; var s = { end: Date.now() + total * 1000, code: '' }; save(s); run(s); });
    root.style.cursor = 'pointer';
    root.addEventListener('click', function (e) { if (root.classList.contains('is-done') || (e.target.closest && e.target.closest('.wtb-btn'))) return; btn.click(); });

    var prev = load();
    if (prev) { if (prev.code) showDone(prev.code); else run(prev); }
  }

  if (me.parentNode && me.parentNode !== document.head || document.body) mount();
  else document.addEventListener('DOMContentLoaded', mount);
})();
