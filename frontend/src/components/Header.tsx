import { useState, type ReactNode } from "react";
import { Bell, Building2, Calendar, ChevronDown, Globe, Monitor, Moon, Plus, RefreshCw, Search, Sun, X } from "lucide-react";
import { Link } from "react-router-dom";
import { DEFAULT_SCOPE, MIN_SCORES, RANGES, UNITS, extraCount, isDefaultScope, type RangeId } from "../lib/scope";
import { THEME_PREFS, type ThemePref } from "../lib/theme";
import { paths } from "../routes";
import { useScope } from "./ScopeContext";
import { useTheme } from "./useTheme";

interface Props {
  title?: string;
  subtitle?: string;
  /** Red pill next to the title, e.g. "7 SLA breaches". */
  pill: string;
  /** Teal for neutral states ("Loading", "Relationship view"); red for counts that need action. */
  pillTone?: "red" | "teal";
  /** Account and admin pages: breadcrumb trail under the workspace name instead of filters. */
  crumb?: string;
  /** Replaces the date/unit/jurisdiction filter row, e.g. a loading status line. */
  meta?: ReactNode;
  refreshedMinsAgo: number;
  /** When omitted the search box is an unwired global search (queue pages have their own). */
  query?: string;
  onQuery?: (q: string) => void;
  /**
   * Options for the workspace filters. Only pages whose data the filters
   * apply to pass these; the rest show just the refresh status, so no
   * control on screen is a dead end.
   */
  scopeOptions?: { jurisdictions: string[]; typologies: string[] };
}

const themeIcon = { light: Sun, dark: Moon, system: Monitor };
const themeName = { light: "Light", dark: "Dark", system: "System" };

export function Header({
  title = "Financial Crime Overview",
  subtitle = "Monitoring posture and investigation workload across all business units",
  pill, pillTone = "red", crumb, meta, refreshedMinsAgo, query, onQuery, scopeOptions,
}: Props) {
  const [theme, setTheme] = useTheme();
  const next: ThemePref = THEME_PREFS[(THEME_PREFS.indexOf(theme) + 1) % THEME_PREFS.length];
  const ThemeIcon = themeIcon[theme];
  const refreshed = (
    <span className="refreshed">
      <span className="dot green" />Data refreshed {refreshedMinsAgo} min ago<RefreshCw size={12} />
    </span>
  );

  return (
    <header className="header">
      {crumb && (
        <nav className="crumbs" aria-label="Breadcrumb">
          <span>Vigilia AML Operations</span><span aria-hidden>/</span><span aria-current="page">{crumb}</span>
          <span className="pill teal">Production</span>
        </nav>
      )}
      <div className="header-top">
        <div>
          <h1>
            {title}
            <span className={`sla-pill ${pillTone}`}><span className="dot" />{pill}</span>
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
          <button className="icon-btn" aria-label={`Theme: ${themeName[theme]}. Switch to ${themeName[next]}`} title={`Theme: ${themeName[theme]}`} onClick={() => setTheme(next)}>
            <ThemeIcon size={15} />
          </button>
          <Link className="icon-btn" to={paths.notifications} aria-label="Notifications"><Bell size={15} /></Link>
        </div>
      </div>
      {crumb ? (
        <p className="header-meta">September 28, 2026 · All audit times UTC</p>
      ) : meta ?? (scopeOptions ? <ScopeFilters {...scopeOptions} refreshed={refreshed} /> : <div className="filters">{refreshed}</div>)}
    </header>
  );
}

function ScopeFilters({ jurisdictions, typologies, refreshed }: { jurisdictions: string[]; typologies: string[]; refreshed: ReactNode }) {
  const { scope, setScope } = useScope();
  const [open, setOpen] = useState(false);
  const extras = extraCount(scope);

  return (
    <div className="filters">
      <label className="filter">
        <Calendar size={13} />
        <select aria-label="Date range" value={scope.range} onChange={(e) => setScope({ ...scope, range: e.target.value as RangeId })}>
          {RANGES.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
        </select>
        <ChevronDown size={13} />
      </label>
      <label className="filter">
        <Building2 size={13} />
        <select aria-label="Business unit" value={scope.unit} onChange={(e) => setScope({ ...scope, unit: e.target.value })}>
          <option value="All">All business units</option>
          {UNITS.map((u) => <option key={u}>{u}</option>)}
        </select>
        <ChevronDown size={13} />
      </label>
      <label className="filter">
        <Globe size={13} />
        <select aria-label="Jurisdiction" value={scope.jurisdiction} onChange={(e) => setScope({ ...scope, jurisdiction: e.target.value })}>
          <option value="All">All jurisdictions</option>
          {jurisdictions.map((j) => <option key={j}>{j}</option>)}
        </select>
        <ChevronDown size={13} />
      </label>
      <div className="filter-more">
        <button className={`filter${open ? " on" : ""}`} aria-expanded={open} onClick={() => setOpen(!open)}>
          More filters{extras > 0 && <span className="count-badge">{extras}</span>}<Plus size={13} />
        </button>
        {open && (
          <div className="filter-pop" role="group" aria-label="More filters">
            <label className="field">
              <span className="field-label">Typology</span>
              <select aria-label="Typology" value={scope.typology} onChange={(e) => setScope({ ...scope, typology: e.target.value })}>
                <option value="All">Any typology</option>
                {typologies.map((t) => <option key={t}>{t}</option>)}
              </select>
            </label>
            <label className="field">
              <span className="field-label">Minimum risk score</span>
              <select aria-label="Minimum risk score" value={scope.minScore} onChange={(e) => setScope({ ...scope, minScore: Number(e.target.value) })}>
                <option value={0}>Any score</option>
                {MIN_SCORES.map((m) => <option key={m} value={m}>{m}+</option>)}
              </select>
            </label>
            <button className="btn small" onClick={() => setOpen(false)}>Done</button>
          </div>
        )}
      </div>
      {scope.typology !== "All" && (
        <span className="filter-chip">Typology: {scope.typology}
          <button aria-label="Remove typology filter" onClick={() => setScope({ ...scope, typology: "All" })}><X size={11} /></button>
        </span>
      )}
      {scope.minScore > 0 && (
        <span className="filter-chip">Score {scope.minScore}+
          <button aria-label="Remove score filter" onClick={() => setScope({ ...scope, minScore: 0 })}><X size={11} /></button>
        </span>
      )}
      {!isDefaultScope(scope) && <button className="link" onClick={() => setScope(DEFAULT_SCOPE)}>Reset filters</button>}
      {refreshed}
    </div>
  );
}
