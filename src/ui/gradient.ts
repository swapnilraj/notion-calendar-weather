import { rgba } from './tint.ts';
import type { Tint } from './tint.ts';

export interface ColumnGeometry {
  /** Pixels from the top of the column to the start of 00:00 (sticky header + all-day area). */
  offsetPx: number;
  /** Pixels per hour. */
  hourPx: number;
}

/**
 * Build a vertical CSS gradient for one day column.
 * `hours` has 25 tints: 00:00 … 23:00 plus 24:00 (= next day's 00:00), so colour flows
 * seamlessly across midnight into the neighbouring column. Each tint sits exactly on its
 * hour line and the browser interpolates between them in OKLab (premultiplied alpha).
 */
export function buildGradient(hours: readonly Tint[], geo: ColumnGeometry): string {
  if (hours.length !== 25) throw new Error(`expected 25 hourly tints, got ${hours.length}`);
  const stops = hours.map((t, i) => `${rgba(t)} ${round(geo.offsetPx + i * geo.hourPx)}px`);
  return `linear-gradient(in oklab to bottom, ${stops.join(', ')})`;
}

const round = (n: number) => Math.round(n * 100) / 100;

/**
 * Derive geometry from the y-positions of the column's hour lines (relative to the column top).
 * Line k (0-based) sits at the *end* of hour k, so the first line is offset + hourPx.
 */
export function geometryFromLines(lineYs: readonly number[]): ColumnGeometry | null {
  const ys = [...lineYs].sort((a, b) => a - b);
  if (ys.length < 2) return null;
  const hourPx = ys[1]! - ys[0]!;
  if (!(hourPx > 4)) return null;
  return { offsetPx: ys[0]! - hourPx, hourPx };
}
