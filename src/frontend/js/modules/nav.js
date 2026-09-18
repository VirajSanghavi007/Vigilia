import { state } from './state.js';
import { renderDashboard } from './dashboard.js';
import { startLiveFeedPolling, stopLiveFeedPolling } from './livefeed.js';
import { renderSidebar, renderInvestigateEmpty } from './investigate.js';
import { renderCaseManager } from './cases.js';
import { loadWhitelist } from './whitelist.js';

/* ════════════════════════════════════════════
   VIEW SWITCHING
════════════════════════════════════════════ */
export function showView(name) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
  document.getElementById(`view-${name}`).classList.add('active');
  [...document.querySelectorAll('.nav-tab')].find(t =>
    t.textContent.toLowerCase().includes(name.replace('_',' ').split(' ')[0])
  )?.classList.add('active');

  // Only poll the live feed while the Dashboard is on screen.
  if (name === 'dashboard') { renderDashboard(); startLiveFeedPolling(); }
  else stopLiveFeedPolling();
  if (name === 'investigate') {
    renderSidebar();
    // Do NOT auto-load an alert — show empty state so user picks from the list
    if (!state.currentAlert) renderInvestigateEmpty();
  }
  if (name === 'cases')       renderCaseManager();
  if (name === 'whitelist') {
    showSkeleton('wl-accounts-list', 3);
    showSkeleton('wl-banks-list', 2);
    showSkeleton('wl-rules-list', 3);
    showSkeleton('suppressed-tbody', 3, 'row');
    loadWhitelist();
  }
}

// Simple shimmering placeholder rows/blocks shown while a view's data loads,
// so slower views (Case Manager re-filter, Whitelist's two network calls)
// don't sit on a blank panel.
export function showSkeleton(elId, count = 3, kind = 'block') {
  const el = document.getElementById(elId);
  if (!el) return;
  const item = kind === 'row'
    ? '<tr><td colspan="8"><div class="skeleton-bar" style="width:100%;height:14px"></div></td></tr>'
    : '<div class="skeleton-bar" style="width:100%;height:36px;margin-bottom:8px;border-radius:6px"></div>';
  el.innerHTML = item.repeat(count);
}
