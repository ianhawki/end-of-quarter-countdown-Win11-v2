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

// Force userData to live under the display name, regardless of what the
// packaged package.json says. setName alone is not enough — Electron
// resolves paths from productName/name at app init, before our code runs.
app.setName('End of Quarter Countdown');
const USER_DATA_DIR = path.join(app.getPath('appData'), 'End of Quarter Countdown');
app.setPath('userData', USER_DATA_DIR);
try { fs.mkdirSync(USER_DATA_DIR, { recursive: true }); } catch (_) {}

const SETTINGS_PATH = path.join(USER_DATA_DIR, 'settings.json');
const LOG_PATH      = path.join(USER_DATA_DIR, 'app.log');
const ICON_PATH     = path.join(__dirname, 'assets', 'icon.ico');

function log(...parts) {
  try {
    fs.appendFileSync(LOG_PATH, `[${new Date().toISOString()}] ${parts.join(' ')}\n`);
  } catch (_) { /* best-effort */ }
}

// One-time migration: copy settings.json from any earlier folder layout
// into the canonical USER_DATA_DIR, then remove the legacy folder.
function migrateLegacyUserData() {
  try {
    if (fs.existsSync(SETTINGS_PATH)) { log('migrate: skip (new exists)'); return; }
    const legacyDir  = path.join(app.getPath('appData'), 'end-of-quarter-countdown');
    const legacyFile = path.join(legacyDir, 'settings.json');
    if (!fs.existsSync(legacyFile)) { log('migrate: skip (no legacy)'); return; }
    fs.copyFileSync(legacyFile, SETTINGS_PATH);
    log('migrate: copied', legacyFile, '->', SETTINGS_PATH);
    try { fs.rmSync(legacyDir, { recursive: true, force: true }); log('migrate: removed legacy dir'); }
    catch (e) { log('migrate: legacy rm failed:', e.message); }
  } catch (e) { log('migrate: error:', e.message); }
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
  syncURL: 'https://hawkinsmultimedia.com.au/endofquarter.html',
  businessDays: false,
  lastSync: null
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
  if (typeof parsed.businessDays === 'boolean') {
    out.businessDays = parsed.businessDays;
  }
  if (typeof parsed.lastSync === 'string' || parsed.lastSync === null) {
    out.lastSync = parsed.lastSync;
  }
  return out;
}

function loadSettings() {
  try {
    if (fs.existsSync(SETTINGS_PATH)) {
      return { settings: sanitizeSettings(JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8'))), firstRun: false };
    }
  } catch (_) { /* fall through to defaults */ }
  return { settings: { ...DEFAULTS }, firstRun: true };
}

function saveSettings(s) {
  try { fs.writeFileSync(SETTINGS_PATH, JSON.stringify(s, null, 2), 'utf8'); }
  catch (_) { /* best-effort */ }
}

// ─── Date helpers (local time) ───────────────────────────────────────────────
const MS_PER_DAY = 86_400_000;

function todayLocal() {
  const t = new Date();
  return new Date(t.getFullYear(), t.getMonth(), t.getDate());
}

function quarterEndDate(q) {
  return new Date(q.y, q.m - 1, q.d);
}

function daysBetween(a, b) {
  return Math.round((b.getTime() - a.getTime()) / MS_PER_DAY);
}

function businessDaysBetween(a, b) {
  if (b <= a) return 0;
  let count = 0;
  const cur = new Date(a.getTime());
  while (cur < b) {
    const dow = cur.getDay();
    if (dow !== 0 && dow !== 6) count++;
    cur.setDate(cur.getDate() + 1);
  }
  return count;
}

function addDays(d, n) {
  const out = new Date(d.getTime());
  out.setDate(out.getDate() + n);
  return out;
}

function formatLongDate(d) {
  return d.toLocaleDateString('en-AU', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
  });
}

function formatShortDate(d) {
  return d.toLocaleDateString('en-AU', {
    day: 'numeric', month: 'short', year: 'numeric'
  });
}

function formatSyncTime(iso) {
  if (!iso) return null;
  try {
    return new Date(iso).toLocaleString('en-AU', {
      day: 'numeric', month: 'short', year: 'numeric',
      hour: 'numeric', minute: '2-digit', hour12: true
    });
  } catch (_) { return null; }
}

// ─── Quarter math ─────────────────────────────────────────────────────────────
function currentQuarterIdx(quarters) {
  const today = todayLocal();
  for (let i = 0; i < quarters.length; i++) {
    if (quarterEndDate(quarters[i]) >= today) return i;
  }
  return quarters.length - 1;
}

function quarterStart(quarters, idx) {
  if (idx > 0) {
    return addDays(quarterEndDate(quarters[idx - 1]), 1);
  }
  // First quarter — fall back to 90 days before its end
  return addDays(quarterEndDate(quarters[0]), -90);
}

// ─── State for renderer ──────────────────────────────────────────────────────
function computeState(settings) {
  const quarters = settings.quarters;
  const today    = todayLocal();
  const idx      = currentQuarterIdx(quarters);
  const qEnd     = quarterEndDate(quarters[idx]);
  const qStart   = quarterStart(quarters, idx);

  const totalDays     = Math.max(1, daysBetween(qStart, qEnd));
  const daysIntoQ     = Math.max(0, daysBetween(qStart, today));
  const dayOfQ        = Math.min(totalDays, daysIntoQ + 1);

  const calendarDaysRemaining = Math.max(0, daysBetween(today, qEnd));
  const businessDaysRemaining = businessDaysBetween(today, qEnd);

  const days  = settings.businessDays ? businessDaysRemaining : calendarDaysRemaining;
  const weeks = Math.floor(days / (settings.businessDays ? 5 : 7));

  const weekInQ = Math.max(1, Math.ceil(dayOfQ / 7));
  const progressPct = Math.min(100, Math.floor((daysIntoQ / totalDays) * 100));

  const warn      = idx === 4 && calendarDaysRemaining < 70;
  const displayQ  = idx === 4 ? 1 : idx + 1;
  const fy        = settings.quarterLabels[idx] ? settings.quarterLabels[idx].split(' ')[0] : settings.financialYear;
  const bdSuffix  = settings.businessDays ? 'bd' : '';
  const tip       = `${fy} Q${displayQ} · ${days}d${bdSuffix ? ' ' + bdSuffix : ''} remaining`;

  return {
    idx, days, weeks, warn, displayQ, fy, tip,
    businessDays:    settings.businessDays,
    qEndLong:        formatLongDate(qEnd),
    qEndShort:       formatShortDate(qEnd),
    dayOfQuarter:    dayOfQ,
    totalQuarterDays: totalDays,
    weekInQuarter:   weekInQ,
    progressPct,
    calendarDaysRemaining,
    fyEndLong:       formatLongDate(quarterEndDate(quarters[3])),
    fyEndShort:      formatShortDate(quarterEndDate(quarters[3])),
    fyDaysRemaining: Math.max(0, daysBetween(today, quarterEndDate(quarters[3])))
  };
}

// ─── Web sync ─────────────────────────────────────────────────────────────────
function fetchURL(url) {
  return new Promise((resolve, reject) => {
    const mod  = url.startsWith('https') ? https : http;
    const opts = {
      headers: { 'User-Agent': `EndOfQuarterCountdown/${app.getVersion()}` }
    };
    let settled = false;
    const finish = (err, body) => {
      if (settled) return;
      settled = true;
      if (err) reject(err); else resolve(body);
    };

    const deadline = setTimeout(() => {
      try { req.destroy(); } catch (_) {}
      finish(new Error(`Could not reach ${new URL(url).hostname} within 15 seconds — check your network connection (VPN, proxy or firewall may be blocking it)`));
    }, 15000);

    const req = mod.get(url, opts, res => {
      if (res.statusCode < 200 || res.statusCode >= 300) {
        clearTimeout(deadline);
        res.resume();
        finish(new Error(`Server returned HTTP ${res.statusCode} for ${url}`));
        return;
      }
      let body = '';
      res.on('data', d => body += d);
      res.on('end', () => { clearTimeout(deadline); finish(null, body); });
      res.on('error', e => { clearTimeout(deadline); finish(e); });
    });

    req.on('error', e => {
      clearTimeout(deadline);
      const host = (() => { try { return new URL(url).hostname; } catch (_) { return url; } })();
      let msg;
      switch (e.code) {
        case 'ENOTFOUND':    msg = `Could not resolve ${host} — DNS lookup failed`; break;
        case 'ECONNREFUSED': msg = `Connection refused by ${host}`; break;
        case 'ECONNRESET':   msg = `Connection to ${host} was reset`; break;
        case 'ETIMEDOUT':    msg = `Connection to ${host} timed out — check VPN/firewall`; break;
        case 'CERT_HAS_EXPIRED':
        case 'UNABLE_TO_VERIFY_LEAF_SIGNATURE':
          msg = `SSL certificate problem on ${host}: ${e.code}`; break;
        default: msg = `Network error reaching ${host}: ${e.message}`;
      }
      finish(new Error(msg));
    });
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
  const html  = await fetchURL(settings.syncURL);
  const found = parseQuartersFromHTML(html);
  if (found.length === 0) throw new Error('No quarter data found on page');

  const newQ   = settings.quarters.map(q => ({ ...q }));
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
  settings.lastSync      = new Date().toISOString();
  return settings;
}

// ─── App globals ──────────────────────────────────────────────────────────────
let tray         = null;
let popup        = null;
let trayRenderer = null;
let settings     = null;
let timer        = null;
let lastTZ       = null;
let trayReqId    = 0;
const pendingTrayRenders = new Map();

// ─── Payload + tray ──────────────────────────────────────────────────────────
function buildPayload() {
  return {
    state: computeState(settings),
    settings: {
      quarters:      settings.quarters,
      quarterLabels: settings.quarterLabels,
      financialYear: settings.financialYear,
      syncURL:       settings.syncURL,
      businessDays:  settings.businessDays,
      launchAtLogin: app.getLoginItemSettings().openAtLogin,
      lastSync:      settings.lastSync,
      lastSyncDisplay: formatSyncTime(settings.lastSync)
    },
    appVersion: app.getVersion()
  };
}

function renderTrayIcon(days, warn, bd) {
  if (!trayRenderer || !trayRenderer.webContents || trayRenderer.webContents.isLoading()) {
    return Promise.resolve(null);
  }
  return new Promise(resolve => {
    const id = ++trayReqId;
    pendingTrayRenders.set(id, resolve);
    trayRenderer.webContents.send('render-tray-icon', { id, days, warn, bd });
    setTimeout(() => {
      if (pendingTrayRenders.has(id)) {
        pendingTrayRenders.delete(id);
        resolve(null);
      }
    }, 2000);
  });
}

async function updateTray() {
  if (!tray) return;
  const state = computeState(settings);
  tray.setToolTip(state.warn ? `⚠ ${state.tip}` : state.tip);

  const dataUrl = await renderTrayIcon(state.days, state.warn, state.businessDays);
  if (!dataUrl) {
    log('updateTray: no dataUrl, keeping fallback icon');
    return;
  }
  const img = nativeImage.createFromDataURL(dataUrl);
  if (img.isEmpty()) {
    log('updateTray: dataUrl decoded to empty image, len=', dataUrl.length);
    return;
  }
  tray.setImage(img);
  log('updateTray: painted icon set, days=', state.days);
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
    width:       360,
    height:      720,
    frame:       false,
    resizable:   false,
    movable:     false,
    skipTaskbar: true,
    show:        false,
    alwaysOnTop: true,
    backgroundColor: '#161616',
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

function createTrayRenderer() {
  trayRenderer = new BrowserWindow({
    width:       64,
    height:      64,
    show:        false,
    frame:       false,
    skipTaskbar: true,
    webPreferences: {
      preload:          path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration:  false,
      offscreen:        false
    }
  });
  trayRenderer.loadFile(path.join(__dirname, 'renderer', 'tray-icon.html'));
  trayRenderer.webContents.on('did-finish-load', () => {
    log('trayRenderer: did-finish-load');
    setTimeout(() => updateTray(), 100);
  });
  trayRenderer.webContents.on('did-fail-load', (_, code, desc) => {
    log('trayRenderer: did-fail-load', code, desc);
  });
}

function createTray() {
  tray = new Tray(nativeImage.createFromPath(ICON_PATH));
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

// ─── Refresh loop (1 min) — also detects timezone changes ────────────────────
function scheduleRefresh() {
  if (timer) clearInterval(timer);
  lastTZ = Intl.DateTimeFormat().resolvedOptions().timeZone;

  timer = setInterval(() => {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (tz !== lastTZ) {
      lastTZ = tz; // timezone change — recompute immediately
    }
    updateTray();
    if (popup && popup.isVisible()) pushToRenderer();
  }, 60 * 1000);
}

// ─── IPC ──────────────────────────────────────────────────────────────────────
ipcMain.handle('tray-icon-rendered', (_, { id, dataUrl }) => {
  const resolve = pendingTrayRenders.get(id);
  if (resolve) {
    pendingTrayRenders.delete(id);
    resolve(dataUrl);
  }
  return true;
});

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

ipcMain.handle('set-business-days', (_, val) => {
  settings.businessDays = !!val;
  saveSettings(settings);
  updateTray();
  return settings.businessDays;
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
  const { x, y } = getPopupPosition(360, height);
  popup.setBounds({ x, y, width: 360, height });
});

ipcMain.handle('open-email', () => {
  shell.openExternal('mailto:ian@hawkinsmultimedia.net');
});

ipcMain.handle('quit', () => app.quit());

// ─── App lifecycle ────────────────────────────────────────────────────────────
async function firstRunAutoSync() {
  try {
    settings = await syncFromWeb(settings);
    saveSettings(settings);
    updateTray();
    pushToRenderer();
  } catch (_) {
    // Silent fallback to defaults — user can sync manually later.
    // Persist defaults so we don't try to auto-sync again on next launch.
    saveSettings(settings);
  }
}

app.whenReady().then(() => {
  log('startup: userData=', app.getPath('userData'));
  migrateLegacyUserData();
  const loaded = loadSettings();
  log('loadSettings: firstRun=', loaded.firstRun);
  settings = loaded.settings;
  createTray();
  createPopup();
  createTrayRenderer();
  scheduleRefresh();

  if (loaded.firstRun) {
    setTimeout(firstRunAutoSync, 1500);
  }
});

app.on('window-all-closed', e => e.preventDefault());
app.on('second-instance', () => showPopup());
