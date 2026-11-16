import type { Condition } from './types.ts';

/** Map a WMO weather interpretation code (as used by Open-Meteo) to a bucket + label. */
export function describeWmoCode(code: number): { condition: Condition; label: string } {
  switch (code) {
    case 0:
      return { condition: 'clear', label: 'Clear sky' };
    case 1:
      return { condition: 'clear', label: 'Mainly clear' };
    case 2:
      return { condition: 'partly-cloudy', label: 'Partly cloudy' };
    case 3:
      return { condition: 'cloudy', label: 'Overcast' };
    case 45:
    case 48:
      return { condition: 'fog', label: 'Fog' };
    case 51:
    case 53:
    case 55:
    case 56:
    case 57:
      return { condition: 'drizzle', label: 'Drizzle' };
    case 61:
    case 63:
    case 65:
    case 66:
    case 67:
      return { condition: 'rain', label: 'Rain' };
    case 71:
    case 73:
    case 75:
    case 77:
      return { condition: 'snow', label: 'Snow' };
    case 80:
    case 81:
    case 82:
      return { condition: 'rain', label: 'Rain showers' };
    case 85:
    case 86:
      return { condition: 'snow', label: 'Snow showers' };
    case 95:
    case 96:
    case 99:
      return { condition: 'thunderstorm', label: 'Thunderstorm' };
    default:
      return { condition: 'unknown', label: 'Unknown' };
  }
}

/** Generic label per bucket (used for day summaries, where WMO detail isn't meaningful). */
export const CONDITION_LABEL: Record<Condition, string> = {
  clear: 'Clear',
  'partly-cloudy': 'Partly cloudy',
  cloudy: 'Cloudy',
  fog: 'Fog',
  drizzle: 'Drizzle',
  rain: 'Rain',
  snow: 'Snow',
  thunderstorm: 'Thunderstorm',
  unknown: 'Unknown',
};

/** Higher = more noteworthy when summarising a day. */
export const SEVERITY: Record<Condition, number> = {
  unknown: -1,
  clear: 0,
  'partly-cloudy': 1,
  cloudy: 2,
  fog: 3,
  drizzle: 4,
  rain: 5,
  snow: 6,
  thunderstorm: 7,
};
