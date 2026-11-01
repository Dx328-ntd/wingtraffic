import fs from 'node:fs/promises';

const today = () => new Date().toLocaleDateString('sv-SE');
const KEEP_DAYS = 14;

export function omniNames(cfg) {
  return [...new Set((cfg?.profiles || []).map(s => String(s).trim()).filter(Boolean))];
}

export function pickRotateProfile(names, busy, lastUsed, rotateMs, now = Date.now()) {
  let best = null, bestAt = Infinity;
  for (const n of names) {
    if (busy.has(n)) continue;
    const at = lastUsed[n] || 0;
    if (now - at < rotateMs) continue;
    if (at < bestAt) { best = n; bestAt = at; }
  }
  return best;
}

export class ProxyPool {
  constructor(file) {
    this.file = file;
    this.cfg = null;
    this.data = { proxies: {}, hours: {} };
    this.dirty = false;
  }

  async load() {
    try { this.data = { proxies: {}, hours: {}, ...JSON.parse(await fs.readFile(this.file, 'utf8')) }; } catch {}
  }
  async save() {
    if (!this.dirty) return;
    this.dirty = false;
    const keep = new Date(Date.now() - KEEP_DAYS * 86400000).toLocaleDateString('sv-SE');
    for (const d of Object.keys(this.data.hours)) if (d < keep) delete this.data.hours[d];
    await fs.writeFile(this.file, JSON.stringify(this.data, null, 2), 'utf8').catch(() => {});
  }

  configure(proxyCfg) {
    this.cfg = proxyCfg;
  }

  validate() {
    const c = this.cfg;
    if (!c) return 'Chưa cấu hình proxy.';
    if (c.mode === 'omni') {
      const names = (c.profiles || []).map(s => String(s).trim()).filter(Boolean);
      return names.length ? null : 'Chưa nhập tên profile OmniLogin (chế độ xoay theo profile).';
    }
    return c.host && c.userBase && c.password ? null : 'Chưa cấu hình proxy xoay Webshare (host, username, mật khẩu).';
  }

  labelFor(c = this.cfg) {
    if (!c) return '';
    if (c.mode === 'omni') {
      const names = (c.profiles || []).map(s => String(s).trim()).filter(Boolean);
      return `omni-profile (${names.join(', ')})`;
    }
    return `${c.host}:${c.port} (xoay${c.country ? ' ' + c.country : ''})`;
  }

  next(slot = 1, profileName = null) {
    const c = this.cfg;
    if (c.mode === 'omni') {
      const names = (c.profiles || []).map(s => String(s).trim()).filter(Boolean);
      const name = profileName && names.includes(profileName) ? profileName : names[(Math.max(1, Number(slot) || 1) - 1) % Math.max(1, names.length)];
      return { label: `omni-${name}`, profileName: name, mode: 'omni' };
    }
    const session = Math.floor(Math.random() * 9e6) + 1e6;
    const parts = [c.userBase, c.country, session].filter(Boolean);
    return {
      label: this.labelFor(c),
      session,
      input: { name: `ws-${c.country || 'any'}-${session}`, proxy_type: c.type || 'HTTP', host: c.host, port: Number(c.port), user_name: parts.join('-'), password: c.password },
    };
  }

  report(label, r) {
    const p = (this.data.proxies[label] ||= { attempts: 0, captcha: 0, proxyFail: 0, ok: 0, lastUsed: null });
    p.attempts++;
    if (r.captcha) p.captcha++;
    if (r.proxyFail) p.proxyFail++;
    if (r.ok) p.ok++;
    p.lastUsed = new Date().toISOString();

    const d = (this.data.hours[today()] ||= {});
    const h = (d[new Date().getHours()] ||= { attempts: 0, captcha: 0, proxyFail: 0, ok: 0 });
    h.attempts++;
    if (r.captcha) h.captcha++;
    if (r.proxyFail) h.proxyFail++;
    if (r.ok) h.ok++;
    this.dirty = true;
    return null;
  }

  activeLabels() {
    const c = this.cfg || {};
    if (c.mode === 'omni') {
      return (c.profiles || []).map(s => String(s).trim()).filter(Boolean).map(n => `omni-${n}`);
    }
    return [this.labelFor(c)];
  }

  stats() {
    const active = new Set(this.activeLabels());
    const labels = new Set([...Object.keys(this.data.proxies), ...active]);
    const proxies = [...labels].map(label => {
      const s = this.data.proxies[label] || { attempts: 0, captcha: 0, proxyFail: 0, ok: 0, lastUsed: null };
      return { label, ...s, inUse: active.has(label), benchedLeft: 0 };
    }).sort((a, b) => b.inUse - a.inUse || b.attempts - a.attempts);
    return { proxies, hours: this.data.hours[today()] || {} };
  }
}
