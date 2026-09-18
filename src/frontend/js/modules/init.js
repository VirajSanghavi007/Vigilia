import { state } from './state.js';
import { apiFetch } from './api.js';
import { toast } from './toast.js';
import { startLoadingAnimation, stopLoadingAnimation } from './intro.js';
import { renderDashboard } from './dashboard.js';
import { startLiveFeedPolling, renderLiveFeed } from './livefeed.js';
import { renderSidebar } from './investigate.js';
import { renderCaseManager } from './cases.js';
import { maybeAutoTour } from './tour.js';

export function clearAppShellGuard() {
  for (const style of document.querySelectorAll('style')) {
    if (style.textContent.includes('display: none !important')) style.remove();
  }
}

export function showInitError(message) {
  clearAppShellGuard();
  stopLoadingAnimation();

  const ov = document.getElementById('loading-overlay');
  if (ov) ov.style.display = 'none';

  const main = document.querySelector('main');
  if (main) {
    main.innerHTML = `
      <div style="padding:32px;max-width:720px;margin:0 auto;font-family:var(--sans)">
        <h2 style="font-size:20px;margin-bottom:8px;color:var(--red)">Frontend could not load data</h2>
        <p style="color:var(--muted);line-height:1.6">${message}</p>
      </div>`;
  }
}

/* ════════════════════════════════════════════
   INIT — loading stages
════════════════════════════════════════════ */
const STAGES = ['ls-0','ls-1','ls-2','ls-3','ls-4'];
const BAR_PCTS = [10, 30, 60, 85, 100];
const STAGE_DELAYS = [0, 300, 600, 900, 1200];

function setStage(idx) {
  STAGES.forEach((id, i) => {
    const el = document.getElementById(id);
    const dot = el.querySelector('.load-stage-dot');
    el.classList.remove('active','done');
    dot.classList.remove('active','done');
    if (i < idx)      { el.classList.add('done'); dot.classList.add('done'); }
    else if (i === idx){ el.classList.add('active'); dot.classList.add('active'); }
  });
  document.getElementById('load-bar').style.width = BAR_PCTS[Math.min(idx,4)] + '%';
}

export async function init() {
  startLoadingAnimation();
  try {
    const statusData = await pollUntilReady();
    state.activityBins = statusData?.activity_bins || null;
    await loadAllAlerts();

    clearAppShellGuard();
    stopLoadingAnimation();
    const ov = document.getElementById('loading-overlay');
    ov.style.transition = 'opacity .6s ease';
    ov.style.opacity = '0';
    setTimeout(() => ov.style.display = 'none', 600);
    document.getElementById('nav-user').style.display = 'none';
    renderDashboard();
    startLiveFeedPolling();  // Dashboard is the default view on load
    renderSidebar();
    maybeAutoTour();
  } catch (e) {
    showInitError(e.message || 'Unexpected initialization error.');
  }
}

export async function pollUntilReady() {
  let lastCount = 0;
  const statusDot = document.getElementById('status-dot');
  const statusLabel = document.getElementById('status-label');
  while (true) {
    try {
      const r = await apiFetch('/status').catch(() => null);
      if (r && r.ok) {
        const d = await r.json();
        setStage(d.alert_count > 0 ? (d.alert_count !== lastCount ? 2 : 1) : 1);
        lastCount = d.alert_count;
        if (d.status === 'error') {
          if (statusDot) { statusDot.className = 'status-dot'; statusDot.style.background = 'var(--red)'; }
          if (statusLabel) statusLabel.textContent = 'Pipeline error';
          document.querySelector('.load-sub').textContent = d.error || 'Pipeline failed to start.';
          document.querySelector('.load-sub').style.color = 'var(--red)';
          return d;
        }
        if (d.status === 'ready') {
          if (statusDot) statusDot.className = 'status-dot ready';
          if (statusLabel) statusLabel.textContent =
            `Live · ${d.alert_count} alerts | L:${d.labelled_count} U:${d.unlabelled_count} ∩:${d.overlap_count}`;
          return d;
        }
      }
    } catch(e) {}
    await sleep(1000);
  }
}

export async function loadAllAlerts() {
  const r = await apiFetch('/alerts');
  if (r.status === 401) throw new Error('Your login did not create a valid backend session. Try UBI-AML-2026 / admin / admin123, or check the auth service.');
  if (!r.ok) throw new Error(`Alerts endpoint failed with HTTP ${r.status}.`);
  state.allAlerts = await r.json();
  if (!Array.isArray(state.allAlerts)) throw new Error('Alerts endpoint returned an unexpected payload.');
  await loadDecisions();
}

// Live in-app refresh: re-pull alerts/decisions/feed and rerender the active
// view WITHOUT reloading the page — so the session (and current view) survive
// and the analyst watches counts/patterns move up as new data lands.
export async function refreshData() {
  const icon = document.getElementById('refresh-icon');
  const btn  = document.getElementById('refresh-btn');
  if (icon) icon.classList.add('spinning');
  if (btn)  btn.disabled = true;
  const before = state.allAlerts.length;
  try {
    await loadAllAlerts();  // refetches /alerts + /decisions, reuses the session token
    const active = document.querySelector('.view.active')?.id || '';
    if (active === 'view-dashboard')        renderDashboard();
    else if (active === 'view-investigate') renderSidebar();
    else if (active === 'view-cases')       renderCaseManager();
    renderLiveFeed();  // always refresh the ingestion feed + count
    const delta = state.allAlerts.length - before;
    toast(delta > 0
      ? `Refreshed — ${delta} new alert(s) · ${state.allAlerts.length} total`
      : `Refreshed · ${state.allAlerts.length} alerts`, delta > 0 ? 'success' : 'info');
  } catch (e) {
    toast(`Refresh failed: ${e.message || 'unknown error'}`, 'error');
  } finally {
    if (icon) icon.classList.remove('spinning');
    if (btn)  btn.disabled = false;
  }
}

// Hydrate analyst decisions from the persistent audit log so they survive restarts.
export async function loadDecisions() {
  try {
    const r = await apiFetch('/decisions');
    if (r.ok) state.decisions = await r.json();
  } catch (e) { /* non-fatal — decisions stay empty */ }
}

export function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
