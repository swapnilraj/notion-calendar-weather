/** Offset (ms) of `tz` from UTC at the instant `utcMs`. */
export function tzOffsetMs(utcMs: number, tz: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(utcMs));
  const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return asUtc - Math.floor(utcMs / 1000) * 1000;
}

/** Epoch ms of the wall-clock time `YYYY-MM-DD hour:00` in timezone `tz` (DST-safe). */
export function zonedToEpochMs(date: string, hour: number, tz: string): number {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const guess = Date.UTC(y, m - 1, d, hour);
  const first = guess - tzOffsetMs(guess, tz);
  return guess - tzOffsetMs(first, tz);
}

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

/**
 * Calendar date (YYYY-MM-DD) of a column. Notion's `data-grid-date` is *local midnight in the calendar's
 * time zone*, not UTC midnight (they only coincide on GMT; in Amsterdam Friday is stamped Thu 23:00Z).
 * If the stamp is exactly midnight in `tz` (the usual case: calendar zone = system zone) that's exact;
 * otherwise fall back to the UTC date at stamp + 12h, which is right for any zone from UTC-11 to UTC+12.
 */
export function gridDateToIso(epochMs: number | string, tz = Intl.DateTimeFormat().resolvedOptions().timeZone): string {
  const ms = Number(epochMs);
  const wall = ms + tzOffsetMs(ms, tz);
  if (wall % DAY_MS === 0) return new Date(wall).toISOString().slice(0, 10);
  return new Date(ms + 12 * HOUR_MS).toISOString().slice(0, 10);
}
