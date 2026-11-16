import test from 'node:test';
import assert from 'node:assert/strict';
import { localDate, summarizeDays } from '../src/weather/summary.ts';
import { parseHourly } from '../src/weather/openMeteo.ts';
import { hourlyBody, T0 } from './helpers.ts';

const hoursOf = (n: number, f?: Parameters<typeof hourlyBody>[1]) => parseHourly(hourlyBody(n, f));

test('localDate respects the calendar time zone', () => {
  const lateUtc = Date.UTC(2026, 10, 17, 23) / 1000;
  assert.equal(localDate(lateUtc, 'UTC'), '2026-11-17');
  assert.equal(localDate(lateUtc, 'Asia/Singapore'), '2026-11-18'); // UTC+8
});

test('groups by day in tz and drops partial edge days', () => {
  // 48h from 00:00Z: two whole UTC days.
  assert.deepEqual([...summarizeDays(hoursOf(48), 'UTC').keys()], ['2026-11-17', '2026-11-18']);
  // In Singapore (UTC+8) the same window is 16h of the 17th, all of the 18th, 8h of the 19th.
  assert.deepEqual([...summarizeDays(hoursOf(48), 'Asia/Singapore').keys()], ['2026-11-18']);
});

test('hi/lo come from the day hours', () => {
  const d = summarizeDays(hoursOf(24, (i) => ({ temp: i === 5 ? 2 : i === 14 ? 13 : 7 })), 'UTC').get('2026-11-17')!;
  assert.equal(d.tempMax, 13);
  assert.equal(d.tempMin, 2);
});

test('the most severe lasting condition wins; a single wet hour does not', () => {
  const rainy = summarizeDays(hoursOf(24, (i) => ({ code: i >= 10 && i < 13 ? 63 : 3, day: 1 })), 'UTC').get('2026-11-17')!;
  assert.equal(rainy.condition, 'rain'); // 3 daytime hours of rain beat the cloud
  const oneHour = summarizeDays(hoursOf(24, (i) => ({ code: i === 11 ? 63 : 3, day: 1 })), 'UTC').get('2026-11-17')!;
  assert.equal(oneHour.condition, 'cloudy');
  const storm = summarizeDays(hoursOf(24, (i) => ({ code: i === 11 ? 95 : 0, day: 1 })), 'UTC').get('2026-11-17')!;
  assert.equal(storm.condition, 'thunderstorm'); // one hour of thunder is enough
});

test('rain chance is the daily max, null when unknown', () => {
  const d = summarizeDays(hoursOf(24, (i) => ({ precip: i === 20 ? 85 : 5 })), 'UTC').get('2026-11-17')!;
  assert.equal(d.precipProbability, 85);
  const none = summarizeDays(hoursOf(24, () => ({ precip: null })), 'UTC').get('2026-11-17')!;
  assert.equal(none.precipProbability, null);
});

test('T0 sanity', () => assert.equal(localDate(T0, 'UTC'), '2026-11-17'));
