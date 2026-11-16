import { describeWmoCode } from './wmo.ts';
import { WeatherError } from './types.ts';
import type { HourlyForecast, Location, Units } from './types.ts';

export type FetchLike = (url: string, init?: { signal?: AbortSignal }) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}>;

const GEOCODING_URL = 'https://geocoding-api.open-meteo.com/v1/search';
const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
const TIMEOUT_MS = 10_000;

export const MAX_PAST_DAYS = 92;
export const MAX_FORECAST_DAYS = 16;

async function getJson(fetchImpl: FetchLike, url: string): Promise<unknown> {
  let res;
  try {
    res = await fetchImpl(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (cause) {
    throw new WeatherError('network', 'Could not reach the weather service', { cause });
  }
  if (!res.ok) throw new WeatherError('network', `Weather service returned HTTP ${res.status}`);
  try {
    return await res.json();
  } catch (cause) {
    throw new WeatherError('bad-response', 'Weather service returned invalid JSON', { cause });
  }
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

export async function searchLocations(query: string, fetchImpl: FetchLike, count = 5): Promise<Location[]> {
  const q = query.trim();
  if (q.length < 2) throw new WeatherError('invalid-input', 'Search query is too short');
  const url = `${GEOCODING_URL}?${new URLSearchParams({ name: q, count: String(count), language: 'en', format: 'json' })}`;
  const body = await getJson(fetchImpl, url);
  if (!isRecord(body)) throw new WeatherError('bad-response', 'Unexpected geocoding response');
  if (body.results === undefined) return []; // Open-Meteo omits `results` when nothing matches
  if (!Array.isArray(body.results)) throw new WeatherError('bad-response', 'Unexpected geocoding response');

  const out: Location[] = [];
  for (const r of body.results) {
    if (!isRecord(r) || typeof r.name !== 'string') continue;
    if (typeof r.latitude !== 'number' || typeof r.longitude !== 'number') continue;
    out.push({
      name: r.name,
      latitude: r.latitude,
      longitude: r.longitude,
      ...(typeof r.admin1 === 'string' && { admin1: r.admin1 }),
      ...(typeof r.country === 'string' && { country: r.country }),
      ...(typeof r.timezone === 'string' && { timezone: r.timezone }),
    });
  }
  return out;
}

export interface FetchForecastOptions {
  location: Location;
  units: Units;
  pastDays: number;
  forecastDays: number;
}

/**
 * Hourly forecast as exact UTC instants (`timezone=GMT` + unix timestamps). Mapping to the
 * calendar's days/hours happens on the client, in whatever time zone the calendar displays.
 */
export async function fetchHourlyForecast(opts: FetchForecastOptions, fetchImpl: FetchLike): Promise<HourlyForecast[]> {
  const { location, units, pastDays, forecastDays } = opts;
  const params = new URLSearchParams({
    latitude: String(location.latitude),
    longitude: String(location.longitude),
    hourly: 'temperature_2m,weather_code,precipitation_probability,precipitation,is_day',
    timezone: 'GMT',
    timeformat: 'unixtime',
    past_days: String(pastDays),
    forecast_days: String(forecastDays),
    temperature_unit: units === 'imperial' ? 'fahrenheit' : 'celsius',
  });
  return parseHourly(await getJson(fetchImpl, `${FORECAST_URL}?${params}`));
}

export function parseHourly(body: unknown): HourlyForecast[] {
  const hourly = isRecord(body) ? body.hourly : undefined;
  if (!isRecord(hourly)) throw new WeatherError('bad-response', 'Forecast response has no hourly data');
  const { time, temperature_2m, weather_code, precipitation_probability, precipitation, is_day } = hourly;
  if (!Array.isArray(time) || !Array.isArray(temperature_2m) || !Array.isArray(weather_code)) {
    throw new WeatherError('bad-response', 'Forecast response is missing fields');
  }
  const precip = Array.isArray(precipitation_probability) ? precipitation_probability : [];
  const mmArr = Array.isArray(precipitation) ? precipitation : [];
  const day = Array.isArray(is_day) ? is_day : [];

  const hours: HourlyForecast[] = [];
  for (let i = 0; i < time.length; i++) {
    const t = time[i];
    const temp = temperature_2m[i];
    const code = weather_code[i];
    // Open-Meteo can return null at the far end of the range; skip incomplete hours.
    if (typeof t !== 'number' || typeof temp !== 'number' || typeof code !== 'number') continue;
    const p = precip[i];
    const mm = mmArr[i];
    hours.push({
      time: t,
      code,
      ...describeWmoCode(code),
      temp: Math.round(temp),
      precipProbability: typeof p === 'number' ? p : null,
      precipMm: typeof mm === 'number' ? mm : null,
      isDay: day[i] === 1,
    });
  }
  return hours;
}
