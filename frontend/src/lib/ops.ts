// Pure helpers for the Transactions, Customers, Investigators, Reports,
// Rules, Audit, Settings and Profile pages. No React, so they unit-test directly.

/**
 * Pager total: the full population (e.g. 1,840,216 transactions) only while
 * nothing narrows the list; once a tab, filter or search applies, the count of
 * rows actually matched. The mock data holds a page of rows, not the population.
 */
export function pagerTotal(matched: number, population: number, narrowed: boolean): string {
  return (narrowed ? matched : population).toLocaleString("en-US");
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * Sortable key for a "Sep 28, 09:42" or "Sep 28, 09:54:12" timestamp (one
 * calendar year; seconds optional). Unparseable input sorts first (-1).
 */
export function dateKey(date: string): number {
  const m = /^([A-Z][a-z]{2}) (\d{1,2}), (\d{2}):(\d{2})(?::(\d{2}))?$/.exec(date);
  const month = m ? MONTHS.indexOf(m[1]) : -1;
  if (!m || month < 0) return -1;
  return ((((month * 31 + Number(m[2])) * 24 + Number(m[3])) * 60 + Number(m[4])) * 60) + Number(m[5] ?? 0);
}

/** True when any dropdown is off "All" or the search box has text. */
export function isNarrowed(filters: Record<string, string>, query: string): boolean {
  return query.trim() !== "" || Object.values(filters).some((v) => v !== "All");
}

/** Shallow equality for flat form state; drives the Save/Cancel bar. */
export function isDirty<T extends object>(form: T, saved: T): boolean {
  const keys = new Set([...Object.keys(form), ...Object.keys(saved)]) as Set<keyof T>;
  return [...keys].some((k) => form[k] !== saved[k]);
}

/** Investigator capacity tone: over 85% is stretched, 75-85% is busy. */
export function capacityTone(pct: number): "bad" | "warn" | "good" {
  if (pct > 85) return "bad";
  if (pct >= 75) return "warn";
  return "good";
}

/** Share of a whole with one decimal, e.g. 486 of 24,816 -> "2.0%". */
export function share(part: number, total: number): string {
  return total > 0 ? `${((part / total) * 100).toFixed(1)}%` : "0.0%";
}

/** Reporting stepper: steps before `current` are done, `current` is active. */
// Filing workflow position: Evidence(0) -> Narrative(1) -> Approval(2) -> Submit(3); 4 means every step is done.
export function filingStep(status: string): number {
  return ({ Draft: 1, "In review": 2, Approved: 3, Submitted: 4, Accepted: 4 } as Record<string, number>)[status] ?? 0;
}

export function stepState(index: number, current: number): "done" | "active" | "todo" {
  if (index < current) return "done";
  return index === current ? "active" : "todo";
}

/** "AE → HK · Cross-border" -> "Cross-border". */
export function corridorKind(t: { corridor: string }): string {
  return t.corridor.split(" · ")[1] ?? "";
}
