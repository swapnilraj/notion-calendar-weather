import path from 'node:path';
import { CHANNELS, TRUSTED_ORIGINS } from './channels.ts';
import { FileStore } from './settingsStore.ts';
import { WeatherService } from './service.ts';
import { WeatherError } from './types.ts';
import type { IpcResult } from './types.ts';

/** The subset of Electron's `ipcMain` / `app` we use (keeps this file testable without Electron). */
export interface IpcMainLike {
  handle(channel: string, listener: (event: IpcEventLike, ...args: unknown[]) => unknown): void;
}
export interface IpcEventLike {
  senderFrame?: { url: string } | null;
}
export interface AppLike {
  getPath(name: 'userData'): string;
}

export function isTrustedSender(event: IpcEventLike, trusted: readonly string[] = TRUSTED_ORIGINS): boolean {
  const url = event.senderFrame?.url;
  if (!url) return false;
  try {
    return trusted.includes(new URL(url).origin);
  } catch {
    return false;
  }
}

function toResult<T>(fn: () => T | Promise<T>): Promise<IpcResult<T>> {
  return Promise.resolve()
    .then(fn)
    .then(
      (data): IpcResult<T> => ({ ok: true, data }),
      (err: unknown): IpcResult<T> => {
        if (err instanceof WeatherError) return { ok: false, error: { code: err.code, message: err.message } };
        console.error('[weather] unexpected error', err);
        return { ok: false, error: { code: 'internal', message: 'Unexpected weather error' } };
      },
    );
}

export function registerWeatherIpc(
  ipcMain: IpcMainLike,
  app: AppLike,
  service = new WeatherService({ store: new FileStore(path.join(app.getPath('userData'), 'weather-settings.json')) }),
): WeatherService {
  const handle = (channel: string, fn: (...args: unknown[]) => unknown) =>
    ipcMain.handle(channel, (event, ...args) => {
      if (!isTrustedSender(event)) {
        return { ok: false, error: { code: 'untrusted-sender', message: 'Origin not allowed' } } satisfies IpcResult<never>;
      }
      return toResult(() => fn(...args));
    });

  handle(CHANNELS.getSettings, () => service.getSettings());
  handle(CHANNELS.setLocation, (loc) => service.setLocation(loc));
  handle(CHANNELS.setUnits, (units) => service.setUnits(units));
  handle(CHANNELS.autoLocate, (tz) => service.autoLocate(tz));
  handle(CHANNELS.searchLocations, (q) => service.searchLocations(q));
  handle(CHANNELS.getForecast, (req) => {
    if (req !== undefined && (typeof req !== 'object' || req === null)) throw new WeatherError('invalid-input', 'Bad request');
    return service.getForecast(req as object | undefined);
  });
  return service;
}
