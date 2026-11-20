import test from 'node:test';
import assert from 'node:assert/strict';
import { buildGradient, geometryFromLines } from '../src/ui/gradient.ts';
import { tintFor, luminance } from '../src/ui/tint.ts';
import { gridDateToIso, zonedToEpochMs } from '../src/ui/time.ts';

const clear = { condition: 'clear', precipProbability: 0, precipMm: null, isDay: true, tempC: 17 } as const;

test('geometry from Notion hour lines (first line at 122, step 48 => offset 74)', () => {
  assert.deepEqual(geometryFromLines([218, 122, 170]), { offsetPx: 74, hourPx: 48 });
  assert.equal(geometryFromLines([10]), null);
});

test('buildGradient places 25 stops on the hour lines', () => {
  const t = tintFor(clear, 'dark');
  const css = buildGradient(Array(25).fill(t), { offsetPx: 74, hourPx: 48 });
  assert.match(css, /^linear-gradient\(in oklab to bottom, /);
  assert.equal(css.match(/px/g)!.length, 25);
  assert.ok(css.includes(' 74px'));
  assert.ok(css.includes(' 1226px')); // 74 + 24*48
  assert.throws(() => buildGradient([t], { offsetPx: 0, hourPx: 48 }));
});

test('rain strength scales with precipitation probability; night shifts blue', () => {
  const rain = (p: number) => tintFor({ condition: 'rain', precipProbability: p, precipMm: null, isDay: true, tempC: 10 }, 'dark').a;
  assert.ok(rain(10) < rain(50) && rain(50) < rain(100));
  const day = tintFor(clear, 'dark');
  const night = tintFor({ ...clear, isDay: false }, 'dark');
  assert.ok(night.b > night.r && day.r > day.b);
});

test('every tint stays subtle (alpha <= 0.3) in both themes', () => {
  for (const condition of ['clear', 'partly-cloudy', 'cloudy', 'fog', 'drizzle', 'rain', 'snow', 'thunderstorm', 'unknown'] as const)
    for (const theme of ['dark', 'light'] as const)
      for (const isDay of [true, false]) for (const tempC of [-10, 10, 40]) assert.ok(tintFor({ condition, precipProbability: 100, precipMm: 20, isDay, tempC }, theme).a <= 0.3);
});

test('luminance distinguishes dark and light backgrounds', () => {
  assert.ok(luminance('rgb(25, 25, 25)')! < 0.05);
  assert.ok(luminance('rgb(255, 255, 255)')! > 0.9);
  assert.equal(luminance('transparent'), null);
});

test('grid date and timezone helpers', () => {
  assert.equal(gridDateToIso(Date.UTC(2026, 10, 17), 'Europe/London'), '2026-11-17');
  // Notion stamps columns with local midnight of the calendar's zone, which is not UTC midnight
  assert.equal(gridDateToIso(Date.UTC(2026, 10, 19, 23), 'Europe/Amsterdam'), '2026-11-20');
  assert.equal(gridDateToIso(Date.UTC(2026, 6, 16, 23), 'Europe/London'), '2026-07-17'); // BST
  assert.equal(gridDateToIso(Date.UTC(2026, 10, 19, 16), 'Asia/Singapore'), '2026-11-20');
  assert.equal(gridDateToIso(Date.UTC(2026, 10, 20, 5), 'America/New_York'), '2026-11-20');
  assert.equal(gridDateToIso(Date.UTC(2026, 10, 19, 11), 'Pacific/Auckland'), '2026-11-20'); // UTC+13
  // calendar zone differs from the system zone: nearest-noon fallback still finds the right date
  assert.equal(gridDateToIso(Date.UTC(2026, 10, 19, 23), 'Europe/London'), '2026-11-20');
  assert.equal(gridDateToIso(Date.UTC(2026, 10, 20, 5), 'Europe/Amsterdam'), '2026-11-20');
  // London is UTC+0 in November, UTC+1 in summer; Singapore is always UTC+8
  assert.equal(zonedToEpochMs('2026-11-17', 9, 'Europe/London'), Date.UTC(2026, 10, 17, 9));
  assert.equal(zonedToEpochMs('2026-07-17', 9, 'Europe/London'), Date.UTC(2026, 6, 17, 8));
  assert.equal(zonedToEpochMs('2026-11-17', 9, 'Asia/Singapore'), Date.UTC(2026, 10, 17, 1));
  // spring-forward day: 02:30 doesn't exist, but 03:00 BST == 02:00 UTC
  assert.equal(zonedToEpochMs('2026-03-29', 3, 'Europe/London'), Date.UTC(2026, 2, 29, 2));
});
