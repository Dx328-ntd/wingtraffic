import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const ROOT_FILES = ['agent/agent.mjs', 'campaign-types.mjs', 'proxy-pool.mjs', 'omnilogin-launcher.mjs', 'monitor.mjs', 'package-hash.mjs'];

export function packageFiles(root) {
  const out = [...ROOT_FILES];
  try {
    for (const f of fs.readdirSync(path.join(root, 'workflow'))) if (f.endsWith('.mjs')) out.push('workflow/' + f);
  } catch {  }
  return out.sort();
}

export function packageManifest(root) {
  const m = {};
  for (const rel of packageFiles(root)) {
    try {
      const text = fs.readFileSync(path.join(root, rel), 'utf8').replace(/\r\n/g, '\n');
      m[rel] = crypto.createHash('sha1').update(text).digest('hex').slice(0, 12);
    } catch { m[rel] = null; }
  }
  return m;
}

export function manifestDiff(have, want) {
  const out = [];
  for (const rel of Object.keys(want || {})) if (want[rel] && have?.[rel] !== want[rel]) out.push(rel);
  return out.sort();
}
