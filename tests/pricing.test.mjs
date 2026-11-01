import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  VISIT_PRICES, VOLUME_TIERS, ADDONS, GUARANTEES, PRICE_FAQ, TRAFFIC_PRICES, DWELL_TIERS,
  PRICE_EFFECTIVE_FROM, visitPrice, volumePrice, trafficPrice, formatVnd,
} from '../pricing.mjs';
import { CAMPAIGN_TYPES, CAMPAIGN_TYPE_IDS } from '../campaign-types.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const pricing = read('public/pricing.html');
const pricingText = pricing.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name} ${extra}`); }
};

console.log('\n== giá theo lượt (gắn với campaign-types.mjs) ==');
ok(`mọi loại chiến dịch thật đều có giá theo lượt (${CAMPAIGN_TYPES.length} loại)`,
  CAMPAIGN_TYPES.every(t => visitPrice(t.id) > 0),
  CAMPAIGN_TYPES.filter(t => !visitPrice(t.id)).map(t => t.id).join(', '));
ok('bảng giá theo lượt không có loại chiến dịch lạ',
  VISIT_PRICES.every(v => CAMPAIGN_TYPES.some(t => t.id === v.type)));
ok('giá organic chuẩn = 1.500đ', visitPrice('search_dwell') === 1500);
ok('giá rẻ nhất là organic ngắn 700đ', VISIT_PRICES.some(v => v.price === 700));
ok('loại không có trong bảng -> 0', visitPrice('khong-ton-tai') === 0);
ok('chỉ đánh dấu "chọn nhiều nhất" 1 dòng', VISIT_PRICES.filter(v => v.recommended).length === 1);

console.log('\n== bậc giảm theo số lượng ==');
ok('4 bậc giảm giá', VOLUME_TIERS.length === 4);
ok('bậc tăng dần theo số lượt', VOLUME_TIERS.every((t, i, a) => i === 0 || t.from > a[i - 1].from));
ok('1.000 lượt: giá gốc', volumePrice('search_dwell', 1000) === 1500);
ok('5.000 lượt: -10%', volumePrice('search_dwell', 5000) === 1350);
ok('20.000 lượt: -20%', volumePrice('search_dwell', 20000) === 1200);
ok('50.000 lượt: -30%', volumePrice('search_dwell', 50000) === 1050);
ok('dưới bậc thấp nhất vẫn là giá gốc', volumePrice('search_dwell', 10) === 1500);

console.log('\n== bảng giá NIÊM YẾT theo loại traffic (TRAFFIC_PRICES) ==');
const tpSearch = TRAFFIC_PRICES.find(t => t.kind === 'search');
const tpDirect = TRAFFIC_PRICES.find(t => t.kind === 'direct');
ok('có 4 loại traffic: search, direct, social, backlink',
  TRAFFIC_PRICES.map(t => t.kind).join(',') === 'search,direct,social,backlink');
ok('mã loại traffic không trùng nhau', new Set(TRAFFIC_PRICES.map(t => t.kind)).size === TRAFFIC_PRICES.length);
ok('mốc thời gian ở lại là 60/120/150/200 giây', DWELL_TIERS.join(',') === '60,120,150,200');
ok('mọi loại traffic đều có đủ 4 mốc thời gian',
  TRAFFIC_PRICES.every(t => t.tiers.map(x => x.seconds).join(',') === DWELL_TIERS.join(',')));
ok('giá tăng dần theo thời gian ở lại',
  TRAFFIC_PRICES.every(t => t.tiers.every((x, i, a) => i === 0 || x.price > a[i - 1].price)));
ok('ở lâu hơn thì giá mỗi giây rẻ hơn (khách ở lâu được lợi)',
  TRAFFIC_PRICES.every(t => t.tiers.every((x, i, a) => i === 0 || x.price / x.seconds < a[i - 1].price / a[i - 1].seconds)));
ok('cùng thời gian ở lại, Search Traffic đắt hơn Direct Traffic',
  tpSearch.tiers.every((x, i) => x.price > tpDirect.tiers[i].price));
ok('giá rẻ nhất trong bảng là Direct 60 giây (660đ)',
  Math.min(...TRAFFIC_PRICES.flatMap(t => t.tiers.map(x => x.price))) === 660);
ok('mọi mức giá là số nguyên dương',
  TRAFFIC_PRICES.every(t => t.tiers.every(x => Number.isInteger(x.price) && x.price > 0)));
ok('mọi loại traffic đều có tên riêng + mô tả dùng trên thẻ HTML',
  TRAFFIC_PRICES.every(t => t.name.length > 4 && t.tagline.length > 8));
ok('loại traffic có chiến dịch thật thì mã phải tồn tại trong campaign-types.mjs',
  TRAFFIC_PRICES.filter(t => t.campaignType).every(t => CAMPAIGN_TYPE_IDS.includes(t.campaignType)));
ok('loại chưa có chiến dịch tương ứng ghi rõ campaignType = null',
  TRAFFIC_PRICES.filter(t => !t.campaignType).map(t => t.kind).join(',') === 'social,backlink');
ok('trafficPrice() tra đúng một ô của bảng',
  trafficPrice('search', 120) === 1540 && trafficPrice('direct', 200) === 1100);
ok('trafficPrice() trả 0 khi loại hoặc mốc thời gian không có',
  trafficPrice('search', 999) === 0 && trafficPrice('khong-co', 60) === 0);
ok('ngày hiệu lực của bảng giá là 01/03/2026', PRICE_EFFECTIVE_FROM === '01/03/2026');

console.log('\n== dịch vụ cộng thêm / cam kết / câu hỏi ==');
ok('có ít nhất 4 dịch vụ cộng thêm, mỗi dịch vụ đủ 4 trường',
  ADDONS.length >= 4 && ADDONS.every(a => a.name && a.unit && a.price && a.note));
ok('dịch vụ cộng thêm không gắn với gói nào',
  ADDONS.every(a => !/gói/i.test(String(a.price) + String(a.note))));
ok('4 cam kết, mỗi cam kết có tiêu đề + nội dung đủ dài',
  GUARANTEES.length === 4 && GUARANTEES.every(g => g.title.length > 8 && g.body.length > 60));
ok('6 câu hỏi thường gặp', PRICE_FAQ.length === 6);
ok('mọi câu hỏi đủ dài để làm nội dung SEO', PRICE_FAQ.every(f => f.q.length > 8 && f.a.length > 60));
ok('câu hỏi không còn nhắc tới gói/license',
  !/license|nâng gói|thuê gói|hạn mức/i.test(JSON.stringify(PRICE_FAQ)));

console.log('\n== public/pricing.html: số liệu khớp pricing.mjs (một nguồn sự thật) ==');
ok('HTML có giá mọi loại lượt đúng theo bảng',
  VISIT_PRICES.every(v => pricing.includes(`${formatVnd(v.price)}đ`)));
ok('HTML có bậc giảm giá', pricing.includes('−10%') && pricing.includes('−20%') && pricing.includes('−30%'));
ok('HTML có mọi câu hỏi FAQ (kể cả khi tắt JS)', PRICE_FAQ.every(f => pricingText.includes(f.q)));
ok('HTML có mọi cam kết', GUARANTEES.every(g => pricingText.includes(g.title)));
ok('HTML có mọi dịch vụ cộng thêm', ADDONS.every(a => pricingText.includes(a.name)));
ok('HTML nạp bộ giao diện dùng chung', pricing.includes('href="/ui.css"') && pricing.includes('src="/ui.js"'));
ok('HTML có khối bắt đầu chạy (thay cho form yêu cầu gói)', pricing.includes('id="bat-dau"'));
ok('HTML giữ {{PUBLIC_URL}} cho canonical/OG/JSON-LD', pricing.includes('{{PUBLIC_URL}}/bang-gia'));
ok('HTML có JSON-LD Product + FAQPage', pricing.includes('"@type": "Product"') && pricing.includes('"@type": "FAQPage"'));
ok('HTML không tự định nghĩa lại api() (dùng UI.api để 401 -> /login)',
  !/(function|const|let|var)\s+api\s*[(=]/.test(pricing));

console.log('\n== public/pricing.html: bảng NIÊM YẾT theo loại traffic khớp pricing.mjs ==');
const tpCells = [...pricing.matchAll(/data-tp="([a-z]+)-(\d+)" data-price="(\d+)">([^<]+)</g)]
  .map(m => ({ kind: m[1], seconds: Number(m[2]), price: Number(m[3]), text: m[4].trim() }));
ok('HTML có đủ 16 ô giá (4 loại traffic × 4 mốc thời gian)', tpCells.length === 16, `thấy ${tpCells.length} ô`);
ok('chữ hiển thị khớp data-price (không lệch khi sửa tay)',
  tpCells.length === 16 && tpCells.every(c => c.text === `${formatVnd(c.price)}đ`));
ok('mọi ô trong pricing.mjs đều có trên HTML',
  TRAFFIC_PRICES.every(t => t.tiers.every(x => tpCells.some(c => c.kind === t.kind && c.seconds === x.seconds && c.price === x.price))));
ok('HTML không tự thêm ô giá lạ ngoài pricing.mjs',
  tpCells.every(c => TRAFFIC_PRICES.some(t => t.kind === c.kind && t.tiers.some(x => x.seconds === c.seconds && x.price === c.price))));
ok('HTML có 4 thẻ traffic, mỗi thẻ 1 nút "Mua ngay" trỏ tới khối bắt đầu chạy',
  (pricing.match(/class="tp" data-kind="/g) || []).length === 4
  && TRAFFIC_PRICES.every(t => pricing.includes(`data-buy="${t.kind}"`))
  && (pricing.match(/href="#bat-dau"/g) || []).length >= 4);
ok('HTML có tên + mô tả của mọi loại traffic',
  TRAFFIC_PRICES.every(t => pricingText.includes(t.name) && pricingText.includes(t.tagline)));
ok('HTML nêu ngày hiệu lực của bảng giá', pricing.includes(`từ ngày <b id="tpFrom">${PRICE_EFFECTIVE_FROM}</b>`));
ok('mọi mốc thời gian ở lại đều hiện trên HTML', DWELL_TIERS.every(s => pricing.includes(`${s} giây`)));
ok('JSON-LD liệt kê giá rẻ nhất của từng loại traffic',
  TRAFFIC_PRICES.every(t => pricing.includes(`"price": "${t.tiers[0].price}"`)));

console.log('\n== mô hình gói tự cài / license đã được gỡ sạch ==');
ok('đã xoá plans.mjs', !fs.existsSync(path.join(ROOT, 'plans.mjs')));
ok('pricing.mjs không còn khái niệm gói (chỉ giữ bảng giá theo lượt)',
  !/export const PLANS\b|planForSlots|planById|normalizePlanRequest|planCatalog/.test(read('pricing.mjs')));
ok('api.mjs không còn route/khái niệm gói',
  !/\/api\/(plans|my-plan|plan-request)|handlePlans|max_slots|maxSlots|plans\.mjs/.test(read('api.mjs')));
ok('server.mjs không còn /api/plans và REGISTER_MAX_SLOTS',
  !read('server.mjs').includes("'/api/plans'") && !/REGISTER_MAX_SLOTS/.test(read('server.mjs')));
ok('trang /my không còn thẻ "Gói & hạn mức"', !/Gói &amp; hạn mức|my-plan|btnAskPlan/.test(read('public/my.html')));
ok('trang /admin không còn nút cấp "chạy song song"', !/data-grant|uSlots|maxSlots/.test(read('public/admin.html')));
ok('bảng giá công khai không còn license/gói/so sánh gói',
  !/license|#goi|data-plan|cmp-tbl|So sánh chi tiết 4 gói/i.test(pricing));

console.log(`\nKết quả: ${pass} PASS, ${fail} FAIL`);
process.exit(fail ? 1 : 0);
