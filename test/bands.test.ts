import test from 'node:test';
import assert from 'node:assert/strict';
import { skyBand, tempBand, toCelsius } from '../src/ui/bands.ts';

test('sky bands: night and storms are dark, clear days bright, cloud/rain overcast', () => {
  assert.equal(skyBand({ condition: 'clear', isDay: false }), 'dark');
  assert.equal(skyBand({ condition: 'clear', isDay: true }), 'bright');
  assert.equal(skyBand({ condition: 'partly-cloudy', isDay: true }), 'mixed');
  assert.equal(skyBand({ condition: 'cloudy', isDay: true }), 'overcast');
  assert.equal(skyBand({ condition: 'rain', isDay: true }), 'overcast');
  assert.equal(skyBand({ condition: 'fog', isDay: true }), 'overcast');
  assert.equal(skyBand({ condition: 'thunderstorm', isDay: true }), 'dark');
});

test('temperature bands use absolute °C thresholds', () => {
  assert.deepEqual([-3, 0, 1, 7, 8, 14, 15, 20, 21, 27, 28].map(tempBand), ['freezing', 'freezing', 'cold', 'cold', 'cool', 'cool', 'mild', 'mild', 'warm', 'warm', 'hot']);
});

test('imperial temperatures are converted before banding', () => {
  assert.equal(toCelsius(32, 'imperial'), 0);
  assert.equal(tempBand(toCelsius(50, 'imperial')), 'cool'); // 10°C
  assert.equal(tempBand(toCelsius(86, 'imperial')), 'hot'); // 30°C
  assert.equal(toCelsius(10, 'metric'), 10);
});
