import fs from 'node:fs/promises';
import http from 'node:http';
import https from 'node:https';
import tls from 'node:tls';
import { ProxyPool } from './proxy-pool.mjs';

const IP_URL = 'https://api.ipify.org/?format=json';
const PING_URL = 'https://www.google.com/generate_204';
const SPEED_URL = 'https://speed.cloudflare.com/__down?bytes=1000000';
const STICKY_WAIT = 5;

const argv = process.argv.slice(2);
const has = name => argv.includes(`--${name}`);
const opt = (name, def) => {
  const hit = argv.find(a => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : def;
};

const COUNT = Math.max(1, Number(opt('count', 5)) || 5);
const TIMEOUT = Math.max(5, Number(opt('timeout', 30)) || 30) * 1000;
const PARALLEL = has('parallel');
const CHECK_GEO = opt('geo', '1') !== '0';

async function loadConfig(file) {
  const files = file ? [file] : ['data/campaign.json', 'config.json'];
  for (const f of files) {
    try {
      const raw = await fs.readFile(f, 'utf8');
      const json = JSON.parse(raw.replace(/^\uFEFF/, ''));
      const cfg = json.settings?.proxy || json.proxy;
      if (cfg && (cfg.host || cfg.mode === 'omni')) return { cfg, file: f };
    } catch {  }
  }
  return null;
}

function connectTunnel(px, host, port) {
  return new Promise((resolve, reject) => {
    if (!/^https?$/i.test(px.type)) {
      reject(new Error(`chỉ kiểm tra được proxy HTTP/HTTPS (đang cấu hình ${px.type})`));
      return;
    }
    const headers = {};
    if (px.user) headers['Proxy-Authorization'] = 'Basic ' + Buffer.from(`${px.user}:${px.pass}`).toString('base64');
    const req = http.request({ host: px.host, port: px.port, method: 'CONNECT', path: `${host}:${port}`, headers, timeout: TIMEOUT });
    req.on('connect', (res, socket) => {
      if (res.statusCode === 200) resolve(socket);
      else { socket.destroy(); reject(new Error(`proxy từ chối CONNECT (HTTP ${res.statusCode})`)); }
    });
    req.on('timeout', () => req.destroy(new Error(`quá ${TIMEOUT / 1000}s chưa nối được proxy`)));
    req.on('error', e => reject(e));
    req.end();
  });
}

function get(url, px = null) {
  const u = new URL(url);
  const port = Number(u.port) || 443;
  const t0 = Date.now();
  return new Promise((resolve, reject) => {
    const send = socket => {
      const opts = {
        host: u.hostname, port, path: u.pathname + u.search, method: 'GET',
        headers: { 'user-agent': 'omni-proxy-check/1.0', accept: '*/*' },
      };
      if (socket) opts.createConnection = () => tls.connect({ socket, servername: u.hostname });
      const req = https.request(opts, res => {
        const chunks = [];
        let bytes = 0;
        res.on('data', c => { chunks.push(c); bytes += c.length; });
        res.on('end', () => {
          if (socket) socket.destroy();
          resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8'), bytes, ms: Date.now() - t0 });
        });
      });
      req.setTimeout(TIMEOUT, () => req.destroy(new Error(`quá ${TIMEOUT / 1000}s không có phản hồi`)));
      req.on('error', e => { if (socket) socket.destroy(); reject(e); });
      req.end();
    };
    if (!px) { send(null); return; }
    connectTunnel(px, u.hostname, port).then(send, reject);
  });
}

async function geoOf(ip) {
  if (!CHECK_GEO) return '';
  try {
    const j = JSON.parse((await get(`https://ipinfo.io/${ip}/json`)).body);
    return [[j.city, j.country].filter(Boolean).join(', '), j.org].filter(Boolean).join(' · ');
  } catch { return '(không tra được vị trí)'; }
}

const inputToProxy = input => ({
  type: input.proxy_type || 'HTTP', host: input.host, port: Number(input.port),
  user: input.user_name || '', pass: input.password || '',
});

async function checkOne(pool) {
  const px = pool.next();
  const proxy = inputToProxy(px.input);
  const out = { label: px.label, session: px.session, ip: '', geo: '', pingMs: null, pingErr: '', sticky: null, speed: null, error: null };
  try {
    const ipRes = await get(IP_URL, proxy);
    out.ip = (JSON.parse(ipRes.body).ip || '').trim();
    if (!out.ip) throw new Error('proxy không trả về IP (kiểm tra host/port/username/mật khẩu)');
    const ping = await get(PING_URL, proxy).then(r => r.ms, e => { out.pingErr = e.message; return null; });
    out.pingMs = ping;
    const [geo, sticky, speed] = await Promise.all([
      geoOf(out.ip),
      has('sticky') ? (async () => {
        await new Promise(r => setTimeout(r, STICKY_WAIT * 1000));
        const again = (JSON.parse((await get(IP_URL, proxy)).body).ip || '').trim();
        return { ip: again, same: again === out.ip };
      })() : null,
      has('speed') ? (async () => {
        const r = await get(SPEED_URL, proxy);
        return { kbs: Math.round(r.bytes / 1024 / (r.ms / 1000)), bytes: r.bytes, ms: r.ms };
      })() : null,
    ]);
    out.geo = geo;
    out.sticky = sticky;
    out.speed = speed;
  } catch (e) {
    out.error = e.message;
  }
  return out;
}

function report(r) {
  const head = `• session ${r.session} · ${r.label}`;
  if (r.error) return `${head}\n    ✖ LỖI: ${r.error}`;
  const lines = [`${head}\n    IP: ${r.ip}${r.geo ? ` — ${r.geo}` : ''}`];
  if (r.pingMs != null) lines.push(`    Google /generate_204: ${r.pingMs} ms`);
  else if (r.pingErr) lines.push(`    Google /generate_204: ✖ ${r.pingErr}`);
  if (r.sticky) {
    lines.push(`    sticky sau ${STICKY_WAIT}s: ${r.sticky.same
      ? `OK — vẫn ${r.sticky.ip}`
      : `✖ ĐỔI IP (${r.sticky.ip}) — lượt chạy dài có thể bị đổi IP giữa chừng`}`);
  }
  if (r.speed) lines.push(`    tốc độ tải: ${r.speed.kbs} KB/s (${r.speed.bytes} byte trong ${(r.speed.ms / 1000).toFixed(1)}s)`);
  return lines.join('\n');
}

async function main() {
  const loaded = await loadConfig(opt('file', ''));
  if (!loaded) {
    console.error('✖ Không đọc được cấu hình proxy (data/campaign.json → settings.proxy, hoặc config.json → proxy).');
    process.exitCode = 1;
    return;
  }
  const pool = new ProxyPool('');
  pool.configure(loaded.cfg);
  const bad = pool.validate();
  if (bad) {
    console.error(`✖ Cấu hình proxy chưa đủ: ${bad}\n  (nguồn: ${loaded.file})`);
    process.exitCode = 1;
    return;
  }

  if (loaded.cfg.mode === 'omni') {
    console.log(`Chế độ "xoay theo profile OmniLogin": proxy do profile ${(loaded.cfg.profiles || []).join(', ') || '(chưa có profile)'} tự đổi IP trong app, không kiểm tra bằng proxy thô được.`);
    console.log(`Mở app OmniLogin và kiểm tra IP từng profile trực tiếp; engine chạy ${(loaded.cfg.profiles || []).length} luồng song song, mỗi luồng gắn 1 profile và tự chờ đủ ${loaded.cfg.rotateSec || 305} giây (IP xoay) trước lượt mới.`);
    process.exitCode = 0;
    return;
  }

  console.log(`Kiểm tra ${COUNT} session — proxy xoay ${loaded.cfg.host}:${loaded.cfg.port}, quốc gia "${loaded.cfg.country || ''}"${PARALLEL ? ', chạy song song' : ''} (nguồn: ${loaded.file}).`);
  if (!String(loaded.cfg.country || '').trim()) {
    console.log('⚠ Ô "Quốc gia" đang trống → nhà cung cấp trả IP ngẫu nhiên nhiều nước (thực tế đã gặp Kyrgyzstan/Thái Lan/Đài Loan),');
    console.log('  không khớp dấu vân tay vi-VN của app. Nên điền VN.');
  }
  console.log('');

  const results = [];
  if (PARALLEL) {
    const all = await Promise.all(Array.from({ length: COUNT }, () => checkOne(pool)));
    results.push(...all);
  } else {
    for (let i = 0; i < COUNT; i++) results.push(await checkOne(pool));
  }
  for (const r of results) console.log(report(r) + '\n');

  const ips = results.map(r => r.ip).filter(Boolean);
  const uniq = new Set(ips);
  const fails = results.filter(r => r.error);
  console.log(`Tổng kết: ${ips.length}/${COUNT} session đọc được IP · ${uniq.size} IP khác nhau`
    + `${uniq.size && uniq.size < ips.length ? ' (⚠ có IP trùng — session bị dùng lại)' : ''} · ${fails.length} lỗi`);
  if (ips.length) console.log(`IP đã gặp: ${[...uniq].join(', ')}`);
  process.exitCode = fails.length ? 1 : 0;
}

main().catch(e => { console.error(`✖ ${e.message}`); process.exitCode = 1; });
