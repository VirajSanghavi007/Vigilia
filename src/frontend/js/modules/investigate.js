import { state } from './state.js';
import { apiFetch } from './api.js';
import { toast, copyAccountId } from './toast.js';
import { formatAlertId, formatPatternName, fmtMoney, getBankName, SEV_BADGE, SEV_COLOR } from './format.js';
import { showView } from './nav.js';
import { renderDashboard } from './dashboard.js';

/* ════════════════════════════════════════════
   INVESTIGATE — empty state / navigation helpers
════════════════════════════════════════════ */
export function renderInvestigateEmpty() {
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
      <div style="font-family:var(--sans);font-size:var(--text-base);font-weight:700;color:var(--muted)">${state.allAlerts.length} Alerts Loaded</div>
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

export function jumpInvestigate(id) { showView('investigate'); loadAlertById(id); }

/* ════════════════════════════════════════════
   INVESTIGATE SIDEBAR
════════════════════════════════════════════ */
// Alert "start" = the first timestamp in its time span, e.g. "2025-01-01 09:35 — 2025-01-05 12:23".
export function alertStartDate(a) {
  const raw = (a.timeSpan || '').split(' — ')[0];
  if (!raw) return null;
  const d = new Date(raw.replace(' ', 'T'));
  return isNaN(d) ? null : d;
}

export function renderSidebar() {
  const q = (document.getElementById('inv-search')?.value||'').toLowerCase();
  const patFilter = document.getElementById('inv-pattern-filter')?.value || 'all';
  const prioFilter = document.getElementById('inv-priority-filter')?.value || 'all';
  const dateStart = document.getElementById('inv-date-start')?.value || '';
  const dateEnd   = document.getElementById('inv-date-end')?.value || '';

  let filtered = state.allAlerts.filter(a => {
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
    const dec    = state.decisions[a.id];
    const active = (state.currentAlert?.id === a.id) ? 'active' : '';
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
export async function loadAlertById(id) {
  if (!state.alertDetails[id]) {
    try {
      const r = await apiFetch(`/alerts/${id}`);
      if (!r.ok) return;
      state.alertDetails[id] = await r.json();
      renderDashboard();
    } catch(e) { return; }
  }
  state.currentAlert = state.alertDetails[id];
  currentStep  = -1;
  if (playTimer) { clearInterval(playTimer); playTimer=null; }
  const playBtn = document.getElementById('play-btn');
  if (playBtn) playBtn.textContent = '▶ Play';
  document.querySelectorAll('.ac').forEach(c=>c.classList.remove('active'));
  const card = document.getElementById('ac_'+id);
  if (card) { card.classList.add('active'); card.scrollIntoView({block:'nearest'}); }

  // Route bar
  const route = state.currentAlert.routeNodes||[];
  document.getElementById('route-bar').innerHTML = route.map((n,i) =>
    `<span class="route-pill" onclick="highlightNode('${n}');copyAccountId('${n}')" role="button" tabindex="0"
           title="Click to highlight and copy account ID"
           onkeydown="if(event.key==='Enter'){highlightNode('${n}');copyAccountId('${n}')}">${n}</span>${i<route.length-1?'<span class="route-arrow">→</span>':''}`
  ).join('');

  // Stats strip
  document.getElementById('is-moved').textContent = state.currentAlert.totalMoved||'—';
  document.getElementById('is-span').textContent  = state.currentAlert.timeSpan||'—';
  document.getElementById('is-hops').textContent  = state.currentAlert.hops??'—';
  document.getElementById('is-pat').textContent   = formatPatternName(state.currentAlert.patternType||'');

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

export function getImportanceColor(importance) {
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

let cy = null;

export function renderGraph() {
  if (!state.currentAlert) return;
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
  const intermediaryNodes = state.currentAlert.nodes.filter(n => {
    const r = (n.role||'').toLowerCase();
    return r !== 'source' && r !== 'destination';
  });
  const needsNumbering = intermediaryNodes.length > 1;

  state.currentAlert.nodes.forEach(n => {
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
  state.currentAlert.edges.forEach(e => {
    const fmt = (state.currentAlert.transactions[e.txIdx]||{}).fmt||'';
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
    layout: getLayout(state.currentAlert),
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

// Small wrapper for the static "Fit" button in the Investigate toolbar
// (onclick="resetHighlight();fitGraph()") — keeps the mutable `cy` handle
// module-private instead of exposing it globally.
export function fitGraph() {
  if (cy) cy.fit(undefined, 40);
}

export function highlightNode(id) {
  if (!cy) return;
  resetHighlight();
  cy.nodes(`[id="${id}"]`).style({'border-width':5});
  cy.elements().not(`[id="${id}"]`).not(cy.nodes(`[id="${id}"]`).connectedEdges()).addClass('dim');
  document.querySelectorAll('.route-pill').forEach(p=>p.classList.toggle('active-node', p.textContent===id));
}
export function resetHighlight() {
  if (!cy) return;
  cy.elements().removeClass('dim hl-edge');
  cy.nodes().style({'border-width': 2});
  document.querySelectorAll('.route-pill').forEach(p=>p.classList.remove('active-node'));
}

/* ════════════════════════════════════════════
   NODE DRILL-DOWN — per-account risk + history
════════════════════════════════════════════ */
// Account risk within the CURRENT alert = strongest edge importance touching it.
export function nodeRiskFromAlert(id) {
  const edges = state.currentAlert?.edges || [];
  let mx = 0;
  edges.forEach(e => { if (e.source===id || e.target===id) mx = Math.max(mx, e.importance||0); });
  return mx;
}

export async function openNodePanel(id) {
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
    const txns = (state.currentAlert?.transactions||[]).filter(t => t.from===id || t.to===id).map(t => ({
      alert_id: state.currentAlert.id, direction: t.from===id?'out':'in',
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

export function closeNodePanel() {
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

export async function openNodeGraphHistory(id) {
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
    const txns = (state.currentAlert?.transactions || []).filter(t => t.from === id || t.to === id).map(t => ({
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

export function closeNodeGraphHistory() {
  const overlay = document.getElementById('node-history-overlay');
  if (overlay) overlay.style.display = 'none';
  if (nhCy) { nhCy.destroy(); nhCy = null; }
}

/* ════════════════════════════════════════════
   TIMELINE
════════════════════════════════════════════ */
let currentStep  = -1;
let playTimer    = null;

export function renderTimeline() {
  updateCounter(); renderDots();
  // Show the whole graph initially — no dimming. User steps with Next/Prev.
  currentStep = -1;
  const n = state.currentAlert?.transactions?.length || 0;
  document.getElementById('tl-card').innerHTML = n
    ? `<span style="color:var(--muted);font-family:var(--mono);font-size:var(--text-sm)">Showing full network · ${n} transaction${n>1?'s':''}. Use Next to trace the flow.</span>`
    : '<span style="color:var(--muted);font-family:var(--mono);font-size:var(--text-sm)">No transactions</span>';
}
export function applyStep(idx) {
  if (!state.currentAlert) return;
  const txns = state.currentAlert.transactions;
  if (idx<0||idx>=txns.length) return;
  currentStep = idx;
  const tx = txns[idx];
  const edge = state.currentAlert.edges[idx];
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
    const me = state.currentAlert.edges[idx];
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
export function stepBy(d) {
  if (!state.currentAlert) return;
  const n = currentStep+d;
  if (n>=0&&n<state.currentAlert.transactions.length) applyStep(n);
}
export function tlPlay() {
  if (!state.currentAlert) return;
  if (playTimer) {
    clearInterval(playTimer); playTimer=null;
    document.getElementById('play-btn').textContent='▶ Play';
  } else {
    document.getElementById('play-btn').textContent='⏸ Pause';
    playTimer = setInterval(()=>{
      if (currentStep<state.currentAlert.transactions.length-1) { currentStep++; applyStep(currentStep); }
      else { clearInterval(playTimer); playTimer=null; document.getElementById('play-btn').textContent='▶ Play'; }
    },1500);
  }
}
function updateCounter() {
  const t = state.currentAlert ? state.currentAlert.transactions.length : 0;
  document.getElementById('tl-counter').textContent = t ? `${currentStep<0?'—':currentStep+1} / ${t}` : '— / —';
}
function renderDots() {
  const t = state.currentAlert ? state.currentAlert.transactions.length : 0;
  document.getElementById('tl-dots').innerHTML = Array.from({length:t},(_,i)=>{
    const edge = state.currentAlert?.edges[i];
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
export function generateHumanExplanation(a) {
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

export function renderRightPanel() {
  if (!state.currentAlert) return;
  // Clear any account drill-down from a previous alert
  const nodeSec = document.getElementById('ir-node-sec');
  if (nodeSec) { nodeSec.style.display='none'; nodeSec.innerHTML=''; }
  const a = state.currentAlert;
  const sevColor = SEV_COLOR[a.severity]||'var(--muted)';
  const dec = state.decisions[a.id];
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
  state.allAlerts.forEach(other => {
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

export function renderDecStatus() {
  if (!state.currentAlert) return;
  const dec = state.decisions[state.currentAlert.id];
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
export async function postDecision(decision) {
  if (!state.currentAlert) return;
  const reason = document.getElementById('dec-reason').value||'';
  try {
    const r = await apiFetch(`/alerts/${state.currentAlert.id}/decision`, {
      method:'POST', headers:{'Content-Type':'application/json'},
      body:JSON.stringify({decision,reason})
    });
    const d = await r.json();
    if (d.status==='saved') {
      state.decisions[state.currentAlert.id]={decision,reason};
      renderSidebar(); renderDecStatus(); renderDashboard();
      document.querySelectorAll('.ac').forEach(c=>c.classList.remove('active'));
      document.getElementById('ac_'+state.currentAlert.id)?.classList.add('active');
      toast(`Decision saved: ${decision} ✓`,'success');
    }
  } catch(e){ toast('Error saving decision','error'); }
}

/* ════════════════════════════════════════════
   KEYBOARD NAVIGATION HELPER (used by the Investigate view shortcuts,
   which are wired up in the entry module).
════════════════════════════════════════════ */
export function navigateAlert(direction) {
  if (!state.currentAlert || !state.allAlerts.length) return;
  const currentIdx = state.allAlerts.findIndex(a => a.id === state.currentAlert.id);
  if (currentIdx === -1) return;
  const newIdx = currentIdx + direction;
  if (newIdx >= 0 && newIdx < state.allAlerts.length) {
    loadAlertById(state.allAlerts[newIdx].id);
  }
}
