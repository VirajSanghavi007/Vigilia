import type { Case, QueueAlert, Severity } from "../data/types";

export const SEVERITY_RANK: Record<Severity, number> = { Critical: 4, High: 3, Medium: 2, Low: 1 };

/** True when any field contains the trimmed, case-insensitive query (blank matches all). */
export function matchesQuery(fields: (string | null)[], query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return fields.some((f) => (f ?? "").toLowerCase().includes(q));
}

export interface FieldFilter<T> { get: (item: T) => string; value: string }

/** Keep items matching every dropdown filter; the value "All" disables a filter. */
export function applyFilters<T>(items: T[], filters: FieldFilter<T>[]): T[] {
  const active = filters.filter((f) => f.value !== "All");
  return items.filter((item) => active.every((f) => f.get(item) === f.value));
}

/** Stable sort by a numeric priority: "desc" puts the highest first. */
export function sortByPriority<T>(items: T[], rank: (item: T) => number, dir: "desc" | "asc"): T[] {
  const sign = dir === "desc" ? -1 : 1;
  return [...items].sort((a, b) => sign * (rank(a) - rank(b)));
}

/** Severity first, model score as the tie-breaker. */
export const alertRank = (a: QueueAlert) => SEVERITY_RANK[a.severity] * 1000 + a.score;
export const caseRank = (c: Case) => SEVERITY_RANK[c.priority] * 1000 + (c.overdue ? 100 : 0) + (c.dueToday ? 10 : 0);

/** Add or remove one id from a selection. */
export function toggleId(selected: Set<string>, id: string): Set<string> {
  const next = new Set(selected);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

/** Header checkbox: select every id on the page, or clear them all if already selected. */
export function togglePage(selected: Set<string>, ids: string[]): Set<string> {
  const next = new Set(selected);
  const all = ids.every((id) => next.has(id));
  for (const id of ids) {
    if (all) next.delete(id);
    else next.add(id);
  }
  return next;
}

/** Unique values in first-seen order, for building dropdown options. */
export function uniqueValues<T>(items: T[], get: (item: T) => string): string[] {
  return [...new Set(items.map(get))];
}

export function percent(part: number, total: number): number {
  return total > 0 ? Math.round((part / total) * 100) : 0;
}

export function queueStats(alerts: QueueAlert[], user: string) {
  const critical = alerts.filter((a) => a.severity === "Critical");
  const unassigned = alerts.filter((a) => !a.assignee).length;
  return {
    open: alerts.length,
    critical: critical.length,
    criticalUnassigned: critical.filter((a) => !a.assignee).length,
    unassigned,
    unassignedPct: percent(unassigned, alerts.length),
    breached: alerts.filter((a) => a.slaBreached).length,
    mine: alerts.filter((a) => a.assignee === user).length,
  };
}

export function caseStats(cases: Case[], user: string) {
  const critical = cases.filter((c) => c.priority === "Critical");
  const unassigned = cases.filter((c) => !c.investigator).length;
  const dueToday = cases.filter((c) => c.dueToday);
  return {
    open: cases.length,
    critical: critical.length,
    criticalOverdue: critical.filter((c) => c.overdue).length,
    unassigned,
    unassignedPct: percent(unassigned, cases.length),
    dueToday: dueToday.length,
    dueTodayAwaitingApproval: dueToday.filter((c) => c.status === "Pending approval").length,
    pendingApproval: cases.filter((c) => c.status === "Pending approval").length,
    overdue: cases.filter((c) => c.overdue).length,
    mine: cases.filter((c) => c.investigator === user).length,
  };
}

/** Open cases per investigator, busiest first (ties keep first-seen order). */
export function workload(cases: Case[]): { name: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const c of cases) if (c.investigator) counts.set(c.investigator, (counts.get(c.investigator) ?? 0) + 1);
  return [...counts].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);
}
