# Hướng dẫn sử dụng app Omni Google Search

Tài liệu này hướng dẫn **dùng app từ A→Z**: cài đặt, chạy, đăng nhập, ý nghĩa từng nút/từng ô cấu hình,
cách vận hành hằng ngày và cách xử lý sự cố. Phần chi tiết về kiến trúc/API của hệ thống chiến dịch
nhiều người dùng nằm ở `HUONG-DAN-CHIEN-DICH.md`; phần kỹ thuật captcha nằm ở `CAPTCHA-NOTES.txt`.

## Mục lục

1. [App làm gì](#1-app-làm-gì)
2. [Cài đặt lần đầu](#2-cài-đặt-lần-đầu)
3. [Khởi động & dừng app](#3-khởi-động--dừng-app)
4. [Đăng nhập & phân quyền](#4-đăng-nhập--phân-quyền)
   - [4.1. Tạo tài khoản (đăng ký)](#41-tạo-tài-khoản-đăng-ký)
5. [Trang chạy đơn `/test`](#5-trang-chạy-đơn-test)
6. [Trang chiến dịch của tôi `/my`](#6-trang-chiến-dịch-của-tôi-my)
7. [Trang quản trị `/admin`](#7-trang-quản-trị-admin)
8. [Trang cấu hình engine `/campaign`](#8-trang-cấu-hình-engine-campaign)
9. [5 loại chiến dịch](#9-5-loại-chiến-dịch)
10. [Engine chạy như thế nào](#10-engine-chạy-như-thế-nào)
    - [10.10. Chạy traffic trên di động (Android/iPhone)](#1010-chạy-traffic-trên-di-động-androidiphone)
    - [10.11. Thao tác trên giao diện giống người thật](#1011-thao-tác-trên-giao-diện-giống-người-thật)
    - [10.14. Cứ 20 lượt tìm kiếm có 1 lượt chỉ lấy hiển thị](#1014-cứ-20-lượt-tìm-kiếm-có-1-lượt-chỉ-lấy-hiển-thị)
    - [10.15. Vị trí Google: máy tính và di động là hai bảng xếp hạng khác nhau](#1015-vị-trí-google-máy-tính-và-di-động-là-hai-bảng-xếp-hạng-khác-nhau)
    - [10.16. Kiểu truy vấn: "Chỉ từ khóa" hay "Từ khóa + tên miền"](#1016-kiểu-truy-vấn-chỉ-từ-khóa-hay-từ-khóa--tên-miền)
    - [10.17. Một chiến dịch được chạy bao nhiêu luồng cùng lúc](#1017-một-chiến-dịch-được-chạy-bao-nhiêu-luồng-cùng-lúc)
11. [Captcha](#11-captcha)
12. [Proxy](#12-proxy)
    - [12.4. Khuyến nghị cho proxy xoay (đã kiểm chứng)](#124-khuyến-nghị-cho-proxy-xoay-đã-kiểm-chứng)
13. [Telegram & thông báo](#13-telegram--thông-báo)
14. [Dữ liệu, sao lưu, dọn dẹp](#14-dữ-liệu-sao-lưu-dọn-dẹp)
15. [Lệnh tham chiếu nhanh](#15-lệnh-tham-chiếu-nhanh)
16. [Xử lý sự cố](#16-xử-lý-sự-cố)
17. [Checklist hằng ngày & bảo mật](#17-checklist-hằng-ngày--bảo-mật)
18. [Câu hỏi thường gặp](#18-câu-hỏi-thường-gặp)
19. [Cổng công khai `/` — 2 tab Người dùng & Quản trị](#19-cổng-công-khai---2-tab-người-dùng--quản-trị)
20. [Bảng giá `/bang-gia`](#20-bảng-giá-bang-gia)
21. [Ví & ngân sách (nạp tiền, trừ tiền theo lượt)](#21-ví--ngân-sách-nạp-tiền-trừ-tiền-theo-lượt)
    - [21.1. Ví nhận tiền của admin](#211-ví-nhận-tiền-của-admin)
    - [21.2. Admin nạp tiền cho tài khoản](#212-admin-nạp-tiền-cho-tài-khoản)
    - [21.3. Trừ tiền theo lượt chạy & tự tạm dừng khi hết tiền](#213-trừ-tiền-theo-lượt-chạy--tự-tạm-dừng-khi-hết-tiền)
    - [21.4. Người dùng theo dõi số dư](#214-người-dùng-theo-dõi-số-dư)

## 1. App làm gì

App dùng **@omnilogin/sdk** điều khiển các profile trình duyệt OmniLogin để tạo lượt truy cập Google
có kiểm soát: gõ từ khóa → tìm → bấm vào URL đích → ở lại đọc (cuộn, dừng) → xem trang con.
Mỗi lượt đi qua proxy riêng, có fingerprint riêng, có thể giải captcha tự động.

App có **hai chế độ dùng**:

| Chế độ | Trang | Dùng khi nào |
| --- | --- | --- |
| Chạy đơn (thủ công) | `/` | Thử 1 lượt: kiểm tra profile, proxy, captcha, từ khóa/thứ hạng có vào được không |
| Hệ thống chiến dịch đa người dùng | `/my`, `/admin`, `/campaign` | Chạy tự động lâu dài: nhiều từ khóa, chỉ tiêu mỗi giờ/ngày, nhiều tài khoản, có duyệt & thống kê |

Khi chạy đơn thì cấu hình lưu ở `config.json`. Khi đã dùng hệ thống chiến dịch (chế độ CSDL) thì
từ khóa nằm trong bảng `campaigns` của `data/omni.db`, còn `data/campaign.json` chỉ giữ **cấu hình engine**.

## 2. Cài đặt lần đầu

### 2.1. Cần có

- **Windows 10/11** (app dùng PowerShell để cảnh báo desktop, đưa cửa sổ profile lên trước, đo RAM/CPU).
- **Node.js ≥ 20** (máy đang chạy đã kiểm tra: `node -v` → v24.18.1).
- **OmniLogin desktop** đã cài và đã **bật Bridge API ở cổng 35353** (Settings → API trong OmniLogin).
  Mặc định app tìm `%LOCALAPPDATA%\Programs\omnilogin\Omnilogin.exe`.
- Tuỳ chọn: tài khoản **proxy Webshare** (xoay IP), **CapSolver API key** (giải captcha tự động),
  **Telegram bot** (báo cáo/thông báo).

### 2.2. Các bước

```bat
cd "C:\CONG VIEC\CLOUD CODE\Omni"

npm install                 :: cài thư viện (better-sqlite3, bcrypt, jsonwebtoken, @omnilogin/sdk, nopecha)
:: tạo file .env ở thư mục Omni theo mẫu bên dưới (file .env không được commit)
npm run db:init             :: tạo/cập nhật CSDL data\omni.db (chạy lại nhiều lần vẫn an toàn)
npm run seed:admin -- admin <mật-khẩu-≥8-ký-tự>
npm run db:import -- --dry  :: (tuỳ chọn) xem trước từ khóa cũ trong data\campaign.json
npm run db:import           :: (tuỳ chọn) nhập từ khóa cũ vào CSDL
```

File `.env` tối thiểu (không commit file này):

```ini
PORT=3300
AUTH_REQUIRED=1
JWT_SECRET=<chuỗi-ngẫu-nhiên-≥32-ký-tự>
JWT_EXPIRES_IN=7d
BCRYPT_ROUNDS=12
# COOKIE_SECURE=1        # bật khi chạy sau HTTPS
# AUTH_COOKIE=omni_token
# ---- cổng công khai `/` (trang chủ 2 tab Người dùng / Quản trị) ----
# PUBLIC_URL=https://ten-mien-cua-ban   # dùng cho canonical/og:url + sitemap; để trống = http://localhost:PORT
# REGISTER_OPEN=1                       # 0 = đóng đăng ký tự do (chỉ admin tạo tài khoản ở /admin)
# REGISTER_PER_10MIN=3                  # chống spam: số lần đăng ký tối đa cho mỗi IP trong 10 phút
```

`JWT_SECRET` là bắt buộc khi bật đăng nhập: thiếu hoặc ngắn hơn 16 ký tự thì `/api/login` trả lỗi.
**Đổi `JWT_SECRET` = mọi phiên đăng nhập cũ hết hiệu lực** (phải đăng nhập lại).

## 3. Khởi động & dừng app

### 3.1. Hai cách khởi động

**Cách 1 — bấm `start.bat`** (khuyến nghị cho người dùng cuối):

- Nếu cổng 3300 **đang có app chạy**: script chỉ mở trình duyệt tới `http://localhost:3300`, không chạy thêm
  (tránh lỗi `EADDRINUSE`).
- Nếu chưa chạy: script mở server rồi sau ~3 giây tự mở trình duyệt, và in ra các đường dẫn:
  - Cổng công khai (2 tab Người dùng / Quản trị): `http://localhost:3300/`
  - Bảng giá công khai: `/bang-gia` (xem **mục 20**)
  - Bảng điều khiển của tôi: `/my` — Chiến dịch: `/campaign` — Chạy thử một lượt: `/test`
- **Đóng app**: quay lại cửa sổ console và nhấn `Ctrl+C` → app dọn profile tạm của các luồng đang chạy rồi thoát.

**Cách 2 — dòng lệnh** (khi phát triển / chạy trên server):

```bat
cd "C:\CONG VIEC\CLOUD CODE\Omni"
npm start                  :: = node --env-file-if-exists=.env server.mjs
```

Đổi cổng: sửa `PORT` trong `.env` (và `set "PORT=3300"` trong `start.bat` nếu dùng script).

### 3.2. Khi server vừa khởi động, nó làm gì

1. Nạp cấu hình engine từ `data/campaign.json`; thử kết nối CSDL `data/omni.db` → nếu được thì bật **chế độ CSDL**
   (`dbMode=true`, đọc từ khóa từ bảng `campaigns`).
2. Kiểm tra OmniLogin (cổng API 35353). Nếu chưa chạy và bật "Tự mở OmniLogin" thì tự mở `Omnilogin.exe` và chờ API lên.
3. Dọn **profile tạm** còn sót của lần chạy trước (tên bắt đầu bằng `omni-w-`).
4. Bật lại các chiến dịch đang chạy dở (nếu có) và bắt đầu nhịp lập lịch **5 giây/lần**.
5. Chạy việc nền mỗi 60 giây: reset chỉ tiêu theo ngày, mở lại chiến dịch `done` của hôm trước, kiểm tra RAM, gửi báo cáo Telegram nếu tới giờ.

Log ra cửa sổ console; khi chạy nền có thể xem `data\server.out.log` và `data\server.err.log`.

## 4. Đăng nhập & phân quyền

- Mở các trang trong cổng (`/my`, `/admin`, `/campaign`, `/test`) mà chưa đăng nhập thì bị đưa về `/login?next=...`; đăng nhập xong quay lại đúng trang định vào.
  Riêng **cổng công khai `/`** (2 tab Người dùng / Quản trị), **bảng giá `/bang-gia`**, `/login`, `/robots.txt`, `/sitemap.xml` mở cho cả khách chưa đăng nhập — đây là địa chỉ để chia sẻ/gửi Google (xem **mục 19** và **mục 20**).
- **Có đăng ký tự do** ở tab **Người dùng** của cổng `/`: tài khoản tạo ra có vai trò `user` và dùng được đầy đủ tính năng ngay — **không còn hạn mức chạy song song**, cũng không có hạn mức lượt/ngày.
  Muốn đóng đăng ký: đặt `REGISTER_OPEN=0` trong `.env` rồi khởi động lại. Tài khoản do **quản trị viên** tạo vẫn là mặc định an toàn nhất.
  Mật khẩu lưu dạng băm bcrypt trong bảng `users`, không ai đọc được (kể cả admin).
- Nếu chưa có tài khoản admin nào, trang `/login` hiện gợi ý chạy lệnh CLI kèm link **Tự đăng ký tại cổng** — làm theo **mục 4.1**.
- Đăng nhập bằng tài khoản lưu trong bảng `users` của `data/omni.db`. Token JWT nằm trong **cookie httpOnly `omni_token`**, hạn 7 ngày.
- Tạo/đặt lại tài khoản:
  - Trên UI: `/admin` → **Tài khoản người dùng** → nhập tên, mật khẩu (≥ 8 ký tự), vai trò.
  - Bằng CLI: `npm run seed:admin -- <tên> <mật-khẩu>` (mặc định tạo `admin`; thêm `--role user` nếu muốn tài khoản thường), `npm run seed:admin -- --list`.
- Nhấn link **Thoát** ở góc phải header để đăng xuất (`POST /api/logout` xoá cookie).

### 4.1. Tạo tài khoản (đăng ký)

**Cách nhanh nhất — tự đăng ký ở cổng công khai `/` (tab 👤 Người dùng):**

1. Mở `http://localhost:3300/` → tab **Người dùng (User)** → khối **1. Tạo tài khoản miễn phí**.
2. Điền **Tên đăng nhập** (3–32 ký tự: chữ, số, `. _ -`), **Tên hiển thị** (không bắt buộc), **Mật khẩu** (≥ 8 ký tự) và **Nhập lại mật khẩu**.
3. Bấm **Tạo tài khoản & vào bảng điều khiển** → tài khoản có vai trò `user`, phiên đăng nhập được tạo luôn và trình duyệt mở `/my`.
4. Admin nhận **thông báo trong app** ngay khi có người tự đăng ký (kèm IP) và thấy tài khoản ở `/admin` → **Tài khoản người dùng**
   để đổi vai trò hoặc **khoá** nếu là spam.
5. **Đóng đăng ký**: đặt `REGISTER_OPEN=0` trong `.env` rồi khởi động lại → cổng vẫn xem được nhưng biểu mẫu báo *"Đăng ký đang tạm đóng"*.
6. **Chống spam**: tối đa `REGISTER_PER_10MIN` lần cho mỗi IP trong 10 phút (mặc định 3); vượt thì API trả `429` kèm `Retry-After`.
   Dữ liệu gửi sai (thiếu ký tự, trùng tên) **không** bị tính vào giới hạn này.

**Tài khoản admin đầu tiên (bắt buộc dùng dòng lệnh — chỉ chạy 1 lần):**

```powershell
cd "C:\CONG VIEC\CLOUD CODE\Omni"
# Cách 1: tránh lộ mật khẩu trong lịch sử lệnh
$env:OMNI_PASSWORD = "MatKhauCuaToi@2026"    # ví dụ — hãy đặt mật khẩu riêng của bạn
npm run seed:admin -- admin
# Cách 2: truyền trực tiếp
npm run seed:admin -- admin MatKhauCuaToi@2026
npm run seed:admin -- user1 MatKhauCuaToi@2026 --role user   # tạo tài khoản thường

npm run seed:admin -- --list    # xem lại danh sách tài khoản
```

- Tên đăng nhập: 3–32 ký tự, chỉ chữ/số và `. _ -`. Mật khẩu: **≥ 8 ký tự** (nên ≥ 12, có chữ + số).
- **Không truyền `--role` thì mặc định là `admin`** — muốn tài khoản thường phải ghi rõ `--role user`.
- Nếu tên đã tồn tại, lệnh sẽ **cập nhật** mật khẩu + vai trò của tài khoản đó (đây cũng là cách **đặt lại mật khẩu** khi quên).
- Lệnh này ghi thẳng vào `data/omni.db`, **không cần dừng server**. Nhưng nhớ đặt `JWT_SECRET` trong `.env`
  (≥ 16 ký tự): thiếu thì đăng nhập đúng mật khẩu vẫn báo lỗi `500` — *"Thiếu JWT_SECRET (tối thiểu 16 ký tự)…"*.
- Thiếu mật khẩu (không truyền và cũng không có `OMNI_PASSWORD`) thì lệnh chỉ in hướng dẫn rồi thoát, **không ghi gì** vào CSDL.

**Tài khoản người dùng thường (làm trên web cho tiện):**

1. Đăng nhập bằng tài khoản `admin` → mở `/admin`.
2. Khối **Tài khoản người dùng** → điền **Tên đăng nhập**, **Mật khẩu (≥ 8 ký tự)**, **Vai trò** (`user`/`admin`),
   **Số chiến dịch chạy đồng thời** (1–100).
3. Bấm **Tạo tài khoản**. Người mới sẽ thấy thông báo *"Tài khoản của bạn đã được tạo"* khi đăng nhập.
4. **Đổi vai trò về sau (cấp / thu quyền admin):** ở bảng tài khoản, dòng của người đó bấm **Cấp quyền admin**
   (hoặc **Thu quyền admin** để trả về người dùng thường) rồi xác nhận. Quyền có hiệu lực **ngay lập tức**, kể cả
   với phiên đang mở của người đó (hạ quyền xong, cửa sổ đó bị đẩy về `/my`).
   - **Test song song admin + user:** giữ một cửa sổ là admin, mở thêm **cửa sổ ẩn danh** (Ctrl+Shift+N) hoặc trình
     duyệt khác rồi đăng nhập tài khoản `user` — mỗi cửa sổ có phiên riêng nên dùng được cả 2 tính năng cùng lúc
     (admin vẫn duyệt chiến dịch ở cửa sổ này, user gửi/nhận thông báo ở cửa sổ kia).
   - **Tài khoản của chính bạn** cũng đổi vai trò được (tiện hạ xuống `user` để xem đúng giao diện người dùng), nhưng
     chỉ khi **còn ít nhất một admin hoạt động khác** — đây là chốt để bạn không tự khoá cửa quản trị. Nếu bạn là
     admin duy nhất thì dòng của bạn ghi *“admin duy nhất”* và **không có nút**; muốn hạ quyền lúc đó thì tạo/cấp
     quyền admin cho tài khoản khác trước, hoặc chạy `npm run seed:admin -- <tên> --role admin` để lấy lại quyền.
5. Gửi cho họ địa chỉ app (ví dụ `http://<ip-máy>:3300`), tên đăng nhập + mật khẩu. Họ **tự đổi mật khẩu được không?**
   — Không; muốn đổi thì admin bấm **Đặt lại mật khẩu** ở bảng tài khoản, hoặc chạy lại lệnh `seed:admin` với tên đó.

> Lỗi hay gặp: *"Tên đăng nhập ... đã tồn tại."* → tên bị trùng, chọn tên khác (hoặc dùng lệnh CLI để cập nhật chính tài khoản đó).
> *"Mật khẩu cần tối thiểu 8 ký tự."* → gõ dài hơn.

| Quyền | `user` | `admin` |
| --- | --- | --- |
| Xem cổng công khai `/` (kể cả chưa đăng nhập) | ✔ | ✔ |
| Xem `/my` | ✔ | ✔ |
| Xem `/campaign`, `/test` (cấu hình engine + chạy thử một lượt) | bị chuyển về `/my` | ✔ |
| Tạo chiến dịch (vào hàng chờ duyệt) | ✔ | ✔ |
| Sửa/xoá chiến dịch của mình | ✔ (sửa xong phải **duyệt lại**) | ✔ |
| Duyệt / từ chối chiến dịch | ✖ | ✔ |
| Bật/tắt, sửa chiến dịch của người khác | ✖ | ✔ |
| Quản lý tài khoản, xem nhật ký thao tác | ✖ | ✔ |
| Cấp / thu quyền admin cho tài khoản khác, kể cả tài khoản của mình (khi còn admin khác) | ✖ | ✔ |
| Xem `/admin` | bị chuyển về `/my` | ✔ |

`AUTH_REQUIRED=0` sẽ tắt hẳn cổng đăng nhập (mọi request được coi như admin) — **chỉ dùng khi gỡ lỗi**, nhớ bật lại `1` sau đó.

## 5. Trang chạy đơn `/test`

> **Đã đổi địa chỉ:** trang chạy đơn giờ ở **`/test`** (trước đây là `/`). Địa chỉ `/` là **cổng công khai 2 tab** (xem mục 19).
> Trang này cùng `/campaign` chỉ mở cho tài khoản vai trò `admin`; người dùng thường bị chuyển về `/my`.

Dùng để **thử một lượt thủ công** trước khi đưa từ khóa vào chiến dịch: kiểm tra profile/proxy/captcha và xem thứ hạng.

| Ô / nút | Ý nghĩa |
| --- | --- |
| **Từ khóa** | Từ khóa sẽ gõ trên Google (mặc định `Omnilogin`). |
| **URL cần vào** | Chỉ ghi **domain** → khớp mọi trang của domain đó (kể cả subdomain). Có **đường dẫn** → khớp những URL **bắt đầu bằng** đường dẫn đó. **Để trống** → chỉ tìm kiếm, không bấm vào đâu. |
| **Số trang tìm tối đa** | 1–10. Không thấy URL ở trang 1 thì tìm tiếp trang 2, 3… (dùng khi hay gặp "không tìm thấy"). |
| **Profile OmniLogin** | Chọn profile từ danh sách của OmniLogin; nút **Tải lại** để nạp lại. Profile luôn mở **có giao diện** (không headless) để xem trực tiếp. |
| **Ở lại trang đích (giây)** | Khoảng `min–max`; mỗi lượt lấy ngẫu nhiên trong khoảng. Trong lúc ở lại, app tự cuộn lúc nhanh lúc chậm và dừng đọc (kiểu người thật — mục 10.11). Đặt `0–0` để **bỏ qua** bước này (chỉ vào rồi thoát). |
| **Số trang con** | 0, 1 hoặc 2. Trang con là liên kết **nội bộ** của site, chọn ngẫu nhiên. |
| **Ở lại mỗi trang con (giây)** | Khoảng thời gian đọc mỗi trang con. |
| **Đóng profile sau khi chạy xong** | Tích thì app đóng profile khi hết lượt (đỡ tốn RAM); không tích thì để profile mở để xem tay. |
| **Thực thi quy trình** | Bắt đầu chạy. Chỉ chạy **một lượt mỗi lần**; nếu đang có lượt khác thì báo "Đang có một lượt chạy khác". |

Kết quả hiển thị ở khung dưới:

- **Nhật ký**: từng bước theo thời gian thực (mở profile, IP, tìm Google, gặp captcha, ở lại, dọn dẹp…).
- **Đã vào trang (kết quả trang X, vị trí #Y)**: xác nhận đã bấm đúng URL đích và nó nằm ở đâu trong kết quả.
- **Ở lại trên site tổng N giây**: danh sách trang đã xem, thời gian và độ sâu cuộn của mỗi trang.
- **Danh sách kết quả tự nhiên**: tiêu đề + URL, mục đã bấm được đánh dấu **ĐÃ BẤM** (tiện xem đối thủ xếp trên).

Mỗi lần chạy, cấu hình được **lưu vào `config.json`** nên lần sau mở trang vẫn còn giá trị cũ.

## 6. Trang chiến dịch của tôi `/my`

Đây là nơi người dùng làm việc hằng ngày. Giao diện gồm **thanh bên tối bên trái** (menu), **thanh trên màu xanh** (nút ☰ ẩn/hiện menu,
đổi sáng/tối, tên tài khoản, **Đăng xuất**) và vùng nội dung; điện thoại thì menu thu gọn sau nút ☰. Mỗi mục menu là một **màn hình**
(địa chỉ `/my#thong-ke`, `#chien-dich`, `#tao-chien-dich`, `#ngan-sach`, `#thong-bao` — liên kết cũ `#notifs` vẫn dùng được).
Số liệu được tải khi mở trang, khi bấm **Tải lại** hoặc sau mỗi thao tác; panel **Đang chạy** cập nhật liên tục qua **SSE**
(`/api/events`), còn thông báo tự làm mới mỗi 60 giây.

| Menu | Màn hình |
| --- | --- |
| 📊 **Thống kê** | Thông báo mới nhất · 3 thẻ màu (chiến dịch đang chạy `x / y`, lượt chạy hôm nay, số dư + nút **+ Nạp thêm**) · Báo cáo chiến dịch (biểu đồ + bảng theo ngày có dòng **Tổng**) · Traffic theo từ khóa · 2 khối thu gọn *Lượt chạy gần đây*, *Đang chạy* |
| 📢 **Chiến dịch → Danh sách** | Ô lọc ID / từ khóa / domain, nút **+ Thêm chiến dịch**, tab lọc theo trạng thái, bảng chiến dịch và khung **Sửa** |
| 📢 **Chiến dịch → Tạo chiến dịch** | Biểu mẫu tạo chiến dịch (mục 6.1). Gửi xong tự chuyển sang danh sách, tab **Chờ duyệt** |
| 👤 **Tài khoản & Nạp tiền → Ngân sách** | 5 thẻ màu (còn lại · đã chạy · đã nạp · khuyến mại · tổng) + bảng **Giao dịch gần đây** (tab *Nạp tiền* / *Khuyến mại*) |
| 👤 **Tài khoản & Nạp tiền → Thông báo** | Danh sách thông báo + **Đánh dấu đã đọc tất cả**; số chưa đọc hiện ở thanh bên |
| 🛡 **Quản trị** (chỉ admin) | Liên kết sang `/admin`, `/campaign`, `/test` |

**Dùng trên điện thoại / máy tính bảng** (cả `/my` và `/admin`, kiểm tra ở 360 · 390 · 768 · 1024 · 1440 px): từ **900px trở xuống** thanh bên thu thành ngăn kéo (bấm ☰, bấm vùng tối để đóng),
các bảng thao tác (danh sách chiến dịch, giao dịch, tài khoản, chờ duyệt) hiện thành **thẻ** — mỗi ô có nhãn cột, trường ngắn xếp nhiều cột, nút **Sửa / Xoá / Duyệt** nằm cuối thẻ;
nút bấm cao ≥ 36–40px và ô nhập cỡ 16px (iPhone không tự phóng to khi chạm); thẻ số liệu xếp 2 cột; tab lọc cuộn ngang; biểu đồ vẽ theo bề rộng màn hình.
Bảng báo cáo (theo ngày, theo từ khóa, lượt chạy, luồng đang chạy, nhật ký) vẫn là bảng, **vuốt ngang** để xem hết cột. Khung dùng chung nằm ở `ui.css` (khối "KHUNG ỨNG DỤNG" và "TƯƠNG THÍCH ĐIỆN THOẠI").
Thêm bảng mới muốn có dạng thẻ: gắn `class="tbl-stack"` cho `<table>`, `class="tbl-wrap stack"` cho khung bọc, và `data-label="Tên cột"` cho từng `<td>`.

### 6.1. Tạo chiến dịch mới

| Ô | Ý nghĩa |
| --- | --- |
| **Loại chiến dịch** | 5 preset (xem [mục 9](#9-5-loại-chiến-dịch)). Chọn loại là engine tự biết có qua Google hay không, ở lại bao lâu, xem mấy trang con. |
| **Từ khóa** | Từ khóa sẽ tìm trên Google. **Chỉ nhập từ khóa** — dán lẫn URL vào ô này (kiểu `soi kèo nhà cái https://brfo.io/`) làm Google nhận truy vấn vô nghĩa và lượt chạy báo `notfound` dù kết quả vẫn hiện. App tự tách URL ra khi dán, và chặn nếu ô này chỉ có URL. |
| **URL đích** | URL/domain cần có lượt truy cập. Để trống vẫn được nếu URL đã dán lẫn trong ô từ khóa (app tự lấy ra). |
| **Kiểu truy vấn gõ lên Google** | **Chỉ từ khóa** (mặc định) = Google nhận đúng từ khóa — dùng khi site **đã có thứ hạng**. **Từ khóa + tên miền** = Google nhận `từ khóa + tên miền đích` (vd `soi kèo nhà cái https://brfo.io`) — dùng khi site **chưa lên hạng**, vì gõ từ khóa trần thì site không xuất hiện nên không có lượt hiển thị nào. Chi tiết: [mục 10.16](#1016-kiểu-truy-vấn-chỉ-từ-khóa-hay-từ-khóa--tên-miền). |
| **Luồng chạy song song tối đa** | Số luồng mà **chiến dịch này** được chiếm cùng lúc: `1` = tuần tự (mặc định), `3` = engine mở tối đa 3 cửa sổ Chrome cho từ khóa này khi trễ lịch. Không vượt được **Số luồng tối đa** của engine. Chi tiết: [mục 10.17](#1017-một-chiến-dịch-được-chạy-bao-nhiêu-luồng-cùng-lúc). |
| **Số lượt mỗi kỳ** | Chỉ tiêu: 1–10000 lượt cho mỗi **giờ** hoặc mỗi **ngày**. |
| **Đơn vị** | `lượt / ngày` (rải đều cả ngày) hoặc `lượt / giờ` (mỗi giờ trong khung hoạt động đủ số lượt đó). |
| **Bắt đầu / Kết thúc** | Tuỳ chọn. Để trống = chạy ngay và không có hạn kết thúc. Ngoài khoảng này engine không chạy chiến dịch đó. |
| **Ghi chú gửi admin** | Mục tiêu/thời gian mong muốn — admin đọc khi duyệt. |
| **Gửi duyệt** | Tạo chiến dịch ở trạng thái **chờ duyệt**; admin nhận thông báo trong app. |

Dưới ô ghi chú có dòng **tình hình vận hành** dạng:
`Đang bật <số> chiến dịch · <đang chờ>/<tối đa> chờ duyệt · tổng <đã có>/<tối đa> chiến dịch · <số lượt hôm nay> lượt hôm nay`.

- **Không còn hạn mức "số chiến dịch chạy song song"** (mô hình gói tự cài đã gỡ 30/09/2026): chiến dịch nào được duyệt
  thì bật được; engine chạy song song khi còn **Số luồng tối đa** (ở `/campaign`) và đủ RAM.
- **Chống spam khi tạo**: gửi duyệt được tối đa **3** chiến dịch cùng lúc và giữ tối đa **50** chiến dịch
  (hằng số `MAX_PENDING` / `MAX_TOTAL` trong `api.mjs`) — xem [mục 10.7](#107-hạn-mức-tài-khoản).
- **Không còn hạn mức lượt/ngày** theo tài khoản: engine chỉ chạy theo **chỉ tiêu của từng chiến dịch** (`count` + `unit`),
  nên dòng `<số lượt hôm nay> lượt hôm nay` chỉ để xem. Muốn chạy nhiều/ít hơn thì sửa chỉ tiêu của chiến dịch.
- **Số dư** ([mục 21](#21-ví--ngân-sách-nạp-tiền-trừ-tiền-theo-lượt)): thẻ xanh lá ở màn **Thống kê** và 5 thẻ ở màn **Ngân sách**, **cập nhật realtime**.
  Người dùng chỉ thấy các số **tổng** và lịch sử **nạp tiền / khuyến mại**; tiền trừ **từng chiến dịch** và sổ giao dịch chạy chiến dịch không hiện ở phía người dùng — admin xem ở `/admin`.

### 6.2. Các khối trên trang

- **Thẻ số liệu (Thống kê)**: *Chiến dịch đang chạy* = số chiến dịch đang chạy / số chiến dịch đã duyệt; *Lượt chạy hôm nay*; *Số dư còn lại* kèm **+ Nạp thêm**.
  Bấm **+ Nạp thêm** mở hộp thoại cho biết **chuyển tiền vào đâu** (địa chỉ USDT + mạng + tỷ giá, ngân hàng — có nút **Sao chép**); chưa cấu hình thì báo liên hệ admin.
- **Trạng thái engine**: dòng dưới 3 thẻ ("Engine đang chạy · N luồng…" hoặc "Engine đang tạm dừng — chiến dịch phải được admin duyệt và bật mới chạy.").
- **Báo cáo chiến dịch**: chọn chiến dịch + 7/30/90 ngày → thẻ tổng (lượt hôm nay, tổng lượt, ok, captcha, lỗi), biểu đồ cột theo ngày và **bảng theo ngày**
  (Tổng lượt · ok · không thấy URL · captcha · lỗi · tỷ lệ ok, dòng **Tổng** ở đầu).
- **Chiến dịch → Danh sách**: ô lọc **ID / từ khóa / domain** (lọc ngay khi gõ) và **tab trạng thái** kèm số đếm: *Tất cả · Chờ duyệt · Đang chạy ·
  Tạm dừng / Đã dừng · Không được duyệt · Đủ chỉ tiêu hôm nay*. Bảng gồm ID · Chiến dịch (từ khóa, URL, giờ tạo, truy vấn gửi Google, ghi chú, lý do từ chối) ·
  Loại traffic · Chỉ tiêu · **Vị trí Google** · Trạng thái (2 nhãn: duyệt + chạy) · Tiến độ hôm nay · Thao tác.
  - Cột **Vị trí Google** hiện vị trí **mới nhất của từng thiết bị** dạng `🖥 #3 · 📱 #14` (Google xếp hạng khác
    nhau cho máy tính và di động) — xem mục 10.15.
  - Nút thao tác: **Tạm dừng** (khi đang chạy), **Chạy** (khi đã duyệt nhưng chưa chạy), **Dừng** (khi đang chạy hoặc tạm dừng),
    **Sửa**, **Xoá**. Cột *Chỉ tiêu* hiện `N lượt/giờ|ngày` kèm `≈ N lượt/ngày` để dễ so sánh giữa hai đơn vị.
  - **Xoá** chiến dịch đã có lượt chạy thì app chỉ **dừng** để giữ lịch sử/thống kê; cần xoá hẳn thì nhờ admin.
- **Sửa chiến dịch**: sửa từ khóa, URL, loại, số lượt, đơn vị, ghi chú → **Lưu & gửi duyệt lại**
  (chiến dịch quay về **chờ duyệt**, admin phải duyệt lại thì mới chạy tiếp).
- **Traffic theo từ khóa**: bảng tổng hợp theo từng từ khóa (dùng để so sánh hiệu quả các chiến dịch).
- **Lượt chạy gần đây** (khối thu gọn, bấm tiêu đề để mở): từng lượt gần nhất kèm kết quả (`ok`, `notfound`, `captcha`, `error`), **thiết bị** của lượt
  (máy tính / di động), số giây, **vị trí** trên Google và IP.
- **Đang chạy** (khối thu gọn; realtime qua SSE, không cần tải lại): Luồng · Từ khóa · Bước đang làm · Đã chạy (giây) · IP · RAM/CPU.
- **Ngân sách**: 5 thẻ màu và bảng *Giao dịch gần đây* gồm Ngày · Mã giao dịch · Số tiền · USDT · Tỷ giá · Phương thức thanh toán · Trạng thái;
  chuyển tab **Nạp tiền** / **Khuyến mại** để xem từng loại.
- **Thông báo**: chiến dịch được duyệt/từ chối, đủ chỉ tiêu…; nút **Đánh dấu đã đọc tất cả**. Thông báo mới nhất cũng hiện nổi bật ở đầu màn Thống kê.

## 7. Trang quản trị `/admin`

Chỉ tài khoản role `admin` mở được. Giao diện dùng **cùng khung với `/my`** (thanh bên tối + thanh trên xanh, nút ☰ ẩn/hiện menu, điện thoại thì thu gọn
sau nút ☰). Mỗi mục menu là một **màn hình** (địa chỉ `/admin#tong-quan`, `#cho-duyet`, `#chien-dich`, `#tai-khoan`, `#nap-tien`, `#giao-dich`,
`#thong-bao`, `#nhat-ky`; liên kết cũ `#notifs` vẫn dùng được). Số **chờ duyệt** và **thông báo chưa đọc** hiện thành chấm đỏ ở thanh bên.
Panel **Đang chạy** cập nhật qua SSE; danh sách tài khoản và thông báo tự làm mới mỗi 60 giây; các bảng khác tải khi mở trang, khi bấm **Tải lại** / **Lọc**,
hoặc sau mỗi thao tác.

| Menu | Màn hình |
| --- | --- |
| 📊 **Tổng quan** | 5 thẻ màu (chiến dịch đang chạy `x / y`, **chờ duyệt**, lượt chạy hôm nay, tài khoản hoạt động, tổng số dư của khách) · thanh trạng thái engine + 3 nút · Traffic toàn hệ thống (biểu đồ + bảng theo ngày có dòng **Tổng**) · bảng **Đang chạy** (luồng của mọi người dùng, có cột Chủ sở hữu) |
| 📢 **Chiến dịch → Chờ duyệt** | Danh sách chiến dịch chờ duyệt, ô lọc, nút **Duyệt / Từ chối / Sửa** |
| 📢 **Chiến dịch → Tất cả chiến dịch** | Lọc theo từ khóa/URL/tên + trạng thái duyệt + trạng thái chạy; bảng chiến dịch của mọi tài khoản |
| 👥 **Tài khoản & Ví → Tài khoản** | Tạo tài khoản + bảng tài khoản (ghi chú dài thu gọn sẵn) |
| 👥 **Tài khoản & Ví → Nạp tiền & ví nhận tiền** | Hai khung cạnh nhau: nạp tiền / điều chỉnh số dư và ví nhận tiền của admin |
| 👥 **Tài khoản & Ví → Sổ giao dịch** | Sổ giao dịch ví của **mọi** tài khoản (lọc theo tài khoản và loại giao dịch) |
| 🧰 **Hệ thống → Thông báo / Nhật ký thao tác** | Thông báo dành cho admin; nhật ký ai đã duyệt/từ chối/bật/dừng/sửa/xoá gì, khi nào |
| ⚙ **Cấu hình chạy**, ▶ **Chạy thử**, 👤 **Giao diện người dùng** | Liên kết sang `/campaign`, `/test`, `/my` |

**Thanh trạng thái (màn Tổng quan)**: đèn + dòng trạng thái engine, và 3 nút:

| Nút | Việc |
| --- | --- |
| **Bật mọi chiến dịch đã duyệt** | Đặt tất cả chiến dịch `approved` (đang chờ/chưa chạy/tạm dừng) về `running`. |
| **Tạm dừng tất cả** | Đặt mọi chiến dịch đang chạy về `paused`. |
| **Tải lại** | Nạp lại toàn bộ số liệu. |

**Chi tiết các màn hình:**

- **Chờ duyệt**: # · Chủ sở hữu · Từ khóa/URL · Loại · Chỉ tiêu · Thao tác (**Duyệt**, **Từ chối**, **Sửa**).
  - **Duyệt** = chuyển `approved` **và bật chạy luôn** (`running`) → engine chạy ở nhịp lập lịch kế tiếp.
  - **Từ chối** = hộp thoại nhập lý do, người dùng nhận thông báo kèm lý do.
- **Sửa chiến dịch** (hộp thoại hiện khi bấm Sửa; bấm ra ngoài hoặc **Đóng** để thoát): từ khóa, URL đích, kiểu truy vấn, luồng song song tối đa,
  loại chiến dịch, số lượt mỗi kỳ, đơn vị, **Ưu tiên** (số lớn chạy trước), bắt đầu/kết thúc, ghi chú. Nút: **Lưu thay đổi**,
  **Duyệt & chạy**, **Từ chối**, **Xoá hẳn** (xoá cả lượt chạy đã ghi), **Đóng**.
- **Tất cả chiến dịch**: bấm **Lọc** (hoặc Enter). Mỗi dòng có nút trạng thái (**Chạy** / **Tạm dừng** / **Chạy tiếp** / **Chạy lại** — chỉ hiện khi đã duyệt)
  và **Sửa**; muốn **xoá** thì mở hộp thoại **Sửa chiến dịch** → **Xoá hẳn**. Cột **Vị trí Google** hiện vị trí mới nhất theo máy tính / di động.
- **Tài khoản người dùng**:
  - Tạo mới: Tên đăng nhập · Mật khẩu (≥ 8 ký tự) · Vai trò (`user`/`admin`). Chống spam khi tạo: mỗi tài khoản giữ tối đa 3 chiến dịch chờ duyệt và 50 chiến dịch.
  - Bảng tài khoản: # · Tài khoản · Vai trò · Trạng thái (hoạt động / đã khoá) · Chiến dịch (đang bật, kèm tổng số và số chờ duyệt) · Lượt hôm nay · Số dư · Đã chạy · Thao tác:
    **Nạp tiền** (chuyển sang màn *Nạp tiền & ví nhận tiền* và chọn sẵn tài khoản đó — xem [mục 21.2](#212-admin-nạp-tiền-cho-tài-khoản)),
    **Cấp quyền admin** / **Thu quyền admin** (đổi vai trò của tài khoản đã có, kể cả tài khoản của bạn — chỉ ẩn khi bạn là admin hoạt động duy nhất),
    **Khoá / Mở khoá**, **Đặt lại mật khẩu** (hộp thoại nhập mật khẩu mới), **Xoá**.
  - **Khoá tài khoản**: các chiến dịch đang chạy của tài khoản đó bị tạm dừng ngay và engine bỏ qua chiến dịch của họ.
- **Nạp tiền & ví nhận tiền** · **Sổ giao dịch** (xem [mục 21](#21-ví--ngân-sách-nạp-tiền-trừ-tiền-theo-lượt)): khai ví USDT/ngân hàng của admin để người dùng
  biết chuyển tiền vào đâu (họ thấy khi bấm **+ Nạp thêm** ở giao diện của họ), nạp tiền theo **USDT × tỷ giá** (ô *Tài khoản nhận* mặc định chọn khách hàng đầu tiên, không phải admin),
  điều chỉnh số dư (hoàn tiền / trừ bù) và xem sổ giao dịch của **mọi** tài khoản.
- **Nhật ký thao tác**: bấm **Xem** để tải lại theo đối tượng (chiến dịch / tài khoản / cấu hình).

## 8. Trang cấu hình engine `/campaign`

Trang này là **cấu hình chung cho cả engine** (không phải cấu hình từng chiến dịch). Ở chế độ CSDL, ô "danh sách từ khóa"
chỉ để xem — từ khóa thật nằm ở `/my`. Nút **Bắt đầu** / **Dừng** ở đây thao tác hàng loạt (giống 2 nút ở `/admin`).
Ngoài ra có nút gửi **báo cáo Telegram thử** và kiểm tra kết nối OmniLogin.

### 8.1. Hiệu năng & hành vi

| Ô | Ý nghĩa | Khuyến nghị |
| --- | --- | --- |
| **Số luồng tối đa** | Số profile chạy song song **trên toàn engine** (1–30) — không phải mỗi chiến dịch. Mỗi luồng ≈ 1 cửa sổ Chrome và mỗi chiến dịch chỉ chiếm 1 luồng tại một thời điểm. | 2–4 với máy 12–16 GB; 6–8 với 24 GB; **12–15 với 32 GB**; xem bảng ở mục 10.9 |
| **Thiết bị chạy traffic** | `Hỗn hợp 70% máy tính / 30% di động` (**mặc định — quy định chung**) · `Máy tính (Windows)` · `Di động (Android/iPhone)`. Lượt di động dùng profile Android/iPhone có UA di động + tương tác touch thật (mục 10.10). | Để nguyên mặc định. Chạy thuần di động: chọn `Di động` |
| **Tỉ lệ di động (%)** | Chỉ dùng ở chế độ `Hỗn hợp`: bao nhiêu % số lượt chạy bằng profile di động (0–100). Mặc định `30` — đúng quy định **70% máy tính / 30% di động**, chia theo **số lượt** (100 lượt/giờ = 70 lượt máy tính + 30 lượt di động). | 30 |
| **Số trang Google tìm** | Số trang kết quả tối đa khi tìm URL đích (1–10). | 5; hay gặp `notfound` thì tăng 8–10 |
| **Lượt "chỉ hiển thị" (1 / N lượt)** | Cứ N lượt **có tìm Google** thì 1 lượt chỉ gõ từ khóa rồi **thoát tab**, không bấm vào kết quả — site chỉ nhận **lượt hiển thị** trên Google. Chia theo **số lượt**; chỉ tính các lượt có bấm vào kết quả (chiến dịch "Chỉ tìm Google" / "Vào thẳng URL" không ảnh hưởng). `0` = tắt. | Để **20** (quy định chung — mục 10.14) |
| **Ở lại trang đích (giây)** | Khoảng thời gian đọc trang đích (tối đa 3600s = 1 giờ/trang). | 60–120; muốn lượt dài hơn thì chọn loại "đọc sâu" (mục 10.12) |
| **Số trang con** | 0–4 trang con nội bộ mỗi lượt. | 1; 3–4 khi cần lượt dài hơn |
| **Ở lại mỗi trang con (giây)** | Thời gian đọc mỗi trang con. | 20–45 |
| **Khung giờ chạy (giờ)** | Chỉ mở luồng trong khoảng này, ví dụ `8–23`. Nếu `from > to` (vắt qua nửa đêm) thì lịch rải trên cả 24h nhưng luồng vẫn chỉ mở trong khung. | 0–23 hoặc 8–23 |
| **RAM trống tối thiểu (MB)** | Dưới ngưỡng này engine **không mở thêm luồng** và ghi cảnh báo. | 800–1500 khi chạy 1–2 luồng; **3000–4000** khi chạy ≥ 8 luồng hoặc nhiều chiến dịch (mục 10.9) |
| **Chừa RAM mỗi luồng mới (MB)** | RAM trống chưa trừ ngay phần Chrome vừa mở, nên trong 90 giây đầu sau khi mở một luồng, engine đòi thêm ngần này RAM mới mở luồng kế tiếp. `0` = tắt (như bản cũ). | 650 khi chạy 1–2 luồng; **1200** khi chạy ≥ 8 luồng/chạy nhiều chiến dịch (RAM đỉnh thực đo ~1,1 GB/luồng — mục 10.9) |
| **Chế độ profile** | `Dùng lại nhóm cố định` (`omni-pool-N`, nhanh, đỡ tốn quota tạo profile) hoặc `Tạo mới mỗi lượt` (`omni-w-…`, sạch hơn, dọn sau mỗi lượt). | Xem mục 10.4 |
| **Tạo lại profile sau (lượt)** | Với chế độ pool: dùng lại profile bao nhiêu lượt thì xoá tạo cái mới. | 20 khi chạy 1–2 luồng; **30–50** khi chạy nhiều luồng (đỡ tốn hạn mức tạo profile — mục 10.9) |
| **Chạy ẩn (headless)** | Bật thì không hiện cửa sổ Chrome. **Lưu ý**: chế độ "chờ giải captcha tay" không hoạt động khi headless. | Tắt khi chạy RDP có màn hình |

### 8.2. Captcha

| Ô | Ý nghĩa |
| --- | --- |
| **Khi gặp captcha** | `Chờ tôi giải tay` · `Tự động CapSolver (fallback: chờ tay)` · `Đổi IP ngay`. |
| **CapSolver API key** | Dán key CapSolver khi chọn chế độ tự động. Chọn CapSolver mà bỏ trống key thì app báo lỗi khi bắt đầu chạy. |
| **Chờ giải tay (phút)** | Chờ tối đa bao nhiêu phút (1–15) trước khi coi lượt đó thất bại. |

### 8.3. Proxy

Hai kiểu proxy:

- **Proxy xoay (Webshare)**: Host · Port · **Username gốc** · Mật khẩu · **Quốc gia** (ví dụ `VN`).
  App tự thêm hậu tố session + quốc gia vào username để **mỗi lượt một IP** (sticky trong lượt đó).
- **Danh sách proxy**: dán mỗi dòng một proxy (các định dạng được nhận: xem [mục 12.2](#122-kiểu-danh-sách-proxy)).
  App luân phiên dùng, proxy lỗi bị **tạm loại** rồi tự quay lại.

| Ô | Ý nghĩa |
| --- | --- |
| **Loại mặc định** | `HTTP` / `HTTPS` / `Socks5` — dùng cho dòng proxy không ghi rõ scheme. |
| **Tạm loại sau (lần lỗi/captcha liên tiếp)** | Bao nhiêu lần lỗi/captcha liên tiếp thì bỏ proxy đó ra khỏi vòng xoay. **Chỉ áp dụng ở kiểu "Danh sách proxy"** — kiểu xoay lấy session mới mỗi lượt nên không có proxy nào để tạm loại. |
| **Thời gian tạm loại (phút)** | Sau bao lâu thì thử lại proxy bị tạm loại. **Chỉ áp dụng ở kiểu "Danh sách proxy"**. |

Lưu ý riêng cho kiểu **Proxy xoay**:

- **Luôn điền ô Quốc gia** (ví dụ `VN`). Để trống thì nhà cung cấp trả IP ngẫu nhiên nhiều nước, không khớp dấu vân tay
  `vi-VN` của app. App cảnh báo ngay trên trang khi bạn để trống, và ghi cảnh báo vào nhật ký khi bắt đầu chạy.
- Muốn soi chất lượng proxy **trước khi chạy thật**: `npm run proxy:check` — xem mục 12.4.

Trang `/campaign` hiển thị thống kê từng proxy: số lần thử · % captcha · % lỗi proxy · % thành công.
Ở kiểu **Proxy xoay**, mọi session bị gộp vào một dòng `host:port (xoay VN)` — cách tách theo từng IP: xem mục 12.4.

### 8.4. OmniLogin & Telegram

| Ô | Ý nghĩa |
| --- | --- |
| **Tự mở OmniLogin khi chưa chạy** | Server tự chạy `Omnilogin.exe` khi API cổng 35353 chưa lên. |
| **Đường dẫn Omnilogin.exe** | Để trống = tự dò `%LOCALAPPDATA%\Programs\omnilogin\Omnilogin.exe`. |
| **Bot token / Chat ID** | Thông tin bot Telegram để gửi thông báo. |
| **Gửi báo cáo ngày lúc (giờ)** | Mỗi ngày gửi báo cáo tổng kết 1 lần vào giờ này. |
| **Báo sự cố** | Gửi tin khi engine có sự kiện quan trọng (lỗi proxy, bật/tắt, hết quota…). |
| **Báo khi cần giải captcha** | Gửi tin khi một luồng phải chờ giải captcha tay (kèm cảnh báo desktop + đưa cửa sổ profile lên trước). |

## 9. 5 loại chiến dịch

Người dùng chỉ cần chọn **loại**; các tham số ở `/campaign` chỉ dùng khi chạy danh sách từ khóa cũ trong file.

| Loại | Khi nào dùng | Engine làm gì |
| --- | --- | --- |
| **Tìm Google → vào URL → đọc (tiêu chuẩn)** | Mặc định cho hầu hết chiến dịch | Tìm tối đa 5 trang, ở lại 60–120s, xem 1 trang con (20–45s) |
| **Tìm Google → bấm vào → thoát nhanh** | Muốn lượt "ghé qua" ngắn, tỷ lệ thoát cao | Tìm 5 trang, ở lại 5–15s, không xem trang con |
| **Chỉ tìm Google (không bấm vào URL)** | Kiểm tra từ khóa/thứ hạng, không tạo traffic | Chỉ truy vấn rồi dừng ở trang kết quả |
| **Vào thẳng URL (không qua Google)** | Cần traffic trực tiếp, **không** có referrer tìm kiếm | Mở URL đích, ở lại 60–120s, xem 1 trang con |
| **Tìm Google → vào URL → đọc sâu (thời gian dài)** | Cần lượt "chất" hơn / tăng thời gian mỗi lượt | Tìm 8 trang, ở lại 240–480s, xem 3 trang con (90–180s) ⇒ ≈ 9–20 phút/lượt (xem mục 10.12) |

## 10. Engine chạy như thế nào

### 10.1. Nhịp lập lịch

Engine "thức" **mỗi 5 giây** (`TICK_MS`) và lần lượt kiểm tra:

1. RAM trống có dưới ngưỡng **RAM trống tối thiểu** không → nếu có thì **không mở thêm luồng**, ghi cảnh báo.
2. Có đang trong **khung giờ chạy** không (`activeFrom`–`activeTo`).
3. Đồng bộ lại danh sách chiến dịch từ CSDL (để thay đổi của admin có hiệu lực ngay nhịp sau).
4. Với từng chiến dịch đủ điều kiện: còn đến lượt theo lịch chưa → mở luồng (nếu chưa đủ số luồng tối đa).
5. Mỗi 60 giây (việc nền): tính lại chỉ tiêu theo ngày, mở lại chiến dịch `done` của hôm trước, kiểm tra RAM, tới giờ thì gửi báo cáo Telegram.

### 10.2. Cách rải lượt trong ngày

- **Theo ngày (`count` lượt/ngày)**: khung giờ chạy được chia thành `count` khoảng bằng nhau; lượt thứ `i` rơi quanh
  **giữa khoảng thứ i**, xê dịch ngẫu nhiên **±30%** khoảng. Thời điểm của từng lượt là **cố định** theo (chiến dịch, ngày, thứ tự)
  nên không bị "nhảy" giữa các lần kiểm tra.
- **Theo giờ (`count` lượt/giờ)**: mỗi giờ trong khung chạy chia 60 phút thành `count` khoảng với cách rải tương tự.

Ví dụ: 500 lượt/ngày, khung 0–23 → mỗi khoảng ~2,8 phút, khoảng 500 luồng-lượt rải đều cả ngày (engine mở tối đa theo số luồng).

### 10.3. Điều kiện để một chiến dịch được chạy

Tất cả các điều kiện sau phải đúng:

- `approval_status = approved` (đã được admin duyệt) **và** `status = running`;
- chủ tài khoản đang `active` (không bị khoá);
- đang trong khoảng **Bắt đầu → Kết thúc** của chiến dịch (nếu có đặt);
- **đã đến lượt** theo lịch rải đều ở trên;
- engine còn **luồng trống** và RAM trống đủ ngưỡng.

Chỉ cần **một** chiến dịch đủ điều kiện là engine tự chạy; hết việc thì engine đứng yên (không cần bấm Dừng).
Admin **duyệt** một chiến dịch chính là hành động bật nó chạy (`approved` + `running`).

### 10.4. Hai chế độ profile

| Chế độ | Cách hoạt động | Ưu / nhược |
| --- | --- | --- |
| **Tạo mới mỗi lượt** (`fresh`) | Mỗi lượt tạo profile tạm `omni-w-<thời-gian>-<session>`, chạy xong **xoá luôn**. | Sạch nhất (mỗi lượt fingerprint + proxy mới), chậm hơn, tốn quota tạo profile của gói OmniLogin |
| **Dùng lại nhóm cố định** (`pool`) | Mỗi luồng giữ 1 profile `omni-pool-<số>`, dọn dữ liệu duyệt web (cookie/cache) sau mỗi lượt, dùng lại tới khi đủ **Tạo lại profile sau (lượt)** thì xoá tạo mới. | Nhanh, ít tốn quota; profile tồn tại lâu nên IP/fingerprint "quen" hơn |

Cả hai chế độ: profile tạm còn sót được **dọn khi server khởi động** và khi bạn nhấn `Ctrl+C`.
Tên profile cố định tách theo thiết bị — `omni-pool-1` (máy tính), `omni-pool-a1` (Android),
`omni-pool-i1` (iPhone) — để nhóm di động và máy tính không dùng chung một profile (mục 10.10).
Nếu gói OmniLogin **hết chỗ tạo profile** engine tự giảm số luồng; nếu bị **giới hạn tạo profile trong ngày (HTTP 429)**
thì engine ngừng tạo tới hôm sau và ghi cảnh báo.

### 10.5. Kết quả của một lượt

| Kết quả | Nghĩa | Có tính vào chỉ tiêu? |
| --- | --- | --- |
| `ok` | Vào được URL đích (hoặc mở URL trực tiếp thành công) | ✔ |
| `notfound` | Đã tìm nhưng **không thấy URL đích** trong số trang cho phép. Nhật ký/lỗi ghi kèm **tên miền đã thấy** (`Tên miền đã thấy: …`) để biết URL đích có lên hạng hay không — nếu tên miền của bạn **không** có trong danh sách đó thì site chưa lên hạng cho từ khóa ấy: đổi **Kiểu truy vấn** sang *Từ khóa + tên miền* (mục 10.16) | ✔ |
| `captcha` | Gặp captcha không vượt được (hết thời gian chờ / solver lỗi) | ✔ |
| `error` | Lỗi hạ tầng: proxy không kết nối được, đóng trình duyệt, lỗi mạng… | ✖ (chỉ thống kê lỗi) |

Mỗi lượt được ghi vào CSDL kèm từ khóa/URL **tại thời điểm chạy** (và **truy vấn thật đã gõ** vào `runs.query` khi kiểu truy vấn là *Từ khóa + tên miền*), nên admin sửa chiến dịch sau đó không làm sai số liệu cũ.

### 10.6. Đủ chỉ tiêu thì sao?

- Chiến dịch **theo ngày** đủ chỉ tiêu → tự chuyển `done`, gửi **thông báo trong app** cho chủ sở hữu
  ("Chiến dịch … đã đủ N lượt hôm nay — sẽ chạy tiếp vào ngày mai"), và **tự mở lại `running` vào ngày hôm sau**.
- Chiến dịch **theo giờ** không bị đánh dấu `done` (mỗi giờ lại tính lại chỉ tiêu).
- Chiến dịch chưa đủ chỉ tiêu mà ngày đã hết thì hôm sau chạy tiếp bình thường.

### 10.6b. Bấm Dừng / Tạm dừng giữa lúc đang chạy

- Engine **ngừng mở lượt mới** của chiến dịch ngay (cùng lúc API đổi trạng thái), và **huỷ luôn các lượt đang chạy dở** của chiến dịch đó: đóng trình duyệt
  của lượt, không thử lại, trong vài giây. Lượt bị huỷ **không ghi vào thống kê, không trừ tiền ví**, không làm chiến dịch bị nghỉ 2 phút.
  (Trước 10/10/2026 lượt đang chạy cứ chạy nốt 3–5 phút — loại "đọc sâu" tới ~20 phút — và vẫn ghi nhận + trừ tiền nên nhìn như "ấn dừng rồi mà vẫn chạy".)
- Cũng huỷ lượt đang chạy khi chiến dịch bị **thu hồi duyệt** (người dùng sửa chiến dịch → quay về *chờ duyệt*).
- **Không** huỷ khi chiến dịch chuyển `done` (đủ chỉ tiêu) — các lượt đang chạy nốt vẫn được ghi nhận như bình thường.
- Nếu lượt cuối vừa xong ngay sau khi bấm Dừng thì chiến dịch **giữ trạng thái `stopped`** (không bị ghi đè thành `done` rồi hôm sau tự bật lại).
- Lưu ý: nút **Bật mọi chiến dịch đã duyệt** ở `/admin` bật lại **cả** chiến dịch đã Dừng/Tạm dừng — chỉ bấm khi thật sự muốn chạy lại tất cả.

### 10.7. Hạn mức tài khoản

Chỉ còn **một hạn mức duy nhất** là hạn mức TẠO (chống spam). Hạn mức "số chiến dịch chạy đồng thời" đã **gỡ hẳn**
cùng mô hình gói tự cài/license (30/09/2026):

| Hạn mức | Cột CSDL | Ý nghĩa | Ai đổi |
| --- | --- | --- | --- |
| **Hạn mức tạo** (chống spam) | chốt trong `api.mjs` (`MAX_PENDING` / `MAX_TOTAL`) | Tối đa **3** chiến dịch **chờ duyệt** và **50** chiến dịch **tổng cộng**. Tạo/gửi duyệt không bị chặn bởi gì khác. | Sửa hằng số trong `api.mjs` rồi khởi động lại |

> **Không còn hạn mức "số chiến dịch chạy song song"**: chiến dịch đã duyệt thì bật được, không cần admin cấp quyền.
> Trần chạy thật do engine quyết định: **Số luồng tối đa** ở `/campaign` + RAM còn trống.
> **Không còn hạn mức lượt/ngày theo tài khoản** (bỏ từ 01/10/2026): engine chỉ chạy theo **chỉ tiêu của từng chiến dịch**
> (`count` + `unit`). Hai cột cũ `users.max_slots` và `users.daily_quota` vẫn nằm trong CSDL cho tương thích nhưng **không ai
> đọc**; số *Lượt hôm nay* ở `/admin` và dòng tình hình ở `/my` chỉ để **xem**, không chặn gì.

**Chạy nhiều chiến dịch song song** (2 bước):

1. `/campaign` → **Số luồng tối đa** ≥ số chiến dịch muốn chạy song song (mỗi chiến dịch chiếm 1 luồng khi tới lượt).
2. Đảm bảo đủ RAM: xem bảng chọn luồng theo RAM ở **mục 10.9**. Thiếu RAM thì engine vẫn không mở thêm luồng và có cảnh báo ở khung *Nhật ký*.

Ví dụ thực tế: máy 12 GB RAM, 2 luồng → cấp **2**; đóng bớt Chrome thừa rồi mới nâng lên 3–4 kèm tăng **Số luồng tối đa**.
Hạ hạn mức **không** tắt chiến dịch đang chạy — chỉ chặn bật thêm; muốn tắt thì tạm dừng từng chiến dịch.
Đổi **số chiến dịch chạy đồng thời** có hiệu lực ngay ở **nhịp lập lịch kế tiếp** (~5 giây) — engine nạp lại danh sách
chiến dịch mỗi nhịp nên **không cần khởi động lại**.


### 10.8. Khi lượt chạy gặp captcha

- Chế độ **CapSolver**: app đọc sitekey + `data-s` của trang `/sorry`, gửi CapSolver lấy token, chèn vào form và submit.
- Chế độ **chờ tay**: cửa sổ profile được **đưa lên trước**, có **bong bóng cảnh báo Windows + tiếng báo**, chờ tối đa
  "Chờ giải tay (phút)". Bạn giải tay trong cửa sổ đó; hết thời gian chờ thì lượt tính là `captcha`.
- **Trong lúc chờ giải tay, engine KHÔNG điều hướng trang**: đọc URL hụt (trang đang chuyển) cũng không bị coi là
  "đã qua captcha" hay "ngoài Google", nên **trang captcha không bị mở lại từ đầu** giữa lúc bạn đang giải — bạn
  luôn có trọn "Chờ giải tay (phút)". Sau khi qua captcha, trang kết quả Google đưa tới (kể cả khi truy vấn bị
  **mã hoá trong URL** — `?q=EgSr…`, hay gặp trên di động) được **quét luôn**, không tìm lại từ đầu.
- Chế độ **đổi IP ngay**: không giải captcha, coi lượt đó là lỗi và đổi IP/session cho lượt sau.
- **Cả 3 chế độ đều được tự động đổi IP rồi thử lại**: gặp captcha thì app lấy proxy/session mới và chạy lại lượt,
  thử tối đa **3 lần cho một lượt** (`CAPTCHA_RETRIES = 2` trong `workflow/worker.mjs`). Chỉ khi cả 3 lần đều bị captcha
  thì lượt mới tính là `captcha` — vì vậy con số captcha trong `/my` thấp hơn số lần thực sự gặp trang `/sorry`.
- **Lỗi mạng tới trang đích cũng được đổi IP thử lại tối đa 3 lần** (`isTargetNetworkError` trong `workflow/worker.mjs`):
  proxy/IP đóng kết nối ngay lúc bắt tay TLS (`ERR_CONNECTION_CLOSED`, `ERR_CONNECTION_RESET`, `ECONNRESET`,
  `EPROTO`, hoặc "trang đích không mở trong 30 giây") là lỗi **theo từng IP proxy** — đo thật với proxy xoay VN
  tới site sau Cloudflare thì chỉ **~1/4 session** vào được. Nhóm lỗi này còn được tính vào cột **lỗi proxy** ở
  `/campaign` và (kiểu **Danh sách proxy**) tính vào ngưỡng **tạm loại** proxy.
- **Các lỗi khác chỉ thử lại một lần**: lỗi khi mở profile, bridge, trạng thái trang lạ (`unknown state`)… app đóng
  profile rồi chạy lại lượt đó **ngay** với IP khác. Chỉ khi lần 2 vẫn lỗi thì lượt mới tính là `error`
  và từ khóa đó **tạm nghỉ 2 phút** (đặt trong `finish()` của `campaign.mjs`) trước khi được xếp lịch lại.
- **Thời gian mở profile**: app chờ OmniLogin tối đa **120 giây** cho mỗi lần mở (đo thực tế: kiểm tra proxy + Chrome
  khởi động mất 6–30 giây). Nếu desktop trả `status:true` mà **chưa kịp có bridge**, app đóng profile đó, chờ 5 giây
  rồi **mở lại một lần**; log ghi kèm `bridge_error` của desktop để biết lý do. Đổi thời gian chờ bằng biến môi trường
  `OMNI_API_TIMEOUT` (mili-giây, mặc định `120000`).
- **Lượt treo quá hạn (watchdog)**: một lượt không có phản hồi trong **~10–90 phút** tuỳ cấu hình (thời gian đọc trang +
  chờ captcha + 5 phút dự phòng) bị coi là lỗi hạ tầng: app **đóng profile để nhả luồng** rồi thử lại **một lần**.
  Xem mục 10.9.

### 10.9. Chạy nhiều luồng cho ổn định

Muốn chạy song song nhiều luồng (mỗi luồng 1 cửa sổ Chrome) thì **RAM và CPU đều là ràng buộc**, không chỉ RAM.
Số đo thật trên máy đang chạy (cột `ram_peak_mb` / `cpu_avg` trong bảng `runs`, xem thêm cột RAM/CPU ở panel *Đang chạy*):

| Chỉ số một luồng | Số đo thật | Ghi chú |
| --- | --- | --- |
| RAM đỉnh của trình duyệt | **~1,1 GB** (741–1345 MB) | Lúc vừa mở chỉ thấy ~600–700 MB rồi tăng tiếp trong 1–2 phút đầu |
| CPU trung bình | **~0,7 lõi** (7–18% trên máy 6 lõi) | Lúc nạp trang Google + trang đích có thể chạm 1 lõi; máy **không GPU** render bằng phần mềm nên tốn CPU hơn |
| Thời gian một lượt | **~4 phút** (201–340 s) | ⇒ 1 luồng ≈ **12–15 lượt/giờ** |

Ước lượng nhanh: **RAM máy ≈ số luồng × 1,2 GB + 6 GB** (Windows + app + OmniLogin desktop + dư địa),
**vCPU ≈ số luồng × 0,7** (làm tròn lên). Lưu ý: **Số luồng tối đa là trần của cả engine** (một pool luồng dùng chung,
`maxThreads()` trong `campaign.mjs`) — đặt 15 nghĩa là **tối đa 15 Chrome trên toàn máy**, không phải 15 cho mỗi chiến dịch.
Mỗi chiến dịch còn có **trần riêng** ở ô *Luồng chạy song song tối đa* (`campaigns.max_threads`, xem **mục 10.17**): để `1`
thì chiến dịch chạy tuần tự và 15 luồng phục vụ được tối đa **15 chiến dịch song song**; nâng lên `3` thì một chiến dịch
được chiếm 3 luồng để đuổi kịp chỉ tiêu dày (chiến dịch nào trễ lịch nhiều nhất thì được chạy trước). Bảng chọn máy:

| Chiến dịch bật đồng thời | RAM nên có | vCPU nên có | Ổ đĩa / mạng |
| --- | --- | --- | --- |
| 2–4 | 12 GB | 4 | Đủ dùng máy hiện tại |
| 5–8 | 16 GB | 6–8 | |
| 10–15 | 24 GB (tối thiểu) – **32 GB** | **12–16** | ≥ 60 GB trống, SSD/NVMe |
| 20 | 32–48 GB | 16 | |
| **30** | **48 GB (tối thiểu) – 64 GB** | **20–24** | ≥ 100 GB SSD/NVMe trống; proxy cho ≥ 30 IP đồng thời |

**Chốt cấu hình cho mốc 15 luồng đồng thời** (15 Chrome cùng lúc, phục vụ tối đa 15 chiến dịch song song):

| Hạng mục | Tối thiểu | **Nên mua (chốt)** | Lý do |
| --- | --- | --- | --- |
| RAM | 24 GB | **32 GB** | 15 × 1,2 GB + 6 GB ≈ 24 GB; thêm 8 GB dư cho Windows, OmniLogin desktop và lúc Chrome "phình" sau 1–2 phút |
| vCPU | 12 | **16** (hoặc 8 lõi riêng/dedicated) | 15 × 0,7 ≈ 10,5 lõi; VM chia sẻ bị tranh CPU nên cần dư ~50%. Nếu VM **có GPU/passthrough** thì 12 vCPU là đủ |
| Ổ đĩa | ≥ 40 GB trống | **≥ 60 GB trống, NVMe/SSD** | 15 profile pool ≈ 5 GB + Chromium/cache/logs tăng dần; HDD làm mở profile chậm, dễ chạm watchdog |
| Mạng | ≥ 100 Mbps | **≥ 100 Mbps ổn định (không phải gói burst)** | 15 luồng ≈ 1,8–6,8 GB/giờ; nạp trang là hàng chục kết nối cùng lúc |
| Proxy | 15 session đồng thời | **20–30 session, gói tính theo GB** | Xoay IP cần dư địa; đo thật 10–30 MB/lượt ⇒ 15 luồng ≈ 45–160 GB/ngày nếu chạy 24h |
| Gói OmniLogin | ≥ 15 profile | ≥ 15 profile + còn lượt tạo profile | Đây là **chặn cứng đầu tiên**: thiếu profile thì engine tự hạ số luồng |
| Tài khoản app | `Cấp chạy song song` ≥ 15 | ≥ 15 cho user sở hữu chiến dịch | Không đủ thì chỉ bật được tối đa số chiến dịch đã cấp, dù máy còn dư |

Ví dụ cấu hình thuê tương đương khi không mua máy: **16 vCPU / 32 GB** (AWS `c7a.4xlarge`, Azure `F16s_v2`,
GCP `c3-highcpu-16`) hoặc **8 lõi riêng (dedicated) / 32 GB** (Hetzner `CCX33`) — vCPU chia sẻ phải đủ 16 mới tương đương
8 lõi riêng. Ưu tiên ổ NVMe; GPU **không** bắt buộc.

Công suất thực tế của 15 luồng: **12–15 lượt/giờ mỗi luồng ⇒ ~180–225 lượt/giờ**, tức khoảng **2.900–3.400 lượt/ngày**
nếu chạy khung 8–23 (15 giờ) và **~4.700–5.400 lượt/ngày** nếu chạy 24 giờ. Nếu chỉ tiêu là 100 lượt/giờ/chiến dịch thì
mỗi chiến dịch cần ~7 luồng ⇒ 15 luồng chỉ chạy nổi **2 chiến dịch theo giờ** cùng lúc (đây là lý do cần phân biệt chỉ tiêu
*theo ngày* và *theo giờ*).

Thông số cần đặt trong `/campaign` khi chuyển sang máy mới:

| Ô cấu hình | Giá trị chốt | Ghi chú |
| --- | --- | --- |
| Số luồng tối đa | **15** (nâng theo bậc 6 → 10 → 15) | Mỗi bậc chạy 1–2 ngày, xem RAM/CPU ở panel *Đang chạy* và cột `ram_peak_mb` trong lịch sử |
| RAM trống tối thiểu | **4000 MB** | Với 32 GB RAM; nếu chỉ 24 GB thì để 3000 MB |
| Chừa RAM mỗi luồng mới | **1200 MB** | Khớp RAM đỉnh đo được ~1,1–1,35 GB/luồng |
| Chế độ profile | **Dùng lại nhóm cố định**, tạo lại sau **30–50 lượt** | Tránh tốn hạn mức tạo profile và thời gian tạo (nút thắt lớn nhất khi nhiều luồng) |
| Captcha | **CapSolver** (hoặc "Đổi IP ngay") | 15 cửa sổ cùng đòi captcha thì giải tay không kịp |
| Số trang Google tìm | **5** | Nhiều trang ⇒ lâu hơn, tốn proxy hơn |
| Ở lại trang đích / mỗi trang con | **60–120 s** / **1 trang con, 20–45 s** | Giữ thời gian một lượt ~4 phút ⇒ 12–15 lượt/giờ/luồng |
| Khung giờ hoạt động | **8–23** hoặc **0–23** | Khung hẹp hơn thì cần thêm luồng mới kịp chỉ tiêu |
| Báo cáo Telegram theo ngày | Bật | 15 luồng thì không nhìn panel liên tục được |

Ghi chú khi nhắm mốc 30 chiến dịch:

- **Không cần GPU**, nhưng nếu thuê được VM có GPU/passthrough thì CPU mỗi luồng giảm rõ (đang render mềm).
- **Ổ đĩa**: mỗi profile OmniLogin chiếm ~250–300 MB trong `%APPDATA%\omnilogin\omni-profiles`; chế độ *Dùng lại nhóm
  cố định* tạo `omni-pool-1…N` nên 30 luồng cần chừng **8–10 GB** và cache còn lớn dần.
- **Proxy/mạng**: proxy xoay phải cho **≥ 30 session (IP) đồng thời**; lưu lượng khoảng **10–30 MB một lượt**
  (trang đích có quảng cáo/livestream còn nặng hơn) ⇒ 30 luồng ≈ **4–10 GB/giờ**, nên chọn gói theo GB và theo dõi
  thực tế vài ngày trước khi mua dài hạn.
- **Hạn mức OmniLogin mới là chặn cứng đầu tiên**: gói phải cho **≥ 30 profile** và đủ lượt tạo profile trong ngày,
  nếu không engine tự hạ số luồng và báo *"Gói OmniLogin đã đạt số profile tối đa"*. Kiểm tra gói trước khi nâng máy.
- **30 chiến dịch bật cùng lúc ≠ phải mở 30 Chrome cùng lúc.** Lịch rải đều trong khung giờ nên 10 luồng đã đủ chạy
  hết 30 chiến dịch × 100 lượt/ngày trong ~20 giờ. Chỉ cần 30 luồng song song khi chỉ tiêu **theo giờ** và khung giờ hẹp
  (ví dụ chiến dịch 100 lượt/giờ cần ~7 luồng riêng cho nó).
- **Cảnh báo khi đặt nhiều chiến dịch**: ngưỡng RAM chống quá tải được kiểm tra **theo từng chiến dịch** (mỗi chiến dịch
  tự đọc RAM trống của máy), nên nhiều chiến dịch cùng khởi động có thể mở quá số Chrome mà máy chịu được. Vì vậy khi
  chạy nhiều chiến dịch hãy đặt **RAM trống tối thiểu 4000–5000 MB** (sàn này dùng chung cho mọi chiến dịch) và
  **Chừa RAM mỗi luồng mới 1200 MB**.
- **Nâng tại chỗ trước khi nâng máy**: đóng hết cửa sổ Chrome thừa và bridge mồ côi rồi khởi động lại app (xem mục **14**);
  mỗi cửa sổ Chrome còn sót chiếm ~80–300 MB và giữ bridge nên làm engine tưởng máy thiếu RAM.

Bốn cơ chế giữ máy không bị quá tải khi bạn tăng **Số luồng tối đa**:

1. **Mở lần lượt, không mở đồng loạt** — mỗi luồng mới cách nhau **3–8 giây** (`tick()` trong `campaign.mjs`), tránh
   việc OmniLogin phải khởi động nhiều Chrome + nhiều `omniBridge` cùng lúc (đây là nguyên nhân chính của lỗi
   "không cấp được bridge" và Chrome khởi động chậm).
2. **Chừa RAM cho luồng vừa mở** — trong **90 giây** sau khi mở một luồng, engine yêu cầu
   `RAM trống ≥ RAM trống tối thiểu + Chừa RAM mỗi luồng mới × số luồng vừa mở`, vì RAM trống chưa trừ ngay phần
   Chrome mới chiếm (Chrome chiếm dần trong ~1 phút đầu). Đặt ô này `0` để tắt.
3. **Trần cứng theo RAM trống** — dưới ngưỡng **RAM trống tối thiểu** thì không mở luồng nào nữa và ghi cảnh báo
   kèm số liệu, ví dụ: `⚠ RAM trống 900 MB < 1450 MB cần thiết (800 sàn + 1×650 cho luồng vừa mở) — tạm chưa mở thêm luồng (1 đang chạy).`
4. **Hạn thời gian mỗi lượt (watchdog)** — một lượt bị **treo** (bridge/CDP không trả lời, lệnh gửi đi không có phản hồi)
   sẽ bị **đóng profile sau ~10–90 phút** tuỳ cấu hình (thời gian đọc trang + chờ captcha + 5 phút dự phòng), nhả luồng
   ngay và tự chạy lại **một lần**. Không có watchdog thì kiểu treo này giữ slot **vĩnh viễn**: chạy 4 luồng mà treo 1
   luồng là mất 25% công suất mà không có lỗi nào trong log.

Vì vậy khi đã chạy nhiều luồng, nên:

- **Chế độ profile = Dùng lại nhóm cố định** — mỗi luồng có profile riêng (`omni-pool-1…N`), không tạo/xoá profile
  liên tục (tạo profile là khâu nặng nhất và tốn hạn mức tạo profile của gói OmniLogin). Chế độ *Tạo mới mỗi lượt*
  chỉ hợp lý với 1–2 luồng; engine nhắc khi bạn đặt >2 luồng mà vẫn để chế độ này.
- **Captcha: CapSolver hoặc "Đổi IP ngay"** — giải captcha tay với 3–4 luồng là không kịp vì nhiều cửa sổ cùng đòi
  (engine nhắc khi bạn đặt >1 luồng mà vẫn để "Chờ tôi giải tay").
- **Ghi file có hàng đợi** — nhiều luồng kết thúc cùng lúc vẫn ghi `stats.json`/`campaign.json` lần lượt, không đè lên nhau.
- **Nhiều luồng ≠ vượt hạn mức** — số luồng chỉ giúp chạy nhanh hơn phần chỉ tiêu đã đến hạn; **Số chiến dịch chạy
  đồng thời** (quyền admin cấp) và **Số luồng tối đa** vẫn là giới hạn cứng.
- Theo dõi **RAM/CPU** ở panel *Đang chạy*: nếu RAM trống về sát ngưỡng, hoặc cột RAM của một luồng cứ tăng rồi không
  giảm, hãy giảm **Số luồng tối đa** rồi tăng lại sau (đóng các cửa sổ Chrome thừa cũng giải phóng ngay).

### 10.10. Chạy traffic trên di động (Android / iPhone)

Ô **Thiết bị chạy traffic** ở `/campaign` (mục 8.1) cho engine chạy một phần hoặc toàn bộ lượt bằng
**profile di động** thay vì máy tính:

| Chế độ | Cách chạy |
| --- | --- |
| **Hỗn hợp 70% máy tính / 30% di động** (mặc định) | Đúng quy định chung — xem khung dưới |
| **Máy tính (Windows)** | Như cũ — profile `window` + Chrome, tương tác bằng chuột/bánh xe |
| **Di động (Android/iPhone)** | Mọi lượt dùng profile Android (75%) hoặc iPhone (25%) với độ phân giải di động ngẫu nhiên (Android `360x800`–`412x915`, iPhone `375x812`–`428x926`) |

**Quy định tỉ lệ chạy traffic: 70% máy tính – 30% di động**

- Tỉ lệ được **chia theo số lượt**, không theo may rủi: `100 lượt/giờ` = **70 lượt máy tính + 30 lượt di động**;
  `200 lượt/ngày` = **140 lượt máy tính + 60 lượt di động**. Các lượt di động rải đều (cách nhau 3–4 lượt),
  không dồn cục một chỗ.
- Áp dụng cho **cả hai kiểu chỉ tiêu**: theo giờ thì mỗi khung giờ chia theo số lượt của khung đó, theo ngày thì
  chia cho cả ngày — mỗi dãy đếm riêng nên trộn hai kiểu chiến dịch vẫn đúng tỉ lệ của từng loại.
- Bộ đếm chạy **liên tục, không reset mỗi khung**, nên khung chỉ có 3–5 lượt vẫn giữ đúng tỉ lệ về lâu dài
  (khung 3 lượt có thể 0 lượt di động, khung sau bù lại — điều này đúng với mọi cách chia số nguyên).
- **Lượt thử lại đổi IP giữ nguyên thiết bị** của lượt đó: một lượt được chia là di động thì các lần thử lại
  (captcha, lỗi mạng) vẫn là di động, không "nhảy" sang máy tính.
- Mỗi loại thiết bị vẫn dùng **nhóm profile riêng** (`omni-pool-1`… cho máy tính, `omni-pool-a1`/`omni-pool-i1`…
  cho di động) nên tỉ lệ 70/30 chỉ đổi số lượt, không đổi cách quản lý profile.
- Muốn tỉ lệ khác quy định: sửa **Tỉ lệ di động (%)** (vd `20` = 80/20) hoặc chọn hẳn `Máy tính` / `Di động`
  cho 100% một loại. Đổi xong bấm **Lưu cấu hình**.

Cách đối chiếu tỉ lệ thực tế: dòng trạng thái trên `/campaign` hiện `thiết bị 70% máy tính / 30% di động
(hôm nay: N máy tính, M di động)`; bảng **Luồng đang chạy** và **Lượt gần đây** có thêm cột **Thiết bị** để
kiểm tra từng lượt.

**Lượt di động engine làm gì** (đã đo thật với OmniLogin + Chrome core 152):

- Profile tạo với `operating_system: android|iphone` + độ phân giải di động. OmniLogin trả về
  `screen_type: "device"`, `hardware_concurrency: 8` (Android) / `2` (iPhone) và **tự sinh UA di động**:
  - Android: `Mozilla/5.0 (Linux; Android 10; K) … Chrome/152.0.0.0 Mobile Safari/537.36`
  - iPhone: `Mozilla/5.0 (iPhone; CPU iPhone OS 12_0 like Mac OS X) … CriOS/152… Mobile/15E148 Safari/604.1`
  - Trang thấy `navigator.maxTouchPoints = 5` và `userAgentData.mobile = true` ⇒ đúng dấu vết một máy di động.
- **Tương tác bằng touch thật** (không dùng JS giả): engine gửi `Input.dispatchTouchEvent` qua CDP —
  chạm = `touchStart`/`touchEnd`, cuộn = **vuốt** `touchStart` → nhiều `touchMove` → `touchEnd`. Nhờ vậy
  cú chạm vào kết quả Google điều hướng đầy đủ (đã kiểm chứng: vào được trang đích) và cuộn trang giống ngón tay.
- **Lượt di động luôn mở cửa sổ thật**: emulation di động ở chế độ ẩn bị sai viewport (đo được `innerWidth 759`
  thay vì ~393) và **bánh xe không cuộn**. Nếu bạn bật **Chạy ẩn** mà có lượt di động, engine tự bỏ "Chạy ẩn"
  cho các lượt đó, ghi cảnh báo trong Nhật ký khi bắt đầu chiến dịch; các lượt máy tính vẫn chạy ẩn bình thường.
- **Google di động khác Google máy tính**: trang kết quả mobile **không có `<h3>` và không có `#search`** —
  chỉ có `#rso` với tiêu đề dạng `DIV[role="heading"]`; link kết quả bị bọc qua `/goto?url=<chuỗi mã hoá>`
  (không giải ra URL). Engine đọc được cả hai kiểu và lấy **URL hiển thị trong kết quả** để so khớp URL đích
  (đã kiểm chứng: tìm đúng `https://vnexpress.net/` ở vị trí #1 rồi chạm vào, vào thẳng trang). Mobile cũng
  **không có nút `#pnnext`** nên engine chỉ có trang kết quả đầu rồi cuộn/ bấm "kết quả khác" nếu Google đưa ra.
- **Captcha trên di động**: Google đẩy sang `/sorry` **nhiều hơn** với phiên mobile lạ. Engine **không bao giờ điều
  hướng lại (không "reload") trong lúc trang captcha đang hiện/chờ giải** — cửa sổ được đưa lên trước và bạn có đủ
  thời gian "Chờ giải tay". Sau khi bạn giải xong, Google thường đưa thẳng tới trang kết quả với truy vấn **bị mã
  hoá trong URL** (`/search?q=EgSr…`): engine nhận đúng đó là trang kết quả của **chính lượt đang chạy** và quét
  luôn. (Trước đây trang mã hoá này bị coi là "trang kết quả cũ" nên engine quay lại google.com liên tục — nhìn như
  trang tự reload, mất captcha vừa giải, và lặp tới 20 vòng rồi bỏ lượt.)
- **Nhật ký từng lượt** ghi rõ `Thiết bị: Android 393x852 …` và `UA di động: …`; bảng lượt chạy có thêm nội dung
  thiết bị của lượt (`device`) để đối chiếu tỉ lệ mobile thực tế.

**Chốt cấu hình cho traffic di động**

| Hạng mục | Khuyến nghị |
| --- | --- |
| **Proxy** | Nên là **4G/mobile hoặc residential**: IP "máy tính" mà UA lại là điện thoại là điểm bất thường dễ bị soi. `Proxy xoay` + `Quốc gia = VN` như hiện tại vẫn dùng được |
| **Captcha** | Google captcha xuất hiện **nhiều hơn** khi chạy di động qua proxy (phiên mobile lạ) ⇒ dùng `CapSolver` hoặc `Đổi IP ngay`; số lượt captcha nằm trong `stats.json`/bảng lượt chạy |
| **RAM / CPU** | Mỗi profile di động **không nhẹ hơn** profile máy tính (vẫn là một OmniBrowser riêng) ⇒ dùng đúng công thức mục 10.9: RAM ≈ luồng × 1,2 GB + 6 GB |
| **Hạn mức profile OmniLogin** | Mỗi loại thiết bị là một nhóm profile riêng (`omni-pool-a1`, `omni-pool-i1`…) ⇒ chạy Hỗn hợp sẽ cần nhiều chỗ profile hơn chạy thuần một loại |
| **Tỉ lệ** | Giữ quy định `Hỗn hợp` **70% máy tính / 30% di động**; nếu tỉ lệ `captcha` của lượt di động cao hơn hẳn lượt máy tính (xem cột **Thiết bị** ở bảng lượt gần đây) thì giảm **Tỉ lệ di động (%)** hoặc tạm chạy `Máy tính` cho tới khi có proxy 4G/residential |

Cách kiểm chứng nhanh: mở **Nhật ký** của một lượt vừa chạy — nếu là lượt di động thì phải thấy
`Thiết bị: …` và `UA di động: … Mobile …`, và bảng lượt chạy hiện đúng tên thiết bị.
Trang `/test` (chạy đơn) cũng tự nhận diện: nếu profile bạn chọn là Android/iPhone thì Nhật ký ghi
`Profile di động (android) — dùng chạm/vuốt thật thay cho chuột` và engine tương tác bằng touch.

### 10.11. Thao tác trên giao diện giống người thật

Mọi cú bấm / gõ phím / cuộn trang của engine đều đi qua `workflow/human.mjs` — lớp tự dựng **quỹ đạo và
nhịp như tay người**. Lý do phải tự dựng: engine chạy nhiều profile song song nên thao tác được gửi thẳng
vào tab qua CDP (không tranh focus), còn `humanize` của bridge chỉ có tác dụng với cửa sổ đang mở trên cùng.

| Thao tác | Mô phỏng người thật |
| --- | --- |
| **Di chuột** | Đường cong Bezier chia 3–26 điểm rời, **chậm ở hai đầu – nhanh ở giữa**, thỉnh thoảng khựng tay giữa đường; ~12% số lần **đi quá đích vài px rồi kéo lại** |
| **Bấm chuột** | Điểm bấm **lệch tâm** (30–70% chiều rộng phần tử), dừng "ngắm" ~0,1–0,3s, rung 1–2 px rồi **giữ nút 55–145 ms** (down → up) thay vì click tức thì |
| **Gõ từ khóa** | **Từng phím một** (`press`) với nhịp 45–130 ms, chậm hơn sau dấu cách/dấu câu, thỉnh thoảng khựng 0,25–0,7 s như đang nghĩ; ~30% lượt **gõ sai một ký tự rồi Backspace gõ lại** rồi mới Enter. Nội dung ô tìm kiếm được kiểm tra lại — sai thì nhập lại |
| **Cuộn trang** | Bánh xe chia thành **nhiều nấc 90–170 px** (con lăn thật không nhảy một phát cả nghìn px), nhịp giữa các nấc không đều, tổng quãng đường luôn đúng bằng quãng cần cuộn, thỉnh thoảng khựng lại để đọc |
| **Dừng đọc** | Thỉnh thoảng xê dịch chuột vài chục px / vuốt nhẹ một đoạn như người đang đọc nhưng **không bấm gì** |
| **Chạm & vuốt (di động)** | Chạm có **bán kính, áp lực, góc xoay ngẫu nhiên**; vuốt **lệch ngang nhẹ**, tăng tốc ở giữa, chậm ở hai đầu, có nhịp dừng trước khi nhấc ngón tay (quán tính cuộn) |
| **Nút gửi captcha** | Bấm bằng chuột như người; nếu bấm không ăn mới gửi form bằng JS — bước giải captcha không bị ảnh hưởng |

Vài điều cần biết:

- **Chữ có dấu không bị mất**: ký tự ngoài bảng phím US (ế, ứ, ộ…) được gửi qua `insertText` — giống hệt lúc
  gõ bằng bộ gõ IME, không phải gõ thiếu dấu.
- **Không lượt nào giống lượt nào**: mọi khoảng chờ đều là ngẫu nhiên trong khoảng, nên hai lượt cùng từ khóa
  vẫn khác nhau về từng cử chỉ.
- **Chậm hơn bản cũ một chút**: mỗi lượt tốn thêm khoảng 2–5 giây (gõ từng phím + bấm giữ nút + chia nấc con lăn).
  Số lượt/giờ vẫn do **Khoảng cách giữa các lượt** quyết định nên chỉ số chạy không đổi. Vì con lăn chia thành
  nấc, **quãng đường cuộn được trong cùng một thời gian ở lại trang ít hơn trước một chút** (chỉ số cuộn % trong
  bảng lượt chạy vì thế có thể thấp hơn vài %).
- **Muốn chỉnh "độ người"**: sửa `workflow/human.mjs` (`moveMouse`, `clickLocator`, `typeText`, `pressKey`,
  `wheel`, `tap`, `swipe`, `idleFidget`). Trên giao diện **không có** tuỳ chọn nào cho phần này.
- **Kiểm chứng**: `npm run test:engine` có các mục 16/16b/16c kiểm tra nhịp gõ + Backspace gõ lại, tổng số px
  của con lăn, bấm giữ nút (down → up) và phương án dự phòng cho bridge cũ.

### 10.12. Tăng thời gian mỗi lượt (ở lại lâu hơn)

Một lượt gồm: mở profile + tìm Google + **ở lại trang đích** + **các trang con** + dọn dẹp. Chi phí cố định
(mở/tìm/dọn) khoảng **20–35 giây** (đo từ `data/runs.jsonl`); phần còn lại do cấu hình quyết định:

> **thời gian 1 lượt ≈ thời gian ở lại trang đích + số trang con × thời gian ở lại mỗi trang con + ~30 giây**

**1. Loại chiến dịch thắng cài đặt chung.** Chiến dịch đã chọn *loại* thì lấy thời gian của loại đó
(`campaign-types.mjs`), nên **chỉnh "Ở lại trang đích" ở `/campaign` không đổi thời gian của chiến dịch đó** —
ô này chỉ áp dụng cho chiến dịch **không chọn loại**. Muốn lượt dài hơn, chọn loại
**Tìm Google → vào URL → đọc sâu (thời gian dài)**: ở lại **240–480s** + **3 trang con** × **90–180s**
⇒ **≈ 9–20 phút/lượt**. Trang `/my` hiện ngay "≈ X phút/lượt" khi bạn chọn loại.

**2. Trần cấu hình (đã nới):** thời gian ở lại mỗi trang **tối đa 3600 giây (1 giờ)** — trước đây 1800s;
số trang con **tối đa 4** — trước đây 2. Hạn cứng cho một lượt là **90 phút** (trước đây 45 phút);
lượt dài hơn hạn này bị cắt giữa chừng và tính là lỗi, `/campaign` cảnh báo "vượt hạn … phút/lượt".

**3. Đừng quên nhịp lịch (quan trọng nhất).** Engine rải `count` lượt đều trong khung giờ chạy, nên:

> **cần số luồng ≥ thời gian 1 lượt ÷ khoảng cách giữa hai lượt** — mỗi luồng là 1 cửa sổ Chrome (~1,1 GB RAM đỉnh)

Ví dụ: **100 lượt/giờ** ⇒ hai lượt cách nhau **36 giây**; một lượt ≈ 195 giây ⇒ cần **≥ 6 luồng**.
Đặt 1 luồng thì dù chạy liên tục cũng chỉ được ~18–20 lượt/giờ. Trang `/campaign` hiện cảnh báo vàng ngay
trong thẻ trạng thái ở đầu trang (và cột "1 lượt ≈" trong tab **Từ khóa & lịch**): "1 lượt ≈ X phút, lịch rải
cách nhau ≈ Y phút ⇒ cần ≥ N luồng (đang đặt M)". Chọn một trong ba hướng: **tăng số luồng (kèm RAM trống)**,
**giảm số lượt mỗi kỳ**, hoặc **chấp nhận trễ chỉ tiêu** để đổi lấy lượt "chất" hơn.

**4. Thời gian ở lại được dùng thế nào (chất lượng thời gian).** Trong lúc ở lại, engine đọc theo
**lượng chữ đang nhìn thấy** (tốc độ đọc lướt 420–760 từ/phút + thời gian ngắm ảnh/video), cuộn nhiều nấc,
thỉnh thoảng dừng đọc và cuộn ngược đọc lại; trang có **video đang phát** thì xem một đoạn **25–60% thời
lượng** (tối đa 180 giây/trang). Nếu hết liên kết nội bộ hoặc không bấm được trang con, engine **nán lại đọc
tiếp** thay vì kết thúc sớm — nhờ vậy thời gian mỗi lượt đúng như cấu hình chứ không bị hụt.

**5. Theo dõi kết quả:** bảng **Lượt chạy gần đây** ở `/campaign` có 2 cột liên quan — **giây trên site**
(`onSite`) và **tổng giây** (`seconds`). Cùng một loại chiến dịch, `onSite` phải xấp xỉ "thời gian ở lại +
các trang con"; nếu thấp hơn hẳn thì thường là do proxy/captcha cắt lượt, không phải do cấu hình.

### 10.13. Giao diện: thanh tiêu đề chung, tab cài đặt, thao tác nhanh

Từ bản này mọi trang dùng **một bộ giao diện chung**: `public/ui.css` (màu, nút, bảng, thẻ, tab, thông báo)
và `public/ui.js` (thanh tiêu đề, gọi API, thông báo nổi, hộp xác nhận, lọc/sắp xếp bảng). Hai file được
phục vụ ở `/ui.css` và `/ui.js` (mở cho cả khách vì trang `/` và `/login` cũng dùng) — sửa một chỗ là **mọi
trang đổi theo**, không còn mỗi trang một bảng màu riêng.

**Thanh tiêu đề (mọi trang đã đăng nhập):** menu theo vai trò (tài khoản `user` không thấy mục Quản trị /
Cấu hình chạy / Chạy thử), chip người dùng + nút **Đăng xuất** (hỏi lại trước khi thoát), nút **🌗** đổi
**theo hệ thống → sáng → tối** (nhớ lựa chọn trong trình duyệt) và huy hiệu đỏ đếm **chiến dịch chờ duyệt /
thông báo chưa đọc**.

**Trang `/campaign` (cấu hình chạy):**

| Khu vực | Nội dung |
|---|---|
| Thẻ trạng thái đầu trang | Nhãn Đang chạy/Đã dừng, nút **▶ Bắt đầu**, **■ Dừng**, **🔇 Âm báo**, **💾 Lưu cấu hình** và lưới 6 ô: luồng, RAM trống, CPU · mạng, OmniLogin, thiết bị hôm nay, khung giờ |
| Cảnh báo | captcha đang chờ (nhấp nháy) và cảnh báo nhịp lịch **không đủ luồng để đủ chỉ tiêu** — xem mục 10.12 |
| 4 tab cài đặt | **Cài đặt chạy** · **Từ khóa & lịch** · **Proxy** · **Tích hợp** (OmniLogin + Telegram). Tab đã chọn được nhớ; mở thẳng bằng `#proxy`, `#keyword`… trong địa chỉ |
| Giám sát (bên dưới) | **Luồng đang chạy** (có ô lọc) → **Lượt gần đây** (bấm tiêu đề cột để sắp xếp, có ô lọc) → **Thống kê proxy & khung giờ hôm nay** → **Nhật ký chung** (nút Copy) |
| Thanh dính đáy | Hiện khi cấu hình **có thay đổi chưa lưu**, kèm nút Lưu; rời trang lúc này sẽ bị hỏi lại |

Phím tắt: **Ctrl+S** lưu cấu hình, **Ctrl+Enter** lưu rồi bắt đầu chạy.

**Trang `/test` (chạy thử một lượt):** chia 3 bước (từ khóa/URL → profile → hành vi sau khi vào site), có
**mẫu nhanh** (Lướt nhanh · Đọc kỹ 4–8 phút · Ở lâu 10–15 phút · Tối đa 30 phút) và dòng "Một lượt ≈ …" tính
ngay theo số vừa nhập; nhật ký nằm bên phải, dính khi cuộn, có **Tự cuộn** và **Copy**, kèm đồng hồ đếm khi đang chạy.

**Trang `/my`:** các khối như cũ (tạo chiến dịch, bảng chiến dịch + tiến độ, biểu đồ, từ khóa, lượt gần đây, thông báo,
luồng đang chạy realtime). **Không còn thẻ "Gói & hạn mức"** vì mô hình gói tự cài đã gỡ (xem **mục 20**).

**Trang `/my` và `/admin`:** nút thao tác có trạng thái "đang xử lý", kết quả hiện bằng **thông báo nổi**
góc phải (không còn hộp thoại mặc định của trình duyệt), xoá chiến dịch/tài khoản dùng **hộp xác nhận có nút
đỏ**, bảng có ô lọc và bấm tiêu đề cột để sắp xếp. Phiên hết hạn ở bất kỳ trang nào cũng tự đưa về
`/login?next=…` để vào lại đúng trang đang xem.

**Bảng giá `/bang-gia`:** dùng lại đúng bộ giao diện chung, thêm các thành phần trong `ui.css`:
`.tp-grid`/`.tp`/`.tp-tbl` (**bảng giá niêm yết**: 4 thẻ loại traffic × 4 mốc thời gian ở lại, mỗi thẻ có nút
"Mua ngay" — mỗi loại một màu nhận diện, có token riêng cho chế độ sáng/tối),
`.price-tbl` (giá theo lượt + dịch vụ cộng thêm),
`.trust-grid` (cam kết), `.faq` (câu hỏi dạng `<details>`) — chi tiết ở **mục 20**. Các lớp của mô hình gói cũ
(`.price-grid`, `.plan`, `.plan-card`, `.seg`, `.cmp-tbl`) vẫn còn trong `ui.css` nhưng **không trang nào dùng nữa**.

**Kiểm thử giao diện:** `npm run test:ui` (`tests/ui.test.mjs`) kiểm tra mọi trang nạp `/ui.css` + `/ui.js`,
script trong trang hợp lệ cú pháp, **mọi id mà script gọi đều có trong HTML** (bắt lỗi khi dựng lại markup),
`ui.js` chạy được trong sandbox, server phục vụ đúng 2 file này, cùng các marker của trang bảng giá.
`npm run test:pricing` (`tests/pricing.test.mjs`) kiểm tra giá theo lượt và **chặn lệch giá** giữa `pricing.mjs` với
`public/pricing.html`, đồng thời **chặn mọi dấu vết còn sót của mô hình gói/license** (plans.mjs, route gói, `max_slots`).


### 10.14. Cứ 20 lượt tìm kiếm có 1 lượt chỉ lấy hiển thị

Để tỉ lệ **click / hiển thị** giống người thật (không phải lượt tìm kiếm nào cũng bấm vào kết quả), engine
áp dụng **quy định lượt "chỉ hiển thị"**:

> **Cứ 20 lượt CÓ tìm Google thì 1 lượt** chỉ gõ từ khóa, **liếc trang kết quả rồi thoát tab** — không bấm
> vào kết quả. Trang đích chỉ nhận **lượt hiển thị** (impression), **không** nhận lượt truy cập.

**Lượt đó engine làm gì**

| Bước | Lượt bình thường | Lượt "chỉ hiển thị" |
| --- | --- | --- |
| Mở profile + IP proxy mới | có | **có** (giống nhau) |
| Vào google.com → gõ từ khóa | có | **có** |
| Tìm URL đích trong kết quả | tối đa "Số trang Google tìm" trang | **có** — tìm thấy là đủ để kết quả đã hiện trên Google |
| Bấm vào kết quả | có | **không** — đưa kết quả vào khung nhìn, đợi ~1–2,5 giây rồi **đóng tab** |
| Ở lại đọc trang đích + trang con | có | **không** (đã thoát tab) |
| Referrer từ Google | có | **không** (site không thấy lượt truy cập nào) |

**Cách chia tỉ lệ (giống quy định 70/30 của thiết bị)**

- Chia theo **số lượt**, không theo may rủi: 20 lượt → **đúng 1 lượt** (lượt #20), 40 lượt → **2 lượt**
  (#20, #40), 100 lượt → **5 lượt**. Bộ đếm chạy **liên tục, không reset** giữa các khung giờ/chiến dịch và
  **chỉ đếm các lượt có bấm vào kết quả** — nên chiến dịch *Chỉ tìm Google* và *Vào thẳng URL* không làm
  lệch tỉ lệ của các chiến dịch còn lại.
- **Lượt thử lại đổi IP giữ nguyên kiểu lượt**: lượt đã chia là "chỉ hiển thị" thì các lần thử lại (captcha,
  lỗi mạng) vẫn chỉ lấy hiển thị.
- Lượt "chỉ hiển thị" **vẫn tính vào chỉ tiêu** của chiến dịch (vẫn là 1 lượt tìm kiếm với từ khóa đó), chỉ
  khác là site không nhận truy cập.
- Ô **Lượt "chỉ hiển thị" (1 / N lượt)** ở `/campaign` đổi được tỉ lệ (vd `10` = cứ 10 lượt có 1 lượt) hoặc
  đặt **`0`** để tắt hẳn. Ô ngay cạnh ô "Số trang Google tìm" và có dòng nhắc lại quy định.

**Theo dõi & đối chiếu**

- Dòng trạng thái đầu trang `/campaign` hiện `· cứ 20 lượt tìm kiếm có 1 lượt chỉ hiển thị (hôm nay: N)`;
  đặt `0` thì hiện `không dùng lượt chỉ hiển thị`.
- Bảng **Lượt gần đây** ở `/campaign` ghi `Thành công · 👁 hiển thị`, cột **giây trên site** của lượt đó là
  `—` (không vào site); trang `/my` cũng hiện `ok · 👁 hiển thị` trong bảng Lượt chạy gần đây.
- Trong Nhật ký chung và trong log của luồng có dòng
  `👁 Lượt chỉ lấy hiển thị: kết quả đã hiện ở trang 1 vị trí #4 — không bấm vào.` và
  `↗ Đã thoát tab — lượt này chỉ tính hiển thị, site không nhận truy cập.`
- CSDL: cột **`runs.impression`** = `1` cho các lượt "chỉ hiển thị" (lượt thường để trống) — lọc được bằng
  `SELECT * FROM runs WHERE impression = 1`.

**Điểm cần biết**

- Lượt chỉ có hiển thị thật khi **kết quả của site thật sự nằm trong trang kết quả Google** — engine vẫn tìm
  URL đích như lượt thường (tối đa "Số trang Google tìm" trang), không thấy URL thì vẫn báo *không thấy URL*.
- Lượt này **ngắn hơn hẳn** lượt thường (chỉ mở profile + tìm Google + thoát tab, ~20–40 giây) nên nó không
  làm chậm nhịp chạy; nhịp lịch ở mục 10.12 vẫn tính theo lượt dài nhất nên không đổi.
- Nếu muốn **tuyệt đối không có lượt nào không bấm vào kết quả**: đặt ô này về `0`.

**Kiểm chứng**: `npm run test:engine` (mục 20) kiểm tra bộ chia đúng tỉ lệ 1/20 và rải đều, chỉ đếm lượt có
tìm Google, cùng việc lượt "chỉ hiển thị" **không bấm vào kết quả** và **đóng tab** thay vì ở lại site.

### 10.15. Vị trí Google: máy tính và di động là HAI bảng xếp hạng khác nhau

Google xếp hạng theo **dấu vân tay thiết bị**, không phải một bảng chung: cùng một từ khóa, cùng một thời điểm,
site có thể đứng **#3 trên máy tính** nhưng **#14 trên di động** (hoặc ngược lại). Vì engine chạy traffic theo
quy định **70% máy tính / 30% di động** (mục 10.10), mỗi lượt ghi vị trí của **thiết bị đã dùng cho lượt đó** —
nên app lưu riêng và hiện riêng hai con số:

- **Bảng Chiến dịch** (`/my` và `/admin`): cột **Vị trí Google** hiện `🖥 #3 · 📱 #14` — vị trí **mới nhất** của
  từng thiết bị (đưa chuột lên con số để xem nó cập nhật lúc nào). Chưa có lượt nào của thiết bị đó thì hiện `chưa có`.
- **Bảng Lượt chạy gần đây** (`/my`): có cột **Thiết bị** (`🖥 máy tính`, `📱 Android 412x915`…) đi kèm cột **Vị trí**,
  nên xem được từng lượt đứng ở đâu và bằng thiết bị nào.
- **CSDL**: `runs.device_kind` = `desktop | mobile` và `runs.device` = nhãn thiết bị (`Android 412x915`,
  `iPhone 428x926`, `máy tính`). Xếp hạng mới nhất theo thiết bị lấy bằng `runs.rankByDevice()` trong `repo.mjs`.

Ví dụ truy vấn trực tiếp:

```sql
-- Vị trí mới nhất của từng thiết bị cho mỗi chiến dịch
SELECT r.campaign_id, r.device_kind, r.position, r.at
FROM runs r
WHERE r.id IN (SELECT MAX(id) FROM runs WHERE position IS NOT NULL AND device_kind IS NOT NULL
               GROUP BY campaign_id, device_kind)
ORDER BY r.campaign_id, r.device_kind;
```

**Điểm cần biết**

- Muốn có cả hai con số nhanh thì để **Thiết bị** ở `/campaign` là `Hỗn hợp 70/30` (mặc định) — vài lượt là có
  đủ dữ liệu cho cả hai bên.
- Một bên **chưa có** nghĩa là chưa lượt nào của thiết bị đó **tìm thấy URL** (lượt `notfound`/`captcha` không có
  vị trí để ghi).
- Chỉ chạy một thiết bị (đặt `Máy tính` hoặc `Di động`) thì chỉ bên đó được cập nhật.

**Kiểm chứng**: `npm run test:engine` (mục 20) và `npm test` (mục 20) kiểm tra việc lưu thiết bị vào `runs` và
`rankByDevice()` lấy đúng lượt **mới nhất** của mỗi thiết bị, bỏ qua lượt không có vị trí.

### 10.16. Kiểu truy vấn: "Chỉ từ khóa" hay "Từ khóa + tên miền"

Ô **Kiểu truy vấn gõ lên Google** nằm ngay dưới **URL đích** ở khung tạo/sửa chiến dịch. Nó quyết định Google
nhận **đúng chuỗi gì** — đây là chỗ hay bị hiểu nhầm thành "app không khớp từ khóa":

| Kiểu truy vấn | Google nhận | Dùng khi nào |
| --- | --- | --- |
| **Chỉ từ khóa** (mặc định) | `soi kèo nhà cái` | Site **đã có thứ hạng** cho từ khóa đó — lượt giống người dùng thật nhất |
| **Từ khóa + tên miền** | `soi kèo nhà cái https://brfo.io` | Site **chưa lên hạng** cho từ khóa đó |

**Vì sao cần kiểu thứ hai.** Engine **so khớp URL ĐÍCH** trong kết quả tìm kiếm (`matchesTarget()` trong
`workflow/google-search.mjs`), **không** so khớp từ khóa — từ khóa chỉ được gõ lên Google. Vì vậy khi site
**chưa lên hạng**, gõ từ khóa trần thì site **không** nằm trong kết quả → lượt chạy báo `notfound` và site
**không nhận được lượt hiển thị** nào. Chọn **Từ khóa + tên miền** thì truy vấn gửi Google là
`từ khóa + tên miền đích`, Google trả về đúng site ngay đầu kết quả → lượt chạy `ok`, site nhận **lượt hiển
thị** (và lượt truy cập nếu engine bấm vào). Đây là cách chạy tăng hiển thị cho site **mới, chưa có thứ hạng**.

**Điểm cần biết**

- Tên miền ghép vào truy vấn lấy từ **URL đích** (bỏ `www.` và đường dẫn): `https://www.brfo.io/sport` → `brfo.io`.
  **Không** cần — và không nên — dán tên miền vào ô **Từ khóa** (app tự tách URL ra khỏi ô đó, xem mục 6.1).
- **Đã có hạng thì để "Chỉ từ khóa"**: gõ từ khóa trần mới là lượt tự nhiên, đúng giá trị SEO.
- Đổi lúc nào cũng được ở khung **Sửa chiến dịch** (`/my` hoặc `/admin`). Chiến dịch đã duyệt mà sửa thì
  **phải chờ admin duyệt lại** rồi mới chạy tiếp (mục 10.3).
- Giao diện hiện lại **truy vấn thật** khi nó khác từ khóa: bảng Chiến dịch có dòng
  `🔍 truy vấn gửi Google: …`, bảng Lượt chạy gần đây hiện truy vấn ngay dưới từ khóa.
- **Lượt thất bại cũng ghi lại truy vấn**: kể cả lượt báo *không thấy URL* (`notfound`), `runs.query` vẫn có
  chuỗi engine đã gõ (lỗi này là lớp riêng `NotFoundError` mang theo `query`, không phải suy ra từ thông báo).
  Nhờ vậy sau khi đổi kiểu truy vấn, bạn **kiểm tra được ngay** engine đã gõ `từ khóa + tên miền` chưa.
- CSDL: `campaigns.query_mode` (`keyword` | `keyword_domain`) và `runs.query` (chuỗi thật đã gõ). `runs.keyword`
  vẫn là **từ khóa gốc**, nên bảng "theo từ khóa" và mọi thống kê không bị lẫn.
- Nhật ký của lượt ghi rõ ngay từ đầu:
  `① Từ khóa: "soi kèo nhà cái" · truy vấn gửi Google: "soi kèo nhà cái https://brfo.io" (kiểu: từ khóa + tên miền)`.

**Kiểm chứng**: `npm run test:engine` và `npm test` (mục 20) kiểm tra `searchQuery()` ghép đúng tên miền từ URL
đích, engine gõ đúng truy vấn đã ghép, và CSDL lưu `query_mode` / `query` của từng lượt.

### 10.17. Một chiến dịch được chạy bao nhiêu luồng cùng lúc

Mặc định **mỗi chiến dịch chỉ chạy 1 luồng tại một thời điểm** (`pickTask()` bỏ qua từ khóa đang chạy). Vì vậy
một chiến dịch **theo giờ** mà mỗi lượt dài (~4 phút) chỉ đạt khoảng **12–15 lượt/giờ**, dù engine còn luồng trống:

| Chỉ tiêu | Mỗi lượt | 1 luồng | 3 luồng |
| --- | --- | --- | --- |
| 50 lượt/giờ | ~4 phút | ~15 lượt/giờ (**luôn trễ**) | ~45 lượt/giờ (kịp, còn dư địa) |
| 120 lượt/giờ | ~4 phút | ~15 lượt/giờ | ~45 lượt/giờ (**vẫn trễ**) |

Vì vậy ở khung **tạo/sửa chiến dịch** (cả `/my` và `/admin`) có ô **Luồng chạy song song tối đa** — số luồng mà
**chiến dịch đó** được chiếm cùng lúc:

- `1` = **tuần tự** (mặc định, đúng hành vi trước đây).
- `2, 3, …` = engine có thể mở nhiều cửa sổ Chrome **cho cùng một từ khóa** khi chiến dịch trễ lịch, nhờ vậy
  đuổi kịp chỉ tiêu. Ô chọn chỉ hiện tới **trần chung của engine** (`Số luồng tối đa` ở `/campaign`), nên
  không thể vượt sức máy.
- **Số luồng thực dùng = min(trần riêng của chiến dịch, trần chung của engine)**: `campaigns.max_threads` là
  cột lưu trần riêng, `Campaign.taskThreads()` tính lại mỗi nhịp lập lịch.
- Chỉnh xong là **có hiệu lực ngay ở nhịp lập lịch sau** (5 giây), không cần khởi động lại app. Chiến dịch đã
  duyệt mà **chủ tài khoản** sửa thì phải **chờ admin duyệt lại**; admin sửa thì chạy luôn (mục 10.3).
- Chạy song song dùng **profile trong pool** như bình thường (`Dùng lại nhóm cố định`), mỗi luồng một profile —
  đặt trần riêng không vượt trần chung nên không cần tạo thêm profile.
- **Vẫn phải đủ RAM**: engine kiểm tra RAM trống trước khi mở luồng (mục 10.9); thiếu RAM thì nâng trần cũng
  không mở thêm được luồng.

**Cách đọc cảnh báo trên giao diện**

- Bảng Chiến dịch có dòng `🔀 tối đa N luồng chạy song song` (bảng chờ duyệt ở `/admin` cũng hiện).
- Cột **Tiến độ** hiện cảnh báo khi lịch cần nhiều luồng hơn trần riêng:
  `cần ≥3 luồng nhưng chiến dịch cho phép 1 — tăng “Luồng chạy song song tối đa”`.
- Trang **Điều khiển** (`/campaign`) ở bảng từ khóa hiện `1 lượt ≈ … phút · song song ≤ N luồng`, và khung cảnh
  báo nhịp nói rõ: engine còn luồng thì nâng ô của chiến dịch, engine hết luồng thì phải nâng **Số luồng tối đa**.

**Ví dụ đúng với ca thường gặp** (1 chiến dịch 50 lượt/giờ, mỗi lượt ~4 phút, engine đặt 3 luồng): mở
**Sửa** chiến dịch → **Luồng chạy song song tối đa = 3** → **Lưu** → **Chạy**. Khi đó engine giữ tối đa 3 Chrome
cho chiến dịch này và tiến độ đuổi kịp lịch.

**Kiểm chứng**: `npm run test:engine` kiểm tra engine đọc `campaigns.max_threads`, cho đúng số luồng song song và
vẫn chặn ở trần chung; `npm test` kiểm tra lưu/đọc cột; `npm run test:ui` kiểm tra ô chọn có ở cả `/my` và `/admin`.

## 11. Captcha

Google đôi khi chặn truy vấn và đẩy sang trang `/sorry` (reCAPTCHA Enterprise). App có 3 cách xử lý:

| Chế độ | Cách hoạt động | Dùng khi nào |
| --- | --- | --- |
| **Chờ tôi giải tay** | Đưa cửa sổ profile lên trước, phát cảnh báo Windows, chờ tối đa *Chờ giải tay (phút)* để bạn giải | Máy có màn hình và bạn ngồi cạnh; tỷ lệ captcha thấp |
| **Tự động CapSolver** | Tự gửi task lên CapSolver lấy token và vượt captcha; lỗi thì quay về chờ tay | Chạy tự động 24/7 (khuyến nghị) |
| **Đổi IP ngay** | Không giải, coi như lượt lỗi và đổi IP/session cho lượt sau | Khi muốn nghiêm khắc: IP nào bị chặn thì bỏ luôn |

Ghi chú quan trọng:

- **Chờ giải tay không dùng được khi bật "Chạy ẩn (headless)"** vì không có cửa sổ để bạn bấm.
- Chọn CapSolver mà **chưa nhập key** thì engine báo lỗi ngay khi bắt đầu chạy: "Chưa nhập CapSolver API key.".
- **Trang captcha không bị tự mở lại (không "reload")**: gặp `/sorry` là engine dừng mọi điều hướng cho tới khi
  captcha được giải hoặc hết thời gian chờ; sau khi qua captcha, trang kết quả Google đưa tới — kể cả khi truy vấn bị
  **mã hoá trong URL** (`?q=EgSr…`, hay gặp trên di động) — được quét luôn, không tìm lại từ đầu.
- Lượt bị captcha **vẫn tính vào chỉ tiêu** → hãy xem cột **captcha** trong `/my` và `/admin`. Nếu captcha chiếm 50–70%,
  vấn đề nằm ở **chất lượng proxy** (proxy bị Google đánh dấu) chứ không phải ở solver.
- Kiểm tra số dư CapSolver:
  ```powershell
  Invoke-WebRequest -Uri "https://api.capsolver.com/getBalance" -Method POST `
    -ContentType "application/json" -Body '{"clientKey":"KEY_CUA_BAN"}' -UseBasicParsing
  ```
  Chi phí tham khảo ~0,8–1,2 USD / 1000 task.

## 12. Proxy

Mỗi lượt chạy bắt buộc phải có proxy hoạt động: app đọc IP công khai qua chính proxy đó; **không đọc được IP
thì lượt đó tính là `error`** (log: "Proxy không kết nối được.").

### 12.1. Kiểu proxy xoay (Webshare)

Điền Host / Port / **Username gốc** / Mật khẩu / **Quốc gia**. Ứng với mỗi lượt, app ghép username thành
`<username-gốc>-<QUỐC-GIA>-<số-session>` (số session ngẫu nhiên) → **mỗi lượt một IP** và IP đó **giữ nguyên
trong suốt lượt** (sticky), nhờ vậy Google không thấy IP đổi giữa chừng.

### 12.2. Kiểu danh sách proxy

Dán mỗi dòng một proxy; các dạng được nhận: `host:port`, `host:port:user:pass`, `user:pass@host:port`,
`http://user:pass@host:port`, `socks5://host:port` (dòng bắt đầu bằng `#` là ghi chú, bị bỏ qua).
Dòng không ghi scheme thì dùng **Loại mặc định**. App luân phiên; mỗi lượt lấy proxy kế tiếp.

- **Tạm loại sau (lần lỗi/captcha liên tiếp)**: ví dụ `3` → proxy lỗi hoặc bị captcha 3 lần liên tiếp thì bị gạch khỏi vòng xoay.
- **Thời gian tạm loại (phút)**: hết thời gian này proxy được thử lại.
- Trang `/campaign` hiện bảng thống kê từng proxy: số lần thử · tỷ lệ captcha · tỷ lệ lỗi proxy · tỷ lệ thành công.

### 12.3. Cách kiểm tra proxy nhanh

1. Mở `/` (chạy đơn), chọn 1 profile, để "Số trang tìm tối đa" = 1, đặt "Ở lại trang đích" = 0–0.
2. Bấm **Thực thi quy trình** và xem nhật ký:
   - Dòng `IP: 1.2.3.4` → proxy OK.
   - Dòng `Không đọc được IP (proxy có thể lỗi).` → sai host/port/user/pass, proxy chết, hoặc chưa tạo profile với proxy đó.
3. Trong panel **Đang chạy** ở `/my`–`/admin` cũng có cột **IP** cho từng luồng: IP trống nghĩa là proxy có vấn đề.
4. **Không cần mở app**: chạy `npm run proxy:check` trong terminal — in ra IP từng session, vị trí/nhà mạng, độ trễ tới
   Google, kiểm tra sticky và tốc độ tải. Lệnh này dùng **đúng logic proxy của engine** (`ProxyPool.next()` + hàm ghép
   username) nên kết quả khớp với lúc chạy thật. Chi tiết và khuyến nghị: xem mục 12.4.

### 12.4. Khuyến nghị cho proxy xoay (đã kiểm chứng)

Cấu hình đang dùng: `p.webshare.io:80`, kiểu `HTTP`, username gốc của gói **Webshare Residential**, Quốc gia `VN`.
Số liệu dưới đây là **kết quả đo thật** ngày 30/09/2026 bằng `npm run proxy:check` — lệnh này dùng đúng logic
`ProxyPool.next()` của engine, không cần mở trình duyệt hay OmniLogin.

| Nội dung kiểm chứng | Kết quả đo được |
| --- | --- |
| Mỗi session một IP mới | Đúng: 3/3 session và 8/8 session chạy song song đều ra IP khác nhau |
| Điền Quốc gia = `VN` | 11/11 IP đều ở Việt Nam — Viettel (AS7552), FPT Telecom (AS18403), VNPT (AS45899): IP nhà mạng thật, tốt cho Google |
| **Để trống Quốc gia** | 10/10 IP rơi vào nước khác: Kyrgyzstan, Thái Lan, Đài Loan, Indonesia, Brunei, Bangladesh, Pakistan → **không khớp** dấu vân tay `vi-VN` và sai thị trường |
| IP giữ nguyên trong một session (sticky) | Phần lớn giữ — đo được 150 giây vẫn cùng IP; **nhưng không bảo đảm tuyệt đối**: có lần đổi IP sau 5 giây (vẫn cùng dải VNPT) |
| Độ trễ tới Google | 1,0–5,6 giây (phần lớn 1,1–2,4 giây) |
| Tốc độ tải | 126–177 KB/s (≈ 1–1,4 Mbps) |
| 8 session cùng lúc | 8/8 thành công, không lỗi → gói chịu được tối thiểu 8 kết nối đồng thời |

**Đang làm đúng — giữ nguyên**

- **Một session cho một lượt**, mỗi lần thử lại là một session mới → IP không đổi giữa chừng trong cùng một lượt.
- Dùng proxy **residential VN** (IP nhà mạng thật). Không dùng proxy công khai/datacenter cho Google.
- Lượt chạy ngắn: "Ở lại trang đích" 60–70 giây nên một lượt chỉ 1–3 phút — ngắn hơn tuổi thọ session, rủi ro đổi IP thấp.

**Nên làm**

1. **Luôn điền Quốc gia = `VN`.** Đây là điểm ảnh hưởng lớn nhất mà lại dễ bỏ sót (xem bảng trên).
2. **Số luồng 3–5** khi chạy thật và theo dõi RAM. Đo thực tế 8 session song song vẫn tốt, nhưng càng nhiều luồng thì
   càng nhiều IP Việt Nam xuất hiện cùng lúc — giữ 3–5 để hạ rủi ro bị Google gom nhóm.
3. **Đặt ngưỡng hành động cho cột captcha** ở `/campaign`: dưới 15% là bình thường; 15–25% thì giảm số luồng, giãn khung
   giờ chạy, giảm lượt/ngày; trên 25% liên tục thì đổi đầu/gói proxy hoặc chuyển sang cách ở mục 4.
4. **Muốn thống kê và tạm loại theo từng IP thì dùng kiểu "Danh sách proxy"** với các session cố định: dán khoảng 20 dòng
   cùng một đầu proxy nhưng khác số session, dạng `<username-gốc>-VN-1001@host:port`, `-1002`, … `-1020`.
   Mỗi dòng là một session cố định; app luân phiên theo dòng nên **biết được IP nào hay bị captcha** và tự tạm loại
   (nhờ hai ô *Tạm loại sau* / *Thời gian tạm loại*). Nhược điểm: một session gắn với một IP, đổi IP chậm hơn kiểu xoay.
5. **Về băng thông và chi phí**: proxy residential thường tính tiền theo GB, mà tốc độ chỉ ~1–1,4 Mbps. Với 5 trang Google
   và 60–70 giây ở lại trang đích, mỗi lượt có thể tốn từ vài MB đến vài chục MB. Muốn tiết kiệm: giảm **Số trang Google
   tìm**, giảm **Ở lại trang đích**, tắt phần xem trang con nếu không cần.
6. **Kiểm tra trước khi chạy**: `npm run proxy:check`, và `npm run proxy:check -- --count=10 --parallel` trước chiến dịch lớn
   để biết có session nào lỗi hay ra IP ngoài Việt Nam không.

**Giới hạn cần biết (đọc từ mã nguồn)**

- `ProxyPool.report()` trả về sớm khi chế độ không phải `list` → **kiểu xoay không có tạm loại proxy**; hai ô
  *Tạm loại sau* / *Thời gian tạm loại* không có tác dụng.
- `ProxyPool.stats()` gộp mọi session xoay vào **một dòng** `host:port (xoay VN)` → chỉ thấy tỷ lệ captcha chung,
  không thấy dải IP nào bẩn. Muốn nhìn theo từng IP: xem mục 4 ở trên.
- Mật khẩu proxy đang lưu **dạng văn bản thường** trong `data/campaign.json` (xem mục 17.3) — nhớ để `.gitignore` chặn
  file này và không gửi kèm khi chia sẻ dự án.
- Sticky **không bảo đảm 100%**; nếu bạn đặt "Ở lại trang đích" rất dài (hàng chục phút), hãy kiểm tra lại bằng
  `npm run proxy:check -- --sticky`.

```powershell
npm run proxy:check                                   # 5 session, giống lúc chạy thật
npm run proxy:check -- --count=10 --parallel          # 10 session song song
npm run proxy:check -- --count=3 --sticky --speed     # thêm kiểm tra sticky và tốc độ
npm run proxy:check -- --file=data/campaign.json      # chỉ định file cấu hình khác
```

## 13. Telegram & thông báo

### 13.1. Lấy Bot token và Chat ID

1. Trên Telegram, chat với **@BotFather** → `/newbot` → đặt tên → nhận **token** dạng `123456789:AA...`.
2. Nhắn ít nhất một tin cho bot của bạn, sau đó mở
   `https://api.telegram.org/bot<token>/getUpdates` để lấy `chat.id`
   (hoặc dùng bot @userinfobot). Với nhóm, thêm bot vào nhóm rồi lấy chat id âm `-100...`.
3. Vào `/campaign` → nhóm **Telegram**, dán token + chat id, bật "Báo sự cố" và/hoặc "Báo khi cần giải captcha".
4. Bấm nút **gửi báo cáo Telegram thử** để kiểm tra (sai token/chat id sẽ báo lỗi ngay).

### 13.2. Báo cáo ngày gồm gì

Gửi tự động 1 lần/ngày vào giờ đã đặt ("Gửi báo cáo ngày lúc"), nội dung:

- Trạng thái engine (đang chạy / đã dừng).
- Từng từ khóa: **đạt / chỉ tiêu**, số `✔ ok`, `không thấy`, `captcha`, `lỗi`.
- Tổng: `✔ ok` trên tổng chỉ tiêu, không thấy, captcha, lỗi.
- Proxy đã dùng: số lần thử · % captcha · % lỗi proxy · % thành công (tối đa 15 proxy).
- Gợi ý giờ tốt: **giờ ít captcha nhất và nhiều captcha nhất** trong ngày → dùng để chỉnh "Khung giờ chạy".

### 13.3. Thông báo trong app và cảnh báo desktop

- **Góc phải header** (`/my`, `/admin`) hiện `chờ duyệt: X · chưa đọc: Y`. Danh sách thông báo nằm ở khối **Thông báo**
  (tự làm mới mỗi 60 giây) kèm nút **Đánh dấu đã đọc tất cả**.
- Sự kiện sinh thông báo: chiến dịch mới **chờ duyệt** (báo admin), được **duyệt/từ chối** (báo chủ sở hữu, kèm lý do),
  **đủ chỉ tiêu** trong ngày, **được cấp thêm quyền chạy song song**.
- Khi một luồng cần **giải captcha tay**: Windows hiện **bong bóng cảnh báo + tiếng báo**, cửa sổ profile được đưa lên trước.

## 14. Dữ liệu, sao lưu, dọn dẹp

| Đường dẫn | Nội dung | Ghi chú |
| --- | --- | --- |
| `.env` | Cổng, `JWT_SECRET`, `AUTH_REQUIRED`, cookie… | **Bí mật — không commit** |
| `config.json` | Cấu hình của trang chạy đơn `/` | Tự lưu mỗi lần chạy |
| `data/campaign.json` | Cấu hình engine (threads, proxy, captcha, Telegram…) + từ khóa cũ | Ở chế độ CSDL chỉ còn phần cấu hình |
| `data/omni.db` (+ `-wal`, `-shm`) | CSDL chính: `users`, `campaigns`, `runs`, `campaign_stats_daily`, `notifications`, `audit_logs`, `settings` | **Không commit** |
| `data/runs.jsonl`, `data/stats.json` | Nhật ký từng lượt + thống kê theo ngày của engine (chế độ file) | Dùng để tra cứu/debug |
| `bridges.json` | URL bridge của các profile đang mở (tự sinh) | Có thể xoá khi không có profile nào mở |
| `data/server.out.log`, `data/server.err.log` | Log server khi chạy nền | Xem khi app báo lỗi |
| `last-run.txt` | Nhật ký lần chạy cuối (debug) | Không cần thiết khi đã có CSDL |

**Sao lưu**: dừng server (`Ctrl+C`) rồi sao chép cả `data/omni.db` (kèm `-wal`, `-shm`) và `.env` ra nơi khác.
**Phục hồi**: tắt server, chép đè file CSDL, mở lại app.
**Dọn dẹp**: profile tạm `omni-w-*` tự xoá sau mỗi lượt và khi thoát app; profile pool `omni-pool-*` do engine quản lý
(xoá/tạo lại theo "Tạo lại profile sau (lượt)"). Muốn reset sạch số liệu thì tạo lại CSDL bằng `npm run db:init`
sau khi xoá `data/omni.db` và tạo lại tài khoản.

## 15. Lệnh tham chiếu nhanh

| Lệnh | Việc |
| --- | --- |
| `npm start` | Chạy server (đọc `.env`, mặc định cổng 3300) |
| `npm run db:init` | Tạo/cập nhật lược đồ CSDL `data/omni.db` |
| `npm run db:import` | Nhập từ khóa cũ từ `data/campaign.json` vào CSDL (`-- --dry` xem trước, `-- --start` nhập xong bật chạy ngay) |
| `npm run db:fix-keywords` | Tách URL bị dán lẫn trong ô **Từ khóa** của các chiến dịch đã có (`-- --apply` để ghi; mặc định chỉ xem trước) — xem mục 16 |
| `npm run seed:admin -- <tên> <mật-khẩu> --role admin` | Tạo/đổi mật khẩu tài khoản (`-- --list` để liệt kê) |
| `npm run proxy:check [-- --count=8 --parallel --sticky --speed]` | Kiểm tra proxy xoay/danh sách **ngoài app** (không cần server, không cần OmniLogin): IP từng session, quốc gia/nhà mạng, độ trễ tới Google, sticky, tốc độ — xem mục 12.4 |
| `npm test` | Test lớp CSDL — **không cần** server |
| `npm run test:register` | Test ràng buộc đăng ký công khai (tên/mật khẩu, chống spam IP) — **không cần** server |
| `npm run test:engine` | Test engine ↔ CSDL — **không cần** server, không mở trình duyệt |
| `npm run test:ui` | Test giao diện (mọi trang nạp `/ui.css` + `/ui.js`, cú pháp script, id khớp HTML, `ui.js` chạy được) — **không cần** server |
| `npm run test:pricing` | Test bảng giá theo lượt (`pricing.mjs`): giá theo lượt, bậc giảm, bảng niêm yết theo loại traffic, chống lệch giá với `public/pricing.html` và chặn sót mô hình gói/license — **không cần** server |
| `npm run test:wallet` | Test ví & ngân sách (`wallet.mjs` + `wallet` trong `database/repo.mjs`): đơn giá theo loại chiến dịch, lượt nào mới bị trừ tiền, quy đổi USDT ↔ VND, chuẩn hoá ví nhận tiền, số dư không âm, sổ giao dịch — **không cần** server (xem [mục 21](#21-ví--ngân-sách-nạp-tiền-trừ-tiền-theo-lượt)) |
| `npm run test:auth -- 3300 admin <mật-khẩu>` | Test cổng đăng nhập — **cần** server đang chạy |
| `npm run test:roles -- 3300 admin <mật-khẩu>` | Test cấp/thu quyền admin + hai phiên admin/user **song song** — **cần** server đang chạy; tự tạo rồi xoá tài khoản admin thử, **không** đổi vai trò tài khoản bạn truyền vào |
| `npm run test:api -- 3300 admin <mật-khẩu>` | Test API chiến dịch — **cần** server đang chạy (tự dọn dữ liệu thử) |

Một số lệnh PowerShell hữu ích khi kiểm tra:

```powershell
# App có đang nghe cổng 3300 không
Get-NetTCPConnection -LocalPort 3300 -State Listen -ErrorAction SilentlyContinue

# Tình trạng server (không cần đăng nhập)
(Invoke-WebRequest "http://localhost:3300/api/health" -UseBasicParsing).Content

# Cổng công khai + dữ liệu cho Google (không cần đăng nhập)
(Invoke-WebRequest "http://localhost:3300/" -UseBasicParsing).StatusCode        # 200
(Invoke-WebRequest "http://localhost:3300/bang-gia" -UseBasicParsing).StatusCode  # 200 (bảng giá, xem mục 20)
(Invoke-WebRequest "http://localhost:3300/bang-gia" -UseBasicParsing).StatusCode      # 200 (bảng giá tĩnh; API /api/plans đã gỡ)
(Invoke-WebRequest "http://localhost:3300/robots.txt" -UseBasicParsing).Content
(Invoke-WebRequest "http://localhost:3300/sitemap.xml" -UseBasicParsing).Content

# OmniLogin API (cổng 35353) đã lên chưa
(Invoke-WebRequest "http://localhost:35353/profiles?page=1&pageSize=1" -UseBasicParsing).StatusCode

# 20 lượt chạy gần nhất
Get-Content data\runs.jsonl -Tail 20

# Log server (khi chạy nền)
Get-Content data\server.err.log -Tail 50
```

## 16. Xử lý sự cố

| Hiện tượng | Nguyên nhân thường gặp | Cách xử lý |
| --- | --- | --- |
| Trình duyệt báo không kết nối được `localhost:3300` | App chưa chạy | Chạy `start.bat` hoặc `npm start`; kiểm tra cửa sổ console có lỗi |
| `EADDRINUSE: address already in use` | Đã có một instance khác đang chạy | Đừng chạy thêm — mở `http://localhost:3300`; hoặc đổi `PORT` trong `.env` |
| Mở trang nào cũng bị đưa về `/login` | Chưa đăng nhập, hoặc phiên hết hạn, hoặc vừa đổi `JWT_SECRET` | Đăng nhập lại |
| API trả `401 Chưa đăng nhập hoặc phiên đã hết hạn` | Như trên | Đăng nhập lại ở `/login` |
| Đăng nhập báo `401 Sai tên đăng nhập hoặc mật khẩu.` | Sai tên/mật khẩu, hoặc tài khoản đã bị xoá | Kiểm tra bằng `npm run seed:admin -- --list`; quên mật khẩu thì `npm run seed:admin -- <tên> <mật-khẩu-mới>` |
| Đăng nhập báo `403 Tài khoản đang bị khoá.` | Tài khoản bị admin **khoá** | Nhờ admin vào `/admin` → **Tài khoản người dùng** → đổi trạng thái về `active` |
| Đăng nhập báo `500 Thiếu JWT_SECRET (tối thiểu 16 ký tự)…` | `.env` chưa có `JWT_SECRET` | Thêm `JWT_SECRET=<chuỗi-ngẫu-nhiên-≥32-ký-tự>` vào `.env` rồi khởi động lại app |
| Không thấy biểu mẫu **Tạo tài khoản** ở cổng `/` | Admin đã đặt `REGISTER_OPEN=0` (đóng đăng ký) | Mở lại bằng `REGISTER_OPEN=1` trong `.env` rồi khởi động lại, hoặc nhờ admin tạo ở `/admin` / chạy `npm run seed:admin -- <tên> <mật-khẩu>` (mục 4.1) |
| Đăng ký báo `429 Bạn đã thử đăng ký quá nhiều lần…` | Vượt `REGISTER_PER_10MIN` lần cho mỗi IP trong 10 phút | Chờ đúng số giây trong header `Retry-After`, hoặc tăng `REGISTER_PER_10MIN` trong `.env` |
| `seed-admin` báo *"Thiếu username hoặc password."* dù đã gõ tên | Bản mã cũ bị lỗi phân tích tham số: khi không có `--role`, tham số đầu tiên bị bỏ qua | Đã sửa ở `database/seed-admin.mjs` (dòng lọc `positional`); nếu bạn đang dùng bản copy cũ (ví dụ trong file zip xuất ra), cập nhật lại hoặc thêm `--role admin`/`--role user` để lệnh chạy đúng |
| API trả `503 Chưa cài đủ thư viện đăng nhập (bcrypt, jsonwebtoken, better-sqlite3)` | Chưa `npm install` / `better-sqlite3` build lỗi | `npm install` (nếu vẫn lỗi: cài lại theo đúng phiên bản Node đang dùng) |
| Báo kèm gợi ý "Hãy mở OmniLogin desktop và bật Bridge API (Settings → API, cổng 35353)" | OmniLogin chưa chạy / chưa bật API | Mở OmniLogin, đăng nhập, bật API ở cổng 35353; hoặc bật "Tự mở OmniLogin khi chưa chạy" ở `/campaign` |
| `/test` không có profile nào trong danh sách | OmniLogin chưa có profile, hoặc API chưa lên | Tạo profile trong OmniLogin → bấm **Tải lại** |
| Lượt lỗi `Can not call change IP URL. Bad Request` (kèm "profile đang bật Đổi IP khi mở") | Profile OmniLogin bật **Change IP** (đổi IP mỗi lần mở) nên mỗi lần mở lại gọi URL xoay IP; dịch vụ xoay IP từ chối vì vừa xoay xong. Đo thật 09/10/2026: profile `Sui`/`Sui1` bật tuỳ chọn này hỏng ~65% lượt, `Sui2` không bật thì 0 lỗi | Trong OmniLogin, sửa profile → phần Proxy → **tắt Change IP** (engine đã tự chờ đủ `rotateSec` giữa 2 lượt trên mỗi profile để IP tự xoay). Từ 09/10/2026 engine gặp lỗi này sẽ chờ 60 giây rồi thử lại 1 lần thay vì thử lại ngay (`isChangeIpError` trong `workflow/worker.mjs`) |
| Lượt chạy log "Không đọc được IP (proxy có thể lỗi)" / `Proxy không kết nối được.` | Sai thông tin proxy, proxy chết, hoặc profile tạo không kèm proxy | Kiểm tra Host/Port/Username/Mật khẩu/Quốc gia (mục 12.3); chạy `npm run proxy:check` để biết lỗi cụ thể |
| Proxy ra IP nước ngoài (Thái Lan, Indonesia, Kyrgyzstan, Bangladesh, Pakistan…) | Ô **Quốc gia** ở kiểu Proxy xoay để trống (đã đo thực tế: 10/10 IP rơi vào nước khác) | Điền `VN` ở `/campaign` rồi **Lưu cấu hình**; chạy `npm run proxy:check` để xác nhận lại (mục 12.4) |
| Tỷ lệ `captcha` cao khi đang dùng **proxy xoay** | Kiểu xoay không tạm loại được proxy và gộp mọi IP vào một dòng thống kê, nên không biết IP nào bẩn | Giảm số luồng xuống 3–5, giãn khung giờ; nếu vẫn cao thì chuyển sang kiểu **Danh sách proxy** với các session cố định để có thống kê + tạm loại theo từng IP (mục 12.4) |
| Lượt chạy chậm, tốn nhiều băng thông proxy | Proxy residential VN chỉ đạt ~126–177 KB/s (đo thực tế), mà gói residential tính tiền theo GB | Giảm **Số trang Google tìm** và **Ở lại trang đích**; tắt xem trang con khi không cần (mục 12.4) |
| Nhiều lượt `notfound` | URL đích không nằm trong số trang đã tìm | Tăng **Số trang Google tìm** lên 8–10; kiểm tra lại URL/từ khóa; nếu site **chưa lên hạng** cho từ khóa đó thì đổi **Kiểu truy vấn** sang *Từ khóa + tên miền* (mục 10.16) |
| `notfound` **dù mắt vẫn thấy URL trong kết quả Google** | **Ô “Từ khóa” bị dán lẫn URL** (vd `soi kèo nhà cái https://brfo.io/`) → engine hỏi Google bằng đúng chuỗi có cả URL nên truy vấn vô nghĩa, lúc thấy lúc không | Xem lại cột **Từ khóa** trong bảng Chiến dịch: nó chỉ được chứa từ khóa. Sửa chiến dịch (dán URL vào ô **URL đích**) hoặc chạy `npm run db:fix-keywords -- --apply` để tách hàng loạt. App đã tự tách khi dán và chặn khi ô từ khóa chỉ có URL |
| `notfound` **dù đã gõ đúng từ khóa và URL đích đúng** — nhật ký/lỗi ghi `Tên miền đã thấy: …` mà **không** có tên miền của bạn | URL đích **chưa lên hạng tự nhiên** cho từ khóa đó (engine chỉ nhận **kết quả tự nhiên**, **không tính quảng cáo trả tiền**) — không phải lỗi app | **Cách 1 (đúng cho site chưa lên hạng):** sửa chiến dịch → **Kiểu truy vấn** = **Từ khóa + tên miền** (mục 10.16): Google nhận `từ khóa + tên miền đích` nên trả về đúng site, lượt vẫn tính là lượt hiển thị/truy cập. **Cách 2:** chọn từ khóa site đang có thứ hạng, hoặc tăng **Số trang Google tìm** lên 8–10. Luôn xác nhận **URL đích** đúng tên miền site chạy thật |

| Lượt chạy báo `error` với `unknown state` | Trang kết quả Google chưa render xong / dạng trang lạ | Đã tự chịu được (chờ khối kết quả rồi mới quét). Lặp lại nhiều lần thì tăng thời gian chờ của bridge hoặc kiểm tra proxy |
| Tỷ lệ `captcha` cao (50–70%) | Proxy bị Google đánh dấu | Đổi sang proxy residential sạch hơn; dùng báo cáo Telegram để chọn khung giờ ít captcha; giảm số luồng |
| Cửa sổ Chrome báo **`ERR_CONNECTION_CLOSED` / "This site can't be reached"** ở **trang đích** (Google vẫn tìm ra URL, đúng vị trí `#1`) | IP proxy đó bị máy chủ đích (Cloudflare/CDN) đóng kết nối — reset trước khi bắt tay TLS xong. Đo thật với proxy xoay VN: chỉ **~1/4 session** vào được site, nối trực tiếp (không proxy) **100% OK** | Không phải lỗi app: engine **tự** đổi IP thử lại tối đa 3 lần (mục 10.8) rồi mới báo `error`. Xem cột **lỗi proxy** ở `/campaign`; nếu tỉ lệ cao thì đổi sang proxy sạch hơn (4G/residential không bị đánh dấu) hoặc chuyển kiểu **Danh sách proxy** để proxy lỗi bị **tạm loại** |
| Log `Đã bấm kết quả nhưng trang đích không mở trong 30 giây.` | Cùng nhóm lỗi mạng ở trên (IP proxy bị reset), hoặc trang đích quá nặng so với băng thông proxy residential | Như trên; giảm **Số luồng** để mỗi lượt được chia nhiều băng thông hơn |
| Log `⛔ Tài khoản #N đã đạt hạn mức <n> lượt/ngày — tạm bỏ qua chiến dịch của họ.` (kèm thông báo *"Đã đạt hạn mức … lượt/ngày"*) | Tài khoản chủ chiến dịch đã chạm hạn mức lượt/ngày của bản **trước 01/10/2026** (cột `users.daily_quota`) — bản hiện tại **không còn** cơ chế này nên dòng log đó không bao giờ xuất hiện nữa | Không cần xử lý. Nếu vẫn thấy, app chưa khởi động lại sau khi cập nhật — tắt rồi chạy lại `npm start` / `start.bat` |

| "Gói OmniLogin đã đạt số profile tối đa." | Gói đã dùng hết số profile | Xoá profile không dùng, hoặc để engine tự giảm luồng, hoặc nâng gói |
| "Code 429 / quá nhiều lần tạo profile" | Bị giới hạn tạo profile trong ngày | Ngừng tạo tới hôm sau, hoặc chuyển **Chế độ profile** sang `Dùng lại nhóm cố định` |
| Lượt chạy log `OmniLogin không cấp được bridge…` | Process `omniBridge` của OmniLogin chưa kịp sẵn sàng hoặc vừa bị kill (thường do lần mở trước bị ngắt giữa chừng) | App đã tự đóng profile và mở lại một lần; nếu lặp nhiều lần thì tắt hẳn rồi mở lại OmniLogin, đóng bớt cửa sổ Chrome đang mở và giảm **Số luồng** |
| Đã tạo chiến dịch mà engine không chạy | Chưa được **duyệt**; tài khoản bị khoá; ngoài khung giờ; hết hạn mức; chưa tới lượt theo lịch rải đều; RAM thấp; engine đang dừng | Xem `/my` (cột Duyệt/Chạy), `/admin` (đèn trạng thái), `/campaign` (khung giờ, RAM); bấm **Bắt đầu** |
| Chiến dịch báo "đủ chỉ tiêu hôm nay" nhưng hôm sau không thấy chạy | Việc nền mở lại chạy mỗi 60 giây | Chờ 1 phút hoặc bấm **Chạy tiếp** ở `/admin`; kiểm tra tài khoản chưa bị khoá |
| Panel **Đang chạy** không cập nhật | Kết nối realtime (SSE) bị chặn | Tải lại trang (Ctrl+F5); kiểm tra app không bị chặn bởi tường lửa/antivirus |
| Cảnh báo "Không ghi được lượt chạy vào CSDL" | Không mở/ghi được `data/omni.db` | Tắt app, kiểm tra quyền ghi thư mục `data`, chạy lại `npm run db:init` |
| Máy chậm, RAM đầy | Quá nhiều luồng Chrome | Giảm **Số luồng tối đa**, tăng **RAM trống tối thiểu**, giữ **Chừa RAM mỗi luồng mới** ~650 MB, bật **Chạy ẩn**, đóng bớt profile trong OmniLogin |
| Cảnh báo `RAM trống … < … cần thiết (… sàn + … cho luồng vừa mở)` | Engine đang chừa RAM cho các luồng vừa mở nên không mở thêm luồng | Đóng bớt app/cửa sổ Chrome đang mở, giảm **Số luồng tối đa**, hoặc giảm **Chừa RAM mỗi luồng mới** (`0` = tắt) — xem mục 10.9 |
| Panel *Đang chạy* đứng mãi ở một bước, luồng chạy rất lâu | Một lượt bị **treo** (bridge/CDP không trả lời) | App tự **đóng profile sau 10–90 phút** và chạy lại 1 lần; nếu lặp lại nhiều lần thì tắt hẳn/mở lại OmniLogin (cũng dọn luôn các bridge cũ) — mục 10.9 |
| Lượt di động không cuộn được / bấm không ăn | Profile không phải di động, hoặc đang chạy ẩn | Lượt di động **luôn tự mở cửa sổ** (engine bỏ "Chạy ẩn"); mở **Nhật ký** phải thấy `Thiết bị: …` và `UA di động: … Mobile …` — nếu UA không có "Mobile" thì xem lại fingerprint profile trong OmniLogin (mục 10.10) |
| Tỉ lệ máy tính / di động không giống 70/30 | Quy định chỉ là **mặc định**: engine chia theo số lượt nên cần đủ số lượt trong khung/ngày mới thấy đúng tỉ lệ; hoặc bạn đã đổi **Tỉ lệ di động (%)** / chọn hẳn một loại thiết bị | Xem dòng trạng thái trên `/campaign` (`thiết bị … (hôm nay: …)`) và cột **Thiết bị** ở bảng lượt gần đây; đặt lại **Tỉ lệ di động (%) = 30** rồi **Lưu cấu hình** (mục 10.10) |
| Telegram không gửi được | Sai token/chat id, chưa nhắn tin cho bot | Làm lại mục 13.1 rồi dùng nút gửi báo cáo thử |
| Quên mật khẩu admin | — | Nhờ một admin khác bấm **Đặt lại mật khẩu** ở `/admin`, hoặc chạy `npm run seed:admin -- admin` |

## 17. Checklist hằng ngày & bảo mật

### 17.1. Hằng ngày

1. Mở app (`start.bat`) và **đăng nhập**.
2. Kiểm tra **đèn trạng thái engine** ở `/my` hoặc `/admin`: engine có đang chạy, OmniLogin có kết nối được không.
3. Xem **Tổng quan / Traffic theo ngày**: số lượt hôm nay có tăng không, `captcha`/`lỗi` có bất thường không.
4. Xem panel **Đang chạy**: có luồng nào kẹt ở một bước quá lâu, IP trống (proxy lỗi) không.
5. Admin: xử lý **hàng chờ duyệt** (Duyệt / Từ chối kèm lý do) và xem **thông báo**.
6. Xem **RAM/CPU của máy**; nếu RAM trống xuống thấp thì giảm số luồng.

### 17.2. Hằng tuần

1. Xem bảng **thống kê proxy** ở `/campaign`: proxy nào tỷ lệ captcha/lỗi cao thì thay. Ở kiểu **Proxy xoay** chỉ có một
   dòng tổng — muốn soi chất lượng IP thì chạy `npm run proxy:check -- --count=10 --parallel` (mục 12.4).
2. Kiểm tra **số dư CapSolver** (mục 11) để tránh hết tiền giữa ngày.
3. Xem **Nhật ký thao tác** ở `/admin`: phát hiện thay đổi lạ.
4. **Sao lưu** `data/omni.db` + `.env` (mục 14).

### 17.3. Bảo mật

| Việc | Cách làm |
| --- | --- |
| Đổi mật khẩu admin định kỳ | `set OMNI_PASSWORD=<mật-khẩu-mạnh>` rồi `npm run seed:admin -- admin` (không đưa mật khẩu vào lịch sử lệnh), sau đó khởi động lại server |
| Khoá bí mật JWT | `JWT_SECRET` ≥ 32 ký tự ngẫu nhiên; khi nghi lộ thì đổi → mọi phiên cũ hết hiệu lực |
| Không commit dữ liệu nhạy cảm | `.gitignore` trong thư mục `Omni` đã loại `.env`, `data/`, `*.zip`, `node_modules/` — kiểm tra lại trước mỗi lần commit |
| Bí mật trong `data/campaign.json` | `solverApiKey` (CapSolver) và mật khẩu proxy đang lưu **dạng văn bản thường** → hạn chế quyền truy cập file, và chuyển sang bảng `settings` khi có trang cấu hình riêng |
| Chỉ chạy trong mạng nội bộ | Không mở cổng app ra Internet; nếu buộc phải mở thì đặt sau reverse proxy HTTPS + `COOKIE_SECURE=1` và đổi cổng |
| `AUTH_REQUIRED` | Giữ `1`; chỉ đặt `0` khi gỡ lỗi và nhớ bật lại |
| Cổng công khai khi mở ra Internet | Đặt `PUBLIC_URL=https://tên-miền` (canonical/sitemap đúng), `COOKIE_SECURE=1` sau HTTPS, và cân nhắc `REGISTER_OPEN=0` nếu không muốn người lạ tự tạo tài khoản |
| Tài khoản tự đăng ký | Duyệt danh sách ở `/admin` → **Tài khoản người dùng**; kẻ lạ thì **Khoá** (tài khoản bị khoá không đăng nhập được, API trả `403`). Giảm spam bằng `REGISTER_PER_10MIN` |
| Vai trò admin | Chỉ cấp cho người thật sự cần; **Khoá** tài khoản không dùng nữa |

## 18. Câu hỏi thường gặp

**1. Tôi có cần để màn hình/RDP luôn mở không?**
App chạy trên máy tính của bạn. Với chế độ *chờ giải captcha tay* thì cần một phiên có màn hình (cửa sổ profile phải
thao tác được). Nếu chạy thuần tự động với CapSolver thì có thể tắt màn hình, nhưng **đừng tắt app**.

**2. Chỉ tiêu "500 lượt/ngày" có phải là 500 lượt vào được site?**
Không hẳn: chỉ tiêu tính cả lượt `ok`, lượt `notfound` (không thấy URL) và lượt `captcha`. Muốn biết số lượt **vào được site**
thì xem cột **ok hôm nay**. Nhờ vậy chỉ tiêu phản ánh đúng số lần app đã thực sự thử.

**3. Tại sao chiến dịch của tôi tạo xong mà không chạy?**
Vì mọi chiến dịch phải được **admin duyệt** trước (kể cả chiến dịch do admin tạo). Sau khi bấm **Duyệt & chạy**, engine
sẽ chạy ở nhịp lập lịch kế tiếp. Xem thêm mục 10.3 để biết các điều kiện còn lại (khung giờ, hạn mức, RAM…).

**4. Sửa chiến dịch có làm mất số liệu đã chạy không?**
Không. Mỗi lượt chạy đã lưu từ khóa/URL **tại thời điểm chạy**, nên biểu đồ và lịch sử cũ không đổi.
Lưu ý: sửa chiến dịch ở `/my` sẽ đưa nó về **chờ duyệt lại**.

**5. Chạy được bao nhiêu chiến dịch cùng lúc?**
Phụ thuộc ba thứ: **Số luồng tối đa** (engine — trần chung), **Số chiến dịch chạy đồng thời** của tài khoản (admin cấp bằng nút
**Cấp chạy song song**), và tài nguyên máy (**RAM trống tối thiểu** + **Chừa RAM mỗi luồng mới**). Vượt thì engine không mở
thêm luồng (có cảnh báo ở khung *Nhật ký*), hoặc API từ chối bật thêm chiến dịch (*"… chạy song song (hạn mức tài khoản)"*).
Lưu ý: **tạo/gửi duyệt** nhiều chiến dịch thì không bị hạn mức này chặn — chỉ khi **bật** mới bị. Cách cấp quyền, bảng chọn
số luồng theo RAM và mẹo chạy song song ổn định: mục **10.7** và **10.9**.

**5b. Một chiến dịch thì được chạy mấy luồng?**
Mặc định **1 luồng** (tuần tự). Muốn một chiến dịch tự chiếm nhiều luồng để kịp chỉ tiêu dày — ví dụ 50 lượt/giờ mà mỗi lượt
~4 phút (1 luồng chỉ được ~15 lượt/giờ) — thì sửa chiến dịch và đặt **Luồng chạy song song tối đa** = 3. Số luồng thực dùng
= **min(trần riêng của chiến dịch, Số luồng tối đa của engine)**, có hiệu lực ngay ở nhịp lập lịch sau: mục **10.17**.

**6. Xoá chiến dịch mà số liệu vẫn còn?**
Đúng — nếu chiến dịch đã có lượt chạy, nút **Xoá** ở `/my` chỉ **dừng** nó để giữ lịch sử. Admin có thể **Xoá hẳn**
ở `/admin` (kèm xoá các lượt chạy đã ghi).

**7. App có tự chạy khi bật máy không?**
Không tự động. Nếu muốn, tạo shortcut tới `start.bat` trong thư mục Startup của Windows (không khuyến nghị nếu
chưa chắc OmniLogin và proxy hoạt động tốt).

**8. Có chạy trên nhiều máy dùng chung dữ liệu không?**
Hiện chưa: CSDL là SQLite nằm cùng thư mục app (`data/omni.db`), mỗi bản chạy có dữ liệu riêng.

**9. Làm sao để đăng ký tài khoản? Không thấy nút Đăng ký ở trang đăng nhập.**
Trang đăng nhập không có form đăng ký — **biểu mẫu đăng ký nằm ở cổng công khai `/`**, tab **👤 Người dùng** (chi tiết ở mục 19 và 4.1).
App mặc định **mở** đăng ký tự do (1 chiến dịch chạy song song, chống spam theo IP); muốn tắt thì đặt `REGISTER_OPEN=0` trong `.env` rồi khởi động lại — khi đó chỉ admin tạo được tài khoản.
- Đã có admin → nhờ admin vào `/admin` → khối **Tài khoản người dùng** → **Tạo tài khoản**.
- Chưa có admin nào → chạy lệnh trong thư mục app:
  `$env:OMNI_PASSWORD="MatKhauCuaToi@2026"` rồi `npm run seed:admin -- admin` (PowerShell), hoặc
  `set OMNI_PASSWORD=MatKhauCuaToi@2026` rồi `npm run seed:admin -- admin` (cmd.exe).
  (Mật khẩu trong ví dụ chỉ là mẫu — hãy thay bằng mật khẩu của bạn.)
- Quên mật khẩu → chạy lại chính lệnh đó với tên tài khoản cũ, nó sẽ **ghi đè** mật khẩu + vai trò.
Chi tiết ở [mục 4.1](#41-tạo-tài-khoản-đăng-ký).

**10. Máy cần cấu hình thế nào để chạy 30 chiến dịch cùng lúc?**
Một luồng (1 cửa sổ Chrome đang chạy) thực đo chiếm **~1,1 GB RAM đỉnh** và **~0,7 lõi CPU**, mỗi lượt ~4 phút.
Vậy 30 chiến dịch bật đồng thời, mỗi chiến dịch 1 luồng ⇒ **RAM 48 GB (tối thiểu) – 64 GB, 20–24 vCPU, ≥ 100 GB SSD/NVMe**.
Máy hiện tại (12 GB / 6 vCPU, không GPU) chạy ổn khoảng **3–4 luồng**. Ba điểm dễ bỏ sót:
(1) gói **OmniLogin phải cho ≥ 30 profile** (nếu không engine tự hạ số luồng — chặn cứng trước cả phần cứng);
(2) **proxy phải cho ≥ 30 IP đồng thời**, lưu lượng ước **4–10 GB/giờ**;
(3) khi chạy nhiều chiến dịch hãy đặt **RAM trống tối thiểu 4000–5000 MB** và **Chừa RAM mỗi luồng mới 1200 MB**.
Nếu chỉ tiêu là **theo ngày**, thường **không cần** 30 luồng: 10 luồng đã đủ chạy hết 30 chiến dịch × 100 lượt/ngày trong ~20 giờ.
Bảng chi tiết theo số luồng ở **mục 10.9**.

**11. Có chạy traffic bằng di động (Android/iPhone) được không?**
Được — và **mặc định engine đã chạy theo quy định 70% máy tính / 30% di động** (chia theo số lượt:
100 lượt/giờ = 70 lượt máy tính + 30 lượt di động; chạy theo ngày cũng chia y vậy cho cả ngày).
Muốn đổi thì vào `/campaign` → **Thiết bị chạy traffic**, chọn `Di động (Android/iPhone)` hoặc đổi
**Tỉ lệ di động (%)**. Lượt di động dùng profile Android/iPhone có UA di động + tương tác chạm/vuốt
thật, và **tự bỏ "Chạy ẩn"** cho riêng lượt đó. Lưu ý: proxy nên là **4G/residential** và Google captcha
thường gặp hơn khi chạy mobile — chi tiết, cách kiểm chứng và cấu hình khuyến nghị ở **mục 10.10**.

---

Tài liệu liên quan:

- `HUONG-DAN-CHIEN-DICH.md` — kiến trúc & API của hệ thống chiến dịch nhiều người dùng.
- `CAPTCHA-NOTES.txt` — ghi chú kỹ thuật captcha/CapSolver, cách đổi task type, thêm solver khác.
- `README` trong mã nguồn từng file (`campaign.mjs`, `api.mjs`, `database/repo.mjs`…) nêu rõ hàm và tham số.

## 19. Cổng công khai `/` — 2 tab Người dùng & Quản trị

Đây là **trang chủ** của app và là địa chỉ mở cho cả khách chưa đăng nhập (cùng `/login`). Trang được viết để **Google lập chỉ mục**:
`title`, `description`, `canonical`, Open Graph, `robots.txt`, `sitemap.xml` và dữ liệu có cấu trúc JSON-LD (WebSite, SoftwareApplication, FAQPage).

**Hai tab** (bấm nút, hoặc mở thẳng `/#user` và `/#admin`):

| Tab | Nội dung | Dành cho |
| --- | --- | --- |
| **👤 Người dùng (User)** | Quy trình 4 bước, biểu mẫu **Tạo tài khoản**, bảng 5 loại chiến dịch, **Câu hỏi thường gặp** | Khách mới, người dùng thường |
| **🛡 Quản trị (Admin)** | 6 bước vận hành (duyệt chiến dịch, quản lý tài khoản, cấu hình engine, theo dõi trực tiếp, xử lý sự cố), bảng phân quyền, checklist bảo mật | Quản trị viên |

Cả hai tab **hiển thị cho mọi người** (để crawler đọc được và khách biết app làm được gì); phần *thao tác* mới bị chặn theo vai trò:

- Mở cho tất cả: `/`, `/login`, `/robots.txt`, `/sitemap.xml`, `/api/register`, `/api/login`, `/api/logout`, `/api/health`.
- Phải đăng nhập: `/my`, `/admin` và các `/api/*` còn lại.
- Chỉ vai trò `admin`: `/admin`, `/campaign`, `/test` — tài khoản `user` bị chuyển về `/my` (API tương ứng trả `403`).

**Đăng ký tài khoản** (tab Người dùng — xem thêm **mục 4.1**) gọi `POST /api/register`:

```json
{ "username": "nguyenvana", "displayName": "Nguyễn Văn A", "password": "matkhau123", "passwordConfirm": "matkhau123" }
```

Trả `201` + cookie phiên, đồng thời tạo 2 thông báo trong app (một cho người mới, một cho admin kèm IP + hạn mức).
Mã lỗi: `400` dữ liệu sai · `403` khi `REGISTER_OPEN=0` · `409` tên đã tồn tại · `429` vượt giới hạn theo IP (kèm `Retry-After`) · `503` thiếu thư viện đăng nhập.

**Đưa lên mạng cho Google tìm thấy:**

1. Đặt `PUBLIC_URL=https://tên-miền-của-bạn` trong `.env` rồi khởi động lại → `canonical`, `og:url`, JSON-LD và `sitemap.xml` dùng đúng tên miền.
2. Mở cổng ra Internet qua reverse proxy HTTPS trỏ về `http://localhost:3300`, bật `COOKIE_SECURE=1`.
3. Kiểm tra `https://tên-miền/robots.txt` và `https://tên-miền/sitemap.xml` truy cập được, rồi gửi sitemap trong Google Search Console.
4. Muốn dừng nhận người lạ: `REGISTER_OPEN=0` — cổng vẫn xem được, biểu mẫu báo *"Đăng ký đang tạm đóng"*.

> Trang `/` **không** hiển thị dữ liệu chiến dịch, số liệu hay cấu hình; mọi thứ riêng tư vẫn nằm sau đăng nhập ở `/my` và `/admin`.







## 20. Bảng giá `/bang-gia`

Trang **`/bang-gia`** là trang bán hàng công khai (khách chưa đăng nhập vẫn xem được, Google lập chỉ mục được).
Chỉ còn **một cách tính tiền: theo LƯỢT XEM hoàn thành** (chế độ "chạy hộ trên máy chủ"). Mô hình **gói tự cài /
thuê license** đã được **gỡ khỏi hệ thống ngày 30/09/2026** — không còn gói, không còn hạn mức luồng theo tài khoản,
nên trang này không còn bảng so sánh gói, công tắc tháng/năm hay form "yêu cầu nâng gói".

### 20.1. Bảng giá NIÊM YẾT theo loại traffic

Khối 4 thẻ đầu trang là con số khách nhìn thấy trước tiên: 4 loại traffic × 4 mốc thời gian ở lại
(nguồn: `pricing.mjs` > `TRAFFIC_PRICES` + `DWELL_TIERS`, nên không thể lệch với app):

| Loại traffic (nguồn truy cập) | 60 giây | 120 giây | 150 giây | 200 giây |
| --- | --- | --- | --- | --- |
| **Search Traffic** — tìm kiếm Google (`search_dwell`) | 1.100đ | 1.540đ | 1.760đ | 1.980đ |
| **Direct Traffic** — vào thẳng URL (`direct_visit`) | 660đ | 880đ | 990đ | 1.100đ |
| **Social Traffic** — Facebook, YouTube… | 880đ | 1.100đ | 1.320đ | 1.540đ |
| **Backlink Traffic** — referral từ site khác về | 990đ | 1.320đ | 1.540đ | 1.760đ |

Ngay dưới khối này trang ghi rõ **"Giá trên được áp dụng từ ngày 01/03/2026 cho đến khi có thông báo mới nhất"**
(`pricing.mjs` > `PRICE_EFFECTIVE_FROM`) và đơn vị tính là **1 lượt xem hoàn thành**. Nút **Mua ngay** ở mỗi thẻ là
link `#bat-dau` (tắt JS vẫn dùng được) — đưa khách xuống khối **Bắt đầu chạy** ở cuối trang.
Social/Backlink chưa có loại chiến dịch tương ứng trong engine — trang ghi "đặt riêng theo yêu cầu", admin chốt
nguồn traffic khi nhận yêu cầu.

Bảng **chi tiết theo mã chiến dịch** (khối dưới) bám đúng 5 loại chiến dịch thật trong `campaign-types.mjs`,
nên con số trên trang luôn mô tả đúng việc engine sẽ làm:

| Loại lượt (mã loại chiến dịch) | Ở lại | Giá/lượt |
| --- | --- | --- |
| Organic ngắn (`search_click`) | 5–15 giây | 700đ |
| Direct (`direct_visit`) | 60–120 giây | 1.000đ |
| Organic chuẩn (`search_dwell`) | 60–120 giây | 1.500đ |
| Đọc sâu (`deep_browse`) | 9–20 phút | 6.000đ |
| Kiểm tra từ khóa (`search_only`) | — | 300đ |

Bậc giảm theo tổng số lượt: ≥5.000 lượt **−10%**, ≥20.000 **−20%**, ≥50.000 **−30%**.
Lượt captcha/lỗi được chạy lại tối đa 3 lần và **không tính tiền**.

### 20.2. Khách đặt hàng bằng cách nào

Trang bảng giá **không có form đặt hàng**: cuối trang có khối **Bắt đầu chạy** (`#bat-dau`) dẫn khách **Tự đăng ký**
(`/#dang-ky`) hoặc **Đăng nhập** (`/login`). Vào bảng điều khiển, khách tạo chiến dịch (từ khóa + URL + chỉ tiêu mỗi
giờ/ngày, chọn loại traffic tương ứng) → admin **duyệt** ở `/admin` → engine rải lượt 24/7 và ghi nhật ký từng lượt.
Giá cuối cùng do admin xác nhận theo số lượng thật; hệ thống **chưa có cổng thanh toán tự động** nên bước thu tiền
vẫn làm ngoài app (chuyển khoản).

### 20.3. SEO cho trang bảng giá

- `PUBLIC_URL` trong `.env` được thay vào `{{PUBLIC_URL}}` của `pricing.html` (canonical, `og:url`, JSON-LD).
- `/sitemap.xml` có thêm `/bang-gia`; `/robots.txt` có `Allow: /bang-gia` (các trang trong app vẫn `Disallow`).
- JSON-LD gồm **Product + Offer** (4 dòng giá niêm yết rẻ nhất của từng loại traffic + 1 dòng giá theo lượt),
  **FAQPage** (6 câu hỏi) và **BreadcrumbList** — nhờ vậy kết quả tìm kiếm có thể hiện giá và câu hỏi.
- Toàn bộ giá, tính năng, FAQ đều là **HTML tĩnh**, nên tắt JS hoặc trình đọc màn hình vẫn đọc đủ; JS trong trang chỉ
  còn lo nút đổi sáng/tối (`window.OmniUI.themeButton()`).

### 20.4. Sửa giá ở đâu (một nguồn sự thật)

Mọi con số nằm trong **`pricing.mjs`** ở gốc repo (`VISIT_PRICES`, `TRAFFIC_PRICES` + `DWELL_TIERS` +
`PRICE_EFFECTIVE_FROM`, `VOLUME_TIERS`, `ADDONS`, `GUARANTEES`, `PRICE_FAQ`). Quy trình đổi giá:

1. Sửa `pricing.mjs`.
2. Chạy **`npm run test:pricing`** — test sẽ **báo FAIL** nếu `public/pricing.html` chưa khớp (thiếu giá mới,
   thiếu câu hỏi FAQ, thiếu cam kết, thiếu dịch vụ cộng thêm…).
3. Cập nhật `public/pricing.html` theo đúng chỉ dẫn trong thông báo FAIL: giá NIÊM YẾT nằm ở từng ô
   `<td data-tp="<loại>-<giây>" data-price="…">` trong `.tp-grid` — phải sửa **cả `data-price` lẫn chữ hiển thị**
   trong ô đó, lệch một trong hai là test báo FAIL. Bảng chi tiết theo mã chiến dịch và dòng bậc giảm giá cũng nằm
   trong HTML tĩnh nên sửa tay ở cùng chỗ.
4. Chạy lại `npm run test:pricing` và `npm run test:ui` rồi **khởi động lại server**. Không còn API giá nào cần nạp
   lại (route `/api/plans` đã gỡ cùng mô hình gói).

## 21. Ví & ngân sách (nạp tiền, trừ tiền theo lượt)

Hệ thống chạy hộ nên **tiền tính theo từng lượt đã chạy thật**: mỗi tài khoản có một **ví** tính bằng **VND**;
admin nhận **USDT**, quy đổi rồi **nạp** vào ví; engine **trừ** đúng đơn giá của loại chiến dịch sau mỗi lượt chạy
thành công. Số dư **không bao giờ âm** và mọi biến động đều nằm trong **sổ giao dịch** để hai bên đối soát được.

### 21.1. Ví nhận tiền của admin

Vào `/admin` → khối **“Ví nhận tiền của quản trị viên”**, điền:

| Ô | Ý nghĩa |
|---|---|
| **Địa chỉ ví USDT** | Địa chỉ admin nhận USDT (vd `TX…`). |
| **Mạng USDT** | `TRC20` (Tron — phổ biến, phí thấp), `ERC20`, `BEP20` hoặc “Mạng khác”. Phải khớp mạng bên gửi, **sai mạng là mất tiền**. |
| **Tỷ giá (VND / 1 USDT)** | Tỷ giá quy đổi đang áp dụng, vd `26000`. Để trống/0 thì hệ thống dùng mặc định **26.000đ**. |
| **Ngân hàng / Số tài khoản / Chủ tài khoản** | Tuỳ chọn — dùng khi khách chuyển khoản nội địa thay vì USDT. |
| **Ghi chú gửi người dùng** | Câu nhắc hiện ngay dưới ví nhận tiền ở trang của người dùng. |

Bấm **Lưu ví nhận tiền**. Thông tin ví nhận tiền do admin gửi cho người dùng trực tiếp; trang `/my` chỉ hiện số dư.
Mỗi lần lưu đều được ghi vào **Nhật ký thao tác** (đối tượng `settings`).

### 21.2. Admin nạp tiền cho tài khoản

Người dùng chuyển USDT cho admin, admin quy đổi rồi nạp vào ví của họ. Ba cách vào cùng một chỗ:

- **Nạp từ bảng tài khoản**: `/admin` → bảng **“Tài khoản người dùng”** → nút **Nạp tiền** ở dòng của người đó
  (tự chọn sẵn tài khoản rồi cuộn tới khung nạp tiền).
- **Khung “Nạp tiền & điều chỉnh số dư”**: chọn **Tài khoản nhận**, nhập **Số USDT nhận được** + **Tỷ giá**,
  ghi chú (mã giao dịch USDT) rồi bấm **Nạp vào số dư**. Dòng xem trước hiện ngay số tiền sẽ nạp
  (vd `10 USDT × 26.000đ = 260.000đ`).
- **Nạp thẳng VND**: bỏ trống ô USDT và nhập số VND vào ô điều chỉnh — hệ thống nạp đúng số VND đó.

**Điều chỉnh số dư** dùng cho hoàn tiền / trừ bù: nhập số VND với **âm = trừ**, ghi lý do rồi bấm
**Điều chỉnh số dư**. Không thể trừ quá số dư hiện có (hệ thống báo `Số dư không đủ để trừ`).

Mỗi lần nạp/điều chỉnh hệ thống tự làm 4 việc: (1) cập nhật số dư, (2) ghi một dòng vào **Sổ giao dịch ví** kèm
**mã giao dịch** dạng `TS000123`, (3) ghi **Nhật ký thao tác**, (4) gửi **thông báo** cho người dùng.

### 21.3. Trừ tiền theo lượt chạy & tự tạm dừng khi hết tiền

Đơn giá lấy từ **`pricing.mjs`** — đúng cùng bảng giá công khai `/bang-gia` nên không bao giờ lệch:

| Loại chiến dịch | Đơn giá 1 lượt |
|---|---|
| Tìm Google → bấm vào → thoát nhanh (`search_click`) | 700đ |
| Vào thẳng URL (`direct_visit`) | 1.000đ |
| Tìm Google → vào URL → đọc (`search_dwell`) | 1.500đ |
| Tìm Google → vào URL → đọc sâu (`deep_browse`) | 6.000đ |
| Chỉ tìm Google (`search_only`) | 300đ |

**Chỉ trừ khi lượt chạy THÀNH CÔNG và THỰC SỰ vào được trang đích.** Các lượt sau **không** bị trừ:

- lượt **“chỉ lấy hiển thị”** (cứ 20 lượt có 1 lượt — thấy kết quả trên Google nhưng không bấm vào, mục 10.14);
- lượt **`search_only`** (chỉ tra từ khóa, không vào site);
- lượt lỗi, không thấy URL, captcha, hết hạn mức tạo profile của OmniLogin.

Cơ chế trước – sau khi hết tiền:

1. **Trước mỗi lượt**, engine chỉ lấy chiến dịch mà chủ tài khoản có **số dư ≥ đơn giá 1 lượt**. Ví không đủ →
   chiến dịch không vào danh sách chạy, engine đứng yên (không chạy “chịu” rồi đòi tiền sau).
2. **Sau mỗi lượt thành công**, engine trừ tiền và ghi sổ. Nếu ví vừa cạn giữa chừng thì lượt đó không trừ được,
   chiến dịch bị **tạm dừng ngay**, và hệ thống gửi thông báo cho **cả người dùng lẫn admin** (mỗi chiến dịch chỉ
   báo một lần trong ngày để không spam).
3. **Nạp tiền xong không cần bấm gì thêm**: nhịp lập lịch (5 giây/lần) tự đưa các chiến dịch **đang bật** vào chạy
   lại. Riêng chiến dịch đã bị tạm dừng vì hết tiền thì giữ nguyên trạng thái “tạm dừng” — chủ tài khoản bấm
   **Chạy** để bật lại (tránh việc tiền vừa vào đã tiêu hết mà chủ tài khoản không biết).

### 21.4. Người dùng theo dõi số dư

Ở `/my`, người dùng thấy số dư ở hai nơi, đều cập nhật **realtime** (engine vừa trừ hoặc admin vừa nạp là thẻ tự vẽ lại, không phải tải lại trang —
qua luồng `/api/events`, 3 giây/lần):

- **Thống kê**: thẻ **Số dư còn lại** kèm nút **+ Nạp thêm** (mở hộp thoại thông tin ví nhận tiền của admin, có nút **Sao chép**).
- **Tài khoản & Nạp tiền → Ngân sách**: 5 thẻ *còn lại · đã chạy · đã nạp · khuyến mại · tổng ngân sách* và bảng **Giao dịch gần đây** với 2 tab
  **Nạp tiền** / **Khuyến mại** (ngày, mã giao dịch, số tiền, USDT, tỷ giá, phương thức, trạng thái).

Người dùng **không** thấy tiền trừ **từng chiến dịch** và sổ giao dịch loại *chạy chiến dịch*: bảng chiến dịch không có cột tiền, màn Ngân sách không
tải giao dịch `spend`. (API `/api/wallet` vẫn trả đủ dữ liệu cho tài khoản đó — chỉ giao diện không hiển thị; cần chặn hẳn thì sửa `api.mjs`.)

Ở `/admin`, ngoài ví nhận tiền và khung nạp tiền còn có **Sổ giao dịch ví toàn hệ thống** (lọc theo tài khoản và
loại giao dịch), cùng hai cột **Số dư** / **Đã chạy** ngay trong bảng tài khoản.

### 21.5. CSDL & kiểm thử

- Bảng **`wallets`** (số dư VND của từng tài khoản) và **`wallet_txns`** (sổ giao dịch: `kind` =
  `topup | spend | adjust | bonus`, `amount` âm/dương, `usdt`, `rate`, `method`, `balance_after`, `campaign_id`,
  `actor_id`). Hai bảng **tự được tạo khi khởi động** — không cần migrate CSDL cũ.
- Ví nhận tiền của admin nằm trong bảng **`settings`** với các khoá `wallet.usdtAddress`, `wallet.usdtNetwork`,
  `wallet.usdtRate`, `wallet.bankName`, `wallet.accountNo`, `wallet.accountName`, `wallet.note`.
- Chạy **`npm run test:wallet`** để kiểm tra logic ví: đơn giá, lượt nào mới trừ tiền, quy đổi USDT ↔ VND, chuẩn
  hoá ví nhận tiền, số dư không âm, sổ giao dịch. Xoá tài khoản là ví + sổ giao dịch của tài khoản đó bị dọn theo.

