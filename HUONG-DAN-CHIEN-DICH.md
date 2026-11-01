# Hệ thống chiến dịch nhiều người dùng (Omni)

Tài liệu này mô tả phần mới thêm vào app Omni: người dùng tự tạo **chiến dịch theo từ khóa**, admin
**duyệt** trước khi chạy, engine chạy theo chỉ tiêu **mỗi giờ / mỗi ngày**, có **tiến độ realtime**,
**biểu đồ traffic theo ngày** và **traffic theo từng từ khóa**, kèm **thông báo trong app** và **nhật ký thao tác**.

## 1. Vai trò & luồng làm việc

1. **Người dùng** (role `user`) đăng nhập → mở `/my` → tạo chiến dịch: từ khóa, URL đích, **kiểu truy vấn gõ lên
   Google** (chỉ từ khóa / từ khóa + tên miền), loại chiến dịch, số lượt mỗi **giờ** hoặc mỗi **ngày**, thời gian
   bắt đầu/kết thúc (tuỳ chọn), ghi chú gửi admin.
2. Chiến dịch mới ở trạng thái `pending` (chờ duyệt) và **chưa chạy**. Admin nhận thông báo trong app.
3. **Admin** mở `/admin` → xem hàng chờ duyệt → **Duyệt & chạy** hoặc **Từ chối** (kèm lý do gửi cho người dùng).
   Admin cũng có thể sửa từ khóa / URL / số lượt / loại / ưu tiên / thời gian của bất kỳ chiến dịch nào.
4. Engine (campaign.mjs) mỗi 5 giây đọc các chiến dịch **đã duyệt + đang bật + chủ tài khoản còn hoạt động +
   trong khoảng thời gian cho phép** và mở luồng chạy theo lịch rải đều trong khung giờ hoạt động.
5. Mỗi lượt chạy ghi vào `runs` + cộng dồn `campaign_stats_daily` → `/my` và `/admin` vẽ biểu đồ,
   hiện tiến độ và bảng từ khóa. Khi một chiến dịch đủ chỉ tiêu trong ngày, nó tự chuyển `done`
   và **tự mở lại vào ngày hôm sau**.

## 2. Loại chiến dịch (preset, người dùng chỉ chọn loại)

| Mã | Ý nghĩa | Hành vi engine |
| --- | --- | --- |
| `search_dwell` | Tìm Google → vào URL → đọc (tiêu chuẩn) | ở lại 60–120s, xem 1 trang con |
| `search_click` | Tìm Google → bấm vào → thoát nhanh | ở lại 5–15s, không xem trang con |
| `search_only` | Chỉ tìm Google, không bấm vào URL | dừng ở trang kết quả (kiểm tra từ khóa/thứ hạng) |
| `direct_visit` | Vào thẳng URL (không qua Google) | ở lại 60–120s, xem 1 trang con, không có referrer Google |
| `deep_browse` | Tìm Google → vào URL → đọc sâu (thời gian dài) | ở lại 240–480s, xem 3 trang con (90–180s) ⇒ ≈ 9–20 phút/lượt |

Nguồn duy nhất: `campaign-types.mjs` (engine đọc qua `engineParams(type)`, API/UI đọc qua `GET /api/meta`).

**Kiểu truy vấn gõ lên Google** là **thuộc tính của từng chiến dịch** (cột `campaigns.query_mode`, hằng số
`QUERY_MODES` trong `campaign-types.mjs`), độc lập với *loại chiến dịch* ở bảng trên:

| Mã | Ý nghĩa | Google nhận |
| --- | --- | --- |
| `keyword` (mặc định) | Chỉ gõ từ khóa | `soi kèo nhà cái` |
| `keyword_domain` | Từ khóa + tên miền đích | `soi kèo nhà cái https://brfo.io` |

`searchQuery({ keyword, targetUrl, queryMode })` là **nguồn duy nhất** dựng chuỗi đem đi tìm (engine
`workflow/google-search.mjs`, API `toCampaign()` và cả hai giao diện dùng lại). Lý do tồn tại: engine **so khớp
URL ĐÍCH** trong kết quả chứ không so khớp từ khóa, nên site **chưa lên hạng** mà gõ từ khóa trần thì không bao
giờ ra site (0 lượt hiển thị) — chọn `keyword_domain` để Google buộc trả về đúng site. Chuỗi thật đã gõ lưu ở
`runs.query` (từ khóa gốc vẫn ở `runs.keyword`) — **kể cả lượt thất bại** `notfound`: lỗi "Không tìm thấy URL"
là lớp `NotFoundError` mang theo `query` nên worker trả về `res.query` và engine vẫn ghi được vào `runs.query`.
Chi tiết cách dùng + ảnh hưởng SEO: **mục 10.16** của `HUONG-DAN-SU-DUNG.md`.

## 3. Trang giao diện

| Đường dẫn | Nội dung | Ai xem được |
| --- | --- | --- |
| `/` | **Cổng công khai 2 tab**: 👤 Người dùng (đăng ký + hướng dẫn 4 bước, bảng loại chiến dịch, FAQ) và 🛡 Quản trị (6 bước vận hành, bảng phân quyền, checklist). Có `canonical`/Open Graph/JSON-LD để Google lập chỉ mục | Tất cả (kể cả khách) |
| `/bang-gia` | **Bảng giá công khai**: khối niêm yết 4 loại traffic (Search / Direct / Social / Backlink) × 4 mốc ở lại 60/120/150/200 giây kèm nút "Mua ngay", bảng chi tiết theo 5 loại chiến dịch, dịch vụ cộng thêm, cam kết, 6 câu hỏi thường gặp, khối "Bắt đầu chạy". SEO: canonical/OG + JSON-LD (Product, FAQPage, BreadcrumbList) | Tất cả (kể cả khách) |
| `/login` | Đăng nhập (JWT trong cookie httpOnly `omni_token`) | Tất cả |
| `/my` | **Bảng điều khiển người dùng** (thanh bên + thanh trên, 5 màn hình theo `#hash`): **Thống kê** (thẻ màu, báo cáo theo ngày, traffic theo từ khóa, lượt chạy gần đây / đang chạy thu gọn), **Chiến dịch** (danh sách có tab lọc trạng thái + biểu mẫu tạo), **Ngân sách** (5 thẻ + giao dịch nạp tiền / khuyến mại), **Thông báo** | Đã đăng nhập |
| `/admin` | **Quản trị** (cùng khung thanh bên + thanh trên với `/my`, 8 màn hình theo `#hash`): Tổng quan (thẻ màu, traffic, luồng đang chạy), Chờ duyệt, Tất cả chiến dịch (sửa bằng hộp thoại), Tài khoản, Nạp tiền & ví nhận tiền, Sổ giao dịch ví, Thông báo, Nhật ký thao tác | Chỉ `admin` |
| `/campaign` | Cấu hình engine chi tiết (threads, proxy, captcha, Telegram, khung giờ…). Ở chế độ CSDL, ô "danh sách từ khóa" chỉ để xem | Chỉ `admin` |
| `/test` | Chạy thử một lượt thủ công trên một profile (trước đây là `/`) | Chỉ `admin` |
| `/robots.txt`, `/sitemap.xml` | Dữ liệu cho crawler; tên miền lấy từ `PUBLIC_URL` | Tất cả |

## 4. API chính (trừ các route công khai ghi chú ở dưới)

| Phương thức & đường dẫn | Việc |
| --- | --- |
| `POST /api/register` | **Công khai** — tự đăng ký tài khoản `user` (không còn hạn mức chạy song song), chống spam `REGISTER_PER_10MIN` lần/IP/10 phút; `REGISTER_OPEN=0` → `403` |
| `GET /api/meta` | Loại chiến dịch, **kiểu truy vấn** (`queryModes`), đơn vị, trạng thái, thông tin engine (có đang chạy, chế độ CSDL) |
| `GET /api/badges` | Số thông báo chưa đọc + số chiến dịch chờ duyệt (admin) |
| `GET/POST /api/campaigns` | Danh sách (admin thấy tất cả, `?mine=1` để chỉ của mình) / tạo mới (→ chờ duyệt). Mỗi chiến dịch kèm `queryMode` + `query` (**truy vấn thật sẽ gõ lên Google**); `ranks` = **vị trí Google mới nhất theo từng thiết bị** (`{ [id]: { desktop, mobile } }`) |
| `GET/PATCH/DELETE /api/campaigns/:id` | Chi tiết (kèm lượt chạy + thống kê) / sửa / xoá (có lượt chạy thì chỉ **dừng** để giữ lịch sử; admin dùng `?hard=1` để xoá hẳn) |
| `POST /api/campaigns/:id/status` | Đổi trạng thái chạy: `running` \| `paused` \| `stopped` \| `idle` |
| `POST /api/campaigns/:id/approve` \| `/reject` | Duyệt (tự bật chạy) / từ chối kèm lý do — **chỉ admin** |
| `GET/POST /api/users`, `PATCH/DELETE /api/users/:id` | Quản lý tài khoản — **chỉ admin**. `GET` kèm `balance` và `spent` (ví của từng tài khoản) |
| `GET /api/wallet` | **Ví của chính mình** (số dư, đã nạp, khuyến mại, đã chạy, tiền đã chạy của từng chiến dịch, sổ giao dịch) + **ví nhận tiền của admin**. Admin xem ví người khác bằng `?userId=` |
| `GET /api/wallet/transactions` | Sổ giao dịch ví — người dùng chỉ thấy của mình; admin thấy tất cả (`?userId=`, `?kind=`) |
| `POST /api/wallet/topup` | **Nạp tiền** cho một tài khoản: `{ userId, usdt, rate }` (hoặc `amountVnd` nạp thẳng VND) — **chỉ admin** |
| `POST /api/wallet/adjust` | **Điều chỉnh số dư** (âm = trừ, dùng để hoàn tiền/trừ bù) — **chỉ admin** |
| `GET/POST /api/settings/wallet` | **Ví nhận tiền của admin** (USDT + mạng + tỷ giá + ngân hàng + ghi chú) — **chỉ admin** |
| `GET /api/stats/daily` | Traffic theo ngày (`?days=30`, `?campaignId=`, `?from=&to=`) |
| `GET /api/stats/keywords` | Traffic theo từng từ khóa (từ khóa được chụp lại vào `runs` lúc chạy) |
| `GET /api/stats/summary` | Tổng lượt / hôm nay / ok / captcha / lỗi |
| `GET /api/runs` | Lượt chạy gần đây (kèm `device_kind` + `device` để tách ranking máy tính / di động, và `query` = truy vấn thật đã gõ lên Google) |
| `GET /api/notifications`, `POST /api/notifications/read-all`, `POST /api/notifications/:id/read` | Thông báo trong app |
| `GET /api/audit` | Nhật ký thao tác — **chỉ admin** |
| `GET /api/events` | **SSE**: đẩy tiến độ (luồng đang chạy, số lượt hôm nay, sự kiện, **số dư ví của người đang xem**) mỗi 3 giây |

Quyền: người thường chỉ thấy/sửa chiến dịch của mình; mọi thao tác quan trọng đều ghi `audit_logs`.

## 5. Cấu trúc mã

| File | Vai trò |
| --- | --- |
| `database/init.mjs` | Lược đồ SQLite (users, campaigns, runs, campaign_stats_daily, audit_logs, notifications, settings, **wallets, wallet_txns**) |
| `database/repo.mjs` | Lớp truy vấn duy nhất (users / campaigns / runs / stats / audit / notifications / settings / **wallet**) |
| `database/import-tasks.mjs` | Nhập danh sách từ khóa cũ từ `data/campaign.json` vào CSDL (tự tách URL dán lẫn trong từ khóa) |
| `database/fix-keywords.mjs` | Lệnh bảo trì `npm run db:fix-keywords`: tách URL bị dán lẫn trong ô **Từ khóa** của các chiến dịch đã có (`-- --apply` mới ghi) |
| `campaign-store.mjs` | Cầu nối engine ↔ CSDL (đọc chiến dịch đủ điều kiện **+ còn tiền trong ví**, ghi lượt chạy, trừ tiền ví, thông báo, audit) |
| `wallet.mjs` | **Logic ví & ngân sách** (thuần, không CSDL): đơn giá lượt lấy từ `pricing.mjs`, luật **lượt nào mới bị trừ tiền** (`chargeableRun`), quy đổi USDT ↔ VND, chuẩn hoá ví nhận tiền của admin + phiếu nạp, mã giao dịch (test bằng `tests/wallet.test.mjs`) |
| `campaign-types.mjs` | 5 loại chiến dịch + hằng số dùng chung + `splitKeywordUrl()` (tách URL dán lẫn trong ô **Từ khóa** — dùng chung cho `api.mjs`, `import-tasks.mjs` và test) + **kiểu truy vấn** (`QUERY_MODES`, `searchQuery()`, `targetHost()` — dựng chuỗi thật đem đi tìm Google, dùng chung cho engine + API + giao diện) |
| `pricing.mjs` | **Danh mục giá** (một nguồn sự thật): giá NIÊM YẾT 4 loại traffic × 4 mốc ở lại (`TRAFFIC_PRICES`, `DWELL_TIERS`, `PRICE_EFFECTIVE_FROM`), giá theo lượt + bậc giảm, dịch vụ cộng thêm, cam kết, FAQ + hàm `trafficPrice`/`visitPrice` (test bằng `tests/pricing.test.mjs`). Mô hình gói tự cài/license đã gỡ nên **không còn khái niệm "gói"** |
| `api.mjs` | Toàn bộ route API mới + luồng SSE (`/api/events`) |
| `campaign.mjs` | Engine: lịch rải đều theo giờ/ngày, đa luồng, ghi CSDL, thông báo |
| `auth/register.mjs` | Ràng buộc + chống spam đăng ký công khai (dùng bởi `server.mjs`; test bằng `tests/register.test.mjs`) |
| `workflow/human.mjs` | Lớp "thao tác như người thật": quỹ đạo chuột, nhịp bấm/gõ phím, nấc con lăn, chạm/vuốt touch — chi tiết ở **mục 10.11** của `HUONG-DAN-SU-DUNG.md` |
| `public/portal.html` | **Cổng công khai `/`**: 2 tab Người dùng / Quản trị, form đăng ký, SEO (canonical, OG, JSON-LD) |
| `public/pricing.html` | **Bảng giá công khai `/bang-gia`**: khối niêm yết `.tp-grid` (4 thẻ traffic × 4 mốc ở lại + nút "Mua ngay"), bảng chi tiết theo mã chiến dịch, dịch vụ cộng thêm, cam kết, FAQ, khối "Bắt đầu chạy" (`#bat-dau`) + JSON-LD — số liệu phải khớp `pricing.mjs` (test đối chiếu từng ô qua `data-tp`/`data-price`) |
| `public/my.html`, `public/admin.html` | Giao diện người dùng và quản trị (không còn thẻ **Gói & hạn mức** / nút cấp "chạy song song"; giao diện dạng thanh bên + thẻ số liệu màu (khung dùng chung `ui.css` + `OmniUI.shell` trong `ui.js`) ở `/my` và `/admin`, trong đó `/admin` có 3 khối **ví nhận tiền / nạp tiền & điều chỉnh / sổ giao dịch ví** ở `/admin`) |
| `public/ui.css`, `public/ui.js` | **Bộ giao diện dùng chung** (nạp ở mọi trang qua `/ui.css` + `/ui.js`): màu/nút/bảng/tab, thanh tiêu đề + menu theo vai trò, chip người dùng, đổi sáng/tối, thông báo nổi, hộp xác nhận, gọi API, lọc/sắp xếp bảng — chi tiết ở **mục 10.13** của `HUONG-DAN-SU-DUNG.md` |
| `tests/*.test.mjs` | `repo` (CSDL), `engine` (engine ↔ CSDL, gồm cả trừ tiền ví + tự tạm dừng khi hết tiền), `register` (đăng ký công khai), `pricing` (giá theo lượt + bảng niêm yết theo loại traffic + chống lệch giá với `pricing.html`), `wallet` (ví & ngân sách: đơn giá, lượt nào mới trừ tiền, quy đổi USDT, sổ giao dịch), `ui` (giao diện: nạp bộ chung, cú pháp script, id khớp HTML), `api` (API trên server thật), `auth` (đăng nhập + cổng + phân quyền) |

**Thiết bị chạy traffic** (`device` / `mobilePercent`) là **cấu hình chung của engine**, không phải thuộc tính
của từng chiến dịch: mọi chiến dịch đều đi theo cấu hình này ở `/campaign`. Quy định mặc định là
**70% máy tính / 30% di động**, chia theo **số lượt** trong từng khung giờ và trong ngày (`campaign.nextDevice()`
dùng `deviceKindAt()` của `workflow/worker.mjs`; 100 lượt/giờ = 70 lượt máy tính + 30 lượt di động, lượt thử lại
giữ nguyên thiết bị). Chi tiết cách engine tạo profile di động, tương tác chạm/vuốt thật, khác biệt Google mobile
và khuyến nghị proxy: xem **mục 10.10** của `HUONG-DAN-SU-DUNG.md`. Cách engine di chuột, bấm, gõ phím và cuộn
"giống người thật" (quỹ đạo cong, nhịp ngẫu nhiên, gõ sai rồi xoá): xem **mục 10.11** cùng tài liệu.

**Lượt "chỉ hiển thị"** (`impressionEvery`) cũng là **cấu hình chung của engine**: cứ **20 lượt có tìm Google thì
1 lượt** chỉ gõ từ khóa rồi **đóng tab**, không bấm vào kết quả — site nhận **lượt hiển thị** trên Google mà
không nhận lượt truy cập (`campaign.nextImpression()` dùng `impressionAt()` của `workflow/worker.mjs`; chia theo
**số lượt**, chỉ đếm lượt có bấm vào kết quả, lượt thử lại giữ nguyên kiểu lượt; `workflow/google-search.mjs`
nhận cờ `impressionOnly` và `closeTab()` đóng tab qua API tabs của OmniLogin). Lượt này vẫn tính vào chỉ tiêu,
ghi vào `runs` với cột **`impression = 1`**. Chi tiết + cách đặt lại tỉ lệ (`0` = tắt): xem **mục 10.14** của
`HUONG-DAN-SU-DUNG.md`.

**Ví & ngân sách** (`wallets` + `wallet_txns`, logic ở `wallet.mjs` — xem **mục 21** của `HUONG-DAN-SU-DUNG.md`):
mỗi tài khoản có **số dư VND**; admin khai **ví nhận tiền** (USDT + tỷ giá + ngân hàng) ở `/admin`, nhận USDT rồi
**nạp** vào ví người dùng. Engine **trừ tiền theo từng lượt chạy thành công** với đơn giá lấy từ `pricing.mjs`
(`visitCost()`); lượt **"chỉ lấy hiển thị"**, lượt **`search_only`** và mọi lượt lỗi/không thấy URL/captcha **không**
bị trừ (`chargeableRun()`). Số dư **không bao giờ âm**:

- `campaign-store.runnable()` chỉ trả chiến dịch mà chủ tài khoản còn **≥ đơn giá 1 lượt** → ví cạn thì engine
  đứng yên, không chạy "chịu";
- sau mỗi lượt, `campaign.chargeVisit()` trừ tiền và ghi `wallet_txns`; nếu ví vừa cạn thì `pauseForWallet()`
  **tạm dừng chiến dịch** + báo chủ tài khoản và admin (một lần/chiến dịch/ngày);
- nạp tiền xong, nhịp lập lịch kế tiếp tự đưa các chiến dịch **đang bật** vào chạy lại (chiến dịch đã bị tạm dừng
  thì chủ tài khoản phải bấm **Chạy** — tránh tiền vừa vào đã tiêu hết mà không biết);
- số dư đi kèm luồng SSE nên thẻ ví ở `/my` cập nhật **realtime**; mọi khoản nạp/trừ/điều chỉnh đều nằm trong
  `wallet_txns` (mã `TSxxxxxx`, số dư sau giao dịch) và `audit_logs`.

## 6. Lệnh thường dùng

```bat
npm start                                  :: chạy server (đọc .env, mặc định cổng 3300)
npm run db:init                            :: tạo/cập nhật lược đồ (chạy lại nhiều lần vẫn an toàn)
npm run db:import                          :: nhập từ khóa cũ từ data/campaign.json vào CSDL
npm run db:import -- --dry                 :: xem trước sẽ nhập gì
npm run db:import -- --start               :: nhập xong bật chạy ngay
npm run db:fix-keywords                    :: xem trước các chiến dịch có URL dán lẫn trong ô Từ khóa
npm run db:fix-keywords -- --apply         :: tách URL ra khỏi từ khóa (giữ nguyên URL đích)
npm run seed:admin -- admin <mật-khẩu>     :: tạo/đổi mật khẩu admin (>= 8 ký tự)
npm run seed:admin -- --list               :: liệt kê tài khoản

npm test            :: test lớp CSDL (database/repo.mjs)     — không cần server
npm run test:engine :: test engine ↔ CSDL                    — không cần server, không mở trình duyệt
npm run test:register :: test ràng buộc đăng ký + chống spam — không cần server
npm run test:ui     :: test giao diện (nạp bộ chung, cú pháp script, id khớp HTML) — không cần server
npm run test:pricing :: test bảng giá theo lượt (bảng niêm yết theo loại traffic, giá theo lượt, chống lệch với pricing.html, chặn sót mô hình gói/license) — không cần server
npm run test:wallet :: test ví & ngân sách (đơn giá, lượt nào mới trừ tiền, quy đổi USDT, số dư không âm, sổ giao dịch) — không cần server
npm run test:auth -- 3300 admin <mật-khẩu>  :: test cổng đăng nhập + cổng công khai + phân quyền (cần server đang chạy)
npm run test:roles -- 3300 admin <mật-khẩu> :: test cấp/thu quyền admin + hai phiên admin/user song song (cần server đang chạy)
npm run test:api  -- 3300 admin <mật-khẩu>  :: test API chiến dịch (cần server đang chạy; tự dọn dữ liệu thử)
```

## 7. Ghi chú vận hành

- **Từ khóa luôn sạch URL**: ô “Từ khóa” **chỉ** nhận từ khóa. Nếu người dùng dán cả dòng kiểu
  `soi kèo nhà cái https://brfo.io/`, `api.mjs` (qua `splitKeywordUrl()` của `campaign-types.mjs`) tự tách URL ra,
  dùng làm URL đích khi ô đó trống; ô từ khóa **chỉ có URL** thì trả `400` kèm hướng dẫn. Giao diện `/my` và
  `/admin` cũng tách ngay khi dán. Vì sao quan trọng: để lẫn URL trong từ khóa thì engine gửi nguyên chuỗi lên
  Google, truy vấn vô nghĩa và lượt chạy báo `notfound` **dù mắt vẫn thấy URL trong kết quả**. Sửa hàng loạt cho
  dữ liệu cũ: `npm run db:fix-keywords -- --apply` (mặc định chỉ xem trước).
- **Engine so khớp URL ĐÍCH, không so khớp từ khóa**: từ khóa chỉ được gõ lên Google; còn việc "tìm thấy"
  là so **tên miền + đường dẫn** của URL đích với từng kết quả tự nhiên (`matchesTarget()` trong
  `workflow/google-search.mjs`). Vì vậy thấy đúng từ khóa trên thanh địa chỉ Google **không** bảo đảm lượt
  chạy `ok` — khi không thấy URL, log/lỗi giờ ghi kèm **danh sách tên miền đã thấy**
  (`Tên miền đã thấy: thethaovanhoa.vn, baomoi.com, …`) để phân biệt ngay: tên miền đích **có** trong danh
  sách (bị đổi hướng/lệch đường dẫn) hay **không** (site chưa lên hạng cho từ khóa đó). Lưu ý engine chỉ
  nhận **kết quả tự nhiên** — kết quả **quảng cáo** (trả tiền) không được tính vào vị trí. Nếu tên miền đích
  **không** có trong danh sách đó thì **không phải lỗi app**: site chưa lên hạng cho từ khóa ấy — chuyển chiến dịch
  sang **kiểu truy vấn `keyword_domain`** (*Từ khóa + tên miền*) để Google trả về đúng site, hoặc chọn từ khóa site
  đang có thứ hạng (xem **mục 10.16** của `HUONG-DAN-SU-DUNG.md`).
- **Kiểu truy vấn gõ lên Google** (`campaigns.query_mode`: `keyword` \| `keyword_domain`) là thuộc tính của **từng
  chiến dịch**, sửa được ở `/my` và `/admin`; engine ghi lại chuỗi thật đã gõ vào `runs.query` và nhật ký lượt in
  ra ngay dòng đầu (`① Từ khóa: … · truy vấn gửi Google: …`). Giao diện `/my` và `/admin` cũng hiện lại truy vấn
  khi nó khác từ khóa. Nguồn duy nhất dựng chuỗi: `searchQuery()` trong `campaign-types.mjs`.
- **Vị trí Google tách theo thiết bị**: Google xếp hạng khác nhau cho máy tính và di động nên mỗi lượt lưu
  `runs.device_kind` (`desktop | mobile`) + `runs.device` (nhãn: `máy tính`, `Android 412x915`…). Giao diện hiện
  **hai con số** (`🖥 #3 · 📱 #14`) lấy từ `repo.runs.rankByDevice()` — lượt **mới nhất có ghi vị trí** của mỗi
  thiết bị; lượt `notfound`/`captcha` không có vị trí nên không ảnh hưởng. Chi tiết ở **mục 10.15** của
  `HUONG-DAN-SU-DUNG.md`.
- **Bước “Trang kết quả tìm kiếm”** (`workflow/google-search.mjs`) chỉ đòi URL là `/search?q=…` rồi **chờ** khối
  `#search/#rso` hiện ra (tối đa 10 giây) — trước đây đòi khối phải có sẵn nên Google di động (có lượt không render
  `#rso`) làm lượt chạy kẹt ở `unknown state`.
  Danh sách từ khóa cũ trong file được giữ nguyên (không bị ghi đè) để có thể quay lại nếu cần.
  Thiếu `better-sqlite3` → engine tự quay về chạy danh sách trong `campaign.json` như trước.
- **Tự bật/tắt**: khi còn ít nhất một chiến dịch đủ điều kiện thì engine chạy; hết chiến dịch thì tự đứng yên.
  Nút **Bắt đầu / Dừng** ở `/campaign` (và ở `/admin`) thao tác hàng loạt: bật lại mọi chiến dịch đã duyệt / tạm dừng tất cả.
- **Chỉ tiêu**: `unit=day` → rải `count` lượt trong khung giờ hoạt động; `unit=hour` → mỗi giờ trong khung chạy đủ `count` lượt.
  Lượt **ok / không thấy URL / captcha** tính vào chỉ tiêu; `error` (lỗi hạ tầng như proxy) chỉ ghi để thống kê lỗi.
  Lỗi hạ tầng được **tự chạy lại một lần** ngay (đổi IP) trước khi tính là `error`; khi đã tính `error` thì từ khóa đó nghỉ 2 phút.
- **Không còn hạn mức "số chiến dịch chạy song song"** (mô hình gói tự cài/license gỡ 30/09/2026): chiến dịch đã duyệt
  thì bật được, không cần admin cấp quyền. Trần thật do **Số luồng tối đa** ở `/campaign` + RAM còn trống quyết định.
  Chống spam khi tạo: mỗi tài khoản giữ tối đa **3** chiến dịch chờ duyệt và **50** chiến dịch tổng cộng.
  **Không còn hạn mức lượt/ngày theo tài khoản**: engine chỉ chạy theo chỉ tiêu của từng chiến dịch (các cột cũ
  `users.max_slots`/`users.daily_quota` vẫn nằm trong CSDL nhưng không ai đọc).
- **Ví & ngân sách**: engine chỉ chạy chiến dịch khi ví của chủ tài khoản còn **đủ đơn giá 1 lượt**; mỗi lượt
  **thành công có vào trang đích** bị trừ tiền và ghi `wallet_txns`. Ví cạn giữa chừng → **tự tạm dừng chiến dịch**
  và báo cả người dùng lẫn admin. Nạp tiền lại thì các chiến dịch **đang bật** tự chạy tiếp, còn chiến dịch đã bị
  tạm dừng thì chủ tài khoản bấm **Chạy**. Đơn giá = `visitPrice()` của `pricing.mjs`; ví nhận tiền của admin lưu
  trong bảng `settings` (các khoá `wallet.*`) — chi tiết ở **mục 21** của `HUONG-DAN-SU-DUNG.md`.

- **Số luồng ≠ hạn mức tài khoản**: **Số luồng tối đa** ở `/campaign` là **trần số Chrome của cả engine** (một pool luồng
  dùng chung). Mỗi chiến dịch còn có **trần riêng** — ô **Luồng chạy song song tối đa** khi tạo/sửa chiến dịch
  (`campaigns.max_threads`, mặc định `1` = tuần tự) — nên một chiến dịch chỉ tiêu dày (vd 50 lượt/giờ, mỗi lượt ~4 phút) có
  thể được chiếm 3 luồng để đuổi kịp lịch thay vì chỉ ~15 lượt/giờ. Số luồng thực dùng = min(trần riêng, trần chung); chi
  tiết ở **mục 10.17** của `HUONG-DAN-SU-DUNG.md`.
  Muốn chạy **15 chiến dịch song song** (mỗi chiến dịch 1 luồng) thì đặt **Số luồng tối đa = 15** và **máy phải đủ tải** — cấu hình máy + thông số
  cần đặt đã chốt ở mục **10.9** của `HUONG-DAN-SU-DUNG.md` (chốt: 32 GB RAM, 16 vCPU, ≥ 60 GB SSD trống, ≥ 100 Mbps,
  proxy ≥ 20–30 session, gói OmniLogin ≥ 15 profile).
- **Lịch sử**: `runs.keyword` / `runs.target_url` / `runs.query` (truy vấn thật đã gõ lên Google) được chụp lại lúc chạy nên admin sửa chiến dịch không làm sai số liệu đã ghi.
- **Xoá chiến dịch**: nếu đã có lượt chạy thì mặc định chỉ **dừng** (giữ biểu đồ traffic); admin có thể xoá hẳn bằng `?hard=1`.
- **Khoá tài khoản**: các chiến dịch đang chạy của tài khoản đó bị tạm dừng ngay, engine bỏ qua chiến dịch của tài khoản bị khoá.
- **Cổng công khai `/`**: cả 2 tab render sẵn trong HTML để crawler đọc được, nhưng **quyền vẫn do server quyết định** —
  chỉ `/`, `/bang-gia`, `/login`, `/robots.txt`, `/sitemap.xml`, `/api/register`, `/api/login`, `/api/logout`, `/api/health` mở cho khách;
  `/admin`, `/campaign`, `/test` chuyển tài khoản `user` về `/my`. Tên miền trong `canonical`/`og:url`/`sitemap` lấy từ `PUBLIC_URL`
  (mặc định `http://localhost:PORT`); server thay thẻ `{{PUBLIC_URL}}` trong `public/portal.html` lúc phục vụ nên file tĩnh giữ nguyên.
- **Đăng ký tự do**: tài khoản tạo qua `/api/register` luôn có vai trò `user`, kèm 2 thông báo (người dùng + admin) và 1 dòng `audit_logs`
  (`action=create`). Giới hạn: `REGISTER_PER_10MIN` lần/IP/10 phút; dữ liệu sai/trùng tên không tính vào giới hạn đó.
- **Phiên đăng nhập**: tài khoản `status='locked'` bị chặn từ `/api/login` bằng `403` (không còn là `401`), và `users.last_login_at` được cập nhật mỗi lần đăng nhập.

## 8. Bảo mật cần làm tiếp

1. ~~**Đổi mật khẩu admin** (mật khẩu cũ đã lộ trong nhật ký phiên làm việc)~~ — **đã làm ngày 30/09/2026**:
   mật khẩu mới đã ghi vào `data/omni.db` (bcrypt), **không lưu ở bất kỳ file/tài liệu nào**.
   Khi cần đổi tiếp (định kỳ hoặc khi nghi lộ):
   ```bat
   set OMNI_PASSWORD=<mật-khẩu-mới-đủ-mạnh>
   npm run seed:admin -- admin
   ```
   `OMNI_PASSWORD` giúp mật khẩu không nằm trong lịch sử lệnh. `JWT_SECRET` trong `.env` đã được xoay
   (mọi phiên đăng nhập cũ hết hiệu lực). Đổi mật khẩu **không cần** khởi động lại server, nhưng đổi
   `JWT_SECRET` thì cần.
2. **Chuyển bí mật khỏi `data/campaign.json`**: `solverApiKey` (CapSolver) và mật khẩu proxy Webshare đang
   lưu dạng văn bản thường trong file đó. Bảng `settings` đã sẵn sàng để chuyển sang (kèm trang cấu hình riêng).
3. **Đã bổ sung `.gitignore`** trong thư mục `Omni` (loại `.env*`, `data/`, `last-run.txt`, `bridges.json`, `*.zip`, `export/`, `node_modules/`)
   — nhớ giữ file này khi copy/đóng gói mã, và không commit `.env`, `data/omni.db`, `data/*.json` lên kho mã.
4. **Proxy xoay: đã kiểm chứng thực tế ngày 30/09/2026 — xem mục 12.4 của `HUONG-DAN-SU-DUNG.md`.**
   Tóm tắt: **bắt buộc điền Quốc gia = `VN`** (để trống thì 10/10 IP rơi vào nước khác → lệch dấu vân tay `vi-VN`);
   sticky không bảo đảm 100%; kiểu xoay **không** tạm loại được proxy và gộp mọi IP vào một dòng thống kê;
   dùng `npm run proxy:check` để soi chất lượng proxy trước khi chạy chiến dịch lớn.
5. **Cổng công khai & đăng ký tự do** (thêm 30/09/2026): đăng ký mặc định **mở**, tài khoản mới dùng được đầy đủ tính năng
   ngay (không còn hạn mức chạy song song) — chống spam `REGISTER_PER_10MIN=3` lần/IP/10 phút. Nếu mở app ra Internet thì:
   đặt `PUBLIC_URL` đúng tên miền, `COOKIE_SECURE=1` sau HTTPS, cân nhắc `REGISTER_OPEN=0`, và **duyệt/khoá** tài khoản lạ ở `/admin`.
   Trang `/` chỉ là nội dung giới thiệu + form đăng ký, không lộ dữ liệu chiến dịch.

