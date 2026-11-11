// Một quy ước thời gian duy nhất cho toàn hệ thống.
//
// - CSDL lưu UTC (khớp DEFAULT (datetime('now')) của SQLite) => mọi cột thời gian
//   (created_at, last_login_at, updated_at, runs.at...) cùng một hệ quy chiếu.
// - Nhật ký / giao diện hiển thị theo APP_TZ (mặc định Asia/Ho_Chi_Minh), không phụ
//   thuộc múi giờ của máy chủ — trước đây log engine dùng giờ máy (lệch +1h so với
//   created_at trên máy chủ UTC+1) nên cùng một sự kiện hiện hai mốc khác nhau.
//
// LƯU Ý còn lại (chưa đổi để không lặng lẽ thay đổi nghiệp vụ): "ngày" trong thống kê
// và hạn mức hiện là NGÀY UTC (date(runs.at) trong SQL = date(today()) ở đây). Với khách
// ở Việt Nam, mốc ngày nên là giờ VN: muốn vậy phải đổi truy vấn thành
// date(at, '+7 hours') (và tính lại biên ngày cho campaign_stats_daily) — cần một lần
// rà riêng kèm chuyển dữ liệu. Hàm inAppTz() ở dưới dùng để đối chiếu khi làm việc đó.

export const APP_TZ = process.env.APP_TZ || 'Asia/Ho_Chi_Minh';

const p = n => String(n).padStart(2, '0');

/** Chuỗi thời gian UTC `YYYY-MM-DD HH:MM:SS` để ghi CSDL / so sánh chuỗi. */
export function now(date = new Date()) {
  const d = new Date(date);
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} `
    + `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`;
}

/** Ngày UTC `YYYY-MM-DD` (khớp `date(runs.at)` khi thống kê theo ngày). */
export function today(date = new Date()) {
  return now(date).slice(0, 10);
}

/** Giờ hiển thị `HH:MM:SS` theo APP_TZ, dùng cho nhật ký engine. */
export function stamp(date = new Date()) {
  const d = new Date(date);
  try {
    return new Intl.DateTimeFormat('vi-VN', {
      timeZone: APP_TZ, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
    }).format(d);
  } catch {
    return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  }
}

/** Chuỗi `YYYY-MM-DD HH:MM:SS` quy đổi sang APP_TZ (để đối chiếu/ghi chú khi cần). */
export function inAppTz(date = new Date()) {
  const d = new Date(date);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: APP_TZ, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).formatToParts(d).reduce((a, x) => (a[x.type] = x.value, a), {});
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
}
