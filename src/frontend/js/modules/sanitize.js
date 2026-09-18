/* ════════════════════════════════════════════
   SANITIZERS — security-critical. Every innerHTML
   assignment elsewhere in the app must route dynamic
   values through these helpers.
════════════════════════════════════════════ */

export function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

// For values interpolated into an inline event-handler attribute (e.g.
// onclick="fn('${...}')"): the browser decodes HTML entities *before*
// running the attribute as JS, so escapeHtml alone can't stop a `'` from
// closing the JS string early. Escape for JS-string context first, then
// HTML-escape the result so it's also safe as an attribute value.
export function escapeJsAttr(str) {
  return escapeHtml(String(str ?? '').replace(/\\/g, '\\\\').replace(/'/g, "\\'"));
}

// Neutralize formula injection: a cell starting with =, +, -, or @ gets
// interpreted as a formula by Excel/Sheets when the CSV is opened.
export function csvSafe(str) {
  const s = String(str ?? '');
  return /^[=+\-@]/.test(s) ? `'${s}` : s;
}
