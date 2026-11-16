import { precipIntensity, skyBand, tempBand, TEMP_CAST } from './bands.ts';
import type { DayHour, SkyBand } from './bands.ts';

export type Theme = 'dark' | 'light';

export interface Tint {
  r: number;
  g: number;
  b: number;
  /** 0-1 */
  a: number;
}

type RGBA = readonly [number, number, number, number];

// Base wash per sky band, tuned for the dark theme (alpha is painted over rgb(25,25,25)).
const SKY: Record<SkyBand, RGBA> = {
  bright: [255, 222, 140, 0.13],
  mixed: [226, 212, 184, 0.08],
  overcast: [148, 156, 168, 0.12],
  dark: [38, 58, 120, 0.17],
};
const FOG: RGBA = [198, 204, 212, 0.15];
const STORM: RGBA = [72, 52, 132, 0.2];
const RAIN_SLATE = [78, 104, 150] as const;
const SNOW_PALE = [215, 232, 252] as const;

const mix = (a: number, b: number, t: number) => a + (b - a) * t;

/**
 * The "feel" of one hour as an RGBA wash: brightness from the sky, a cold/warm cast from the temperature,
* and a slate (rain) or pale (snow) cooling when it is wet. `wet` lets the caller supply the wetness at
 * this instant (rain is a per-hour *block*, so at an hour line it is the average of the blocks either side).
 * (The streak texture for rain/snow is layered
 * separately; see texture.ts.)
 */
export function tintFor(h: DayHour, theme: Theme, wet = precipIntensity(h)): Tint {
  const band = skyBand(h);
  let [r, g, b, a] = h.condition === 'thunderstorm' ? STORM : h.condition === 'fog' && band !== 'dark' ? FOG : SKY[band];

  // Temperature cast (gentler at night so dark stays dark).
  const cast = TEMP_CAST[tempBand(h.tempC)];
  const m = band === 'dark' ? cast.k * 0.6 : cast.k;
  r = mix(r, cast.rgb[0], m);
  g = mix(g, cast.rgb[1], m);
  b = mix(b, cast.rgb[2], m);
  a += 0.05 * m;

  const { rain, snow } = wet;
  if (rain > 0) {
    r = mix(r, RAIN_SLATE[0], 0.55 * rain);
    g = mix(g, RAIN_SLATE[1], 0.55 * rain);
    b = mix(b, RAIN_SLATE[2], 0.55 * rain);
    a += 0.05 * rain;
  }
  if (snow > 0) {
    r = mix(r, SNOW_PALE[0], 0.55 * snow);
    g = mix(g, SNOW_PALE[1], 0.55 * snow);
    b = mix(b, SNOW_PALE[2], 0.55 * snow);
    a += 0.04 * snow;
  }

  // Light theme: the same hues need more opacity and slightly deeper colour to show on white.
  // (Untested against Notion's light theme yet.)
  if (theme === 'light') {
    r *= 0.82;
    g *= 0.82;
    b *= 0.9;
    a = Math.min(0.3, a * 1.7);
  }
  return { r: Math.round(r), g: Math.round(g), b: Math.round(b), a: Math.round(a * 1000) / 1000 };
}

export const rgba = (t: Tint) => `rgba(${t.r},${t.g},${t.b},${t.a})`;

/** Relative luminance of an `rgb(...)`/`rgba(...)` string, 0-1; null if unparsable. */
export function luminance(color: string): number | null {
  const m = /rgba?\(\s*(\d+)[ ,]+(\d+)[ ,]+(\d+)/.exec(color);
  if (!m) return null;
  const [r, g, b] = [m[1], m[2], m[3]].map((v) => {
    const c = Number(v) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
