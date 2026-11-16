export const CHANNELS = {
  getSettings: 'ncw:getSettings',
  setLocation: 'ncw:setLocation',
  setUnits: 'ncw:setUnits',
  autoLocate: 'ncw:autoLocate',
  searchLocations: 'ncw:searchLocations',
  getForecast: 'ncw:getForecast',
} as const;

/** Only pages from these origins may call the weather IPC handlers. */
export const TRUSTED_ORIGINS: readonly string[] = ['https://calendar.notion.so'];

/** Name of the global the preload exposes to the page. */
export const API_GLOBAL = '__notionWeather';
