import { state } from './state.js';
import { escapeHtml, csvSafe } from './sanitize.js';
import { formatAlertId, formatPatternName, SEV_BADGE } from './format.js';
import { toast } from './toast.js';

/* ════════════════════════════════════════════
   CASE MANAGER
════════════════════════════════════════════ */
let caseFilter = 'all';

export function setCaseFilter(v,el) {
  caseFilter=v;
  document.querySelectorAll('#case-filters .filter-pill').forEach(p=>p.classList.remove('active'));
  el.classList.add('active'); renderCaseManager();
}
export function renderCaseManager() {
  const rows = state.allAlerts.filter(a=>{
    const dec=state.decisions[a.id]; if(!dec) return false;
    return caseFilter==='all'||dec.decision===caseFilter;
  });
  const tbody = document.getElementById('cases-tbody');
  const empty = document.getElementById('cases-empty');
  if (!rows.length) { tbody.innerHTML=''; empty.style.display='block'; return; }
  empty.style.display='none';
  tbody.innerHTML = rows.map(a=>{
    const dec=state.decisions[a.id];
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
export function exportCSV() {
  const rows = state.allAlerts.filter(a=>state.decisions[a.id]);
  if (!rows.length) { toast('No decisions to export','warning'); return; }
  const hdr = 'Alert ID,Pattern,Severity,Total Moved,Decision,Reason';
  const lines = rows.map(a=>{
    const d=state.decisions[a.id];
    return [a.id,formatPatternName(a.patternType),a.severity,
      a.totalMoved,d.decision,csvSafe((d.reason||'').replace(/,/g,' '))].join(',');
  });
  const blob=new Blob([[hdr,...lines].join('\n')],{type:'text/csv'});
  const url=URL.createObjectURL(blob);
  const l=document.createElement('a'); l.href=url; l.download='aml-cases.csv';
  l.click(); URL.revokeObjectURL(url);
  toast('Export ready','success');
}
