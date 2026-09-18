import { apiFetch } from './api.js';
import { fmtMoney, relativeTime } from './format.js';

/* ════════════════════════════════════════════
   LIVE INGESTION FEED (n8n / external POST /ingest)
════════════════════════════════════════════ */
let liveFeedSeen = new Set();
let liveFeedTimer = null;

export async function renderLiveFeed() {
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

// Poll the feed every 4s while the Dashboard is the active view.
export function startLiveFeedPolling() {
  stopLiveFeedPolling();
  liveFeedTimer = setInterval(renderLiveFeed, 4000);
}
export function stopLiveFeedPolling() {
  if (liveFeedTimer) { clearInterval(liveFeedTimer); liveFeedTimer = null; }
}
