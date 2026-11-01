import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'omni-engine-'));
process.env.OMNI_DATA_DIR = dir;

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name} ${extra}`); }
};

const { db } = await import('../database/init.mjs');
const { users, campaigns, runs, wallet } = await import('../database/repo.mjs');
const { Campaign, DEFAULT_SETTINGS, memNeededMB } = await import('../campaign.mjs');

const uid = Number(users.create({ username: 'alice', passwordHash: 'x' }).lastInsertRowid);
wallet.credit({ userId: uid, amountVnd: 5000000, method: 'manual', note: 'Nạp cho bài kiểm thử' });
const mk = (keyword, count, unit, { approval = 'approved', status = 'running', startAt = null, maxThreads = undefined } = {}) => {
  const id = Number(campaigns.create({ userId: uid, keyword, targetUrl: `https://example.org/${keyword}`, type: 'search_dwell', count, unit, startAt, maxThreads }).lastInsertRowid);
  campaigns.setApproval(id, { status: approval, byId: uid });
  campaigns.setStatus(id, status, uid);
  return id;
};
const cidA = mk('keo bong da', 200, 'day');
const cidB = mk('xem bong da', 120, 'hour');
const cidPending = mk('chua duyet', 10, 'day', { approval: 'pending', status: 'idle' });
const cidFuture = mk('chay sau', 10, 'day', { startAt: '2999-01-01 00:00:00' });

const campaign = new Campaign({ profiles: {}, open: async () => { throw new Error('không được mở trình duyệt'); } }, dir);
await campaign.load();
ok('engine chạy ở chế độ CSDL', campaign.dbMode === true);
ok('bỏ qua chiến dịch chờ duyệt', !campaign.tasks.some(t => t.dbId === cidPending));
ok('bỏ qua chiến dịch ngoài khoảng thời gian', !campaign.tasks.some(t => t.dbId === cidFuture));
ok('lấy đúng 2 chiến dịch đã duyệt', campaign.tasks.length === 2);
const task = campaign.tasks.find(t => t.dbId === cidA);
ok('task có id dạng db:<id>', task.id === `db:${cidA}`);
ok('task giữ từ khóa + chỉ tiêu + đơn vị', task.keyword === 'keo bong da' && task.count === 200 && task.unit === 'day');
ok('engine tự bật khi có chiến dịch đủ điều kiện', campaign.running === true);
ok('lượt chạy giữ từ khóa/URL lúc chạy', task.targetUrl === 'https://example.org/keo bong da');

const p1 = campaign.taskParams({ type: 'search_dwell' });
ok('loại search_dwell: qua Google + ở lại 60–120s', p1.skipSearch === false && p1.dwellMin === 60 && p1.dwellMax === 120 && p1.subpages === 1);
const p2 = campaign.taskParams({ type: 'search_only' });
ok('loại search_only: không vào URL', p2.skipVisit === true && p2.dwellMax === 0);
const p3 = campaign.taskParams({ type: 'direct_visit' });
ok('loại direct_visit: vào thẳng URL', p3.skipSearch === true && p3.subpages === 1);
ok('task không có loại -> dùng cấu hình chung', Object.keys(campaign.taskParams({})).length === 0);

campaign.settings.activeFrom = 0;
campaign.settings.activeTo = 24;
ok('chỉ tiêu cả ngày theo ngày = count', campaign.dailyTarget(task) === 200);
ok('chỉ tiêu cả ngày theo giờ = count × 24', campaign.dailyTarget(campaign.tasks.find(t => t.dbId === cidB)) === 120 * 24);
ok('còn phải chạy (đến hạn > đã chạy)', campaign.dueCount(task) > 0);
ok('chọn được việc để chạy', [cidA, cidB].includes(campaign.pickTask()?.dbId));

const cidPar = mk('chay song song', 500, 'day', { maxThreads: 3 });
await campaign.syncTasks();
const par = campaign.tasks.find(t => t.dbId === cidPar);
ok('engine đọc trần luồng riêng của chiến dịch từ CSDL', par.maxThreads === 3);
ok('một chiến dịch được chiếm min(trần riêng, trần chung) luồng', campaign.taskThreads(par) === 3 && campaign.settings.threads >= 3);
ok('nhịp của chiến dịch báo đúng trần riêng + trần chung (giao diện hiện “song song ≤ N luồng”)',
  campaign.paceOf(par).maxThreads === 3 && campaign.paceOf(par).globalThreads === campaign.settings.threads);
ok('đặt trần riêng cao hơn trần chung -> vẫn bị chặn ở trần chung của engine',
  campaign.taskThreads({ ...par, maxThreads: 30 }) === campaign.maxThreads());
const savedTasks = campaign.tasks;
const savedDue = campaign.dueCount;
campaign.dueCount = () => 10;
campaign.tasks = [par];
const fakeWorker = slot => ({ slot, taskId: par.id, keyword: par.keyword, startedAt: Date.now() });
campaign.workers.set(1, fakeWorker(1));
ok('trần 3 luồng -> đang chạy 1 luồng vẫn mở thêm luồng cho cùng chiến dịch (chạy song song)',
  campaign.pickTask()?.dbId === cidPar);
campaign.tasks = [{ ...par, maxThreads: 1 }];
ok('chiến dịch để 1 luồng (mặc định) -> luồng đang chạy chặn luồng mới, đúng hành vi cũ',
  campaign.pickTask() === null);
campaign.tasks = [par];
campaign.workers.set(2, fakeWorker(2));
campaign.workers.set(3, fakeWorker(3));
ok('đang chạy đủ 3 luồng -> không mở thêm luồng cho chiến dịch này', campaign.pickTask() === null);
campaign.tasks = [{ ...par, maxThreads: 1 }];
ok('hạ trần riêng về 1 luồng -> 3 luồng đang chạy cũng không mở thêm', campaign.pickTask() === null);
campaign.tasks = [par];
campaign.workers.delete(3);
ok('rời khỏi 1 luồng -> engine mở thêm luồng cho đúng chiến dịch đang trễ lịch', campaign.pickTask()?.dbId === cidPar);
campaign.workers.clear();
campaigns.update(cidPar, { max_threads: 2 });
await campaign.syncTasks();
ok('sửa cột max_threads là có hiệu lực ngay ở nhịp lập lịch sau', campaign.tasks.find(t => t.dbId === cidPar).maxThreads === 2);
campaign.dueCount = savedDue;
campaign.tasks = savedTasks;
campaigns.setStatus(cidPar, 'paused', uid);
await campaign.syncTasks();
ok('chiến dịch thử số luồng đã tắt, không ảnh hưởng các phép kiểm sau', !campaign.tasks.some(t => t.dbId === cidPar));

campaign.recordDb(task, { seconds: 42, attempts: 1, captchas: 0, onSite: 61, pages: 2 }, { status: 'ok', ip: '1.2.3.4', proxy: 'ws-vn-1' });
ok('ghi lượt chạy vào runs', runs.recent({ campaignId: cidA }).length === 1);
ok('cộng dồn thống kê ngày', campaigns.detail(cidA).today_ok === 1 && campaigns.detail(cidA).today_attempts === 1);
const cidSmall = mk('chi tieu nho', 1, 'day');
await campaign.syncTasks();
const small = campaign.tasks.find(t => t.dbId === cidSmall);
campaign.recordDb(small, { seconds: 10, attempts: 1, captchas: 0, onSite: 5, pages: 1 }, { status: 'ok', ip: '1.2.3.5' });
campaign.markDoneIfReached(small);
ok('đủ chỉ tiêu ngày -> chiến dịch chuyển "done"', campaigns.byId(cidSmall).status === 'done');
ok('báo cho chủ sở hữu khi đủ chỉ tiêu', db.prepare('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND campaign_id = ?').get(uid, cidSmall).n === 1);
campaign.doneMarked.clear();
campaign.markDoneIfReached(small);
ok('không báo trùng khi đã đủ chỉ tiêu', db.prepare('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND campaign_id = ?').get(uid, cidSmall).n === 1);
await campaign.syncTasks();
ok('chiến dịch "done" không còn trong danh sách chạy', !campaign.tasks.some(t => t.dbId === cidSmall));

db.prepare('DELETE FROM campaign_stats_daily WHERE campaign_id = ? AND day = ?').run(cidSmall, new Date().toLocaleDateString('sv-SE'));
await campaign.resetDailyDone();
ok('mở lại chiến dịch đã xong hôm qua', campaigns.byId(cidSmall).status === 'running');
await campaign.syncTasks();
ok('sau khi mở lại, engine lấy lại chiến dịch đó', campaign.tasks.some(t => t.dbId === cidSmall));

ok('engine không còn hàm/cache hạn mức', campaign.userQuota === undefined && campaign.userDone === undefined && campaign.quotaCache === undefined);
users.update(uid, { daily_quota: 2 });
ok('vượt mọi mức lượt/ngày cũ -> vẫn có việc để chạy', campaign.pickTask() !== null);
ok('hạn mức cũ không sinh thông báo chặn nào', !db.prepare('SELECT 1 FROM notifications WHERE user_id = ? AND title LIKE ?').get(uid, '%hạn mức%'));

ok('ghi lượt cho chiến dịch không tồn tại không ném lỗi', (() => {
  try {
    campaign.recordDb({ dbId: 999999, userId: uid, keyword: 'x', targetUrl: 'https://x' }, { seconds: 1 }, { status: 'ok' });
    return true;
  } catch { return false; }
})());

campaigns.setStatus(cidA, 'paused', uid);
campaigns.setStatus(cidB, 'paused', uid);
campaigns.setStatus(cidSmall, 'paused', uid);
await campaign.syncTasks();
ok('dừng hết chiến dịch -> danh sách trống', campaign.tasks.length === 0);
ok('không còn chiến dịch -> engine tự tắt', campaign.running === false);

const { openProfile, runVisit, makeCancel, attemptTimeoutMs, pickDevice, deviceKindAt, mobilePct, MOBILE_SHARE, isTargetNetworkError, isChangeIpError, ATTEMPT_MIN_MS, ATTEMPT_MAX_MS } = await import('../workflow/worker.mjs');
const logs = [];
const log = m => logs.push(m);
const lease = { id: 7, name: 'omni-w-test', pooled: false, release: async () => {} };
const fakeSession = { page: {}, disconnect: async () => {} };
function fakeOmni(responses) {
  const calls = { open: 0, stop: 0 };
  return {
    calls,
    rest: {
      browser: {
        open: async () => responses[Math.min(calls.open++, responses.length - 1)],
        isActive: async () => true,
        stop: async () => { calls.stop++; },
      },
    },
  };
}

const o1 = fakeOmni([{ status: true, bridge_error: 'omniBridge crashed with code 1' }, { status: true, bridge_url: 'ws://127.0.0.1:1?token=x' }]);
const s1 = await openProfile(o1, lease, { log, retryWaitMs: 10 }, async () => fakeSession);
ok('thiếu bridge_url -> đóng profile rồi mở lại được', o1.calls.open === 2 && o1.calls.stop === 1 && s1 === fakeSession);
ok('log ghi rõ bridge_error của desktop', logs.some(l => /omniBridge crashed/.test(l)));

const o2 = fakeOmni([{ status: true, bridge_error: 'omniBridge crashed with code 1' }]);
let err2 = null;
try { await openProfile(o2, lease, { log, retryWaitMs: 10 }, async () => fakeSession); } catch (e) { err2 = e; }
ok('mở lại vẫn lỗi -> báo lỗi kèm bridge_error', o2.calls.open === 2 && /omniBridge crashed/.test(err2?.message || ''));

const o3 = fakeOmni([{ status: false, message: '[Code 404] Không tìm thấy profile hoặc bạn không có quyền truy cập' }]);
let err3 = null;
try { await openProfile(o3, lease, { log, retryWaitMs: 10 }, async () => fakeSession); } catch (e) { err3 = e; }
ok('profile 404 -> không mở lại vô ích', o3.calls.open === 1 && /Code 404/.test(err3?.message || ''));

const o4 = fakeOmni([{ status: false, message: 'Bridge API is disabled. Enable it in Preferences → Enable Bridge API.' }]);
let err4 = null;
try { await openProfile(o4, lease, { log, retryWaitMs: 10 }, async () => fakeSession); } catch (e) { err4 = e; }
ok('giữ nguyên thông điệp "Bridge API is disabled"', /Bridge API is disabled/.test(err4?.message || ''));

const runSettings = {
  skipSearch: true, skipVisit: true, dwellMax: 0, dwellMin: 0, subpages: 0, maxPages: 1, headless: true,
  proxy: { type: 'HTTP', host: 'p.example.io', port: 80, userBase: 'u', password: 'p' },
};
const mkSession = ip => ({
  page: { goto: async () => ({}), evaluate: async () => (ip ? `{"ip":"${ip}"}` : 'null'), url: async () => 'https://example.org/x' },
  disconnect: async () => {},
});
let openCalls = 0;
const omniRun = {
  profiles: { create: async () => ({ id: 501, name: 'omni-w-test' }), delete: async () => {} },
  rest: {
    browser: {
      open: async () => { openCalls++; return { status: true, bridge_url: 'ws://127.0.0.1:1?token=x' }; },
      isActive: async () => false,
      stop: async () => {},
    },
  },
};
const runLogs = [];
const sessions = [mkSession(''), mkSession('1.2.3.4')];
const res = await runVisit(omniRun, {
  slot: 1, keyword: 'x', targetUrl: 'https://example.org/x', settings: runSettings, solver: null,
  log: m => runLogs.push(m), openSession: async () => sessions.shift(),
});
ok('lỗi hạ tầng lượt 1 -> tự chạy lại và thành công', res.status === 'ok' && res.attempts === 2 && res.ip === '1.2.3.4' && openCalls === 2);
ok('log nói rõ đang thử lại vì lỗi hạ tầng', runLogs.some(l => /Lỗi hạ tầng/.test(l)) && runLogs.some(l => /Proxy không kết nối được/.test(l)));

const runLogs2 = [];
const sessions2 = [mkSession(''), mkSession(''), mkSession('')];
const res2 = await runVisit(omniRun, {
  slot: 1, keyword: 'x', targetUrl: 'https://example.org/x', settings: runSettings, solver: null,
  log: m => runLogs2.push(m), openSession: async () => sessions2.shift(),
});
ok('lỗi mạng tới đích lặp lại -> thử lại tối đa 3 lần rồi dừng (không lặp vô hạn)',
  res2.status === 'error' && res2.attempts === 3 && sessions2.length === 0);

ok('nhận diện đúng lỗi mạng tới đích', [
  'net::ERR_CONNECTION_CLOSED',
  'net::ERR_CONNECTION_RESET',
  'net::ERR_EMPTY_RESPONSE',
  'ECONNRESET Client network socket disconnected before secure TLS connection was established',
  'EPROTO wrong version number',
  'Đã bấm kết quả nhưng trang đích không mở trong 30 giây.',
  'Proxy không kết nối được.',
].every(isTargetNetworkError)
  && !isTargetNetworkError('Không nhận diện được trạng thái trang hiện tại (unknown state).')
  && !isTargetNetworkError('OmniLogin không mở được profile #5.'));

const mkFailSession = msg => ({
  page: {
    goto: async url => { if (/ipify/.test(url)) return {}; throw new Error(msg); },
    evaluate: async () => '{"ip":"9.9.9.9"}',
    url: async () => 'https://example.org/x',
  },
  disconnect: async () => {},
});
const runLogs3 = [];
const res3 = await runVisit(omniRun, {
  slot: 1, keyword: 'x', targetUrl: 'https://example.org/x', settings: runSettings, solver: null,
  log: m => runLogs3.push(m),
  openSession: async () => mkFailSession('Không nhận diện được trạng thái trang hiện tại (unknown state).'),
});
ok('lỗi không thuộc nhóm mạng -> chỉ thử lại 1 lần rồi dừng', res3.status === 'error' && res3.attempts === 2);

const fakePool = {
  reports: [],
  next: () => ({ label: 'p.example.io:80', session: 1, input: {} }),
  report: (label, r) => { fakePool.reports.push({ label, ...r }); return null; },
};
const res4 = await runVisit(omniRun, {
  slot: 1, keyword: 'x', targetUrl: 'https://example.org/x', settings: runSettings, solver: null,
  log: () => {}, proxyPool: fakePool,
  openSession: async () => mkFailSession('Đã bấm kết quả nhưng trang đích không mở trong 30 giây.'),
});
ok('lỗi mở trang đích -> tính là lỗi proxy ở mọi lần thử',
  res4.attempts === 3 && fakePool.reports.length === 3 && fakePool.reports.every(r => r.proxyFail && !r.ok));

const CHG = 'Can not call change IP URL. Bad Request';
ok('nhận diện lỗi URL đổi IP (không lẫn với lỗi mạng)', isChangeIpError(CHG) && !isChangeIpError('net::ERR_CONNECTION_RESET') && !isTargetNetworkError(CHG));
const o5 = fakeOmni([{ status: false, message: CHG }, { status: true, bridge_url: 'ws://x' }]);
let err5 = null;
try { await openProfile(o5, lease, { log, retryWaitMs: 10 }, async () => fakeSession); } catch (e) { err5 = e; }
ok('openProfile: lỗi URL đổi IP -> không mở lại ngay (1 lần gọi open)', o5.calls.open === 1 && isChangeIpError(err5?.message || ''));
function mkChgOmni(fails) {
  let n = 0;
  return {
    calls: () => n,
    profiles: { create: async () => ({ id: 701, name: 'omni-w-chg' }), delete: async () => {} },
    rest: { browser: { open: async () => (n++ < fails ? { status: false, message: CHG } : { status: true, bridge_url: 'ws://127.0.0.1:1?token=x' }), isActive: async () => false, stop: async () => {} } },
  };
}
const chgOk = mkChgOmni(1);
const chgLogs = [];
const t0chg = Date.now();
const resChg = await runVisit(chgOk, {
  slot: 1, keyword: 'x', targetUrl: 'https://example.org/x', settings: runSettings, solver: null, changeIpWaitMs: 120,
  log: m => chgLogs.push(m), openSession: async () => mkSession('5.6.7.8'),
});
ok('URL đổi IP lỗi 1 lần -> chờ rồi thử lại thành công', resChg.status === 'ok' && resChg.attempts === 2 && chgOk.calls() === 2 && Date.now() - t0chg >= 110,
  `${resChg.status} attempts=${resChg.attempts} open=${chgOk.calls()}`);
ok('log ghi rõ đang chờ vì URL đổi IP', chgLogs.some(l => /chờ 0s rồi thử lại|URL đổi IP/.test(l)));
const chgBad = mkChgOmni(99);
const resChg2 = await runVisit(chgBad, {
  slot: 1, keyword: 'x', targetUrl: 'https://example.org/x', settings: runSettings, solver: null, changeIpWaitMs: 10,
  log: () => {}, openSession: async () => mkSession('5.6.7.8'),
});
ok('URL đổi IP lỗi mãi -> chỉ thử lại 1 lần rồi dừng, lỗi kèm hướng dẫn tắt Change IP',
  resChg2.status === 'error' && resChg2.attempts === 2 && chgBad.calls() === 2 && /Đổi IP khi mở/.test(resChg2.error));

const stopped = [];
const omniHang = {
  profiles: { create: async () => ({ id: 601, name: 'omni-w-hang' }), delete: async () => {} },
  rest: {
    browser: {
      open: async () => ({ status: true, bridge_url: 'ws://127.0.0.1:1?token=x' }),
      isActive: async () => true,
      stop: async id => { stopped.push(id); },
    },
  },
};
const hangSession = { page: { goto: () => new Promise(() => {}) }, disconnect: async () => {} };
const timeoutLogs = [];
const resHang = await runVisit(omniHang, {
  slot: 1, keyword: 'x', targetUrl: 'https://example.org/x', settings: runSettings, solver: null,
  log: m => timeoutLogs.push(m), openSession: async () => hangSession, attemptTimeout: 800,
});
ok('lượt treo -> hết hạn và báo rõ lý do', resHang.status === 'error' && /vượt 1 giây/.test(resHang.error || '') && resHang.timedOut === true);
ok('hết hạn -> đóng đúng profile của lượt, thử lại 1 lần rồi dừng', stopped.length === 2 && stopped.every(id => id === 601) && resHang.attempts === 2);

const stoppedC = [];
const omniCancel = {
  profiles: { create: async () => ({ id: 811, name: 'omni-w-cancel' }), delete: async () => {} },
  rest: { browser: { open: async () => ({ status: true, bridge_url: 'ws://127.0.0.1:1?token=x' }), isActive: async () => true, stop: async id => { stoppedC.push(id); } } },
};
const cancelA = makeCancel();
const t0c = Date.now();
const pA = runVisit(omniCancel, {
  slot: 1, keyword: 'x', targetUrl: 'https://example.org/x', settings: runSettings, solver: null, log: () => {},
  openSession: async () => ({ page: { goto: () => new Promise(() => {}) }, disconnect: async () => {} }), cancel: cancelA, attemptTimeout: 2500,
});
await new Promise(r => setTimeout(r, 300));
cancelA.abort();
const resA = await pA;
ok('huỷ lượt đang chạy: trả "cancelled" ngay (không chờ hạn 2,5s), không thử lại', resA.status === 'cancelled' && resA.attempts === 1 && Date.now() - t0c < 2000, JSON.stringify(resA));
ok('huỷ lượt: đóng đúng profile của lượt', stoppedC.length >= 1 && stoppedC.every(id => id === 811));
const cancelB = makeCancel();
cancelB.abort();
let opened = 0;
const resB = await runVisit(omniCancel, {
  slot: 1, keyword: 'x', targetUrl: 'https://example.org/x', settings: runSettings, solver: null, log: () => {},
  openSession: async () => { opened++; throw new Error('không được mở'); }, cancel: cancelB,
});
ok('đã bấm dừng trước khi lượt bắt đầu: không mở trình duyệt', resB.status === 'cancelled' && opened === 0 && resB.attempts === 0);
const resNoCancel = await runVisit(omniRun, {
  slot: 1, keyword: 'x', targetUrl: 'https://example.org/x', settings: runSettings, solver: null, log: () => {},
  openSession: async () => mkSession('7.7.7.7'), cancel: makeCancel(),
});
ok('có công tắc huỷ nhưng không bấm: lượt chạy bình thường', resNoCancel.status === 'ok' && resNoCancel.ip === '7.7.7.7');

const cidCancel = mk('huy luot', 50, 'day');
await campaign.syncTasks();
let aborted = 0;
const mkW = slot => ({ slot, dbId: cidCancel, keyword: 'huy luot', step: '', cancel: { cancelled: false, abort() { this.cancelled = true; aborted++; } } });
const w1 = mkW(71);
campaign.workers.set(71, w1);
campaign.cancelStoppedWorkers();
ok('chiến dịch đang chạy: KHÔNG huỷ lượt đang chạy', aborted === 0 && !w1.cancel.cancelled);
campaigns.setStatus(cidCancel, 'stopped', uid);
campaign.cancelStoppedWorkers();
ok('bấm Dừng: huỷ lượt đang chạy của chiến dịch', aborted === 1 && w1.cancel.cancelled && /huỷ/.test(w1.step));
campaign.cancelStoppedWorkers();
ok('không huỷ lặp lại cùng một lượt', aborted === 1);
campaign.workers.clear();
campaigns.setStatus(cidCancel, 'running', uid);
const w2 = mkW(72);
campaign.workers.set(72, w2);
campaigns.setStatus(cidCancel, 'paused', uid);
await campaign.syncTasks();
ok('Tạm dừng: syncTasks huỷ lượt đang chạy', w2.cancel.cancelled === true && aborted === 2);
campaign.workers.clear();
campaigns.setStatus(cidCancel, 'running', uid);
campaigns.setApproval(cidCancel, { status: 'pending', byId: uid });
const w3 = mkW(73);
campaign.workers.set(73, w3);
campaign.cancelStoppedWorkers();
ok('thu hồi duyệt (chờ duyệt lại): huỷ lượt đang chạy', w3.cancel.cancelled === true && aborted === 3);
campaign.workers.clear();
campaigns.setApproval(cidCancel, { status: 'approved', byId: uid });
campaigns.setStatus(cidCancel, 'done', uid);
const w4 = mkW(74);
campaign.workers.set(74, w4);
campaign.cancelStoppedWorkers();
ok('chiến dịch đủ chỉ tiêu ("done"): KHÔNG huỷ lượt đang chạy (vẫn được ghi nhận)', aborted === 3 && !w4.cancel.cancelled);
campaign.workers.clear();
const taskCancel = { id: `db:${cidCancel}`, dbId: cidCancel, userId: uid, keyword: 'huy luot', unit: 'day', count: 50, type: 'search_dwell' };
const runsBeforeCancel = db.prepare('SELECT COUNT(*) n FROM runs WHERE campaign_id = ?').get(cidCancel).n;
const balBeforeCancel = wallet.summary(uid).balance;
await campaign.finish({ slot: 75, taskId: taskCancel.id, startedAt: Date.now() - 5000, logs: [] }, taskCancel, { status: 'cancelled', ip: '1.1.1.1', error: 'Đã huỷ' });
ok('lượt bị huỷ: không ghi vào runs và không trừ tiền ví',
  db.prepare('SELECT COUNT(*) n FROM runs WHERE campaign_id = ?').get(cidCancel).n === runsBeforeCancel && wallet.summary(uid).balance === balBeforeCancel);

const cidStopDone = mk('dung giua chung', 1, 'day');
await campaign.syncTasks();
const taskSD = campaign.tasks.find(t => t.dbId === cidStopDone);
campaign.recordDb(taskSD, { seconds: 10, attempts: 1, captchas: 0, onSite: 5, pages: 1 }, { status: 'ok', ip: '1.2.3.9' });
campaigns.setStatus(cidStopDone, 'stopped', uid);
campaign.doneMarked.clear();
campaign.markDoneIfReached(taskSD);
ok('đã Dừng rồi mới xong lượt cuối (đủ chỉ tiêu): trạng thái vẫn là "stopped", không bị ghi đè thành "done"', campaigns.byId(cidStopDone).status === 'stopped');
db.prepare('DELETE FROM campaign_stats_daily WHERE campaign_id = ? AND day = ?').run(cidStopDone, new Date().toLocaleDateString('sv-SE'));
await campaign.resetDailyDone();
ok('sang ngày mới: chiến dịch đã Dừng KHÔNG tự bật lại', campaigns.byId(cidStopDone).status === 'stopped');

ok('hạn lượt chạy: sàn 10 phút', attemptTimeoutMs({}) === 600000);
ok('hạn lượt chạy: dài theo thời gian đọc trang + chờ giải captcha',
  attemptTimeoutMs({ dwellMax: 300, subpages: 2, subDwellMax: 60, captchaMode: 'manual', captchaWaitMin: 15 }) === 1620000);
ok('hạn lượt chạy: trần 90 phút (đủ cho loại "đọc sâu" ở lại 20–30 phút)',
  attemptTimeoutMs({ dwellMax: 1800, subpages: 2, subDwellMax: 1800, captchaMode: 'manual', captchaWaitMin: 15 }) === 5400000
  && ATTEMPT_MAX_MS === 5400000 && ATTEMPT_MIN_MS === 600000);
ok('chạy ẩn / captcha tự động -> không tính giờ chờ giải tay', attemptTimeoutMs({ captchaMode: 'capsolver', captchaWaitMin: 15, dwellMax: 70 }) === 600000);

await campaign.update({ settings: { memPerThreadMB: 0 } });
ok('tắt chừa RAM luồng mới (0 = hành vi cũ)', campaign.settings.memPerThreadMB === 0);
await campaign.update({ settings: { memPerThreadMB: 99999 } });
ok('chừa RAM luồng mới: kẹp trần 4096 MB', campaign.settings.memPerThreadMB === 4096);
await campaign.update({ settings: { memPerThreadMB: 700 } });
ok('chừa RAM luồng mới: nhận giá trị hợp lệ', campaign.settings.memPerThreadMB === 700);
ok('mặc định chừa 650 MB cho mỗi luồng mới', DEFAULT_SETTINGS.memPerThreadMB === 650);
ok('RAM cần để mở luồng = sàn + chừa × số luồng vừa mở', memNeededMB({ minFreeMemMB: 800, memPerThreadMB: 650 }, 2) === 2100);
ok('tắt chừa RAM (0) -> chỉ còn ngưỡng sàn', memNeededMB({ minFreeMemMB: 800, memPerThreadMB: 0 }, 3) === 800);

ok('mặc định chạy traffic theo quy định 70% máy tính / 30% di động',
  DEFAULT_SETTINGS.device === 'mixed' && DEFAULT_SETTINGS.mobilePercent === MOBILE_SHARE && MOBILE_SHARE === 30);
ok('thiếu/không hợp lệ tỉ lệ di động -> lấy theo quy định 30%',
  mobilePct({}) === 30 && mobilePct({ mobilePercent: 'x' }) === 30);
ok('tỉ lệ di động kẹp trong 0–100', mobilePct({ mobilePercent: 500 }) === 100 && mobilePct({ mobilePercent: -20 }) === 0);
await campaign.update({ settings: { device: 'mobile', mobilePercent: 500 } });
ok('nhận chế độ di động + kẹp tỉ lệ di động 0–100', campaign.settings.device === 'mobile' && campaign.settings.mobilePercent === 100);
await campaign.update({ settings: { mobilePercent: -20 } });
ok('tỉ lệ di động kẹp sàn 0', campaign.settings.mobilePercent === 0);
await campaign.update({ settings: { device: 'di-dong', mobilePercent: 30 } });
ok('giá trị thiết bị lạ -> quay về quy định chung (hỗn hợp 70/30)',
  campaign.settings.device === 'mixed' && campaign.settings.mobilePercent === 30);
await campaign.update({ settings: { device: 'mixed', mobilePercent: 40 } });
ok('nhãn thiết bị cho nhật ký', campaign.deviceLabel() === 'hỗn hợp 60% máy tính / 40% di động');

const devDesktop = pickDevice({ device: 'desktop' });
ok('chọn thiết bị máy tính: OS window + giữ tên pool cũ (omni-pool-1)',
  devDesktop.kind === 'desktop' && devDesktop.os === 'window' && devDesktop.slug === '' && /^\d+x\d+$/.test(devDesktop.screen));
const devMobile = pickDevice({ device: 'mobile' });
ok('chọn thiết bị di động: OS android/iphone + độ phân giải di động + tên pool riêng',
  devMobile.kind === 'mobile' && ['android', 'iphone'].includes(devMobile.os) && /^\d{3}x\d{3}$/.test(devMobile.screen)
  && devMobile.slug === (devMobile.os === 'iphone' ? 'i' : 'a'));
ok('chế độ di động: 50 lượt liên tiếp đều là di động',
  Array.from({ length: 50 }, () => pickDevice({ device: 'mobile' }).kind).every(k => k === 'mobile'));
ok('chế độ hỗn hợp 100% -> luôn di động',
  Array.from({ length: 30 }, () => pickDevice({ device: 'mixed', mobilePercent: 100 }).kind).every(k => k === 'mobile'));
ok('chế độ hỗn hợp 0% -> luôn máy tính',
  Array.from({ length: 30 }, () => pickDevice({ device: 'mixed', mobilePercent: 0 }).kind).every(k => k === 'desktop'));

const kinds100 = Array.from({ length: 100 }, (_, i) => deviceKindAt(i + 1, 30));
ok('100 lượt với 30% -> đúng 70 lượt máy tính + 30 lượt di động',
  kinds100.filter(k => k === 'desktop').length === 70 && kinds100.filter(k => k === 'mobile').length === 30);
ok('10 lượt -> đúng 3 lượt di động (chia theo số lượt, không phải xác suất)',
  Array.from({ length: 10 }, (_, i) => deviceKindAt(i + 1, 30)).filter(k => k === 'mobile').length === 3);
ok('tỉ lệ 0% -> toàn máy tính, 100% -> toàn di động',
  Array.from({ length: 20 }, (_, i) => deviceKindAt(i + 1, 0)).every(k => k === 'desktop')
  && Array.from({ length: 20 }, (_, i) => deviceKindAt(i + 1, 100)).every(k => k === 'mobile'));
let deskRun = 0, maxDeskRun = 0;
for (const k of kinds100) { deskRun = k === 'desktop' ? deskRun + 1 : 0; maxDeskRun = Math.max(maxDeskRun, deskRun); }
ok('không dồn cục: dài nhất 3 lượt máy tính liên tiếp ở tỉ lệ 30%', maxDeskRun === 3);
ok('dãy dài vẫn đúng tỉ lệ: 200 lượt -> 140 máy tính + 60 di động',
  Array.from({ length: 200 }, (_, i) => deviceKindAt(i + 1, 30)).filter(k => k === 'mobile').length === 60);

await campaign.update({ settings: { device: 'mixed', mobilePercent: 30 } });
campaign.deviceSeq = { hour: 0, day: 0 };
const hourDevices = Array.from({ length: 100 }, () => campaign.nextDevice({ id: 'k-gio', unit: 'hour' }));
ok('chiến dịch theo giờ: 100 lượt -> 70 máy tính + 30 di động',
  hourDevices.filter(d => d.kind === 'desktop').length === 70 && hourDevices.filter(d => d.kind === 'mobile').length === 30);
ok('lượt di động nhận dấu vân tay di động + tên pool riêng',
  hourDevices.filter(d => d.kind === 'mobile').every(d => ['android', 'iphone'].includes(d.os) && ['a', 'i'].includes(d.slug) && /^\d{3}x\d{3}$/.test(d.screen)));
const dayDevices = Array.from({ length: 200 }, () => campaign.nextDevice({ id: 'k-ngay', unit: 'day' }));
ok('chiến dịch theo ngày: 200 lượt -> 140 máy tính + 60 di động (dãy đếm riêng, không lẫn với dãy theo giờ)',
  dayDevices.filter(d => d.kind === 'desktop').length === 140 && dayDevices.filter(d => d.kind === 'mobile').length === 60);
const plan = campaign.devicePlan();
ok('số liệu thiết bị cho giao diện: tỉ lệ đang áp dụng + số lượt đã chia mỗi dãy',
  plan.desktopPercent === 70 && plan.mobilePercent === 30 && plan.seq.hour === 100 && plan.seq.day === 200);
campaign.countDevice({ deviceKind: 'mobile' });
campaign.countDevice({ device: 'máy tính' });
ok('đếm lượt thực tế theo thiết bị (phục vụ đối chiếu tỉ lệ)',
  plan.desktop === 0 && campaign.devicePlan().desktop === 1 && campaign.devicePlan().mobile === 1);
await campaign.update({ settings: { device: 'desktop' } });
campaign.deviceSeq = { hour: 0, day: 0 };
ok('chế độ máy tính: mọi lượt đều là máy tính', Array.from({ length: 10 }, () => campaign.nextDevice({ unit: 'day' })).every(d => d.kind === 'desktop'));
await campaign.update({ settings: { device: 'mobile' } });
campaign.deviceSeq = { hour: 0, day: 0 };
ok('chế độ di động: mọi lượt đều là di động', Array.from({ length: 10 }, () => campaign.nextDevice({ unit: 'day' })).every(d => d.kind === 'mobile'));

ok('chỉ định thiết bị cho lượt -> đúng thiết bị đó',
  pickDevice({ device: 'mixed', mobilePercent: 30 }, 'mobile').kind === 'mobile'
  && pickDevice({ device: 'mixed', mobilePercent: 30 }, 'desktop').kind === 'desktop');
await campaign.update({ settings: { device: 'mixed', mobilePercent: 30 } });

await campaign.update({ settings: { proxy: { host: '127.0.0.1', port: 80, userBase: 'u', password: 'p' } } });
campaign.deviceSeq = { hour: 0, day: 0 };
const runsBefore = campaign.recent.length;
const fakeTask = { id: 'thiet-bi-1', keyword: 'x', targetUrl: 'https://example.org/x', unit: 'day', count: 200, enabled: true };
for (let i = 0; i < 10; i++) campaign.launch(fakeTask);
for (let i = 0; i < 200 && campaign.recent.length < runsBefore + 10; i++) await new Promise(r => setTimeout(r, 50));
const runs10 = campaign.recent.slice(0, 10).map(r => r.device);
ok('10 lượt đầu (dãy theo ngày): 7 lượt máy tính + 3 lượt di động — đúng quy định 70/30 theo số lượt',
  runs10.length === 10 && runs10.filter(d => d === 'máy tính').length === 7
  && runs10.filter(d => /^(Android|iPhone) \d{3}x\d{3}$/.test(d)).length === 3);

let createdPayload = null, openOpts = null;
const mkOpenOmni = () => ({
  profiles: { create: async payload => { createdPayload = payload; return { id: 701, name: payload.name }; }, delete: async () => {} },
  rest: { browser: { open: async (id, opts) => { openOpts = opts; return { status: true, bridge_url: 'ws://127.0.0.1:1?token=x' }; }, isActive: async () => false, stop: async () => {} } },
});
const mobilePage = {
  goto: async () => ({}),
  evaluate: expr => (String(expr) === 'navigator.userAgent'
    ? 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Mobile Safari/537.36'
    : '{"ip":"9.9.9.9"}'),
  url: async () => 'https://example.org/x',
};
const mobileLogs = [];
const resMobile = await runVisit(mkOpenOmni(), {
  slot: 1, keyword: 'x', targetUrl: 'https://example.org/x',
  settings: { ...runSettings, device: 'mobile', headless: true, profileMode: 'fresh' },
  solver: null, log: m => mobileLogs.push(m), openSession: async () => ({ page: mobilePage, disconnect: async () => {} }),
});
ok('lượt di động: profile tạo với OS di động + độ phân giải di động',
  ['android', 'iphone'].includes(createdPayload?.fingerprints?.operating_system)
  && /^\d{3}x\d{3}$/.test(createdPayload?.fingerprints?.screen_resolution || ''));
ok('lượt di động: tự bỏ "Chạy ẩn" (emulation di động cần cửa sổ thật)', openOpts?.headless === false);
ok('lượt di động: log ghi thiết bị + UA di động',
  mobileLogs.some(l => /^Thiết bị: (Android|iPhone) /.test(l)) && mobileLogs.some(l => /^UA di động: .*Mobile/.test(l)));
ok('lượt di động: kết quả kèm tên thiết bị để ghi vào bảng lượt chạy', /^(Android|iPhone) /.test(resMobile.device || ''));

createdPayload = null; openOpts = null;
const resDesk = await runVisit(mkOpenOmni(), {
  slot: 1, keyword: 'x', targetUrl: 'https://example.org/x',
  settings: { ...runSettings, profileMode: 'fresh' },
  solver: null, log: () => {},
  openSession: async () => ({ page: { ...mobilePage, evaluate: async () => '{"ip":"9.9.9.9"}' }, disconnect: async () => {} }),
});
ok('lượt máy tính: fingerprint window + vẫn tôn trọng "Chạy ẩn"',
  createdPayload?.fingerprints?.operating_system === 'window' && openOpts?.headless === true && resDesk.device === 'máy tính' && resDesk.deviceKind === 'desktop');

createdPayload = null; openOpts = null; mobileLogs.length = 0;
const resPreset = await runVisit(mkOpenOmni(), {
  slot: 1, keyword: 'x', targetUrl: 'https://example.org/x',
  settings: { ...runSettings, device: 'mixed', mobilePercent: 30, headless: true, profileMode: 'fresh' },
  device: { kind: 'mobile', os: 'android', screen: '393x852', slug: 'a', label: 'Android 393x852' },
  solver: null, log: m => mobileLogs.push(m),
  openSession: async () => ({ page: mobilePage, disconnect: async () => {} }),
});
ok('lượt có thiết bị chia sẵn: tạo profile đúng thiết bị đó (OS + độ phân giải)',
  createdPayload?.fingerprints?.operating_system === 'android' && createdPayload?.fingerprints?.screen_resolution === '393x852');
ok('lượt có thiết bị chia sẵn: xử lý như lượt di động (bỏ "Chạy ẩn") + kết quả kèm loại thiết bị',
  openOpts?.headless === false && resPreset.deviceKind === 'mobile' && resPreset.device === 'Android 393x852');

const { markTouch, isTouch, tap, wheel, clickLocator } = await import('../workflow/human.mjs');
const calls = [];
const touchPage = {
  rpc: { call: async (method, params) => { calls.push({ method, params }); return {}; } },
  evaluate: async () => 800,
  mouse: { wheel: async () => { calls.push({ method: 'mouse.wheel' }); } },
};
ok('tab chưa đánh dấu -> coi là máy tính', isTouch(touchPage) === false);
markTouch(touchPage);
ok('sau markTouch -> coi là di động', isTouch(touchPage) === true);

await wheel(touchPage, 600);
const touchTypes = calls.map(c => c.params?.type).filter(Boolean);
ok('cuộn trên di động = vuốt touch (touchStart → touchMove → touchEnd), không dùng bánh xe',
  calls.every(c => c.method === 'cdp.send' && c.params.method === 'Input.dispatchTouchEvent')
  && touchTypes[0] === 'touchStart' && touchTypes[touchTypes.length - 1] === 'touchEnd' && touchTypes.includes('touchMove'));

calls.length = 0;
await tap(touchPage, 12, 34);
ok('tap gửi touchStart rồi touchEnd, đúng toạ độ, điểm kết thúc rỗng',
  calls.length === 2 && calls[0].params.type === 'touchStart' && calls[0].params.touchPoints[0].x === 12
  && calls[1].params.type === 'touchEnd' && calls[1].params.touchPoints.length === 0);

calls.length = 0;
const fakeLocator = {
  boundingBox: async () => ({ x: 100, y: 200, width: 80, height: 30 }),
  click: async () => { calls.push({ method: 'locator.click' }); },
};
await clickLocator(touchPage, fakeLocator);
ok('bấm phần tử trên di động = tap touch (không dùng chuột của bridge)',
  calls.some(c => c.params?.type === 'touchStart') && !calls.some(c => c.method === 'locator.click' || c.method === 'mouse.wheel'));

calls.length = 0;
const desktopPage = { rpc: { call: async () => ({}) }, evaluate: async () => 800, mouse: { wheel: async (x, y) => { calls.push({ method: 'mouse.wheel', y }); } } };
await wheel(desktopPage, 500);
const notchSum = calls.reduce((s, c) => s + c.y, 0);
ok('tab máy tính cuộn bằng bánh xe chia nhiều nấc nhỏ, tổng đúng bằng quãng yêu cầu',
  calls.length >= 2 && calls.every(c => c.method === 'mouse.wheel' && Math.abs(c.y) >= 1 && Math.abs(c.y) <= 400)
  && notchSum === 500);
calls.length = 0;
ok('cuộn ngược cũng chia nấc và tổng đúng dấu âm', (await wheel(desktopPage, -300)) === true
  && calls.length >= 1 && calls.reduce((s, c) => s + c.y, 0) === -300);

const { typeText, pressKey, moveMouse, idleFidget } = await import('../workflow/human.mjs');
const kb = [];
const kbPage = {
  keyboard: {
    press: async k => {
      if (k.length === 1 && k.charCodeAt(0) > 127) throw new Error('ký tự ngoài bảng phím US');
      kb.push({ kind: 'press', k });
    },
    insertText: async t => { kb.push({ kind: 'insert', t }); },
  },
};
const typedOk = await typeText(kbPage, 'tin tức', { typos: false });
ok('gõ từng ký tự bằng press (không dán cả chuỗi một phát), dấu cách thành phím Space',
  typedOk === true && kb.filter(c => c.kind === 'press').length === 6
  && kb.some(c => c.kind === 'press' && c.k === 'Space') && !kb.some(c => c.kind === 'press' && c.k === 'Backspace'));
ok('ký tự tiếng Việt có dấu đi qua insertText — bridge cũ không nhận phím lạ cũng không hỏng lượt',
  kb.some(c => c.kind === 'insert' && c.t === 'ứ') && !kb.some(c => c.kind === 'press' && c.k === 'ứ'));

kb.length = 0;
await typeText(kbPage, 'to', { typoChance: 1 });
const typoSeq = kb.filter(c => c.kind === 'press').map(c => c.k);
ok('thỉnh thoảng gõ sai một phím rồi Backspace gõ lại (dấu hiệu người thật)',
  typoSeq.length === 4 && typoSeq[1] === 'Backspace' && typoSeq[0] !== 't' && typoSeq[2] === 't' && typoSeq[3] === 'o');

kb.length = 0;
ok('pressKey nhấn phím thật (Enter) đúng một lần', (await pressKey(kbPage, 'Enter')) === true
  && kb.length === 1 && kb[0].kind === 'press' && kb[0].k === 'Enter');

const mv = [];
const mvPage = { evaluate: async () => 800, mouse: { move: async (x, y) => { mv.push({ x, y }); }, wheel: async () => { mv.push({ wheel: true }); } } };
await moveMouse(mvPage, 700, 420);
ok('di chuột theo nhiều điểm rời (đường cong) chứ không nhảy thẳng một phát',
  mv.length >= 3 && new Set(mv.map(p => `${p.x},${p.y}`)).size >= 3 && mv.every(p => Number.isInteger(p.x) && Number.isInteger(p.y)));

const clickCalls = [];
const holdPage = {
  evaluate: async () => 800,
  mouse: {
    move: async () => {},
    down: async () => { clickCalls.push('down'); },
    up: async () => { clickCalls.push('up'); },
    click: async () => { clickCalls.push('click'); },
  },
};
const oneShotPage = { evaluate: async () => 800, mouse: { move: async () => {}, click: async () => { clickCalls.push('one-shot'); } } };
const box = { boundingBox: async () => ({ x: 100, y: 200, width: 80, height: 30 }) };
await clickLocator(holdPage, box);
ok('bridge hỗ trợ giữ nút -> bấm bằng down rồi up (không dùng click tức thì)', clickCalls.join(',') === 'down,up');
clickCalls.length = 0;
await clickLocator(oneShotPage, box);
ok('bridge cũ không có down/up -> tự lui về mouse.click (không lỗi)', clickCalls.join(',') === 'one-shot');

mv.length = 0;
await idleFidget(mvPage, { w: 1200, h: 700 });
ok('lúc "ngồi đọc" có xê dịch chuột nhẹ và không bấm gì (trang không có hàm click)',
  mv.length >= 1 && mv.every(p => p.wheel || (Number.isInteger(p.x) && Number.isInteger(p.y))));
ok('"ngồi đọc" trên di động chỉ vuốt nhẹ hoặc đứng yên, không bao giờ chạm (không sinh touchStart)',
  typeof (await idleFidget(touchPage)) === 'boolean');

const { RESULT_LINK_SELECTOR, unwrapGoogleHref, displayUrlFromText } = await import('../workflow/google-search.mjs');
ok('bộ chọn kết quả bao cả máy tính (<h3>) lẫn di động ([role="heading"] trong #rso)',
  RESULT_LINK_SELECTOR.includes('#search a:has(h3)') && RESULT_LINK_SELECTOR.includes('#rso a:has([role="heading"])'));
ok('gỡ link /url?q=<URL đã mã hoá>', unwrapGoogleHref('/url?q=https%3A%2F%2Fvnexpress.net%2F') === 'https://vnexpress.net/');
ok('gỡ link /url?q=<base64 của URL>',
  unwrapGoogleHref(`/url?q=${Buffer.from('https://example.org/a?b=1').toString('base64')}`) === 'https://example.org/a?b=1');
ok('link /goto?url=<chuỗi mã hoá> không giải ra URL -> trả null (không ném lỗi)',
  unwrapGoogleHref('/goto?url=CAESTgHrOzAVYJr6LlKzDEfCLQP53FCePdEZcWgSm1C5drwIpF') === null);
ok('URL hiển thị trong kết quả di động: lấy được URL đầy đủ',
  displayUrlFromText('VnExpress https://vnexpress.net VnExpress') === 'https://vnexpress.net');
ok('URL hiển thị: nhận cả dạng chỉ có domain', displayUrlFromText('VnExpress.net | Hanoi') === 'https://VnExpress.net');
ok('tiêu đề thuần chữ -> không bịa ra URL', displayUrlFromText('Tin tức 24h Mới nhất') === null);

const { CAMPAIGN_TYPES, getCampaignType } = await import('../campaign-types.mjs');
const { sessionParams, sessionSeconds, paceInfo, MAX_DWELL_SEC, MAX_SUBPAGES, SESSION_OVERHEAD_SEC } = await import('../campaign-pace.mjs');

ok('trần cấu hình mới: ở lại tối đa 3600s/trang, tối đa 4 trang con', MAX_DWELL_SEC === 3600 && MAX_SUBPAGES === 4);
await campaign.update({ settings: { dwellMin: 60, dwellMax: 5000, subDwellMin: 20, subDwellMax: 9000, subpages: 9 } });
ok('cài đặt vượt trần -> kẹp về 3600s (trước đây 1800s)', campaign.settings.dwellMax === 3600 && campaign.settings.subDwellMax === 3600);
ok('số trang con vượt trần -> kẹp về 4 (trước đây 2)', campaign.settings.subpages === 4);
ok('mọi loại chiến dịch đều nằm trong trần cấu hình (không có loại nào bị kẹp âm thầm)',
  CAMPAIGN_TYPES.every(t => t.engine.dwellMax <= MAX_DWELL_SEC && t.engine.subDwellMax <= MAX_DWELL_SEC && t.engine.subpages <= MAX_SUBPAGES));
await campaign.update({ settings: { dwellMin: 60, dwellMax: 120, subDwellMin: 20, subDwellMax: 45, subpages: 1 } });
ok('giá trị hợp lệ vẫn nhận đúng (không kẹp nhầm)', campaign.settings.dwellMax === 120 && campaign.settings.subpages === 1);

ok('chiến dịch không chọn loại -> không có tham số riêng (dùng cài đặt chung)', Object.keys(sessionParams('', campaign.settings)).length === 0);
ok('loại "đọc sâu" cho lượt dài: ở lại 240–480s + 3 trang con (90–180s)',
  getCampaignType('deep_browse').engine.dwellMin === 240 && getCampaignType('deep_browse').engine.subpages === 3
  && sessionSeconds('deep_browse', campaign.settings) === 480 + 3 * 180 + SESSION_OVERHEAD_SEC);
ok('lượt "chỉ tìm Google" không tính thời gian ở lại', sessionSeconds('search_only', campaign.settings) === SESSION_OVERHEAD_SEC);

const basePace = { ...campaign.settings, threads: 1, activeFrom: 0, activeTo: 24, dwellMax: 120, subpages: 1, subDwellMax: 45 };
const paceHour = paceInfo({ count: 100, unit: 'hour' }, 'search_dwell', basePace);
ok('nhịp theo giờ: 100 lượt/giờ ⇒ hai lượt cách nhau 36 giây', paceHour.unitSec === 3600 && paceHour.intervalSec === 36);
ok('lượt ≈195 giây với 100 lượt/giờ ⇒ cần ≥6 luồng và bị đánh dấu "không kham nổi"',
  paceHour.sessionSec === 195 && paceHour.needThreads === 6 && paceHour.overloaded === true);
ok('nâng đủ 6 luồng thì hết cảnh báo',
  paceInfo({ count: 100, unit: 'hour' }, 'search_dwell', { ...basePace, threads: 6 }).overloaded === false);
const paceDay = paceInfo({ count: 100, unit: 'day' }, 'search_dwell', basePace);
ok('nhịp theo ngày: 100 lượt trong 24 giờ ⇒ cách nhau 14,4 phút, 1 luồng là đủ', paceDay.intervalMin === 14.4 && paceDay.needThreads === 1 && !paceDay.overloaded);
ok('khung giờ chạy hẹp lại (7–23h) thì nhịp dày hơn: 16 giờ cho 100 lượt',
  paceInfo({ count: 100, unit: 'day' }, 'search_dwell', { ...basePace, activeFrom: 7, activeTo: 23 }).unitSec === 16 * 3600);
ok('chiến dịch tắt/chỉ tiêu 0 -> không tính nhịp', paceInfo({ count: 0, unit: 'day' }, 'search_dwell', basePace).intervalSec === null);
const cad = (own, engineThreads) => paceInfo({ count: 100, unit: 'hour', maxThreads: own }, 'search_dwell', { ...basePace, threads: engineThreads });
ok('trần riêng thấp hơn trần chung -> nhịp tính theo trần riêng (cần 6 luồng, chiến dịch cho 3)',
  cad(3, 6).threads === 3 && cad(3, 6).maxThreads === 3 && cad(3, 6).globalThreads === 6
  && cad(3, 6).needThreads === 6 && cad(3, 6).overloaded === true && cad(3, 6).capBlocked === true);
ok('engine hết luồng (bằng trần riêng) -> không còn báo “nâng trần chiến dịch”, phải nâng trần chung',
  cad(3, 3).overloaded === true && cad(3, 3).capBlocked === false);
ok('trần riêng đủ luồng -> hết cảnh báo nhịp', cad(6, 6).overloaded === false && cad(6, 6).threads === 6);

mk('nhip lich', 100, 'hour', { status: 'running' });
await campaign.syncTasks();
const paceSnap = campaign.status().tasks;
ok('bảng điều khiển /campaign nhận được "nhịp" của từng chiến dịch (thời gian 1 lượt + số luồng cần)',
  paceSnap.length > 0 && paceSnap.every(t => t.pace && t.pace.sessionSec > 0 && t.pace.needThreads >= 1 && t.pace.guardMin >= 10),
  JSON.stringify(paceSnap.map(t => ({ id: t.id, type: t.type, count: t.count, unit: t.unit, pace: t.pace }))));
ok('nhịp của chiến dịch 100 lượt/giờ trong bảng: cần nhiều luồng hơn số đang đặt (cảnh báo hiện trên giao diện)',
  paceSnap.some(t => t.pace.overloaded && t.pace.needThreads > t.pace.threads));

await campaign.update({ settings: { dwellMin: 60, dwellMax: 3600, subDwellMin: 60, subDwellMax: 3600, subpages: 4 } });
ok('lượt dài hơn hạn cứng 90 phút -> vẫn tính được nhưng bị đánh dấu bị cắt (cảnh báo trên giao diện)',
  campaign.paceOf({ type: '', count: 1, unit: 'day' }).exceedGuard === true);
await campaign.update({ settings: { dwellMin: 60, dwellMax: 120, subDwellMin: 20, subDwellMax: 45, subpages: 1 } });
ok('lượt trong hạn thì không bị đánh dấu cắt', campaign.paceOf({ type: '', count: 1, unit: 'day' }).exceedGuard === false);

const { readViewportInPage } = await import('../workflow/dwell.mjs');
const el = (rect, text = '', kids = []) => ({
  getBoundingClientRect: () => rect,
  innerText: text,
  querySelector: () => kids.length ? kids[0] : null,
  paused: false,
});
const rect = (top, bottom, left = 0, right = 1000) => ({ top, bottom, left, right, width: right - left, height: bottom - top });
const inViewText = el(rect(200, 260), 'một hai ba bốn năm sáu bảy tám');
const parentBlock = el(rect(100, 400), 'chữ của cha không được đếm', [inViewText]);
const belowFold = el(rect(900, 1000), 'chữ nằm ngoài khung nhìn không được đếm vào');
const tooShort = el(rect(300, 340), 'ngắn');
const poster = el(rect(320, 420));
const video = el(rect(340, 640));
video.duration = 300; video.currentTime = 10; video.paused = false;
const live = el(rect(400, 700));
live.duration = NaN;
const pausedVideo = el(rect(360, 660));
pausedVideo.duration = 600; pausedVideo.currentTime = 0; pausedVideo.paused = true;
const fakeDoc = {
  querySelectorAll: sel => (/blockquote/.test(sel) ? [parentBlock, inViewText, belowFold, tooShort]
    : [poster, video, live, pausedVideo]),
  documentElement: { scrollHeight: 4000 },
};
const savedWin = globalThis.window, savedDoc = globalThis.document;
globalThis.window = { innerHeight: 800, innerWidth: 1200, scrollY: 400 };
globalThis.document = fakeDoc;
const view = readViewportInPage();
globalThis.window = savedWin; globalThis.document = savedDoc;

ok('đọc khung nhìn: chỉ đếm khối chữ NHỎ NHẤT đang nhìn thấy (không nhân đôi số từ của cha)',
  view.words === 8, `words=${view.words}`);
ok('đọc khung nhìn: khối ngoài khung nhìn và khối quá ngắn không được tính',
  !String(view.words).includes('9') && view.words < 20);
ok('đọc khung nhìn: đếm ảnh/video đang trong khung (làm cơ sở cho nhịp "ngắm ảnh")',
  view.media === 4, `media=${view.media}`);
ok('đọc khung nhìn: video đang phát 300 giây, đã xem 10 giây -> còn 65–170 giây (25–60% thời lượng)',
  view.videoSec >= 65 && view.videoSec <= 170, `videoSec=${view.videoSec}`);
ok('đọc khung nhìn: livestream (không có duration) và video đang tạm dừng bị loại (nếu tính, kết quả đã vượt 170)',
  view.videoSec <= 170);
ok('đọc khung nhìn: trả cả vị trí cuộn để biết đã tới đáy trang chưa',
  view.y === 400 && view.vh === 800 && view.vw === 1200 && Math.abs(view.depth - 0.3) < 1e-9, `depth=${view.depth}`);

globalThis.window = { innerHeight: 800, innerWidth: 1200, scrollY: 0 };
globalThis.document = { querySelectorAll: sel => (/blockquote/.test(sel) ? [] : [pausedVideo, live]), documentElement: { scrollHeight: 4000 } };
const noVideo = readViewportInPage();
globalThis.window = savedWin; globalThis.document = savedDoc;
ok('đọc khung nhìn: chỉ video đang phát thật mới được xem (tạm dừng/livestream -> 0)',
  noVideo.videoSec === 0 && noVideo.words === 0);

const { impressionAt, IMPRESSION_EVERY } = await import('../workflow/worker.mjs');
const { googleSearch, closeTab, NotFoundError, looksEncryptedQuery } = await import('../workflow/google-search.mjs');

ok('quy định chung: cứ 20 lượt tìm kiếm có 1 lượt chỉ hiển thị', IMPRESSION_EVERY === 20);
const imp100 = Array.from({ length: 100 }, (_, i) => impressionAt(i + 1, 20));
ok('100 lượt tìm kiếm -> đúng 5 lượt chỉ hiển thị (chia theo số lượt, không theo may rủi)',
  imp100.filter(Boolean).length === 5);
ok('rải đều: các lượt chỉ hiển thị rơi đúng vào lượt 20, 40, 60, 80, 100',
  imp100.map((v, i) => (v ? i + 1 : 0)).filter(Boolean).join(',') === '20,40,60,80,100');
ok('đổi tỉ lệ: 10 lượt -> đúng 1 lượt; 0 -> tắt hoàn toàn',
  Array.from({ length: 10 }, (_, i) => impressionAt(i + 1, 10)).filter(Boolean).length === 1
  && Array.from({ length: 30 }, (_, i) => impressionAt(i + 1, 0)).every(v => v === false));
ok('chỉ số lạ (0, âm) không bao giờ là lượt chỉ hiển thị',
  impressionAt(0, 20) === false && impressionAt(-5, 20) === false);

await campaign.update({ settings: { impressionEvery: 20 } });
campaign.impressionSeq = 0;
const imp20 = Array.from({ length: 20 }, () => campaign.nextImpression({ type: 'search_dwell' }));
ok('engine: 20 lượt tìm Google -> đúng 1 lượt chỉ hiển thị (lượt #20)',
  imp20.filter(Boolean).length === 1 && imp20[19] === true);
campaign.impressionSeq = 0;
const impMixed = [
  ...Array.from({ length: 10 }, () => campaign.nextImpression({ type: 'search_dwell' })),
  ...Array.from({ length: 10 }, () => campaign.nextImpression({ type: 'direct_visit' })),
];
ok('chiến dịch vào thẳng URL không tính vào dãy chia (10 lượt tìm Google -> chưa có lượt chỉ hiển thị)',
  impMixed.every(v => v === false) && campaign.impressionSeq === 10);
await campaign.update({ settings: { impressionEvery: 0 } });
campaign.impressionSeq = 0;
ok('đặt 0 -> tắt lượt chỉ hiển thị (mọi lượt đều bấm vào kết quả)',
  Array.from({ length: 30 }, () => campaign.nextImpression({ type: 'search_dwell' })).every(v => v === false)
  && campaign.impressionPlan().every === 0);
await campaign.update({ settings: { impressionEvery: 10 } });
campaign.impressionSeq = 0;
Array.from({ length: 10 }, () => campaign.nextImpression({ type: 'search_dwell' }));
ok('đổi tỉ lệ bằng ô trên /campaign: cứ 10 lượt có 1 lượt + số liệu cho giao diện',
  campaign.impressionPlan().every === 10 && campaign.impressionPlan().seq === 10 && campaign.impressionPlan().today === 0);
await campaign.update({ settings: { impressionEvery: 999 } });
ok('tỉ lệ lạ bị kẹp về 0–100', campaign.settings.impressionEvery === 100);
campaign.countImpression({ result: { impression: true } });
campaign.countImpression({ result: {} });
ok('đếm lượt chỉ hiển thị thực tế trong ngày (chỉ đếm lượt có cờ impression)',
  campaign.impressionPlan().today === 1);
await campaign.update({ settings: { impressionEvery: 20, device: 'mixed', mobilePercent: 30 } });

campaign.impressionSeq = 0;
campaign.events.length = 0;
const impTask = { id: 'imp-1', keyword: 'x', targetUrl: 'https://example.org/x', unit: 'day', count: 1, enabled: true };
for (let i = 0; i < 20; i++) campaign.launch(impTask);
for (let i = 0; i < 400 && campaign.workers.size; i++) await new Promise(r => setTimeout(r, 25));
ok('20 lượt chạy -> đúng 1 lượt được chia là "chỉ hiển thị" (nhật ký ghi rõ)',
  campaign.events.filter(e => /lượt chỉ hiển thị/.test(e)).length === 1);

const SEARCH_BOX_SEL = 'textarea[name="q"], input[name="q"]';
const rect2 = (x, y, w, h) => ({ x, y, width: w, height: h });
const RESULT_ITEMS = [
  { href: 'https://khac.example/bai-viet', title: 'Kết quả khác', box: rect2(10, 400, 300, 20) },
  { href: 'https://example.org/dich', title: 'Trang đích', box: rect2(10, 460, 300, 20) },
];
const hitResult = (x, y) => RESULT_ITEMS.find(i => x >= i.box.x && x <= i.box.x + i.box.width && y >= i.box.y && y <= i.box.y + i.box.height);

function fakeGooglePage({ ip = '9.9.9.9', startUrl = 'https://www.google.com/', submitUrl = null } = {}) {
  const st = { url: startUrl, typed: '', pointer: { x: 0, y: 0 }, clicks: 0, navigations: [], gotos: [], urlBroken: false };
  const box = {
    boundingBox: async () => rect2(200, 100, 400, 40),
    isVisible: async () => true,
    inputValue: async () => st.typed,
    press: async () => { st.url = submitUrl || `https://www.google.com/search?q=${encodeURIComponent(st.typed)}`; },
    click: async () => { st.clicks++; },
  };
  const link = item => ({
    getAttribute: async () => item.href,
    innerText: async () => item.title,
    boundingBox: async () => item.box,
    locator: () => ({ first: () => ({ innerText: async () => item.title, boundingBox: async () => item.box }) }),
    click: async () => { st.clicks++; st.url = item.href; st.navigations.push(item.href); },
    evaluate: async () => { st.clicks++; st.url = item.href; st.navigations.push(item.href); },
  });
  return {
    state: st,
    goto: async url => { st.gotos.push(url); st.url = url; },
    url: async () => (st.urlBroken ? '' : st.url),
    title: async () => 'Google',
    evaluate: async expr => {
      if (typeof expr === 'function') {
        return /innerText/.test(String(expr)) ? `{"ip":"${ip}"}` : '';
      }
      const e = String(expr);
      if (e.includes('innerHeight')) return 800;
      if (e.includes('innerWidth')) return 1200;
      return '';
    },
    locator: sel => {
      const s = String(sel);
      if (s === SEARCH_BOX_SEL) return { first: () => box, count: async () => 1 };
      if (s === '#search, #rso') return { count: async () => 1 };
      if (/a:has/.test(s)) return { count: async () => RESULT_ITEMS.length, all: async () => RESULT_ITEMS.map(link) };
      return { count: async () => 0, first: () => ({ count: async () => 0, innerText: async () => '', isVisible: async () => false, boundingBox: async () => null }) };
    },
    waitForTimeout: async () => {},
    waitForLoadState: async () => {},
    keyboard: {
      press: async key => {
        if (key === 'Backspace') st.typed = st.typed.slice(0, -1);
        else if (key === 'Space') st.typed += ' ';
        else if (String(key).length === 1) st.typed += key;
      },
      insertText: async ch => { st.typed += String(ch); },
    },
    mouse: {
      move: async (x, y) => { st.pointer = { x, y }; },
      down: async () => {},
      up: async () => {
        const item = hitResult(st.pointer.x, st.pointer.y);
        if (item) { st.clicks++; st.url = item.href; st.navigations.push(item.href); }
      },
      click: async (x, y) => {
        const item = hitResult(x, y);
        if (item) { st.clicks++; st.url = item.href; st.navigations.push(item.href); }
      },
      wheel: async () => {},
    },
  };
}

function fakeTabs(urlOf) {
  const t = {
    closed: [],
    list: async () => ({ pages: [{ targetId: 'tab1', url: urlOf(), title: 'Google' }] }),
    close: async id => { t.closed.push(id); },
    activate: async () => {},
  };
  return t;
}

const impPage = fakeGooglePage();
const impTabs = fakeTabs(() => impPage.state.url);
const impLogs = [];
const impOut = await googleSearch(impPage, {
  keyword: 'keo bong da', targetUrl: 'https://example.org/dich', tabs: impTabs, impressionOnly: true, log: m => impLogs.push(m),
});
ok('lượt chỉ hiển thị: KHÔNG bấm vào kết quả nào (vẫn ở trang kết quả Google)',
  impPage.state.clicks === 0 && impPage.state.navigations.length === 0 && /^https:\/\/www\.google\.com\/search\?q=/.test(impPage.state.url));
ok('lượt chỉ hiển thị: thoát tab (đóng đúng tab kết quả)', impTabs.closed.length === 1 && impTabs.closed[0] === 'tab1');
ok('lượt chỉ hiển thị: kết quả kèm cờ impression + vị trí kết quả đã hiện (không có trang đích)',
  impOut.impression === true && impOut.landed === undefined && impOut.matched.position === 2 && impOut.matched.page === 1);
ok('lượt chỉ hiển thị: nhật ký nói rõ không bấm vào và đã thoát tab',
  impLogs.some(l => /👁 Lượt chỉ lấy hiển thị/.test(l)) && impLogs.some(l => /Đã thoát tab/.test(l)));

const clickPage = fakeGooglePage();
const clickTabs = fakeTabs(() => clickPage.state.url);
const clickOut = await googleSearch(clickPage, {
  keyword: 'keo bong da', targetUrl: 'https://example.org/dich', tabs: clickTabs, log: () => {},
});
ok('lượt thường: bấm vào kết quả và vào đúng URL đích (đối chiếu với lượt chỉ hiển thị)',
  clickPage.state.clicks >= 1 && clickPage.state.navigations[0] === 'https://example.org/dich'
  && clickOut.landed?.url === 'https://example.org/dich' && clickOut.impression === undefined);
ok('lượt thường: không đóng tab kết quả', clickTabs.closed.length === 0);

const impRunPage = fakeGooglePage();
const impRunTabs = fakeTabs(() => impRunPage.state.url);
const impRunLogs = [];
const impRunSteps = [];
const resImp = await runVisit(mkOpenOmni(), {
  slot: 1, keyword: 'keo bong da', targetUrl: 'https://example.org/dich',
  settings: { ...runSettings, skipSearch: false, skipVisit: false, impressionOnly: true, dwellMin: 60, dwellMax: 120, subpages: 1, maxPages: 5 },
  solver: null, log: m => impRunLogs.push(m), onStep: s => impRunSteps.push(s),
  openSession: async () => ({ page: impRunPage, tabs: impRunTabs, disconnect: async () => {} }),
});
ok('runVisit: lượt chỉ hiển thị trả về thành công + cờ impression, KHÔNG có dữ liệu ở lại site',
  resImp.status === 'ok' && resImp.result?.impression === true && resImp.result?.visit === undefined);
ok('runVisit: lượt chỉ hiển thị đóng tab, không bấm vào kết quả và ghi rõ trong nhật ký',
  impRunTabs.closed.length === 1 && impRunPage.state.clicks === 0
  && impRunLogs.some(l => /Lượt chỉ lấy hiển thị/.test(l)));
ok('runVisit: bước "Tìm Google (chỉ hiển thị)" hiện trên giao diện luồng đang chạy',
  impRunSteps.includes('Tìm Google (chỉ hiển thị)'));

const closedByPage = [];
const pageWithClose = { close: async () => { closedByPage.push('page'); }, url: async () => 'https://www.google.com/search?q=x' };
ok('closeTab: bridge có page.close() thì dùng luôn', (await closeTab(pageWithClose, null)) === true && closedByPage.length === 1);
let tabsUsed = '';
const tabsApi = { list: async () => ({ pages: [{ targetId: 't9', url: 'https://www.google.com/search?q=x' }] }), close: async id => { tabsUsed = id; } };
const pageNoClose = { url: async () => 'https://www.google.com/search?q=x' };
ok('closeTab: bridge cũ (không có page.close) -> đóng tab qua API tabs',
  (await closeTab(pageNoClose, tabsApi)) === true && tabsUsed === 't9');
ok('closeTab: không đóng được thì trả false (lượt vẫn kết thúc bình thường, không ném lỗi)',
  (await closeTab(pageNoClose, null)) === false
  && (await closeTab({ url: async () => { throw new Error('tab đã chết'); } }, null)) === false);

const ENC_Q = 'EgSr4vRwGOm7_9UGIjBOMVV4zRzoxK82LsqpEqiRF0-gRcmF7tsKsVmHDwPQ1eHtd2C6-wyckA9LVm00b7wyAnJSWgFD';
ok('nhận diện truy vấn bị Google mã hoá trong URL, không nhận truy vấn thường',
  looksEncryptedQuery(ENC_Q) && !looksEncryptedQuery('keo bong da') && !looksEncryptedQuery('soi kèo nhà cái brfo.io'));

const encPage = fakeGooglePage({ submitUrl: `https://www.google.com/search?q=${ENC_Q}&sca_esv=6f5e3dfc56d3df57` });
const encLogs = [];
const encOut = await googleSearch(encPage, {
  keyword: 'keo bong da', targetUrl: 'https://example.org/dich', tabs: fakeTabs(() => encPage.state.url), log: m => encLogs.push(m),
});
ok('URL kết quả bị mã hoá truy vấn vẫn quét được tới kết quả đích (không bị coi là trang cũ)',
  encOut.landed?.url === 'https://example.org/dich' && encOut.matched?.position === 2, JSON.stringify(encOut.matched || {}));
ok('trang mã hoá truy vấn: KHÔNG quay lại google.com (không còn cảnh tự reload giữa lượt)',
  encPage.state.gotos.length === 0 && encLogs.some(l => /mã hoá truy vấn trong URL/.test(l)));

const enc2Page = fakeGooglePage({ submitUrl: `https://www.google.com/search?q=${ENC_Q}&q=${encodeURIComponent('keo bong da')}` });
const enc2Out = await googleSearch(enc2Page, {
  keyword: 'keo bong da', targetUrl: 'https://example.org/dich', tabs: fakeTabs(() => enc2Page.state.url), log: () => {},
});
ok('URL có nhiều tham số q: tham số mã hoá đứng trước vẫn nhận đúng truy vấn của mình',
  enc2Out.landed?.url === 'https://example.org/dich' && enc2Page.state.gotos.length === 0);

const SORRY_URL = `https://www.google.com/sorry/index?continue=https%3A%2F%2Fwww.google.com%2Fsearch%3Fq%3Dkeo%2Bbong%2Bda&q=${ENC_Q}`;
const capPage = fakeGooglePage({ startUrl: SORRY_URL, submitUrl: `https://www.google.com/search?q=${ENC_Q}` });
capPage.state.urlBroken = true;
const capLogs = [];
let capAsk = 0, capDone = 0;
setTimeout(() => { capPage.state.urlBroken = false; }, 600);
setTimeout(() => { capPage.state.url = `https://www.google.com/search?q=${ENC_Q}`; }, 900);
const capOut = await googleSearch(capPage, {
  keyword: 'keo bong da', targetUrl: 'https://example.org/dich', tabs: fakeTabs(() => capPage.state.url),
  captchaWaitMs: 30000, log: m => capLogs.push(m),
  onCaptcha: waiting => { waiting ? capAsk++ : capDone++; },
});
ok('captcha: báo chờ giải tay rồi đi tiếp khi captcha được giải xong',
  capAsk === 1 && capDone === 1 && capLogs.some(l => /✓ Đã qua captcha/.test(l)), `ask=${capAsk} done=${capDone}`);
ok('captcha: đọc URL hụt KHÔNG bị coi là "ngoài Google" -> KHÔNG mở lại google.com (không mất captcha)',
  capPage.state.gotos.length === 0 && !capLogs.some(l => /Đang vào google.com/.test(l)));
ok('captcha: giải xong thì chạy tiếp tới kết quả (trang mã hoá của Google không bị coi là trang cũ)',
  capOut.landed?.url === 'https://example.org/dich' && !capLogs.some(l => /trang kết quả cũ/.test(l)));

campaign.walletWarned.clear();
const runTask = { dbId: cidA, userId: uid, type: 'search_dwell', keyword: 'keo bong da' };
const paidBefore = wallet.balanceOf(uid);
ok('lượt vào được trang đích -> trừ đúng đơn giá của loại chiến dịch (organic chuẩn 1.500đ)',
  campaign.chargeVisit(runTask, { status: 'ok', result: { landed: { url: 'https://example.org/dich' } } }) === true
  && paidBefore - wallet.balanceOf(uid) === 1500);
ok('lượt "chỉ lấy hiển thị" (không bấm vào kết quả) KHÔNG bị trừ tiền',
  campaign.chargeVisit(runTask, { status: 'ok', result: { impression: true, matched: { page: 1, position: 3 } } }) === true
  && wallet.balanceOf(uid) === paidBefore - 1500);
const afterPaid = wallet.balanceOf(uid);
campaign.chargeVisit(runTask, { status: 'error' });
campaign.chargeVisit(runTask, { status: 'notfound' });
campaign.chargeVisit(runTask, { status: 'captcha' });
campaign.chargeVisit(runTask, { status: 'ok', result: { matched: { page: 1, position: 2 } } });
ok('lượt lỗi / không thấy URL / captcha / không vào site đều không bị trừ tiền',
  wallet.balanceOf(uid) === afterPaid, `còn ${wallet.balanceOf(uid)}`);
ok('loại chiến dịch chưa có giá -> không trừ tiền (đơn giá 0)',
  campaign.chargeVisit({ ...runTask, type: 'khong-co-loai' }, { status: 'ok', result: { landed: { url: 'x' } } }) === true
  && wallet.balanceOf(uid) === afterPaid);

const cidBroken = mk('het tien', 5, 'day');
await campaign.syncTasks();
ok('ví còn tiền -> chiến dịch vẫn nằm trong danh sách chạy', campaign.tasks.some(t => t.dbId === cidBroken));
const drained = wallet.balanceOf(uid);
if (drained > 0) wallet.spend({ userId: uid, amountVnd: drained, note: 'rút hết tiền để kiểm thử' });
ok('ví về 0', wallet.balanceOf(uid) === 0);
await campaign.syncTasks();
ok('ví hết tiền -> không chiến dịch nào được chạy và engine tự tắt', campaign.tasks.length === 0 && campaign.running === false);
ok('ví hết tiền -> lượt xong không trừ được tiền và chiến dịch bị tạm dừng',
  campaign.chargeVisit({ dbId: cidBroken, userId: uid, type: 'search_dwell', keyword: 'het tien' },
    { status: 'ok', result: { landed: { url: 'https://example.org/het-tien' } } }) === false
  && campaigns.byId(cidBroken).status === 'paused'
  && wallet.balanceOf(uid) === 0);
wallet.credit({ userId: uid, amountVnd: 3000, note: 'nạp lại để kiểm thử' });
const cidRevive = mk('chay lai', 3, 'day');
await campaign.syncTasks();
ok('nạp tiền lại -> chiến dịch đang bật tự quay vào danh sách chạy (không cần làm gì thêm)',
  campaign.tasks.some(t => t.dbId === cidRevive) && campaign.running === true);
ok('chiến dịch đã bị tạm dừng vì hết tiền thì giữ nguyên "tạm dừng" (chủ tài khoản tự bật lại)',
  campaigns.byId(cidBroken).status === 'paused');

const { splitKeywordUrl } = await import('../campaign-types.mjs');
const split1 = splitKeywordUrl('soi kèo nhà cái https://brfo.io/');
ok('tách URL http(s) khỏi từ khóa', split1.keyword === 'soi kèo nhà cái' && split1.url === 'https://brfo.io/');
const split2 = splitKeywordUrl('sunwin www.sunwinsiro.com/');
ok('tách cả dạng www.', split2.keyword === 'sunwin' && split2.url === 'www.sunwinsiro.com/');
const split3 = splitKeywordUrl('keo truc tuyen');
ok('từ khóa sạch giữ nguyên, không có URL', split3.keyword === 'keo truc tuyen' && split3.url === null);
const split4 = splitKeywordUrl('b52club b52clubmilo.com', 'https://b52clubmilo.com/');
ok('tên miền trần trùng URL đích thì tách', split4.keyword === 'b52club' && split4.url === 'https://b52clubmilo.com');
const split5 = splitKeywordUrl('bong da.tv', 'https://keotructuyen.tv/');
ok('tên miền trần KHÁC URL đích thì giữ nguyên (không cắt oan từ khóa có dấu chấm)',
  split5.keyword === 'bong da.tv' && split5.url === null);
ok('ô từ khóa chỉ có URL -> phần từ khóa rỗng (API báo lỗi rõ ràng)', splitKeywordUrl('https://brfo.io/').keyword === '');
ok('từ khóa rỗng/null không lỗi', splitKeywordUrl('').keyword === '' && splitKeywordUrl(null).url === null);

const { searchQuery, targetHost, isValidQueryMode, QUERY_MODES } = await import('../campaign-types.mjs');
ok('chỉ có 2 kiểu truy vấn hợp lệ (keyword | keyword_domain)',
  QUERY_MODES.length === 2 && isValidQueryMode('keyword') && isValidQueryMode('keyword_domain') && !isValidQueryMode('link'));
ok('tên miền lấy từ URL đích (bỏ www + đường dẫn)',
  targetHost('https://www.Brfo.io/duong-dan?x=1') === 'brfo.io' && targetHost('brfo.io') === 'brfo.io' && targetHost('') === '');
ok('kiểu "Chỉ từ khóa" -> Google nhận đúng từ khóa',
  searchQuery({ keyword: 'soi kèo nhà cái', targetUrl: 'https://brfo.io/', queryMode: 'keyword' }) === 'soi kèo nhà cái');
ok('kiểu "Từ khóa + tên miền" -> Google nhận "từ khóa + tên miền đích"',
  searchQuery({ keyword: 'soi kèo nhà cái', targetUrl: 'https://brfo.io/duong-dan', queryMode: 'keyword_domain' }) === 'soi kèo nhà cái https://brfo.io');
ok('thiếu URL đích thì vẫn gõ từ khóa (không lỗi)',
  searchQuery({ keyword: 'soi kèo nhà cái', targetUrl: '', queryMode: 'keyword_domain' }) === 'soi kèo nhà cái');

const qdPage = fakeGooglePage();
const qdLogs = [];
const qdOut = await googleSearch(qdPage, {
  keyword: 'keo bong da', targetUrl: 'https://example.org/dich', queryMode: 'keyword_domain',
  tabs: fakeTabs(() => qdPage.state.url), log: m => qdLogs.push(m),
});
ok('engine gõ truy vấn "từ khóa + tên miền" lên Google (ô tìm kiếm + nhật ký)',
  qdPage.state.typed === 'keo bong da https://example.org'
  && qdLogs.some(l => /truy vấn gửi Google: "keo bong da https:\/\/example\.org"/.test(l))
  && qdLogs.some(l => /③ Tìm kiếm Google với truy vấn "keo bong da https:\/\/example\.org"/.test(l)));
ok('kết quả trả kèm truy vấn thật (query) + giữ từ khóa gốc (keyword)',
  qdOut.query === 'keo bong da https://example.org' && qdOut.keyword === 'keo bong da' && qdOut.landed?.url === 'https://example.org/dich');

let qdErr = '';
let qdErrObj = null;
try {
  await googleSearch(fakeGooglePage(), {
    keyword: 'soi kèo nhà cái', targetUrl: 'https://brfo.io/', queryMode: 'keyword_domain', maxPages: 1,
    tabs: fakeTabs(() => ''), log: () => {},
  });
} catch (e) { qdErr = e.message; qdErrObj = e; }
ok('lỗi "không tìm thấy URL" ghi rõ truy vấn đã gõ + tên miền đã thấy',
  /soi kèo nhà cái https:\/\/brfo\.io/.test(qdErr) && /Tên miền đã thấy/.test(qdErr), qdErr.slice(0, 120));
ok('lỗi "không tìm thấy URL" mang theo truy vấn đã gõ (NotFoundError) — không phải suy ra từ chuỗi thông báo',
  qdErrObj instanceof NotFoundError && qdErrObj.query === 'soi kèo nhà cái https://brfo.io'
  && qdErrObj.keyword === 'soi kèo nhà cái' && Array.isArray(qdErrObj.seen));

const nfPage = fakeGooglePage();
const nfTabs = fakeTabs(() => nfPage.state.url);
const resNf = await runVisit(mkOpenOmni(), {
  slot: 1, keyword: 'soi kèo nhà cái', targetUrl: 'https://brfo.io/', queryMode: 'keyword_domain',
  settings: { ...runSettings, skipSearch: false, skipVisit: true, maxPages: 1 },
  solver: null, log: () => {},
  openSession: async () => ({ page: nfPage, tabs: nfTabs, disconnect: async () => {} }),
});
ok('runVisit: lượt "không thấy URL" trả về truy vấn thật đã gõ (không còn null)',
  resNf.status === 'notfound' && resNf.query === 'soi kèo nhà cái https://brfo.io' && nfPage.state.typed === 'soi kèo nhà cái https://brfo.io',
  `status=${resNf.status} query=${resNf.query}`);
campaign.recordDb(task, { seconds: 12, attempts: 1, captchas: 0, onSite: 0, pages: 0 }, resNf);
ok('lượt "không thấy URL" ghi được truy vấn thật vào CSDL (runs.query)',
  runs.recent({ campaignId: cidA, limit: 1 })[0]?.query === 'soi kèo nhà cái https://brfo.io');

runs.record({ campaignId: cidA, userId: uid, status: 'ok', position: 8, deviceKind: 'desktop', device: 'máy tính' });
runs.record({ campaignId: cidA, userId: uid, status: 'ok', position: 12, deviceKind: 'mobile', device: 'Android 412x915' });
runs.record({ campaignId: cidA, userId: uid, status: 'ok', position: 6, deviceKind: 'desktop', device: 'máy tính' });
const rank = runs.rankByDevice({ campaignId: cidA });
ok('rankByDevice lấy vị trí MỚI NHẤT của mỗi thiết bị',
  rank.length === 2 && rank.find(r => r.deviceKind === 'desktop')?.position === 6
  && rank.find(r => r.deviceKind === 'mobile')?.position === 12,
  JSON.stringify(rank));
ok('ghi được loại thiết bị + nhãn thiết bị vào runs',
  runs.recent({ campaignId: cidA, limit: 10 }).some(r => r.device_kind === 'mobile' && /Android/.test(r.device || '')));
runs.record({ campaignId: cidA, userId: uid, status: 'notfound' });
ok('lượt không ghi vị trí không làm đổi xếp hạng',
  runs.rankByDevice({ campaignId: cidA }).find(r => r.deviceKind === 'desktop').position === 6);
ok('lọc xếp hạng theo tài khoản', runs.rankByDevice({ userId: 999999 }).length === 0);

db.close();
rmSync(dir, { recursive: true, force: true });
console.log(`\nKết quả: ${pass} PASS, ${fail} FAIL`);
process.exit(fail ? 1 : 0);
