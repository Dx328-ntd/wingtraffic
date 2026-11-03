export const APP_TZ = process.env.APP_TZ || 'Asia/Ho_Chi_Minh';

const p = n => String(n).padStart(2, '0');

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
