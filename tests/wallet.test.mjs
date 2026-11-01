import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'omni-wallet-'));
process.env.OMNI_DATA_DIR = dir;

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name} ${extra}`); }
};

const {
  TXN_KINDS, PAY_METHODS, USDT_NETWORKS, DEFAULT_USDT_RATE, MAX_TXN_VND,
  WALLET_SETTING_KEYS, TXN_KIND_LABELS, normalizeWalletSettings, usdtRate,
  vndFromUsdt, usdtFromVnd, visitCost, chargeableRun, txnCode, normalizeTopup,
} = await import('../wallet.mjs');
const { CAMPAIGN_TYPES } = await import('../campaign-types.mjs');
const { db } = await import('../database/init.mjs');
const { users, campaigns, wallet } = await import('../database/repo.mjs');

console.log('\n== wallet.mjs: logic thuần ==');
ok('danh mục loại giao dịch + phương thức + mạng USDT đúng',
  TXN_KINDS.join(',') === 'topup,spend,adjust,bonus'
  && PAY_METHODS.join(',') === 'usdt,bank,manual'
  && USDT_NETWORKS.includes('TRC20') && USDT_NETWORKS.includes('ERC20'));
ok('mỗi loại giao dịch đều có nhãn tiếng Việt', TXN_KINDS.every(k => !!TXN_KIND_LABELS[k]));
ok('bảy khoá cấu hình ví nhận tiền đều nằm trong bảng settings',
  Object.values(WALLET_SETTING_KEYS).every(k => k.startsWith('wallet.')) && Object.keys(WALLET_SETTING_KEYS).length === 7);

ok('đơn giá theo loại chiến dịch khớp bảng giá',
  visitCost('search_click') === 700 && visitCost('direct_visit') === 1000
  && visitCost('search_dwell') === 1500 && visitCost('deep_browse') === 6000 && visitCost('search_only') === 300);
ok('mọi loại chiến dịch đều có đơn giá > 0', CAMPAIGN_TYPES.every(t => visitCost(t.id) > 0));
ok('loại lạ -> đơn giá 0 (engine coi như miễn phí)', visitCost('khong-co') === 0);

ok('lượt vào được trang đích -> tính tiền', chargeableRun({ status: 'ok', result: { landed: { url: 'x' } } }) === true);
ok('lượt "chỉ lấy hiển thị" -> không tính tiền',
  chargeableRun({ status: 'ok', result: { impression: true, landed: { url: 'x' } } }) === false);
ok('lượt không vào site (chỉ tìm Google) -> không tính tiền',
  chargeableRun({ status: 'ok', result: { matched: { page: 1, position: 2 } } }) === false);
ok('lượt lỗi / không thấy URL / captcha -> không tính tiền',
  ['error', 'notfound', 'captcha', 'limit', 'quota'].every(s => chargeableRun({ status: s, result: { landed: { url: 'x' } } }) === false)
  && chargeableRun(null) === false && chargeableRun({}) === false);

ok('tỷ giá lạ/thiếu -> về tỷ giá mặc định', usdtRate({}) === DEFAULT_USDT_RATE && usdtRate({ usdtRate: 0 }) === DEFAULT_USDT_RATE
  && usdtRate({ usdtRate: 26000 }) === 26000);
ok('quy đổi USDT -> VND', vndFromUsdt(10, 26000) === 260000 && vndFromUsdt(1.5, 20000) === 30000 && vndFromUsdt(0) === 0);
ok('quy đổi VND -> USDT (làm tròn 2 chữ số)', usdtFromVnd(260000, 26000) === 10 && usdtFromVnd(65000, 26000) === 2.5);

console.log('\n== wallet.mjs: chuẩn hoá ví nhận tiền của admin ==');
const blank = normalizeWalletSettings();
ok('chưa cấu hình -> tỷ giá mặc định + mạng TRC20', blank.usdtRate === DEFAULT_USDT_RATE && blank.usdtNetwork === 'TRC20'
  && blank.usdtAddress === '' && blank.bankName === '');
const filled = normalizeWalletSettings({
  bankName: '  Vietcombank ', accountNo: ' 0123456789 ', accountName: 'NGUYEN VAN A',
  usdtAddress: 'TXabc123', usdtNetwork: 'trc20', usdtRate: '26850', note: ' ghi chú ',
});
ok('cắt khoảng trắng + viết hoa mạng + đọc tỷ giá',
  filled.bankName === 'Vietcombank' && filled.accountNo === '0123456789' && filled.usdtNetwork === 'TRC20'
  && filled.usdtRate === 26850 && filled.note === 'ghi chú');
ok('mạng USDT lạ -> về TRC20', normalizeWalletSettings({ usdtNetwork: 'XYZ' }).usdtNetwork === 'TRC20');
ok('gửi lên một phần thì giữ nguyên các ô còn lại', normalizeWalletSettings({ bankName: 'B' }, filled).accountNo === '0123456789');
ok('tỷ giá lạ bị kẹp về khoảng cho phép', normalizeWalletSettings({ usdtRate: 999999999 }).usdtRate === 10000000);

console.log('\n== wallet.mjs: phiếu nạp tiền ==');
const t1 = normalizeTopup({ usdt: 10, rate: 26000, note: 'ck lan 1' });
ok('nạp theo USDT -> quy đổi VND + giữ tỷ giá và số USDT',
  t1.amountVnd === 260000 && t1.usdt === 10 && t1.rate === 26000 && t1.method === 'usdt' && t1.note === 'ck lan 1');
ok('không ghi tỷ giá -> dùng tỷ giá đang lưu', normalizeTopup({ usdt: 2 }, { usdtRate: 20000 }).amountVnd === 40000);
const t2 = normalizeTopup({ amountVnd: 500000 });
ok('nạp thẳng VND -> không ghi số USDT, phương thức manual',
  t2.amountVnd === 500000 && t2.usdt === null && t2.rate === null && t2.method === 'manual');
ok('phương thức lạ -> tự suy ra từ dữ liệu nhập', normalizeTopup({ amountVnd: 1000, method: 'xyz' }).method === 'manual'
  && normalizeTopup({ usdt: 1, rate: 1000, method: 'xyz' }).method === 'usdt');
let threw = '';
try { normalizeTopup({ amountVnd: 0 }); } catch (e) { threw = e.message; }
ok('số tiền 0 -> báo lỗi', /lớn hơn 0/.test(threw));
threw = '';
try { normalizeTopup({ usdt: MAX_TXN_VND }); } catch (e) { threw = e.message; }
ok('số tiền vượt trần -> báo lỗi', /quá lớn/.test(threw));

ok('mã giao dịch đúng định dạng TS + 6 chữ số', txnCode(12) === 'TS000012' && txnCode(999999) === 'TS999999');

console.log('\n== repo (CSDL tạm): số dư, sổ giao dịch, không cho âm ==');
const uid = Number(users.create({ username: 'bob', passwordHash: 'x' }).lastInsertRowid);
ok('tài khoản mới -> số dư 0', wallet.balanceOf(uid) === 0);
ok('chưa nạp gì -> summary rỗng',
  JSON.stringify(wallet.summary(uid)) === JSON.stringify({ balance: 0, toppedUp: 0, bonus: 0, spent: 0, total: 0 }));

const cid = Number(campaigns.create({ userId: uid, keyword: 'mua laptop', targetUrl: 'https://shop.vn/laptop', type: 'search_dwell', count: 20, unit: 'day' }).lastInsertRowid);
const credit = wallet.credit({ userId: uid, amountVnd: 1000000, usdt: 40, rate: 25000, method: 'usdt', note: 'nạp lần 1' });
ok('nạp tiền -> số dư tăng + trả về mã giao dịch + số dư sau giao dịch',
  credit.balanceAfter === 1000000 && wallet.balanceOf(uid) === 1000000 && credit.code === txnCode(credit.id) && credit.usdt === 40);
ok('nạp tiền sai số tiền -> báo lỗi',
  (() => { try { wallet.credit({ userId: uid, amountVnd: -5 }); return false; } catch { return true; } })());

const spend = wallet.spend({ userId: uid, amountVnd: 1500, campaignId: cid, note: 'mua laptop' });
ok('trừ tiền chạy lượt -> số dư giảm + gắn đúng chiến dịch',
  !!spend && spend.amount === -1500 && spend.campaignId === cid && wallet.balanceOf(uid) === 998500);
ok('trừ quá số dư -> bị từ chối, số dư không đổi',
  wallet.spend({ userId: uid, amountVnd: 999999999 }) === null && wallet.balanceOf(uid) === 998500);
ok('trừ đúng bằng số dư -> về 0',
  wallet.spend({ userId: uid, amountVnd: 998500, campaignId: cid }) !== null && wallet.balanceOf(uid) === 0);

wallet.credit({ userId: uid, amountVnd: 300000, kind: 'bonus', method: 'manual', note: 'khuyến mại' });
wallet.credit({ userId: uid, amountVnd: 200000, method: 'manual', note: 'nạp lần 2' });
let adjThrew = false;
try { wallet.adjust({ userId: uid, amountVnd: 0 }); } catch { adjThrew = true; }
ok('điều chỉnh 0 đồng -> báo lỗi', adjThrew);
ok('điều chỉnh trừ vượt số dư -> null', wallet.adjust({ userId: uid, amountVnd: -999999 }) === null);
ok('điều chỉnh giảm hợp lệ', wallet.adjust({ userId: uid, amountVnd: -50000 }).balanceAfter === 450000);

const sum = wallet.summary(uid);
ok('summary tách đúng đã nạp / khuyến mại / đã chạy / còn lại',
  sum.toppedUp === 1200000 && sum.bonus === 300000 && sum.spent === 1000000 && sum.balance === 450000 && sum.total === 1500000,
  JSON.stringify(sum));
ok('đã chạy của một chiến dịch', wallet.spentByCampaign(uid).some(c => c.id === cid && c.spent === 1000000 && c.keyword === 'mua laptop'));
ok('tổng đã chạy của tài khoản', wallet.spentByUser(uid) === 1000000);

const txns = wallet.txns({ userId: uid });
ok('sổ giao dịch mới nhất trước + kèm chủ tài khoản và tên chiến dịch',
  txns.length === 6 && txns[0].kind === 'adjust' && txns.find(t => t.campaign_id === cid)?.campaign_keyword === 'mua laptop');
ok('lọc sổ theo loại giao dịch', wallet.txns({ userId: uid, kind: 'topup' }).length === 2
  && wallet.txns({ userId: uid, kind: 'topup' }).every(t => t.kind === 'topup'));
ok('lọc sổ theo chiến dịch', wallet.txns({ campaignId: cid }).length === 2);

users.remove(uid);
ok('xoá tài khoản -> ví và sổ giao dịch dọn sạch',
  wallet.balanceOf(uid) === 0 && wallet.txns({ userId: uid }).length === 0
  && db.prepare('SELECT COUNT(*) AS n FROM wallets WHERE user_id = ?').get(uid).n === 0);

db.close();
rmSync(dir, { recursive: true, force: true });
console.log(`\nKết quả: ${pass} PASS, ${fail} FAIL`);
process.exit(fail ? 1 : 0);
