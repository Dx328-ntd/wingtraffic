// Đếm nhẹ các mã lỗi thường bị scanner dùng, log cảnh báo theo cửa sổ 60 giây.
// Không thay thế Cloudflare/WAF — chỉ để biết đang bị quét mà xem log.
const WINDOW_MS = 60_000;
const THRESHOLDS = { 401: 15, 403: 15, 404: 40, 429: 10 };

let bucket = { at: Date.now(), counts: {} };
let warned = new Set();

function roll(now) {
  if (now - bucket.at < WINDOW_MS) return;
  bucket = { at: now, counts: {} };
  warned = new Set();
}

export function noteStatus(status) {
  const code = Number(status);
  if (!THRESHOLDS[code]) return;
  const now = Date.now();
  roll(now);
  bucket.counts[code] = (bucket.counts[code] || 0) + 1;
  if (bucket.counts[code] === THRESHOLDS[code] && !warned.has(code)) {
    warned.add(code);
    console.warn(`[scan] ${code} x${bucket.counts[code]} trong 60s — kiểm tra Cloudflare/log (có thể đang bị quét).`);
  }
}

export function scanSnapshot() {
  roll(Date.now());
  return { windowSec: Math.round(WINDOW_MS / 1000), counts: { ...bucket.counts }, thresholds: { ...THRESHOLDS } };
}
