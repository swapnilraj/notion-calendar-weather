#!/usr/bin/env node
// Tiny Chrome DevTools Protocol client for inspecting the running (debug-built) app.
//   node scripts/cdp.mjs targets
//   node scripts/cdp.mjs eval '<js expression>'      (runs in the first calendar.notion.so page)
//   node scripts/cdp.mjs shot out.png
import fs from 'node:fs';
const port = process.env.NCW_DEBUG_PORT ?? '9333';
const [cmd, arg] = process.argv.slice(2);
// Safety: only ever attach to our Electron app, never a regular browser on the same port.
const version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
if (!/Electron/.test(version['User-Agent'] ?? '')) throw new Error(`Port ${port} is not an Electron app (${version.Browser}); refusing to attach`);
const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
if (cmd === 'targets') {
  for (const t of targets) console.log(t.type, t.url, t.title);
  process.exit(0);
}
const page = targets.find((t) => t.type === 'page' && t.url.includes('calendar.notion.so'));
if (!page) throw new Error('No calendar.notion.so page open (logged in yet?)');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0;
const pending = new Map();
ws.onmessage = (m) => {
  const msg = JSON.parse(m.data);
  if (msg.id && pending.has(msg.id)) pending.get(msg.id)(msg);
};
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
if (cmd === 'eval') {
  const r = await send('Runtime.evaluate', { expression: arg, returnByValue: true, awaitPromise: true });
  console.log(JSON.stringify(r.result?.result?.value ?? r.result, null, 2));
} else if (cmd === 'click') {
  const [x, y] = arg.split(',').map(Number);
  for (const type of ['mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 });
  console.log('clicked', x, y);
} else if (cmd === 'shot') {
  const r = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(arg, Buffer.from(r.result.data, 'base64'));
  console.log('saved', arg);
}
ws.close();
