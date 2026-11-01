
export const VISIT_PRICES = [
  {
    type: 'search_click',
    label: 'Organic ngắn',
    desc: 'Tìm Google → bấm vào URL → thoát nhanh (bounce), không xem trang con.',
    stays: '5–15 giây',
    price: 700,
  },
  {
    type: 'direct_visit',
    label: 'Direct',
    desc: 'Vào thẳng URL, ở lại đọc rồi xem 1 trang con — không có referrer tìm kiếm.',
    stays: '60–120 giây',
    price: 1000,
  },
  {
    type: 'search_dwell',
    label: 'Organic chuẩn',
    desc: 'Tìm Google → bấm vào URL → đọc 60–120 giây → xem 1 trang con.',
    stays: '60–120 giây',
    price: 1500,
    recommended: true,
  },
  {
    type: 'deep_browse',
    label: 'Đọc sâu',
    desc: 'Tìm Google → đọc 4–8 phút → xem 3 trang con nội bộ (một lượt dài, dấu hiệu chất lượng cao).',
    stays: '9–20 phút',
    price: 6000,
  },
  {
    type: 'search_only',
    label: 'Kiểm tra từ khóa',
    desc: 'Chỉ tìm Google rồi ghi lại vị trí URL đích trong kết quả — không tạo lượt truy cập.',
    stays: '—',
    price: 300,
  },
];

export const DWELL_TIERS = [60, 120, 150, 200];

export const PRICE_EFFECTIVE_FROM = '01/03/2026';

export const TRAFFIC_PRICES = [
  {
    kind: 'search',
    name: 'Search Traffic',
    tagline: 'Traffic từ tìm kiếm Google',
    campaignType: 'search_dwell',
    tiers: [
      { seconds: 60, price: 1100 },
      { seconds: 120, price: 1540 },
      { seconds: 150, price: 1760 },
      { seconds: 200, price: 1980 },
    ],
  },
  {
    kind: 'direct',
    name: 'Direct Traffic',
    tagline: 'Truy cập trực tiếp vào website',
    campaignType: 'direct_visit',
    tiers: [
      { seconds: 60, price: 660 },
      { seconds: 120, price: 880 },
      { seconds: 150, price: 990 },
      { seconds: 200, price: 1100 },
    ],
  },
  {
    kind: 'social',
    name: 'Social Traffic',
    tagline: 'Nguồn từ Facebook, YouTube…',
    campaignType: null,
    tiers: [
      { seconds: 60, price: 880 },
      { seconds: 120, price: 1100 },
      { seconds: 150, price: 1320 },
      { seconds: 200, price: 1540 },
    ],
  },
  {
    kind: 'backlink',
    name: 'Backlink Traffic',
    tagline: 'Referral từ website khác về',
    campaignType: null,
    tiers: [
      { seconds: 60, price: 990 },
      { seconds: 120, price: 1320 },
      { seconds: 150, price: 1540 },
      { seconds: 200, price: 1760 },
    ],
  },
];

export const VOLUME_TIERS = [
  { from: 1000, off: 0 },
  { from: 5000, off: 10 },
  { from: 20000, off: 20 },
  { from: 50000, off: 30 },
];

export const ADDONS = [
  { name: 'IP dân cư Việt Nam', unit: 'theo IP / tháng', price: 'Liên hệ', note: 'Mỗi lượt một IP mới; chọn được tỉnh/thành khi cần.' },
  { name: 'Hồ sơ trình duyệt riêng', unit: 'theo hồ sơ / tháng', price: 'Liên hệ', note: 'Giữ cookie và lịch sử như người dùng thường.' },
  { name: 'Xử lý xác minh', unit: 'theo 1.000 lượt', price: 'Liên hệ', note: 'Xác minh không vượt được thì hệ thống tự chạy lại lượt đó.' },
  { name: 'Chạy hộ trên máy chủ', unit: 'theo lượt', price: 'Từ 700đ / lượt', note: 'Bạn không cần máy hay hạ tầng — xem bảng giá theo lượt ở trên.' },
  { name: 'Kết nối hệ thống', unit: 'theo tháng', price: 'Liên hệ', note: 'Đẩy chỉ tiêu từ hệ thống của bạn và nhận báo cáo tự động qua lớp API của app.' },
];

export const GUARANTEES = [
  { title: 'Lượt lỗi không tính tiền', body: 'Mỗi lượt có nhật ký riêng (vị trí trên Google, IP, thời gian ở lại, lỗi nếu có). Lượt lỗi được chạy lại tối đa 3 lần trước khi tính là hỏng.' },
  { title: 'Báo cáo từng lượt', body: 'Không có “hộp đen”: bạn xem được từng lượt đã chạy — từ khóa nào, IP nào, ở lại bao lâu, đứng vị trí bao nhiêu.' },
  { title: 'Tạm dừng bất cứ lúc nào', body: 'Mỗi chiến dịch tạm dừng hoặc chạy tiếp được ngay trong bảng điều khiển; lượt chưa chạy không nằm trong số lượt bạn trả.' },
  { title: 'Không khoá dữ liệu', body: 'Toàn bộ từ khóa, URL và nhật ký nằm trong CSDL của bạn, xuất ra được bất kỳ lúc nào.' },
];

export const PRICE_FAQ = [
  {
    q: 'Một lượt truy cập gồm những bước nào?',
    a: 'Gõ từ khóa trên Google → tìm URL đích trong kết quả → bấm vào → ở lại đọc theo thời gian cấu hình → xem thêm trang con nội bộ. Mỗi bước đều được ghi lại để bạn kiểm tra.',
  },
  {
    q: 'Lượt truy cập có giống người dùng thật không?',
    a: 'Có. Truy cập ảo thường chỉ gọi URL rồi thoát, không có thời gian đọc. Ở đây mỗi lượt là một phiên truy cập hoàn chỉnh, thời gian ở lại ngẫu nhiên trong khoảng bạn đặt, và mỗi lượt đến từ một IP riêng.',
  },
  {
    q: 'Dùng bao lâu thì thấy thay đổi?',
    a: 'Traffic là tín hiệu gián tiếp nên kết quả phụ thuộc nội dung và tình trạng từ khóa. Kinh nghiệm chung: bài đang ở trang 2 (vị trí 11–20) thường nhúc nhích sau 4–8 tuần; bài đã ở top 10 có thể lên 1–2 bậc sau 2–3 tháng. Cách dùng an toàn là rải đều và tăng dần, không tăng vọt trong vài ngày.',
  },
  {
    q: 'Có được dùng thử trước khi trả tiền không?',
    a: 'Có. Tài khoản tự đăng ký dùng được ngay đầy đủ tính năng: tạo chiến dịch, xem nhật ký từng lượt, báo cáo theo ngày. Bạn cũng chạy thử một lượt ở trang Kiểm tra để xem engine làm đúng ý chưa trước khi đặt số lượng lớn.',
  },
  {
    q: 'Tôi cần chuẩn bị gì để chạy?',
    a: 'Không cần gì cả: bạn chỉ gửi từ khóa, URL đích và chỉ tiêu mỗi giờ/ngày. Hạ tầng do hệ thống lo, chạy 24/7 và ghi lại từng lượt.',
  },
  {
    q: 'Dữ liệu và nhật ký được lưu bao lâu?',
    a: 'Không giới hạn theo gói: từ khóa, URL và nhật ký từng lượt nằm trong CSDL của hệ thống và xem được bất cứ lúc nào ở bảng điều khiển. Nhật ký thao tác (ai duyệt, ai sửa chiến dịch) được lưu riêng ở trang Quản trị.',
  },
];

export function visitPrice(type) {
  const row = VISIT_PRICES.find(v => v.type === String(type));
  return row ? row.price : 0;
}

export function trafficPrice(kind, seconds) {
  const row = TRAFFIC_PRICES.find(t => t.kind === String(kind));
  if (!row) return 0;
  const cell = row.tiers.find(x => x.seconds === Math.round(Number(seconds) || 0));
  return cell ? cell.price : 0;
}

export function volumePrice(type, visits) {
  const base = visitPrice(type);
  const n = Math.max(0, Math.round(Number(visits) || 0));
  const off = VOLUME_TIERS.filter(t => n >= t.from).pop()?.off || 0;
  return Math.round(base * (1 - off / 100));
}

export function formatVnd(n) {
  return Number(n || 0).toLocaleString('vi-VN');
}

