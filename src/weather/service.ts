import { fetchHourlyForecast, MAX_FORECAST_DAYS, MAX_PAST_DAYS, searchLocations } from './openMeteo.ts';
import type { FetchLike } from './openMeteo.ts';
import { isUnits, parseLocation, MemoryStore } from './settingsStore.ts';
import type { SettingsStore } from './settingsStore.ts';
import { WeatherError } from './types.ts';
import type { ForecastRequest, ForecastResult, Location, Units, WeatherSettings } from './types.ts';

export interface WeatherServiceOptions {
  fetch?: FetchLike;
  store?: SettingsStore;
  now?: () => number;
  /** How long a cached forecast is considered fresh. */
  ttlMs?: number;
  /** How long a cached forecast may be served when a refresh fails. */
  maxStaleMs?: number;
}

interface CacheEntry {
  fetchedAt: number;
  result: Omit<ForecastResult, 'stale'>;
}

function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

const clampInt = (v: unknown, fallback: number, min: number, max: number): number => {
  if (v === undefined) return fallback;
  if (typeof v !== 'number' || !Number.isInteger(v)) throw new WeatherError('invalid-input', 'Day counts must be integers');
  return Math.min(max, Math.max(min, v));
};

export class WeatherService {
  private readonly fetchImpl: FetchLike;
  private readonly store: SettingsStore;
  private readonly now: () => number;
  private readonly ttlMs: number;
  private readonly maxStaleMs: number;
  private settings: WeatherSettings;
  private readonly cache = new Map<string, CacheEntry>();
  private readonly inflight = new Map<string, Promise<ForecastResult>>();

  constructor(opts: WeatherServiceOptions = {}) {
    this.fetchImpl = opts.fetch ?? (globalThis.fetch as unknown as FetchLike);
    this.store = opts.store ?? new MemoryStore();
    this.now = opts.now ?? Date.now;
    this.ttlMs = opts.ttlMs ?? 30 * 60_000;
    this.maxStaleMs = opts.maxStaleMs ?? 24 * 60 * 60_000;
    this.settings = this.store.load();
  }

  getSettings(): WeatherSettings {
    return { ...this.settings };
  }

  /** A manual choice is remembered and never overridden by auto-detection. Passing null clears it. */
  setLocation(input: unknown): WeatherSettings {
    const location = input === null ? null : parseLocation(input);
    if (input !== null && !location) throw new WeatherError('invalid-input', 'Invalid location');
    return this.update({ location, locationSource: location ? 'manual' : null, autoTimeZone: null });
  }

  /**
   * Derive a location from the calendar's IANA time zone: search for the zone's city name and
   * keep the hit whose own time zone matches exactly (so "London" in Europe/London beats
   * London, Ontario). Skipped when the user chose manually or the zone hasn't changed.
   */
  async autoLocate(timeZone: unknown): Promise<WeatherSettings> {
    if (typeof timeZone !== 'string' || !isValidTimeZone(timeZone)) throw new WeatherError('invalid-input', 'Invalid time zone');
    const { locationSource, location, autoTimeZone } = this.settings;
    if (locationSource === 'manual') return this.getSettings();
    if (location && autoTimeZone === timeZone) return this.getSettings();

    const city = (timeZone.split('/').pop() ?? '').replace(/_/g, ' ');
    if (city.length < 2) throw new WeatherError('not-found', `No city in time zone ${timeZone}`);
    const hits = await searchLocations(city, this.fetchImpl, 10);
    const match = hits.find((h) => h.timezone === timeZone);
    if (!match) throw new WeatherError('not-found', `Couldn't derive a location from time zone ${timeZone}`);
    return this.update({ location: match, locationSource: 'auto', autoTimeZone: timeZone });
  }

  setUnits(input: unknown): WeatherSettings {
    if (!isUnits(input)) throw new WeatherError('invalid-input', 'Units must be "metric" or "imperial"');
    return this.update({ units: input });
  }

  searchLocations(query: unknown): Promise<Location[]> {
    if (typeof query !== 'string') throw new WeatherError('invalid-input', 'Query must be a string');
    return searchLocations(query, this.fetchImpl);
  }

  async getForecast(request: ForecastRequest = {}): Promise<ForecastResult> {
    const { location, units } = this.settings;
    if (!location) throw new WeatherError('not-configured', 'No weather location set');
    const pastDays = clampInt(request.pastDays, 7, 0, MAX_PAST_DAYS);
    const forecastDays = clampInt(request.forecastDays, MAX_FORECAST_DAYS, 1, MAX_FORECAST_DAYS);
    const key = `${location.latitude.toFixed(3)},${location.longitude.toFixed(3)}|${units}|${pastDays}|${forecastDays}`;

    const cached = this.cache.get(key);
    if (cached && this.now() - cached.fetchedAt < this.ttlMs) return { ...cached.result, stale: false };

    // De-duplicate concurrent refreshes (the page may ask repeatedly while scrolling).
    const pending = this.inflight.get(key);
    if (pending) return pending;

    const run = this.refresh(key, { location, units, pastDays, forecastDays }, cached).finally(() => this.inflight.delete(key));
    this.inflight.set(key, run);
    return run;
  }

  private async refresh(
    key: string,
    opts: { location: Location; units: Units; pastDays: number; forecastDays: number },
    cached: CacheEntry | undefined,
  ): Promise<ForecastResult> {
    try {
      const hours = await fetchHourlyForecast(opts, this.fetchImpl);
      const fetchedAt = this.now();
      const result = { location: opts.location, units: opts.units, fetchedAt, hours };
      this.cache.set(key, { fetchedAt, result });
      return { ...result, stale: false };
    } catch (err) {
      if (cached && this.now() - cached.fetchedAt < this.maxStaleMs) return { ...cached.result, stale: true };
      throw err;
    }
  }

  private update(patch: Partial<WeatherSettings>): WeatherSettings {
    this.settings = { ...this.settings, ...patch };
    this.store.save(this.settings);
    return this.getSettings();
  }
}
