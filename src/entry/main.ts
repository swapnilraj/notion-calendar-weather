// Appended to Notion Calendar's main process bundle by scripts/build.mjs.
// Must never throw: a weather failure must not take the host app down.
import { app, ipcMain } from 'electron';
import { registerWeatherIpc } from '../weather/main.ts';
import { startUpdater } from './updaterGlue.ts';

try {
  registerWeatherIpc(ipcMain, app);
} catch (err) {
  console.error('[weather] failed to start', err);
}
try {
  startUpdater();
} catch (err) {
  console.error('[weather] updater failed to start', err);
}
