import { state } from './state.js';
import { apiFetch } from './api.js';
import { escapeJsAttr, escapeHtml } from './sanitize.js';
import { formatPatternName, parseMoney, fmtMoney, getBankName } from './format.js';
import { renderLiveFeed } from './livefeed.js';
import { showView } from './nav.js';
import { loadAlertById, openNodePanel } from './investigate.js';

let dbCharts = {};

/* ════════════════════════════════════════════
   DASHBOARD
════════════════════════════════════════════ */
export function renderDashboard() {
  document.getElementById('st-total').textContent = state.allAlerts.length;
  const total = state.allAlerts.reduce((s,a) => s + parseMoney(a.totalMoved), 0);
  document.getElementById('st-money').textContent = fmtMoney(total);
  document.getElementById('st-high').textContent  = state.allAlerts.filter(a=>(a.severity||'').toLowerCase()==='high').length;
  document.getElementById('st-dec').textContent   = Object.keys(state.decisions).length;

  if (!state.allAlerts.length) return;

  // Pattern donut
  const ptMap = {};
  state.allAlerts.forEach(a => { ptMap[formatPatternName(a.patternType)] = (ptMap[formatPatternName(a.patternType)]||0)+1; });
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
  state.allAlerts.forEach(a => {
    const det = state.alertDetails[a.id];
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
  Object.values(state.decisions).forEach(d => { if(cnt[d.decision]!==undefined) cnt[d.decision]++; });
  document.getElementById('dc-confirm').textContent = cnt.confirm;
  document.getElementById('dc-review').textContent  = cnt.review;
  document.getElementById('dc-dismiss').textContent = cnt.dismiss;
  document.getElementById('dc-pending').textContent = state.allAlerts.length - Object.keys(state.decisions).length;

  renderRiskyAccounts();
  renderLiveFeed();
}

/* ════════════════════════════════════════════
   TOP RISKY ACCOUNTS (node-level risk)
════════════════════════════════════════════ */
export async function renderRiskyAccounts() {
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
export async function jumpToAccount(acctId) {
  const hit = state.allAlerts.find(a => {
    const det = state.alertDetails[a.id];
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

export function renderActivityChart() {
  const isDark = document.body.classList.contains('dark');
  const axisColor = isDark ? '#94A3B8' : '#475569';

  // Get range from pickers
  const startEl = document.getElementById('chart-range-start');
  const endEl   = document.getElementById('chart-range-end');
  const rangeStart = startEl?.value ? new Date(startEl.value) : null;
  const rangeEnd   = endEl?.value   ? new Date(endEl.value)   : null;

  let bins, tlLabels;

  // Gather all alert timestamps
  const allTs = state.allAlerts.map(a => {
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
  state.allAlerts.forEach(a => {
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
