# Development notes

The prototype builds `~/Applications/Notion Calendar Weather.app`, a patched **copy** of the installed
Notion Calendar desktop app. The original in `/Applications` is never modified, and this repository
contains no Notion code: the build script reads your local install and patches the copy on your machine.

The desktop app is a thin Electron shell around `https://calendar.notion.so`, so the feature is added in
two places: a weather backend in the main process, and a page layer injected through the preload script.

```
src/weather/            backend: Open-Meteo client (hourly, UTC), cache, settings, IPC, day summaries
src/ui/                 page layer: feel gradient, rain/snow texture, day-header chips, hover readout
src/entry/              tiny entrypoints appended to the app's main + preload bundles
scripts/build.mjs       copy app -> patch asar -> fix integrity hash -> re-sign ad hoc
scripts/update.mjs      fetch + verify the latest Notion release, rebuild, stage or install (see Updates)
scripts/weather-cli.ts  exercise the backend against the live API
scripts/cdp.mjs         DevTools helper for `build:debug` copies (inspect DOM, screenshot, click)
scripts/dev-launch.mjs  launch the copy (optionally with the debug port) and make it full screen via yabai
test/                   node:test suite (fake fetch, no network)
```

## Commands

```sh
npm install
npm test && npm run typecheck
npm run build            # re-run after every Notion Calendar update
open ~/Applications/Notion\ Calendar\ Weather.app
npm run weather -- search London
npm run weather -- forecast 51.5072 -0.1276 metric
```

## How the layers work

- **Feel gradient:** each day column gets one continuous background wash, one colour per hour, interpolated
  in OKLab. Brightness comes from the sky (bright / mixed / overcast / dark), a cast from the temperature
  (icy when cold, amber when warm), and a cooler slate when it is raining. It is a `background-image` on the
  column's background layer, so events and hour lines always paint above it.
- **Rain / snow texture:** fine slanted streaks (rain) or dots (snow), faded in and out per hour. Density
  follows the measured amount (mm in the hour), not the probability. Open-Meteo stamps amounts at the *end*
  of the hour they fell in, so hour block k→k+1 uses the stamp at k+1; the tint and hover use the same rule.
- **Day header:** icon plus high (and low when there is room); a rain chance only next to a wet icon.
- **Hover:** hovering empty space in a column washes that hour and shows
  `18:00 · Dark · Light rain 1.9 mm · Cool 11°`, using the same words as the gradient's signals.
- **Location:** derived from the calendar's time zone (e.g. `Europe/London` → London); a manually chosen
  location is never overridden.
- **Layout:** nothing is hardcoded about widths or hour heights; geometry is measured from the grid's 1px
  hour lines at runtime.

## Page API (`window.__notionWeather`)

`getSettings()`, `setLocation(loc|null)`, `setUnits('metric'|'imperial')`, `autoLocate(timeZone)`,
`searchLocations(query)`, `getForecast({pastDays?, forecastDays?})`. Failures reject with `WeatherError`
(`.code`: `not-configured`, `not-found`, `invalid-input`, `network`, `bad-response`, ...). IPC handlers only
answer frames from `https://calendar.notion.so`.

## Developing the UI

`npm run dev:launch` starts the copy and makes its window native full screen through yabai. `npm run
build:debug` adds an env-gated DevTools port; launch that copy with `npm run dev:launch:debug` (port 9333),
then use `node scripts/cdp.mjs shot out.png | eval '<js>' | click x,y`. The normal `npm run build` contains
no debug hook.

## Updates

Notion's own updater can't update the copy (an update would drop the patch), so updates go through
`scripts/update.mjs` and a small in-app bridge:

1. `node scripts/update.mjs` reads Notion's public release feed (`latest-mac.yml`, the same one the
   official app checks every 15 minutes). If there's a newer release, or this repo's commit changed:
   - it downloads the zip and verifies it: the SHA-512 from the feed, the Apple code signature,
     Notion's team ID `LBQJ96FQ8D`, and Gatekeeper;
   - it builds a patched copy into `~/Library/Application Support/Notion Calendar Weather/update/staged/`.
2. If the copy isn't running, the update installs straight away. If it is running, the copy notices the
   staged build and shows **Notion's own "New version available → Restart and upgrade" card**
   (`src/weather/updater.ts` feeds the staged build to Notion's updater messages and replaces its install
   handler).
3. Clicking it quits the copy. A detached helper verifies the staged app, swaps it into place, keeps the
   previous build in `update/previous/`, and relaunches. You stay signed in.

### Scheduling it

The steps live in [AGENTS.md](../AGENTS.md) ("Runbook"), so any agent can run them: Codex, Claude Code,
or a plain `node scripts/update.mjs`. To run it on a schedule with a **Codex app automation**:

1. Open the Codex app and add this folder as a project if it isn't one already.
2. Go to Automations → New automation:
   - **Project:** this repo, running locally (not cloud). It needs your Mac's `~/Applications`.
   - **Schedule:** daily at 09:00 and 21:00. Desktop releases ship every few weeks, so twice a day is plenty.
   - **Notify:** failed runs only.
   - **Permissions:** network access plus writes outside the workspace (`~/Applications`,
     `~/Library/Application Support`). Without them the run reports a network error.
   - **Prompt:**

     > Follow the "Runbook: keep the app on the latest Notion Calendar release" section in AGENTS.md.
     > Run `node scripts/update.mjs` and act on its exit code exactly as the table says. Reply with one
     > line: the RESULT action and version, or the error and what you did about it.

For Claude Code, the same prompt works as a scheduled task or `/loop`. `CLAUDE.md` imports `AGENTS.md`.

## Notes

- The copy has its own profile (`~/Library/Application Support/Notion Calendar Weather`), so you sign in again.
- Notion's built-in updater is disconnected in the copy. See [Updates](#updates).
- The copy still registers the app's deep-link protocol, which may take it over from the original.
