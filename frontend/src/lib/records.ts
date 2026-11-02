// Lookups behind the record detail pages and the pages reached from the
// overview cards. Pure functions over the mock data, so each page only
// renders what these return.
import type { AuditEvent, Report } from "../data/ops";
import type { Case, QueueAlert, Severity } from "../data/types";
import { SEVERITY_RANK } from "./queue";
import { jurisdictionOf, type Scoped } from "./scope";

export function findById<T extends { id: string }>(items: T[], id: string | undefined): T | undefined {
  return id === undefined ? undefined : items.find((x) => x.id === id);
}

/** Audit events whose record is this id, e.g. every event on case AML-4821. */
export function eventsFor(events: AuditEvent[], recordId: string): AuditEvent[] {
  return events.filter((e) => e.record === recordId || e.recordSub === recordId);
}

/** Regulatory filings raised from a case. */
export function reportsForCase(reports: Report[], caseId: string): Report[] {
  return reports.filter((r) => r.ref === caseId);
}

/** Open alerts on the case's customer. */
export function alertsForCase(alerts: QueueAlert[], c: Case): QueueAlert[] {
  return alerts.filter((a) => a.entityId === c.entityId);
}

/** Alerts a rule raised; queue rows name the rule as "TM-014 · Velocity anomaly". */
export function alertsForRule(alerts: QueueAlert[], ruleId: string): QueueAlert[] {
  return alerts.filter((a) => a.rule.split(" · ")[0] === ruleId);
}

/** Sorted, de-duplicated header filter choices from every scoped record. */
export function scopeOptionsFrom(items: Scoped[]): { jurisdictions: string[]; typologies: string[] } {
  const sorted = (xs: string[]) => [...new Set(xs.filter(Boolean))].sort();
  return { jurisdictions: sorted(items.map((i) => i.jurisdiction)), typologies: sorted(items.map((i) => i.typology)) };
}

export interface JurisdictionRisk { code: string; alerts: number; critical: number; amount: number; topSeverity: Severity }

/** Open alerts grouped by home country, most alerts first (ties by exposure). */
export function riskByJurisdiction(alerts: QueueAlert[]): JurisdictionRisk[] {
  const rows = new Map<string, JurisdictionRisk>();
  for (const a of alerts) {
    const code = jurisdictionOf(a.entityType);
    if (!code) continue;
    const r = rows.get(code) ?? { code, alerts: 0, critical: 0, amount: 0, topSeverity: "Low" };
    r.alerts += 1;
    r.amount += a.amount;
    if (a.severity === "Critical") r.critical += 1;
    if (SEVERITY_RANK[a.severity] > SEVERITY_RANK[r.topSeverity]) r.topSeverity = a.severity;
    rows.set(code, r);
  }
  return [...rows.values()].sort((x, y) => y.alerts - x.alerts || y.amount - x.amount);
}

export interface TrendSummary { total: number; peak: { date: string; high: number }; first: number; last: number; changePct: number }

/** Headline numbers for the high-risk line of the risk trend; null for an empty range. */
export function trendSummary(points: { date: string; high: number }[]): TrendSummary | null {
  if (points.length === 0) return null;
  const peak = points.reduce((m, p) => (p.high > m.high ? p : m), points[0]);
  const first = points[0].high;
  const last = points[points.length - 1].high;
  return {
    total: points.reduce((s, p) => s + p.high, 0),
    peak: { date: peak.date, high: peak.high },
    first, last,
    changePct: first === 0 ? 0 : Math.round(((last - first) / first) * 1000) / 10,
  };
}

export interface Notification { id: string; title: string; sub: string; when: string; tone: "bad" | "warn" | "info"; to: string }

/** Inbox items: breached alert SLAs, overdue cases and denied access, worst first. */
export function buildNotifications(
  alerts: QueueAlert[], cases: Case[], denied: { title: string; sub: string; ago: string }[],
  links: { alert: (id: string) => string; case: (id: string) => string; audit: string },
): Notification[] {
  const breached = alerts.filter((a) => a.slaBreached).map((a): Notification => ({
    id: a.id, title: `SLA breached · ${a.id}`, sub: `${a.entity} · ${a.sla}`, when: a.detected, tone: "bad", to: links.alert(a.id),
  }));
  const overdue = cases.filter((c) => c.overdue).map((c): Notification => ({
    id: c.id, title: `Case overdue · ${c.id}`, sub: `${c.entity} · ${c.dueNote}`, when: c.due, tone: "warn", to: links.case(c.id),
  }));
  const access = denied.map((d, i): Notification => ({
    id: `denied-${i}`, title: d.title, sub: d.sub, when: d.ago, tone: "info", to: links.audit,
  }));
  return [...breached, ...overdue, ...access];
}
