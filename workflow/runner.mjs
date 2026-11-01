
export class StepTimeout extends Error {}

export async function pollUntil(fn, { timeout = 15000, interval = 400, signal } = {}) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (signal?.aborted) throw new Error('aborted');
    try {
      if (await fn()) return true;
    } catch {
    }
    await new Promise(r => setTimeout(r, interval));
  }
  throw new StepTimeout('timeout');
}

export async function runWorkflow(steps, { log = console.log, maxIterations = 20, maxSameStep = 4 } = {}) {
  let lastStep = null;
  let sameCount = 0;

  for (let i = 1; i <= maxIterations; i++) {
    const ac = new AbortController();
    let winner;
    try {
      winner = await Promise.any(
        steps.map(async step => {
          await pollUntil(() => step.check(ac.signal), { timeout: step.timeout, signal: ac.signal });
          return step;
        }),
      );
    } catch {
      throw new Error('Không nhận diện được trạng thái trang hiện tại (unknown state). Trình duyệt được giữ nguyên để kiểm tra.');
    } finally {
      ac.abort();
    }

    sameCount = winner.name === lastStep ? sameCount + 1 : 1;
    lastStep = winner.name;
    if (sameCount > maxSameStep) {
      throw new Error(`Bị kẹt ở bước "${winner.name}" (${sameCount} lần liên tiếp không tiến triển).`);
    }

    log(`▶ Bước: ${winner.name}`);
    const res = await winner.execute();
    if (res?.ok && res.done) return res.data;
    if (!res?.ok) log(`  ↻ Bước "${winner.name}" chưa đạt, nhận diện lại trạng thái...`);
  }
  throw new Error(`Vượt quá ${maxIterations} vòng lặp mà workflow chưa hoàn tất.`);
}