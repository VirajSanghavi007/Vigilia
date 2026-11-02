// Tab + search + dropdown filters + priority sort + paging + selection, the
// state every register page shares (the Alert queue and Cases pages predate it).
import { useState } from "react";
import { paginate } from "../lib/alerts";
import { isNarrowed } from "../lib/ops";
import { applyFilters, matchesQuery, sortByPriority, toggleId, togglePage } from "../lib/queue";

export const PAGE_SIZE = 8;

export interface TableSpec<T> {
  tabs: Record<string, (item: T) => boolean>;
  filters: Record<string, (item: T) => string>;
  search: (item: T) => (string | null)[];
  rank: (item: T) => number;
}

export function useTable<T extends { id: string }>(items: T[], spec: TableSpec<T>, firstTab: string) {
  const [tab, setTabRaw] = useState(firstTab);
  const [query, setQueryRaw] = useState("");
  const [filters, setFilters] = useState<Record<string, string>>(
    () => Object.fromEntries(Object.keys(spec.filters).map((k) => [k, "All"])),
  );
  const [dir, setDir] = useState<"desc" | "asc">("desc");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(() => new Set([items[0]?.id].filter(Boolean)));

  const visible = sortByPriority(
    applyFilters(
      items.filter((i) => spec.tabs[tab](i) && matchesQuery(spec.search(i), query)),
      Object.entries(spec.filters).map(([k, get]) => ({ get, value: filters[k] })),
    ),
    spec.rank, dir,
  );
  const p = paginate(visible, page, PAGE_SIZE);
  const pageIds = p.items.map((i) => i.id);

  return {
    tab, query, filters, dir, p, visible, selected,
    narrowed: tab !== firstTab || isNarrowed(filters, query),
    allOnPage: pageIds.length > 0 && pageIds.every((id) => selected.has(id)),
    focus: items.find((i) => selected.has(i.id)) ?? p.items[0],
    // Any change to what's shown sends the user back to page 1.
    setTab: (t: string) => { setTabRaw(t); setPage(1); },
    setQuery: (q: string) => { setQueryRaw(q); setPage(1); },
    setFilter: (k: string, v: string) => { setFilters({ ...filters, [k]: v }); setPage(1); },
    flipSort: () => setDir(dir === "desc" ? "asc" : "desc"),
    setPage,
    toggle: (id: string) => setSelected(toggleId(selected, id)),
    togglePage: () => setSelected(togglePage(selected, pageIds)),
    select: (id: string) => setSelected(new Set([id])),
    clear: () => setSelected(new Set()),
  };
}
