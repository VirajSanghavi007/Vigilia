// Single source of truth for sidebar destinations; the Router and the nav both read it.
export const paths = {
  overview: "/",
  alerts: "/alerts",
  cases: "/cases",
  transactions: "/transactions",
  analytics: "/analytics",
  customers: "/customers",
  investigations: "/investigations",
  investigators: "/investigators",
  reports: "/reports",
  rules: "/rules",
  audit: "/audit",
  settings: "/settings",
  profile: "/profile",
  // Destinations reached from inside pages rather than the sidebar.
  notifications: "/notifications",
  typologies: "/typologies",
  riskMap: "/risk-map",
  riskTrend: "/risk-trend",
  ruleModel: "/rules/model",
  reportSchedules: "/reports/schedules",
  customerReviews: "/customers/reviews",
  configPolicy: "/settings/policy",
  accessRequest: "/profile/access",
  support: "/support",
  assignmentPolicy: "/investigators/policy",
  // Shown while the workspace connects to its data sources.
  loading: "/loading",
  // Public product page, rendered outside the operations shell.
  landing: "/platform",
} as const;

/** Detail pages keyed by record id. */
export const alertPath = (id: string) => `/alerts/${encodeURIComponent(id)}`;
export const casePath = (id: string) => `/cases/${encodeURIComponent(id)}`;
export const rulePath = (id: string) => `/rules/${encodeURIComponent(id)}`;
export const reportPath = (id: string) => `/reports/${encodeURIComponent(id)}`;
export const auditPath = (id: string) => `/audit/${encodeURIComponent(id)}`;

/** Detail page for any record id by its prefix; undefined for ids with no page (e.g. "Customer export"). */
export function recordPath(id: string): string | undefined {
  if (id.startsWith("ALT-")) return alertPath(id);
  if (id.startsWith("AML-")) return casePath(id);
  if (/^(TM|SC)-\d+$/.test(id)) return rulePath(id);
  if (/^(SAR|CTR)-\d{4}-\d+$/.test(id)) return reportPath(id);
  if (id.startsWith("EVT-")) return auditPath(id);
  return undefined;
}
