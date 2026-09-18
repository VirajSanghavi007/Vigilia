import { state } from './state.js';
import { showView } from './nav.js';
import { loadAlertById } from './investigate.js';
import { closeHelp } from './theme.js';

/* ════════════════════════════════════════════
   GUIDED PRODUCT TOUR
════════════════════════════════════════════ */
export const TOUR_STEPS = [
  { view:'dashboard',   sel:null,                       title:'Welcome to Argus', body:'A quick tour of how the platform spots money laundering. Takes under a minute — and you can replay it anytime from ⚙️ Settings.' },
  { view:'dashboard',   sel:'.nav-tabs',                title:'Six workspaces', body:'Dashboard, Investigate, Search, Case Manager, Whitelist and Predict. We\'ll pass through each one.' },
  { view:'dashboard',   sel:'.db-grid-4',               title:'The big picture', body:'Live totals at a glance: alerts raised, money flagged, high-severity cases, and decisions made.' },
  { view:'dashboard',   sel:'#risky-accounts',          title:'Top Risky Accounts', body:'Accounts ranked by the strongest laundering signal on any transfer they touch. Click a row to investigate that account directly.' },
  { view:'investigate', sel:'#alert-list',              title:'Alerts to investigate', body:'Each card is a cluster of suspicious transfers — always 3 or more accounts. Pick one to dig in.' },
  { view:'investigate', sel:'#inv-date-start',          title:'Filter by date', body:'Narrow the list to a specific activity window — useful when you\'re working a known time period.' },
  { view:'investigate', sel:'#cy',                       title:'The money network', body:'Accounts are dots, transfers are arrows. Hover for details, click a node for its account panel, or right-click for its full transaction graph.' },
  { view:'investigate', sel:'#ir-pattern-sec',          title:'Why it\'s flagged', body:'Concrete red flags — structuring, pass-through mules, velocity, cross-currency — not just the network shape. It\'s the combination of signals that matters.' },
  { view:'investigate', sel:'#view-investigate .dec-btns', title:'Make the call', body:'You\'re the analyst: Confirm, mark for Review, or Dismiss. Every decision is logged to the audit trail.' },
  { view:'search',      sel:'#acct-search-inp',         title:'Account Search', body:'Search any account that shows up in a flagged transaction. See its direct counterparties, and their counterparties too — 2 hops out.' },
  { view:'cases',       sel:'.cases-hdr',               title:'Case Manager', body:'Every decision you\'ve made, with reasons — your complete audit trail.' },
  { view:'whitelist',   sel:'.wl-grid',                 title:'Whitelist', body:'Exempt trusted accounts (like verified payroll) so they stop generating alerts.' },
  { view:'predict',     sel:'.nav-tabs',                title:'Predict', body:'Upload your own CSV or Excel of transactions and have the model score them on demand.' },
  { view:'dashboard',   sel:'#settings-btn',            title:'Settings & Help', body:'Theme, a beginner-friendly Help & Guide, and this tour all live here. That\'s the tour — happy hunting! ⚡' },
];
let _tourIdx = -1;

function _tourEls() {
  let hl = document.getElementById('tour-highlight');
  let tip = document.getElementById('tour-tip');
  if (!hl) { hl = document.createElement('div'); hl.id = 'tour-highlight'; document.body.appendChild(hl); }
  if (!tip) { tip = document.createElement('div'); tip.id = 'tour-tip'; document.body.appendChild(tip); }
  return { hl, tip };
}

export function startTour() {
  const pop = document.getElementById('settings-popover');
  if (pop) pop.style.display = 'none';
  closeHelp();
  _tourIdx = 0;
  _renderTourStep();
}

export function endTour() {
  _tourIdx = -1;
  document.getElementById('tour-highlight')?.remove();
  document.getElementById('tour-tip')?.remove();
  localStorage.setItem('argus-tour-done', '1');
}

export function tourNext() { if (_tourIdx < TOUR_STEPS.length - 1) { _tourIdx++; _renderTourStep(); } else { endTour(); } }
export function tourPrev() { if (_tourIdx > 0) { _tourIdx--; _renderTourStep(); } }

async function _renderTourStep() {
  if (_tourIdx < 0 || _tourIdx >= TOUR_STEPS.length) return;
  const step = TOUR_STEPS[_tourIdx];
  if (step.view) showView(step.view);
  // Make the investigate steps meaningful by loading the top alert.
  if (step.view === 'investigate' && !state.currentAlert && state.allAlerts.length) {
    try { await loadAlertById(state.allAlerts[0].id); } catch (e) {}
  }
  // Let the view paint before measuring.
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  if (_tourIdx < 0) return; // ended while waiting

  const { hl, tip } = _tourEls();
  const el = step.sel ? document.querySelector(step.sel) : null;
  let rect = null;
  if (el && el.getClientRects().length) {
    el.scrollIntoView({ block: 'center', inline: 'nearest' });
    rect = el.getBoundingClientRect();
  }

  if (rect && rect.width && rect.height) {
    const pad = 6;
    hl.style.display = 'block';
    hl.style.top = (rect.top - pad) + 'px';
    hl.style.left = (rect.left - pad) + 'px';
    hl.style.width = (rect.width + pad * 2) + 'px';
    hl.style.height = (rect.height + pad * 2) + 'px';
  } else {
    // Centered, full-dim step (e.g. welcome): zero-size highlight keeps the dim backdrop.
    hl.style.display = 'block';
    hl.style.top = '50%'; hl.style.left = '50%';
    hl.style.width = '0px'; hl.style.height = '0px';
  }

  const dots = TOUR_STEPS.map((_, i) => `<span class="tour-dot ${i === _tourIdx ? 'on' : ''}"></span>`).join('');
  const last = _tourIdx === TOUR_STEPS.length - 1;
  tip.innerHTML = `
    <div class="tour-step">Step ${_tourIdx + 1} of ${TOUR_STEPS.length}</div>
    <h4>${step.title}</h4>
    <p>${step.body}</p>
    <div class="tour-nav">
      <div class="tour-dots">${dots}</div>
      <div class="tour-btns">
        <button class="tour-skip" onclick="endTour()">Skip</button>
        ${_tourIdx > 0 ? '<button onclick="tourPrev()">Back</button>' : ''}
        <button class="tour-primary" onclick="tourNext()">${last ? 'Done' : 'Next'}</button>
      </div>
    </div>`;

  // Position the tip: prefer below the target, flip above if it would overflow, clamp to viewport.
  tip.style.visibility = 'hidden';
  tip.style.top = '0px'; tip.style.left = '0px';
  await new Promise(r => requestAnimationFrame(r));
  const tw = tip.offsetWidth, th = tip.offsetHeight;
  const vw = window.innerWidth, vh = window.innerHeight, gap = 14;
  let top, left;
  if (rect && rect.width && rect.height) {
    if (rect.bottom + gap + th <= vh) top = rect.bottom + gap;
    else if (rect.top - gap - th >= 0) top = rect.top - gap - th;
    else top = Math.max(gap, (vh - th) / 2);
    left = rect.left + rect.width / 2 - tw / 2;
  } else {
    top = (vh - th) / 2; left = (vw - tw) / 2;
  }
  left = Math.min(Math.max(gap, left), vw - tw - gap);
  top = Math.min(Math.max(gap, top), vh - th - gap);
  tip.style.top = top + 'px';
  tip.style.left = left + 'px';
  tip.style.visibility = 'visible';
}

export function maybeAutoTour() {
  if (localStorage.getItem('argus-tour-done')) return;
  if (!state.allAlerts.length) return;
  setTimeout(() => { if (_tourIdx < 0) startTour(); }, 900);
}
