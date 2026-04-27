'use strict';

// ─── Heights ──────────────────────────────────────────────────────────────────
const H_BASE         = 600;   // header + countdown + progress + cards + bd + footer
const EXTRA_WARN     = 80;    // warning banner
const EXTRA_EDITOR   = 240;   // editor panel

// ─── Element refs ─────────────────────────────────────────────────────────────
const fyBadge       = document.getElementById('fyBadge');
const subtitleText  = document.getElementById('subtitleText');
const bigNumber     = document.getElementById('bigNumber');
const daysWord      = document.getElementById('daysWord');
const weeksLabel    = document.getElementById('weeksLabel');
const quarterLabel  = document.getElementById('quarterLabel');
const endDateLabel  = document.getElementById('endDateLabel');

const progressPctEl = document.getElementById('progressPct');
const progressFill  = document.getElementById('progressFill');
const dayStartEl    = document.getElementById('dayStart');
const dayEndEl      = document.getElementById('dayEnd');

const weekNumberEl  = document.getElementById('weekNumber');
const fyEndDateEl   = document.getElementById('fyEndDate');
const fyEndSubEl    = document.getElementById('fyEndSub');

const warningBanner = document.getElementById('warningBanner');
const warnSyncBtn   = document.getElementById('warnSyncBtn');
const warnEditBtn   = document.getElementById('warnEditBtn');

const editor        = document.getElementById('editor');
const syncBtn       = document.getElementById('syncBtn');
const editBtn       = document.getElementById('editBtn');
const saveBtn       = document.getElementById('saveBtn');
const urlInput      = document.getElementById('urlInput');
const lastSyncTime  = document.getElementById('lastSyncTime');
const syncStatus    = document.getElementById('syncStatus');

const bdCheck       = document.getElementById('bdCheck');
const loginCheck    = document.getElementById('loginCheck');
const quitBtn       = document.getElementById('quitBtn');
const authorLink    = document.getElementById('authorLink');
const versionLabel  = document.getElementById('versionLabel');

const dateInputs = [0, 1, 2, 3, 4].map(i => document.getElementById(`d${i}`));
const lblEls     = [0, 1, 2, 3, 4].map(i => document.getElementById(`lbl${i}`));

// ─── State ────────────────────────────────────────────────────────────────────
let editorOpen = false;
let warningVisible = false;

// ─── Helpers ──────────────────────────────────────────────────────────────────
function pad2(n) { return String(n).padStart(2, '0'); }
function toInputDate(q) { return `${q.y}-${pad2(q.m)}-${pad2(q.d)}`; }
function fromInputDate(str) {
  const [y, m, d] = str.split('-').map(Number);
  return { y, m, d };
}

// ─── Render ───────────────────────────────────────────────────────────────────
function renderState({ state, settings, appVersion }) {
  // Version
  if (appVersion) versionLabel.textContent = `v${appVersion}`;

  // Header
  fyBadge.textContent = state.fy || settings.financialYear || 'FY';
  subtitleText.textContent = `Q${state.displayQ} FISCAL PERFORMANCE WINDOW`;

  // Big countdown number
  bigNumber.textContent = state.days;
  daysWord.textContent = state.days === 1 ? 'DAY' : 'DAYS';

  // Weeks line
  if (state.days >= 7) {
    const w = state.weeks;
    weeksLabel.textContent = `≈ ${w} ${w === 1 ? 'week' : 'weeks'} remaining`;
  } else {
    weeksLabel.textContent = '';
  }

  // Quarter + end-date lines
  quarterLabel.textContent = `${state.fy} · Q${state.displayQ}`;
  endDateLabel.textContent = state.qEndLong;

  // Progress
  progressPctEl.textContent = `${state.progressPct}%`;
  progressFill.style.width = `${state.progressPct}%`;
  dayStartEl.textContent = `DAY ${state.dayOfQuarter}`;
  dayEndEl.textContent = `DAY ${state.totalQuarterDays}`;

  // Info cards
  weekNumberEl.textContent = `Week ${state.weekInQuarter}`;
  fyEndDateEl.textContent = state.fyEndShort;
  fyEndSubEl.textContent = `${state.fyDaysRemaining} days remaining`;

  // Warning banner
  warningVisible = state.warn;
  warningBanner.style.display = state.warn ? 'block' : 'none';

  // Editor fields
  settings.quarters.forEach((q, i) => {
    dateInputs[i].value = toInputDate(q);
    lblEls[i].textContent = settings.quarterLabels[i] || `Q${i + 1}`;
  });
  urlInput.value = settings.syncURL || '';
  lastSyncTime.textContent = settings.lastSyncDisplay || 'never';

  // Checkboxes
  bdCheck.checked = !!settings.businessDays;
  loginCheck.checked = !!settings.launchAtLogin;

  resizeForCurrentMode();
}

function resizeForCurrentMode() {
  const warnExtra = warningVisible ? EXTRA_WARN : 0;
  const editExtra = editorOpen ? EXTRA_EDITOR : 0;
  window.api.resizeWindow(H_BASE + warnExtra + editExtra);
}

function setEditorOpen(open) {
  editorOpen = open;
  editor.style.display = open ? 'block' : 'none';
  clearSyncStatus();
  resizeForCurrentMode();
}

function clearSyncStatus() {
  syncStatus.textContent = '';
  syncStatus.className = '';
}
function setSyncStatus(msg, type) {
  syncStatus.textContent = msg;
  syncStatus.className = type || '';
}

// ─── Sync action (shared between header sync btn and warning banner btn) ─────
async function performSync() {
  syncBtn.classList.add('syncing');
  setSyncStatus('Syncing from web…', '');

  const result = await window.api.syncFromWeb();

  syncBtn.classList.remove('syncing');

  if (result.ok) {
    setSyncStatus('✓ Synced successfully', 'ok');
    renderState(result);
  } else {
    setSyncStatus(`✗ ${result.error}`, 'err');
  }
}

// ─── Event listeners ──────────────────────────────────────────────────────────
editBtn.addEventListener('click', () => setEditorOpen(!editorOpen));
syncBtn.addEventListener('click', performSync);

warnSyncBtn.addEventListener('click', performSync);
warnEditBtn.addEventListener('click', () => {
  if (!editorOpen) setEditorOpen(true);
});

saveBtn.addEventListener('click', async () => {
  const quarters = dateInputs.map(inp => inp.value ? fromInputDate(inp.value) : null).filter(Boolean);
  if (quarters.length !== 5) {
    setSyncStatus('Please fill in all 5 dates', 'err');
    return;
  }
  const url = urlInput.value.trim();
  if (url) await window.api.saveSyncURL(url);
  await window.api.saveQuarters(quarters);
  setSyncStatus('✓ Dates saved', 'ok');
  const data = await window.api.getData();
  renderState(data);
});

bdCheck.addEventListener('change', async () => {
  await window.api.setBusinessDays(bdCheck.checked);
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

window.api.onUpdate(data => renderState(data));

(async () => {
  const data = await window.api.getData();
  renderState(data);
})();
