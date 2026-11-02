// Shapes the dashboard consumes. When the API grows a /dashboard endpoint,
// its response schema should match these so only getDashboard() changes.

export type AlertStatus = "Escalated" | "Unassigned" | "In review" | "Pending info";

export interface Kpi {
  id: string;
  label: string;
  value: string;
  delta: number;
  deltaUnit: "%" | " pts";
  /** Whether an increase is good (green) or bad (red) for this metric. */
  higherIsBetter: boolean;
  sub: string;
  icon: "volume" | "flag" | "alert" | "case" | "target";
}

export interface Alert {
  /** The queue alert this row opens, e.g. ALT-92841. */
  id: string;
  entity: string;
  entityId: string;
  entityType: "Corporate" | "Individual";
  meta: string;
  amount: number;
  score: number;
  typology: string;
  status: AlertStatus;
  analyst: string | null;
}

export interface Dashboard {
  slaBreaches: number;
  refreshedMinsAgo: number;
  kpis: Kpi[];
  riskTrend: { date: string; high: number; medium: number }[];
  volumeByHour: { hour: number; value: number }[];
  volumeTotal: string;
  volumeDelta: number;
  severity: { level: string; count: number; color: string }[];
  severityNote: string;
  typologies: { name: string; count: number; color: string }[];
  typologyCoverage: string;
  hotspots: { name: string; x: number; y: number }[];
  elevatedJurisdictions: number;
  newGeoAlerts: number;
  activity: { title: string; sub: string; kind: "assign" | "sar" | "note" | "escalate" }[];
  activityToday: { actions: number; escalations: number };
  alerts: Alert[];
  highRiskAlerts: number;
  user: { name: string; role: string };
}

// Alert queue and case management pages.

export type Severity = "Critical" | "High" | "Medium" | "Low";
export type QueueStatus = "Escalated" | "New" | "In review" | "Pending info";
export type CaseStatus = "Escalated" | "In progress" | "New" | "Pending approval" | "Pending info";

export interface QueueAlert {
  id: string;
  entity: string;
  entityId: string;
  entityType: string;
  severity: Severity;
  typology: string;
  rule: string;
  amount: number;
  txCount: number;
  score: number;
  detected: string;
  sla: string;
  slaBreached: boolean;
  assignee: string | null;
  status: QueueStatus;
  narrative: string;
  customerRisk: string;
  linked: string;
  /** Recommended next step shown beside the snapshot. */
  nextStep: string;
}

export interface AlertQueue {
  alerts: QueueAlert[];
  closed: number;
  newToday: number;
  medianTriage: string;
  medianTriageDelta: string;
  oldestBreach: string;
  currentUser: string;
}

export interface Case {
  id: string;
  opened: string;
  entity: string;
  entityId: string;
  entityType: string;
  type: string;
  typeSub: string;
  priority: Severity;
  status: CaseStatus;
  investigator: string | null;
  alerts: number;
  due: string;
  dueNote: string;
  overdue: boolean;
  dueToday: boolean;
}

export interface CaseActivityItem { title: string; sub: string; ago: string; kind: "assign" | "sar" | "note" }

export interface Cases {
  cases: Case[];
  closed: number;
  openedThisWeek: number;
  oldestOverdue: string;
  currentUser: string;
  activity: CaseActivityItem[];
}
