
export const CAMPAIGN_TYPES = [
  {
    id: 'search_dwell',
    label: 'Search Traffic',
    desc: 'Gõ từ khóa trên Google, tìm trang đích trong kết quả, bấm vào, ở lại đọc rồi xem 1 trang con.',
    engine: { skipSearch: false, skipVisit: false, maxPages: 5, dwellMin: 60, dwellMax: 120, subpages: 1, subDwellMin: 20, subDwellMax: 45 },
  },
  {
    id: 'search_click',
    hidden: true,
    label: 'Tìm Google → bấm vào → thoát nhanh',
    desc: 'Tạo lượt truy cập ngắn từ Google (bounce), không xem trang con.',
    engine: { skipSearch: false, skipVisit: false, maxPages: 5, dwellMin: 5, dwellMax: 15, subpages: 0, subDwellMin: 0, subDwellMax: 0 },
  },
  {
    id: 'search_only',
    hidden: true,
    label: 'Chỉ tìm Google (không bấm vào URL)',
    desc: 'Chỉ thực hiện truy vấn rồi dừng ở trang kết quả — dùng để kiểm tra từ khóa/thứ hạng.',
    engine: { skipSearch: false, skipVisit: true, maxPages: 5, dwellMin: 0, dwellMax: 0, subpages: 0, subDwellMin: 0, subDwellMax: 0 },
  },
  {
    id: 'direct_visit',
    label: 'Direct Traffic',
    desc: 'Mở thẳng URL đích như gõ tên miền trên thanh địa chỉ (không qua kết quả Google, không có referrer tìm kiếm), ở lại đọc + xem 1 trang con.',
    engine: { skipSearch: true, skipVisit: false, maxPages: 0, dwellMin: 60, dwellMax: 120, subpages: 1, subDwellMin: 20, subDwellMax: 45 },
  },
  {
    id: 'deep_browse',
    hidden: true,
    label: 'Tìm Google → vào URL → đọc sâu (thời gian dài)',
    desc: 'Ở lại lâu hơn và đọc 3 trang con — dùng khi cần tăng thời gian mỗi lượt (≈ 9–20 phút/lượt).',
    engine: { skipSearch: false, skipVisit: false, maxPages: 8, dwellMin: 240, dwellMax: 480, subpages: 3, subDwellMin: 90, subDwellMax: 180 },
  },
];

export const CAMPAIGN_TYPE_IDS = CAMPAIGN_TYPES.map(t => t.id);
export const SELECTABLE_CAMPAIGN_TYPES = CAMPAIGN_TYPES.filter(t => !t.hidden);
export const UNITS = ['hour', 'day'];
export const APPROVAL_STATUSES = ['pending', 'approved', 'rejected'];
export const CAMPAIGN_STATUSES = ['idle', 'running', 'paused', 'done', 'stopped'];
export const USER_ROLES = ['user', 'admin'];
export const USER_STATUSES = ['active', 'locked'];

export const QUERY_MODES = [
  {
    id: 'keyword',
    label: 'Chỉ từ khóa',
    desc: 'Gõ đúng từ khóa. Dùng khi site ĐÃ có thứ hạng cho từ khóa đó.',
  },
  {
    id: 'keyword_domain',
    label: 'Từ khóa + tên miền',
    desc: 'Gõ "từ khóa + tên miền đích" (vd: soi kèo nhà cái https://brfo.io). Dùng khi site CHƯA lên hạng — Google trả về đúng site nên vẫn có lượt hiển thị và lượt truy cập.',
  },
];
export const QUERY_MODE_IDS = QUERY_MODES.map(m => m.id);

export function targetHost(targetUrl = '') {
  const t = String(targetUrl ?? '').trim();
  if (!t) return '';
  try {
    return new URL(/^https?:\/\//i.test(t) ? t : `https://${t}`).hostname.replace(/^www\./i, '').toLowerCase();
  } catch { return ''; }
}

export function getQueryMode(id) {
  return QUERY_MODES.find(m => m.id === String(id)) || null;
}

export function isValidQueryMode(id) {
  return QUERY_MODE_IDS.includes(String(id));
}

export function searchQuery({ keyword, targetUrl = '', queryMode = 'keyword' } = {}) {
  const kw = String(keyword ?? '').trim();
  if (queryMode !== 'keyword_domain') return kw;
  const host = targetHost(targetUrl);
  return host ? `${kw} https://${host}`.trim() : kw;
}

export function splitKeywordUrl(text, targetUrl = '') {
  const s = String(text ?? '').trim().slice(0, 200);
  const cut = part => s.split(part).join(' ').replace(/\s+/g, ' ').trim();
  const withScheme = /(?:https?:\/\/|www\.)[^\s]+/i.exec(s);
  if (withScheme) return { keyword: cut(withScheme[0]), url: withScheme[0].replace(/[),.;]+$/, '') };
  const bare = /(?:^|\s)((?:[a-z0-9-]+\.)+[a-z]{2,24})(\/[^\s]*)?(?=\s|$)/i.exec(s);
  if (!bare) return { keyword: s, url: null };
  let host = '';
  try {
    const t = String(targetUrl ?? '').trim();
    host = targetHost(t);
  } catch { host = ''; }
  if (host && bare[1].replace(/^www\./i, '').toLowerCase() === host) {
    return { keyword: cut(bare[0]), url: `https://${bare[1]}${bare[2] || ''}` };
  }
  return { keyword: s, url: null };
}

export function getCampaignType(id) {
  return CAMPAIGN_TYPES.find(t => t.id === String(id)) || null;
}

export function isValidCampaignType(id) {
  return CAMPAIGN_TYPE_IDS.includes(String(id));
}

export function engineParams(typeId) {
  const t = getCampaignType(typeId) || CAMPAIGN_TYPES[0];
  return { type: t.id, ...t.engine };
}
