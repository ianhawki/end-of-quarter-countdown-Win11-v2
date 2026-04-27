'use strict';

const {
  app, BrowserWindow, Tray, Menu, nativeImage,
  ipcMain, shell, screen
} = require('electron');
const path  = require('path');
const fs    = require('fs');
const https = require('https');
const http  = require('http');

if (!app.requestSingleInstanceLock()) { app.quit(); process.exit(0); }

const SETTINGS_PATH = path.join(app.getPath('userData'), 'settings.json');
const ICON_PATH     = path.join(__dirname, 'assets', 'icon.ico');

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

function isQuarter(q) {
  return q && Number.isInteger(q.y) && Number.isInteger(q.m) && Number.isInteger(q.d)
    && q.m >= 1 && q.m <= 12 && q.d >= 1 && q.d <= 31;
}

function sanitizeSettings(parsed) {
  const out = { ...DEFAULTS };
  if (!parsed || typeof parsed !== 'object') return out;

  if (Array.isArray(parsed.quarters) && parsed.quarters.length === 5
      && parsed.quarters.every(isQuarter)) {
    out.quarters = parsed.quarters.map(q => ({ y: q.y, m: q.m, d: q.d }));
  }
  if (Array.isArray(parsed.quarterLabels) && parsed.quarterLabels.length === 5
      && parsed.quarterLabels.every(l => typeof l === 'string')) {
    out.quarterLabels = [...parsed.quarterLabels];
  }
  if (typeof parsed.financialYear === 'string' && parsed.financialYear.trim()) {
    out.financialYear = parsed.financialYear.trim();
  }
  if (typeof parsed.syncURL === 'string' && /^https?:\/\//.test(parsed.syncURL)) {
    out.syncURL = parsed.syncURL;
  }
  return out;
}

function loadSettings() {
  try {
    if (fs.existsSync(SETTINGS_PATH)) {
      return sanitizeSettings(JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8')));
    }
  } catch (_) { /* fall through to defaults */ }
  return { ...DEFAULTS };
}

function saveSettings(s) {
  try { fs.writeFileSync(SETTINGS_PATH, JSON.stringify(s, null, 2), 'utf8'); }
  catch (_) { /* best-effort */ }
}

// ─── Quarter calculation ──────────────────────────────────────────────────────
function todayUTC() {
  const t = new Date();
  return Date.UTC(t.getFullYear(), t.getMonth(), t.getDate());
}

function quarterEndUTC(q) {
  return Date.UTC(q.y, q.m - 1, q.d);
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

function computeState(settings) {
  const idx   = currentQuarterIdx(settings.quarters);
  const days  = daysUntil(settings.quarters[idx]);
  const weeks = weeksUntil(days);
  const label = settings.quarterLabels[idx] || `Q${idx + 1}`;
  const warn  = idx === 4 && days < 70;
  const displayQ = idx === 4 ? 1 : idx + 1;
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

  const newQ  = settings.quarters.map(q => ({ ...q }));
  const newLbl = [...settings.quarterLabels];

  const primary = found.find(f => f.q === 1 && f.fyNum < 100);
  if (primary) settings.financialYear = `FY${primary.fyNum}`;

  for (const f of found) {
    let slot = f.q - 1;
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
let trayIcon = null;

// ─── Render helpers ───────────────────────────────────────────────────────────
function buildPayload() {
  return {
    state: computeState(settings),
    settings: {
      quarters:      settings.quarters,
      quarterLabels: settings.quarterLabels,
      financialYear: settings.financialYear,
      syncURL:       settings.syncURL,
      launchAtLogin: app.getLoginItemSettings().openAtLogin
    },
    appVersion: app.getVersion()
  };
}

function updateTray() {
  if (!tray) return;
  const state = computeState(settings);
  tray.setToolTip(state.warn ? `⚠ ${state.tip}` : state.tip);
}

function pushToRenderer() {
  if (!popup || !popup.webContents) return;
  popup.webContents.send('update', buildPayload());
}

// ─── Popup positioning ───────────────────────────────────────────────────────
function getPopupPosition(winW, winH) {
  try {
    const tb = tray.getBounds();
    const { workArea } = screen.getDisplayNearestPoint({ x: tb.x, y: tb.y });
    let x = Math.round(tb.x + tb.width / 2 - winW / 2);
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

// ─── Window + tray ───────────────────────────────────────────────────────────
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
    icon: ICON_PATH,
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

function createTray() {
  trayIcon = nativeImage.createFromPath(ICON_PATH);
  tray = new Tray(trayIcon);
  tray.setToolTip('End of Quarter Countdown');

  tray.on('click', () => {
    if (popup && popup.isVisible()) { hidePopup(); }
    else { showPopup(); }
  });

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

function scheduleRefresh() {
  if (timer) clearInterval(timer);
  timer = setInterval(() => {
    updateTray();
    if (popup && popup.isVisible()) pushToRenderer();
  }, 10 * 60 * 1000);
}

// ─── IPC handlers ─────────────────────────────────────────────────────────────
ipcMain.handle('get-data', () => buildPayload());

ipcMain.handle('save-quarters', (_, quarters) => {
  if (!Array.isArray(quarters) || quarters.length !== 5 || !quarters.every(isQuarter)) {
    throw new Error('Invalid quarters payload');
  }
  settings.quarters = quarters;
  saveSettings(settings);
  updateTray();
  return computeState(settings);
});

ipcMain.handle('save-labels', (_, labels) => {
  if (!Array.isArray(labels) || labels.length !== 5) return false;
  settings.quarterLabels = labels;
  saveSettings(settings);
  return true;
});

ipcMain.handle('save-sync-url', (_, url) => {
  if (typeof url !== 'string' || !/^https?:\/\//.test(url)) return false;
  settings.syncURL = url;
  saveSettings(settings);
  return true;
});

ipcMain.handle('sync-from-web', async () => {
  try {
    settings = await syncFromWeb(settings);
    saveSettings(settings);
    updateTray();
    return { ok: true, ...buildPayload() };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('set-launch-at-login', (_, val) => {
  app.setLoginItemSettings({ openAtLogin: !!val, openAsHidden: true });
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

app.whenReady().then(() => {
  settings = loadSettings();
  createTray();
  createPopup();
  scheduleRefresh();
});

app.on('window-all-closed', e => e.preventDefault()); // keep running in tray
app.on('second-instance', () => showPopup());
