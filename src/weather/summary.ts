import { CONDITION_LABEL, SEVERITY } from './wmo.ts';
import type { Condition, DaySummary, HourlyForecast } from './types.ts';

const formatters = new Map<string, Intl.DateTimeFormat>();

/** YYYY-MM-DD of the instant `epochSec` in time zone `tz`. */
export function localDate(epochSec: number, tz: string): string {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' });
    formatters.set(tz, f);
  }
  return f.format(new Date(epochSec * 1000));
}

/** A day with fewer hours than this is at the edge of the data and would give misleading hi/lo. */
const MIN_HOURS = 20;

/**
 * Condense hourly data into per-day summaries for the days of time zone `tz`.
 * The representative condition favours what you'd notice: the most severe condition that
 * lasts at least two daytime hours (one is enough for thunderstorms), else the most common.
 */
export function summarizeDays(hours: readonly HourlyForecast[], tz: string): Map<string, DaySummary> {
  const byDate = new Map<string, HourlyForecast[]>();
  for (const h of hours) {
    const d = localDate(h.time, tz);
    const list = byDate.get(d);
    if (list) list.push(h);
    else byDate.set(d, [h]);
  }

  const out = new Map<string, DaySummary>();
  for (const [date, list] of byDate) {
    if (list.length < MIN_HOURS) continue;
    const daytime = list.filter((h) => h.isDay);
    const basis = daytime.length >= 3 ? daytime : list;

    const counts = new Map<Condition, number>();
    for (const h of basis) counts.set(h.condition, (counts.get(h.condition) ?? 0) + 1);
    const entries = [...counts.entries()];
    const notable = entries.filter(([c, n]) => n >= 2 || (c === 'thunderstorm' && n >= 1));
    const pool = notable.length ? notable : entries;
    const [condition] = pool.reduce((best, cur) => {
      const [bc, bn] = best;
      const [cc, cn] = cur;
      if (notable.length) return SEVERITY[cc] > SEVERITY[bc] ? cur : best;
      return cn > bn ? cur : best;
    });

    const probs = list.map((h) => h.precipProbability).filter((p): p is number => p !== null);
    out.set(date, {
      date,
      condition,
      label: CONDITION_LABEL[condition],
      tempMax: Math.max(...list.map((h) => h.temp)),
      tempMin: Math.min(...list.map((h) => h.temp)),
      precipProbability: probs.length ? Math.max(...probs) : null,
    });
  }
  return out;
}
