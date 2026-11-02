// Building blocks shared by the Alert queue and Cases pages.
import type { ReactNode } from "react";
import { ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import type { Page } from "../lib/alerts";

export interface StatCard { label: string; value: string | number; note: string; noteTone: "good" | "bad" | "warn" | "accent"; sub: string; icon: ReactNode; tone: "teal" | "amber" | "red" | "blue" }

export function StatCards({ cards, label }: { cards: StatCard[]; label: string }) {
  return (
    <section className="kpis" aria-label={label}>
      {cards.map((k) => (
        <div className="card kpi" key={k.label}>
          <div className="kpi-head">
            <span className="kpi-label">{k.label}</span>
            <span className={`kpi-icon ${k.tone}`}>{k.icon}</span>
          </div>
          <div className="kpi-body">
            <span className="kpi-value">{k.value}</span>
            <span className="kpi-meta">
              <span className={`delta ${k.noteTone}`}>{k.note}</span>
              <span className="kpi-sub">{k.sub}</span>
            </span>
          </div>
        </div>
      ))}
    </section>
  );
}

export interface Tab { id: string; label: string; count: number }

export function Tabs({ tabs, active, onChange }: { tabs: Tab[]; active: string; onChange: (id: string) => void }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((t) => (
        <button key={t.id} role="tab" aria-selected={t.id === active} className={t.id === active ? "active" : undefined} onClick={() => onChange(t.id)}>
          {t.label} <span className="tab-count">{t.count}</span>
        </button>
      ))}
    </div>
  );
}

export function FilterSelect({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (v: string) => void }) {
  return (
    <label className="select">
      <span>{label}:</span>
      <select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)}>
        <option>All</option>
        {options.map((o) => <option key={o}>{o}</option>)}
      </select>
      <ChevronDown size={12} />
    </label>
  );
}

export function BulkBar({ count, noun, onClear, children }: { count: number; noun: string; onClear: () => void; children: ReactNode }) {
  if (count === 0) return null;
  return (
    <div className="bulk-bar" role="status">
      <strong>{count} {noun}{count === 1 ? "" : "s"} selected</strong>
      {children}
      <button className="link bulk-clear" onClick={onClear}>Clear selection</button>
    </div>
  );
}

export function QueuePager<T>({ p, total, noun, pageSize, onPage }: { p: Page<T>; total: number; noun: string; pageSize: number; onPage: (n: number) => void }) {
  return (
    <div className="table-foot">
      <span>Showing {p.start}-{p.end} of {total} {noun}</span>
      <div className="pager">
        <span className="rows-per-page">Rows per page {pageSize}</span>
        <button aria-label="Previous page" disabled={p.page <= 1} onClick={() => onPage(p.page - 1)}><ChevronLeft size={13} /></button>
        {Array.from({ length: p.pageCount }, (_, i) => i + 1).map((n) => (
          <button key={n} className={n === p.page ? "current" : undefined} aria-current={n === p.page ? "page" : undefined} onClick={() => onPage(n)}>{n}</button>
        ))}
        <button aria-label="Next page" disabled={p.page >= p.pageCount} onClick={() => onPage(p.page + 1)}><ChevronRight size={13} /></button>
      </div>
    </div>
  );
}

const sevClass = { Critical: "critical", High: "high", Medium: "medium", Low: "low" } as const;

export function SeverityPill({ level }: { level: keyof typeof sevClass }) {
  return <span className={`sev ${sevClass[level]}`}><span className="dot" />{level}</span>;
}

export function Assignee({ name }: { name: string | null }) {
  if (!name) return <span className="muted">Unassigned</span>;
  const init = name.replace(".", "").split(" ").map((w) => w[0]).join("");
  return <span className="analyst"><span className="mini-avatar initials">{init}</span>{name}</span>;
}

const statusClass: Record<string, string> = {
  Escalated: "escalated", New: "new", "In review": "review", "In progress": "review",
  "Pending info": "pending", "Pending approval": "approval",
};

export function StatusPill({ status }: { status: string }) {
  return <span className={`status ${statusClass[status]}`}><span className="dot" />{status}</span>;
}
