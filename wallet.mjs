import { visitPrice } from './pricing.mjs';

export const TXN_KINDS = ['topup', 'spend', 'adjust', 'bonus'];
export const PAY_METHODS = ['usdt', 'bank', 'manual'];
export const USDT_NETWORKS = ['TRC20', 'ERC20', 'BEP20', 'other'];
export const DEFAULT_USDT_RATE = 26000;
export const MAX_TXN_VND = 100000000000;

export const WALLET_SETTING_KEYS = {
  bankName: 'wallet.bankName',
  accountNo: 'wallet.accountNo',
  accountName: 'wallet.accountName',
  usdtAddress: 'wallet.usdtAddress',
  usdtNetwork: 'wallet.usdtNetwork',
  usdtRate: 'wallet.usdtRate',
  note: 'wallet.note',
};

export const TXN_KIND_LABELS = {
  topup: 'Nạp tiền',
  spend: 'Chạy chiến dịch',
  adjust: 'Điều chỉnh',
  bonus: 'Khuyến mại',
};

const str = (v, max = 0) => {
  const s = String(v ?? '').trim();
  return max > 0 ? s.slice(0, max) : s;
};

export function normalizeWalletSettings(input = {}, current = {}) {
  const pick = (key, max) => (input[key] === undefined ? str(current[key], max) : str(input[key], max));
  const rawRate = input.usdtRate === undefined || input.usdtRate === '' ? current.usdtRate : input.usdtRate;
  const rate = Number(rawRate);
  const net = str(input.usdtNetwork ?? current.usdtNetwork, 10).toUpperCase();
  return {
    bankName: pick('bankName', 120),
    accountNo: pick('accountNo', 60),
    accountName: pick('accountName', 120),
    usdtAddress: pick('usdtAddress', 200),
    usdtNetwork: USDT_NETWORKS.includes(net) ? net : 'TRC20',
    usdtRate: Number.isFinite(rate) && rate > 0 ? Math.min(Math.round(rate), 10000000) : DEFAULT_USDT_RATE,
    note: pick('note', 300),
  };
}

export function usdtRate(settings = {}) {
  const n = Number(settings.usdtRate);
  return Number.isFinite(n) && n > 0 ? Math.min(Math.round(n), 10000000) : DEFAULT_USDT_RATE;
}

export function vndFromUsdt(usdt, rate = DEFAULT_USDT_RATE) {
  const n = Math.max(0, Number(usdt) || 0);
  return Math.round(n * usdtRate({ usdtRate: rate }));
}

export function usdtFromVnd(vnd, rate = DEFAULT_USDT_RATE) {
  const r = usdtRate({ usdtRate: rate });
  return Math.round((Math.max(0, Number(vnd) || 0) / r) * 100) / 100;
}

export function visitCost(type) {
  return visitPrice(type);
}

export function chargeableRun(res) {
  return !!res && res.status === 'ok' && !!res.result?.landed && !res.result?.impression;
}

export function txnCode(id) {
  return `TS${String(Math.max(0, Math.round(Number(id) || 0))).padStart(6, '0')}`;
}

export function normalizeTopup(input = {}, current = {}) {
  const rate = usdtRate({ usdtRate: input.rate === undefined || input.rate === '' ? current.usdtRate : input.rate });
  const raw = Number(input.usdt);
  const hasUsdt = Number.isFinite(raw) && raw > 0;
  const amountVnd = hasUsdt ? vndFromUsdt(raw, rate) : Math.round(Number(input.amountVnd) || 0);
  if (!(amountVnd > 0)) throw new Error('Số tiền nạp phải lớn hơn 0.');
  if (amountVnd > MAX_TXN_VND) throw new Error('Số tiền một giao dịch quá lớn — kiểm tra lại số USDT/tỷ giá.');
  const method = PAY_METHODS.includes(str(input.method)) ? str(input.method) : (hasUsdt ? 'usdt' : 'manual');
  return {
    amountVnd,
    usdt: hasUsdt ? Math.round(raw * 100) / 100 : null,
    rate: hasUsdt ? rate : null,
    method,
    note: str(input.note, 300) || null,
  };
}
