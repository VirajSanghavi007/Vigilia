import { apiFetch } from './api.js';
import { toast, copyAccountId } from './toast.js';

/* ════════════════════════════════════════════
   ACCOUNT SEARCH — 2-hop network
════════════════════════════════════════════ */
let searchCy = null;

export async function searchAccountNetwork() {
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
