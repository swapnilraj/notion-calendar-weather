#!/usr/bin/env node
// Keeps "Notion Calendar Weather.app" on the latest Notion Calendar release.
//
//   node scripts/update.mjs [--check] [--force] [--debug] [--json]
//
// 1. Read Notion's public release feed (the same one the official app's updater uses).
// 2. If there is a newer release than the installed copy was built from (or this repo's commit
//    changed), download it, verify it (SHA-512 from the feed, Apple code signature, Notion's
//    Developer ID team, Gatekeeper), and build a patched copy from it into a staging folder.
// 3. If the copy is running, leave it staged: the app shows Notion's own "Restart to update"
//    prompt (src/weather/updater.ts). If it isn't running, install it right away.
//
// Never touches /Applications/Notion Calendar.app. The last line printed is `RESULT {json}`.
// Exit codes: 0 ok (up to date / staged / installed), 1 transient (network, lock held),
// 2 verification failed (do NOT retry or bypass), 3 build or patch failed (needs a code fix).

import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { values: args } = parseArgs({
  options: {
    check: { type: 'boolean', default: false },
    force: { type: 'boolean', default: false },
    debug: { type: 'boolean', default: false },
    feed: { type: 'string', default: 'https://calendar-desktop-release.notion-static.com' },
  },
});

const APP_NAME = 'Notion Calendar Weather';
const NOTION_TEAM_ID = 'LBQJ96FQ8D';
const NOTION_BUNDLE_ID = 'com.cron.electron';
const INSTALLED = path.join(os.homedir(), 'Applications', `${APP_NAME}.app`);
const UPDATE_DIR = path.join(os.homedir(), 'Library', 'Application Support', APP_NAME, 'update');
const STAGED_APP = path.join(UPDATE_DIR, 'staged', `${APP_NAME}.app`);
const MANIFEST = path.join(UPDATE_DIR, 'staged.json');
const BACKUP = path.join(UPDATE_DIR, 'previous', `${APP_NAME}.app`);
const CACHE = path.join(root, '.cache', 'releases');
const LOCK = path.join(UPDATE_DIR, 'update.lock');

class Fail extends Error {
  constructor(code, kind, message) {
    super(message);
    this.code = code;
    this.kind = kind;
  }
}
const log = (msg) => console.log(`▶ ${msg}`);
const sh = (cmd, argv, opts = {}) => execFileSync(cmd, argv, { encoding: 'utf8', ...opts }).trim();
const plist = (app, key) => sh('/usr/libexec/PlistBuddy', ['-c', `Print :${key}`, path.join(app, 'Contents/Info.plist')]);
const readJson = (f) => {
  try {
    return JSON.parse(fs.readFileSync(f, 'utf8'));
  } catch {
    return null;
  }
};
const cmpVersion = (a, b) => {
  const pa = a.split('.').map(Number), pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0);
  return 0;
};
const repoRev = () => {
  try {
    const git = (...a) => sh('git', ['-C', root, ...a]);
    return git('rev-parse', '--short', 'HEAD') + (git('status', '--porcelain', '--untracked-files=no') ? '-dirty' : '');
  } catch {
    return 'unknown';
  }
};
const isRunning = () => spawnSync('pgrep', ['-f', `${INSTALLED}/Contents/MacOS/`]).status === 0;

// Minimal parser for electron-builder's latest-mac.yml (flat keys + a `files:` list of maps).
function parseFeed(text) {
  const out = { files: [] };
  let item = null;
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\s+$/, '');
    let m;
    if ((m = line.match(/^\s+-\s+(\w+):\s*(.*)$/))) out.files.push((item = { [m[1]]: unquote(m[2]) }));
    else if ((m = line.match(/^\s+(\w+):\s*(.*)$/)) && item) item[m[1]] = unquote(m[2]);
    else if ((m = line.match(/^(\w+):\s*(.*)$/))) {
      item = null;
      if (m[1] !== 'files') out[m[1]] = unquote(m[2]);
    }
  }
  return out;
}
const unquote = (s) => s.replace(/^'(.*)'$/, '$1').replace(/^"(.*)"$/, '$1');

async function fetchFeed() {
  const res = await fetch(`${args.feed}/latest-mac.yml`, { signal: AbortSignal.timeout(20_000) }).catch((e) => {
    throw new Fail(1, 'network', `Could not reach the release feed: ${e.message}`);
  });
  if (!res.ok) throw new Fail(1, 'network', `Release feed returned HTTP ${res.status}`);
  const feed = parseFeed(await res.text());
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
  const file = feed.files.find((f) => f.url?.endsWith('.zip') && f.url.includes(`darwin-${arch}`));
  if (!feed.version || !file?.sha512) throw new Fail(3, 'feed-format', 'Release feed format changed (no version or zip for this Mac)');
  return { version: feed.version, releaseDate: feed.releaseDate, url: `${args.feed}/${encodeURIComponent(file.url)}`, sha512: file.sha512, size: Number(file.size) };
}

async function download(rel) {
  const dir = path.join(CACHE, rel.version);
  const zip = path.join(dir, 'release.zip');
  fs.mkdirSync(dir, { recursive: true });
  const sha = (f) => createHash('sha512').update(fs.readFileSync(f)).digest('base64');
  if (!(fs.existsSync(zip) && sha(zip) === rel.sha512)) {
    log(`Downloading Notion Calendar ${rel.version} (${Math.round(rel.size / 1e6)} MB)`);
    const res = await fetch(rel.url, { signal: AbortSignal.timeout(600_000) }).catch((e) => {
      throw new Fail(1, 'network', `Download failed: ${e.message}`);
    });
    if (!res.ok) throw new Fail(1, 'network', `Download returned HTTP ${res.status}`);
    fs.writeFileSync(zip + '.part', Buffer.from(await res.arrayBuffer()));
    fs.renameSync(zip + '.part', zip);
    if (sha(zip) !== rel.sha512) {
      fs.rmSync(zip);
      throw new Fail(2, 'verification', 'Downloaded file does not match the SHA-512 in the release feed');
    }
  }
  log('SHA-512 matches the feed');
  const extract = path.join(dir, 'app');
  fs.rmSync(extract, { recursive: true, force: true });
  sh('ditto', ['-x', '-k', zip, extract]);
  const app = fs.readdirSync(extract).find((n) => n.endsWith('.app'));
  if (!app) throw new Fail(3, 'feed-format', 'Release zip contains no .app');
  return path.join(extract, app);
}

function verifyNotionApp(app, version) {
  const failV = (msg) => {
    throw new Fail(2, 'verification', msg);
  };
  try {
    sh('codesign', ['--verify', '--deep', '--strict', app], { stdio: 'pipe' });
  } catch {
    failV('Code signature is invalid');
  }
  const info = spawnSync('codesign', ['-dv', app], { encoding: 'utf8' }).stderr;
  if (!info.includes(`TeamIdentifier=${NOTION_TEAM_ID}`)) failV(`Not signed by Notion's developer team (${NOTION_TEAM_ID})`);
  if (spawnSync('spctl', ['--assess', '--type', 'execute', app]).status !== 0) failV('Gatekeeper rejects the app (not notarized?)');
  if (plist(app, 'CFBundleIdentifier') !== NOTION_BUNDLE_ID) failV('Unexpected bundle identifier');
  if (plist(app, 'CFBundleShortVersionString') !== version) failV('App version does not match the feed');
  log(`Verified: signed by Notion (${NOTION_TEAM_ID}), notarized, version ${version}`);
}

function build(src) {
  fs.mkdirSync(path.dirname(STAGED_APP), { recursive: true });
  const argv = ['scripts/build.mjs', '--src', src, '--out', STAGED_APP, ...(args.debug ? ['--debug'] : [])];
  const r = spawnSync(process.execPath, argv, { cwd: root, stdio: 'inherit' });
  if (r.status !== 0) throw new Fail(3, 'build', 'Patch/build failed; Notion probably changed the app layout (see output above)');
  // The in-app restart prompt relies on Notion's updater hooks still existing.
  const warnings = [];
  const asar = sh(process.execPath, ['-e', `const a=require('@electron/asar');const p=${JSON.stringify(path.join(STAGED_APP, 'Contents/Resources/app.asar'))};const pk=JSON.parse(a.extractFile(p,'package.json'));process.stdout.write(a.extractFile(p,pk.main||'build/main/main.js').toString())`], { cwd: root, maxBuffer: 64 << 20 });
  for (const hook of ['cronQuitAndInstallUpdate', 'cronUpdateDownloaded', 'before-quit-for-update', 'weather-main.js'])
    if (!asar.includes(hook)) warnings.push(`Notion main bundle no longer contains "${hook}"; the in-app restart prompt may not appear`);
  return warnings;
}

function install() {
  if (isRunning()) throw new Fail(1, 'busy', 'Copy started running during install; left staged');
  fs.rmSync(BACKUP, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(BACKUP), { recursive: true });
  if (fs.existsSync(INSTALLED)) fs.renameSync(INSTALLED, BACKUP);
  fs.mkdirSync(path.dirname(INSTALLED), { recursive: true });
  fs.renameSync(STAGED_APP, INSTALLED);
  fs.rmSync(MANIFEST, { force: true });
}

async function main() {
  const installed = readJson(path.join(INSTALLED, 'Contents/Resources/ncw-build.json'));
  const staged = readJson(MANIFEST);
  const rel = await fetchFeed();
  const rev = repoRev();
  const base = staged && fs.existsSync(STAGED_APP) ? staged : installed;
  const reasons = [];
  if (!installed) reasons.push('copy not installed (or built before update support)');
  if (base && cmpVersion(rel.version, base.notionVersion) > 0) reasons.push(`Notion Calendar ${rel.version} released`);
  if (base && base.weatherRev !== rev) reasons.push(`weather code changed (${base.weatherRev} → ${rev})`);
  if (args.force) reasons.push('forced');
  const status = { latest: rel.version, releaseDate: rel.releaseDate, installed: installed?.notionVersion ?? null, installedRev: installed?.weatherRev ?? null, staged: staged?.notionVersion ?? null, repoRev: rev, running: isRunning() };
  log(`Latest ${rel.version} · installed ${status.installed ?? '—'} (${status.installedRev ?? '—'}) · staged ${status.staged ?? '—'} · repo ${rev}`);

  if (!reasons.length) return { ...status, action: staged ? 'already-staged' : 'up-to-date' };
  if (args.check) return { ...status, action: 'update-available', reasons };

  log(`Updating: ${reasons.join('; ')}`);
  const src = await download(rel);
  verifyNotionApp(src, rel.version);
  fs.rmSync(MANIFEST, { force: true }); // the app must not offer a half-built copy
  const warnings = build(src);
  const built = readJson(path.join(STAGED_APP, 'Contents/Resources/ncw-build.json'));
  fs.writeFileSync(MANIFEST, JSON.stringify({ ...built, appPath: STAGED_APP }, null, 2) + '\n');
  fs.rmSync(path.join(CACHE, rel.version, 'app'), { recursive: true, force: true });

  if (!isRunning()) {
    install();
    log(`Installed ${INSTALLED}`);
    return { ...status, action: 'installed', reasons, build: built.buildId, warnings };
  }
  log('Copy is running: staged; it will show "Restart to update"');
  return { ...status, action: 'staged', reasons, build: built.buildId, warnings };
}

fs.mkdirSync(UPDATE_DIR, { recursive: true });
let lockFd;
try {
  lockFd = fs.openSync(LOCK, 'wx');
  fs.writeSync(lockFd, String(process.pid));
} catch {
  const pid = Number(fs.readFileSync(LOCK, 'utf8'));
  let alive = false;
  try {
    process.kill(pid, 0);
    alive = true;
  } catch {}
  if (alive) {
    console.log(`RESULT ${JSON.stringify({ ok: false, code: 1, kind: 'busy', error: `Another update is running (pid ${pid})` })}`);
    process.exit(1);
  }
  fs.writeFileSync(LOCK, String(process.pid));
}
let code = 0;
try {
  const result = await main();
  console.log(`RESULT ${JSON.stringify({ ok: true, ...result })}`);
} catch (e) {
  code = e instanceof Fail ? e.code : 3;
  console.log(`RESULT ${JSON.stringify({ ok: false, code, kind: e.kind ?? 'unexpected', error: e.message })}`);
} finally {
  if (lockFd !== undefined) fs.closeSync(lockFd);
  fs.rmSync(LOCK, { force: true });
}
process.exit(code);
