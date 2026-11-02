import type { Alert } from "../data/types";

/** Case-insensitive match on entity name, entity id, typology or analyst. */
export function filterAlerts(alerts: Alert[], query: string): Alert[] {
  const q = query.trim().toLowerCase();
  if (!q) return alerts;
  return alerts.filter((a) =>
    [a.entity, a.entityId, a.typology, a.analyst ?? ""].some((f) => f.toLowerCase().includes(q)),
  );
}

export interface Page<T> {
  items: T[];
  page: number;
  pageCount: number;
  start: number; // 1-based index of first item, 0 when empty
  end: number;
}

/** Slice a list into a 1-based page, clamping out-of-range page numbers. */
export function paginate<T>(items: T[], page: number, pageSize: number): Page<T> {
  const pageCount = Math.max(1, Math.ceil(items.length / pageSize));
  const p = Math.min(Math.max(1, page), pageCount);
  const startIdx = (p - 1) * pageSize;
  const slice = items.slice(startIdx, startIdx + pageSize);
  return {
    items: slice,
    page: p,
    pageCount,
    start: slice.length ? startIdx + 1 : 0,
    end: startIdx + slice.length,
  };
}
