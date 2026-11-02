import { Bell, Building2, Calendar, ChevronDown, Globe, Plus, RefreshCw, Search } from "lucide-react";

interface Props {
  title?: string;
  subtitle?: string;
  /** Red pill next to the title, e.g. "7 SLA breaches". */
  pill: string;
  refreshedMinsAgo: number;
  /** When omitted the search box is an unwired global search (queue pages have their own). */
  query?: string;
  onQuery?: (q: string) => void;
}

export function Header({
  title = "Financial Crime Overview",
  subtitle = "Monitoring posture and investigation workload across all business units",
  pill, refreshedMinsAgo, query, onQuery,
}: Props) {
  return (
    <header className="header">
      <div className="header-top">
        <div>
          <h1>
            {title}
            <span className="sla-pill"><span className="dot" />{pill}</span>
          </h1>
          <p className="subtitle">{subtitle}</p>
        </div>
        <div className="header-actions">
          <label className="search">
            <Search size={14} />
            <input key={onQuery ? "alerts" : "global"}
              placeholder="Search case or customer"
              aria-label={onQuery ? "Search alerts" : "Global search"}
              value={query}
              onChange={onQuery && ((e) => onQuery(e.target.value))}
            />
            <kbd>⌘K</kbd>
          </label>
          <button className="icon-btn" aria-label="Notifications"><Bell size={15} /></button>
        </div>
      </div>
      <div className="filters">
        <button className="filter"><Calendar size={13} />Sep 01 - Sep 28, 2026<ChevronDown size={13} /></button>
        <button className="filter"><Building2 size={13} />All business units<ChevronDown size={13} /></button>
        <button className="filter"><Globe size={13} />All jurisdictions<ChevronDown size={13} /></button>
        <button className="filter">More filters<Plus size={13} /></button>
        <span className="refreshed">
          <span className="dot green" />Data refreshed {refreshedMinsAgo} min ago<RefreshCw size={12} />
        </span>
      </div>
    </header>
  );
}
