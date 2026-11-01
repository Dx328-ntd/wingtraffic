import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db } from './init.mjs';
import { campaigns, users, audit } from './repo.mjs';
import { splitKeywordUrl } from '../campaign-types.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const FILE = path.join(ROOT, 'data', 'campaign.json');
const args = process.argv.slice(2);
const DRY = args.includes('--dry');
const START = args.includes('--start');

function readTasks(file) {
  const list = Array.isArray(file.tasks) ? file.tasks : [];
  return list
    .map(t => {
      const targetUrl = String(t.targetUrl || '').trim();
      const { keyword, url } = splitKeywordUrl(t.keyword, targetUrl);
      return {
        keyword,
        targetUrl: targetUrl || url || '',
        count: Math.max(0, Math.round(Number(t.count ?? t.perDay) || 0)),
        unit: t.unit === 'hour' ? 'hour' : 'day',
        enabled: t.enabled !== false,
      };
    })
    .filter(t => t.keyword && t.targetUrl);
}

const raw = JSON.parse(await fs.readFile(FILE, 'utf8'));
const tasks = readTasks(raw);
if (!tasks.length) {
  console.log('Không có từ khóa nào trong data/campaign.json — không cần nhập.');
  process.exit(0);
}

const admin = users.list({ role: 'admin', status: 'active' })[0] || users.list({ role: 'admin' })[0];
if (!admin) {
  console.error('Chưa có tài khoản admin — chạy "npm run seed:admin -- admin <mật-khẩu>" trước.');
  process.exit(1);
}

const wantRunning = START || raw.running === true;
const existing = campaigns.list({ userId: admin.id, limit: 1000 });
let added = 0;
let skipped = 0;

for (const t of tasks) {
  const dup = existing.find(c => c.keyword === t.keyword && c.target_url === t.targetUrl);
  if (dup) {
    skipped++;
    console.log(`• Bỏ qua (đã có #${dup.id}): "${t.keyword}" -> ${t.targetUrl}`);
    continue;
  }
  if (DRY) {
    added++;
    console.log(`+ Sẽ nhập: "${t.keyword}" -> ${t.targetUrl} (${t.count} lượt/${t.unit})`);
    continue;
  }
  const r = campaigns.create({
    userId: admin.id,
    name: `Nhập từ danh sách cũ`,
    keyword: t.keyword,
    targetUrl: t.targetUrl,
    type: 'search_dwell',
    count: t.count,
    unit: t.unit,
    priority: 5,
    note: 'Nhập từ data/campaign.json khi chuyển sang CSDL.',
  });
  const id = r.lastInsertRowid;
  campaigns.setApproval(id, { status: 'approved', byId: admin.id, reason: null });
  const status = t.enabled && t.count > 0 && wantRunning ? 'running' : 'idle';
  campaigns.setStatus(id, status, admin.id);
  audit.add({
    actorId: admin.id, actorRole: 'admin', action: 'create', entity: 'campaign', entityId: id,
    after: { keyword: t.keyword, targetUrl: t.targetUrl, count: t.count, unit: t.unit, status },
    note: `Nhập từ data/campaign.json (${status}).`,
  });
  added++;
  console.log(`✔ #${id} "${t.keyword}" (${t.count} lượt/${t.unit}) — trạng thái ${status}`);
}

console.log(`\nTheo ${DRY ? '(chạy thử) ' : ''}: thêm ${added}, bỏ qua ${skipped}, chủ sở hữu: ${admin.username} (#${admin.id}).`);
const total = db.prepare('SELECT COUNT(*) AS n FROM campaigns').get().n;
console.log(`Tổng số chiến dịch trong CSDL: ${total}.`);
if (!DRY && !wantRunning && added) console.log('Bấm "Bắt đầu" ở trang /my (hoặc dùng nút Bắt đầu ở /campaign) để chạy các chiến dịch vừa nhập.');
