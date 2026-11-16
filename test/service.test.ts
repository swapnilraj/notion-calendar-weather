import test from 'node:test';
import assert from 'node:assert/strict';
import { WeatherService } from '../src/weather/service.ts';
import { fakeFetch, forecastBody } from './helpers.ts';

const london = { name: 'London', latitude: 51.5, longitude: -0.12 };

function make(responses: Parameters<typeof fakeFetch>[0], t = { now: 1_000 }) {
  const f = fakeFetch(responses);
  const svc = new WeatherService({ fetch: f.fn, now: () => t.now, ttlMs: 1000, maxStaleMs: 10_000 });
  return { svc, f, t };
}

test('forecast requires a configured location', async () => {
  const { svc } = make([{ body: forecastBody }]);
  await assert.rejects(svc.getForecast(), { code: 'not-configured' });
});

test('caches within TTL and refetches after', async () => {
  const { svc, f, t } = make([{ body: forecastBody }]);
  svc.setLocation(london);
  await svc.getForecast();
  await svc.getForecast();
  assert.equal(f.calls.length, 1);
  t.now += 1001;
  await svc.getForecast();
  assert.equal(f.calls.length, 2);
});

test('settings changes (units) bypass the cache', async () => {
  const { svc, f } = make([{ body: forecastBody }]);
  svc.setLocation(london);
  await svc.getForecast();
  svc.setUnits('imperial');
  await svc.getForecast();
  assert.equal(f.calls.length, 2);
});

test('concurrent calls share one request', async () => {
  const { svc, f } = make([{ body: forecastBody }]);
  svc.setLocation(london);
  await Promise.all([svc.getForecast(), svc.getForecast(), svc.getForecast()]);
  assert.equal(f.calls.length, 1);
});

test('serves stale data when refresh fails, until maxStale', async () => {
  const { svc, t } = make([{ body: forecastBody }, { throws: true }]);
  svc.setLocation(london);
  await svc.getForecast();
  t.now += 2000;
  const stale = await svc.getForecast();
  assert.equal(stale.stale, true);
  t.now += 20_000;
  await assert.rejects(svc.getForecast(), { code: 'network' });
});

test('clamps day counts and rejects non-integers', async () => {
  const { svc, f } = make([{ body: forecastBody }]);
  svc.setLocation(london);
  await svc.getForecast({ pastDays: 500, forecastDays: 99 });
  assert.equal(f.calls[0]!.url.searchParams.get('past_days'), '92');
  assert.equal(f.calls[0]!.url.searchParams.get('forecast_days'), '16');
  await assert.rejects(svc.getForecast({ pastDays: 1.5 }), { code: 'invalid-input' });
});

test('validates location and units input', () => {
  const { svc } = make([]);
  assert.throws(() => svc.setLocation({ name: 'x', latitude: 999, longitude: 0 }), { code: 'invalid-input' });
  assert.throws(() => svc.setLocation('London'), { code: 'invalid-input' });
  assert.throws(() => svc.setUnits('kelvin'), { code: 'invalid-input' });
  assert.equal(svc.setLocation(null).location, null);
});

const searchBody = (tz: string) => ({
  results: [
    { name: 'London', latitude: 42.98, longitude: -81.23, country: 'Canada', admin1: 'Ontario', timezone: 'America/Toronto' },
    { name: 'London', latitude: 51.5085, longitude: -0.1257, country: 'United Kingdom', admin1: 'England', timezone: tz },
  ],
});

test('autoLocate derives the city from the time zone and matches on timezone, not rank', async () => {
  const { svc, f } = make([{ body: searchBody('Europe/London') }]);
  const s = await svc.autoLocate('Europe/London');
  assert.equal(s.location?.country, 'United Kingdom'); // not London, Ontario
  assert.equal(s.locationSource, 'auto');
  assert.equal(s.autoTimeZone, 'Europe/London');
  assert.equal(f.calls[0]!.url.searchParams.get('name'), 'London');
  await svc.autoLocate('Europe/London'); // unchanged zone => no second lookup
  assert.equal(f.calls.length, 1);
});

test('autoLocate handles multi-part zone names', async () => {
  const { svc, f } = make([{ body: { results: [{ name: 'Buenos Aires', latitude: -34.6, longitude: -58.4, timezone: 'America/Argentina/Buenos_Aires' }] } }]);
  await svc.autoLocate('America/Argentina/Buenos_Aires');
  assert.equal(f.calls[0]!.url.searchParams.get('name'), 'Buenos Aires');
});

test('autoLocate re-derives after the time zone changes, but never overrides a manual choice', async () => {
  const { svc, f } = make([{ body: searchBody('Europe/London') }, { body: { results: [{ name: 'Singapore', latitude: 1.29, longitude: 103.85, timezone: 'Asia/Singapore' }] } }]);
  await svc.autoLocate('Europe/London');
  const moved = await svc.autoLocate('Asia/Singapore');
  assert.equal(moved.location?.name, 'Singapore');
  assert.equal(f.calls.length, 2);

  svc.setLocation({ name: 'Paris', latitude: 48.85, longitude: 2.35 });
  const kept = await svc.autoLocate('Europe/London');
  assert.equal(kept.location?.name, 'Paris');
  assert.equal(kept.locationSource, 'manual');
  assert.equal(f.calls.length, 2); // no lookup at all
});

test('autoLocate errors are typed', async () => {
  const { svc } = make([{ body: { results: [] } }]);
  await assert.rejects(svc.autoLocate('Not/AZone'), { code: 'invalid-input' });
  await assert.rejects(svc.autoLocate(42), { code: 'invalid-input' });
  await assert.rejects(svc.autoLocate('Europe/London'), { code: 'not-found' });
  await assert.rejects(svc.autoLocate('UTC'), { code: 'not-found' }); // no city in the zone name
});
