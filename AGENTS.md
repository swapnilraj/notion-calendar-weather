# Agent guide: Notion Calendar Weather

Instructions for any coding agent (Codex, Claude Code, …) working in this repo. Humans: see
[README.md](README.md) and [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md).

This repo builds `~/Applications/Notion Calendar Weather.app`, a patched copy of Notion Calendar with
a weather layer. `src/weather/` is the backend (main process), `src/ui/` the page layer, and
`scripts/build.mjs` the patch pipeline.

## Hard rules

- Never modify, move or delete `/Applications/Notion Calendar.app` (the user's original).
- Never weaken release verification in `scripts/update.mjs` (SHA-512, code signature, Notion team ID
  `LBQJ96FQ8D`, Gatekeeper) to make an update go through.
- Don't kill or relaunch the user's running copy unattended. The app installs staged updates itself
  when the user clicks "Restart and upgrade".
- Don't commit or push unless asked. Never put personal calendar data in commits, logs or screenshots.
- Before finishing a code change, run `npm test && npm run typecheck`.

## Runbook: keep the app on the latest Notion Calendar release

Use this runbook for scheduled runs too. Run:

```sh
npm install --no-audit --no-fund   # only if node_modules is missing
node scripts/update.mjs
```

It needs network access and write access to `~/Applications` and
`~/Library/Application Support/Notion Calendar Weather`. The last line is `RESULT {json}`. Act on the
exit code:

| Exit | `action` / `kind` | What it means | What to do |
|---|---|---|---|
| 0 | `up-to-date`, `already-staged` | Nothing to do | Report one line and stop. |
| 0 | `staged` | New build is waiting. The running app shows "Restart and upgrade". | Report the version and stop. |
| 0 | `installed` | The app wasn't running, so the new build was installed directly | Report the version and stop. |
| 0 with non-empty `warnings` | | Built, but Notion's updater hooks moved, so the in-app prompt may not appear | Treat it like exit 3 for the prompt hooks in `src/weather/updater.ts`. |
| 1 | `network`, `busy` | Transient | Report it and stop. The next scheduled run retries. |
| 2 | `verification` | The download failed SHA-512, signature, team ID or Gatekeeper checks | **Stop.** Report the exact error. Don't retry, and don't bypass the checks. |
| 3 | `build`, `feed-format` | Notion changed the app or feed layout | Fix it (see below). |

### Fixing exit 3 (Notion changed something)

1. Read the build output above `RESULT` to find the failing step.
2. The cached release is extracted under `.cache/releases/<version>/` (re-run with `--check` for the version).
   Inspect it with `npx asar list` / `npx asar extract`.
3. The patch points that matter:
   - `package.json` `main` (main bundle)
   - `build/preload/preload-bundle.js`
   - the Info.plist `ElectronAsarIntegrity` key
   - in the main bundle, the IPC names `cronQuitAndInstallUpdate` and `cronUpdate*`, plus the `before-quit-for-update` event used by `src/weather/updater.ts`
4. Adapt `scripts/build.mjs` or `src/weather/updater.ts` with the smallest change that works, then run
   `npm test && npm run typecheck && node scripts/update.mjs`.
5. Report what changed and leave the fix uncommitted for the user to review.

The weather page layer (`src/ui/`) runs against `calendar.notion.so`, which updates independently
of desktop releases. If the weather layer stops appearing, that's a `src/ui/` issue, not this runbook.

## Useful commands

```sh
node scripts/update.mjs --check   # report only, never builds
node scripts/update.mjs --force   # rebuild even if up to date (e.g. after code changes)
npm run build                     # build straight from /Applications (dev; user must quit the copy first)
npm run dev:launch                # dev only: launch the copy full screen via yabai
```
