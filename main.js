'use strict';

const {
  app, BrowserWindow, Tray, Menu, nativeImage,
  ipcMain, shell, screen
} = require('electron');
const path  = require('path');
const fs    = require('fs');
const zlib  = require('zlib');
const https = require('https');
const http  = require('http');

// ─── Single-instance lock ─────────────────────────────────────────────────────
if (!app.requestSingleInstanceLock()) { app.quit(); process.exit(0); }

// ─── Paths ────────────────────────────────────────────────────────────────────
const SETTINGS_PATH = path.join(app.getPath('userData'), 'settings.json');

// ─── PNG icon generator (pure Node – no native deps) ─────────────────────────
function encodePNG(w, h, rgba) {
  // Build raw scanlines (filter byte 0 = None, then RGB triplets)
  const rowLen = w * 3;
  const raw = Buffer.alloc(h * (1 + rowLen));
  for (let y = 0; y < h; y++) {
    raw[y * (1 + rowLen)] = 0; // filter type: None
    for (let x = 0; x < w; x++) {
      const s = (y * w + x) * 4;
      const d = y * (1 + rowLen) + 1 + x * 3;
      raw[d] = rgba[s]; raw[d + 1] = rgba[s + 1]; raw[d + 2] = rgba[s + 2];
    }
  }
  const idat = zlib.deflateSync(raw);

  // CRC-32 table
  const tbl = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    tbl[n] = c;
  }
  const crc32 = buf => {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < buf.length; i++) c = tbl[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  };
  const chunk = (type, data) => {
    const tp  = Buffer.from(type, 'ascii');
    const len = Buffer.allocUnsafe(4); len.writeUInt32BE(data.length, 0);
    const cr  = Buffer.allocUnsafe(4); cr.writeUInt32BE(crc32(Buffer.concat([tp, data])), 0);
    return Buffer.concat([len, tp, data, cr]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2; // 8-bit RGB
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))
  ]);
}

function makeIcon(type /* 'normal' | 'warning' */) {
  const sz   = 32;
  const rgba = Buffer.alloc(sz * sz * 4);
  const bg   = type === 'warning' ? [220, 90, 0] : [0, 90, 180];
  const fg   = [255, 255, 255];

  // Fill background
  for (let i = 0; i < sz * sz; i++) {
    rgba[i * 4] = bg[0]; rgba[i * 4 + 1] = bg[1];
    rgba[i * 4 + 2] = bg[2]; rgba[i * 4 + 3] = 255;
  }
  const px = (x, y, c) => {
    if (x < 0 || x >= sz || y < 0 || y >= sz) return;
    const i = (y * sz + x) * 4;
    rgba[i] = c[0]; rgba[i + 1] = c[1]; rgba[i + 2] = c[2];
  };
  const rect = (x1, y1, x2, y2, c) => {
    for (let x = x1; x <= x2; x++) for (let y = y1; y <= y2; y++) px(x, y, c);
  };

  if (type === 'warning') {
    // Exclamation mark  !
    rect(14, 7, 17, 19, fg);   // bar
    rect(14, 22, 17, 25, fg);  // dot
  } else {
    // Simple calendar icon
    // Outer box
    for (let x = 5; x <= 26; x++) { px(x, 5, fg); px(x, 26, fg); }
    for (let y = 5; y <= 26; y++) { px(5, y, fg); px(26, y, fg); }
    // Header bar
    rect(6, 6, 25, 11, fg);
    // Date grid dots
    const cols = [9, 14, 19, 24]; const rows = [15, 20, 25];
    for (const r of rows) for (const c of cols) rect(c - 1, r - 1, c, r, fg);
  }

  return nativeImage.createFromBuffer(encodePNG(sz, sz, rgba), { scaleFactor: 2 });
}

// ─── Settings ─────────────────────────────────────────────────────────────────
const DEFAULTS = {
  quarters: [
    { y: 2025, m: 10, d: 25 },
    { y: 2026, m:  1, d: 25 },
    { y: 2026, m:  4, d: 25 },
    { y: 2026, m:  7, d: 25 },
    { y: 2026, m: 10, d: 25 }
  ],
  quarterLabels: ['FY26 Q1', 'FY26 Q2', 'FY26 Q3', 'FY26 Q4', 'FY27 Q1'],
  financialYear: 'FY26',
  syncURL: 'https://hawkinsmultimedia.com.au/endofquarter.html'
};

function loadSettings() {
  try {
    if (fs.existsSync(SETTINGS_PATH)) {
      return Object.assign({}, DEFAULTS, JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8')));
    }
  } catch (_) {}
  return Object.assign({}, DEFAULTS);
}

function saveSettings(s) {
  try { fs.writeFileSync(SETTINGS_PATH, JSON.stringify(s, null, 2), 'utf8'); }
  catch (_) {}
}

// ─── Quarter calculation ──────────────────────────────────────────────────────
function todayUTC() {
  const t = new Date();
  return Date.UTC(t.getFullYear(), t.getMonth(), t.getDate());
}

function quarterEndUTC(q) {
  return Date.UTC(q.y, q.m - 1, q.d); // month stored 1-based
}

function daysUntil(q) {
  return Math.max(0, Math.round((quarterEndUTC(q) - todayUTC()) / 86_400_000));
}

function weeksUntil(days) {
  return Math.floor(days / 7);
}

function currentQuarterIdx(quarters) {
  const now = todayUTC();
  for (let i = 0; i < quarters.length; i++) {
    if (quarterEndUTC(quarters[i]) >= now) return i;
  }
  return quarters.length - 1;
}

// ─── Computed state ───────────────────────────────────────────────────────────
function computeState(settings) {
  const idx   = currentQuarterIdx(settings.quarters);
  const days  = daysUntil(settings.quarters[idx]);
  const weeks = weeksUntil(days);
  const label = settings.quarterLabels[idx] || `Q${idx + 1}`;
  const warn  = idx === 4 && days < 70; // Q5 (FY27 Q1) < 70 days

  // Display quarter number: Q5 maps to "1" (it's FY27 Q1)
  const displayQ = idx === 4 ? 1 : idx + 1;

  // Tooltip text for tray
  const fy   = settings.quarterLabels[idx] ? settings.quarterLabels[idx].split(' ')[0] : settings.financialYear;
  const tip  = `${fy} Q${displayQ} · ${days}d remaining`;

  return { idx, days, weeks, label, warn, displayQ, fy, tip };
}

// ─── Web sync ─────────────────────────────────────────────────────────────────
function fetchURL(url) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    const req = mod.get(url, { timeout: 10000 }, res => {
      let body = '';
      res.on('data', d => body += d);
      res.on('end', () => resolve(body));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Request timed out')); });
  });
}

function parseQuartersFromHTML(html) {
  // Matches: FY26Q1 : 25/10/2025  (dd/mm/yyyy)
  const re = /FY(\d+)Q(\d)\s*:\s*(\d{2})\/(\d{2})\/(\d{4})/g;
  const found = [];
  let m;
  while ((m = re.exec(html)) !== null) {
    found.push({
      fyNum: parseInt(m[1], 10),
      q:     parseInt(m[2], 10),
      d:     parseInt(m[3], 10),
      mo:    parseInt(m[4], 10),
      y:     parseInt(m[5], 10),
      label: `FY${m[1]} Q${m[2]}`
    });
  }
  return found;
}

async function syncFromWeb(settings) {
  const html = await fetchURL(settings.syncURL);
  const found = parseQuartersFromHTML(html);
  if (found.length === 0) throw new Error('No quarter data found on page');

  // Reset to defaults then populate from web data
  const newQ  = settings.quarters.map(q => Object.assign({}, q));
  const newLbl = [...settings.quarterLabels];

  // Determine primary FY from first standard Q1 entry
  const primary = found.find(f => f.q === 1 && f.fyNum < 100);
  if (primary) settings.financialYear = `FY${primary.fyNum}`;

  for (const f of found) {
    // Map Q1–Q4 to slots 0–3; FY(n+1)Q1 goes to slot 4
    let slot = f.q - 1; // 0-based
    // If this is NEXT FY's Q1, put it in slot 4
    if (primary && f.fyNum > primary.fyNum && f.q === 1) slot = 4;
    if (slot >= 0 && slot < 5) {
      newQ[slot]   = { y: f.y, m: f.mo, d: f.d };
      newLbl[slot] = f.label;
    }
  }

  settings.quarters      = newQ;
  settings.quarterLabels = newLbl;
  return settings;
}

// ─── App globals ──────────────────────────────────────────────────────────────
let tray     = null;
let popup    = null;
let settings = null;
let timer    = null;
let iconNormal  = null;
let iconWarning = null;

// ─── Tray update ──────────────────────────────────────────────────────────────
function updateTray() {
  if (!tray) return;
  const state = computeState(settings);
  tray.setImage(state.warn ? iconWarning : iconNormal);
  tray.setToolTip(state.warn ? `⚠ ${state.tip}` : state.tip);
}

// ─── Push state to renderer ───────────────────────────────────────────────────
function pushToRenderer() {
  if (!popup || !popup.webContents) return;
  const state = computeState(settings);
  popup.webContents.send('update', {
    state,
    settings: {
      quarters:      settings.quarters,
      quarterLabels: settings.quarterLabels,
      financialYear: settings.financialYear,
      syncURL:       settings.syncURL,
      launchAtLogin: app.getLoginItemSettings().openAtLogin
    }
  });
}

// ─── Show / hide popup ────────────────────────────────────────────────────────
function getPopupPosition(winW, winH) {
  try {
    const tb = tray.getBounds();
    const { workArea } = screen.getDisplayNearestPoint({ x: tb.x, y: tb.y });
    let x = Math.round(tb.x + tb.width / 2 - winW / 2);
    // Taskbar at bottom → popup above; taskbar at top → popup below
    const y = tb.y > workArea.height / 2
      ? Math.round(tb.y - winH - 4)
      : Math.round(tb.y + tb.height + 4);
    x = Math.max(workArea.x, Math.min(x, workArea.x + workArea.width  - winW));
    return { x, y: Math.max(workArea.y, y) };
  } catch (_) {
    return { x: 100, y: 100 };
  }
}

function showPopup() {
  if (!popup) return;
  const [w, h] = popup.getContentSize();
  const { x, y } = getPopupPosition(w, h);
  popup.setPosition(x, y);
  pushToRenderer();
  popup.show();
  popup.focus();
}

function hidePopup() {
  if (popup) popup.hide();
}

// ─── Create popup window ──────────────────────────────────────────────────────
function createPopup() {
  popup = new BrowserWindow({
    width:       340,
    height:      260,
    frame:       false,
    resizable:   false,
    movable:     false,
    skipTaskbar: true,
    show:        false,
    alwaysOnTop: true,
    backgroundColor: '#F3F3F3',
    webPreferences: {
      preload:          path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration:  false,
      devTools:         false
    }
  });

  popup.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  popup.on('blur', hidePopup);
}

// ─── Create tray ──────────────────────────────────────────────────────────────
function createTray() {
  iconNormal  = makeIcon('normal');
  iconWarning = makeIcon('warning');

  tray = new Tray(iconNormal);
  tray.setToolTip('End of Quarter Countdown');

  tray.on('click', () => {
    if (popup && popup.isVisible()) { hidePopup(); }
    else { showPopup(); }
  });

  // Right-click context menu (quick quit)
  tray.on('right-click', () => {
    const menu = Menu.buildFromTemplate([
      { label: 'Show', click: showPopup },
      { type: 'separator' },
      { label: 'Quit', click: () => app.quit() }
    ]);
    tray.popUpContextMenu(menu);
  });

  updateTray();
}

// ─── Refresh timer (10 min) ───────────────────────────────────────────────────
function scheduleRefresh() {
  if (timer) clearInterval(timer);
  timer = setInterval(() => {
    updateTray();
    if (popup && popup.isVisible()) pushToRenderer();
  }, 10 * 60 * 1000);
}

// ─── IPC handlers ─────────────────────────────────────────────────────────────
ipcMain.handle('get-data', () => {
  const state = computeState(settings);
  return {
    state,
    settings: {
      quarters:      settings.quarters,
      quarterLabels: settings.quarterLabels,
      financialYear: settings.financialYear,
      syncURL:       settings.syncURL,
      launchAtLogin: app.getLoginItemSettings().openAtLogin
    }
  };
});

ipcMain.handle('save-quarters', (_, quarters) => {
  settings.quarters = quarters;
  saveSettings(settings);
  updateTray();
  return computeState(settings);
});

ipcMain.handle('save-labels', (_, labels) => {
  settings.quarterLabels = labels;
  saveSettings(settings);
  return true;
});

ipcMain.handle('save-sync-url', (_, url) => {
  settings.syncURL = url;
  saveSettings(settings);
  return true;
});

ipcMain.handle('sync-from-web', async () => {
  try {
    settings = await syncFromWeb(settings);
    saveSettings(settings);
    updateTray();
    return { ok: true, state: computeState(settings), settings };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('set-launch-at-login', (_, val) => {
  app.setLoginItemSettings({ openAtLogin: val, openAsHidden: true });
  return app.getLoginItemSettings().openAtLogin;
});

ipcMain.handle('resize-window', (_, height) => {
  if (!popup) return;
  const { x, y } = getPopupPosition(340, height);
  popup.setBounds({ x, y, width: 340, height });
});

ipcMain.handle('open-email', () => {
  shell.openExternal('mailto:ian@hawkinsmultimedia.net');
});

ipcMain.handle('quit', () => app.quit());

// ─── App lifecycle ────────────────────────────────────────────────────────────
app.setName('End of Quarter Countdown');
// Prevent dock icon on macOS (dev/testing)
if (process.platform === 'darwin') app.dock && app.dock.hide();

app.whenReady().then(() => {
  settings = loadSettings();
  createTray();
  createPopup();
  scheduleRefresh();
});

app.on('window-all-closed', e => e.preventDefault()); // keep running in tray

app.on('second-instance', () => showPopup());
