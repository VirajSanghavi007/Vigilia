/* ════════════════════════════════════════════
   SHARED STATE — mutable app state referenced across
   multiple modules. Modules mutate properties on this
   single object (e.g. `state.currentAlert = x`) rather
   than reassigning imported bindings, since ES module
   bindings for `let`/`const` exports cannot be reassigned
   by importers.
════════════════════════════════════════════ */
export const state = {
  authUser: null,
  sessionToken: localStorage.getItem('argus-session-token') || '',

  allAlerts: [],
  alertDetails: {},
  decisions: {},
  currentAlert: null,

  // Legacy/unused filters kept from the original implementation.
  srcFilter: 'all',
  sevFilter: 'all',

  activityBins: null, // {bins: [], labels: []} from backend
};
