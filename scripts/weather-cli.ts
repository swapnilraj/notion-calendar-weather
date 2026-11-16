// Dev tool to exercise the real backend against Open-Meteo.
//   npm run weather -- search London
//   npm run weather -- forecast 51.5072 -0.1276 [metric|imperial]
import { WeatherService } from '../src/weather/service.ts';
import { summarizeDays } from '../src/weather/summary.ts';

const [cmd, ...rest] = process.argv.slice(2);
const svc = new WeatherService({ ttlMs: 0 });

if (cmd === 'search' && rest.length) {
  console.log(JSON.stringify(await svc.searchLocations(rest.join(' ')), null, 2));
} else if (cmd === 'forecast' && rest.length >= 2) {
  svc.setLocation({ name: 'cli', latitude: Number(rest[0]), longitude: Number(rest[1]) });
  svc.setUnits(rest[2] ?? 'metric');
  const f = await svc.getForecast({ pastDays: 2, forecastDays: 5 });
  const tz = rest[3] ?? 'UTC';
  for (const d of summarizeDays(f.hours, tz).values()) console.log(`${d.date}  ${d.tempMin}…${d.tempMax}  ${d.label} (${d.precipProbability ?? '–'}% rain)`);
  console.log(`${f.hours.length} hourly points; first ${new Date(f.hours[0]!.time * 1000).toISOString()}`);
} else if (cmd === 'auto' && rest.length) {
  console.log(JSON.stringify(await svc.autoLocate(rest[0]), null, 2));
} else {
  console.error('usage: weather search <query> | forecast <lat> <lon> [metric|imperial] [tz] | auto <IANA tz>');
  process.exit(1);
}
