import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { bundleOf, findStagedUpdate, rewriteUpdateMessage, stagedManifest, updateDir } from '../src/weather/updater.ts';
import type { BuildInfo, StagedUpdate } from '../src/weather/updater.ts';

const current: BuildInfo = { notionVersion: '1.144.0', weatherRev: 'aaa', buildId: 'b1', builtAt: '2026-11-16T10:00:00.000Z' };

function stage(userData: string, over: Partial<StagedUpdate> = {}, appPath = path.join(updateDir(userData), 'staged', 'X.app')) {
  fs.mkdirSync(updateDir(userData), { recursive: true });
  fs.mkdirSync(path.join(appPath, 'Contents/Resources'), { recursive: true });
  fs.writeFileSync(path.join(appPath, 'Contents/Resources/ncw-build.json'), '{}');
  const s = { notionVersion: '1.145.0', weatherRev: 'bbb', buildId: 'b2', builtAt: '2026-11-17T10:00:00.000Z', appPath, ...over };
  fs.writeFileSync(stagedManifest(userData), JSON.stringify(s));
  return s;
}
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'ncw-upd-'));

test('offers a newer staged build', () => {
  const u = tmp();
  const s = stage(u);
  assert.equal(findStagedUpdate(u, current)?.buildId, s.buildId);
});

test('no manifest, same build, or older build → nothing offered', () => {
  const u = tmp();
  assert.equal(findStagedUpdate(u, current), null);
  stage(u, { buildId: 'b1' });
  assert.equal(findStagedUpdate(u, current), null);
  stage(u, { builtAt: '2026-11-15T00:00:00.000Z' });
  assert.equal(findStagedUpdate(u, current), null);
});

test('refuses a staged app outside the update dir', () => {
  const u = tmp();
  stage(u, {}, path.join(u, 'elsewhere', 'X.app'));
  assert.equal(findStagedUpdate(u, current), null);
  stage(u, { appPath: path.join(updateDir(u), '..', 'evil', 'X.app') });
  assert.equal(findStagedUpdate(u, current), null);
});

test('rewrites Notion updater messages', () => {
  const s = { notionVersion: '1.145.0' } as StagedUpdate;
  assert.deepEqual(rewriteUpdateMessage('cronUpdateError', [new Error('no yml')], null), ['cronUpdateNotAvailable', []]);
  assert.deepEqual(rewriteUpdateMessage('cronCheckingForUpdate', [], null), ['cronCheckingForUpdate', []]);
  assert.deepEqual(rewriteUpdateMessage('cronUpdateError', [], s), ['cronUpdateDownloaded', ['1.145.0', false]]);
  assert.deepEqual(rewriteUpdateMessage('cronUpdateNotAvailable', [], s), ['cronUpdateDownloaded', ['1.145.0', false]]);
  assert.deepEqual(rewriteUpdateMessage('cronBeforeQuitForUpdate', [], s), ['cronBeforeQuitForUpdate', []]);
  assert.deepEqual(rewriteUpdateMessage('somethingElse', [1], s), ['somethingElse', [1]]);
});

test('bundleOf finds the .app', () => {
  assert.equal(bundleOf('/Users/x/Applications/A B.app/Contents/MacOS/A B'), '/Users/x/Applications/A B.app');
  assert.equal(bundleOf('/usr/local/bin/node'), null);
});
