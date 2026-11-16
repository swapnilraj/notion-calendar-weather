import test from 'node:test';
import assert from 'node:assert/strict';
import { describeWmoCode } from '../src/weather/wmo.ts';

test('maps representative WMO codes', () => {
  assert.equal(describeWmoCode(0).condition, 'clear');
  assert.equal(describeWmoCode(2).condition, 'partly-cloudy');
  assert.equal(describeWmoCode(63).condition, 'rain');
  assert.equal(describeWmoCode(81).condition, 'rain');
  assert.equal(describeWmoCode(73).condition, 'snow');
  assert.equal(describeWmoCode(95).condition, 'thunderstorm');
});

test('unknown codes do not throw', () => {
  assert.equal(describeWmoCode(1234).condition, 'unknown');
});
