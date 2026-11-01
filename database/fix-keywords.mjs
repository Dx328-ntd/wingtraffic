import { splitKeywordUrl } from '../campaign-types.mjs';
import { db } from './init.mjs';
import { campaigns, audit } from './repo.mjs';

const APPLY = process.argv.slice(2).includes('--apply');
const rows = db.prepare('SELECT id, user_id, keyword, target_url FROM campaigns ORDER BY id').all();
let fixed = 0;

for (const r of rows) {
  const { keyword, url } = splitKeywordUrl(r.keyword, r.target_url);
  if (!url) continue;
  if (!keyword) {
    console.log(`• #${r.id}: bỏ qua — sau khi tách URL thì ô từ khóa trống (từ khóa gốc: "${r.keyword}")`);
    continue;
  }
  const targetUrl = r.target_url || url;
  console.log(`${APPLY ? '✔' : '•'} #${r.id}: "${r.keyword}"  ->  từ khóa "${keyword}" · URL đích "${targetUrl}"`);
  if (APPLY) {
    campaigns.update(r.id, { keyword, target_url: targetUrl });
    audit.add({
      actorRole: 'admin', action: 'update', entity: 'campaign', entityId: r.id,
      before: { keyword: r.keyword }, after: { keyword, target_url: targetUrl },
      note: 'Sửa từ khóa bị dán lẫn URL (db:fix-keywords).',
    });
  }
  fixed++;
}

console.log(`\n${APPLY ? 'Đã sửa' : 'Sẽ sửa'} ${fixed}/${rows.length} chiến dịch.`
  + (APPLY ? '' : ' Thêm --apply để ghi vào CSDL.'));
db.close();
