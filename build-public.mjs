// Build tĩnh cho production: minify JS/CSS/inline script, bỏ comment HTML.
// Chạy: npm run build:public  ->  dist/public
// Sau đó: npm run start:prod (server đọc PUBLIC_DIR=dist/public).
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { transform } from 'esbuild';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(ROOT, 'public');
const OUT = path.join(ROOT, 'dist', 'public');

const JS_OPTS = { loader: 'js', minify: true, target: 'es2020', legalComments: 'none' };
const CSS_OPTS = { loader: 'css', minify: true, target: 'es2020', legalComments: 'none' };

const stripComments = s => String(s).replace(/<!--(?!\[if)[\s\S]*?-->/g, '');

async function walk(dir, base = dir) {
  const out = [];
  for (const e of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...await walk(full, base));
    else out.push(path.relative(base, full));
  }
  return out;
}

async function processHtml(html, rel) {
  const re = /<(script|style)\b([^>]*)>([\s\S]*?)<\/\1>/gi;
  const out = [];
  let last = 0;
  let m;
  while ((m = re.exec(html))) {
    out.push(stripComments(html.slice(last, m.index)));
    const tag = m[1].toLowerCase();
    const attrs = m[2];
    const body = m[3];
    const isJson = tag === 'script' && /type\s*=\s*["']application\/(?:ld\+json|json)["']/i.test(attrs);
    const hasSrc = tag === 'script' && /\bsrc\s*=/i.test(attrs);
    if ((tag === 'script' && (isJson || hasSrc)) || !body.trim()) {
      out.push(m[0]);
    } else {
      try {
        const r = await transform(body, tag === 'script' ? JS_OPTS : CSS_OPTS);
        out.push(`<${tag}${attrs}>${r.code.trim()}</${tag}>`);
      } catch (e) {
        throw new Error(`${rel}: lỗi minify <${tag}> — ${e.message}`);
      }
    }
    last = m.index + m[0].length;
  }
  out.push(stripComments(html.slice(last)));
  return out.join('');
}

await fs.rm(OUT, { recursive: true, force: true });
await fs.mkdir(OUT, { recursive: true });

const files = await walk(SRC);
let before = 0;
let after = 0;
for (const rel of files) {
  const from = path.join(SRC, rel);
  const to = path.join(OUT, rel);
  await fs.mkdir(path.dirname(to), { recursive: true });
  const st = await fs.stat(from);
  before += st.size;
  if (/\.html$/i.test(rel)) {
    const html = await fs.readFile(from, 'utf8');
    const min = await processHtml(html, rel);
    await fs.writeFile(to, min, 'utf8');
    after += Buffer.byteLength(min);
  } else if (/\.js$/i.test(rel)) {
    const src = await fs.readFile(from, 'utf8');
    const r = await transform(src, JS_OPTS);
    await fs.writeFile(to, r.code, 'utf8');
    after += Buffer.byteLength(r.code);
  } else if (/\.css$/i.test(rel)) {
    const src = await fs.readFile(from, 'utf8');
    const r = await transform(src, CSS_OPTS);
    await fs.writeFile(to, r.code, 'utf8');
    after += Buffer.byteLength(r.code);
  } else {
    await fs.copyFile(from, to);
    after += st.size;
  }
}

const kb = n => (n / 1024).toFixed(0) + ' KB';

// Đổi tên asset dùng chung sang tên có hash để khó đoán/so khớp giữa các bản.
// wt-badge.js giữ nguyên tên vì website khách đã nhúng snippet cố định.
const hash = buf => crypto.createHash('sha1').update(buf).digest('hex').slice(0, 8);
const swapped = {};
for (const name of ['ui.js', 'ui.css', 'ui-admin.js']) {
  const from = path.join(OUT, name);
  let buf;
  try { buf = await fs.readFile(from); } catch { continue; }
  const next = name.replace(/^ui(-admin)?\.(js|css)$/, (_, admin, ext) => `ui${admin || ''}.${hash(buf)}.${ext}`);
  await fs.writeFile(path.join(OUT, next), buf);
  swapped[name] = next;
}
if (swapped['ui-admin.js'] && swapped['ui.js']) {
  const p = path.join(OUT, swapped['ui.js']);
  const s = await fs.readFile(p, 'utf8');
  await fs.writeFile(p, s.split('/ui-admin.js').join(`/${swapped['ui-admin.js']}`), 'utf8');
}
if (Object.keys(swapped).length) {
  for (const rel of files.filter(f => /\.html$/i.test(f))) {
    const p = path.join(OUT, rel);
    let html = await fs.readFile(p, 'utf8');
    for (const [from, to] of Object.entries(swapped)) html = html.split(`/${from}`).join(`/${to}`);
    await fs.writeFile(p, html, 'utf8');
  }
}

console.log(`Đã build ${files.length} file vào ${path.relative(ROOT, OUT)}`);
if (Object.keys(swapped).length) console.log('Asset có hash:', Object.values(swapped).join(', '));
console.log(`Dung lượng: ${kb(before)} -> ${kb(after)} (${before ? Math.round((1 - after / before) * 100) : 0}% nhỏ hơn)`);
