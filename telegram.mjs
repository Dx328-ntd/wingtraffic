
export async function sendTelegram({ token, chatId }, text) {
  if (!token || !chatId) throw new Error('Chưa nhập Bot token hoặc Chat ID.');
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text: text.slice(0, 4000), parse_mode: 'HTML', disable_web_page_preview: true }),
    signal: AbortSignal.timeout(15000),
  });
  const data = await res.json().catch(() => ({}));
  if (!data.ok) throw new Error(`Telegram: ${data.description || 'HTTP ' + res.status}`);
  return data;
}

export const esc = s => String(s ?? '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

export function dailyReport({ date, tasks, proxies, hours, running }) {
  const lines = [`<b>📊 WingTraffic — báo cáo ngày ${esc(date)}</b>`, `Chiến dịch: ${running ? 'đang chạy' : 'đã dừng'}`, ''];
  let tot = { ok: 0, notfound: 0, captcha: 0, error: 0, target: 0 };
  lines.push('<b>Từ khóa</b> (đạt/chỉ tiêu · ✔ · không thấy · captcha · lỗi)');
  for (const t of tasks) {
    const s = t.today;
    const done = s.ok + s.notfound + s.captcha;
    tot = { ok: tot.ok + s.ok, notfound: tot.notfound + s.notfound, captcha: tot.captcha + s.captcha, error: tot.error + s.error, target: tot.target + t.perDay };
    lines.push(`• ${esc(t.keyword)} (${t.count}/${t.unit === 'hour' ? 'giờ' : 'ngày'}): ${done}/${t.perDay} · ✔${s.ok} · ${s.notfound} · ${s.captcha} · ${s.error}`);
  }
  lines.push(`<b>Tổng:</b> ✔ ${tot.ok} / chỉ tiêu ${tot.target} · không thấy ${tot.notfound} · captcha ${tot.captcha} · lỗi ${tot.error}`, '');

  const used = proxies.filter(p => p.inUse && p.attempts);
  if (used.length) {
    lines.push('<b>Proxy</b> (lần thử · captcha · lỗi proxy · thành công)');
    for (const p of used.slice(0, 15)) {
      const pct = n => (p.attempts ? Math.round((n / p.attempts) * 100) : 0) + '%';
      lines.push(`• ${esc(p.label)}: ${p.attempts} · ${pct(p.captcha)} · ${pct(p.proxyFail)} · ${pct(p.ok)}`);
    }
    lines.push('');
  }
  const hs = Object.entries(hours).filter(([, h]) => h.attempts);
  if (hs.length) {
    const best = hs.map(([h, v]) => [h, v.captcha / v.attempts]).sort((a, b) => a[1] - b[1]);
    lines.push(`Captcha ít nhất lúc ${best[0][0]}h (${Math.round(best[0][1] * 100)}%), nhiều nhất lúc ${best.at(-1)[0]}h (${Math.round(best.at(-1)[1] * 100)}%).`);
  }
  return lines.join('\n');
}
