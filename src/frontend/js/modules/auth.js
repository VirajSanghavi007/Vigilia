import { state } from './state.js';
import { apiFetch, API_BASE } from './api.js';
import { playCinematicIntro } from './intro.js';

/* ════════════════════════════════════════════
   AUTHENTICATION
════════════════════════════════════════════ */

// Auto-bypass login when backend runs in no-DB mode (HF / local without Postgres).
// /auth/me returns 200 with a synthetic user in that mode regardless of token.
(async function checkExistingSession() {
  try {
    const r = await fetch(`${typeof API_BASE !== 'undefined' ? API_BASE : ''}/auth/me`, {
      credentials: 'same-origin',
    });
    if (r.ok) {
      const user = await r.json();
      state.sessionToken = state.sessionToken || 'no-db';
      state.authUser = { companyId: user.company_id, name: user.username };
      completeAuth();
    }
  } catch (e) { /* network down — show login screen normally */ }
})();

export async function authStep1() {
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
    state.sessionToken = session.token || '';
    if (state.sessionToken) localStorage.setItem('argus-session-token', state.sessionToken);
    state.authUser = { companyId: session.company_id || companyId, name: session.username || name };
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

export function showAuthError(id, msg) {
  const el = document.getElementById(id);
  el.textContent = msg;
  el.style.display = 'block';
  setTimeout(() => el.style.display = 'none', 3000);
}

export function completeAuth() {
  const screen = document.getElementById('auth-screen');
  screen.style.transition = 'opacity .5s ease';
  screen.style.opacity = '0';
  setTimeout(() => {
    screen.style.display = 'none';
    playCinematicIntro();
  }, 500);
}

export async function logout() {
  try {
    await apiFetch('/auth/logout', { method: 'POST',
      headers: state.sessionToken ? { 'X-Session-Token': state.sessionToken } : {} });
  } catch (e) { /* logout is best-effort — clear locally regardless */ }
  localStorage.removeItem('argus-session-token');
  state.sessionToken = '';
  state.authUser = null;
  window.location.reload();
}
