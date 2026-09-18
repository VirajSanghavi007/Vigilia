/* ── Pattern formatting ── */
export function formatAlertId(id) { return (id||'').toUpperCase(); }
export function formatPatternName(pt) {
  const map = {
    fanOut:'FAN-OUT', fanIn:'FAN-IN',
    scatterGather:'SCATTER-GATHER', gatherScatter:'GATHER-SCATTER',
    cycle:'CYCLE', bipartite:'BIPARTITE', random:'RANDOM',
  };
  return map[pt] || pt.toUpperCase();
}
// Emojis removed — patterns render as text only.
export const PATTERN_ICONS = {};

// Fan-In, Fan-Out, and Cycle are common low-level topologies that rarely
// indicate laundering on their own — they're the building blocks composite
// patterns are made of. Surface that relationship wherever a composite
// pattern is named, instead of listing them as unrelated, standalone patterns.
export const PATTERN_BUILDING_BLOCKS = {
  scatterGather: ['fanOut', 'fanIn'],
  gatherScatter: ['fanIn', 'fanOut', 'cycle'],
  bipartite:     ['fanOut', 'fanIn'],
};
export function buildingBlocksNote(pt) {
  const blocks = PATTERN_BUILDING_BLOCKS[pt];
  if (!blocks || !blocks.length) return '';
  return `Built from ${blocks.map(formatPatternName).join(' + ')} at the intermediary hops — not a pattern in its own right, but a combination of them.`;
}
// "SCATTER_GATHER" -> "scatterGather", to bridge the backend's UPPER_SNAKE
// pattern keys (whitelist rules) with the frontend's camelCase ones.
export function snakeToCamelPattern(s) {
  const parts = (s||'').toLowerCase().split('_');
  return parts[0] + parts.slice(1).map(p => p.charAt(0).toUpperCase() + p.slice(1)).join('');
}

export const SIGNAL_ICONS = {
  'Rapid Fan-Out':'⚡', 'Round-Trip':'🔁', 'Structuring':'💰',
  'Layering Velocity':'🌊', 'Dormant Activation':'😴',
  'Currency Mismatch':'💱', 'Smurfing':'🐚',
};

export const SEV_BADGE = { HIGH:'badge-red', MEDIUM:'badge-amber', LOW:'badge-green' };
export const SEV_COLOR = { HIGH:'var(--red)', MEDIUM:'var(--amber)', LOW:'var(--green)' };
export const SRC_BADGE = { labelled:'badge-blue', unlabelled:'badge-purple', both:'badge-amber' };
export const SRC_LABEL = { labelled:'LABELLED', unlabelled:'UNLABELLED', both:'BOTH' };

export function parseMoney(s) { return parseFloat((s||'').replace(/[$,]/g,''))||0; }
export function fmtMoney(n) {
  if (n>=1e9) return `$${(n/1e9).toFixed(1)}B`;
  if (n>=1e6) return `$${(n/1e6).toFixed(1)}M`;
  if (n>=1e3) return `$${(n/1e3).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}

export const BANK_NAMES = [
  'Apex National Bank','Meridian Trust Co.','Pinnacle Savings Bank',
  'Harbor Commercial Bank','Summit Finance Corp','Central Mutual Bank',
  'Pacific Trade Bank','Atlantic Financial Group','Inland Credit Union',
  'Horizon Cooperative Bank','Unity Savings Bank','Frontier Banking Corp',
  'Capital Fidelity Bank','Westpoint Savings','Northern Mutual Bank',
  'Eastern Finance Group','Global Commerce Bank','Premier Credit Bank',
  'Allied Banking Corp','First National Trust',
];
export function getBankName(raw) {
  if (!raw) return raw;
  const id = String(raw).replace('Bank-','').trim();
  const n  = parseInt(id, 10);
  if (isNaN(n)) return id;
  return BANK_NAMES[n % BANK_NAMES.length];
}

// "just now" / "2m ago" / "3h ago" — short relative time for the live feed.
export function relativeTime(iso) {
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
