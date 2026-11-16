import { precipIntensity } from './bands.ts';
import type { DayHour } from './bands.ts';
import type { ColumnGeometry } from './gradient.ts';
import type { Theme } from './tint.ts';

export interface TextureLayer {
  /** CSS `background-image` value (one `url(data:image/svg+xml,...)`). */
  image: string;
  /** The tile is a fixed width and repeats across the column, so it never depends on column width. */
  size: string;
  repeat: 'repeat-x';
}

/** Tile width in px; a multiple of both patterns' periods (12) so tiles join seamlessly. */
const TILE_W = 24;
const f = (n: number) => String(Math.round(n * 1000) / 1000);

const RAIN_STROKE: Record<Theme, string> = { dark: 'rgba(170,205,255,0.32)', light: 'rgba(40,90,190,0.3)' };
const SNOW_FILL: Record<Theme, string> = { dark: 'rgba(235,245,255,0.45)', light: 'rgba(70,110,170,0.4)' };

/** A vertical alpha-mask gradient (white, per-hour opacity) with stops at hour-block centres, so strength eases hour to hour. */
function maskGradient(id: string, values: readonly number[], geo: ColumnGeometry, H: number): string {
  const stop = (y: number, v: number) => `<stop offset="${f(Math.min(1, Math.max(0, y / H)))}" stop-color="#fff" stop-opacity="${f(v)}"/>`;
  const stops = [stop(0, values[0]!)];
  values.forEach((v, k) => stops.push(stop(geo.offsetPx + (k + 0.5) * geo.hourPx, v)));
  stops.push(stop(H, values[values.length - 1]!));
  return `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2="${f(H)}">${stops.join('')}</linearGradient>`;
}

/**
 * Rain streaks and snow dots, faded in and out per hour by precipitation strength. Hour block k (k→k+1)
 * uses the value stamped at k+1, because Open-Meteo's probability covers the *preceding* hour.
 * Returns null when nothing wet happens all day (no layer needed). `hours` has 25 entries (00:00 … 24:00).
 */
export function textureLayer(hours: readonly DayHour[], geo: ColumnGeometry, height: number, theme: Theme): TextureLayer | null {
  if (hours.length !== 25) throw new Error(`expected 25 hours, got ${hours.length}`);
  const blocks = Array.from({ length: 24 }, (_, k) => precipIntensity(hours[k + 1]!));
  const rain = blocks.map((b) => b.rain);
  const snow = blocks.map((b) => b.snow);
  const hasRain = rain.some((v) => v > 0);
  const hasSnow = snow.some((v) => v > 0);
  if (!hasRain && !hasSnow) return null;

  const H = height;
  const defs: string[] = [];
  const body: string[] = [];
  if (hasRain) {
    defs.push(
      `<pattern id="r" width="12" height="18" patternUnits="userSpaceOnUse"><path d="M9 1.5L6 9.5M3.5 10.5L1 16.5" stroke="${RAIN_STROKE[theme]}" stroke-width="1" stroke-linecap="round" fill="none"/></pattern>`,
      maskGradient('gr', rain, geo, H),
      `<mask id="mr"><rect width="${TILE_W}" height="${f(H)}" fill="url(#gr)"/></mask>`,
    );
    body.push(`<rect width="${TILE_W}" height="${f(H)}" fill="url(#r)" mask="url(#mr)"/>`);
  }
  if (hasSnow) {
    defs.push(
      `<pattern id="s" width="12" height="12" patternUnits="userSpaceOnUse"><circle cx="3" cy="3" r="1.1" fill="${SNOW_FILL[theme]}"/><circle cx="9.5" cy="9" r="0.9" fill="${SNOW_FILL[theme]}"/></pattern>`,
      maskGradient('gs', snow, geo, H),
      `<mask id="ms"><rect width="${TILE_W}" height="${f(H)}" fill="url(#gs)"/></mask>`,
    );
    body.push(`<rect width="${TILE_W}" height="${f(H)}" fill="url(#s)" mask="url(#ms)"/>`);
  }

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${TILE_W}" height="${f(H)}" viewBox="0 0 ${TILE_W} ${f(H)}"><defs>${defs.join('')}</defs>${body.join('')}</svg>`;
  return { image: `url("data:image/svg+xml,${encodeURIComponent(svg)}")`, size: `${TILE_W}px ${f(H)}px`, repeat: 'repeat-x' };
}
