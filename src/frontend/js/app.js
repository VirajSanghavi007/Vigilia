/* ════════════════════════════════════════════
   SESSION TITLE
════════════════════════════════════════════ */
document.title = 'AML Intelligence Platform';

/* ════════════════════════════════════════════
   AUTHENTICATION
════════════════════════════════════════════ */
let authUser = null;
let sessionToken = localStorage.getItem('argus-session-token') || '';

// Auto-bypass login when backend runs in no-DB mode (HF / local without Postgres).
// /auth/me returns 200 with a synthetic user in that mode regardless of token.
(async function checkExistingSession() {
  try {
    const r = await fetch(`${typeof API_BASE !== 'undefined' ? API_BASE : ''}/auth/me`, {
      credentials: 'same-origin',
    });
    if (r.ok) {
      const user = await r.json();
      sessionToken = sessionToken || 'no-db';
      authUser = { companyId: user.company_id, name: user.username };
      completeAuth();
    }
  } catch (e) { /* network down — show login screen normally */ }
})();

async function authStep1() {
  const companyId = document.getElementById('auth-company-id').value.trim();
  const name      = document.getElementById('auth-name').value.trim();
  const password  = document.getElementById('auth-password').value;
  const submitBtn = document.querySelector('#auth-step1 .auth-submit');

  if (!companyId || !name || !password) {
    showAuthError('auth-error', 'All fields are required');
    return;
  }

  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = 'Authenticating...';
  }

  try {
    const r = await apiFetch('/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ company_id: companyId, username: name, password }),
    });

    if (!r.ok) {
      showAuthError('auth-error', 'Invalid credentials');
      return;
    }

    const session = await r.json();
    sessionToken = session.token || '';
    if (sessionToken) localStorage.setItem('argus-session-token', sessionToken);
    authUser = { companyId: session.company_id || companyId, name: session.username || name };
    completeAuth();
  } catch (e) {
    showAuthError('auth-error', 'Cannot reach authentication service');
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Authenticate';
    }
  }
}

function showAuthError(id, msg) {
  const el = document.getElementById(id);
  el.textContent = msg;
  el.style.display = 'block';
  setTimeout(() => el.style.display = 'none', 3000);
}

function completeAuth() {
  const screen = document.getElementById('auth-screen');
  screen.style.transition = 'opacity .5s ease';
  screen.style.opacity = '0';
  setTimeout(() => {
    screen.style.display = 'none';
    playCinematicIntro();
  }, 500);
}

/* ════════════════════════════════════════════
   CINEMATIC INTRO — movie-studio logo reveal
════════════════════════════════════════════ */
function playCinematicIntro() {
  const intro = document.getElementById('cinematic-intro');
  intro.style.display = 'flex';

  // Particle background
  const canvas = document.getElementById('cine-canvas');
  const ctx = canvas.getContext('2d');
  let w = canvas.width = window.innerWidth;
  let h = canvas.height = window.innerHeight;

  const particles = [];
  for (let i = 0; i < 80; i++) {
    particles.push({
      x: Math.random() * w, y: Math.random() * h,
      vx: (Math.random() - 0.5) * 0.3, vy: (Math.random() - 0.5) * 0.3,
      r: Math.random() * 1.5 + 0.5, alpha: Math.random() * 0.3 + 0.1,
    });
  }

  let cineFrame;
  function drawParticles() {
    ctx.clearRect(0, 0, w, h);
    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];
      // Connections
      for (let j = i + 1; j < particles.length; j++) {
        const q = particles[j];
        const dx = p.x - q.x, dy = p.y - q.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
                if (dist < 120) {
          ctx.beginPath();
          ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y);
          ctx.strokeStyle = `rgba(0, 87, 156, ${(1 - dist / 120) * 0.12})`;
          ctx.lineWidth = 0.5;
          ctx.stroke();
        }
      }
      // Dot
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(0, 87, 156, ${p.alpha})`;
      ctx.fill();
      p.x += p.vx; p.y += p.vy;
      if (p.x < 0 || p.x > w) p.vx *= -1;
      if (p.y < 0 || p.y > h) p.vy *= -1;
    }
    cineFrame = requestAnimationFrame(drawParticles);
  }
  drawParticles();

  // Animate elements in sequence
  const content = document.getElementById('cine-content');
  const shield  = content.querySelector('.cine-shield');
  const line    = document.getElementById('cine-line');
  const name    = document.getElementById('cine-name');
  const sub     = document.getElementById('cine-sub');
  const tagline = document.getElementById('cine-tagline');

  // Fade in content container
  setTimeout(() => { content.style.transition = 'opacity .4s ease'; content.style.opacity = '1'; }, 100);

  // Shield scales in
  setTimeout(() => {
    shield.style.transition = 'opacity .4s ease, transform .4s ease';
    shield.style.opacity = '1'; shield.style.transform = 'scale(1)';
  }, 150);

  // Bank name types in
  setTimeout(() => {
    name.style.transition = 'opacity .3s ease, transform .3s ease';
    name.style.opacity = '1'; name.style.transform = 'translateY(0)';
  }, 400);

  // Red-blue line extends
  setTimeout(() => { line.style.width = '280px'; }, 500);

  // Sub text
  setTimeout(() => {
    sub.style.transition = 'opacity .3s ease, transform .3s ease';
    sub.style.opacity = '1'; sub.style.transform = 'translateY(0)';
  }, 700);

  // Tagline
  setTimeout(() => {
    tagline.style.transition = 'opacity .3s ease';
    tagline.style.opacity = '1';
  }, 900);

  // Hold for a beat, then fade out → loading screen
  setTimeout(() => {
    cancelAnimationFrame(cineFrame);
    intro.style.transition = 'opacity .4s ease';
    intro.style.opacity = '0';
    setTimeout(() => {
      intro.style.display = 'none';
      init();
    }, 400);
  }, 1500);
}

/* ════════════════════════════════════════════
   LOADING SCREEN — particle network animation
════════════════════════════════════════════ */
let loadAnimFrame = null;

function startLoadingAnimation() {
  const canvas = document.getElementById('load-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  let w = canvas.width = window.innerWidth;
  let h = canvas.height = window.innerHeight;

  const particles = [];
  const PARTICLE_COUNT = 60;
  const CONNECTION_DIST = 150;

  for (let i = 0; i < PARTICLE_COUNT; i++) {
    particles.push({
      x: Math.random() * w,
      y: Math.random() * h,
      vx: (Math.random() - 0.5) * 0.6,
      vy: (Math.random() - 0.5) * 0.6,
      r: Math.random() * 2 + 1,
    });
  }

  function draw() {
    ctx.clearRect(0, 0, w, h);

    // Draw connections
    for (let i = 0; i < particles.length; i++) {
      for (let j = i + 1; j < particles.length; j++) {
        const dx = particles[i].x - particles[j].x;
        const dy = particles[i].y - particles[j].y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < CONNECTION_DIST) {
          const alpha = (1 - dist / CONNECTION_DIST) * 0.15;
          ctx.beginPath();
          ctx.moveTo(particles[i].x, particles[i].y);
          ctx.lineTo(particles[j].x, particles[j].y);
          ctx.strokeStyle = `rgba(0, 87, 156, ${alpha})`;
          ctx.lineWidth = 0.5;
          ctx.stroke();
        }
      }
    }

    // Draw particles
    for (const p of particles) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(0, 87, 156, 0.4)';
      ctx.fill();

      p.x += p.vx;
      p.y += p.vy;
      if (p.x < 0 || p.x > w) p.vx *= -1;
      if (p.y < 0 || p.y > h) p.vy *= -1;
    }

    loadAnimFrame = requestAnimationFrame(draw);
  }

  draw();

  // Show session info
  const infoEl = document.getElementById('load-session-info');
  if (infoEl && authUser) {
    const now = new Date();
    infoEl.textContent = `SESSION ${authUser.companyId} · ${authUser.name.toUpperCase()} · ${now.toISOString().replace('T',' ').slice(0,19)} UTC`;
  }
}

function stopLoadingAnimation() {
  if (loadAnimFrame) {
    cancelAnimationFrame(loadAnimFrame);
    loadAnimFrame = null;
  }
}

/* ════════════════════════════════════════════
   CONFIG
════════════════════════════════════════════ */
const API_BASE = (window.location.protocol === 'file:')
  ? 'http://localhost:8000'
  : '';
const API_CREDENTIALS = API_BASE ? 'include' : 'same-origin';

let _sessionExpiredHandled = false;

// Bounce back to the login screen when the session dies mid-use (expired
// token, server restart that dropped in-memory sessions, etc). Without this,
// every subsequent API call just silently 401s and the UI looks "stuck".
function handleSessionExpired() {
  if (_sessionExpiredHandled) return;
  _sessionExpiredHandled = true;
  localStorage.removeItem('argus-session-token');
  sessionToken = '';
  authUser = null;
  try { toast('Session expired — please log in again', 'error'); } catch (e) {}
  setTimeout(() => window.location.reload(), 800);
}

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

// For values interpolated into an inline event-handler attribute (e.g.
// onclick="fn('${...}')"): the browser decodes HTML entities *before*
// running the attribute as JS, so escapeHtml alone can't stop a `'` from
// closing the JS string early. Escape for JS-string context first, then
// HTML-escape the result so it's also safe as an attribute value.
function escapeJsAttr(str) {
  return escapeHtml(String(str ?? '').replace(/\\/g, '\\\\').replace(/'/g, "\\'"));
}

// Neutralize formula injection: a cell starting with =, +, -, or @ gets
// interpreted as a formula by Excel/Sheets when the CSV is opened.
function csvSafe(str) {
  const s = String(str ?? '');
  return /^[=+\-@]/.test(s) ? `'${s}` : s;
}

async function apiFetch(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (sessionToken) headers['X-Session-Token'] = sessionToken;
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
    credentials: API_CREDENTIALS,
  });
  // /auth/login itself returning 401 means "bad credentials", not "session
  // expired" — don't trigger the bounce loop for that one.
  if (res.status === 401 && !path.startsWith('/auth/login')) {
    handleSessionExpired();
  }
  return res;
}

function clearAppShellGuard() {
  for (const style of document.querySelectorAll('style')) {
    if (style.textContent.includes('display: none !important')) style.remove();
  }
}

function showInitError(message) {
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

/* ── Pattern formatting ── */
function formatAlertId(id) { return (id||'').toUpperCase(); }
function formatPatternName(pt) {
  const map = {
    fanOut:'FAN-OUT', fanIn:'FAN-IN',
    scatterGather:'SCATTER-GATHER', gatherScatter:'GATHER-SCATTER',
    cycle:'CYCLE', bipartite:'BIPARTITE', random:'RANDOM',
  };
  return map[pt] || pt.toUpperCase();
}
// Emojis removed — patterns render as text only.
const PATTERN_ICONS = {};

// Fan-In, Fan-Out, and Cycle are common low-level topologies that rarely
// indicate laundering on their own — they're the building blocks composite
// patterns are made of. Surface that relationship wherever a composite
// pattern is named, instead of listing them as unrelated, standalone patterns.
const PATTERN_BUILDING_BLOCKS = {
  scatterGather: ['fanOut', 'fanIn'],
  gatherScatter: ['fanIn', 'fanOut', 'cycle'],
  bipartite:     ['fanOut', 'fanIn'],
};
function buildingBlocksNote(pt) {
  const blocks = PATTERN_BUILDING_BLOCKS[pt];
  if (!blocks || !blocks.length) return '';
  return `Built from ${blocks.map(formatPatternName).join(' + ')} at the intermediary hops — not a pattern in its own right, but a combination of them.`;
}
// "SCATTER_GATHER" -> "scatterGather", to bridge the backend's UPPER_SNAKE
// pattern keys (whitelist rules) with the frontend's camelCase ones.
function snakeToCamelPattern(s) {
  const parts = (s||'').toLowerCase().split('_');
  return parts[0] + parts.slice(1).map(p => p.charAt(0).toUpperCase() + p.slice(1)).join('');
}

const SIGNAL_ICONS = {
  'Rapid Fan-Out':'⚡', 'Round-Trip':'🔁', 'Structuring':'💰',
  'Layering Velocity':'🌊', 'Dormant Activation':'😴',
  'Currency Mismatch':'💱', 'Smurfing':'🐚',
};

const SEV_BADGE = { HIGH:'badge-red', MEDIUM:'badge-amber', LOW:'badge-green' };
const SEV_COLOR = { HIGH:'var(--red)', MEDIUM:'var(--amber)', LOW:'var(--green)' };
const SRC_BADGE = { labelled:'badge-blue', unlabelled:'badge-purple', both:'badge-amber' };
const SRC_LABEL = { labelled:'LABELLED', unlabelled:'UNLABELLED', both:'BOTH' };

/* ── State ── */
let allAlerts    = [];
let alertDetails = {};
let decisions    = {};
let currentAlert = null;
let cy           = null;
let currentStep  = -1;
let playTimer    = null;
let srcFilter    = 'all';
let sevFilter    = 'all';
let caseFilter   = 'all';
let dbCharts     = {};

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

let activityBins = null; // {bins: [], labels: []} from backend

async function init() {
  startLoadingAnimation();
  try {
    const statusData = await pollUntilReady();
    activityBins = statusData?.activity_bins || null;
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

async function pollUntilReady() {
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

async function loadAllAlerts() {
  const r = await apiFetch('/alerts');
  if (r.status === 401) throw new Error('Your login did not create a valid backend session. Try UBI-AML-2026 / admin / admin123, or check the auth service.');
  if (!r.ok) throw new Error(`Alerts endpoint failed with HTTP ${r.status}.`);
  allAlerts = await r.json();
  if (!Array.isArray(allAlerts)) throw new Error('Alerts endpoint returned an unexpected payload.');
  await loadDecisions();
}

// Live in-app refresh: re-pull alerts/decisions/feed and rerender the active
// view WITHOUT reloading the page — so the session (and current view) survive
// and the analyst watches counts/patterns move up as new data lands.
async function refreshData() {
  const icon = document.getElementById('refresh-icon');
  const btn  = document.getElementById('refresh-btn');
  if (icon) icon.classList.add('spinning');
  if (btn)  btn.disabled = true;
  const before = allAlerts.length;
  try {
    await loadAllAlerts();  // refetches /alerts + /decisions, reuses the session token
    const active = document.querySelector('.view.active')?.id || '';
    if (active === 'view-dashboard')        renderDashboard();
    else if (active === 'view-investigate') renderSidebar();
    else if (active === 'view-cases')       renderCaseManager();
    renderLiveFeed();  // always refresh the ingestion feed + count
    const delta = allAlerts.length - before;
    toast(delta > 0
      ? `Refreshed — ${delta} new alert(s) · ${allAlerts.length} total`
      : `Refreshed · ${allAlerts.length} alerts`, delta > 0 ? 'success' : 'info');
  } catch (e) {
    toast(`Refresh failed: ${e.message || 'unknown error'}`, 'error');
  } finally {
    if (icon) icon.classList.remove('spinning');
    if (btn)  btn.disabled = false;
  }
}

// Hydrate analyst decisions from the persistent audit log so they survive restarts.
async function loadDecisions() {
  try {
    const r = await apiFetch('/decisions');
    if (r.ok) decisions = await r.json();
  } catch (e) { /* non-fatal — decisions stay empty */ }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

/* ════════════════════════════════════════════
   VIEW SWITCHING
════════════════════════════════════════════ */
// Theme: cycles Light → Dark → System. 'system' follows the OS preference.
const THEME_ORDER = ['light', 'dark', 'system'];
const THEME_ICON = { light: '☀️', dark: '🌙', system: '🖥️' };
const THEME_LABEL = { light: 'Light', dark: 'Dark', system: 'System' };

function _systemPrefersDark() {
  return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
}
function applyTheme(theme) {
  const effectiveDark = theme === 'dark' || (theme === 'system' && _systemPrefersDark());
  document.body.classList.toggle('dark', effectiveDark);
  const icon = document.getElementById('dark-toggle-icon');
  if (icon) icon.textContent = THEME_ICON[theme] || '☀️';
  const lbl = document.getElementById('dark-toggle-label');
  if (lbl) lbl.textContent = THEME_LABEL[theme] || 'Light';
}
function toggleDark() {
  const cur = localStorage.getItem('aml-theme') || 'light';
  const next = THEME_ORDER[(THEME_ORDER.indexOf(cur) + 1) % THEME_ORDER.length];
  localStorage.setItem('aml-theme', next);
  applyTheme(next);
}
// React to OS theme changes while in 'system' mode
if (window.matchMedia) {
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if ((localStorage.getItem('aml-theme') || 'light') === 'system') applyTheme('system');
  });
}
function toggleSettings() {
  const p = document.getElementById('settings-popover');
  if (!p) return;
  const open = p.style.display === 'block';
  p.style.display = open ? 'none' : 'block';
}

function openHelp() {
  const pop = document.getElementById('settings-popover');
  if (pop) pop.style.display = 'none';
  const o = document.getElementById('help-overlay');
  if (o) o.style.display = 'flex';
}
function closeHelp() {
  const o = document.getElementById('help-overlay');
  if (o) o.style.display = 'none';
}
document.addEventListener('keydown', e => { if (e.key === 'Escape') { closeHelp(); endTour(); closeNodeGraphHistory(); } });

/* ════════════════════════════════════════════
   GUIDED PRODUCT TOUR
════════════════════════════════════════════ */
const TOUR_STEPS = [
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

function startTour() {
  const pop = document.getElementById('settings-popover');
  if (pop) pop.style.display = 'none';
  closeHelp();
  _tourIdx = 0;
  _renderTourStep();
}

function endTour() {
  _tourIdx = -1;
  document.getElementById('tour-highlight')?.remove();
  document.getElementById('tour-tip')?.remove();
  localStorage.setItem('argus-tour-done', '1');
}

function tourNext() { if (_tourIdx < TOUR_STEPS.length - 1) { _tourIdx++; _renderTourStep(); } else { endTour(); } }
function tourPrev() { if (_tourIdx > 0) { _tourIdx--; _renderTourStep(); } }

async function _renderTourStep() {
  if (_tourIdx < 0 || _tourIdx >= TOUR_STEPS.length) return;
  const step = TOUR_STEPS[_tourIdx];
  if (step.view) showView(step.view);
  // Make the investigate steps meaningful by loading the top alert.
  if (step.view === 'investigate' && !currentAlert && allAlerts.length) {
    try { await loadAlertById(allAlerts[0].id); } catch (e) {}
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

function maybeAutoTour() {
  if (localStorage.getItem('argus-tour-done')) return;
  if (!allAlerts.length) return;
  setTimeout(() => { if (_tourIdx < 0) startTour(); }, 900);
}

async function logout() {
  try {
    await apiFetch('/auth/logout', { method: 'POST',
      headers: sessionToken ? { 'X-Session-Token': sessionToken } : {} });
  } catch (e) { /* logout is best-effort — clear locally regardless */ }
  localStorage.removeItem('argus-session-token');
  sessionToken = '';
  authUser = null;
  window.location.reload();
}
document.addEventListener('click', e => {
  const btn = document.getElementById('settings-btn');
  const pop = document.getElementById('settings-popover');
  if (pop && btn && !btn.contains(e.target) && !pop.contains(e.target)) pop.style.display = 'none';
});
(function(){
  // Migrate the old boolean key, then apply the saved theme.
  let theme = localStorage.getItem('aml-theme');
  if (!theme) { theme = localStorage.getItem('aml-dark') ? 'dark' : 'light'; localStorage.setItem('aml-theme', theme); }
  applyTheme(theme);
})();

function showView(name) {
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
    if (!currentAlert) renderInvestigateEmpty();
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
function showSkeleton(elId, count = 3, kind = 'block') {
  const el = document.getElementById(elId);
  if (!el) return;
  const item = kind === 'row'
    ? '<tr><td colspan="8"><div class="skeleton-bar" style="width:100%;height:14px"></div></td></tr>'
    : '<div class="skeleton-bar" style="width:100%;height:36px;margin-bottom:8px;border-radius:6px"></div>';
  el.innerHTML = item.repeat(count);
}

/* ════════════════════════════════════════════
   DASHBOARD
════════════════════════════════════════════ */
function renderDashboard() {
  document.getElementById('st-total').textContent = allAlerts.length;
  const total = allAlerts.reduce((s,a) => s + parseMoney(a.totalMoved), 0);
  document.getElementById('st-money').textContent = fmtMoney(total);
  document.getElementById('st-high').textContent  = allAlerts.filter(a=>(a.severity||'').toLowerCase()==='high').length;
  document.getElementById('st-dec').textContent   = Object.keys(decisions).length;

  if (!allAlerts.length) return;

  // Pattern donut
  const ptMap = {};
  allAlerts.forEach(a => { ptMap[formatPatternName(a.patternType)] = (ptMap[formatPatternName(a.patternType)]||0)+1; });
  // Curated cyber-fintech palette — vibrant, distinct, dark-background-optimised
  const colors = ['#6366F1','#06B6D4','#10B981','#A855F7','#F59E0B','#F43F5E','#3B82F6','#64748B'];
  if (dbCharts.donut) dbCharts.donut.destroy();
  dbCharts.donut = new Chart(document.getElementById('chart-donut').getContext('2d'), {
    type:'doughnut',
    data:{ labels:Object.keys(ptMap), datasets:[{ data:Object.values(ptMap),
      backgroundColor:colors, borderColor:document.body.classList.contains('dark')?'#1E293B':'#fff', borderWidth:2 }]},
    options:{ animation:false, plugins:{ legend:{ position:'right', labels:{ color:document.body.classList.contains('dark')?'#94A3B8':'#475569', font:{size:10}, boxWidth:12 } } },
      cutout:'62%', maintainAspectRatio:false }
  });

  // Banks bar — count flagged transactions per bank (edges), not just alerts
  const bankMap = {};
  allAlerts.forEach(a => {
    const det = alertDetails[a.id];
    if (det) {
      det.edges.forEach(e => {
        [e.source, e.target].forEach(nodeId => {
          const node = det.nodes.find(n => n.id === nodeId);
          const b = node ? (node.bank||'').trim() : '';
          if (b) bankMap[b] = (bankMap[b]||0) + 1;
        });
      });
    } else {
      // fallback: use hops as proxy transaction count for unloaded alerts
      const b = a.id; // will be skipped since no bank info
    }
  });
  const sortedB = Object.entries(bankMap).sort((a,b)=>b[1]-a[1]).slice(0,8);
  if (dbCharts.banks) dbCharts.banks.destroy();
  const bCtx = document.getElementById('chart-banks').getContext('2d');
  if (sortedB.length) {
    dbCharts.banks = new Chart(bCtx, {
      type:'bar',
      data:{ labels:sortedB.map(x=>getBankName(x[0])), datasets:[{ data:sortedB.map(x=>x[1]),
        backgroundColor:'#00579C', borderRadius:2 }]},
      options:{ animation:false, indexAxis:'y', plugins:{legend:{display:false}},
        scales:{ x:{ticks:{color:document.body.classList.contains('dark')?'#94A3B8':'#475569',font:{family:'DM Mono'}}},
                 y:{ticks:{color:document.body.classList.contains('dark')?'#94A3B8':'#475569',font:{family:'DM Mono',size:10}}} },
        maintainAspectRatio:false }
    });
  }

  // Timeline — custom date range picker driven
  renderActivityChart();


  const cnt = {confirm:0,review:0,dismiss:0};
  Object.values(decisions).forEach(d => { if(cnt[d.decision]!==undefined) cnt[d.decision]++; });
  document.getElementById('dc-confirm').textContent = cnt.confirm;
  document.getElementById('dc-review').textContent  = cnt.review;
  document.getElementById('dc-dismiss').textContent = cnt.dismiss;
  document.getElementById('dc-pending').textContent = allAlerts.length - Object.keys(decisions).length;

  renderRiskyAccounts();
  renderLiveFeed();
}

/* ════════════════════════════════════════════
   LIVE INGESTION FEED (n8n / external POST /ingest)
════════════════════════════════════════════ */
let liveFeedSeen = new Set();
let liveFeedTimer = null;

async function renderLiveFeed() {
  const list = document.getElementById('live-feed-list');
  const countEl = document.getElementById('live-feed-count');
  if (!list) return;
  let d;
  try {
    const r = await apiFetch('/live/transactions?limit=15');
    if (!r.ok) return;
    d = await r.json();
  } catch (e) { return; }

  if (countEl) countEl.textContent = `${d.count} ingested`;

  if (!d.transactions || !d.transactions.length) {
    list.innerHTML = `<div style="color:var(--muted);font-family:var(--mono);font-size:var(--text-sm);padding:var(--sp-2)">Waiting for ingested transactions…</div>`;
    return;
  }

  list.innerHTML = d.transactions.map(t => {
    const isNew = !liveFeedSeen.has(t.id);
    const when = relativeTime(t.ingested_at);
    return `<div class="live-feed-row${isNew ? ' is-new' : ''}">
      <span class="live-feed-bullet"></span>
      <div class="live-feed-route">
        <span class="live-feed-acct" title="${t.from_bank}:${t.from_account}">${t.from_bank}:${t.from_account}</span>
        <span class="live-feed-arrow">→</span>
        <span class="live-feed-acct" title="${t.to_bank}:${t.to_account}">${t.to_bank}:${t.to_account}</span>
      </div>
      <div class="live-feed-meta">
        <span class="live-feed-amt">${fmtMoney(t.amount_paid)}</span>
        <span class="live-feed-fmt">${t.payment_format || '—'}</span>
        <span class="live-feed-time">${when}</span>
      </div>
    </div>`;
  }).join('');

  d.transactions.forEach(t => liveFeedSeen.add(t.id));
}

// "just now" / "2m ago" / "3h ago" — short relative time for the live feed.
function relativeTime(iso) {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  if (isNaN(then)) return '';
  const secs = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (secs < 10) return 'just now';
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

// Poll the feed every 4s while the Dashboard is the active view.
function startLiveFeedPolling() {
  stopLiveFeedPolling();
  liveFeedTimer = setInterval(renderLiveFeed, 4000);
}
function stopLiveFeedPolling() {
  if (liveFeedTimer) { clearInterval(liveFeedTimer); liveFeedTimer = null; }
}

/* ════════════════════════════════════════════
   TOP RISKY ACCOUNTS (node-level risk)
════════════════════════════════════════════ */
async function renderRiskyAccounts() {
  const el = document.getElementById('risky-accounts');
  if (!el) return;
  try {
    const r = await apiFetch('/accounts/risky?limit=8');
    if (!r.ok) { el.innerHTML = ''; return; }
    const rows = await r.json();
    if (!rows.length) {
      el.innerHTML = `<div style="color:var(--muted);font-family:var(--mono);font-size:var(--text-sm);padding:var(--sp-2)">No accounts yet</div>`;
      return;
    }
    el.innerHTML = rows.map(a => {
      const pct = Math.round((a.risk_score||0) * 100);
      const tier = pct >= 75 ? 'var(--red,#DA251C)' : pct >= 50 ? '#F59E0B' : 'var(--blue)';
      return `<div class="risky-acct-row" role="button" tabindex="0"
                onclick="jumpToAccount('${escapeJsAttr(a.account_id)}')" onkeydown="if(event.key==='Enter')jumpToAccount('${escapeJsAttr(a.account_id)}')"
                style="display:flex;align-items:center;gap:var(--sp-3);padding:var(--sp-2) var(--sp-2);border-bottom:1px solid var(--border);cursor:pointer">
        <div style="font-family:var(--mono);font-weight:700;color:var(--text);min-width:90px">${escapeHtml(a.account_id)}</div>
        <div style="flex:1;height:6px;background:var(--bg);border-radius:3px;overflow:hidden">
          <div style="width:${pct}%;height:100%;background:${tier}"></div>
        </div>
        <div style="font-family:var(--mono);font-size:var(--text-sm);font-weight:700;color:${tier};min-width:38px;text-align:right">${pct}%</div>
        <div style="font-family:var(--mono);font-size:11px;color:var(--muted);min-width:90px;text-align:right">${fmtMoney(a.total_moved)} · ${a.txn_count} tx</div>
      </div>`;
    }).join('');
  } catch(e) { el.innerHTML = ''; }
}

// Open Investigate on the first alert that contains this account, then drill into the node
async function jumpToAccount(acctId) {
  const hit = allAlerts.find(a => {
    const det = alertDetails[a.id];
    return det && (det.nodes||[]).some(n => n.id === acctId);
  });
  showView('investigate');
  if (hit) {
    await loadAlertById(hit.id);
    setTimeout(() => openNodePanel(acctId), 200);
  } else {
    openNodePanel(acctId);
  }
}

function renderActivityChart() {
  const isDark = document.body.classList.contains('dark');
  const axisColor = isDark ? '#94A3B8' : '#475569';

  // Get range from pickers
  const startEl = document.getElementById('chart-range-start');
  const endEl   = document.getElementById('chart-range-end');
  const rangeStart = startEl?.value ? new Date(startEl.value) : null;
  const rangeEnd   = endEl?.value   ? new Date(endEl.value)   : null;

  let bins, tlLabels;

  // Gather all alert timestamps
  const allTs = allAlerts.map(a => {
    const ts = (a.timeSpan||'').split(' — ')[0] || a.timeSpan || '';
    return ts ? new Date(ts.replace(' ','T')) : null;
  }).filter(Boolean);

  // Auto-focus: if the data is split by a big time gap (e.g. 2022 base data
  // plus freshly-injected 2026 transactions), a linear axis across the whole
  // span collapses to a flat line. Detect the largest gap and default the view
  // to whichever dense cluster has the most alerts — so the chart is readable.
  let autoStart = null, autoEnd = null;
  if (!rangeStart && !rangeEnd && allTs.length > 3) {
    const sorted = [...allTs].sort((a, b) => a - b);
    let gapIdx = -1, gapSize = 0;
    for (let i = 1; i < sorted.length; i++) {
      const g = sorted[i] - sorted[i - 1];
      if (g > gapSize) { gapSize = g; gapIdx = i; }
    }
    const THIRTY_DAYS = 30 * 24 * 3600000;
    if (gapSize > THIRTY_DAYS && gapIdx > 0) {
      const left = sorted.slice(0, gapIdx), right = sorted.slice(gapIdx);
      const keep = right.length >= left.length ? right : left;  // prefer the busier (ties → newer) cluster
      autoStart = new Date(+keep[0]);
      autoEnd   = new Date(+keep[keep.length - 1] + 3600000);
    }
  }

  const WIN_START = rangeStart || autoStart || (allTs.length ? new Date(Math.min(...allTs)) : new Date(Date.now() - 48*3600000));
  const WIN_END   = rangeEnd   || autoEnd   || (allTs.length ? new Date(Math.max(...allTs) + 3600000) : new Date(WIN_START.getTime() + 48*3600000));
  const totalHours = Math.max(1, Math.ceil((WIN_END - WIN_START) / 3600000));
  const bucketHours = Math.max(1, Math.ceil(totalHours / 48));
  const numBuckets = Math.ceil(totalHours / bucketHours);

  bins = new Array(numBuckets).fill(0);
  allAlerts.forEach(a => {
    const ts = (a.timeSpan||'').split(' — ')[0] || a.timeSpan || '';
    if (ts) {
      const d = new Date(ts.replace(' ','T'));
      if (rangeStart && d < rangeStart) return;
      if (rangeEnd   && d > rangeEnd)   return;
      const idx = Math.floor((d - WIN_START) / (bucketHours * 3600000));
      if (idx >= 0 && idx < numBuckets) bins[idx]++;
    }
  });
  const showYear = totalHours > 60 * 24;   // span over ~60 days → include year
  const showDayOnly = bucketHours >= 24;    // buckets a day+ wide → drop the hour
  tlLabels = Array.from({length:numBuckets},(_,i) => {
    const d = new Date(WIN_START.getTime() + i * bucketHours * 3600000);
    const ymd = `${showYear ? d.getFullYear()+'/' : ''}${d.getMonth()+1}/${d.getDate()}`;
    return showDayOnly ? ymd : `${ymd} ${String(d.getHours()).padStart(2,'0')}:00`;
  });

  if (dbCharts.tl) dbCharts.tl.destroy();
  const tlCtx = document.getElementById('chart-tl').getContext('2d');
  const grad = tlCtx.createLinearGradient(0, 0, 0, 200);
  grad.addColorStop(0, 'rgba(218,37,28,.28)');
  grad.addColorStop(1, 'rgba(218,37,28,0)');
  dbCharts.tl = new Chart(tlCtx, {
    type:'line',
    data:{ labels: tlLabels,
      datasets:[{ label:'Flagged Transactions', data:bins,
        borderColor:'#DA251C', backgroundColor:grad,
        tension:.35, fill:true, pointRadius:2, pointHoverRadius:5,
        pointBackgroundColor:'#DA251C', borderWidth:2.5 }]},
    options:{ animation:false,
      interaction:{ mode:'index', intersect:false },
      plugins:{
        legend:{labels:{color:axisColor,font:{size:10}}},
        tooltip:{ callbacks:{ label:c => `${c.parsed.y} flagged` } } },
      scales:{ x:{grid:{display:false},ticks:{color:axisColor,maxTicksLimit:12,font:{size:10},maxRotation:0,autoSkip:true}},
               y:{ticks:{color:axisColor,font:{size:10},precision:0},beginAtZero:true,grid:{color:isDark?'rgba(148,163,184,.1)':'rgba(71,85,105,.08)'}} },
      maintainAspectRatio:false }
  });
}

function renderInvestigateEmpty() {
  // Clear graph and panels to show a welcoming empty state
  if (cy) { cy.destroy(); cy = null; }
  document.getElementById('route-bar').innerHTML = '';
  document.getElementById('is-moved').textContent = '—';
  document.getElementById('is-span').textContent  = '—';
  document.getElementById('is-hops').textContent  = '—';
  document.getElementById('is-pat').textContent   = '—';
  document.getElementById('tl-card').innerHTML = '<span style="color:var(--muted);font-family:var(--mono);font-size:var(--text-sm)">No transaction selected</span>';
  document.getElementById('tl-dots').innerHTML = '';
  document.getElementById('tl-counter').textContent = '— / —';
  document.getElementById('ir-pattern-sec').innerHTML = `
    <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;gap:var(--sp-3);padding:var(--sp-8) 0;text-align:center">
      <div style="font-size:2.5rem;opacity:.3">🔍</div>
      <div style="font-family:var(--sans);font-size:var(--text-base);font-weight:700;color:var(--muted)">${allAlerts.length} Alerts Loaded</div>
      <div style="font-family:var(--mono);font-size:var(--text-sm);color:var(--light)">Select an alert from the list<br>to begin investigation</div>
    </div>`;
  document.getElementById('dec-status-box').style.display = 'none';
  const cyEl = document.getElementById('cy');
  if (cyEl) cyEl.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:center;height:100%;opacity:.2">
      <div style="text-align:center">
        <div style="font-size:4rem">📊</div>
        <div style="font-family:var(--mono);font-size:var(--text-sm);color:var(--muted);margin-top:var(--sp-2)">Select an alert to view graph</div>
      </div>
    </div>`;
}

function jumpInvestigate(id) { showView('investigate'); loadAlertById(id); }

function parseMoney(s) { return parseFloat((s||'').replace(/[$,]/g,''))||0; }
function fmtMoney(n) {
  if (n>=1e9) return `$${(n/1e9).toFixed(1)}B`;
  if (n>=1e6) return `$${(n/1e6).toFixed(1)}M`;
  if (n>=1e3) return `$${(n/1e3).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}

/* ════════════════════════════════════════════
   INVESTIGATE SIDEBAR
════════════════════════════════════════════ */
// Alert "start" = the first timestamp in its time span, e.g. "2025-01-01 09:35 — 2025-01-05 12:23".
function alertStartDate(a) {
  const raw = (a.timeSpan || '').split(' — ')[0];
  if (!raw) return null;
  const d = new Date(raw.replace(' ', 'T'));
  return isNaN(d) ? null : d;
}

function renderSidebar() {
  const q = (document.getElementById('inv-search')?.value||'').toLowerCase();
  const patFilter = document.getElementById('inv-pattern-filter')?.value || 'all';
  const prioFilter = document.getElementById('inv-priority-filter')?.value || 'all';
  const dateStart = document.getElementById('inv-date-start')?.value || '';
  const dateEnd   = document.getElementById('inv-date-end')?.value || '';

  let filtered = allAlerts.filter(a => {
    if (patFilter !== 'all' && a.patternType !== patFilter) return false;
    if (prioFilter !== 'all' && (a.severity || '').toLowerCase() !== prioFilter.toLowerCase()) return false;
    if (q && !formatPatternName(a.patternType).toLowerCase().includes(q) &&
             !a.id.toLowerCase().includes(q) && !formatAlertId(a.id).toLowerCase().includes(q) && !a.sub.toLowerCase().includes(q)) return false;
    if (dateStart || dateEnd) {
      const d = alertStartDate(a);
      if (!d) return false;
      const dayStr = d.toISOString().slice(0, 10);
      if (dateStart && dayStr < dateStart) return false;
      if (dateEnd && dayStr > dateEnd) return false;
    }
    return true;
  });

  // Default order: most recent activity first.
  filtered = [...filtered].sort((x, y) => (alertStartDate(y)?.getTime()||0) - (alertStartDate(x)?.getTime()||0));

  const el = document.getElementById('alert-list');
  if (!el) return;
  if (!filtered.length) {
    el.innerHTML = `<div style="color:var(--muted);font-family:var(--mono);font-size:var(--text-sm);padding:var(--sp-4);text-align:center">
      No alerts match the current filters.</div>`;
    return;
  }
  el.innerHTML = filtered.map(a => {
    const dec    = decisions[a.id];
    const active = (currentAlert?.id === a.id) ? 'active' : '';
    const sevCls = `sev-${a.severity}`;
    // Decision-tinted badge: confirmed→green, review→amber, dismiss→red, none→severity colour
    const decBadge = dec
      ? { confirm:'badge-dec-confirm', review:'badge-dec-review', dismiss:'badge-dec-dismiss' }[dec.decision] || (SEV_BADGE[a.severity]||'badge-light')
      : (SEV_BADGE[a.severity]||'badge-light');
    const subPats  = (a.subPatterns||[]).filter(p=>p&&p!==a.patternType);
    const secLabel = subPats.length
      ? `<div style="font-size:9px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;margin-top:2px">+ ${subPats.map(formatPatternName).join(', ')}</div>`
      : '';
    return `<div class="ac ${active} ${sevCls}" id="ac_${a.id}" onclick="loadAlertById('${a.id}')"
                role="button" tabindex="0" aria-label="${formatPatternName(a.patternType)} alert, ${a.severity} severity"
                onkeydown="if(event.key==='Enter')loadAlertById('${a.id}')">
      <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:var(--sp-1)">
        <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
          <div style="font-family:var(--sans); font-size:var(--text-lg); font-weight:800; color:var(--text);">${formatAlertId(a.id)}</div>
          ${a.source === 'live_ingest' ? '<span class="badge badge-teal" style="font-size:9px" title="Added via live feed or Predict, not from the base dataset">➕ Added</span>' : ''}
        </div>
        <span class="badge ${decBadge}">${a.severity}</span>
      </div>
      <div style="font-size:var(--text-xs); font-weight:600; color:var(--muted); text-transform:uppercase; letter-spacing:0.05em; margin-bottom:2px">
        ${formatPatternName(a.patternType)}
      </div>
      ${secLabel}
      <div style="display:flex; gap:var(--sp-4); margin-top:var(--sp-2); margin-bottom:var(--sp-2); font-family:var(--mono);">
        <div style="display:flex; flex-direction:column;">
          <span style="font-size:9px; text-transform:uppercase; color:var(--muted); font-weight:700; letter-spacing:0.05em;">Amount</span>
          <span style="font-size:var(--text-base); font-weight:700; color:var(--blue);">${a.totalMoved}</span>
        </div>
        <div style="display:flex; flex-direction:column;">
          <span style="font-size:9px; text-transform:uppercase; color:var(--muted); font-weight:700; letter-spacing:0.05em;">Start</span>
          <span style="font-size:var(--text-base); font-weight:600; color:var(--text);">${(a.timeSpan || '').split(' ')[0]}</span>
        </div>
        <div style="display:flex; flex-direction:column;">
          <span style="font-size:9px; text-transform:uppercase; color:var(--muted); font-weight:700; letter-spacing:0.05em;">Hops</span>
          <span style="font-size:var(--text-base); font-weight:600; color:var(--text);">${a.hops}</span>
        </div>
      </div>
    </div>`;
  }).join('');
}

/* ════════════════════════════════════════════
   LOAD ALERT DETAIL
════════════════════════════════════════════ */
async function loadAlertById(id) {
  if (!alertDetails[id]) {
    try {
      const r = await apiFetch(`/alerts/${id}`);
      if (!r.ok) return;
      alertDetails[id] = await r.json();
      renderDashboard();
    } catch(e) { return; }
  }
  currentAlert = alertDetails[id];
  currentStep  = -1;
  if (playTimer) { clearInterval(playTimer); playTimer=null; }
  const playBtn = document.getElementById('play-btn');
  if (playBtn) playBtn.textContent = '▶ Play';
  document.querySelectorAll('.ac').forEach(c=>c.classList.remove('active'));
  const card = document.getElementById('ac_'+id);
  if (card) { card.classList.add('active'); card.scrollIntoView({block:'nearest'}); }

  // Route bar
  const route = currentAlert.routeNodes||[];
  document.getElementById('route-bar').innerHTML = route.map((n,i) =>
    `<span class="route-pill" onclick="highlightNode('${n}');copyAccountId('${n}')" role="button" tabindex="0"
           title="Click to highlight and copy account ID"
           onkeydown="if(event.key==='Enter'){highlightNode('${n}');copyAccountId('${n}')}">${n}</span>${i<route.length-1?'<span class="route-arrow">→</span>':''}`
  ).join('');

  // Stats strip
  document.getElementById('is-moved').textContent = currentAlert.totalMoved||'—';
  document.getElementById('is-span').textContent  = currentAlert.timeSpan||'—';
  document.getElementById('is-hops').textContent  = currentAlert.hops??'—';
  document.getElementById('is-pat').textContent   = formatPatternName(currentAlert.patternType||'');

  renderGraph();
  renderRightPanel();
  renderTimeline();
}

/* ════════════════════════════════════════════
   GRAPH
════════════════════════════════════════════ */
// Role-based node palette — distinct per role
const ROLE_NODE = {
  source:       { bg:'#00579C', border:'#60A5FA', text:'#FFFFFF' },   // UBI Navy
  destination:  { bg:'#DA251C', border:'#FCA5A5', text:'#FFFFFF' },   // UBI Red
  intermediary: { bg:'#5B21B6', border:'#A78BFA', text:'#FFFFFF' },   // Deep Violet
  default:      { bg:'#5B21B6', border:'#A78BFA', text:'#FFFFFF' },
};
const SEV_RING = {
  high:   '#EF4444',
  medium: '#F59E0B',
  low:    '#10B981',
};
const FMT_EDGE = { RTGS:'#00579C', NEFT:'#059669', Cheque:'#D97706', 'Credit Card':'#7C3AED' };

function getImportanceColor(importance) {
  // Map GNNExplainer importance (0-1) to color: light gray → orange → red
  // Low (0.0): #E5E7EB, Medium (0.5): #F97316, High (1.0): #DC2626
  const imp = Math.max(0, Math.min(1, importance || 0.5));
  if (imp < 0.5) {
    // Interpolate from visible slate to orange (slate floor so low edges stay visible)
    const t = imp * 2; // 0 to 1
    return interpolateHex('#64748B', '#F97316', t);
  } else {
    // Interpolate from orange to red
    const t = (imp - 0.5) * 2; // 0 to 1
    return interpolateHex('#F97316', '#DC2626', t);
  }
}

function interpolateHex(hex1, hex2, t) {
  const c1 = parseInt(hex1.slice(1), 16);
  const c2 = parseInt(hex2.slice(1), 16);
  const r1 = (c1 >> 16) & 255, g1 = (c1 >> 8) & 255, b1 = c1 & 255;
  const r2 = (c2 >> 16) & 255, g2 = (c2 >> 8) & 255, b2 = c2 & 255;
  const r = Math.round(r1 + (r2 - r1) * t);
  const g = Math.round(g1 + (g2 - g1) * t);
  const b = Math.round(b1 + (b2 - b1) * t);
  return '#' + [r, g, b].map(x => x.toString(16).padStart(2, '0')).join('').toUpperCase();
}

const BANK_NAMES = [
  'Apex National Bank','Meridian Trust Co.','Pinnacle Savings Bank',
  'Harbor Commercial Bank','Summit Finance Corp','Central Mutual Bank',
  'Pacific Trade Bank','Atlantic Financial Group','Inland Credit Union',
  'Horizon Cooperative Bank','Unity Savings Bank','Frontier Banking Corp',
  'Capital Fidelity Bank','Westpoint Savings','Northern Mutual Bank',
  'Eastern Finance Group','Global Commerce Bank','Premier Credit Bank',
  'Allied Banking Corp','First National Trust',
];
function getBankName(raw) {
  if (!raw) return raw;
  const id = String(raw).replace('Bank-','').trim();
  const n  = parseInt(id, 10);
  if (isNaN(n)) return id;
  return BANK_NAMES[n % BANK_NAMES.length];
}

// Position nodes in 3 columns: sources (left) → intermediaries (mid) → destinations (right)
function _columnPositions(nodes) {
  const COL = { left: 120, mid: 400, right: 680 };
  const ROW = 110;
  const buckets = { left: [], mid: [], right: [] };
  nodes.forEach(n => {
    const r = (n.role||'').toLowerCase();
    if (r === 'source' || r === 'distributor' || r === 'sender') buckets.left.push(n);
    else if (r === 'destination' || r === 'collector') buckets.right.push(n);
    else buckets.mid.push(n);
  });
  const pos = {};
  Object.entries(buckets).forEach(([col, list]) => {
    const x = COL[col];
    const total = list.length;
    const offset = (total - 1) / 2;
    list.forEach((n, i) => { pos[n.id] = { x, y: 250 + (i - offset) * ROW }; });
  });
  return pos;
}

function getLayout(alert) {
  if (!alert) return { name:'cose', padding:30, animate:false };
  const pt    = alert.patternType;
  const nodes = alert.nodes || [];

  // Fan-in / Fan-out: explicit left→right columns (senders left, receivers right)
  if (pt === 'fanOut' || pt === 'fanIn') {
    return { name: 'preset', positions: _columnPositions(nodes), fit: true, padding: 30 };
  }

  if (pt === 'cycle') {
    return { name: 'circle', padding: 60, spacingFactor: 2.0, avoidOverlap: true };
  }

  if (pt === 'bipartite') {
    const srcs = nodes.filter(n => ['source','distributor'].includes((n.role||'').toLowerCase())).map(n=>`#${n.id}`);
    return {
      name: 'breadthfirst', directed: true,
      roots: srcs.length ? srcs : undefined,
      padding: 60, spacingFactor: 2.6, avoidOverlap: true, grid: true,
    };
  }

  if (pt === 'scatterGather' || pt === 'gatherScatter') {
    // Root at destination side so visual flow is S(right) → intermediaries(middle) → D(left)
    const dsts = nodes.filter(n => ['destination','collector'].includes((n.role||'').toLowerCase())).map(n=>`#${n.id}`);
    const srcs = nodes.filter(n => ['source','distributor'].includes((n.role||'').toLowerCase())).map(n=>`#${n.id}`);
    return {
      name: 'breadthfirst', directed: false,
      roots: dsts.length ? dsts : (srcs.length ? srcs : undefined),
      padding: 60, spacingFactor: 2.4, avoidOverlap: true,
    };
  }


  return { name: 'cose', padding: 60, animate: false, nodeRepulsion: 12000, idealEdgeLength: 160, nodeOverlap: 20 };
}
function renderGraph() {
  if (!currentAlert) return;
  if (cy) cy.destroy();
  // Clear any empty-state placeholder so Cytoscape mounts into a clean, correctly-sized box
  const cyEl = document.getElementById('cy');
  if (cyEl) {
    cyEl.innerHTML = '';
    if (!cyEl._ctxMenuBound) {
      cyEl.addEventListener('contextmenu', e => e.preventDefault());
      cyEl._ctxMenuBound = true;
    }
  }

  const elements = [];
  // Build role-based short labels: S=source, D=destination, I/I1/I2...=intermediary
  let intermediaryIdx = 0;
  const intermediaryNodes = currentAlert.nodes.filter(n => {
    const r = (n.role||'').toLowerCase();
    return r !== 'source' && r !== 'destination';
  });
  const needsNumbering = intermediaryNodes.length > 1;

  currentAlert.nodes.forEach(n => {
    const r = (n.role||'').toLowerCase();
    const roleKey = ['source','destination','intermediary'].includes(r) ? r : 'default';
    const c = ROLE_NODE[roleKey];
    let shortLabel;
    if (r === 'source') {
      shortLabel = 'S';
    } else if (r === 'destination') {
      shortLabel = 'D';
    } else {
      shortLabel = String(intermediaryIdx);
      intermediaryIdx++;
    }
    elements.push({ data:{ id:n.id, label:shortLabel, sev:n.sev, role:roleKey,
      bank:n.bank, vol:n.vol, txn:n.txn,
      'bg':c.bg, 'border-col':c.border, 'text-col':c.text
    }});
  });
  currentAlert.edges.forEach(e => {
    const fmt = (currentAlert.transactions[e.txIdx]||{}).fmt||'';
    const importance = e.importance || 0.5;
    elements.push({ data:{ id:e.id, source:e.source, target:e.target,
      label:e.label, txIdx:e.txIdx, fmt, importance } });
  });

  cy = cytoscape({
    container: document.getElementById('cy'),
    elements,
    style:[
      { selector:'node', style:{
        'background-color': ele => (ROLE_NODE[ele.data('role')]||ROLE_NODE.default).bg,
        'border-color':     ele => (ROLE_NODE[ele.data('role')]||ROLE_NODE.default).border,
        'border-width': 2,
        'color': ele => (ROLE_NODE[ele.data('role')]||ROLE_NODE.default).text,
        'font-size':11, 'font-family':'Poppins, sans-serif', 'font-weight':700,
        'label':'data(label)', 'text-valign':'center', 'text-halign':'center',
        'width':58, 'height':58,
      }},
      { selector:'edge', style:{
        'line-color': e => getImportanceColor(e.data('importance')),
        'target-arrow-color': e => getImportanceColor(e.data('importance')),
        'target-arrow-shape':'triangle', 'curve-style':'bezier',
        'width': e => 3 + (e.data('importance')||0.5) * 3,
        'arrow-scale': 1.4, 'opacity': 0.95,
        'font-size':9, 'color':'#64748B',
        'text-background-color':'#0F172A',
        'text-background-opacity':0.85,
        'text-background-padding':3,
      }},
      { selector:'.hl-edge', style:{ 'line-color':'#3B82F6','target-arrow-color':'#3B82F6','width':3.5 } },
      { selector:'.dim', style:{ opacity:0.12 } },
    ],
    layout: getLayout(currentAlert),
    userZoomingEnabled:true, userPanningEnabled:true,
  });

  cy.on('mouseover','node', e => {
    const n = e.target.data();
    const pos = e.renderedPosition;
    const box = document.getElementById('cy').getBoundingClientRect();
    const tt  = document.getElementById('tooltip');
    tt.style.left = (box.left+pos.x+16)+'px';
    tt.style.top  = (box.top+pos.y-20)+'px';
    tt.style.display='block';
    document.getElementById('tt-id').textContent   = n.id;
    document.getElementById('tt-bank').textContent = getBankName(n.bank)||'—';
    document.getElementById('tt-role').textContent = n.role||'—';
    document.getElementById('tt-risk').textContent = `${Math.round(nodeRiskFromAlert(n.id)*100)}%`;
    document.getElementById('tt-vol').textContent  = n.vol||'—';
    document.getElementById('tt-txn').textContent  = n.txn||'—';
  });
  cy.on('mouseout','node', () => document.getElementById('tooltip').style.display='none');
  cy.on('mouseover','edge', e => {
    const edgeData = e.target.data();
    const pos = e.renderedPosition;
    const box = document.getElementById('cy').getBoundingClientRect();
    const tt  = document.getElementById('tooltip');
    tt.style.left = (box.left+pos.x+16)+'px';
    tt.style.top  = (box.top+pos.y-20)+'px';
    tt.style.display='block';
    document.getElementById('tt-id').textContent   = `${edgeData.source} → ${edgeData.target}`;
    document.getElementById('tt-bank').textContent = edgeData.label||'—';
    document.getElementById('tt-role').textContent = `Importance: ${Math.round(edgeData.importance * 100)}%`;
    document.getElementById('tt-vol').textContent  = '—';
    document.getElementById('tt-txn').textContent  = '—';
  });
  cy.on('mouseout','edge', () => document.getElementById('tooltip').style.display='none');
  cy.on('tap','node', e => { const id = e.target.id(); highlightNode(id); openNodePanel(id); });
  // Right-click (or long-press) a node: open its full transaction history as a graph.
  cy.on('cxttap','node', e => { e.originalEvent?.preventDefault?.(); openNodeGraphHistory(e.target.id()); });
  // Tap on background → reset highlight and fit view
  cy.on('tap', e => { if (e.target === cy) { resetHighlight(); cy.fit(undefined, 40); } });
  // Always fit the graph to the container once the layout settles (kills whitespace)
  cy.one('layoutstop', () => { cy.resize(); cy.fit(undefined, 45); });
  cy.ready(() => { cy.resize(); cy.fit(undefined, 45); });
  // Fallback: re-fit shortly after, once the container has its final size
  setTimeout(() => { if (cy) { cy.resize(); cy.fit(undefined, 45); } }, 120);
}

function highlightNode(id) {
  if (!cy) return;
  resetHighlight();
  cy.nodes(`[id="${id}"]`).style({'border-width':5});
  cy.elements().not(`[id="${id}"]`).not(cy.nodes(`[id="${id}"]`).connectedEdges()).addClass('dim');
  document.querySelectorAll('.route-pill').forEach(p=>p.classList.toggle('active-node', p.textContent===id));
}
function resetHighlight() {
  if (!cy) return;
  cy.elements().removeClass('dim hl-edge');
  cy.nodes().style({'border-width': 2});
  document.querySelectorAll('.route-pill').forEach(p=>p.classList.remove('active-node'));
}

/* ════════════════════════════════════════════
   NODE DRILL-DOWN — per-account risk + history
════════════════════════════════════════════ */
// Account risk within the CURRENT alert = strongest edge importance touching it.
function nodeRiskFromAlert(id) {
  const edges = currentAlert?.edges || [];
  let mx = 0;
  edges.forEach(e => { if (e.source===id || e.target===id) mx = Math.max(mx, e.importance||0); });
  return mx;
}

async function openNodePanel(id) {
  const sec = document.getElementById('ir-node-sec');
  if (!sec) return;
  sec.style.display = 'block';
  sec.innerHTML = `<div style="font-family:var(--mono);color:var(--muted);font-size:var(--text-sm)">Loading ${id}…</div>`;
  let d = null;
  try {
    const r = await apiFetch(`/account/${encodeURIComponent(id)}/history`);
    if (r.ok) d = await r.json();
  } catch(e) { /* fall back to current-alert view below */ }

  // Fallback: build from the current alert if the endpoint is unavailable
  if (!d) {
    const txns = (currentAlert?.transactions||[]).filter(t => t.from===id || t.to===id).map(t => ({
      alert_id: currentAlert.id, direction: t.from===id?'out':'in',
      counterparty: t.from===id?t.to:t.from, amount: t.paid, format: t.fmt,
      from_bank: t.fromBank, to_bank: t.toBank, timestamp: t.ts,
    }));
    d = { account_id:id, risk_score:nodeRiskFromAlert(id), txn_count:txns.length, alert_count:1, transactions:txns,
          sent_total:0, recv_total:0, banks:[] };
  }

  const pct = Math.round((d.risk_score||0)*100);
  const tier = pct>=75?'var(--red,#DA251C)':pct>=50?'#F59E0B':'var(--blue)';
  const rows = (d.transactions||[]).slice(0,40).map(t => `
    <tr>
      <td style="padding:4px 6px;font-family:var(--mono);font-size:11px">
        <span style="color:${t.direction==='out'?'var(--red,#DA251C)':'var(--green)'}">${t.direction==='out'?'▲ OUT':'▼ IN'}</span>
      </td>
      <td style="padding:4px 6px;font-family:var(--mono);font-size:11px;color:var(--text)">${t.counterparty||'—'}</td>
      <td style="padding:4px 6px;font-family:var(--mono);font-size:11px;font-weight:700;color:var(--blue)">${t.amount||'—'}</td>
      <td style="padding:4px 6px;font-family:var(--mono);font-size:10px;color:var(--muted)">${t.timestamp||'—'}</td>
    </tr>`).join('');

  sec.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:var(--sp-2)">
      <div>
        <div style="font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.06em;color:var(--muted)">Account</div>
        <div style="font-family:var(--mono);font-size:var(--text-lg);font-weight:800;color:var(--text)">${d.account_id}</div>
      </div>
      <button onclick="closeNodePanel()" aria-label="Close account panel" style="background:none;border:1px solid var(--border);border-radius:6px;color:var(--muted);cursor:pointer;padding:2px 8px;font-size:14px;line-height:1">✕</button>
    </div>
    <div style="display:flex;align-items:center;gap:var(--sp-2);margin-bottom:var(--sp-3)">
      <span style="font-size:11px;color:var(--muted)">Account risk</span>
      <div style="flex:1;height:8px;background:var(--bg);border-radius:4px;overflow:hidden">
        <div style="width:${pct}%;height:100%;background:${tier}"></div>
      </div>
      <span style="font-family:var(--mono);font-weight:800;color:${tier}">${pct}%</span>
    </div>
    <div style="display:flex;gap:var(--sp-3);font-family:var(--mono);font-size:11px;color:var(--muted);margin-bottom:var(--sp-3)">
      <span><strong style="color:var(--text)">${d.txn_count}</strong> flagged tx</span>
      <span><strong style="color:var(--text)">${d.alert_count}</strong> alert${d.alert_count===1?'':'s'}</span>
    </div>
    <div style="font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);margin-bottom:var(--sp-1)">Transaction history</div>
    <div style="max-height:240px;overflow:auto;border:1px solid var(--border);border-radius:6px">
      <table style="width:100%;border-collapse:collapse">${rows || '<tr><td style="padding:8px;color:var(--muted);font-size:11px">No flagged transactions</td></tr>'}</table>
    </div>`;
}

function closeNodePanel() {
  const sec = document.getElementById('ir-node-sec');
  if (sec) { sec.style.display='none'; sec.innerHTML=''; }
  resetHighlight();
}

/* ════════════════════════════════════════════
   NODE GRAPHICAL HISTORY (right-click a node)
   Renders every flagged transaction touching this account as its own
   mini network — the account in the centre, every counterparty around it.
════════════════════════════════════════════ */
let nhCy = null;

async function openNodeGraphHistory(id) {
  const overlay = document.getElementById('node-history-overlay');
  if (!overlay) return;
  overlay.style.display = 'flex';
  document.getElementById('nh-title').textContent = id;
  document.getElementById('nh-meta').textContent = 'Loading…';
  const cyEl = document.getElementById('nh-cy');
  if (cyEl) cyEl.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--muted);font-family:var(--mono);font-size:12px">Loading transaction graph…</div>';

  let d = null;
  try {
    const r = await apiFetch(`/account/${encodeURIComponent(id)}/history`);
    if (r.ok) d = await r.json();
  } catch (e) { /* fall back below */ }

  if (!d) {
    const txns = (currentAlert?.transactions || []).filter(t => t.from === id || t.to === id).map(t => ({
      direction: t.from === id ? 'out' : 'in', counterparty: t.from === id ? t.to : t.from,
      amount: t.paid, timestamp: t.ts,
    }));
    d = { account_id: id, risk_score: nodeRiskFromAlert(id), txn_count: txns.length, alert_count: 1, transactions: txns };
  }

  const pct = Math.round((d.risk_score || 0) * 100);
  document.getElementById('nh-meta').textContent =
    `Risk ${pct}% · ${d.txn_count} flagged tx · ${d.alert_count} alert${d.alert_count === 1 ? '' : 's'}`;

  _renderNodeHistoryGraph(id, d.transactions || []);
}

function _renderNodeHistoryGraph(centerId, txns) {
  const cyEl = document.getElementById('nh-cy');
  if (!cyEl) return;
  cyEl.innerHTML = '';
  if (nhCy) { nhCy.destroy(); nhCy = null; }

  if (!txns.length) {
    cyEl.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--muted);font-family:var(--mono);font-size:12px">No flagged transactions for this account</div>';
    return;
  }

  const elements = [{ data: { id: centerId, label: centerId, center: true } }];
  const seen = new Set();
  txns.forEach((t, i) => {
    const cp = t.counterparty || '?';
    if (!seen.has(cp)) { seen.add(cp); elements.push({ data: { id: cp, label: cp, center: false } }); }
    const out = t.direction === 'out';
    elements.push({
      data: {
        id: `nh-e${i}`,
        source: out ? centerId : cp,
        target: out ? cp : centerId,
        label: t.amount || '',
        dir: t.direction,
      },
    });
  });

  nhCy = cytoscape({
    container: cyEl,
    elements,
    style: [
      { selector: 'node', style: {
          'background-color': '#3B82F6', 'label': 'data(label)', 'color': '#E2E8F0',
          'font-size': 10, 'font-family': 'DM Mono', 'text-valign': 'bottom', 'text-margin-y': 6,
          'width': 28, 'height': 28, 'border-width': 2, 'border-color': '#1E293B',
        } },
      { selector: 'node[?center]', style: {
          'background-color': '#F59E0B', 'width': 42, 'height': 42, 'border-width': 3, 'border-color': '#fff',
        } },
      { selector: 'edge', style: {
          'width': 2.5, 'curve-style': 'bezier', 'target-arrow-shape': 'triangle',
          'label': 'data(label)', 'font-size': 9, 'color': '#94A3B8', 'font-family': 'DM Mono',
          'text-background-color': '#0F172A', 'text-background-opacity': .85, 'text-background-padding': 2,
        } },
      { selector: 'edge[dir = "out"]', style: { 'line-color': '#DA251C', 'target-arrow-color': '#DA251C' } },
      { selector: 'edge[dir = "in"]',  style: { 'line-color': '#10B981', 'target-arrow-color': '#10B981' } },
    ],
    layout: { name: 'concentric', concentric: n => n.data('center') ? 2 : 1, levelWidth: () => 1, padding: 40, animate: false },
    userZoomingEnabled: true, userPanningEnabled: true,
  });
  nhCy.one('layoutstop', () => { nhCy.resize(); nhCy.fit(undefined, 40); });
  setTimeout(() => { if (nhCy) { nhCy.resize(); nhCy.fit(undefined, 40); } }, 100);
}

function closeNodeGraphHistory() {
  const overlay = document.getElementById('node-history-overlay');
  if (overlay) overlay.style.display = 'none';
  if (nhCy) { nhCy.destroy(); nhCy = null; }
}

/* ════════════════════════════════════════════
   ACCOUNT SEARCH — 2-hop network
════════════════════════════════════════════ */
let searchCy = null;

async function searchAccountNetwork() {
  const id = (document.getElementById('acct-search-inp')?.value || '').trim();
  const meta = document.getElementById('acct-search-meta');
  const cyEl = document.getElementById('acct-search-cy');
  if (!id) { toast('Enter an account ID', 'warning'); return; }
  meta.textContent = 'Searching…';
  cyEl.innerHTML = '';
  if (searchCy) { searchCy.destroy(); searchCy = null; }

  let d;
  try {
    const r = await apiFetch(`/account/${encodeURIComponent(id)}/network?hops=2`);
    d = await r.json();
  } catch (e) { meta.textContent = 'Search failed — could not reach the server.'; return; }

  if (!d.found || !d.nodes.length) {
    meta.textContent = `No flagged transactions found for "${id}".`;
    return;
  }

  const hop1 = d.nodes.filter(n => n.hop === 1).length;
  const hop2 = d.nodes.filter(n => n.hop === 2).length;
  meta.textContent = `${d.nodes.length} accounts in network (${hop1} direct, ${hop2} second-hop) · ${d.edges.length} transactions`;

  const centerId = d.account_id;
  const elements = [
    ...d.nodes.map(n => ({ data: { id: n.id, label: n.id, hop: n.hop, risk: n.risk_score, alertCount: n.alert_count } })),
    ...d.edges.map((e, i) => ({ data: { id: `se${i}`, source: e.source, target: e.target, label: e.amount || '' } })),
  ];

  try {
    searchCy = cytoscape({
      container: cyEl,
      elements,
      style: [
        { selector: 'node', style: {
            'background-color': '#64748B', 'width': 30, 'height': 30,
            'label': 'data(label)', 'color': '#E2E8F0', 'font-size': 10, 'font-family': 'DM Mono',
            'text-valign': 'bottom', 'text-margin-y': 6,
            'border-width': 2, 'border-color': '#1E293B',
          } },
        { selector: 'node[hop = 0]', style: { 'background-color': '#F59E0B', 'width': 44, 'height': 44 } },
        { selector: 'node[hop = 1]', style: { 'background-color': '#3B82F6' } },
        { selector: 'node[hop = 2]', style: { 'background-color': '#64748B' } },
        { selector: 'node[alertCount > 1]', style: { 'border-width': 4, 'border-color': '#DA251C' } },
        { selector: 'edge', style: {
            'width': 2, 'curve-style': 'bezier', 'target-arrow-shape': 'triangle',
            'line-color': '#475569', 'target-arrow-color': '#475569',
            'label': 'data(label)', 'font-size': 8, 'color': '#94A3B8', 'font-family': 'DM Mono',
            'text-background-color': '#0F172A', 'text-background-opacity': .85, 'text-background-padding': 2,
          } },
      ],
      layout: { name: 'cose', animate: false, nodeSpacing: 10 },
      userZoomingEnabled: true, userPanningEnabled: true,
      wheelSensitivity: 0.1,
    });

    const rootEle = searchCy.nodes().filter(n => n.data('hop') === 0);
    if (rootEle.length) {
      searchCy.layout({
        name: 'breadthfirst',
        roots: rootEle,
        directed: false, spacingFactor: 1.4, padding: 40, animate: false,
      }).run();
    } else {
      searchCy.layout({ name: 'cose', animate: false }).run();
    }

    setTimeout(() => {
      if (searchCy && searchCy.elements().length) {
        searchCy.fit(undefined, 40);
      }
    }, 300);

    searchCy.on('tap', 'node', e => {
      const nid = e.target.id();
      copyAccountId(nid);
      document.getElementById('acct-search-inp').value = nid;
      searchAccountNetwork();
    });
    searchCy.on('mouseover', 'node', e => {
      const n = e.target.data();
      const pos = e.renderedPosition;
      const box = cyEl.getBoundingClientRect();
      const tt = document.getElementById('tooltip');
      tt.style.left = (box.left + pos.x + 16) + 'px';
      tt.style.top = (box.top + pos.y - 20) + 'px';
      tt.style.display = 'block';
      document.getElementById('tt-id').textContent = n.id;
      document.getElementById('tt-bank').textContent = n.hop === 0 ? 'Searched account' : `${n.hop} hop${n.hop>1?'s':''} away`;
      document.getElementById('tt-role').textContent = n.alertCount > 1 ? `In ${n.alertCount} alerts` : (n.alertCount === 1 ? 'In 1 alert' : '—');
      document.getElementById('tt-risk').textContent = `${Math.round((n.risk||0)*100)}%`;
      document.getElementById('tt-vol').textContent = '—';
      document.getElementById('tt-txn').textContent = '—';
    });
    searchCy.on('mouseout', 'node', () => document.getElementById('tooltip').style.display = 'none');

    searchCy.one('layoutstop', () => { searchCy.resize(); searchCy.fit(undefined, 40); });
    setTimeout(() => { if (searchCy) { searchCy.resize(); searchCy.fit(undefined, 40); } }, 100);
  } catch (e) {
    meta.textContent = 'Error rendering graph: ' + (e.message || 'Unknown error');
    console.error('searchAccountNetwork error:', e);
  }
}

/* ════════════════════════════════════════════
   TIMELINE
════════════════════════════════════════════ */
function renderTimeline() {
  updateCounter(); renderDots();
  // Show the whole graph initially — no dimming. User steps with Next/Prev.
  currentStep = -1;
  const n = currentAlert?.transactions?.length || 0;
  document.getElementById('tl-card').innerHTML = n
    ? `<span style="color:var(--muted);font-family:var(--mono);font-size:var(--text-sm)">Showing full network · ${n} transaction${n>1?'s':''}. Use Next to trace the flow.</span>`
    : '<span style="color:var(--muted);font-family:var(--mono);font-size:var(--text-sm)">No transactions</span>';
}
function applyStep(idx) {
  if (!currentAlert) return;
  const txns = currentAlert.transactions;
  if (idx<0||idx>=txns.length) return;
  currentStep = idx;
  const tx = txns[idx];
  const edge = currentAlert.edges[idx];
  const imp = edge?.importance || 0.5;
  const impColor = getImportanceColor(imp);
  document.getElementById('tl-card').innerHTML = `
    <div class="tl-route">
      <span style="color:var(--blue)">${tx.from}</span>
      <span style="color:var(--light)">→</span>
      <span style="color:var(--green)">${tx.to}</span>
      <span class="badge badge-teal">${tx.fmt||'—'}</span>
    </div>
    <div class="tl-details">
      <span>Paid: <strong>${tx.paid}</strong></span>
      <span>Recv: <strong>${tx.recv}</strong></span>
      <span>${tx.fromBank} → ${tx.toBank}</span>
      <span>${tx.ts||'—'}</span>
    </div>`;
  if (cy) {
    cy.edges().removeClass('hl-edge');
    cy.elements().removeClass('dim');
    // edges are in the same order as transactions — match by position
    const me = currentAlert.edges[idx];
    if (me) {
      const cyEdge = cy.edges(`[id="${me.id}"]`);
      if (cyEdge.length) {
        cyEdge.addClass('hl-edge');
        // Dim everything except this edge and its endpoint nodes
        const src = cyEdge.source();
        const tgt = cyEdge.target();
        cy.elements().not(cyEdge).not(src).not(tgt).addClass('dim');
        // Pan + zoom to the active edge so user can see it
        cy.animate({ fit:{ eles: cyEdge.union(src).union(tgt), padding:80 }, duration:250, easing:'ease-in-out-quad' });
      }
    }
  }
  updateCounter(); renderDots();
}
function stepBy(d) {
  if (!currentAlert) return;
  const n = currentStep+d;
  if (n>=0&&n<currentAlert.transactions.length) applyStep(n);
}
function tlPlay() {
  if (!currentAlert) return;
  if (playTimer) {
    clearInterval(playTimer); playTimer=null;
    document.getElementById('play-btn').textContent='▶ Play';
  } else {
    document.getElementById('play-btn').textContent='⏸ Pause';
    playTimer = setInterval(()=>{
      if (currentStep<currentAlert.transactions.length-1) { currentStep++; applyStep(currentStep); }
      else { clearInterval(playTimer); playTimer=null; document.getElementById('play-btn').textContent='▶ Play'; }
    },1500);
  }
}
function updateCounter() {
  const t = currentAlert ? currentAlert.transactions.length : 0;
  document.getElementById('tl-counter').textContent = t ? `${currentStep<0?'—':currentStep+1} / ${t}` : '— / —';
}
function renderDots() {
  const t = currentAlert ? currentAlert.transactions.length : 0;
  document.getElementById('tl-dots').innerHTML = Array.from({length:t},(_,i)=>{
    const edge = currentAlert?.edges[i];
    const imp = edge?.importance || 0.5;
    const isImportant = imp >= 0.7;
    return `<div class="tl-dot ${i<currentStep?'visited':''} ${i===currentStep?'current':''} ${isImportant?'important':''}"
          onclick="applyStep(${i})" role="button" tabindex="0" aria-label="Transaction ${i+1}"
          onkeydown="if(event.key==='Enter')applyStep(${i})" style="box-shadow:${isImportant?`0 0 8px ${getImportanceColor(imp)}`:'none'}"></div>`
  }).join('');
}

/* ════════════════════════════════════════════
   RIGHT PANEL
════════════════════════════════════════════ */
function generateHumanExplanation(a) {
  const pt = a.patternType;
  const n  = a.hops ?? '?';
  const nodes = (a.nodes||[]).length || '?';
  const amt  = a.totalMoved || '';
  const topEdges = (a.edges||[]).filter(e=>e.importance>=0.7).length;
  const riskNote = topEdges > 0
    ? ` <strong>${topEdges} edge${topEdges>1?'s':''}</strong> scored high suspicion by the GNN explainer.`
    : ' GNN edge importance scores were moderate.';
  const EXPLANATIONS = {
    fanOut:       `A <strong>single source account</strong> dispersed ${amt} across multiple recipients — a classic structuring tactic to avoid detection thresholds. The model traced <strong>${n} outbound transfers</strong> across <strong>${nodes} accounts</strong>.${riskNote}`,
    fanIn:        `Multiple accounts <strong>funnelled funds into one collector</strong>, aggregating ${amt}. This consolidation pattern is associated with layering before placement. <strong>${n} inbound transfers</strong> across <strong>${nodes} accounts</strong> were flagged.${riskNote}`,
    cycle:        `Money <strong>returned to its origin</strong> through a circular chain — a classic layering technique that obscures the audit trail. The GNN traced a <strong>${n}-hop loop</strong> across <strong>${nodes} accounts</strong>.${riskNote}`,
    scatterGather:`Funds were <strong>fanned out through intermediaries then reconverged</strong> — a scatter-gather structure built from fan-out and fan-in relationships at the intermediary hops, not a standalone pattern of its own. <strong>${n} transfers</strong> across <strong>${nodes} accounts</strong> were detected.${riskNote}`,
    gatherScatter:`A <strong>central hub collected from multiple sources</strong> then redistributed to multiple destinations — a gather-scatter structure combining fan-in, fan-out, and sometimes a return cycle. <strong>${n} transfers</strong> across <strong>${nodes} accounts</strong>.${riskNote}`,
    bipartite:    `Two distinct groups of accounts show <strong>cross-group transfers only</strong> — built from fan-out and fan-in relationships between the two groups, indicating coordinated movement between controlled entities. <strong>${n} edges</strong> across <strong>${nodes} accounts</strong>.${riskNote}`,
    random:       `A <strong>complex network with no single dominant pattern</strong> was flagged. The GNN detected elevated suspicion across <strong>${n} transactions</strong> involving <strong>${nodes} accounts</strong>.${riskNote}`,
  };
  return EXPLANATIONS[pt] || `The GNN model flagged <strong>${n} transactions</strong> across <strong>${nodes} accounts</strong>, moving ${amt}. Edge importance scores indicate suspicious flow.${riskNote}`;
}

function renderRightPanel() {
  if (!currentAlert) return;
  // Clear any account drill-down from a previous alert
  const nodeSec = document.getElementById('ir-node-sec');
  if (nodeSec) { nodeSec.style.display='none'; nodeSec.innerHTML=''; }
  const a = currentAlert;
  const sevColor = SEV_COLOR[a.severity]||'var(--muted)';
  const dec = decisions[a.id];
  const decBadge = dec
    ? { confirm:'badge-dec-confirm', review:'badge-dec-review', dismiss:'badge-dec-dismiss' }[dec.decision] || (SEV_BADGE[a.severity]||'badge-light')
    : (SEV_BADGE[a.severity]||'badge-light');

  // Secondary patterns
  const subPats = (a.subPatterns||[]).filter(p=>p&&p!==a.patternType);
  const secHTML = subPats.length
    ? `<div style="margin-top:var(--sp-2);display:flex;flex-wrap:wrap;gap:4px;align-items:center">
        <span style="font-size:9px;color:var(--muted);text-transform:uppercase;letter-spacing:.06em;margin-right:2px">Also detected:</span>
        ${subPats.map(p=>`<span class="badge badge-light" style="font-size:9px">${formatPatternName(p)}</span>`).join('')}
       </div>`
    : '';

  // Cited evidence — concrete laundering red-flags computed from the actual data
  const inds = a.riskIndicators || [];
  const evidenceHTML = inds.length ? `
    <div style="margin-top:var(--sp-4)">
      <div style="font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);margin-bottom:var(--sp-2)">Why this is flagged — evidence</div>
      <ul style="margin:0;padding-left:0;list-style:none;display:flex;flex-direction:column;gap:var(--sp-2)">
        ${inds.map((s,i) => `
          <li style="display:flex;gap:8px;align-items:flex-start;font-size:var(--text-sm);line-height:1.45;color:var(--text)">
            <span style="flex-shrink:0;width:18px;height:18px;border-radius:50%;background:${i===inds.length-1&&inds.length>=4?'var(--blue)':'var(--red,#DA251C)'};color:#fff;font-size:10px;font-weight:700;display:flex;align-items:center;justify-content:center;margin-top:1px">${i===inds.length-1&&inds.length>=4?'∑':i+1}</span>
            <span>${s}</span>
          </li>`).join('')}
      </ul>
    </div>` : '';

  // Cross-alert linking — does any account in THIS alert also show up in others?
  const myNodes = new Set(a.routeNodes || []);
  const linked = new Map(); // accountId -> [other alert ids]
  allAlerts.forEach(other => {
    if (other.id === a.id) return;
    (other.routeNodes || []).forEach(n => {
      if (myNodes.has(n)) {
        if (!linked.has(n)) linked.set(n, []);
        linked.get(n).push(other.id);
      }
    });
  });
  const linkedHTML = linked.size ? `
    <div style="margin-top:var(--sp-4)">
      <div style="font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);margin-bottom:var(--sp-2)">Linked to other alerts</div>
      <div style="display:flex;flex-direction:column;gap:6px">
        ${[...linked.entries()].map(([acct, otherIds]) => `
          <div style="font-size:var(--text-sm)">
            <span style="font-family:var(--mono);font-weight:700;color:var(--blue);cursor:pointer" onclick="highlightNode('${acct}')">${acct}</span>
            <span style="color:var(--muted)"> also appears in </span>
            ${[...new Set(otherIds)].map(id=>`<span style="font-family:var(--mono);color:var(--text);cursor:pointer;text-decoration:underline" onclick="jumpInvestigate('${id}')">${formatAlertId(id)}</span>`).join(', ')}
          </div>`).join('')}
      </div>
    </div>` : '';

  document.getElementById('ir-pattern-sec').innerHTML = `
    <div class="ir-pattern-name" style="color:${sevColor}">${formatPatternName(a.patternType)}</div>
    <div style="display:flex;gap:5px;flex-wrap:wrap;margin-bottom:var(--sp-2);align-items:center">
      <span class="badge ${decBadge}">${a.severity}</span>
    </div>
    ${secHTML}
    <div class="ir-desc" style="margin-top:var(--sp-3)">${generateHumanExplanation(a)}</div>
    ${evidenceHTML}
    ${linkedHTML}`;

  document.getElementById('ir-source-sec').style.display='none';
  document.getElementById('ir-roles-sec').style.display='none';

  renderDecStatus();
}

function renderDecStatus() {
  if (!currentAlert) return;
  const dec = decisions[currentAlert.id];
  const el  = document.getElementById('dec-status-box');
  if (dec) {
    el.style.display='block';
    el.className = `dec-status-box ${dec.decision}`;
    el.textContent = {confirm:'✓ Confirmed',review:'⚠ Needs Review',dismiss:'✗ Dismissed'}[dec.decision]||dec.decision;
  } else { el.style.display='none'; }
}

/* ════════════════════════════════════════════
   DECISIONS
════════════════════════════════════════════ */
async function postDecision(decision) {
  if (!currentAlert) return;
  const reason = document.getElementById('dec-reason').value||'';
  try {
    const r = await apiFetch(`/alerts/${currentAlert.id}/decision`, {
      method:'POST', headers:{'Content-Type':'application/json'},
      body:JSON.stringify({decision,reason})
    });
    const d = await r.json();
    if (d.status==='saved') {
      decisions[currentAlert.id]={decision,reason};
      renderSidebar(); renderDecStatus(); renderDashboard();
      document.querySelectorAll('.ac').forEach(c=>c.classList.remove('active'));
      document.getElementById('ac_'+currentAlert.id)?.classList.add('active');
      toast(`Decision saved: ${decision} ✓`,'success');
    }
  } catch(e){ toast('Error saving decision','error'); }
}

/* ════════════════════════════════════════════
   CASE MANAGER
════════════════════════════════════════════ */
function setCaseFilter(v,el) {
  caseFilter=v;
  document.querySelectorAll('#case-filters .filter-pill').forEach(p=>p.classList.remove('active'));
  el.classList.add('active'); renderCaseManager();
}
function renderCaseManager() {
  const rows = allAlerts.filter(a=>{
    const dec=decisions[a.id]; if(!dec) return false;
    return caseFilter==='all'||dec.decision===caseFilter;
  });
  const tbody = document.getElementById('cases-tbody');
  const empty = document.getElementById('cases-empty');
  if (!rows.length) { tbody.innerHTML=''; empty.style.display='block'; return; }
  empty.style.display='none';
  tbody.innerHTML = rows.map(a=>{
    const dec=decisions[a.id];
    const decColors={confirm:'var(--green)',review:'var(--amber)',dismiss:'var(--red)'};
    return `<tr>
      <td style="font-size:var(--text-xs);color:var(--muted);font-family:var(--mono)">${formatAlertId(a.id)}</td>
      <td style="font-family:var(--sans);font-weight:600">${formatPatternName(a.patternType)}</td>
      <td><span class="badge ${SEV_BADGE[a.severity]||'badge-light'}">${a.severity}</span></td>
      <td>${a.totalMoved}</td>
      <td style="color:${decColors[dec.decision]};font-weight:600;font-family:var(--sans)">${dec.decision.toUpperCase()}</td>
      <td style="color:var(--muted);font-size:var(--text-sm)">${escapeHtml(dec.reason)||'—'}</td>
      <td><button class="btn btn-ghost" style="font-size:var(--text-xs);padding:var(--sp-1) var(--sp-2)" onclick="jumpInvestigate('${a.id}')">Re-open</button></td>
    </tr>`;
  }).join('');
}
function exportCSV() {
  const rows = allAlerts.filter(a=>decisions[a.id]);
  if (!rows.length) { toast('No decisions to export','warning'); return; }
  const hdr = 'Alert ID,Pattern,Severity,Total Moved,Decision,Reason';
  const lines = rows.map(a=>{
    const d=decisions[a.id];
    return [a.id,formatPatternName(a.patternType),a.severity,
      a.totalMoved,d.decision,csvSafe((d.reason||'').replace(/,/g,' '))].join(',');
  });
  const blob=new Blob([[hdr,...lines].join('\n')],{type:'text/csv'});
  const url=URL.createObjectURL(blob);
  const l=document.createElement('a'); l.href=url; l.download='aml-cases.csv';
  l.click(); URL.revokeObjectURL(url);
  toast('Export ready','success');
}

/* ════════════════════════════════════════════
   WHITELIST
════════════════════════════════════════════ */
async function loadWhitelist() {
  const [wlRes, suppRes] = await Promise.all([
    apiFetch('/whitelist').then(r=>r.json()).catch(()=>null),
    apiFetch('/alerts/suppressed').then(r=>r.json()).catch(()=>[]),
  ]);
  if (wlRes) renderWhitelistPanel(wlRes);
  renderSuppressed(Array.isArray(suppRes) ? suppRes : []);
}

function renderWhitelistPanel(wl) {
  const accs = wl.exempt_accounts_detail || (wl.exempt_accounts||[]).map(a=>({account_id:a, reason:''}));
  document.getElementById('wl-accounts-list').innerHTML = accs.length
    ? accs.map(a=>`<div class="wl-account-item">
        <div>
          <div>${escapeHtml(a.account_id)}</div>
          ${a.reason ? `<div style="font-size:10px;color:var(--muted);margin-top:2px">${escapeHtml(a.reason)}</div>` : ''}
        </div>
        <button class="wl-remove-btn" onclick="removeWhitelistAccount('${escapeJsAttr(a.account_id)}')" aria-label="Remove ${escapeHtml(a.account_id)} from whitelist">×</button></div>`).join('')
    : `<span style="color:var(--light);font-size:var(--text-sm);font-family:var(--mono)">No accounts explicitly whitelisted</span>`;

  document.getElementById('wl-banks-list').innerHTML = (wl.exempt_banks||[])
    .map(b=>`<span class="badge badge-teal">${b}</span>`).join('');

  const rules = wl.exemption_rules||{};
  document.getElementById('wl-rules-list').innerHTML = Object.entries(rules).map(([pat,rule])=>{
    const note = buildingBlocksNote(snakeToCamelPattern(pat));
    return `
    <div class="wl-rule-item">
      <div class="wl-rule-pattern">${escapeHtml(pat)}</div>
      <div class="wl-rule-reason">${escapeHtml(rule.reason)}</div>
      ${note ? `<div style="font-size:10px;color:var(--blue);margin-top:4px">${note}</div>` : ''}
    </div>`;
  }).join('');
}

function renderSuppressed(suppressed) {
  const tbody=document.getElementById('suppressed-tbody');
  const empty=document.getElementById('suppressed-empty');
  document.getElementById('suppressed-count').textContent=`${suppressed.length} alert${suppressed.length!==1?'s':''}`;
  if (!suppressed.length) { tbody.innerHTML=''; empty.style.display='block'; return; }
  empty.style.display='none';
  tbody.innerHTML=suppressed.map(a=>`<tr>
    <td style="font-size:var(--text-xs);color:var(--muted);font-family:var(--mono)">${formatAlertId(a.id)}</td>
    <td style="font-family:var(--sans);font-weight:600">${formatPatternName(a.patternType||'')}</td>
    <td><span class="badge ${SEV_BADGE[a.severity]||'badge-light'}">${a.severity||'—'}</span></td>
    <td style="font-size:var(--text-sm);color:var(--muted)">${a.exemption_reason||'—'}</td>
    <td style="font-size:var(--text-sm);color:var(--muted)">${(a.exempt_accounts||[]).join(', ')||'—'}</td>
    <td><button class="btn btn-ghost" style="font-size:var(--text-xs);padding:var(--sp-1) var(--sp-2)" onclick="jumpInvestigate('${a.id}')">View</button></td>
  </tr>`).join('');
}

async function addWhitelistAccount() {
  const id=(document.getElementById('wl-account-inp').value||'').trim();
  if (!id) { toast('Enter an account ID','warning'); return; }
  const reason=(document.getElementById('wl-reason-inp').value||'').trim();
  try {
    const r=await apiFetch('/whitelist/account',{
      method:'POST', headers:{'Content-Type':'application/json'},
      body:JSON.stringify({account_id:id,reason})
    });
    const d=await r.json();
    document.getElementById('wl-account-inp').value='';
    document.getElementById('wl-reason-inp').value='';
    renderWhitelistPanel(d.whitelist);
    toast(`Added ${id} to whitelist`,'success');
  } catch(e){ toast('Error adding to whitelist','error'); }
}

async function removeWhitelistAccount(id) {
  try {
    await apiFetch(`/whitelist/account/${encodeURIComponent(id)}`,{method:'DELETE'});
    await loadWhitelist();
    toast(`Removed ${id} from whitelist`,'success');
  } catch(e){ toast('Error removing from whitelist','error'); }
}

/* ════════════════════════════════════════════
   PREDICT (custom transaction scoring)
════════════════════════════════════════════ */
const PREDICT_MAX_ROWS = 1000;
const PREDICT_MAX_DISPLAY = 100;  // cap rows rendered in the results table
let predictAbort = null;
let predictTimer = null;

function clearPredictInput() {
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

function cancelPrediction() {
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
async function addPredictionsToSystem() {
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
    const before = allAlerts.filter(a => a.source === 'live_ingest').length;
    await sleep(3000);
    try {
      await loadAllAlerts();
      renderSidebar();
      renderDashboard();
      const added = allAlerts.filter(a => a.source === 'live_ingest').length - before;
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

async function runPrediction() {
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
      headers: sessionToken ? { 'X-Session-Token': sessionToken } : {},
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

/* ════════════════════════════════════════════
   TOAST
════════════════════════════════════════════ */
function copyAccountId(id) {
  navigator.clipboard?.writeText(id).then(
    () => toast(`Copied ${id}`, 'success'),
    () => toast('Could not copy to clipboard', 'error')
  );
}

function toast(msg, type='info') {
  const container=document.getElementById('toasts');
  const el=document.createElement('div');
  el.className=`toast ${type}`;
  el.textContent=msg;
  el.setAttribute('role','alert');
  el.setAttribute('aria-live','polite');
  container.appendChild(el);
  const all=container.querySelectorAll('.toast');
  if (all.length>3) all[0].remove();
  requestAnimationFrame(()=>el.classList.add('show'));
  setTimeout(()=>{ el.classList.remove('show'); setTimeout(()=>el.remove(),300); },3000);
}

/* ════════════════════════════════════════════
   KEYBOARD SHORTCUTS (Investigate view)
════════════════════════════════════════════ */
document.addEventListener('keydown', e => {
  // Don't fire shortcuts when typing in inputs
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;

  const investigateActive = document.getElementById('view-investigate')?.classList.contains('active');

  if (investigateActive && currentAlert) {
    switch(e.key.toLowerCase()) {
      case 'j': // Next alert
        e.preventDefault();
        navigateAlert(1);
        break;
      case 'k': // Previous alert
        e.preventDefault();
        navigateAlert(-1);
        break;
      case 'c': // Confirm
        e.preventDefault();
        postDecision('confirm');
        break;
      case 'r': // Review
        e.preventDefault();
        postDecision('review');
        break;
      case 'd': // Dismiss
        e.preventDefault();
        postDecision('dismiss');
        break;
      case 'arrowleft': // Prev transaction
        e.preventDefault();
        stepBy(-1);
        break;
      case 'arrowright': // Next transaction
        e.preventDefault();
        stepBy(1);
        break;
      case ' ': // Play/pause timeline
        e.preventDefault();
        tlPlay();
        break;
    }
  }
});

function navigateAlert(direction) {
  if (!currentAlert || !allAlerts.length) return;
  const currentIdx = allAlerts.findIndex(a => a.id === currentAlert.id);
  if (currentIdx === -1) return;
  const newIdx = currentIdx + direction;
  if (newIdx >= 0 && newIdx < allAlerts.length) {
    loadAlertById(allAlerts[newIdx].id);
  }
}

/* ═══ BOOT ═══ */
// Auth screen handles init() — no auto-start
