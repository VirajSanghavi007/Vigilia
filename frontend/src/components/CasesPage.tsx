import { useState } from "react";
import {
  AlarmClock, AlertTriangle, ArrowDownUp, ArrowRight, ArrowUpRight, Briefcase, CalendarClock, Download, FileCheck2,
  Link2, NotebookPen, Plus, Search, SlidersHorizontal, UserMinus, UserPlus,
} from "lucide-react";
import { Link } from "react-router-dom";
import type { Case, Cases } from "../data/types";
import { paginate } from "../lib/alerts";
import {
  applyFilters, caseRank, caseStats, matchesQuery, sortByPriority, toggleId, togglePage, uniqueValues, workload,
} from "../lib/queue";
import { inScope, scopeOfCase } from "../lib/scope";
import { casePath, paths } from "../routes";
import { useScope } from "./ScopeContext";
import { More } from "./OpsParts";
import { Assignee, BulkBar, FilterSelect, QueuePager, SeverityPill, StatCards, StatusPill, Tabs } from "./QueueParts";

export const CASE_PAGE_SIZE = 8;

type TabId = "all" | "mine" | "unassigned" | "approval" | "overdue" | "closed";

const activityIcon = { assign: UserPlus, sar: FileCheck2, note: NotebookPen };

// "AE · MSB" -> "MSB": the customer type after the jurisdiction.
const customerType = (c: Case) => c.entityType.split(" · ")[1] ?? c.entityType;
const dueState = (c: Case) => (c.overdue ? "Overdue" : c.dueToday ? "Due today" : "Upcoming");

export function CasesPage({ data }: { data: Cases }) {
  const { currentUser } = data;
  const { scope } = useScope();
  const cases = data.cases.filter((c) => inScope(scopeOfCase(c), scope));
  const s = caseStats(cases, currentUser);
  const load = workload(cases);
  const maxLoad = Math.max(1, s.unassigned, ...load.map((w) => w.count));
  const unassignedCritical = cases.filter((c) => c.priority === "Critical" && !c.investigator);

  const [tab, setTab] = useState<TabId>("all");
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState({ Priority: "All", Type: "All", Status: "All", Investigator: "All", Customer: "All", Due: "All" });
  const [moreOpen, setMoreOpen] = useState(false);
  const extras = Number(filters.Customer !== "All") + Number(filters.Due !== "All");
  const [dir, setDir] = useState<"desc" | "asc">("desc");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(() => new Set([cases[0]?.id].filter(Boolean)));

  const reset = <A,>(fn: (v: A) => void) => (v: A) => { fn(v); setPage(1); };

  const inTab: Record<TabId, (c: Case) => boolean> = {
    all: () => true,
    mine: (c) => c.investigator === currentUser,
    unassigned: (c) => !c.investigator,
    approval: (c) => c.status === "Pending approval",
    overdue: (c) => c.overdue,
    closed: () => false, // closed cases are archived, not part of the open list
  };
  const visible = sortByPriority(
    applyFilters(
      cases.filter((c) => inTab[tab](c) && matchesQuery([c.id, c.entity, c.entityId], query)),
      [
        { get: (c) => c.priority, value: filters.Priority },
        { get: (c) => c.type, value: filters.Type },
        { get: (c) => c.status, value: filters.Status },
        { get: (c) => c.investigator ?? "Unassigned", value: filters.Investigator },
        { get: customerType, value: filters.Customer },
        { get: dueState, value: filters.Due },
      ],
    ),
    caseRank, dir,
  );
  const p = paginate(visible, page, CASE_PAGE_SIZE);
  const pageIds = p.items.map((c) => c.id);
  const allOnPage = pageIds.length > 0 && pageIds.every((id) => selected.has(id));

  return (
    <>
      <StatCards label="Case metrics" cards={[
        { label: "Open cases", value: s.open, note: `+${data.openedThisWeek} this week`, noteTone: "bad", sub: "Current investigation workload", icon: <Briefcase size={13} />, tone: "teal" },
        { label: "Critical priority", value: s.critical, note: `${s.criticalOverdue} overdue`, noteTone: "bad", sub: "Immediate attention required", icon: <AlertTriangle size={13} />, tone: "red" },
        { label: "Unassigned cases", value: s.unassigned, note: `${s.unassignedPct}% of workload`, noteTone: "warn", sub: "Ready for investigator assignment", icon: <UserMinus size={13} />, tone: "amber" },
        { label: "Due today", value: s.dueToday, note: `${s.dueTodayAwaitingApproval} awaiting approval`, noteTone: "accent", sub: "Review deadlines · Sep 28", icon: <CalendarClock size={13} />, tone: "blue" },
        { label: "Overdue cases", value: s.overdue, note: `Oldest: ${data.oldestOverdue}`, noteTone: "bad", sub: "Investigation SLA breached", icon: <AlarmClock size={13} />, tone: "red" },
      ]} />

      <section className="card table-card" aria-label="Case management">
        <div className="card-head">
          <div>
            <h2>Case management <span className="pill teal">{s.open} open cases</span></h2>
            <p className="card-sub">Prioritized by investigation urgency and review deadline · All times UTC</p>
          </div>
          <div className="table-actions">
            <button className="btn"><Download size={13} />Export</button>
            <button className="btn primary"><Plus size={13} />Create case</button>
          </div>
        </div>

        <Tabs active={tab} onChange={reset((id: string) => setTab(id as TabId))} tabs={[
          { id: "all", label: "All open", count: s.open },
          { id: "mine", label: "My cases", count: s.mine },
          { id: "unassigned", label: "Unassigned", count: s.unassigned },
          { id: "approval", label: "Pending approval", count: s.pendingApproval },
          { id: "overdue", label: "Overdue", count: s.overdue },
          { id: "closed", label: "Closed", count: data.closed },
        ]} />

        <div className="toolbar">
          <label className="search grow">
            <Search size={14} />
            <input placeholder="Search case ID, customer or entity" aria-label="Search cases" value={query} onChange={(e) => reset(setQuery)(e.target.value)} />
          </label>
          <FilterSelect label="Priority" value={filters.Priority} options={["Critical", "High", "Medium", "Low"]} onChange={reset((v: string) => setFilters({ ...filters, Priority: v }))} />
          <FilterSelect label="Type" value={filters.Type} options={uniqueValues(cases, (c) => c.type)} onChange={reset((v: string) => setFilters({ ...filters, Type: v }))} />
          <FilterSelect label="Status" value={filters.Status} options={uniqueValues(cases, (c) => c.status)} onChange={reset((v: string) => setFilters({ ...filters, Status: v }))} />
          <FilterSelect label="Investigator" value={filters.Investigator} options={uniqueValues(cases, (c) => c.investigator ?? "Unassigned")} onChange={reset((v: string) => setFilters({ ...filters, Investigator: v }))} />
          <button className={`btn${moreOpen ? " on" : ""}`} aria-expanded={moreOpen} onClick={() => setMoreOpen(!moreOpen)}>
            <SlidersHorizontal size={13} />More filters{extras > 0 && <span className="count-badge">{extras}</span>}
          </button>
          <button className="btn sort" onClick={() => setDir(dir === "desc" ? "asc" : "desc")}>
            <ArrowDownUp size={13} />Priority: {dir === "desc" ? "Highest first" : "Lowest first"}
          </button>
        </div>

        {moreOpen && (
          <div className="toolbar" role="group" aria-label="More filters">
            <FilterSelect label="Customer" value={filters.Customer} options={uniqueValues(cases, customerType)} onChange={reset((v: string) => setFilters({ ...filters, Customer: v }))} />
            <FilterSelect label="Due" value={filters.Due} options={["Overdue", "Due today", "Upcoming"]} onChange={reset((v: string) => setFilters({ ...filters, Due: v }))} />
          </div>
        )}

        <BulkBar count={selected.size} noun="case" onClear={() => setSelected(new Set())}>
          <button className="btn small"><UserPlus size={12} />Assign to</button>
          <button className="btn small">Change priority</button>
          <button className="btn small">Add note</button>
        </BulkBar>

        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th className="check"><input type="checkbox" aria-label="Select page" checked={allOnPage} onChange={() => setSelected(togglePage(selected, pageIds))} /></th>
                <th>Case ID</th><th>Customer / entity</th><th>Investigation type</th><th>Priority</th><th>Status</th>
                <th>Investigator</th><th>Alerts</th><th>Due date · UTC</th><th className="right">Action</th>
              </tr>
            </thead>
            <tbody>
              {p.items.map((c) => {
                const on = selected.has(c.id);
                return (
                  <tr key={c.id} className={on ? "featured" : undefined}>
                    <td className="check"><input type="checkbox" aria-label={`Select ${c.id}`} checked={on} onChange={() => setSelected(toggleId(selected, c.id))} /></td>
                    <td><div className="id-cell">{c.id}</div><div className="entity-meta">{c.opened}</div></td>
                    <td><div className="entity-name">{c.entity}</div><div className="entity-meta">{c.entityId} · {c.entityType}</div></td>
                    <td><div>{c.type}</div><div className="entity-meta">{c.typeSub}</div></td>
                    <td><SeverityPill level={c.priority} /></td>
                    <td><StatusPill status={c.status} /></td>
                    <td><Assignee name={c.investigator} /></td>
                    <td><span className="typology"><Link2 size={12} />{c.alerts}</span></td>
                    <td><div>{c.due}</div><div className={`entity-meta ${c.overdue ? "bad" : c.dueToday ? "warn" : ""}`}>{c.dueNote}</div></td>
                    <td className="right"><Link className={`btn small${on ? " primary" : ""}`} to={casePath(c.id)} aria-label={`Review ${c.id}`}><ArrowUpRight size={12} />Review</Link></td>
                  </tr>
                );
              })}
              {p.items.length === 0 && (
                <tr><td colSpan={10} className="empty">{tab === "closed" ? "Closed cases are archived and not shown in the open list" : "No cases match these filters"}</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <QueuePager p={p} total={visible.length} noun={tab === "all" ? "open cases" : "cases"} pageSize={CASE_PAGE_SIZE} onPage={setPage} />
      </section>

      <section className="grid-2">
        <div className="card" role="region" aria-label="Investigator workload">
          <div className="card-head">
            <div>
              <h2>Investigator workload</h2>
              <p className="card-sub">{s.open - s.unassigned} assigned cases across {load.length} investigators · {s.unassigned} awaiting assignment</p>
            </div>
            <More to={paths.investigators}>Manage team</More>
          </div>
          <div className="workload">
            {load.map((w) => (
              <div key={w.name}><Assignee name={w.name} /><div className="big">{w.count} <span className="kpi-sub">cases</span></div><span className="track thin"><span style={{ width: `${(w.count / maxLoad) * 100}%`, background: "var(--accent-dark)" }} /></span></div>
            ))}
            <div><span className="muted">Unassigned</span><div className="big">{s.unassigned} <span className="kpi-sub">cases</span></div><span className="track thin"><span style={{ width: `${(s.unassigned / maxLoad) * 100}%`, background: "var(--high)" }} /></span></div>
          </div>
          {unassignedCritical.length > 0 && (
            <p className="foot-note">
              <AlertTriangle size={12} className="bad" />
              {unassignedCritical.length} critical case{unassignedCritical.length === 1 ? " is" : "s are"} unassigned.
              <button className="link" onClick={() => setSelected(new Set([unassignedCritical[0].id]))}>Assign {unassignedCritical[0].id} <ArrowRight size={12} /></button>
            </p>
          )}
        </div>
        <div className="card" role="region" aria-label="Recent case activity">
          <div className="card-head">
            <h2>Recent case activity</h2>
            <More to={paths.audit}>View audit log</More>
          </div>
          <ul className="activity">
            {data.activity.map((a) => {
              const Icon = activityIcon[a.kind];
              return (
                <li key={a.title}>
                  <span className={`act-icon ${a.kind}`}><Icon size={13} /></span>
                  <div className="user-text"><div className="act-title">{a.title}</div><div className="act-sub">{a.sub}</div></div>
                  <span className="act-sub">{a.ago}</span>
                </li>
              );
            })}
          </ul>
        </div>
      </section>
    </>
  );
}
