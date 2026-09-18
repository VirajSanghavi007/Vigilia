import { state } from './state.js';
import { apiFetch, API_BASE, API_CREDENTIALS, handleSessionExpired } from './api.js';
import { toast } from './toast.js';
import { fmtMoney } from './format.js';
import { loadAllAlerts, sleep } from './init.js';
import { renderSidebar } from './investigate.js';
import { renderDashboard } from './dashboard.js';

/* ════════════════════════════════════════════
   PREDICT (custom transaction scoring)
════════════════════════════════════════════ */
const PREDICT_MAX_ROWS = 1000;
const PREDICT_MAX_DISPLAY = 100;  // cap rows rendered in the results table
let predictAbort = null;
let predictTimer = null;

export function clearPredictInput() {
  const f = document.getElementById('predict-file');
  if (f) f.value = '';
  const d = document.getElementById('predict-data');
  if (d) d.value = '';
  const tbody = document.getElementById('predict-tbody');
  if (tbody) tbody.innerHTML = '';
  predictRows = []; predictShown = 0;
  const empty = document.getElementById('predict-empty');
  if (empty) { empty.textContent = 'No results yet. Run a prediction to see scores.'; empty.style.display = 'block'; }
  document.getElementById('predict-threshold').textContent = '';
}

export function cancelPrediction() {
  if (predictAbort) predictAbort.abort();
}

function _predictBusy(on) {
  document.getElementById('predict-run-btn').style.display = on ? 'none' : '';
  document.getElementById('predict-cancel-btn').style.display = on ? '' : 'none';
  document.getElementById('predict-progress-wrap').style.display = on ? 'block' : 'none';
  if (on) {
    const start = Date.now();
    const bar = document.getElementById('predict-progress-bar');
    let pct = 8;
    predictTimer = setInterval(() => {
      pct = Math.min(pct + Math.random() * 8, 92);        // creep toward 92% while waiting
      bar.style.width = pct + '%';
      document.getElementById('predict-progress-time').textContent =
        ((Date.now() - start) / 1000).toFixed(1) + 's';
    }, 200);
  } else {
    clearInterval(predictTimer); predictTimer = null;
    document.getElementById('predict-progress-bar').style.width = '100%';
  }
}

// Flagged rows from the most recent prediction, kept so the analyst can push
// them into the live system as labelled flagged transactions.
let lastPredictionFlagged = [];

// Send the last prediction's flagged rows through the same /ingest pipeline the
// n8n feed uses — they get stored, folded into a neighborhood rescore, and
// surface as alerts (Investigate) plus in the Dashboard Live Ingestion Feed.
export async function addPredictionsToSystem() {
  const btn = document.getElementById('predict-add-btn');
  if (!lastPredictionFlagged.length) { toast('No flagged transactions to add', 'warning'); return; }

  // Map the Predict (IBM) schema → the /ingest schema.
  const transactions = lastPredictionFlagged.map(tx => ({
    'From Bank': String(tx['From Bank'] ?? ''),
    'From Account': String(tx.Account ?? ''),
    'To Bank': String(tx['To Bank'] ?? ''),
    'To Account': String(tx['Account.1'] ?? ''),
    'Amount Paid': parseFloat(tx['Amount Paid']) || 0,
    'Payment Format': tx['Payment Format'] || 'Wire',
    'Receiving Currency': tx['Receiving Currency'] || 'US Dollar',
    'Timestamp': tx.Timestamp || new Date().toISOString(),
  }));

  if (btn) { btn.disabled = true; btn.textContent = 'Adding…'; }
  try {
    const r = await apiFetch('/ingest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ transactions }),
    });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || 'Ingest failed');
    const d = await r.json();
    toast(`Added ${d.stored} transaction(s) — detecting patterns…`, 'success');

    // The neighborhood-rescore runs in a background thread server-side. Give it
    // a moment, then reload alerts + rerender so the new pattern alerts and
    // their graphs appear automatically — no manual refresh ("restart auto").
    if (btn) btn.textContent = 'Detecting patterns…';
    const before = state.allAlerts.filter(a => a.source === 'live_ingest').length;
    await sleep(3000);
    try {
      await loadAllAlerts();
      renderSidebar();
      renderDashboard();
      const added = state.allAlerts.filter(a => a.source === 'live_ingest').length - before;
      toast(added > 0
        ? `${added} new alert(s) detected — see Investigate (tagged “Added”)`
        : 'Transactions stored; no new clusters cleared the detection threshold.',
        added > 0 ? 'success' : 'info');
    } catch (_) { /* refresh is best-effort */ }
    if (btn) { btn.textContent = `✓ Added ${d.stored}`; }
  } catch (e) {
    toast(`Could not add to system: ${e.message}`, 'error');
    if (btn) { btn.disabled = false; btn.textContent = `➕ Add ${lastPredictionFlagged.length} flagged to system`; }
  }
}

// Full prediction result set + how many rows are currently in the DOM.
// Rows render 100 at a time; the rest load as the user scrolls (infinite scroll).
let predictRows = [];
let predictShown = 0;
let predictInfo = { threshold: 0, scored: 0, flagged: 0 };

function _predictRowHtml(tx) {
  const flagged = tx.flagged
    ? '<span class="badge badge-red">⚑ Flagged</span>'
    : '<span class="badge badge-green">OK</span>';
  return `<tr class="${tx.flagged ? 'predict-row-flagged' : ''}">
    <td style="font-family:var(--mono);">${tx.Timestamp || ''}</td>
    <td>${tx['From Bank'] || ''}:${tx.Account || ''}</td>
    <td>${tx['To Bank'] || ''}:${tx['Account.1'] || ''}</td>
    <td style="color:var(--blue);font-family:var(--mono);font-weight:700">${fmtMoney(parseFloat(tx['Amount Paid']) || 0)}</td>
    <td>${tx['Payment Format'] || ''} / ${tx['Receiving Currency'] || ''}</td>
    <td>${flagged}</td>
  </tr>`;
}

// Append the next chunk of rows and update the "showing N of M" header note.
function renderMorePredictRows() {
  const tbody = document.getElementById('predict-tbody');
  if (!tbody || predictShown >= predictRows.length) return;
  const next = predictRows.slice(predictShown, predictShown + PREDICT_MAX_DISPLAY);
  tbody.insertAdjacentHTML('beforeend', next.map(_predictRowHtml).join(''));
  predictShown += next.length;

  const label = document.getElementById('predict-threshold');
  if (label) {
    const more = predictShown < predictRows.length ? ' · scroll for more' : '';
    label.textContent =
      `Model Threshold: ${predictInfo.threshold} · ${predictInfo.scored} scored · `
      + `${predictInfo.flagged} flagged · showing ${predictShown} of ${predictInfo.scored}${more}`;
  }
}

// Wire the Predict view's scroll once: when the user nears the bottom, load
// the next chunk. #view-predict is the scroll container (overflow-y:auto).
function _initPredictInfiniteScroll() {
  const view = document.getElementById('view-predict');
  if (!view || view._infiniteWired) return;
  view._infiniteWired = true;
  view.addEventListener('scroll', () => {
    if (predictShown < predictRows.length &&
        view.scrollTop + view.clientHeight >= view.scrollHeight - 240) {
      renderMorePredictRows();
    }
  });
}

export async function runPrediction() {
  const fileInput = document.getElementById('predict-file');
  const dataInput = document.getElementById('predict-data').value.trim();
  const tbody = document.getElementById('predict-tbody');
  const emptyMsg = document.getElementById('predict-empty');
  const thresholdLabel = document.getElementById('predict-threshold');

  if (!fileInput.files.length && !dataInput) {
    toast('Please upload a CSV/Excel file or paste CSV data', 'error');
    return;
  }

  // Client-side guards: reject JSON paste + over-limit row counts early.
  if (dataInput && !fileInput.files.length) {
    if (dataInput.startsWith('{') || dataInput.startsWith('[')) {
      toast('JSON is not accepted — paste CSV rows instead', 'error'); return;
    }
    const rows = dataInput.split(/\r?\n/).filter(l => l.trim()).length - 1; // minus header
    if (rows > PREDICT_MAX_ROWS) {
      toast(`Too many rows (${rows.toLocaleString()}). Max is ${PREDICT_MAX_ROWS.toLocaleString()}.`, 'error'); return;
    }
  }

  const formData = new FormData();
  if (fileInput.files.length > 0) formData.append('file', fileInput.files[0]);
  else if (dataInput) formData.append('data', dataInput);

  emptyMsg.style.display = 'none';
  thresholdLabel.textContent = '';
  tbody.innerHTML = '';
  predictAbort = new AbortController();
  _predictBusy(true);

  try {
    const res = await fetch(`${API_BASE}/predict`, {
      method: 'POST', body: formData, credentials: API_CREDENTIALS, signal: predictAbort.signal,
      headers: state.sessionToken ? { 'X-Session-Token': state.sessionToken } : {},
    });
    if (res.status === 401) { handleSessionExpired(); throw new Error('Session expired'); }
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || 'Prediction failed');
    }
    const data = await res.json();
    thresholdLabel.textContent = `Model Threshold: ${data.threshold}`;

    const addBtn = document.getElementById('predict-add-btn');
    if (addBtn) { addBtn.style.display = 'none'; addBtn.disabled = false; }
    lastPredictionFlagged = [];

    if (!data.transactions || data.transactions.length === 0) {
      tbody.innerHTML = '';
      emptyMsg.textContent = 'No transactions processed.';
      emptyMsg.style.display = 'block';
      return;
    }

    // Remember the flagged rows so the analyst can push them into the system.
    lastPredictionFlagged = data.transactions.filter(tx => tx.flagged);
    if (addBtn && lastPredictionFlagged.length) {
      addBtn.textContent = `➕ Add ${lastPredictionFlagged.length} flagged to system`;
      addBtn.style.display = 'inline-block';
    }

    // Render in chunks of 100 with infinite scroll (see renderMorePredictRows).
    predictRows = data.transactions;
    predictShown = 0;
    predictInfo = { threshold: data.threshold, scored: data.transactions.length, flagged: lastPredictionFlagged.length };
    tbody.innerHTML = '';
    renderMorePredictRows();          // first 100
    _initPredictInfiniteScroll();     // load the rest as the user scrolls

    // Clear the inputs now that the batch has been processed.
    document.getElementById('predict-data').value = '';
    document.getElementById('predict-file').value = '';

    toast('Prediction complete', 'success');
  } catch (err) {
    tbody.innerHTML = '';
    if (err.name === 'AbortError') {
      emptyMsg.textContent = 'Prediction cancelled.';
      toast('Prediction cancelled', 'info');
    } else {
      emptyMsg.textContent = `Error: ${err.message}`;
      toast(err.message, 'error');
    }
    emptyMsg.style.display = 'block';
  } finally {
    _predictBusy(false);
    predictAbort = null;
  }
}
