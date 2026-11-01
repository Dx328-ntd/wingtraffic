import { buildXlsx, H, T, B, I, IB, DT } from './xlsx.mjs';

const APPROVAL_VI = { pending: 'Chờ duyệt', approved: 'Đã duyệt', rejected: 'Không được duyệt' };
const STATUS_VI = { idle: 'Chưa chạy', running: 'Đang bật', paused: 'Tạm dừng', done: 'Đủ chỉ tiêu hôm nay', stopped: 'Đã dừng' };
const MAX_DAYS = 3700;

const pad = n => String(n).padStart(2, '0');
const ymd = d => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const parseYmd = s => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || '')); return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])) : null; };
const cut = (s, n) => { s = String(s ?? ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; };

export function buildCampaignReport({ user, campaigns, daily, today, exportedAt = '' }) {
  const camps = [...campaigns].sort((a, b) => a.id - b.id);
  const byId = new Map(camps.map(c => [c.id, c]));
  const rows = [...daily].sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : a.campaignId - b.campaignId));
  const label = id => { const c = byId.get(id); return c ? c.keyword : `(chiến dịch #${id} đã xoá)`; };

  const tot = new Map();
  for (const c of camps) tot.set(c.id, { attempts: 0, ok: 0, notfound: 0, captcha: 0, error: 0, spent: 0, first: null, last: null });
  for (const r of rows) {
    if (!tot.has(r.campaignId)) tot.set(r.campaignId, { attempts: 0, ok: 0, notfound: 0, captcha: 0, error: 0, spent: 0, first: null, last: null });
    const t = tot.get(r.campaignId);
    for (const k of ['attempts', 'ok', 'notfound', 'captcha', 'error', 'spent']) t[k] += Number(r[k]) || 0;
    if (Number(r.attempts) > 0 || Number(r.spent) > 0) { if (!t.first || r.day < t.first) t.first = r.day; if (!t.last || r.day > t.last) t.last = r.day; }
  }
  const firstData = rows.find(r => Number(r.attempts) > 0 || Number(r.spent) > 0)?.day || '';
  const createdDay = String(user.createdAt || '').slice(0, 10);
  const startDay = [createdDay, firstData].filter(Boolean).sort()[0] || today;

  const sum = { attempts: 0, ok: 0, notfound: 0, captcha: 0, error: 0, spent: 0 };
  const s1 = [
    [T('Thống kê traffic theo chiến dịch')],
    [B('Tài khoản'), `${user.username}${user.displayName ? ` (${user.displayName})` : ''}`],
    [B('Tạo tài khoản'), createdDay ? DT(createdDay) : ''],
    [B('Dữ liệu từ ngày'), DT(startDay), B('đến ngày'), DT(today)],
    [B('Xuất lúc'), exportedAt],
    [B('Ghi chú'), 'Lượng Traffic = số lượt vào được website. Chiến dịch đã ẩn vẫn nằm trong thống kê.'],
    [],
  ];
  const headRow = s1.length + 1;
  s1.push([H('ID'), H('Từ khóa'), H('URL đích'), H('Loại traffic'), H('Chỉ tiêu'), H('Trạng thái'), H('Đã ẩn'), H('Ngày tạo'),
    H('Ngày đầu có traffic'), H('Ngày cuối có traffic'), H('Lượng Traffic'), H('Chi phí (đ)')]);
  for (const c of camps) {
    const t = tot.get(c.id);
    for (const k of Object.keys(sum)) sum[k] += t[k];
    s1.push([
      I(c.id), c.keyword, c.targetUrl, c.typeLabel, `${c.count} lượt/${c.unit === 'hour' ? 'giờ' : 'ngày'}`,
      `${APPROVAL_VI[c.approval] || c.approval} · ${STATUS_VI[c.status] || c.status}`, c.hidden ? 'Có' : '',
      c.createdAt ? DT(String(c.createdAt).slice(0, 10)) : '', t.first ? DT(t.first) : '', t.last ? DT(t.last) : '',
      I(t.ok), I(t.spent),
    ]);
  }
  s1.push([B('TỔNG'), '', '', '', '', '', '', '', '', '', IB(sum.ok), IB(sum.spent)]);

  const s2 = [[H('Ngày'), H('ID chiến dịch'), H('Từ khóa'), H('URL đích'), H('Loại traffic'), H('Lượng Traffic'), H('Chi phí (đ)')]];
  for (const r of rows) {
    if (!(Number(r.attempts) > 0 || Number(r.spent) > 0)) continue;
    const c = byId.get(r.campaignId);
    s2.push([DT(r.day), I(r.campaignId), label(r.campaignId), c ? c.targetUrl : '', c ? c.typeLabel : '',
      I(r.ok), I(r.spent)]);
  }

  const ids = [...new Set([...camps.map(c => c.id), ...rows.map(r => r.campaignId)])].sort((a, b) => a - b);
  const okMap = new Map();
  for (const r of rows) okMap.set(`${r.day}|${r.campaignId}`, Number(r.ok) || 0);
  let from = parseYmd(startDay) || parseYmd(today), to = parseYmd(today);
  if ((to - from) / 86400000 > MAX_DAYS) from = new Date(to.getTime() - MAX_DAYS * 86400000);
  const s3 = [[H('Ngày'), ...ids.map(id => H(`#${id} ${cut(label(id), 28)}`)), H('Tổng traffic trong ngày')]];
  const colTot = ids.map(() => 0);
  let grand = 0;
  for (let d = new Date(from); d <= to; d = new Date(d.getTime() + 86400000)) {
    const day = ymd(d);
    let rowSum = 0;
    const cells = ids.map((id, i) => { const v = okMap.get(`${day}|${id}`) || 0; rowSum += v; colTot[i] += v; return I(v); });
    grand += rowSum;
    s3.push([DT(day), ...cells, IB(rowSum)]);
  }
  s3.push([B('TỔNG'), ...colTot.map(v => IB(v)), IB(grand)]);

  return buildXlsx([
    { name: 'Tổng hợp', rows: s1, widths: [18, 30, 38, 20, 14, 30, 8, 12, 14, 14, 14, 14], freezeRows: headRow, filter: { row: headRow } },
    { name: 'Theo ngày', rows: s2, widths: [12, 12, 30, 38, 18, 14, 14], freezeRows: 1, filter: { row: 1 } },
    { name: 'Ma trận ngày', rows: s3, widths: [12, ...ids.map(() => 22), 16], freezeRows: 1 },
  ]);
}
