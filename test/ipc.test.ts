import test from 'node:test';
import assert from 'node:assert/strict';
import { isTrustedSender, registerWeatherIpc } from '../src/weather/main.ts';
import type { IpcEventLike } from '../src/weather/main.ts';
import { createWeatherApi } from '../src/weather/preload.ts';
import { CHANNELS } from '../src/weather/channels.ts';
import { WeatherService } from '../src/weather/service.ts';
import { fakeFetch, forecastBody, T0 } from './helpers.ts';

function setup() {
  const handlers = new Map<string, (e: IpcEventLike, ...a: unknown[]) => unknown>();
  const ipcMain = { handle: (c: string, l: (e: IpcEventLike, ...a: unknown[]) => unknown) => void handlers.set(c, l) };
  const f = fakeFetch([{ body: forecastBody }]);
  registerWeatherIpc(ipcMain, { getPath: () => '/unused' }, new WeatherService({ fetch: f.fn }));
  const asFrame = (url: string) => async (channel: string, ...args: unknown[]) => handlers.get(channel)!({ senderFrame: { url } }, ...args);
  return { handlers, asFrame };
}

test('isTrustedSender checks origin strictly', () => {
  assert.equal(isTrustedSender({ senderFrame: { url: 'https://calendar.notion.so/week' } }), true);
  assert.equal(isTrustedSender({ senderFrame: { url: 'https://calendar.notion.so.evil.com/' } }), false);
  assert.equal(isTrustedSender({ senderFrame: { url: 'http://calendar.notion.so/' } }), false);
  assert.equal(isTrustedSender({ senderFrame: null }), false);
  assert.equal(isTrustedSender({}), false);
});

test('untrusted frames are rejected on every channel', async () => {
  const { handlers, asFrame } = setup();
  const evil = asFrame('https://evil.example/');
  for (const channel of Object.values(CHANNELS)) {
    assert.deepEqual(await evil(channel), { ok: false, error: { code: 'untrusted-sender', message: 'Origin not allowed' } });
  }
  assert.equal(handlers.size, Object.keys(CHANNELS).length);
});

test('end to end through the preload API', async () => {
  const { asFrame } = setup();
  const invoke = asFrame('https://calendar.notion.so/');
  const api = createWeatherApi({ invoke });

  await assert.rejects(api.getForecast(), { name: 'WeatherError', code: 'not-configured' });
  const s = await api.setLocation({ name: 'London', latitude: 51.5, longitude: -0.12 });
  assert.equal(s.location?.name, 'London');
  const f = await api.getForecast({ pastDays: 0, forecastDays: 3 });
  assert.equal(f.hours.length, 48);
  assert.equal(f.hours[0]!.time, T0);
  await assert.rejects(api.setUnits('kelvin' as never), { code: 'invalid-input' });
});
