# End of Quarter Countdown — Windows (v2)

A small Electron desktop app for Windows that lives in the system tray and counts down to the end of the current Australian financial-year quarter.

## Features

- Tray icon with quick-glance status (changes colour as the deadline approaches)
- Countdown window showing the current FY quarter and time remaining
- Single-instance lock — only one copy runs at a time
- Pure-Node PNG icon generation (no native image dependencies)

## Project structure

```
.
├── main.js              # Electron main process (tray, window, icon generation)
├── preload.js           # Preload bridge between main and renderer
├── renderer/
│   ├── index.html       # Countdown UI
│   └── renderer.js      # UI logic
├── package.json         # App metadata + electron-builder config
└── assets/              # App icons (icon.ico / icon.icns)
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

Windows installer (NSIS, x64):

```powershell
npm run build:win
```

macOS DMG (requires macOS to sign/notarise properly):

```powershell
npm run build:mac
```

Build artefacts are written to `dist/`.

## Versioning

This project follows [Semantic Versioning](https://semver.org/):

- **Patch** (`2.0.0` → `2.0.1`) — bug fixes and small tweaks
- **Minor** (`2.0.0` → `2.1.0`) — new features, backward-compatible
- **Major** (`2.0.0` → `3.0.0`) — breaking changes

Each release is tagged in git as `vX.Y.Z`.

## License

Copyright © 2025 Ian Hawkins. All rights reserved.
