#!/usr/bin/env node
// Builds "Notion Calendar Weather.app": a patched COPY of the installed Notion Calendar.
// The original app is only ever read, never modified.
//
//   node scripts/build.mjs [--src <app>] [--out <app>] [--bundles-only] [--keep-work]
//
// Pipeline: bundle weather code -> copy .app -> extract asar -> patch main + preload
//           -> repack asar -> update asar integrity hash in Info.plist -> re-sign ad hoc.

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { build as esbuild } from 'esbuild';

const require = createRequire(import.meta.url);
const asar = require('@electron/asar');

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { values: args } = parseArgs({
  options: {
    src: { type: 'string', default: '/Applications/Notion Calendar.app' },
    out: { type: 'string', default: path.join(os.homedir(), 'Applications', 'Notion Calendar Weather.app') },
    'bundles-only': { type: 'boolean', default: false },
    'keep-work': { type: 'boolean', default: false },
    // Dev only: lets `NCW_DEBUG_PORT=9222 <binary>` expose a local DevTools port for DOM inspection.
    debug: { type: 'boolean', default: false },
  },
});

const APP_NAME = 'Notion Calendar Weather';
const BUNDLE_ID = 'com.cron.electron.weather';
const MARK = '/*NCW*/';

const step = (msg) => console.log(`\n▶ ${msg}`);
const run = (cmd, argv, opts = {}) => execFileSync(cmd, argv, { stdio: 'inherit', ...opts });
function weatherRev() {
  try {
    const git = (...a) => execFileSync('git', ['-C', root, ...a], { encoding: 'utf8' }).trim();
    return git('rev-parse', '--short', 'HEAD') + (git('status', '--porcelain', '--untracked-files=no') ? '-dirty' : '');
  } catch {
    return 'unknown';
  }
}
const plist = (app, cmd) =>execFileSync('/usr/libexec/PlistBuddy', ['-c', cmd, path.join(app, 'Contents/Info.plist')], { encoding: 'utf8' }).trim();

// ---------------------------------------------------------------- 1. bundle weather code
const dist = path.join(root, 'dist');
async function bundle() {
  step('Bundling weather module');
  fs.rmSync(dist, { recursive: true, force: true });
  const common = { bundle: true, minify: false, logLevel: 'warning', external: ['electron'] };
  await esbuild({ ...common, entryPoints: [path.join(root, 'src/entry/main.ts')], outfile: path.join(dist, 'weather-main.js'), platform: 'node', format: 'cjs', target: 'node22' });
  // Preload is appended into Notion's (sandboxed) preload file, so it must be a self-contained IIFE.
  await esbuild({ ...common, entryPoints: [path.join(root, 'src/entry/preload.ts')], outfile: path.join(dist, 'weather-preload.js'), platform: 'node', format: 'iife', target: 'chrome140' });
  for (const f of ['weather-main.js', 'weather-preload.js']) {
    console.log(`  dist/${f}  ${fs.statSync(path.join(dist, f)).size} bytes`);
  }
}

await bundle();
if (args['bundles-only']) process.exit(0);

// ---------------------------------------------------------------- 2. preflight
const src = path.resolve(args.src);
const out = path.resolve(args.out);
if (!fs.existsSync(path.join(src, 'Contents/Resources/app.asar'))) throw new Error(`No app.asar in ${src}`);
if (out === src || !out.endsWith('.app')) throw new Error(`Refusing to write to ${out}`);
if (out.startsWith(src + path.sep) || src.startsWith(out + path.sep)) throw new Error('src and out must not be nested');

// ---------------------------------------------------------------- 3. copy the app
step(`Copying ${path.basename(src)} -> ${out}`);
fs.mkdirSync(path.dirname(out), { recursive: true });
if (fs.existsSync(out)) {
  // Only replace a previous build of ours.
  if (plist(out, 'Print :CFBundleIdentifier') !== BUNDLE_ID) throw new Error(`${out} exists and is not a previous build of this tool; remove it manually`);
  fs.rmSync(out, { recursive: true, force: true });
}
run('ditto', [src, out]);

// ---------------------------------------------------------------- 4. extract + patch
const work = path.join(root, '.work', 'app');
fs.rmSync(work, { recursive: true, force: true });
fs.mkdirSync(work, { recursive: true });
const asarPath = path.join(out, 'Contents/Resources/app.asar');

step('Extracting app.asar');
asar.extractAll(asarPath, work);
const pkg = JSON.parse(fs.readFileSync(path.join(work, 'package.json'), 'utf8'));
console.log(`  Notion Calendar ${pkg.version}`);

step('Patching main + preload');
const mainFile = path.join(work, pkg.main ?? 'build/main/main.js');
const preloadFile = path.join(work, 'build/preload/preload-bundle.js');
for (const f of [mainFile, preloadFile]) {
  if (!fs.existsSync(f)) throw new Error(`Expected file missing (did Notion restructure the app?): ${f}`);
  if (fs.readFileSync(f, 'utf8').includes(MARK)) throw new Error(`${f} is already patched`);
}

// Main: (a) give the copy its own userData dir so it doesn't share the single-instance lock or
// session with the original app; (b) load the weather IPC handlers after Notion's own code.
const mainDir = path.dirname(mainFile);
fs.copyFileSync(path.join(dist, 'weather-main.js'), path.join(mainDir, 'weather-main.js'));
const userDataPatch =
  `${MARK}try{var __e=require("electron");__e.app.setPath("userData",require("path").join(__e.app.getPath("appData"),${JSON.stringify(APP_NAME)}))}catch(e){console.error("[weather] userData",e)}\n`;
const debugPatch = args.debug
  ? `${MARK}try{if(process.env.NCW_DEBUG_PORT){require("electron").app.commandLine.appendSwitch("remote-debugging-port",process.env.NCW_DEBUG_PORT);require("electron").app.commandLine.appendSwitch("remote-debugging-address","127.0.0.1")}}catch(e){}\n`
  : '';
const mainLoader = `\n;${MARK}try{require("./weather-main.js")}catch(e){console.error("[weather] load failed",e)}\n`;
fs.writeFileSync(mainFile, userDataPatch + debugPatch + fs.readFileSync(mainFile, 'utf8') + mainLoader);

// Preload: append the bundled IIFE (sandboxed preloads can't require local files).
const preloadBundle = fs.readFileSync(path.join(dist, 'weather-preload.js'), 'utf8');
fs.appendFileSync(preloadFile, `\n;${MARK}try{\n${preloadBundle}\n}catch(e){console.error("[weather] preload",e)}\n`);

// ---------------------------------------------------------------- 5. repack + integrity hash
step('Repacking app.asar');
fs.rmSync(asarPath);
await asar.createPackage(work, asarPath);
// Electron's integrity check is SHA256 of the asar *header* string.
const hash = createHash('sha256').update(asar.getRawHeader(asarPath).headerString).digest('hex');

step('Updating Info.plist');
plist(out, `Set :ElectronAsarIntegrity:Resources/app.asar:hash ${hash}`);
plist(out, `Set :CFBundleIdentifier ${BUNDLE_ID}`);
// NOTE: leave CFBundleName alone. Electron derives its helper app names ("<CFBundleName> Helper")
// from it, and renaming it makes launch fail with "Unable to find helper app".
try {
  plist(out, `Set :CFBundleDisplayName ${APP_NAME}`);
} catch {
  plist(out, `Add :CFBundleDisplayName string ${APP_NAME}`);
}
// An ad-hoc-signed copy can't apply Notion's signed updates, and an update would overwrite the patch.
// Updates come from scripts/update.mjs instead, which stages a rebuilt copy for the in-app prompt.
fs.rmSync(path.join(out, 'Contents/Resources/app-update.yml'), { force: true });
console.log(`  asar hash ${hash}`);

// Build identity, read by the in-app updater (src/weather/updater.ts) and scripts/update.mjs.
const buildInfo = { notionVersion: pkg.version, weatherRev: weatherRev(), builtAt: new Date().toISOString() };
buildInfo.buildId = `${buildInfo.notionVersion}+${buildInfo.weatherRev}@${buildInfo.builtAt}`;
fs.writeFileSync(path.join(out, 'Contents/Resources/ncw-build.json'), JSON.stringify(buildInfo, null, 2) + '\n');
console.log(`  build ${buildInfo.buildId}`);

// ---------------------------------------------------------------- 6. sign
step('Re-signing (ad hoc)');
run('codesign', ['--force', '--deep', '--sign', '-', out]);
run('codesign', ['--verify', '--deep', '--strict', out]);
try {
  execFileSync('xattr', ['-dr', 'com.apple.quarantine', out], { stdio: 'ignore' });
} catch {}

if (!args['keep-work']) fs.rmSync(path.join(root, '.work'), { recursive: true, force: true });
console.log(`\n✔ Built ${out}\n  open "${out}"`);
