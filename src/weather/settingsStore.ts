import fs from 'node:fs';
import path from 'node:path';
import type { Location, Units, WeatherSettings } from './types.ts';

export interface SettingsStore {
  load(): WeatherSettings;
  save(settings: WeatherSettings): void;
}

export const DEFAULT_SETTINGS: WeatherSettings = { location: null, units: 'metric', locationSource: null, autoTimeZone: null };

export function isUnits(v: unknown): v is Units {
  return v === 'metric' || v === 'imperial';
}

/** Returns a cleaned Location, or null if `v` isn't a valid one. */
export function parseLocation(v: unknown): Location | null {
  if (typeof v !== 'object' || v === null) return null;
  const r = v as Record<string, unknown>;
  if (typeof r.name !== 'string' || r.name.length === 0 || r.name.length > 200) return null;
  if (typeof r.latitude !== 'number' || !(r.latitude >= -90 && r.latitude <= 90)) return null;
  if (typeof r.longitude !== 'number' || !(r.longitude >= -180 && r.longitude <= 180)) return null;
  return {
    name: r.name,
    latitude: r.latitude,
    longitude: r.longitude,
    ...(typeof r.admin1 === 'string' && { admin1: r.admin1.slice(0, 200) }),
    ...(typeof r.country === 'string' && { country: r.country.slice(0, 200) }),
    ...(typeof r.timezone === 'string' && { timezone: r.timezone.slice(0, 100) }),
  };
}

export class MemoryStore implements SettingsStore {
  private current: WeatherSettings = { ...DEFAULT_SETTINGS };
  load() {
    return { ...this.current };
  }
  save(s: WeatherSettings) {
    this.current = { ...s };
  }
}

/** JSON file store. Corrupt or missing files fall back to defaults; writes are atomic. */
export class FileStore implements SettingsStore {
  private readonly file: string;
  constructor(file: string) {
    this.file = file;
  }
  load(): WeatherSettings {
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8')) as Record<string, unknown>;
      return {
        location: parseLocation(raw.location),
        units: isUnits(raw.units) ? raw.units : DEFAULT_SETTINGS.units,
        locationSource: raw.locationSource === 'auto' || raw.locationSource === 'manual' ? raw.locationSource : null,
        autoTimeZone: typeof raw.autoTimeZone === 'string' ? raw.autoTimeZone.slice(0, 100) : null,
      };
    } catch {
      return { ...DEFAULT_SETTINGS };
    }
  }
  save(settings: WeatherSettings): void {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(settings, null, 2));
    fs.renameSync(tmp, this.file);
  }
}
