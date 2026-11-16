// Appended to Notion Calendar's preload bundle by scripts/build.mjs.
// Runs in the (sandboxed) preload context; only `electron` can be required here.
// It must never throw: a weather failure must not break the host app.
import { contextBridge, ipcRenderer } from 'electron';
import { TRUSTED_ORIGINS } from '../weather/channels.ts';
import { createWeatherApi, exposeWeatherApi } from '../weather/preload.ts';
import { startWeatherUi } from '../ui/weatherLayer.ts';

try {
  exposeWeatherApi(contextBridge, ipcRenderer);
  if (TRUSTED_ORIGINS.includes(location.origin)) {
    const api = createWeatherApi(ipcRenderer);
    const go = () => startWeatherUi({ api });
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', go, { once: true });
    else go();
  }
} catch (err) {
  console.error('[weather] preload failed', err);
}
