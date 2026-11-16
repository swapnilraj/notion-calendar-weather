export type Units = 'metric' | 'imperial';

export interface Location {
  name: string;
  admin1?: string;
  country?: string;
  latitude: number;
  longitude: number;
  timezone?: string;
}

/** `auto` = derived from the calendar's time zone; `manual` = chosen by the user (never overridden). */
export type LocationSource = 'auto' | 'manual';

export interface WeatherSettings {
  location: Location | null;
  units: Units;
  locationSource: LocationSource | null;
  /** The time zone the auto location was derived from, so we can re-derive after travel. */
  autoTimeZone: string | null;
}

/** Coarse condition buckets the UI maps to icons and tints. */
export type Condition =
  | 'clear'
  | 'partly-cloudy'
  | 'cloudy'
  | 'fog'
  | 'drizzle'
  | 'rain'
  | 'snow'
  | 'thunderstorm'
  | 'unknown';

export interface HourlyForecast {
  /** Epoch seconds (UTC) at the start of the hour. */
  time: number;
  /** Raw WMO weather code. */
  code: number;
  condition: Condition;
  label: string;
  /** Rounded, in the settings' units. */
  temp: number;
  /** 0-100, null when the API has no value. */
  precipProbability: number | null;
  /** Precipitation in mm over the hour *ending* at `time` (Open-Meteo sums the preceding hour); null if absent. */
  precipMm: number | null;
  isDay: boolean;
}

/** One calendar day (in the *calendar's* time zone) condensed from hourly data. */
export interface DaySummary {
  /** YYYY-MM-DD */
  date: string;
  condition: Condition;
  label: string;
  tempMax: number;
  tempMin: number;
  /** Max precipitation probability over the day, 0-100, or null. */
  precipProbability: number | null;
}

export interface ForecastRequest {
  /** Days before today to include. Max 92. */
  pastDays?: number;
  /** Days from today to include. Max 16. */
  forecastDays?: number;
}

export interface ForecastResult {
  location: Location;
  units: Units;
  /** Epoch ms when the data was fetched from the API. */
  fetchedAt: number;
  /** True when served from cache after a failed refresh. */
  stale: boolean;
  hours: HourlyForecast[];
}

export type WeatherErrorCode =
  | 'not-configured'
  | 'not-found'
  | 'invalid-input'
  | 'network'
  | 'bad-response'
  | 'untrusted-sender'
  | 'internal';

export class WeatherError extends Error {
  readonly code: WeatherErrorCode;
  constructor(code: WeatherErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'WeatherError';
    this.code = code;
  }
}

/** IPC envelope: Electron serialises thrown errors poorly, so we return results. */
export type IpcResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: WeatherErrorCode; message: string } };

/** API exposed to the page as `window.__notionWeather`. */
export interface WeatherApi {
  getSettings(): Promise<WeatherSettings>;
  setLocation(location: Location | null): Promise<WeatherSettings>;
  setUnits(units: Units): Promise<WeatherSettings>;
  /** Derive a location from an IANA time zone (e.g. Europe/London). No-op if the user chose manually. */
  autoLocate(timeZone: string): Promise<WeatherSettings>;
  searchLocations(query: string): Promise<Location[]>;
  getForecast(request?: ForecastRequest): Promise<ForecastResult>;
}
