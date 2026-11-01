
const CAPSOLVER_API = 'https://api.capsolver.com';
const sleep = ms => new Promise(r => setTimeout(r, ms));

export async function solveGoogleSorryWithCapSolver({ apiKey, sitekey, url, dataS, userAgent, log = console.log, timeout = 120 }) {
  if (!apiKey) throw new Error('Chưa cấu hình CapSolver API key.');
  if (!sitekey) throw new Error('Thiếu sitekey của Google /sorry.');

  log('  🤖 CapSolver: gửi task giải Google Search reCAPTCHA ...');

  const createBody = {
    clientKey: apiKey,
    task: {
      type: 'ReCaptchaV2EnterpriseTaskProxyLess',
      websiteURL: url,
      websiteKey: sitekey,
    },
  };
  if (dataS) {
    createBody.task.enterprisePayload = { s: dataS };
  }
  if (userAgent) {
    createBody.task.userAgent = userAgent;
  }

  const createResp = await fetch(`${CAPSOLVER_API}/createTask`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(createBody),
  });
  const createData = await createResp.json();
  if (createData.errorId !== 0) {
    throw new Error(`CapSolver createTask lỗi: ${createData.errorCode} - ${createData.errorDescription || JSON.stringify(createData)}`);
  }
  const taskId = createData.taskId;
  if (!taskId) throw new Error(`CapSolver createTask không trả taskId: ${JSON.stringify(createData)}`);
  log(`  CapSolver task ID: ${taskId} — chờ giải (tối đa ${timeout}s) ...`);

  const deadline = Date.now() + timeout * 1000;
  while (Date.now() < deadline) {
    await sleep(5000);
    const resultResp = await fetch(`${CAPSOLVER_API}/getTaskResult`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientKey: apiKey, taskId }),
    });
    const resultData = await resultResp.json();
    if (resultData.errorId !== 0) {
      throw new Error(`CapSolver getTaskResult lỗi: ${resultData.errorCode} - ${resultData.errorDescription || JSON.stringify(resultData)}`);
    }
    if (resultData.status === 'ready') {
      const token = resultData.solution?.gRecaptchaResponse
                 || resultData.solution?.token
                 || resultData.solution?.gRecaptchaResponseV3;
      if (!token) {
        throw new Error(`CapSolver ready nhưng không có token: ${JSON.stringify(resultData.solution)}`);
      }
      log('  ✔ CapSolver đã giải xong.');
      return token;
    }
    if (resultData.status !== 'processing' && resultData.status !== 'idle') {
      throw new Error(`CapSolver status lạ: ${JSON.stringify(resultData)}`);
    }
  }
  throw new Error(`CapSolver timeout sau ${timeout}s.`);
}