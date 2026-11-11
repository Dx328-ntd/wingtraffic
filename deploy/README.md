# Triển khai kín (P0/P1)

Mục tiêu: người ngoài chỉ thấy một tên miền qua Cloudflare, không thấy IP origin, port 3300, Node, SQLite hay tên vendor.

## 1. Build + chạy

Trong `.env` đặt:

```ini
HOST=127.0.0.1
PUBLIC_URL=https://wingtraffic.tech
AUTH_COOKIE=sid
GATE_COOKIE=gw
REGISTER_OPEN=0
```

rồi:

```powershell
npm ci
npm run build:public
npm run start:prod
```

`start:prod` đặt `PUBLIC_DIR=dist/public` (bản HTML/JS/CSS đã minify, bỏ comment, asset `ui.<hash>.js`). Server mặc định chỉ nghe `127.0.0.1:3300`.

## 2. Cloudflare Tunnel (không mở cổng)

1. Cài `cloudflared`.
2. `cloudflared tunnel login`
3. `cloudflared tunnel create wingtraffic`
4. Copy `deploy/cloudflared.yml.example` → `%USERPROFILE%\.cloudflared\config.yml`, điền tunnel id.
5. `cloudflared tunnel route dns wingtraffic wingtraffic.tech`
6. `cloudflared service install`
7. Firewall Windows: chặn inbound 3300 (và RDP nếu không dùng).

Kiểm tra: `nmap -p 3300 <IP>` phải closed; truy cập thẳng IP phải fail.

## 3. Quy tắc Cloudflare nên bật

- WAF → Block: `/.env`, `/.git*`, `/wp-admin*`, `/wp-login.php`, `/phpmyadmin*`, `/vendor/*`, `/server.mjs`, `/package.json`, `/data/*`, `/backups/*`.
- Rate limit `/api/*`: 60 request/phút/IP; `/api/login`: 10 request/10 phút/IP; `/api/register`: 5/10 phút/IP.
- Managed Ruleset: bật.
- Transform Rule: remove request header `x-powered-by` (nếu có) — response `Server: cloudflare` là bình thường.
- Bật "Under Attack Mode" khi bị quét mạnh.

## 4. Kiểm tra sau khi deploy

```powershell
curl.exe -I https://wingtraffic.tech
curl.exe -s -o NUL -w "%{http_code}`n" https://wingtraffic.tech/.env
curl.exe -s -o NUL -w "%{http_code}`n" https://wingtraffic.tech/.git/config
curl.exe -s -o NUL -w "%{http_code}`n" https://wingtraffic.tech/package.json
```

Kỳ vọng: không có `X-Powered-By`; các đường dẫn trên trả 404/403; DevTools chỉ thấy JS đã minify, cookie `sid`/`gw`.

## 5. Việc phải làm tay trên GitHub

- Repo `Dx328-ntd/wingtraffic`: Settings → General → Danger Zone → **Change visibility → Private**.
- Repo hiện public; docs cũ vẫn nằm trong lịch sử commit. Nếu muốn xoá hẳn:
  `git filter-repo --path HUONG-DAN-SU-DUNG.md --path HUONG-DAN-CHIEN-DICH.md --path CAPTCHA-NOTES.txt --invert-paths` rồi force-push (chỉ khi chắc chắn).
- Kiểm tra Google/Bing `site:github.com Dx328-ntd wingtraffic` và archive.org sau khi private.
