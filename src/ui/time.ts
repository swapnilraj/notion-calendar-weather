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

/** Notion's `data-grid-date` is UTC midnight of the calendar date shown in the column. */
export const gridDateToIso = (epochMs: number | string): string => new Date(Number(epochMs)).toISOString().slice(0, 10);
