import Database from 'better-sqlite3';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdirSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.OMNI_DATA_DIR || join(__dirname, '..', 'data');
mkdirSync(DATA_DIR, { recursive: true });

export const DB_FILE = join(DATA_DIR, 'omni.db');
export const db = new Database(DB_FILE);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');

db.exec(`
  -- Tài khoản người dùng
  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role          TEXT NOT NULL DEFAULT 'user',   -- user | admin
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Chiến dịch: 1 từ khóa -> 1 URL đích
  CREATE TABLE IF NOT EXISTS campaigns (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL,
    keyword    TEXT NOT NULL,
    target_url TEXT NOT NULL,
    status     TEXT NOT NULL DEFAULT 'idle',      -- idle | running | paused | done
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  -- Nhật ký từng lượt chạy
  CREATE TABLE IF NOT EXISTS runs (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    campaign_id INTEGER,
    user_id     INTEGER,
    at          TEXT NOT NULL DEFAULT (datetime('now')),
    status      TEXT NOT NULL DEFAULT 'pending',  -- ok | notfound | captcha | error | pending
    ip          TEXT,
    seconds     INTEGER,
    FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id)     REFERENCES users(id)     ON DELETE SET NULL
  );

  CREATE INDEX IF NOT EXISTS idx_campaigns_user  ON campaigns(user_id);
  CREATE INDEX IF NOT EXISTS idx_campaigns_kw    ON campaigns(keyword, target_url);
  CREATE INDEX IF NOT EXISTS idx_runs_campaign   ON runs(campaign_id, at DESC);
  CREATE INDEX IF NOT EXISTS idx_runs_user       ON runs(user_id, at DESC);
  CREATE INDEX IF NOT EXISTS idx_runs_status     ON runs(status);
`);

function ensureColumn(table, column, ddl) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name);
  if (!cols.includes(column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
}

ensureColumn('users', 'display_name', 'TEXT');
ensureColumn('users', 'status', "TEXT NOT NULL DEFAULT 'active'");
ensureColumn('users', 'max_slots', 'INTEGER NOT NULL DEFAULT 3');
ensureColumn('users', 'daily_quota', 'INTEGER NOT NULL DEFAULT 0');
ensureColumn('users', 'last_login_at', 'TEXT');

ensureColumn('campaigns', 'name', 'TEXT');
ensureColumn('campaigns', 'type', "TEXT NOT NULL DEFAULT 'search_dwell'");
ensureColumn('campaigns', 'count', 'INTEGER NOT NULL DEFAULT 0');
ensureColumn('campaigns', 'unit', "TEXT NOT NULL DEFAULT 'day'");
ensureColumn('campaigns', 'approval_status', "TEXT NOT NULL DEFAULT 'pending'");
ensureColumn('campaigns', 'reject_reason', 'TEXT');
ensureColumn('campaigns', 'approved_by', 'INTEGER REFERENCES users(id)');
ensureColumn('campaigns', 'approved_at', 'TEXT');
ensureColumn('campaigns', 'priority', 'INTEGER NOT NULL DEFAULT 0');
ensureColumn('campaigns', 'note', 'TEXT');
ensureColumn('campaigns', 'start_at', 'TEXT');
ensureColumn('campaigns', 'end_at', 'TEXT');
ensureColumn('campaigns', 'updated_at', 'TEXT');
ensureColumn('campaigns', 'updated_by', 'INTEGER REFERENCES users(id)');
ensureColumn('campaigns', 'query_mode', "TEXT NOT NULL DEFAULT 'keyword'");
ensureColumn('users', 'pw_changed_at', 'INTEGER');
ensureColumn('campaigns', 'hidden', 'INTEGER NOT NULL DEFAULT 0');
ensureColumn('campaigns', 'hidden_at', 'TEXT');
ensureColumn('campaigns', 'footer_check', 'TEXT');
ensureColumn('campaigns', 'footer_checked_at', 'TEXT');
ensureColumn('campaigns', 'footer_check_note', 'TEXT');
ensureColumn('campaigns', 'max_threads', 'INTEGER NOT NULL DEFAULT 1');

ensureColumn('runs', 'keyword', 'TEXT');
ensureColumn('runs', 'target_url', 'TEXT');
ensureColumn('runs', 'position', 'INTEGER');
ensureColumn('runs', 'on_site', 'INTEGER');
ensureColumn('runs', 'pages', 'INTEGER');
ensureColumn('runs', 'attempts', 'INTEGER');
ensureColumn('runs', 'captchas', 'INTEGER');
ensureColumn('runs', 'proxy', 'TEXT');
ensureColumn('runs', 'ram_peak_mb', 'REAL');
ensureColumn('runs', 'cpu_avg', 'REAL');
ensureColumn('runs', 'error', 'TEXT');
ensureColumn('runs', 'impression', 'INTEGER');
ensureColumn('runs', 'device_kind', 'TEXT');
ensureColumn('runs', 'device', 'TEXT');
ensureColumn('runs', 'query', 'TEXT');
ensureColumn('runs', 'user_agent', 'TEXT');

db.exec(`
  CREATE TABLE IF NOT EXISTS run_exports (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    campaign_id INTEGER NOT NULL,
    user_id     INTEGER,
    at          TEXT NOT NULL,
    keyword     TEXT,
    from_day    TEXT,
    to_day      TEXT,
    rows        INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_run_exports_campaign ON run_exports(campaign_id, at DESC);
`);

db.exec(`
  -- Tổng hợp theo ngày: biểu đồ traffic + đối chiếu hạn mức của user
  CREATE TABLE IF NOT EXISTS campaign_stats_daily (
    campaign_id INTEGER NOT NULL,
    day         TEXT    NOT NULL,               -- YYYY-MM-DD theo giờ máy
    ok          INTEGER NOT NULL DEFAULT 0,
    notfound    INTEGER NOT NULL DEFAULT 0,
    captcha     INTEGER NOT NULL DEFAULT 0,
    error       INTEGER NOT NULL DEFAULT 0,
    attempts    INTEGER NOT NULL DEFAULT 0,     -- số lượt tính vào chỉ tiêu (ok + notfound + captcha)
    PRIMARY KEY (campaign_id, day),
    FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE
  );

  -- Nhật ký thao tác: admin duyệt/từ chối/sửa chiến dịch, khoá tài khoản, đăng nhập...
  CREATE TABLE IF NOT EXISTS audit_logs (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    actor_id    INTEGER,
    actor_role  TEXT,
    action      TEXT NOT NULL,                  -- create|update|approve|reject|delete|lock|unlock|login|logout|run|stop
    entity      TEXT NOT NULL,                  -- campaign|user|settings
    entity_id   INTEGER,
    before_json TEXT,
    after_json  TEXT,
    note        TEXT,
    at          TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    FOREIGN KEY (actor_id) REFERENCES users(id) ON DELETE SET NULL
  );

  -- Thông báo trong app: user được duyệt/từ chối, admin có chiến dịch chờ duyệt
  CREATE TABLE IF NOT EXISTS notifications (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER,                        -- người nhận; NULL = theo vai trò
    for_role    TEXT,                           -- 'admin' | 'user' | NULL
    campaign_id INTEGER,
    title       TEXT NOT NULL,
    body        TEXT,
    read_at     TEXT,
    at          TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    FOREIGN KEY (user_id)     REFERENCES users(id)     ON DELETE CASCADE,
    FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE
  );

  -- Cấu hình dùng chung của hệ thống (proxy, telegram, captcha, giờ hoạt động...)
  CREATE TABLE IF NOT EXISTS settings (
    key        TEXT PRIMARY KEY,
    value      TEXT,
    updated_at TEXT,
    updated_by INTEGER
  );

  -- Vị trí Google hiển thị cho user: mỗi (chiến dịch, thiết bị) một dòng, chỉ cập nhật theo lịch ngẫu nhiên 15–45 phút
  CREATE TABLE IF NOT EXISTS campaign_ranks (
    campaign_id INTEGER NOT NULL,
    device_kind TEXT    NOT NULL,                 -- desktop | mobile
    position    INTEGER,                          -- NULL = lần cập nhật gần nhất không tìm thấy URL ("-")
    at          TEXT    NOT NULL,                 -- giờ máy, lúc cập nhật vị trí
    next_at     TEXT    NOT NULL,                 -- mốc sớm nhất được cập nhật lại (at + 15..45 phút ngẫu nhiên)
    PRIMARY KEY (campaign_id, device_kind),
    FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_campaigns_approval ON campaigns(approval_status, status);
  CREATE INDEX IF NOT EXISTS idx_campaigns_status   ON campaigns(status, user_id);
  CREATE INDEX IF NOT EXISTS idx_runs_at            ON runs(at DESC);
  CREATE INDEX IF NOT EXISTS idx_runs_rank          ON runs(campaign_id, device_kind, id DESC);
  CREATE INDEX IF NOT EXISTS idx_stats_day          ON campaign_stats_daily(day, campaign_id);
  CREATE INDEX IF NOT EXISTS idx_notif_user         ON notifications(user_id, read_at, at DESC);
  CREATE INDEX IF NOT EXISTS idx_notif_role         ON notifications(for_role, read_at, at DESC);
  CREATE INDEX IF NOT EXISTS idx_audit_entity       ON audit_logs(entity, entity_id, at DESC);
  CREATE INDEX IF NOT EXISTS idx_users_role         ON users(role, status);
`);

db.exec(`
  -- Ví của từng tài khoản: số dư tính bằng VND (admin quy đổi từ USDT nhận được)
  CREATE TABLE IF NOT EXISTS wallets (
    user_id    INTEGER PRIMARY KEY,
    balance    INTEGER NOT NULL DEFAULT 0,     -- VND còn lại; không bao giờ âm
    updated_at TEXT,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  -- Sổ giao dịch ví: nạp (+), trừ khi chạy lượt (-), điều chỉnh (±), khuyến mại (+).
  -- Số dư luôn đọc lại được từ sổ nên biến động của tài khoản là minh bạch, đối soát được.
  CREATE TABLE IF NOT EXISTS wallet_txns (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    code          TEXT,                             -- mã giao dịch hiển thị (TS000123)
    user_id       INTEGER NOT NULL,
    kind          TEXT NOT NULL,                    -- topup | spend | adjust | bonus
    amount        INTEGER NOT NULL,                 -- VND: nạp dương, chạy chiến dịch âm
    usdt          REAL,                             -- số USDT nhận được (khi nạp bằng USDT)
    rate          INTEGER,                          -- tỷ giá VND/USDT áp dụng cho phiếu nạp
    method        TEXT,                             -- usdt | bank | manual
    status        TEXT NOT NULL DEFAULT 'success',  -- success | pending | cancelled
    campaign_id   INTEGER,                          -- khoản trừ theo chiến dịch nào
    balance_after INTEGER,                          -- số dư sau giao dịch
    note          TEXT,
    actor_id      INTEGER,                          -- ai thực hiện (admin nạp tiền)
    at            TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    FOREIGN KEY (user_id)     REFERENCES users(id)     ON DELETE CASCADE,
    FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE SET NULL,
    FOREIGN KEY (actor_id)    REFERENCES users(id)     ON DELETE SET NULL
  );

  CREATE INDEX IF NOT EXISTS idx_txns_user     ON wallet_txns(user_id, at DESC, id DESC);
  CREATE INDEX IF NOT EXISTS idx_txns_campaign ON wallet_txns(campaign_id);
  CREATE INDEX IF NOT EXISTS idx_txns_kind     ON wallet_txns(kind, status);
`);

export function initDb() {
  return db;
}

if (process.argv[1] && join(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all()
    .map(r => r.name);
  console.log(`Đã khởi tạo CSDL: ${DB_FILE}`);
  console.log(`Bảng: ${tables.join(', ')}`);
}
