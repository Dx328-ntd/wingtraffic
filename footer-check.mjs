import http from 'node:http';
import https from 'node:https';
import dns from 'node:dns';
import net from 'node:net';
import zlib from 'node:zlib';

export const FOOTER_CHECK_TIMEOUT_MS = 10000;
const MAX_BYTES = 2 * 1024 * 1024;
const MAX_REDIRECTS = 4;
const UA = 'Mozilla/5.0 (compatible; WingTrafficFooterCheck/1.0; +https://wingtraffic.tech)';

export function isPrivateIp(ip) {
  const v = net.isIP(ip);
  if (!v) return true;
  if (v === 4) {
    const [a, b] = ip.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19));
  }
  const s = ip.toLowerCase();
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(s);
  if (mapped) return isPrivateIp(mapped[1]);
  return s === '::' || s === '::1' || /^f[cd]/.test(s) || /^fe[89ab]/.test(s) || s.startsWith('ff');
}

export function hasFooterBadge(html) {
  const s = String(html || '');
  if (/<script\b[^>]*\bsrc\s*=\s*["']?[^"'\s>]*\/wt-badge\.js(?:[?#][^"'\s>]*)?["'\s>]/i.test(s)) return true;
  return /\bid\s*=\s*["']?wtb["'\s>]/i.test(s) && /wtb-btn/i.test(s);
}

function decode(buf, enc) {
  enc = String(enc || '').toLowerCase();
  try {
    if (enc.includes('gzip')) return zlib.gunzipSync(buf);
    if (enc.includes('br')) return zlib.brotliDecompressSync(buf);
    if (enc.includes('deflate')) return zlib.inflateSync(buf);
  } catch {  }
  return buf;
}

function getOnce(u, { allowPrivate, signal }) {
  return new Promise((resolve, reject) => {
    const lib = u.protocol === 'https:' ? https : http;
    const lookup = (host, opts, cb) => dns.lookup(host, { ...opts, all: true }, (err, addrs) => {
      if (err) return cb(err);
      const list = Array.isArray(addrs) ? addrs : [{ address: addrs, family: net.isIP(addrs) }];
      if (!allowPrivate && list.some(a => isPrivateIp(a.address))) return cb(new Error('địa chỉ nội bộ — không được kiểm tra'));
      if (opts && opts.all) return cb(null, list);
      cb(null, list[0].address, list[0].family);
    });
    const req = lib.request(u, { method: 'GET', lookup, signal, headers: { 'User-Agent': UA, Accept: 'text/html,*/*;q=0.5', 'Accept-Encoding': 'gzip, deflate', 'Accept-Language': 'vi,en;q=0.5' } }, res => {
      const chunks = []; let n = 0;
      res.on('data', c => { n += c.length; if (n > MAX_BYTES) { res.destroy(); chunks.push(c); resolve({ status: res.statusCode, headers: res.headers, body: decode(Buffer.concat(chunks), res.headers['content-encoding']), truncated: true }); return; } chunks.push(c); });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: decode(Buffer.concat(chunks), res.headers['content-encoding']) }));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.end();
  });
}

export async function checkFooterBadge(targetUrl, { allowPrivate = false, timeoutMs = FOOTER_CHECK_TIMEOUT_MS } = {}) {
  const checkedAt = new Date().toISOString();
  const done = (status, note) => ({ status, note, checkedAt });
  let u;
  try { u = new URL(/^https?:\/\//i.test(String(targetUrl || '').trim()) ? String(targetUrl).trim() : `https://${String(targetUrl || '').trim()}`); } catch { return done('error', 'URL đích không hợp lệ.'); }
  if (!/^https?:$/.test(u.protocol)) return done('error', 'Chỉ kiểm tra được địa chỉ http/https.');
  if (!allowPrivate && (net.isIP(u.hostname.replace(/^\[|\]$/g, '')) ? isPrivateIp(u.hostname.replace(/^\[|\]$/g, '')) : /^(localhost|.*\.local|.*\.internal)$/i.test(u.hostname))) {
    return done('error', 'Địa chỉ nội bộ — không kiểm tra được.');
  }
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const r = await getOnce(u, { allowPrivate, signal: ac.signal });
      if ([301, 302, 303, 307, 308].includes(r.status) && r.headers.location) {
        u = new URL(r.headers.location, u);
        if (!/^https?:$/.test(u.protocol)) return done('error', 'Trang chuyển hướng sang địa chỉ không hợp lệ.');
        continue;
      }
      if (r.status >= 400) return done('error', `Website trả về mã lỗi HTTP ${r.status} — chưa kiểm tra được.`);
      const html = r.body.toString('utf8');
      if (hasFooterBadge(html)) return done('ok', 'Đã thấy mã WingTraffic trong trang.');
      return done('missing', `Không thấy mã WingTraffic trong HTML của ${u.origin}${u.pathname}${r.truncated ? ' (trang quá lớn, chỉ đọc 2MB đầu)' : ''}. Nếu footer do plugin dựng bằng JavaScript thì có thể không nhận ra.`);
    }
    return done('error', 'Trang chuyển hướng quá nhiều lần.');
  } catch (e) {
    return done('error', ac.signal.aborted ? `Website không phản hồi sau ${Math.round(timeoutMs / 1000)} giây.` : `Không tải được website (${e.code || e.message}).`);
  } finally {
    clearTimeout(timer);
  }
}
