import test from 'node:test';
import assert from 'node:assert/strict';
import { precipIntensity, precipLabel, wetnessAtLines } from '../src/ui/bands.ts';
import type { DayHour } from '../src/ui/bands.ts';
import { textureLayer } from '../src/ui/texture.ts';
import { tintFor } from '../src/ui/tint.ts';

const hour = (o: Partial<DayHour> = {}): DayHour => ({ condition: 'cloudy', precipProbability: 0, precipMm: null, isDay: true, tempC: 17, ...o });
const geo = { offsetPx: 74, hourPx: 48 };
const decode = (img: string) => decodeURIComponent(img.slice('url("data:image/svg+xml,'.length, -2));

test('bright/overcast/dark differ in brightness, and night is the darkest', () => {
  const lum = (h: DayHour) => { const t = tintFor(h, 'dark'); return (t.r + t.g + t.b) * t.a; };
  const sun = lum(hour({ condition: 'clear' }));
  const cloud = lum(hour({ condition: 'cloudy' }));
  const night = lum(hour({ condition: 'clear', isDay: false }));
  assert.ok(sun > cloud && cloud > night);
});

test('cold casts the wash icy and warm casts it amber, relative to mild', () => {
  const t = (tempC: number) => tintFor(hour({ condition: 'clear', tempC }), 'dark');
  assert.ok(t(2).r < t(17).r && t(2).b > t(17).b); // cold: less red, more blue
  assert.ok(t(26).b < t(17).b); // warm: less blue
  assert.ok(t(-4).b - t(-4).r > t(2).b - t(2).r); // freezing is icier than cold
});

test('rain and snow cool the wash; rain strength follows the chance', () => {
  const dry = tintFor(hour({ condition: 'cloudy', tempC: 10 }), 'dark');
  const wet = tintFor(hour({ condition: 'rain', precipProbability: 90, tempC: 10 }), 'dark');
  assert.ok(wet.b - wet.r > dry.b - dry.r);
  assert.ok(wet.a > dry.a);
});

test('precipitation intensity only counts actually-wet conditions', () => {
  assert.deepEqual(precipIntensity(hour({ condition: 'cloudy', precipProbability: 80 })), { rain: 0, snow: 0 });
  assert.equal(precipIntensity(hour({ condition: 'rain', precipProbability: 5 })).rain, 0);
  assert.ok(precipIntensity(hour({ condition: 'rain', precipProbability: 90 })).rain > precipIntensity(hour({ condition: 'rain', precipProbability: 30 })).rain);
  assert.ok(precipIntensity(hour({ condition: 'drizzle', precipProbability: 90 })).rain < precipIntensity(hour({ condition: 'rain', precipProbability: 90 })).rain);
  assert.ok(precipIntensity(hour({ condition: 'snow', precipProbability: 80 })).snow > 0);
  assert.ok(precipIntensity(hour({ condition: 'rain', precipProbability: null })).rain > 0); // wet code, no probability
});

test('no texture layer on a dry day', () => {
  assert.equal(textureLayer(Array(25).fill(hour()), geo, 1226, 'dark'), null);
});

test('rain texture: streak pattern, mask stops on each hour block, fixed-width repeating tile', () => {
  const hours = Array.from({ length: 25 }, (_, i) => hour(i >= 18 && i <= 21 ? { condition: 'rain', precipProbability: 80 } : {}));
  const layer = textureLayer(hours, geo, 1226, 'dark')!;
  assert.equal(layer.repeat, 'repeat-x');
  assert.equal(layer.size, '24px 1226px'); // independent of column width
  const svg = decode(layer.image);
  assert.ok(svg.includes('id="r"') && !svg.includes('id="s"'));
  assert.equal(svg.match(/<stop /g)!.length, 24 + 2);
  // block 17 (stamped 18) is wet, block 16 (stamped 17) is dry
  const op = [...svg.matchAll(/stop-opacity="([\d.]+)"/g)].map((m) => Number(m[1]));
  assert.ok(op[1 + 17]! > 0.5 && op[1 + 16]! === 0);
});

test('snow produces a dot pattern, mixed days produce both', () => {
  const snow = decode(textureLayer(Array(25).fill(hour({ condition: 'snow', precipProbability: 80 })), geo, 1226, 'dark')!.image);
  assert.ok(snow.includes('id="s"') && !snow.includes('id="r"'));
  const mixed = Array.from({ length: 25 }, (_, i) => hour(i < 12 ? { condition: 'rain', precipProbability: 80 } : { condition: 'snow', precipProbability: 80 }));
  const both = decode(textureLayer(mixed, geo, 1226, 'dark')!.image);
  assert.ok(both.includes('id="r"') && both.includes('id="s"'));
  assert.throws(() => textureLayer([hour()], geo, 1226, 'dark'));
});

test('rain strength follows the measured amount (mm), on a square-root scale', () => {
  const r = (mm: number) => precipIntensity(hour({ condition: 'rain', precipMm: mm, precipProbability: 100 })).rain;
  assert.equal(r(0), 0);
  assert.equal(r(0.02), 0);
  assert.ok(r(0.1) >= 0.12 && r(0.1) < r(0.5) && r(0.5) < r(1.4) && r(1.4) < r(4) && r(4) < r(6));
  assert.equal(r(40), 1); // capped
  // amount wins over probability: a certain-but-tiny shower is faint, a 20%-chance downpour is dense
  assert.ok(precipIntensity(hour({ condition: 'rain', precipMm: 5, precipProbability: 20 })).rain > precipIntensity(hour({ condition: 'rain', precipMm: 0.1, precipProbability: 100 })).rain);
  // a dry code stays dry even if the model reports some mm
  assert.deepEqual(precipIntensity(hour({ condition: 'cloudy', precipMm: 2 })), { rain: 0, snow: 0 });
});

test('pill wording describes how heavy it is', () => {
  const l = (condition: DayHour['condition'], mm: number | null) => precipLabel(hour({ condition, precipMm: mm, precipProbability: 80 }));
  assert.equal(l('cloudy', 0), null);
  assert.equal(l('rain', 0), null);
  assert.equal(l('drizzle', 0.2), 'Drizzle 0.2 mm');
  assert.equal(l('rain', 1.4), 'Light rain 1.4 mm');
  assert.equal(l('rain', 4), 'Rain 4.0 mm');
  assert.equal(l('rain', 9), 'Heavy rain 9.0 mm');
  assert.equal(l('thunderstorm', 3), 'Thunderstorm 3.0 mm');
  assert.equal(l('rain', null), 'Rain');
  assert.equal(l('snow', 0.8), 'Light snow 0.8 mm');
});

test('tint wetness is centred on the same hour block as the texture', () => {
  // Rain only in block 12 (12:00-13:00), which Open-Meteo stamps at 13:00.
  const hours = Array.from({ length: 25 }, (_, i) => hour(i === 13 ? { condition: 'rain', precipMm: 3 } : {}));
  const w = wetnessAtLines(hours).map((x) => x.rain);
  const full = precipIntensity(hours[13]!).rain;
  assert.deepEqual(w.map((v, i) => (v > 0 ? i : -1)).filter((i) => i >= 0), [12, 13]); // the two lines bounding block 12
  assert.ok(Math.abs(w[12]! - full / 2) < 1e-9 && Math.abs(w[13]! - full / 2) < 1e-9); // symmetric about the block's centre
  // the texture puts its peak in that same block
  const svg = decodeURIComponent(textureLayer(hours, geo, 1226, 'dark')!.image);
  const op = [...svg.matchAll(/stop-opacity="([\d.]+)"/g)].map((m) => Number(m[1]));
  const peak = op.indexOf(Math.max(...op)); // stops: [0] cap, [1..24] blocks 0..23, [25] cap
  assert.equal(peak - 1, 12);
});
