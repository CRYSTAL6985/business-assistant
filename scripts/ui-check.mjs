// Browser check for the owner panel, no dependencies: drives headless Chrome over the DevTools
// protocol. Logs in, opens each page at each width and theme, saves a screenshot, and fails on
// console errors, failed requests or horizontal overflow.
//
//   node scripts/ui-check.mjs --base http://localhost:3100 --email demo@abrisham.local --password abrisham-demo \
//        --out /tmp/shots --pages /app,/app/orders --widths 1440,768,375 --themes dark,light
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const args = Object.fromEntries(process.argv.slice(2).reduce((pairs, arg, i, all) => (arg.startsWith('--') ? [...pairs, [arg.slice(2), all[i + 1]]] : pairs), []));
const base = args.base ?? 'http://localhost:3100';
const pages = (args.pages ?? '/app').split(',');
const widths = (args.widths ?? '1440,768,375').split(',').map(Number);
const themes = (args.themes ?? 'dark,light').split(',');
const out = args.out ?? mkdtempSync(path.join(tmpdir(), 'ui-check-'));
const chrome = args.chrome ?? 'google-chrome';
const PORT = 9333;
const SETTLE_MS = Number(args.settle ?? 900);
mkdirSync(out, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function login() {
  const res = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: args.email, password: args.password }) });
  if (!res.ok) throw new Error(`login failed: ${res.status}`);
  return res.headers.get('set-cookie').split(';')[0].split('=')[1];
}

async function main() {
  const sid = await login();
  const browser = spawn(chrome, ['--headless=new', `--remote-debugging-port=${PORT}`, '--disable-gpu', '--hide-scrollbars', `--user-data-dir=${mkdtempSync(path.join(tmpdir(), 'chr-'))}`, 'about:blank'], { stdio: 'ignore' });
  try {
    let target;
    for (let i = 0; i < 50 && !target; i++) {
      await sleep(100);
      target = await fetch(`http://127.0.0.1:${PORT}/json/list`).then((r) => r.json()).then((list) => list.find((t) => t.type === 'page')).catch(() => null);
    }
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((r) => ws.addEventListener('open', r, { once: true }));
    let id = 0;
    const pending = new Map();
    const problems = [];
    ws.addEventListener('message', ({ data }) => {
      const msg = JSON.parse(data);
      if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); return; }
      if (msg.method === 'Runtime.exceptionThrown') problems.push(`exception: ${msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text}`);
      if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') problems.push(`console.error: ${msg.params.args.map((a) => a.value ?? a.description).join(' ')}`);
      if (msg.method === 'Network.responseReceived' && msg.params.response.status >= 400) problems.push(`HTTP ${msg.params.response.status} ${msg.params.response.url}`);
      if (msg.method === 'Network.loadingFailed' && !msg.params.canceled) problems.push(`request failed: ${msg.params.errorText}`);
    });
    const send = (method, params = {}) => new Promise((resolve, reject) => {
      const msgId = ++id;
      pending.set(msgId, (m) => (m.error ? reject(new Error(`${method}: ${m.error.message}`)) : resolve(m.result)));
      ws.send(JSON.stringify({ id: msgId, method, params }));
    });
    await send('Runtime.enable');
    await send('Network.enable');
    await send('Page.enable');
    await send('Network.setCookie', { name: 'sid', value: sid, url: base });
    const results = [];
    for (const theme of themes) {
      await send('Page.addScriptToEvaluateOnNewDocument', { source: `try{localStorage.setItem('theme','${theme}')}catch{}` });
      for (const width of widths) {
        await send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });
        for (const page of pages) {
          const before = problems.length;
          await send('Page.navigate', { url: base + page });
          await sleep(SETTLE_MS);
          const { result } = await send('Runtime.evaluate', { returnByValue: true, expression: `({ overflow: document.documentElement.scrollWidth - innerWidth, height: document.documentElement.scrollHeight, theme: document.documentElement.dataset.theme, culprits: [...document.querySelectorAll('body *')].filter((n) => { const r = n.getBoundingClientRect(); return r.width && (r.left < -1 || r.right > innerWidth + 1) && !n.closest('.sidebar'); }).filter((n, i, all) => !all.some((o) => o !== n && n.contains(o))).slice(0, 3).map((n) => n.tagName.toLowerCase() + (n.className && typeof n.className === 'string' ? '.' + n.className.trim().split(/\\s+/).join('.') : '') + ' [' + Math.round(n.getBoundingClientRect().left) + '..' + Math.round(n.getBoundingClientRect().right) + ']') })` });
          const height = Math.min(result.value.height, 4000);
          await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
          await sleep(150);
          const shot = await send('Page.captureScreenshot', { format: 'png' });
          await send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });
          const file = path.join(out, `${page.replace(/[^a-z0-9]+/gi, '_')}-${width}-${theme}.png`);
          writeFileSync(file, Buffer.from(shot.data, 'base64'));
          const issues = problems.slice(before);
          if (result.value.overflow > 0) issues.push(`horizontal overflow ${result.value.overflow}px: ${result.value.culprits.join(', ')}`);
          results.push({ page, width, theme, file, issues });
        }
      }
    }
    ws.close();
    let failed = 0;
    for (const r of results) {
      const status = r.issues.length ? 'FAIL' : 'ok  ';
      if (r.issues.length) failed++;
      console.log(`${status} ${r.page} ${r.width} ${r.theme} → ${r.file}${r.issues.length ? `\n       ${r.issues.join('\n       ')}` : ''}`);
    }
    process.exitCode = failed ? 1 : 0;
  } finally {
    browser.kill();
  }
}

main().catch((err) => { console.error(err); process.exitCode = 1; });
