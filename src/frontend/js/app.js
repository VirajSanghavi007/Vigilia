/* ════════════════════════════════════════════
   ENTRY POINT — imports every feature module and wires up
   the handful of things that must live in global scope:
   inline HTML event-handler attributes (onclick="fn()" etc.)
   reference bare identifiers that only exist on `window`
   once a script is loaded as an ES module (`type="module"`
   scripts do NOT leak their top-level bindings onto
   `window` the way classic scripts do).

   This file intentionally contains no rendering/business
   logic of its own — see src/frontend/js/modules/*.js.
════════════════════════════════════════════ */
document.title = 'AML Intelligence Platform';

// Auth (also runs the checkExistingSession auto-login check as a side effect
// of being imported).
import { authStep1, logout } from './modules/auth.js';

// Navigation / view switching.
import { showView } from './modules/nav.js';

// Init / data refresh.
import { refreshData } from './modules/init.js';

// Theme + settings + help overlay.
import { toggleSettings, toggleDark, openHelp, closeHelp } from './modules/theme.js';

// Guided tour.
import { startTour, endTour, tourNext, tourPrev } from './modules/tour.js';

// Dashboard.
import { renderActivityChart, jumpToAccount } from './modules/dashboard.js';

// Investigate / graph / timeline / decisions.
import {
  renderSidebar, loadAlertById, jumpInvestigate,
  highlightNode, resetHighlight, fitGraph,
  openNodePanel, closeNodePanel,
  openNodeGraphHistory, closeNodeGraphHistory,
  stepBy, tlPlay, applyStep,
  postDecision, navigateAlert,
} from './modules/investigate.js';

// Account search.
import { searchAccountNetwork } from './modules/accounts.js';

// Case manager.
import { setCaseFilter, exportCSV } from './modules/cases.js';

// Whitelist.
import { addWhitelistAccount, removeWhitelistAccount } from './modules/whitelist.js';

// Predict.
import {
  clearPredictInput, cancelPrediction, runPrediction, addPredictionsToSystem,
} from './modules/predict.js';

// Shared toast/copy helper (used from dynamically-generated onclick markup).
import { copyAccountId } from './modules/toast.js';

// Shared state (needed to gate the Investigate-view keyboard shortcuts below,
// same as the original inline `if (investigateActive && currentAlert)` guard).
import { state } from './modules/state.js';

/* ════════════════════════════════════════════
   GLOBAL SHIMS FOR INLINE HTML EVENT HANDLERS
   Both app.html/index.html (static onclick/onchange/onsubmit/onkeydown
   attributes) and several innerHTML template strings inside the feature
   modules (e.g. alert cards, route pills, whitelist rows, tour tooltip
   buttons) still invoke these functions by bare name from markup. ES
   modules don't put their top-level functions on `window` automatically,
   so every function referenced that way needs an explicit shim here.
════════════════════════════════════════════ */
Object.assign(window, {
  // auth
  authStep1, logout,
  // nav
  showView,
  // init/refresh
  refreshData,
  // theme/settings/help
  toggleSettings, toggleDark, openHelp, closeHelp,
  // tour
  startTour, endTour, tourNext, tourPrev,
  // dashboard
  renderActivityChart, jumpToAccount,
  // investigate
  renderSidebar, loadAlertById, jumpInvestigate,
  highlightNode, resetHighlight, fitGraph,
  openNodePanel, closeNodePanel,
  openNodeGraphHistory, closeNodeGraphHistory,
  stepBy, tlPlay, applyStep,
  postDecision,
  // accounts
  searchAccountNetwork,
  // cases
  setCaseFilter, exportCSV,
  // whitelist
  addWhitelistAccount, removeWhitelistAccount,
  // predict
  clearPredictInput, cancelPrediction, runPrediction, addPredictionsToSystem,
  // toast
  copyAccountId,
});

/* ════════════════════════════════════════════
   KEYBOARD SHORTCUTS
════════════════════════════════════════════ */
// Escape: close help overlay, end the tour, close the node history overlay.
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') { closeHelp(); endTour(); closeNodeGraphHistory(); }
});

// Investigate-view shortcuts (only active while that view is on screen and an
// alert is loaded).
document.addEventListener('keydown', e => {
  // Don't fire shortcuts when typing in inputs
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;

  const investigateActive = document.getElementById('view-investigate')?.classList.contains('active');
  if (!investigateActive || !state.currentAlert) return;

  switch(e.key.toLowerCase()) {
    case 'j': // Next alert
      e.preventDefault();
      navigateAlert(1);
      break;
    case 'k': // Previous alert
      e.preventDefault();
      navigateAlert(-1);
      break;
    case 'c': // Confirm
      e.preventDefault();
      postDecision('confirm');
      break;
    case 'r': // Review
      e.preventDefault();
      postDecision('review');
      break;
    case 'd': // Dismiss
      e.preventDefault();
      postDecision('dismiss');
      break;
    case 'arrowleft': // Prev transaction
      e.preventDefault();
      stepBy(-1);
      break;
    case 'arrowright': // Next transaction
      e.preventDefault();
      stepBy(1);
      break;
    case ' ': // Play/pause timeline
      e.preventDefault();
      tlPlay();
      break;
  }
});

/* ═══ BOOT ═══ */
// Auth screen handles init() — no auto-start
