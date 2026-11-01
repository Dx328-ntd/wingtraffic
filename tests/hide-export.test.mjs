import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import zlib from 'node:zlib';

const dir = mkdtempSync(join(tmpdir(), 'omni-hide-'));
process.env.OMNI_DATA_DIR = dir;
process.env.JWT_SECRET = 'test-secret-for-hide-0123456789abcdef';
const { users, campaigns, runs, wallet } = await import('../database/repo.mjs');
const { handleApi } = await import('../api.mjs');
const xlsx = await import('../xlsx.mjs');
const { buildCampaignReport } = await import('../export-report.mjs');

let pass = 0, fail = 0;
const ok = (n, c, x = '') => { if (c) { pass++; console.log(`  PASS  ${n}`); } else { fail++; console.log(`  FAIL  ${n} ${x}`); } };

function readZip(buf) {
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const total = buf.readUInt16LE(eocd + 10), cdOff = buf.readUInt32LE(eocd + 16);
  const out = {}; let p = cdOff;
  for (let i = 0; i < total; i++) {
    const nlen = buf.readUInt16LE(p + 28), elen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32);
    const crc = buf.readUInt32LE(p + 16), csize = buf.readUInt32LE(p + 20), usize = buf.readUInt32LE(p + 24), lo = buf.readUInt32LE(p + 42);
    const name = buf.slice(p + 46, p + 46 + nlen).toString('utf8');
    const ln = buf.readUInt16LE(lo + 26), le = buf.readUInt16LE(lo + 28);
    const data = zlib.inflateRawSync(buf.slice(lo + 30 + ln + le, lo + 30 + ln + le + csize));
    out[name] = { text: data.toString('utf8'), crcOk: xlsx.crc32(data) === crc, sizeOk: data.length === usize };
    p += 46 + nlen + elen + clen;
  }
  return out;
}
function balanced(xml) {
  const stack = [];
  for (const m of xml.matchAll(/<(\/?)([A-Za-z_][\w:.-]*)([^>]*?)(\/?)>/g)) {
    if (m[2] === 'xml') continue;
    if (m[4]) continue;
    if (m[1]) { if (stack.pop() !== m[2]) return false; } else stack.push(m[2]);
  }
  return stack.length === 0;
}

console.log('\n== thư viện xlsx ==');
const mini = xlsx.buildXlsx([{ name: 'A/B:C*?[x]', rows: [[xlsx.H('Tiêu đề & <đặc biệt>'), xlsx.H('Số')], ['Chữ "dấu" Tiếng Việt', xlsx.I(1234)], [xlsx.DT('2026-10-10'), xlsx.D(12.5)]], widths: [20, 10], freezeRows: 1, filter: { row: 1 } }, { name: 'A/B:C*?[x]', rows: [['trùng tên']] }]);
const z = readZip(mini);
ok('là file ZIP hợp lệ (đủ các phần của .xlsx)', ['[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml', 'xl/_rels/workbook.xml.rels', 'xl/styles.xml', 'xl/worksheets/sheet1.xml', 'xl/worksheets/sheet2.xml'].every(n => z[n]));
ok('CRC và kích thước từng phần khớp với tiêu đề ZIP', Object.values(z).every(e => e.crcOk && e.sizeOk));
ok('mọi phần XML đều cân bằng thẻ', Object.entries(z).every(([n, e]) => balanced(e.text)), JSON.stringify(Object.entries(z).filter(([, e]) => !balanced(e.text)).map(([n]) => n)));
ok('tên sheet được làm sạch (bỏ / : * ? [ ]) và không trùng nhau', /name="A B C x"/.test(z['xl/workbook.xml'].text) && /name="A B C x 2"/.test(z['xl/workbook.xml'].text));
ok('ký tự đặc biệt được mã hoá XML, giữ nguyên tiếng Việt', z['xl/worksheets/sheet1.xml'].text.includes('Tiêu đề &amp; &lt;đặc biệt&gt;') && z['xl/worksheets/sheet1.xml'].text.includes('Chữ &quot;dấu&quot; Tiếng Việt'));
ok('ngày 2026-10-10 -> số ngày Excel 46305, số nguyên/thập phân đúng', /<c r="A3" s="5"><v>46305<\/v>/.test(z['xl/worksheets/sheet1.xml'].text) && /<v>1234<\/v>/.test(z['xl/worksheets/sheet1.xml'].text) && /<v>12.5<\/v>/.test(z['xl/worksheets/sheet1.xml'].text));
ok('cố định hàng tiêu đề + bộ lọc', /ySplit="1"/.test(z['xl/worksheets/sheet1.xml'].text) && /<autoFilter ref="A1:B3"\/>/.test(z['xl/worksheets/sheet1.xml'].text));
ok('cột Excel: A, Z, AA, AB', xlsx.colName(0) === 'A' && xlsx.colName(25) === 'Z' && xlsx.colName(26) === 'AA' && xlsx.colName(27) === 'AB');

console.log('\n== báo cáo Excel (hàm thuần) ==');
const rep = buildCampaignReport({
  user: { username: 'khach1', displayName: 'Khách Một', createdAt: '2026-10-01 09:00:00' },
  campaigns: [
    { id: 5, keyword: 'giày & dép', targetUrl: 'https://a.example/', typeLabel: 'Search Traffic', count: 10, unit: 'day', perDay: 10, status: 'running', approval: 'approved', hidden: false, createdAt: '2026-10-01 10:00:00' },
    { id: 6, keyword: 'đã ẩn', targetUrl: 'https://b.example/', typeLabel: 'Direct Traffic', count: 2, unit: 'hour', perDay: 48, status: 'stopped', approval: 'approved', hidden: true, createdAt: '2026-10-02 10:00:00' },
  ],
  daily: [
    { campaignId: 5, day: '2026-10-02', attempts: 10, ok: 8, notfound: 1, captcha: 0, error: 1, spent: 12000 },
    { campaignId: 6, day: '2026-10-02', attempts: 4, ok: 4, notfound: 0, captcha: 0, error: 0, spent: 4000 },
    { campaignId: 5, day: '2026-10-04', attempts: 20, ok: 15, notfound: 3, captcha: 1, error: 1, spent: 22500 },
  ],
  today: '2026-10-05', exportedAt: '2026-10-05 08:00:00',
});
const rz = readZip(rep);
const s1 = rz['xl/worksheets/sheet1.xml'].text, s2 = rz['xl/worksheets/sheet2.xml'].text, s3 = rz['xl/worksheets/sheet3.xml'].text;
ok('có 3 sheet: Tổng hợp / Theo ngày / Ma trận ngày, XML cân bằng', /name="Tổng hợp"/.test(rz['xl/workbook.xml'].text) && /name="Theo ngày"/.test(rz['xl/workbook.xml'].text) && /name="Ma trận ngày"/.test(rz['xl/workbook.xml'].text) && [s1, s2, s3].every(balanced));
ok('Tổng hợp: có tài khoản, ngày tạo, cả chiến dịch đã ẩn (cột "Đã ẩn" = Có)', s1.includes('khach1 (Khách Một)') && s1.includes('giày &amp; dép') && s1.includes('đã ẩn') && s1.includes('>Có<'));
ok('Tổng hợp: dòng TỔNG có Lượng Traffic 27 và chi phí 38.500', /<c r="K\d+" s="7"><v>27<\/v>/.test(s1) && /<c r="L\d+" s="7"><v>38500<\/v>/.test(s1) && s1.includes('TỔNG'));
ok('chỉ còn cột "Lượng Traffic" + "Chi phí" (đã bỏ Tổng lượt chạy / Không thấy URL / Captcha / Lỗi / Tỷ lệ thành công / "Thành công")',
  [s1, s2, s3].every(x => !/Tổng lượt chạy|Không thấy URL|Captcha|Tỷ lệ thành công|>Lỗi<|>Thành công</.test(x)) && [s1, s2].every(x => x.includes('Lượng Traffic') && x.includes('Chi phí (đ)')) && !/<c r="M\d+"/.test(s1) && !/<c r="H\d+"/.test(s2));
ok('Theo ngày: đúng 3 dòng dữ liệu (ngày × chiến dịch) + 1 dòng tiêu đề', (s2.match(/<row /g) || []).length === 4);
ok('Ma trận: đủ mọi ngày từ 02/10 hoặc ngày tạo 01/10 tới 05/10 (5 ngày) + tiêu đề + dòng TỔNG', (s3.match(/<row /g) || []).length === 5 + 2);
ok('Ma trận: tổng thành công 8+4+15 = 27 ở ô tổng cuối', /<c r="D7" s="7"><v>27<\/v>/.test(s3), (s3.match(/<row r="7">[\s\S]*?<\/row>/) || [''])[0]);

console.log('\n== API: chỉ ẨN, không xoá ==');
const aid = Number(users.create({ username: 'ad', passwordHash: 'x', role: 'admin' }).lastInsertRowid);
const u1 = Number(users.create({ username: 'khach1', passwordHash: 'x', displayName: 'Khách Một' }).lastInsertRowid);
const u2 = Number(users.create({ username: 'khach2', passwordHash: 'x' }).lastInsertRowid);
const admin = { id: aid, username: 'ad', role: 'admin' }, user1 = { id: u1, username: 'khach1', role: 'user' }, user2 = { id: u2, username: 'khach2', role: 'user' };
const c1 = Number(campaigns.create({ userId: u1, keyword: 'chay 1', targetUrl: 'https://x.example/1', count: 10, unit: 'day' }).lastInsertRowid);
const c2 = Number(campaigns.create({ userId: u1, keyword: 'chay 2', targetUrl: 'https://x.example/2', count: 5, unit: 'day' }).lastInsertRowid);
const c3 = Number(campaigns.create({ userId: u2, keyword: 'khach hai', targetUrl: 'https://y.example/', count: 5, unit: 'day' }).lastInsertRowid);
campaigns.setApproval(c1, { status: 'approved', byId: aid }); campaigns.setStatus(c1, 'running', aid);
campaigns.setApproval(c3, { status: 'approved', byId: aid }); campaigns.setStatus(c3, 'running', aid);
const stamp = () => { const d = new Date(), p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`; };
for (let i = 0; i < 4; i++) runs.record({ campaignId: c1, userId: u1, status: 'ok', at: stamp(), position: 2, deviceKind: 'desktop', query: 'chay 1' });
runs.record({ campaignId: c1, userId: u1, status: 'notfound', at: stamp(), deviceKind: 'mobile', query: 'chay 1' });
runs.record({ campaignId: c3, userId: u2, status: 'ok', at: stamp(), position: 5, deviceKind: 'desktop', query: 'khach hai' });
wallet.credit({ userId: u1, amountVnd: 50000, method: 'manual', note: 'test' });
for (let i = 0; i < 4; i++) wallet.spend({ userId: u1, amountVnd: 1500, campaignId: c1, note: 'lượt' });

async function call(actor, method, path, body) {
  const req = Object.assign(Readable.from(body ? [JSON.stringify(body)] : []), { method, headers: {} });
  let status = 0, out = '', headers = {}, buf = null;
  const res = { headersSent: false, writeHead(s, h) { status = s; headers = h || {}; }, end(b) { if (Buffer.isBuffer(b)) buf = b; else out = b || ''; }, setHeader() {} };
  const send = (r, s, b) => { status = s; out = typeof b === 'string' ? b : JSON.stringify(b); return true; };
  const readBody = async r => { let d = ''; for await (const c of r) d += c; return d ? JSON.parse(d) : {}; };
  const campaign = { status: () => ({ maxThreads: 3 }), settings: { activeFrom: 0, activeTo: 24, threads: 3, mobilePercent: 30 }, schedule() {}, syncTasks() {}, paceOf: () => null };
  try { await handleApi({ req, res, url: new URL('http://x' + path), actor, campaign, send, readBody }); } catch (e) { status = e.status || 500; out = JSON.stringify({ error: e.message }); }
  let data = null; try { data = out ? JSON.parse(out) : null; } catch { data = null; }
  return { status, headers, buf, text: out, data };
}

let r = await call(user1, 'DELETE', `/api/campaigns/${c2}`);
ok('khách KHÔNG xoá được chiến dịch (403) và chiến dịch vẫn còn', r.status === 403 && campaigns.byId(c2) !== null);
r = await call(user1, 'DELETE', `/api/campaigns/${c1}`);
ok('chiến dịch đã chạy cũng không xoá/dừng được bằng DELETE (403, trạng thái giữ nguyên)', r.status === 403 && campaigns.byId(c1).status === 'running');
r = await call(user2, 'POST', `/api/campaigns/${c1}/hide`, { hidden: true });
ok('khách khác KHÔNG ẩn được chiến dịch của người khác (403)', r.status === 403 && campaigns.byId(c1).hidden === 0);
const totalBefore = campaigns.countByUser(u1);
r = await call(user1, 'POST', `/api/campaigns/${c1}/hide`, { hidden: true });
ok('khách ẨN chiến dịch đang chạy -> 200, đánh dấu ẩn + tự dừng', r.status === 200 && r.data.campaign.hidden === true && r.data.campaign.status === 'stopped' && campaigns.byId(c1).hidden === 1);
ok('chiến dịch ẩn không còn trong danh sách được phép chạy (engine bỏ qua)', !campaigns.runnable().some(c => c.id === c1));
ok('chiến dịch ẩn không tính vào hạn mức số chiến dịch', campaigns.countByUser(u1) === totalBefore - 1);
r = await call(user1, 'GET', '/api/campaigns');
ok('API vẫn trả chiến dịch ẩn kèm cờ hidden (để giao diện đưa vào tab "Đã ẩn")', r.data.campaigns.find(c => c.id === c1)?.hidden === true && r.data.campaigns.find(c => c.id === c2)?.hidden === false);
r = await call(user1, 'POST', `/api/campaigns/${c1}/status`, { status: 'running' });
ok('chiến dịch đang ẩn không bật chạy được (400)', r.status === 400 && /ẩn/.test(r.data.error));
r = await call(user1, 'PATCH', `/api/campaigns/${c1}`, { count: 99 });
ok('chiến dịch đang ẩn không sửa được (400)', r.status === 400 && campaigns.byId(c1).count === 10);
r = await call(user1, 'POST', `/api/campaigns/${c1}/hide`, { hidden: false });
ok('bỏ ẩn -> hiện lại, KHÔNG tự chạy (vẫn "đã dừng")', r.status === 200 && r.data.campaign.hidden === false && r.data.campaign.status === 'stopped' && !campaigns.runnable().some(c => c.id === c1));
r = await call(admin, 'DELETE', `/api/campaigns/${c2}`);
ok('admin vẫn xoá được chiến dịch (chưa có lượt chạy)', r.status === 200 && r.data.deleted === true && campaigns.byId(c2) === null);

console.log('\n== API: xuất Excel ==');
await call(user1, 'POST', `/api/campaigns/${c1}/hide`, { hidden: true });
r = await call(user1, 'GET', '/api/export/campaigns.xlsx');
ok('khách tải được file .xlsx của chính mình (200 + đúng Content-Type + tên file)', r.status === 200 && /spreadsheetml\.sheet/.test(r.headers['Content-Type']) && /filename="WingTraffic-thong-ke-khach1-\d{4}-\d{2}-\d{2}\.xlsx"/.test(r.headers['Content-Disposition']) && Buffer.isBuffer(r.buf) && r.buf.slice(0, 2).toString() === 'PK');
const ez = readZip(r.buf);
const e1 = ez['xl/worksheets/sheet1.xml'].text, e3 = ez['xl/worksheets/sheet3.xml'].text;
ok('file hợp lệ: CRC đúng, XML cân bằng', Object.values(ez).every(e => e.crcOk && e.sizeOk) && Object.values(ez).every(e => balanced(e.text)));
ok('file có chiến dịch ĐÃ ẨN của khách 1 và số liệu đúng (Lượng Traffic 4, chi phí 6.000đ)', e1.includes('chay 1') && /<c r="K\d+"[^>]*><v>4<\/v>/.test(e1) && /<c r="L\d+"[^>]*><v>6000<\/v>/.test(e1) && e1.includes('>Có<') && !/Tổng lượt chạy/.test(e1));
ok('file KHÔNG chứa dữ liệu của khách khác', !ez['xl/worksheets/sheet1.xml'].text.includes('khach hai') && !e3.includes('khach hai'));
r = await call(user1, 'GET', `/api/export/campaigns.xlsx?userId=${u2}`);
ok('khách thêm ?userId= của người khác vẫn chỉ tải được dữ liệu của MÌNH', r.status === 200 && !readZip(r.buf)['xl/worksheets/sheet1.xml'].text.includes('khach hai'));
r = await call(admin, 'GET', `/api/export/campaigns.xlsx?userId=${u2}`);
ok('admin tải được của một khách bằng ?userId=', r.status === 200 && readZip(r.buf)['xl/worksheets/sheet1.xml'].text.includes('khach hai') && /khach2/.test(r.headers['Content-Disposition']));
r = await call(admin, 'GET', '/api/export/campaigns.xlsx?userId=9999');
ok('tài khoản không tồn tại -> 404', r.status === 404);

console.log(`\nKết quả: ${pass} PASS, ${fail} FAIL`);
process.exit(fail ? 1 : 0);
