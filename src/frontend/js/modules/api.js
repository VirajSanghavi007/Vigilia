import { state } from './state.js';
import { toast } from './toast.js';

/* ════════════════════════════════════════════
   CONFIG / API FETCH LAYER
════════════════════════════════════════════ */
export const API_BASE = (window.location.protocol === 'file:')
  ? 'http://localhost:8000'
  : '';
export const API_CREDENTIALS = API_BASE ? 'include' : 'same-origin';

let _sessionExpiredHandled = false;

// Bounce back to the login screen when the session dies mid-use (expired
// token, server restart that dropped in-memory sessions, etc). Without this,
// every subsequent API call just silently 401s and the UI looks "stuck".
export function handleSessionExpired() {
  if (_sessionExpiredHandled) return;
  _sessionExpiredHandled = true;
  localStorage.removeItem('argus-session-token');
  state.sessionToken = '';
  state.authUser = null;
  try { toast('Session expired — please log in again', 'error'); } catch (e) {}
  setTimeout(() => window.location.reload(), 800);
}

export async function apiFetch(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (state.sessionToken) headers['X-Session-Token'] = state.sessionToken;
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
    credentials: API_CREDENTIALS,
  });
  // /auth/login itself returning 401 means "bad credentials", not "session
  // expired" — don't trigger the bounce loop for that one.
  if (res.status === 401 && !path.startsWith('/auth/login')) {
    handleSessionExpired();
  }
  return res;
}
