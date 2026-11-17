// Wires src/weather/updater.ts into Electron. Loaded after Notion's main bundle has run, so Notion's
// own 'cronQuitAndInstallUpdate' handler already exists and can be replaced.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { app, autoUpdater as nativeUpdater, ipcMain, webContents } from 'electron';
import type { WebContents } from 'electron';
import { TRUSTED_ORIGINS } from '../weather/channels.ts';
import { isTrustedSender } from '../weather/main.ts';
import {
  NOTION_INSTALL_CHANNEL,
  NOTION_UPDATE_CHANNELS,
  SWAP_SCRIPT,
  bundleOf,
  findStagedUpdate,
  readBuildInfo,
  rewriteUpdateMessage,
  stagedManifest,
  updateDir,
} from '../weather/updater.ts';
import type { StagedUpdate } from '../weather/updater.ts';

const POLL_MS = 5 * 60 * 1000;

const isNotionPage = (wc: WebContents) => {
  try {
    return TRUSTED_ORIGINS.includes(new URL(wc.getURL()).origin);
  } catch {
    return false;
  }
};

export function startUpdater(): void {
  const userData = app.getPath('userData');
  const current = readBuildInfo(path.join(process.resourcesPath, 'ncw-build.json'));
  let staged: StagedUpdate | null = null;
  const refresh = () => {
    const next = findStagedUpdate(userData, current);
    const changed = next?.buildId !== staged?.buildId;
    staged = next;
    if (changed && staged) announce();
  };

  // Rewrite Notion's updater messages on their way to the page.
  const originals = new WeakMap<WebContents, WebContents['send']>();
  const wrap = (wc: WebContents) => {
    if (originals.has(wc)) return;
    const send = wc.send.bind(wc);
    originals.set(wc, send);
    wc.send = (channel: string, ...args: unknown[]) => {
      const [c, a] = rewriteUpdateMessage(channel, args, staged);
      send(c, ...a);
    };
    wc.on('did-finish-load', () => setTimeout(() => staged && isNotionPage(wc) && wc.send(NOTION_UPDATE_CHANNELS.downloaded), 3000));
  };
  app.on('web-contents-created', (_e, wc) => wrap(wc));
  for (const wc of webContents.getAllWebContents()) wrap(wc);

  const announce = () => {
    for (const wc of webContents.getAllWebContents()) if (isNotionPage(wc)) wc.send(NOTION_UPDATE_CHANNELS.downloaded);
  };

  // Replace "Restart to update" so it installs the staged copy.
  ipcMain.removeHandler(NOTION_INSTALL_CHANNEL);
  ipcMain.handle(NOTION_INSTALL_CHANNEL, (event) => {
    if (!isTrustedSender(event)) throw new Error('Origin not allowed');
    refresh();
    if (!staged) throw new Error('Cannot restart and install. There is no update downloaded.');
    installAndRelaunch(userData, staged);
  });

  try {
    fs.mkdirSync(updateDir(userData), { recursive: true });
    fs.watch(updateDir(userData), () => setTimeout(refresh, 1000)).on('error', () => {});
  } catch (err) {
    console.error('[weather] update watch', err);
  }
  setInterval(refresh, POLL_MS).unref();
  refresh();
}

function installAndRelaunch(userData: string, staged: StagedUpdate): void {
  const cur = bundleOf(process.execPath);
  if (!cur) throw new Error('Not running from an .app bundle');
  const dir = updateDir(userData);
  const log = fs.openSync(path.join(dir, 'swap.log'), 'a');
  const backup = path.join(dir, 'previous', path.basename(cur));
  spawn('/bin/bash', ['-c', SWAP_SCRIPT, 'ncw-swap', String(process.pid), cur, staged.appPath, backup, stagedManifest(userData)], {
    detached: true,
    stdio: ['ignore', log, log],
  }).unref();
  // Same path Notion takes before a real update: lets its quit logic close windows instead of hiding them.
  nativeUpdater.emit('before-quit-for-update');
  app.quit();
  setTimeout(() => app.exit(0), 5000).unref();
}
