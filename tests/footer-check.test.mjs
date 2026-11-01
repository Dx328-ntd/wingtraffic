import http from 'node:http';
import zlib from 'node:zlib';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkFooterBadge, hasFooterBadge, isPrivateIp } from '../footer-check.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { if (cond) { pass++; console.log('  PASS ', name); } else { fail++; console.log('  FAIL ', name, extra); } };

const snippet = '<script async src="https://wingtraffic.tech/wt-badge.js"></script>';
const legacy = fs.readFileSync(path.join(ROOT, 'public', 'footer-wingtraffic.html'), 'utf8');
console.log('\n== nhận diện khối huy hiệu ==');
ok('mã 1 dòng <script src=".../wt-badge.js"> được nhận ra', hasFooterBadge(snippet));
ok('mã 1 dòng đổi nháy/thêm thuộc tính/tham số vẫn nhận ra', hasFooterBadge("<script src='http://x.io:3300/wt-badge.js?v=2' defer></script>") && hasFooterBadge('<SCRIPT async src=https://a.b/wt-badge.js></SCRIPT>'));
ok('khối HTML dài của bản trước vẫn nhận ra', hasFooterBadge(legacy));
ok('khối dài bị plugin nén (bỏ chú thích/xuống dòng/đổi nháy) vẫn nhận ra', hasFooterBadge(legacy.replace(/<!--[\s\S]*?-->/g, '').replace(/\s*\n\s*/g, ' ').replace(/id="wtb"/g, "id='wtb'")));
ok('script khác tên (analytics.js / wt-badge.json) -> không nhận', !hasFooterBadge('<script src="https://x.io/analytics.js"></script><script src="https://x.io/wt-badge.json"></script>'));
ok('trang không có mã -> không nhận', !hasFooterBadge('<html><body><footer>© site</footer></body></html>'));
ok('chỉ nhắc tên WingTraffic trong văn bản -> không nhận', !hasFooterBadge('<p>Cảm ơn WingTraffic</p>'));

console.log('\n== isPrivateIp ==');
for (const ip of ['127.0.0.1', '10.1.2.3', '192.168.1.5', '172.16.0.1', '172.31.255.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', 'fe80::1', 'fd00::1', '::ffff:127.0.0.1', '224.0.0.1']) ok(`${ip} là nội bộ`, isPrivateIp(ip));
for (const ip of ['8.8.8.8', '1.1.1.1', '172.32.0.1', '147.93.156.149', '2606:4700:4700::1111']) ok(`${ip} là công cộng`, !isPrivateIp(ip));

console.log('\n== tải thật (máy chủ thử nội bộ, allowPrivate) ==');
const gz = zlib.gzipSync(`<html><body>${snippet}</body></html>`);
const srv = http.createServer((q, r) => {
  const u = q.url;
  if (u === '/co') { r.writeHead(200, { 'Content-Type': 'text/html' }); return r.end(`<html><body><footer>${snippet}</footer></body></html>`); }
  if (u === '/khong') { r.writeHead(200, { 'Content-Type': 'text/html' }); return r.end('<html><body><footer>© không có mã</footer></body></html>'); }
  if (u === '/gzip') { r.writeHead(200, { 'Content-Type': 'text/html', 'Content-Encoding': 'gzip' }); return r.end(gz); }
  if (u === '/chuyen') { r.writeHead(302, { Location: '/co' }); return r.end(); }
  if (u === '/vong') { r.writeHead(302, { Location: '/vong' }); return r.end(); }
  if (u === '/404') { r.writeHead(404); return r.end('x'); }
  if (u === '/treo') return;
  r.writeHead(200); r.end('?');
});
await new Promise(res => srv.listen(3401, '127.0.0.1', res));
const B = 'http://127.0.0.1:3401';
const run = (p, o = {}) => checkFooterBadge(B + p, { allowPrivate: true, ...o });
let r = await run('/co'); ok('trang có mã -> ok', r.status === 'ok', JSON.stringify(r));
r = await run('/khong'); ok('trang không có mã -> missing (+ ghi chú)', r.status === 'missing' && /Không thấy/.test(r.note), JSON.stringify(r));
r = await run('/gzip'); ok('trang nén gzip có mã -> ok', r.status === 'ok', JSON.stringify(r));
r = await run('/chuyen'); ok('theo chuyển hướng 302 tới trang có mã -> ok', r.status === 'ok', JSON.stringify(r));
r = await run('/vong'); ok('chuyển hướng vòng lặp -> error (không treo)', r.status === 'error' && /chuyển hướng/.test(r.note), JSON.stringify(r));
r = await run('/404'); ok('HTTP 404 -> error (chưa kết luận)', r.status === 'error' && /404/.test(r.note), JSON.stringify(r));
const t0 = Date.now(); r = await run('/treo', { timeoutMs: 1200 }); ok('website treo -> error sau ~timeout', r.status === 'error' && /không phản hồi/.test(r.note) && Date.now() - t0 < 4000, JSON.stringify(r));
r = await checkFooterBadge('http://127.0.0.1:1/'); ok('cổng đóng (không cho phép nội bộ) -> error', r.status === 'error');
srv.close();

console.log('\n== chặn địa chỉ nội bộ (mặc định, như lúc chạy thật) ==');
for (const u of ['http://127.0.0.1:3300/', 'http://localhost/', 'http://169.254.169.254/latest/meta-data/', 'http://[::1]/', 'http://10.0.0.5/', 'http://192.168.1.1/admin', 'file:///c:/windows/win.ini', 'ftp://example.com/']) {
  const x = await checkFooterBadge(u, { timeoutMs: 3000 });
  ok(`chặn ${u}`, x.status === 'error' && !/Đã thấy/.test(x.note), JSON.stringify(x));
}
r = await checkFooterBadge('', {}); ok('URL rỗng -> error', r.status === 'error');
r = await checkFooterBadge('đây không phải url', {}); ok('URL sai -> error', r.status === 'error');

console.log(`\nKết quả: ${pass} PASS, ${fail} FAIL`);
process.exit(fail ? 1 : 0);
