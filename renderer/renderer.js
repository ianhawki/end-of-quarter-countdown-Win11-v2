'use strict';

// ─── Heights ──────────────────────────────────────────────────────────────────
const H_CLOSED = 258;   // no editor
const H_OPEN   = 490;   // editor visible

// ─── Element refs ─────────────────────────────────────────────────────────────
const fyBadge       = document.getElementById('fyBadge');
const bigNumber     = document.getElementById('bigNumber');
const unitLabel     = document.getElementById('unitLabel');
const weeksLabel    = document.getElementById('weeksLabel');
const quarterLabel  = document.getElementById('quarterLabel');
const warningBanner = document.getElementById('warningBanner');
const editor        = document.getElementById('editor');
const syncBtn       = document.getElementById('syncBtn');
const editBtn       = document.getElementById('editBtn');
const saveBtn       = document.getElementById('saveBtn');
const loginCheck    = document.getElementById('loginCheck');
const quitBtn       = document.getElementById('quitBtn');
const authorLink    = document.getElementById('authorLink');
const urlInput      = document.getElementById('urlInput');
const syncStatus    = document.getElementById('syncStatus');

const dateInputs = [0, 1, 2, 3, 4].map(i => document.getElementById(`d${i}`));
const lblEls     = [0, 1, 2, 3, 4].map(i => document.getElementById(`lbl${i}`));

// ─── State ────────────────────────────────────────────────────────────────────
let editorOpen = false;
let currentSettings = null;

// ─── Helpers ──────────────────────────────────────────────────────────────────
function pad2(n) { return String(n).padStart(2, '0'); }

/** Convert { y, m, d } to YYYY-MM-DD for <input type="date"> */
function toInputDate(q) {
  return `${q.y}-${pad2(q.m)}-${pad2(q.d)}`;
}

/** Convert YYYY-MM-DD string back to { y, m, d } */
function fromInputDate(str) {
  const [y, m, d] = str.split('-').map(Number);
  return { y, m, d };
}

// ─── Render state ─────────────────────────────────────────────────────────────
function renderState({ state, settings }) {
  currentSettings = settings;

  // FY badge + countdown numbers
  fyBadge.textContent = state.fy || settings.financialYear || 'FY';
  bigNumber.textContent = state.days;

  if (state.days === 1) {
    unitLabel.textContent = 'DAY LEFT';
  } else {
    unitLabel.textContent = 'DAYS LEFT';
  }

  // Weeks secondary label
  if (state.days >= 14) {
    const w = state.weeks;
    weeksLabel.textContent = `≈ ${w} ${w === 1 ? 'week' : 'weeks'}`;
  } else {
    weeksLabel.textContent = '';
  }

  // Quarter label under countdown
  const qNum = state.displayQ;
  const fyStr = state.fy || settings.financialYear;
  quarterLabel.textContent = `${fyStr} · Q${qNum}`;

  // Warning banner
  warningBanner.style.display = state.warn ? 'block' : 'none';

  // Populate editor fields
  settings.quarters.forEach((q, i) => {
    dateInputs[i].value = toInputDate(q);
    lblEls[i].textContent = settings.quarterLabels[i] || `Q${i + 1}`;
  });
  urlInput.value = settings.syncURL || '';

  // Launch at login checkbox
  loginCheck.checked = !!settings.launchAtLogin;

  // Resize if needed
  resizeForCurrentMode();
}

function resizeForCurrentMode() {
  // Account for warning banner height (~42px)
  const warnExtra = warningBanner.style.display !== 'none' ? 42 : 0;
  const base = editorOpen ? H_OPEN : H_CLOSED;
  window.api.resizeWindow(base + warnExtra);
}

// ─── Toggle editor ────────────────────────────────────────────────────────────
function setEditorOpen(open) {
  editorOpen = open;
  editor.style.display = open ? 'block' : 'none';
  editBtn.textContent = open ? '✕ Close' : '✎ Edit';
  clearSyncStatus();
  resizeForCurrentMode();
}

// ─── Sync status helpers ──────────────────────────────────────────────────────
function clearSyncStatus() {
  syncStatus.textContent = '';
  syncStatus.className = '';
}
function setSyncStatus(msg, type /* 'ok'|'err'|'' */) {
  syncStatus.textContent = msg;
  syncStatus.className = type || '';
}

// ─── Event listeners ──────────────────────────────────────────────────────────
editBtn.addEventListener('click', () => setEditorOpen(!editorOpen));

syncBtn.addEventListener('click', async () => {
  syncBtn.textContent = '↺ Syncing…';
  syncBtn.classList.add('syncing');
  setSyncStatus('Syncing from web…', '');

  const result = await window.api.syncFromWeb();

  syncBtn.textContent = '↺ Sync';
  syncBtn.classList.remove('syncing');

  if (result.ok) {
    setSyncStatus('✓ Synced successfully', 'ok');
    renderState(result);
  } else {
    setSyncStatus(`✗ ${result.error}`, 'err');
  }
});

saveBtn.addEventListener('click', async () => {
  // Collect dates from inputs
  const quarters = dateInputs.map(inp => {
    if (!inp.value) return null;
    return fromInputDate(inp.value);
  }).filter(Boolean);

  if (quarters.length !== 5) {
    setSyncStatus('Please fill in all 5 dates', 'err');
    return;
  }

  // Save URL
  const url = urlInput.value.trim();
  if (url) await window.api.saveSyncURL(url);

  // Save quarters
  const newState = await window.api.saveQuarters(quarters);
  setSyncStatus('✓ Dates saved', 'ok');

  // Refresh display (re-fetch full data)
  const data = await window.api.getData();
  renderState(data);
});

loginCheck.addEventListener('change', async () => {
  await window.api.setLaunchLogin(loginCheck.checked);
});

authorLink.addEventListener('click', e => {
  e.preventDefault();
  window.api.openEmail();
});

quitBtn.addEventListener('click', () => window.api.quit());

// ─── Push updates from main process ───────────────────────────────────────────
window.api.onUpdate(data => renderState(data));

// ─── Initial load ─────────────────────────────────────────────────────────────
(async () => {
  const data = await window.api.getData();
  renderState(data);
})();
