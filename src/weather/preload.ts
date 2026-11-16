import { CHANNELS, API_GLOBAL } from './channels.ts';
import { WeatherError } from './types.ts';
import type { IpcResult, WeatherApi } from './types.ts';

interface ContextBridgeLike {
  exposeInMainWorld(key: string, api: unknown): void;
}
interface IpcRendererLike {
  invoke(channel: string, ...args: unknown[]): Promise<unknown>;
}

/** Build the page-facing API: unwraps IPC envelopes, rejecting with a WeatherError on failure. */
export function createWeatherApi(ipcRenderer: IpcRendererLike): WeatherApi {
  const call = async <T>(channel: string, ...args: unknown[]): Promise<T> => {
    const res = (await ipcRenderer.invoke(channel, ...args)) as IpcResult<T>;
    if (!res.ok) throw new WeatherError(res.error.code, res.error.message);
    return res.data;
  };
  return {
    getSettings: () => call(CHANNELS.getSettings),
    setLocation: (location) => call(CHANNELS.setLocation, location),
    setUnits: (units) => call(CHANNELS.setUnits, units),
    autoLocate: (timeZone) => call(CHANNELS.autoLocate, timeZone),
    searchLocations: (query) => call(CHANNELS.searchLocations, query),
    getForecast: (request) => call(CHANNELS.getForecast, request),
  };
}

export function exposeWeatherApi(contextBridge: ContextBridgeLike, ipcRenderer: IpcRendererLike): void {
  contextBridge.exposeInMainWorld(API_GLOBAL, createWeatherApi(ipcRenderer));
}
