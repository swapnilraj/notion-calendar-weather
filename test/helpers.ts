import type { FetchLike } from '../src/weather/openMeteo.ts';

export interface Call {
  url: URL;
}

/** Fake fetch: returns queued responses in order, records calls. */
export function fakeFetch(responses: Array<{ status?: number; body?: unknown; throws?: boolean }>) {
  const calls: Call[] = [];
  let i = 0;
  const fn: FetchLike = async (url) => {
    calls.push({ url: new URL(url) });
    const r = responses[Math.min(i++, responses.length - 1)]!;
    if (r.throws) throw new TypeError('fetch failed');
    const status = r.status ?? 200;
    return { ok: status >= 200 && status < 300, status, json: async () => r.body };
  };
  return { fn, calls };
}

export const T0 = Date.UTC(2026, 10, 17) / 1000; // 2026-11-17T00:00Z

/** Build an Open-Meteo-style hourly body: `n` hours from T0 with a pattern per hour index. */
export function hourlyBody(n: number, f: (i: number) => { temp?: number | null; code?: number; precip?: number | null; mm?: number | null; day?: 0 | 1 } = () => ({})) {
  const rows = Array.from({ length: n }, (_, i) => ({ temp: 5 + (i % 10), code: 3, precip: 10, mm: 0, day: (i % 24 >= 8 && i % 24 < 16 ? 1 : 0) as 0 | 1, ...f(i) }));
  return {
    hourly: {
      time: rows.map((_, i) => T0 + i * 3600),
      temperature_2m: rows.map((r) => r.temp),
      weather_code: rows.map((r) => r.code),
      precipitation_probability: rows.map((r) => r.precip),
      precipitation: rows.map((r) => r.mm),
      is_day: rows.map((r) => r.day),
    },
  };
}

export const forecastBody = hourlyBody(48);
