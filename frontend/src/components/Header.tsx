import { Bell, Building2, Calendar, ChevronDown, Globe, Plus, RefreshCw, Search } from "lucide-react";

interface Props {
  slaBreaches: number;
  refreshedMinsAgo: number;
  query: string;
  onQuery: (q: string) => void;
}

export function Header({ slaBreaches, refreshedMinsAgo, query, onQuery }: Props) {
  return (
    <header className="header">
      <div className="header-top">
        <div>
          <h1>
            Financial Crime Overview
            <span className="sla-pill"><span className="dot" />{slaBreaches} SLA breaches</span>
          </h1>
          <p className="subtitle">Monitoring posture and investigation workload across all business units</p>
        </div>
        <div className="header-actions">
          <label className="search">
            <Search size={14} />
            <input
              placeholder="Search case or customer"
              aria-label="Search alerts"
              value={query}
              onChange={(e) => onQuery(e.target.value)}
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
