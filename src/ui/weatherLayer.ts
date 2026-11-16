import { GradientController } from './grid.ts';
import { removeHeaderChips, renderHeaderChips } from './header.ts';
import { HoverScrubber } from './hover.ts';
import { toCelsius } from './bands.ts';
import type { DayHour } from './bands.ts';
import { zonedToEpochMs } from './time.ts';
import { summarizeDays } from '../weather/summary.ts';
import type { DaySummary, HourlyForecast, Units, WeatherApi } from '../weather/types.ts';

export interface WeatherUiOptions {
  api: WeatherApi;
  /** The calendar's display time zone. Defaults to the system zone (which Notion uses as primary). */
  timeZone?: string;
  /** How often to re-fetch (main process caches, so this is cheap). */
  refreshMs?: number;
}

const HOUR_S = 3600;

/** Wire real forecast data into the gradient, day-header chips and hover readout. Returns a stop function. */
export function startWeatherUi(opts: WeatherUiOptions): () => void {
  const { api } = opts;
  const tz = opts.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  let hours = new Map<number, HourlyForecast>();
  let summaries = new Map<string, DaySummary>();
  let units: Units = 'metric';

  /** Hour `h` (0-24) of calendar date `iso` in the calendar's time zone. */
  const hourAt = (iso: string, h: number): HourlyForecast | undefined => {
    const sec = Math.round(zonedToEpochMs(iso, h, tz) / 1000 / HOUR_S) * HOUR_S;
    return hours.get(sec);
  };

  const samplesFor = (iso: string): DayHour[] | null => {
    const samples: Array<HourlyForecast | undefined> = Array.from({ length: 25 }, (_, h) => hourAt(iso, h));
    if (samples.every((s) => !s)) return null;
    // Fill gaps at the data edges with the nearest known hour so the gradient stays continuous.
    for (let i = 1; i < samples.length; i++) samples[i] ??= samples[i - 1];
    for (let i = samples.length - 2; i >= 0; i--) samples[i] ??= samples[i + 1];
    return samples.map((s) => ({ condition: s!.condition, precipProbability: s!.precipProbability, precipMm: s!.precipMm, isDay: s!.isDay, tempC: toCelsius(s!.temp, units) }));
  };

  const gradients = new GradientController(samplesFor, () => renderHeaderChips((iso) => summaries.get(iso) ?? null));
  const hover = new HoverScrubber((iso, h) => hourAt(iso, h), () => units);

  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  const refreshMs = opts.refreshMs ?? 15 * 60_000;

  async function load(): Promise<void> {
    let delay = refreshMs;
    try {
      let settings = await api.getSettings();
      // Derive the location from the calendar's time zone unless the user picked one.
      if (settings.locationSource !== 'manual' && (!settings.location || settings.autoTimeZone !== tz)) settings = await api.autoLocate(tz);
      if (settings.location) {
        const forecast = await api.getForecast({ pastDays: 14, forecastDays: 16 });
        units = forecast.units;
        hours = new Map(forecast.hours.map((h) => [h.time, h]));
        summaries = summarizeDays(forecast.hours, tz);
        gradients.invalidate();
      }
    } catch (err) {
      console.warn('[weather] refresh failed, retrying soon', err);
      delay = 60_000;
    }
    if (!stopped) timer = setTimeout(load, delay);
  }

  const onVisible = () => {
    if (document.visibilityState === 'visible') {
      clearTimeout(timer);
      void load();
    }
  };

  gradients.start();
  hover.start();
  document.addEventListener('visibilitychange', onVisible);
  void load();

  return () => {
    stopped = true;
    clearTimeout(timer);
    document.removeEventListener('visibilitychange', onVisible);
    gradients.stop();
    hover.stop();
    removeHeaderChips();
  };
}
