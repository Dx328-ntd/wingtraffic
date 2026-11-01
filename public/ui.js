(function () {
  'use strict';
  var UI = {};

  UI.$ = function (id) { return document.getElementById(id); };
  UI.$$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };
  UI.esc = function (s) {
    return String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };
  UI.clock = function (sec) {
    sec = Math.max(0, Math.round(Number(sec) || 0));
    return Math.floor(sec / 60) + ':' + ('0' + (sec % 60)).slice(-2);
  };
  UI.dur = function (sec) {
    sec = Math.round(Number(sec) || 0);
    if (sec < 60) return sec + ' giây';
    if (sec < 3600) { var m = Math.floor(sec / 60), s = sec % 60; return m + ' phút' + (s ? ' ' + s + ' giây' : ''); }
    var h = Math.floor(sec / 3600), mm = Math.round((sec % 3600) / 60);
    return h + ' giờ' + (mm ? ' ' + mm + ' phút' : '');
  };
  UI.num = function (n) { return Number(n || 0).toLocaleString('vi-VN'); };
  UI.pct = function (n, d) { return d ? Math.round(n / d * 100) + '%' : '—'; };
  UI.ago = function (iso) {
    if (!iso) return '—';
    var m = Math.round((Date.now() - new Date(iso)) / 60000);
    return m < 1 ? 'vừa xong' : m < 60 ? m + ' phút trước' : m < 1440 ? Math.round(m / 60) + ' giờ trước' : Math.round(m / 1440) + ' ngày trước';
  };
  UI.when = function (iso) {
    if (!iso) return '—';
    var d = new Date(iso);
    if (isNaN(d)) return '—';
    var p = function (n) { return ('0' + n).slice(-2); };
    return p(d.getDate()) + '/' + p(d.getMonth() + 1) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  };
  UI.node = function (html) {
    var t = document.createElement('template');
    t.innerHTML = String(html).trim();
    return t.content.firstElementChild;
  };
  UI.ready = function (fn) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn);
    else fn();
  };
  UI.debounce = function (fn, ms) {
    var t;
    return function () {
      var a = arguments, self = this;
      clearTimeout(t);
      t = setTimeout(function () { fn.apply(self, a); }, ms || 250);
    };
  };

  UI.api = async function (path, body, opts) {
    opts = opts || {};
    var init = body === undefined
      ? { cache: 'no-store' }
      : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
    var res = await fetch(path, init);
    var data = await res.json().catch(function () { return {}; });
    if (res.status === 401 && opts.noRedirect !== true) {
      location.replace('/login?next=' + encodeURIComponent(location.pathname + location.search));
      throw new Error('Phiên đăng nhập đã hết hạn.');
    }
    if (!res.ok) throw new Error(data.error || ('HTTP ' + res.status));
    return data;
  };
  UI.withButton = async function (btn, fn) {
    if (btn) { btn.classList.add('loading'); btn.disabled = true; }
    try { return await fn(); }
    finally { if (btn) { btn.classList.remove('loading'); btn.disabled = false; } }
  };
  function toastBox() {
    var box = UI.$('wtToasts');
    if (!box) { box = UI.node('<div id="wtToasts" aria-live="polite" aria-atomic="true"></div>'); document.body.appendChild(box); }
    return box;
  }
  UI.toast = function (msg, kind, ms) {
    var box = toastBox();
    var el = UI.node('<div class="toast ' + (kind || 'info') + '"><div class="t"></div><button class="x" title="Đóng" aria-label="Đóng">✕</button></div>');
    el.querySelector('.t').innerHTML = msg;
    var close = function () { el.remove(); };
    el.querySelector('.x').addEventListener('click', close);
    box.appendChild(el);
    setTimeout(close, ms || (kind === 'err' ? 9000 : 4500));
    return el;
  };
  UI.ok = function (m) { return UI.toast(m, 'ok'); };
  UI.fail = function (m) { return UI.toast(m, 'err'); };

  UI.confirm = function (opts) {
    opts = opts || {};
    return new Promise(function (resolve) {
      var box = UI.node(
        '<div class="modal" role="dialog" aria-modal="true">' +
        '<div class="sheet"><header></header><div class="body"></div>' +
        '<footer><button class="btn" data-no>Huỷ</button><button class="btn primary" data-yes>Đồng ý</button></footer></div></div>');
      box.querySelector('header').textContent = opts.title || 'Xác nhận';
      box.querySelector('.body').innerHTML = opts.html || UI.esc(opts.text || '');
      var yes = box.querySelector('[data-yes]');
      yes.textContent = opts.okText || 'Đồng ý';
      if (opts.danger) { yes.classList.remove('primary'); yes.classList.add('danger'); }
      var done = function (v) { document.removeEventListener('keydown', onKey); box.remove(); resolve(v); };
      var onKey = function (e) { if (e.key === 'Escape') done(false); };
      box.querySelector('[data-no]').addEventListener('click', function () { done(false); });
      yes.addEventListener('click', function () { done(true); });
      box.addEventListener('click', function (e) { if (e.target === box) done(false); });
      document.addEventListener('keydown', onKey);
      document.body.appendChild(box);
      yes.focus();
    });
  };
  UI.prompt = function (opts) {
    opts = opts || {};
    return new Promise(function (resolve) {
      var box = UI.node(
        '<div class="modal" role="dialog" aria-modal="true">' +
        '<div class="sheet"><header></header><div class="body">' +
        '<label for="wtPromptIn"></label><input type="text" id="wtPromptIn" /></div>' +
        '<footer><button class="btn" data-no>Huỷ</button><button class="btn primary" data-yes>Đồng ý</button></footer></div></div>');
      box.querySelector('header').textContent = opts.title || 'Nhập thông tin';
      box.querySelector('label').textContent = opts.label || '';
      var input = box.querySelector('#wtPromptIn');
      input.value = opts.value || '';
      input.placeholder = opts.placeholder || '';
      var done = function (v) { document.removeEventListener('keydown', onKey); box.remove(); resolve(v); };
      var onKey = function (e) {
        if (e.key === 'Escape') done(null);
        if (e.key === 'Enter') done(input.value.trim());
      };
      box.querySelector('[data-no]').addEventListener('click', function () { done(null); });
      box.querySelector('[data-yes]').addEventListener('click', function () { done(input.value.trim()); });
      box.addEventListener('click', function (e) { if (e.target === box) done(null); });
      document.addEventListener('keydown', onKey);
      document.body.appendChild(box);
      input.focus();
      input.select();
    });
  };

  var THEME_KEY = 'wt-theme';
  UI.theme = function (next) {
    var cur = localStorage.getItem(THEME_KEY) || 'auto';
    if (next) { cur = next; localStorage.setItem(THEME_KEY, cur); }
    var html = document.documentElement;
    if (cur === 'auto') html.removeAttribute('data-theme');
    else html.setAttribute('data-theme', cur);
    var btn = UI.$('wtTheme');
    if (btn) {
      btn.textContent = cur === 'light' ? '☀️' : cur === 'dark' ? '🌙' : '🌗';
      btn.title = 'Chế độ hiển thị: ' + (cur === 'light' ? 'sáng' : cur === 'dark' ? 'tối' : 'theo hệ thống') + ' (bấm để đổi)';
    }
    return cur;
  };
  UI.theme();
  (function () {
    if (document.head && !document.querySelector('link[rel~="icon"]')) {
      var l = document.createElement('link');
      l.rel = 'icon'; l.type = 'image/png'; l.href = '/favicon.png';
      document.head.appendChild(l);
    }
  })();
  UI.themeButton = function () {
    var cur = UI.theme();
    UI.theme(cur === 'auto' ? 'light' : cur === 'light' ? 'dark' : 'auto');
  };

  var NAV_ALL = [
    { href: '/', label: 'Trang chủ' },
    { href: '/my', label: 'Chiến dịch của tôi' }
  ];
  var ROLE_LABEL = { admin: 'Quản trị viên', user: 'Người dùng' };
  var NO_KIT = { nav: [], side: function () { return ''; } };
  var KIT = null;
  function loadAdminKit() {
    if (KIT) return Promise.resolve(KIT);
    return new Promise(function (resolve) {
      var s = document.createElement('script');
      s.src = '/ui-admin.js';
      s.onload = function () { KIT = UI.adminKit || NO_KIT; resolve(KIT); };
      s.onerror = function () { KIT = NO_KIT; resolve(KIT); };
      document.head.appendChild(s);
    });
  }

  async function mountShell(cfg, main) {
    var user = null;
    try { user = (await UI.api('/api/me', undefined, { noRedirect: true })).user; } catch (e) { user = null; }
    if (!user) { location.replace('/login?next=' + encodeURIComponent(location.pathname + location.search)); return null; }
    var admin = user.role === 'admin';
    var kit = admin ? await loadAdminKit() : NO_KIT;
    function link(href, ic, label) {
      return '<a class="sn' + (href === cfg.active ? ' active' : '') + '" href="' + href + '"' + (href === cfg.active ? ' aria-current="page"' : '') + '><span class="ic">' + ic + '</span>' + label + '</a>';
    }
    var side = UI.node('<aside class="app-side" id="appSide" aria-label="Menu"></aside>');
    side.innerHTML =
      '<a class="sb-brand" href="' + (admin ? '/admin' : '/my') + '"><img class="lg-img" src="/logo-icon.png" alt="" width="30" height="30"><span>Wing<em class="wt-b">Traffic</em><small>' + (admin ? 'Quản trị' : 'Chiến dịch traffic') + '</small></span></a>' +
      (admin
        ? kit.side(link)
        : link('/my', '📊', 'Chiến dịch của tôi'));
    var back = UI.node('<div class="app-back" id="sideBack"></div>');
    var top = UI.node('<header class="app-top"><button class="tbtn" id="sideToggle" type="button" aria-label="Ẩn/hiện menu">☰</button><span class="sp"></span>' +
      '<button class="tbtn" id="wtTheme" type="button" aria-label="Đổi chế độ hiển thị" style="font-size:16px"></button>' +
      '<span class="uchip"><span class="av"></span><span class="who2"><span class="un"></span><small class="ur"></small></span></span>' +
      '<button class="out" id="btnLogout" type="button">Đăng xuất</button></header>');
    document.body.classList.add('has-shell');
    document.body.insertBefore(top, document.body.firstChild);
    document.body.insertBefore(back, top);
    document.body.insertBefore(side, back);
    if (main) { main.classList.add('app-content'); if (!main.id) main.id = 'main'; }
    top.querySelector('.av').textContent = String(user.username || '?').charAt(0);
    top.querySelector('.un').textContent = user.username;
    top.querySelector('.ur').textContent = ROLE_LABEL[user.role] || user.role;
    var key = 'wt-side';
    try { if (localStorage.getItem(key) === 'hide') document.body.classList.add('side-hide'); } catch (e) {}
    UI.$('sideToggle').addEventListener('click', function () {
      if (window.matchMedia('(max-width: 900px)').matches) { document.body.classList.toggle('side-open'); return; }
      var hide = document.body.classList.toggle('side-hide');
      try { localStorage.setItem(key, hide ? 'hide' : 'show'); } catch (e) {}
    });
    back.addEventListener('click', function () { document.body.classList.remove('side-open'); });
    UI.$('wtTheme').addEventListener('click', function () { UI.themeButton(); });
    UI.theme();
    UI.$('btnLogout').addEventListener('click', async function () {
      if (!(await UI.confirm({ title: 'Đăng xuất', text: 'Thoát khỏi tài khoản ' + user.username + '?', okText: 'Đăng xuất', danger: true }))) return;
      try { await UI.api('/api/logout', {}); } catch (e) {}
      location.replace('/login');
    });
    if (main) {
      var tt = String(cfg.title || '').replace(/<[^>]*>/g, '');
      var crumbs = UI.node('<div class="crumbs"><a href="' + (admin ? '/admin' : '/my') + '">Trang chủ</a> / <span></span></div>');
      crumbs.querySelector('span').textContent = tt;
      main.insertBefore(crumbs, main.firstChild);
      if (cfg.title) {
        var head = UI.node('<div class="page-head"><div><h1 class="view-title"></h1><p class="sub"></p></div><div class="head-actions"></div></div>');
        head.querySelector('h1').innerHTML = cfg.title;
        if (cfg.sub) head.querySelector('.sub').innerHTML = cfg.sub; else head.querySelector('.sub').remove();
        if (cfg.actions) head.querySelector('.head-actions').innerHTML = cfg.actions;
        main.insertBefore(head, crumbs.nextSibling);
      }
    }
    if (document.readyState !== 'loading') UI.toastReady = true;
    return user;
  }
  UI.mount = async function (cfg) {
    cfg = cfg || {};
    var main = document.querySelector('main.main');
    if (main && cfg.narrow) main.classList.add('narrow');
    if (cfg.shell) return mountShell(cfg, main);
    var bar = UI.node(
      '<header class="topbar"><div class="topbar-in">' +
      '<a class="brand" href="/"><img class="logo-img" src="/logo-icon.png" alt="" width="28" height="28"><span>Wing<em class="wt-b">Traffic</em><small>Chiến dịch Google Search</small></span></a>' +
      '<nav class="nav" id="wtNav" aria-label="Điều hướng chính"></nav>' +
      '<div class="topbar-side">' +
      '<button class="btn sm icon" id="wtTheme" type="button" aria-label="Đổi chế độ hiển thị"></button>' +
      '<span class="userchip" id="wtUser" hidden><span class="av"></span><span><span class="who"></span><span class="role"></span></span></span>' +
      '<button class="btn sm" id="wtLogout" type="button" hidden>Đăng xuất</button>' +
      '</div></div></header>');
    document.body.insertBefore(bar, document.body.firstChild);
    if (document.querySelector('.skip-link') === null) {
      document.body.insertBefore(UI.node('<a class="skip-link" href="#main">Tới nội dung chính</a>'), bar);
    }
    if (main && !main.id) main.id = 'main';
    UI.$('wtTheme').addEventListener('click', function () { UI.themeButton(); });

    var user = null;
    if (!cfg.public) {
      try { user = (await UI.api('/api/me', undefined, { noRedirect: true })).user; } catch (e) { user = null; }
      if (!user) { location.replace('/login?next=' + encodeURIComponent(location.pathname + location.search)); return null; }
    }

    var nav = UI.$('wtNav');
    var adminNav = user && user.role === 'admin' ? (await loadAdminKit()).nav : [];
    var items = NAV_ALL.concat(adminNav, cfg.extraNav || []);
    items.filter(function (i) { return !i.admin || (user && user.role === 'admin'); })
      .forEach(function (i) {
        var a = UI.node('<a></a>');
        a.href = i.href;
        a.textContent = i.label;
        if (i.href === cfg.active) { a.classList.add('active'); a.setAttribute('aria-current', 'page'); }
        nav.appendChild(a);
      });
    UI.setBadge = function (href, n) {
      var box = UI.$('wtNav');
      if (!box) return;
      var a = box.querySelector('a[href="' + href + '"]');
      if (!a) return;
      var b = a.querySelector('.badge-n');
      var num = Number(n);
      if (!num) { if (b) b.remove(); return; }
      if (!b) { b = UI.node('<span class="badge-n"></span>'); a.appendChild(b); }
      b.textContent = num;
    };
    if (user) {
      var chip = UI.$('wtUser');
      chip.hidden = false;
      chip.querySelector('.av').textContent = String(user.username || '?').charAt(0);
      chip.querySelector('.who').textContent = user.username;
      chip.querySelector('.role').textContent = ' · ' + (ROLE_LABEL[user.role] || user.role);
      chip.title = user.username + ' — ' + (ROLE_LABEL[user.role] || user.role);
      var out = UI.$('wtLogout');
      out.hidden = false;
      out.addEventListener('click', async function () {
        if (!(await UI.confirm({ title: 'Đăng xuất', text: 'Thoát khỏi tài khoản ' + user.username + '?', okText: 'Đăng xuất', danger: true }))) return;
        try { await UI.api('/api/logout', {}); } catch (e) {}
        location.replace('/login');
      });
    }

    if (cfg.title && main) {
      var head = UI.node('<div class="page-head"><div><h1></h1><p class="sub"></p></div><div class="head-actions"></div></div>');
      head.querySelector('h1').innerHTML = cfg.title;
      if (cfg.sub) head.querySelector('.sub').innerHTML = cfg.sub; else head.querySelector('.sub').remove();
      if (cfg.actions) head.querySelector('.head-actions').innerHTML = cfg.actions;
      main.insertBefore(head, main.firstChild);
    }
    if (cfg.footer !== false) {
      document.body.appendChild(UI.node('<footer class="footer">WingTraffic — tự động hóa traffic Google Search · <a href="/my">Chiến dịch của tôi</a> · <a href="/">Trang chủ</a></footer>'));
    }
    if (document.readyState !== 'loading') UI.toastReady = true;
    return user;
  };

  UI.setSideBadge = function (id, n) {
    var b = UI.$(id);
    if (!b) return;
    var v = Number(n) || 0;
    b.hidden = !v;
    b.textContent = v > 99 ? '99+' : String(v);
  };
  UI.shell = function (cfg) {
    cfg = cfg || {};
    var views = cfg.views || {};
    var key = cfg.storageKey || 'wt-side';
    var cur = '';
    try { if (localStorage.getItem(key) === 'hide') document.body.classList.add('side-hide'); } catch (e) {}

    function show(name, arg) {
      if (!views[name]) { name = cfg.def || Object.keys(views)[0]; arg = ''; }
      cur = name;
      UI.$$('.view').forEach(function (v) { v.hidden = v.dataset.view !== name; });
      UI.$$('[data-nav]').forEach(function (a) { a.classList.toggle('active', a.dataset.nav === (views[name].nav || name)); });
      UI.$$('.sn-group').forEach(function (g) {
        if (g.dataset.group === views[name].group) g.classList.add('open');
        else if (g.dataset.keep !== '1') g.classList.remove('open');
      });
      var crumb = UI.$('crumbTitle');
      if (crumb) crumb.textContent = views[name].title;
      document.body.classList.remove('side-open');
      window.scrollTo(0, 0);
      if (cfg.onView) cfg.onView(name, arg || '');
    }
    function route() {
      var h = location.hash.replace(/^#/, '');
      var i = h.indexOf('/');
      var base = i < 0 ? h : h.slice(0, i);
      var arg = '';
      if (i >= 0) { try { arg = decodeURIComponent(h.slice(i + 1)); } catch (e) { arg = h.slice(i + 1); } }
      show((cfg.alias && cfg.alias[base]) || base, arg);
    }

    UI.$('sideToggle').addEventListener('click', function () {
      if (window.matchMedia('(max-width: 900px)').matches) { document.body.classList.toggle('side-open'); return; }
      var hide = document.body.classList.toggle('side-hide');
      try { localStorage.setItem(key, hide ? 'hide' : 'show'); } catch (e) {}
    });
    UI.$('sideBack').addEventListener('click', function () { document.body.classList.remove('side-open'); });
    UI.$$('[data-toggle]').forEach(function (b) {
      b.addEventListener('click', function () { var g = b.parentElement; g.dataset.keep = '1'; g.classList.toggle('open'); });
    });
    UI.$('wtTheme').addEventListener('click', function () { UI.themeButton(); });
    UI.theme();
    UI.$('btnLogout').addEventListener('click', async function () {
      if (!(await UI.confirm({ title: 'Đăng xuất', text: 'Thoát khỏi tài khoản này?', okText: 'Đăng xuất', danger: true }))) return;
      try { await UI.api('/api/logout', {}); } catch (e) {}
      location.replace('/login');
    });
    window.addEventListener('hashchange', route);
    route();
    return { show: show, current: function () { return cur; } };
  };

  UI.shortcuts = function (onSave) {
    document.addEventListener('keydown', function (e) {
      if (!(e.ctrlKey || e.metaKey)) return;
      var k = (e.key || '').toLowerCase();
      if (k === 's') { e.preventDefault(); onSave(false); }
      if (k === 'enter') { e.preventDefault(); onSave(true); }
    });
  };

  UI.tabs = function (scope, key) {
    scope = typeof scope === 'string' ? document.querySelector(scope) : scope;
    if (!scope) return;
    var buttons = UI.$$('[data-tab]', scope);
    var panels = UI.$$('[data-panel]', scope);
    if (!buttons.length || !panels.length) return;
    var show = function (name, remember) {
      var found = false;
      buttons.forEach(function (b) {
        var on = b.dataset.tab === name;
        b.setAttribute('aria-selected', on ? 'true' : 'false');
        b.tabIndex = on ? 0 : -1;
        if (on) found = true;
      });
      if (!found) return false;
      panels.forEach(function (p) { p.hidden = p.dataset.panel !== name; });
      if (remember && key) { try { localStorage.setItem('wt-tab-' + key, name); } catch (e) {} }
      return true;
    };
    buttons.forEach(function (b, i) {
      b.setAttribute('role', 'tab');
      b.addEventListener('click', function () { show(b.dataset.tab, true); });
      b.addEventListener('keydown', function (e) {
        if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
        var next = buttons[(i + (e.key === 'ArrowRight' ? 1 : buttons.length - 1)) % buttons.length];
        next.focus(); show(next.dataset.tab, true);
      });
    });
    var wanted = location.hash.replace(/^#/, '') || (key ? localStorage.getItem('wt-tab-' + key) : '') || buttons[0].dataset.tab;
    if (!show(wanted, false)) show(buttons[0].dataset.tab, false);
    window.addEventListener('hashchange', function () { show(location.hash.replace(/^#/, ''), false); });
  };

  UI.filterTable = function (input, table) {
    input = typeof input === 'string' ? document.querySelector(input) : input;
    table = typeof table === 'string' ? document.querySelector(table) : table;
    if (!input || !table) return;
    input.addEventListener('input', UI.debounce(function () {
      var q = input.value.trim().toLowerCase();
      var rows = UI.$$('tbody tr', table);
      var shown = 0;
      rows.forEach(function (tr) {
        var hit = !q || tr.textContent.toLowerCase().indexOf(q) >= 0;
        tr.hidden = !hit;
        if (hit) shown++;
      });
      var em = table.querySelector('tbody .empty');
      if (em) em.parentNode.hidden = shown > 0;
    }, 150));
  };
  UI.sortTable = function (table) {
    table = typeof table === 'string' ? document.querySelector(table) : table;
    if (!table) return;
    UI.$$('thead th', table).forEach(function (th, idx) {
      if (th.dataset.nosort !== undefined) return;
      th.style.cursor = 'pointer';
      th.title = 'Bấm để sắp xếp';
      th.addEventListener('click', function () {
        var dir = th.dataset.dir === 'asc' ? -1 : 1;
        UI.$$('thead th', table).forEach(function (o) { delete o.dataset.dir; });
        th.dataset.dir = dir === 1 ? 'asc' : 'desc';
        var body = table.querySelector('tbody');
        var rows = UI.$$('tr', body).filter(function (r) { return !r.querySelector('.empty'); });
        var val = function (tr) {
          var c = tr.children[idx];
          if (!c) return '';
          var raw = (c.dataset.sort || c.textContent || '').trim();
          var n = raw.replace(/\./g, '').replace(/,/g, '.').replace(/[^\d.\-]/g, '');
          return n && !isNaN(Number(n)) ? Number(n) : raw.toLowerCase();
        };
        rows.sort(function (a, b) {
          var x = val(a), y = val(b);
          return (x > y ? 1 : x < y ? -1 : 0) * dir;
        });
        rows.forEach(function (r) { body.appendChild(r); });
      });
    });
  };

  UI.guard = function (opts) {
    opts = opts || {};
    var form = typeof opts.form === 'string' ? document.querySelector(opts.form) : opts.form;
    var bar = typeof opts.bar === 'string' ? document.querySelector(opts.bar) : opts.bar;
    var label = typeof opts.label === 'string' ? document.querySelector(opts.label) : opts.label;
    var isDirty = false;
    var set = function (v) {
      isDirty = v;
      if (bar) bar.classList.toggle('show', v);
      if (label && v) label.textContent = 'Có thay đổi chưa lưu.';
    };
    if (form) {
      form.addEventListener('input', function () { set(true); });
      form.addEventListener('change', function () { set(true); });
    }
    window.addEventListener('beforeunload', function (e) {
      if (!isDirty) return;
      e.preventDefault();
      e.returnValue = '';
      return '';
    });
    return { dirty: function () { return isDirty; }, markSaved: function () { set(false); }, markClean: function () { set(false); } };
  };

  UI.copy = function (text, label) {
    var done = function () { UI.ok('Đã copy ' + (label || '') + 'vào clipboard.'); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, function () { UI.fail('Trình duyệt chặn copy tự động.'); });
    } else {
      var ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); done(); } catch (e) { UI.fail('Không copy được.'); }
      ta.remove();
    }
  };
  UI.bindCopyButtons = function (root) {
    UI.$$('[data-copy]', root || document).forEach(function (b) {
      b.addEventListener('click', function () {
        var src = document.querySelector(b.dataset.copy);
        if (!src) return;
        var text = (src.tagName === 'INPUT' || src.tagName === 'TEXTAREA' || src.tagName === 'SELECT') ? src.value : src.textContent;
        UI.copy(text, b.dataset.copyLabel);
      });
    });
  };

  window.WingTrafficUI = UI;
})();
