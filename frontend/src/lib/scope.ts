// Workspace-wide filters from the header row: date range, business unit and
// jurisdiction, plus the extras added through "More filters". Pure functions
// so pages can apply the same scope to alerts, cases and chart data.
import type { Alert, Case, QueueAlert } from "../data/types";

/** The mock data is frozen at Sep 28, 2026; ranges count back from it. */
export const TODAY = 28;

export const RANGES = [
  { id: "mtd", label: "Sep 01 - Sep 28, 2026", from: 1 },
  { id: "7d", label: "Sep 22 - Sep 28, 2026", from: 22 },
  { id: "today", label: "Today · Sep 28, 2026", from: TODAY },
] as const;
export type RangeId = (typeof RANGES)[number]["id"];

export const UNITS = ["Corporate banking", "Retail banking", "Payments & remittance"];
export const MIN_SCORES = [50, 70, 90];

export interface Scope { range: RangeId; unit: string; jurisdiction: string; typology: string; minScore: number }
export const DEFAULT_SCOPE: Scope = { range: "mtd", unit: "All", jurisdiction: "All", typology: "All", minScore: 0 };

/** What a record exposes to the scope. Records without a score ignore the score filter. */
export interface Scoped { day: number; unit: string; jurisdiction: string; typology: string; score?: number }

export function rangeOf(id: RangeId) {
  return RANGES.find((r) => r.id === id) ?? RANGES[0];
}

/** Business unit from an entity type such as "GH · Individual" or "AE · MSB". */
export function unitOf(entityType: string): string {
  if (/individual/i.test(entityType)) return "Retail banking";
  if (/\bmsb\b/i.test(entityType)) return "Payments & remittance";
  return "Corporate banking";
}

/** Two-letter country prefix of "AE · Corporate" or "AE · 6 min ago"; "" when there is none. */
export function jurisdictionOf(text: string): string {
  return /^([A-Z]{2}) ·/.exec(text)?.[1] ?? "";
}

/** Day of September in "Sep 28, 09:42" or "Opened Sep 24"; text without a date counts as today. */
export function dayOf(text: string): number {
  const m = /Sep (\d{1,2})\b/.exec(text);
  return m ? Number(m[1]) : TODAY;
}

export function inScope(item: Scoped, s: Scope): boolean {
  return item.day >= rangeOf(s.range).from && item.day <= TODAY
    && (s.unit === "All" || item.unit === s.unit)
    && (s.jurisdiction === "All" || item.jurisdiction === s.jurisdiction)
    && (s.typology === "All" || item.typology === s.typology)
    && (item.score === undefined || item.score >= s.minScore);
}

/** How many "More filters" extras are switched on. */
export function extraCount(s: Scope): number {
  return Number(s.typology !== "All") + Number(s.minScore > 0);
}

export function isDefaultScope(s: Scope): boolean {
  return (Object.keys(DEFAULT_SCOPE) as (keyof Scope)[]).every((k) => s[k] === DEFAULT_SCOPE[k]);
}

export const scopeOfQueueAlert = (a: QueueAlert): Scoped => ({
  day: dayOf(a.detected), unit: unitOf(a.entityType), jurisdiction: jurisdictionOf(a.entityType), typology: a.typology, score: a.score,
});
export const scopeOfCase = (c: Case): Scoped => ({
  day: dayOf(c.opened), unit: unitOf(c.entityType), jurisdiction: jurisdictionOf(c.entityType), typology: c.type,
});
// Overview rows are all from today ("6 min ago"), so they carry no date of their own.
export const scopeOfAlert = (a: Alert): Scoped => ({
  day: TODAY, unit: unitOf(a.entityType), jurisdiction: jurisdictionOf(a.meta), typology: a.typology, score: a.score,
});

/** Daily points ("Sep 01"...) inside the selected range. */
export function trendInRange<T extends { date: string }>(trend: T[], s: Scope): T[] {
  const from = rangeOf(s.range).from;
  return trend.filter((d) => dayOf(d.date) >= from);
}
