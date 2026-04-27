# End of Quarter Countdown — Windows

A small Electron desktop app for Windows that lives in the system tray and counts down to the end of the current Australian financial-year quarter. The macOS edition is maintained as a separate project.

## Features

**Tray**
- Custom tray icon with the day count painted onto it (blue gradient, turns orange during the FY rollover warning window)
- Hover tooltip shows the current FY, quarter and days remaining (e.g. `FY26 Q4 · 89d`, with a `bd` suffix when business-days mode is on)
- Click to toggle the popup; right-click for Show / Quit menu

**Popup (dark theme)**
- Big Arial Black countdown number with a blue gradient and a smaller `DAYS` / `DAY` label
- Weeks remaining and full long-form end-of-quarter date
- Quarter progress bar with day-of-quarter / total-days and percentage
- Two info cards: Week Number in current quarter, and FY End Date with days remaining
- Header with FY badge, cloud-sync button, pencil-edit button
- Amber warning banner with **Sync Now** / **Edit Dates** actions when fewer than 70 days remain on the next FY's Q1
- Editor panel for the five quarter end dates and the sync URL, with last-synced timestamp

**Behaviour**
- Tracks five quarters — Q1–Q4 of the current FY plus Q1 of the next FY
- Rolls over automatically as each quarter ends
- Business-days toggle (Mon–Fri only) for both the countdown number and the tooltip
- Recomputes every minute and detects timezone changes between ticks (handles travel/DST)
- Launch at Login support (Windows startup item)
- Single-instance lock — clicking the installer or double-clicking the .exe again just brings the existing copy forward
- Settings stored in the user profile, validated on load (corrupt settings.json falls back to defaults)

**Web sync**
- Pulls quarter end-dates from a configurable URL
- Parses dates in `FY26Q1 : 25/10/2025` format (dd/mm/yyyy)
- Defaults to `https://hawkinsmultimedia.com.au/endofquarter.html`
- **Auto-syncs on first launch** — when no settings file exists yet, the app silently fetches fresh dates ~1.5 seconds after start. If it fails (offline, VPN, server down) it falls back to the baked-in defaults
- Manual sync via the cloud button in the popup header, or the **Sync Now** button in the FY rollover warning banner
- Last-synced timestamp shown in the editor
- Diagnosable error messages — distinguishes DNS failure / connection refused / timeout / HTTP errors / SSL problems, naming the host

## Project structure

```
.
├── main.js                  # Electron main process (tray, popup, sync, IPC)
├── preload.js               # contextBridge APIs for popup + tray-icon renderer
├── renderer/
│   ├── index.html           # Popup UI structure
│   ├── styles.css           # Dark-theme styles
│   ├── renderer.js          # Popup UI logic
│   └── tray-icon.html       # Hidden canvas that paints the day count onto the tray icon
├── assets/
│   └── icon.ico             # App icon (multi-size, 16-256)
├── scripts/
│   └── build-icon.py        # One-off helper to regenerate icon.ico with a 256x256 frame
├── package.json             # App metadata + electron-builder config
├── package-lock.json
├── .editorconfig
├── .gitattributes
└── .gitignore
```

## Requirements

- Windows 10 / 11
- [Node.js](https://nodejs.org/) 18 or newer
- npm (ships with Node.js)

## Getting started

Install dependencies:

```powershell
npm install
```

Run the app in development:

```powershell
npm start
```

## Building

Windows installer (NSIS, one-click, x64):

```powershell
npm run build
```

Build artefacts are written to `dist/`. The installer is named `End of Quarter Countdown Setup <version>.exe`.

The build skips code signing because there's no certificate configured. The `.exe` will trigger a Windows SmartScreen warning the first time it runs — click "More info" → "Run anyway". To remove the warning permanently you'd need a code-signing certificate (~$80–$400/year from a CA).

### Regenerating the app icon

If you replace `assets/icon.ico` with a new icon, electron-builder requires it to contain a 256×256 frame. The supplied source may not have one. To rebuild a multi-size .ico (16/24/32/48/64/128/256) from whatever frames the source has, run:

```powershell
python -m pip install Pillow
python scripts/build-icon.py
```

This upscales the largest source frame to 256×256 (LANCZOS) and rewrites `assets/icon.ico` in place.

## Pinning the tray icon (Windows 11)

By default Windows 11 puts new system-tray icons in the "show hidden icons" overflow area (the `^` chevron). To make this app's icon always visible:

- Right-click the taskbar &rarr; **Taskbar settings**
- Scroll to **Other system tray icons**
- Find **End of Quarter Countdown** and toggle it **On**

Alternatively: click the `^` chevron, then drag the icon out into the always-visible part of the tray.

This is a one-time Windows setting and persists across app updates. There's no programmatic way for the app to do this for you — Windows 11 makes tray-icon visibility a deliberate user choice.

## Data & troubleshooting

**Where settings live:**

```
%APPDATA%\End of Quarter Countdown\
├── settings.json        # Quarter dates, URL, business-days flag, last sync time
├── app.log              # Diagnostic log (startup path, migration, tray render attempts)
└── ... (Electron's own cache, cookies, GPU shader cache)
```

Open it from a terminal:

```powershell
explorer "$env:APPDATA\End of Quarter Countdown"
```

**Resetting:** quit the app first (right-click tray &rarr; Quit), then delete `settings.json` and re-launch. The first-run auto-sync will refetch fresh dates.

**Reading the diagnostic log:**

```powershell
Get-Content "$env:APPDATA\End of Quarter Countdown\app.log"
```

The log captures startup events: which folder Electron picked for userData, whether the legacy-folder migration ran, every tray-icon render attempt, and reasons for any silent failures. Useful when something visible isn't working.

**Legacy folder migration:** earlier builds (pre-v2.5.1) wrote settings to `%APPDATA%\end-of-quarter-countdown\` (lowercase, hyphenated &mdash; from the npm package name). Recent builds explicitly use `End of Quarter Countdown` (display name, matching the Mac edition). On first launch of v2.5.1+, settings.json is copied over automatically and the legacy folder is removed. If a file in the legacy folder is locked at the time, the cleanup retries on every subsequent launch.

## Versioning

This project follows [Semantic Versioning](https://semver.org/):

- **Patch** (`2.0.0` → `2.0.1`) — bug fixes, small tweaks, docs
- **Minor** (`2.0.0` → `2.1.0`) — new features, backward-compatible
- **Major** (`2.0.0` → `3.0.0`) — breaking changes

Each release is tagged in git as `vX.Y.Z`.

## Tech stack

- Electron 41 (Chromium 130, Node 22)
- electron-builder 26 (NSIS target)
- No production runtime dependencies — pure Node + Electron stdlib

## License

Copyright © 2025 Ian Hawkins. All rights reserved.
