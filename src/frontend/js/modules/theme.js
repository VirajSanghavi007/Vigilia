/* ════════════════════════════════════════════
   THEME — cycles Light → Dark → System. 'system' follows the OS preference.
════════════════════════════════════════════ */
export const THEME_ORDER = ['light', 'dark', 'system'];
export const THEME_ICON = { light: '☀️', dark: '🌙', system: '🖥️' };
export const THEME_LABEL = { light: 'Light', dark: 'Dark', system: 'System' };

function _systemPrefersDark() {
  return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
}
export function applyTheme(theme) {
  const effectiveDark = theme === 'dark' || (theme === 'system' && _systemPrefersDark());
  document.body.classList.toggle('dark', effectiveDark);
  const icon = document.getElementById('dark-toggle-icon');
  if (icon) icon.textContent = THEME_ICON[theme] || '☀️';
  const lbl = document.getElementById('dark-toggle-label');
  if (lbl) lbl.textContent = THEME_LABEL[theme] || 'Light';
}
export function toggleDark() {
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
export function toggleSettings() {
  const p = document.getElementById('settings-popover');
  if (!p) return;
  const open = p.style.display === 'block';
  p.style.display = open ? 'none' : 'block';
}

export function openHelp() {
  const pop = document.getElementById('settings-popover');
  if (pop) pop.style.display = 'none';
  const o = document.getElementById('help-overlay');
  if (o) o.style.display = 'flex';
}
export function closeHelp() {
  const o = document.getElementById('help-overlay');
  if (o) o.style.display = 'none';
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
