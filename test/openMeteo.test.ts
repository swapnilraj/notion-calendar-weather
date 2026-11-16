import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchHourlyForecast, parseHourly, searchLocations } from '../src/weather/openMeteo.ts';
import { fakeFetch, hourlyBody, T0 } from './helpers.ts';

test('parseHourly maps fields, rounds temps and skips incomplete hours', () => {
  const body = hourlyBody(4, (i) => (i === 0 ? { temp: 11.6, code: 61, precip: 80, mm: 1.4, day: 1 } : i === 2 ? { temp: null } : {}));
  const hours = parseHourly(body);
  assert.equal(hours.length, 3); // hour 2 has a null temperature
  assert.deepEqual(hours[0], { time: T0, code: 61, condition: 'rain', label: 'Rain', temp: 12, precipProbability: 80, precipMm: 1.4, isDay: true });
  assert.equal(hours[1]!.isDay, false);
});

test('parseHourly treats missing probability / amount arrays as null', () => {
  const body = hourlyBody(2) as { hourly: Record<string, unknown> };
  delete body.hourly.precipitation_probability;
  delete body.hourly.precipitation;
  assert.equal(parseHourly(body)[0]!.precipProbability, null);
  assert.equal(parseHourly(body)[0]!.precipMm, null);
});

test('parseHourly rejects malformed bodies', () => {
  assert.throws(() => parseHourly({}), { code: 'bad-response' });
  assert.throws(() => parseHourly({ hourly: { time: [] } }), { code: 'bad-response' });
});

test('fetchHourlyForecast requests UTC unix hourly data (imperial)', async () => {
  const f = fakeFetch([{ body: hourlyBody(2) }]);
  await fetchHourlyForecast({ location: { name: 'X', latitude: 1.5, longitude: -2.5 }, units: 'imperial', pastDays: 3, forecastDays: 10 }, f.fn);
  const q = f.calls[0]!.url.searchParams;
  assert.equal(q.get('latitude'), '1.5');
  assert.equal(q.get('longitude'), '-2.5');
  assert.equal(q.get('timezone'), 'GMT');
  assert.equal(q.get('timeformat'), 'unixtime');
  assert.equal(q.get('temperature_unit'), 'fahrenheit');
  assert.equal(q.get('past_days'), '3');
  assert.equal(q.get('forecast_days'), '10');
  assert.match(q.get('hourly')!, /temperature_2m.*weather_code.*precipitation_probability.*precipitation,.*is_day/);
});

test('HTTP errors and network failures map to network errors', async () => {
  const base = { location: { name: 'X', latitude: 0, longitude: 0 }, units: 'metric' as const, pastDays: 0, forecastDays: 1 };
  await assert.rejects(fetchHourlyForecast(base, fakeFetch([{ status: 500 }]).fn), { code: 'network' });
  await assert.rejects(fetchHourlyForecast(base, fakeFetch([{ throws: true }]).fn), { code: 'network' });
});

test('searchLocations parses results, tolerates missing `results`, validates query', async () => {
  const f = fakeFetch([
    { body: { results: [{ name: 'London', latitude: 51.5, longitude: -0.12, country: 'United Kingdom', admin1: 'England', timezone: 'Europe/London' }, { bogus: true }] } },
    { body: { generationtime_ms: 0.1 } },
  ]);
  const hits = await searchLocations('London', f.fn);
  assert.equal(hits.length, 1);
  assert.equal(hits[0]!.timezone, 'Europe/London');
  assert.deepEqual(await searchLocations('Nowhereville', f.fn), []);
  await assert.rejects(searchLocations('a', f.fn), { code: 'invalid-input' });
});
