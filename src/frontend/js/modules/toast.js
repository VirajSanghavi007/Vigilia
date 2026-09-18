/* ════════════════════════════════════════════
   TOAST
════════════════════════════════════════════ */
export function copyAccountId(id) {
  navigator.clipboard?.writeText(id).then(
    () => toast(`Copied ${id}`, 'success'),
    () => toast('Could not copy to clipboard', 'error')
  );
}

export function toast(msg, type='info') {
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
