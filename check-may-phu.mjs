import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { packageManifest, manifestDiff } from './package-hash.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const MARK = path.resolve(ROOT, '..', 'Omni may phu', 'da-cap-nhat.json');
const now = packageManifest(ROOT);

if (process.argv.includes('--mark')) {
  fs.mkdirSync(path.dirname(MARK), { recursive: true });
  fs.writeFileSync(MARK, JSON.stringify({ at: new Date().toISOString(), files: now }, null, 2));
  console.log(`Đã ghi nhận "đã cập nhật sang máy phụ" (${Object.keys(now).length} file).`);
  process.exit(0);
}

let synced = null;
try { synced = JSON.parse(fs.readFileSync(MARK, 'utf8')); } catch {  }
const changed = manifestDiff(synced?.files || {}, now);
if (!changed.length) { console.log('Máy phụ đã đủ bản mới nhất (từ ' + (synced?.at || '?') + ').'); process.exit(0); }
console.log(synced ? `Cần chép ${changed.length} file sang máy phụ (đổi kể từ ${synced.at}):` : `Chưa có mốc cập nhật — coi như cần chép cả ${changed.length} file:`);
for (const f of changed) console.log('  ' + f);
console.log('\nGói đầy đủ: ' + path.resolve(ROOT, '..', 'Omni may phu', 'may-phu.zip') + ' (giữ lại agent\\agent.config.json của máy phụ khi giải nén đè).');
console.log('Chép xong, báo "đã cập nhật sang máy phụ" để ghi mốc.');
