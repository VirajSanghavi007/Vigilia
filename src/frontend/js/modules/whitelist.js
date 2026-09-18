import { apiFetch } from './api.js';
import { escapeHtml, escapeJsAttr } from './sanitize.js';
import { formatAlertId, formatPatternName, SEV_BADGE, buildingBlocksNote, snakeToCamelPattern } from './format.js';
import { toast } from './toast.js';

/* ════════════════════════════════════════════
   WHITELIST
════════════════════════════════════════════ */
export async function loadWhitelist() {
  const [wlRes, suppRes] = await Promise.all([
    apiFetch('/whitelist').then(r=>r.json()).catch(()=>null),
    apiFetch('/alerts/suppressed').then(r=>r.json()).catch(()=>[]),
  ]);
  if (wlRes) renderWhitelistPanel(wlRes);
  renderSuppressed(Array.isArray(suppRes) ? suppRes : []);
}

export function renderWhitelistPanel(wl) {
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

export function renderSuppressed(suppressed) {
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

export async function addWhitelistAccount() {
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

export async function removeWhitelistAccount(id) {
  try {
    await apiFetch(`/whitelist/account/${encodeURIComponent(id)}`,{method:'DELETE'});
    await loadWhitelist();
    toast(`Removed ${id} from whitelist`,'success');
  } catch(e){ toast('Error removing from whitelist','error'); }
}
