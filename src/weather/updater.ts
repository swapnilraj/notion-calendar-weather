// In-app half of the update flow. scripts/update.mjs downloads a new Notion Calendar release,
// verifies it, rebuilds the patched copy and *stages* it under <userData>/update. This module
// notices the staged build and surfaces it through Notion's own "Restart to update" prompt:
//
//  - Notion's main process reports updater state to the page with webContents.send('cronUpdate…').
//    In the copy its updater has no feed, so we rewrite those messages: "downloaded" when a staged
//    build is waiting, "not available" instead of the feed error otherwise.
//  - The prompt's button invokes 'cronQuitAndInstallUpdate'. We replace that handler with one that
//    quits, swaps the staged .app into place (via a detached helper) and relaunches.
//
// This file holds the pure logic; src/entry/updaterGlue.ts wires it to Electron.
import fs from 'node:fs';
import path from 'node:path';

export interface BuildInfo {
  notionVersion: string;
  weatherRev: string;
  buildId: string;
  builtAt: string;
}

export interface StagedUpdate extends BuildInfo {
  /** Absolute path of the staged, already patched and signed .app. */
  appPath: string;
}

/** Notion's updater → page channels (see `Z` in Notion's main bundle). */
export const NOTION_UPDATE_CHANNELS = {
  error: 'cronUpdateError',
  checking: 'cronCheckingForUpdate',
  available: 'cronUpdateAvailable',
  notAvailable: 'cronUpdateNotAvailable',
  downloaded: 'cronUpdateDownloaded',
  beforeQuit: 'cronBeforeQuitForUpdate',
} as const;
export const NOTION_INSTALL_CHANNEL = 'cronQuitAndInstallUpdate';

const REWRITABLE = new Set<string>([
  NOTION_UPDATE_CHANNELS.error,
  NOTION_UPDATE_CHANNELS.checking,
  NOTION_UPDATE_CHANNELS.available,
  NOTION_UPDATE_CHANNELS.notAvailable,
  NOTION_UPDATE_CHANNELS.downloaded,
]);

export const updateDir = (userData: string) => path.join(userData, 'update');
export const stagedManifest = (userData: string) => path.join(updateDir(userData), 'staged.json');

function isBuildInfo(v: unknown): v is BuildInfo {
  const o = v as Record<string, unknown> | null;
  return !!o && typeof o.notionVersion === 'string' && typeof o.weatherRev === 'string' && typeof o.buildId === 'string';
}

export function readBuildInfo(file: string): BuildInfo | null {
  try {
    const v = JSON.parse(fs.readFileSync(file, 'utf8'));
    return isBuildInfo(v) ? v : null;
  } catch {
    return null;
  }
}

/**
 * The staged update to offer, or null. Only offered when it is a different build from the one
 * running, and the staged .app really is inside our update dir (never trust a path elsewhere).
 */
export function findStagedUpdate(userData: string, current: BuildInfo | null): StagedUpdate | null {
  let staged: unknown;
  try {
    staged = JSON.parse(fs.readFileSync(stagedManifest(userData), 'utf8'));
  } catch {
    return null;
  }
  if (!isBuildInfo(staged) || typeof (staged as StagedUpdate).appPath !== 'string') return null;
  const s = staged as StagedUpdate;
  const dir = updateDir(userData) + path.sep;
  const appPath = path.resolve(s.appPath);
  if (!appPath.startsWith(dir) || !appPath.endsWith('.app')) return null;
  if (!fs.existsSync(path.join(appPath, 'Contents/Resources/ncw-build.json'))) return null;
  if (current && current.buildId === s.buildId) return null;
  // A manual `npm run build` after staging makes the staged copy older than what's running.
  if (current && s.builtAt && current.builtAt && s.builtAt < current.builtAt) return null;
  return { ...s, appPath };
}

/** What the page should be told instead of what Notion's (feedless) updater is about to send. */
export function rewriteUpdateMessage(channel: string, args: unknown[], staged: StagedUpdate | null): [string, unknown[]] {
  if (!REWRITABLE.has(channel)) return [channel, args];
  if (staged) return [NOTION_UPDATE_CHANNELS.downloaded, [staged.notionVersion, false]];
  if (channel === NOTION_UPDATE_CHANNELS.error) return [NOTION_UPDATE_CHANNELS.notAvailable, []];
  return [channel, args];
}

/** The .app bundle that contains this process's executable (…/X.app/Contents/MacOS/bin). */
export function bundleOf(execPath: string): string | null {
  const app = path.resolve(execPath, '../../..');
  return app.endsWith('.app') ? app : null;
}

/**
 * Bash run detached after the app quits: wait for the old process, verify the staged copy,
 * swap it in (keeping the previous build as a fallback) and relaunch. Always relaunches something.
 * Args: $1 pid, $2 current .app, $3 staged .app, $4 backup .app, $5 staged manifest.
 */
export const SWAP_SCRIPT = `
pid="$1"; cur="$2"; staged="$3"; backup="$4"; manifest="$5"
echo "[$(date -u +%FT%TZ)] swap: waiting for pid $pid"
for _ in $(seq 1 300); do kill -0 "$pid" 2>/dev/null || break; sleep 0.1; done
if kill -0 "$pid" 2>/dev/null; then echo "old process still running; giving up"; exit 1; fi
if ! codesign --verify --deep --strict "$staged"; then echo "staged build failed verification"; open "$cur"; exit 1; fi
rm -rf "$backup"; mkdir -p "$(dirname "$backup")"
if mv "$cur" "$backup" && mv "$staged" "$cur"; then
  rm -f "$manifest"; echo "swapped in $cur"
else
  echo "swap failed; restoring"; [ -d "$cur" ] || mv "$backup" "$cur"
fi
open "$cur"
`;
