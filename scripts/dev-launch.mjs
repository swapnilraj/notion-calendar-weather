#!/usr/bin/env node
// Dev-only launcher: start the patched copy and put its main window into native full screen through
// yabai, so the tiling layout doesn't split the screen when it opens. Nothing here changes the app or the
// yabai config; it only acts on the copy's own window (matched by process id).
//
//   node scripts/dev-launch.mjs [--port 9333] [--log path]
//
// --port sets NCW_DEBUG_PORT (only has an effect on a `build:debug` copy).
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { values: args } = parseArgs({
  options: {
    app: { type: 'string', default: path.join(os.homedir(), 'Applications', 'Notion Calendar Weather.app') },
    port: { type: 'string' },
    log: { type: 'string', default: path.join(root, '.work', 'launch.log') },
  },
});

const binary = path.join(args.app, 'Contents', 'MacOS', 'Notion Calendar');
if (!fs.existsSync(binary)) throw new Error(`No app at ${args.app} (run npm run build first)`);

// Only ever stop the copy (matched by its bundle path), never the original Notion Calendar.
try {
  execFileSync('pkill', ['-f', args.app]);
  await new Promise((r) => setTimeout(r, 1000));
} catch {}

fs.mkdirSync(path.dirname(args.log), { recursive: true });
const out = fs.openSync(args.log, 'w');
const env = { ...process.env, ...(args.port ? { NCW_DEBUG_PORT: args.port } : {}) };
const child = spawn(binary, [], { detached: true, stdio: ['ignore', out, out], env });
child.unref();
console.log(`launched pid ${child.pid}${args.port ? ` (debug port ${args.port})` : ''}, log: ${args.log}`);

// Wait for the main window of *this* process to appear in yabai, then make it native full screen.
const query = () => JSON.parse(execFileSync('yabai', ['-m', 'query', '--windows'], { encoding: 'utf8' }));
const mainWindow = () =>
  query()
    .filter((w) => w.pid === child.pid && w.title.includes('Notion Calendar'))
    .sort((a, b) => b.frame.w * b.frame.h - a.frame.w * a.frame.h)[0];

let win;
for (let i = 0; i < 60 && !win; i++) {
  win = mainWindow();
  if (!win) await new Promise((r) => setTimeout(r, 500));
}
if (!win) {
  console.error('The calendar window never showed up in yabai; is yabai running?');
  process.exit(1);
}
if (!win['is-native-fullscreen']) execFileSync('yabai', ['-m', 'window', String(win.id), '--toggle', 'native-fullscreen']);
await new Promise((r) => setTimeout(r, 1500));
const after = query().find((w) => w.id === win.id);
console.log(`window ${win.id}: full screen ${after?.['is-native-fullscreen'] ? 'yes' : 'NO'} (${after?.frame.w}x${after?.frame.h})`);
if (!after?.['is-native-fullscreen']) process.exitCode = 1;
