import type { Condition, Units } from '../weather/types.ts';

/** The per-hour signals the page layer works with. Temperature is always in °C here. */
export interface DayHour {
  condition: Condition;
  /** 0-100 or null */
  precipProbability: number | null;
  /** mm over the hour ending at this stamp, or null. */
  precipMm: number | null;
  isDay: boolean;
  tempC: number;
}

export type RGB = readonly [number, number, number];

/** Coarse answers to "how bright is it?" and "how cold is it?" — shared by the tint and the hover pill. */
export type SkyBand = 'bright' | 'mixed' | 'overcast' | 'dark';
export type TempBand = 'freezing' | 'cold' | 'cool' | 'mild' | 'warm' | 'hot';

export const SKY_LABEL: Record<SkyBand, string> = { bright: 'Bright', mixed: 'Mixed', overcast: 'Overcast', dark: 'Dark' };
export const TEMP_LABEL: Record<TempBand, string> = { freezing: 'Freezing', cold: 'Cold', cool: 'Cool', mild: 'Mild', warm: 'Warm', hot: 'Hot' };

/** Night and thunderstorms are dark; clear days are bright; most else (cloud, fog, rain, snow) is overcast. */
export function skyBand(h: { condition: Condition; isDay: boolean }): SkyBand {
  if (!h.isDay || h.condition === 'thunderstorm') return 'dark';
  if (h.condition === 'clear') return 'bright';
  if (h.condition === 'partly-cloudy') return 'mixed';
  return 'overcast';
}

export const toCelsius = (temp: number, units: Units): number => (units === 'imperial' ? ((temp - 32) * 5) / 9 : temp);

/** Absolute thresholds in °C (what people mean by "cold"), not scaled to the day. */
export function tempBand(tempC: number): TempBand {
  if (tempC <= 0) return 'freezing';
  if (tempC <= 7) return 'cold';
  if (tempC <= 14) return 'cool';
  if (tempC <= 20) return 'mild';
  if (tempC <= 27) return 'warm';
  return 'hot';
}

/** Temperature as a colour cast over the sky wash: icy when cold, amber/red when warm, none when mild. */
export const TEMP_CAST: Record<TempBand, { rgb: RGB; k: number }> = {
  freezing: { rgb: [120, 215, 255], k: 0.55 },
  cold: { rgb: [79, 190, 240], k: 0.38 },
  cool: { rgb: [95, 180, 200], k: 0.15 },
  mild: { rgb: [0, 0, 0], k: 0 },
  warm: { rgb: [255, 165, 80], k: 0.25 },
  hot: { rgb: [255, 105, 70], k: 0.42 },
};

/**
 * How heavy the rain / snow is, 0-1 each. Only actually-wet conditions count. With a measured amount
 * (mm in the hour) strength follows the amount on a square-root scale, so drizzle is faint and a downpour
 * is dense; without one we fall back to the chance of precipitation.
 */
export function precipIntensity(h: DayHour): { rain: number; snow: number } {
  const snowy = h.condition === 'snow';
  const rainy = h.condition === 'drizzle' || h.condition === 'rain' || h.condition === 'thunderstorm';
  if (!rainy && !snowy) return { rain: 0, snow: 0 };

  let i: number;
  if (h.precipMm !== null) {
    i = h.precipMm < 0.05 ? 0 : Math.max(0.12, Math.min(1, Math.sqrt(h.precipMm / (snowy ? 3 : 6)))); // snow is water-equivalent
  } else {
    const p = h.precipProbability ?? 50;
    i = (p < 10 ? 0 : 0.15 + 0.85 * (p / 100)) * (h.condition === 'drizzle' ? 0.6 : 1);
  }
  return snowy ? { rain: 0, snow: i } : { rain: i, snow: 0 };
}

/** Words for the hover pill, or null when dry. */
export function precipLabel(h: DayHour): string | null {
  const { rain, snow } = precipIntensity(h);
  if (rain === 0 && snow === 0) return null;
  const mm = h.precipMm;
  const amount = mm !== null && mm >= 0.1 ? ` ${mm.toFixed(1)} mm` : '';
  if (snow > 0) return `${mm === null || mm < 2 ? 'Light snow' : 'Heavy snow'}${amount}`;
  if (h.condition === 'thunderstorm') return `Thunderstorm${amount}`;
  if (h.condition === 'drizzle') return `Drizzle${amount}`;
  const kind = mm === null ? 'Rain' : mm < 2.5 ? 'Light rain' : mm < 7.6 ? 'Rain' : 'Heavy rain';
  return `${kind}${amount}`;
}

/**
 * Wetness at each of the 25 hour *lines*. Sky and temperature are instantaneous, so they sit on the lines;
 * rain is a per-hour *block* (block k, hour k→k+1, is described by the stamp at k+1), so at line i the
 * wetness is the mean of block i-1 (stamp i) and block i (stamp i+1). This keeps the tint centred on the
 * same hour as the streak texture.
 */
export function wetnessAtLines(hours: readonly DayHour[]): Array<{ rain: number; snow: number }> {
  return hours.map((_, i) => {
    const a = precipIntensity(hours[i]!);
    const b = precipIntensity(hours[Math.min(i + 1, hours.length - 1)]!);
    return { rain: (a.rain + b.rain) / 2, snow: (a.snow + b.snow) / 2 };
  });
}
