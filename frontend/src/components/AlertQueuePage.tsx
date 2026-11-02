import { useState } from "react";
import {
  AlertTriangle, ArrowDownUp, ArrowUpRight, Briefcase, CheckCircle2, Clock, Download, Inbox, ListChecks, NotebookPen,
  Search, SlidersHorizontal, UserMinus, UserPlus,
} from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";
import type { AlertQueue, Case, QueueAlert } from "../data/types";
import { paginate } from "../lib/alerts";
import { riskBand } from "../lib/format";
import {
  alertRank, applyFilters, caseFor, matchesQuery, queueStats, sortByPriority, toggleId, togglePage, uniqueValues,
} from "../lib/queue";
import { inScope, scopeOfQueueAlert } from "../lib/scope";
import { alertPath, casePath, paths } from "../routes";
import { useScope } from "./ScopeContext";
import { Assignee, BulkBar, FilterSelect, QueuePager, SeverityPill, StatCards, StatusPill, Tabs } from "./QueueParts";

export const QUEUE_PAGE_SIZE = 8;

type TabId = "all" | "mine" | "unassigned" | "breached" | "closed";

export function AlertQueuePage({ data, cases = [] }: { data: AlertQueue; cases?: Case[] }) {
  const { currentUser } = data;
  const { scope } = useScope();
  // The header scope narrows the whole queue, so the counts follow it too.
  const alerts = data.alerts.filter((a) => inScope(scopeOfQueueAlert(a), scope));
  const s = queueStats(alerts, currentUser);
  // "All typologies" links here with ?typology=... to open the queue pre-filtered.
  const [params] = useSearchParams();

  const [tab, setTab] = useState<TabId>("all");
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState({
    Severity: "All", Typology: params.get("typology") ?? "All", Status: "All", Assignee: "All", Rule: "All", SLA: "All",
  });
  const [moreOpen, setMoreOpen] = useState(false);
  const [dir, setDir] = useState<"desc" | "asc">("desc");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(() => new Set([alerts[0]?.id].filter(Boolean)));

  // Any change to what's shown sends the user back to page 1.
  const reset = <A,>(fn: (v: A) => void) => (v: A) => { fn(v); setPage(1); };

  const inTab: Record<TabId, (a: QueueAlert) => boolean> = {
    all: () => true,
    mine: (a) => a.assignee === currentUser,
    unassigned: (a) => !a.assignee,
    breached: (a) => a.slaBreached,
    closed: () => false, // closed alerts are archived, not part of the open queue
  };
  const visible = sortByPriority(
    applyFilters(
      alerts.filter((a) => inTab[tab](a) && matchesQuery([a.id, a.entity, a.entityId], query)),
      [
        { get: (a) => a.severity, value: filters.Severity },
        { get: (a) => a.typology, value: filters.Typology },
        { get: (a) => a.status, value: filters.Status },
        { get: (a) => a.assignee ?? "Unassigned", value: filters.Assignee },
        { get: (a) => a.rule, value: filters.Rule },
        { get: (a) => (a.slaBreached ? "Breached" : "Within SLA"), value: filters.SLA },
      ],
    ),
    alertRank, dir,
  );
  const p = paginate(visible, page, QUEUE_PAGE_SIZE);
  const pageIds = p.items.map((a) => a.id);
  const allOnPage = pageIds.length > 0 && pageIds.every((id) => selected.has(id));
  const focus = alerts.find((a) => selected.has(a.id)) ?? p.items[0];
  const focusCase = focus && caseFor(cases, focus.entityId);
  const extras = Number(filters.Rule !== "All") + Number(filters.SLA !== "All");

  return (
    <>
      <StatCards label="Queue metrics" cards={[
        { label: "Alerts awaiting triage", value: s.open, note: `+${data.newToday} today`, noteTone: "bad", sub: "Across all business units", icon: <Inbox size={13} />, tone: "teal" },
        { label: "Critical priority", value: s.critical, note: `${s.criticalUnassigned} unassigned`, noteTone: "bad", sub: "Immediate review required", icon: <AlertTriangle size={13} />, tone: "red" },
        { label: "Unassigned alerts", value: s.unassigned, note: `${s.unassignedPct}% of queue`, noteTone: "warn", sub: "Ready for analyst assignment", icon: <UserMinus size={13} />, tone: "amber" },
        { label: "SLA breaches", value: s.breached, note: `Oldest: ${data.oldestBreach}`, noteTone: "bad", sub: "Target first review: 2 hours", icon: <Clock size={13} />, tone: "red" },
        { label: "Median triage time", value: data.medianTriage, note: data.medianTriageDelta, noteTone: "good", sub: "vs. previous 7 days", icon: <CheckCircle2 size={13} />, tone: "teal" },
      ]} />

      <section className="card table-card" aria-label="Investigation queue">
        <div className="card-head">
          <div>
            <h2>Investigation queue <span className="pill teal">{s.open} open alerts</span></h2>
            <p className="card-sub">Prioritized by severity, SLA urgency and model risk score · All times UTC</p>
          </div>
          <div className="table-actions">
            <button className="btn"><Download size={13} />Export</button>
            {visible[0]
              ? <Link className="btn primary" to={alertPath(visible[0].id)}><ListChecks size={13} />Review next alert</Link>
              : <button className="btn primary" disabled><ListChecks size={13} />Review next alert</button>}
          </div>
        </div>

        <Tabs active={tab} onChange={reset((id: string) => setTab(id as TabId))} tabs={[
          { id: "all", label: "All open", count: s.open },
          { id: "mine", label: "My alerts", count: s.mine },
          { id: "unassigned", label: "Unassigned", count: s.unassigned },
          { id: "breached", label: "SLA breached", count: s.breached },
          { id: "closed", label: "Closed", count: data.closed },
        ]} />

        <div className="toolbar">
          <label className="search grow">
            <Search size={14} />
            <input placeholder="Search alert ID, customer or account" aria-label="Search queue" value={query} onChange={(e) => reset(setQuery)(e.target.value)} />
          </label>
          <FilterSelect label="Severity" value={filters.Severity} options={["Critical", "High", "Medium", "Low"]} onChange={reset((v: string) => setFilters({ ...filters, Severity: v }))} />
          <FilterSelect label="Typology" value={filters.Typology} options={uniqueValues(alerts, (a) => a.typology)} onChange={reset((v: string) => setFilters({ ...filters, Typology: v }))} />
          <FilterSelect label="Status" value={filters.Status} options={uniqueValues(alerts, (a) => a.status)} onChange={reset((v: string) => setFilters({ ...filters, Status: v }))} />
          <FilterSelect label="Assignee" value={filters.Assignee} options={uniqueValues(alerts, (a) => a.assignee ?? "Unassigned")} onChange={reset((v: string) => setFilters({ ...filters, Assignee: v }))} />
          <button className={`btn${moreOpen ? " on" : ""}`} aria-expanded={moreOpen} onClick={() => setMoreOpen(!moreOpen)}>
            <SlidersHorizontal size={13} />More filters{extras > 0 && <span className="count-badge">{extras}</span>}
          </button>
          <button className="btn sort" onClick={() => setDir(dir === "desc" ? "asc" : "desc")}>
            <ArrowDownUp size={13} />Priority: {dir === "desc" ? "Highest first" : "Lowest first"}
          </button>
        </div>

        {moreOpen && (
          <div className="toolbar" role="group" aria-label="More filters">
            <FilterSelect label="Rule" value={filters.Rule} options={uniqueValues(alerts, (a) => a.rule)} onChange={reset((v: string) => setFilters({ ...filters, Rule: v }))} />
            <FilterSelect label="SLA" value={filters.SLA} options={["Breached", "Within SLA"]} onChange={reset((v: string) => setFilters({ ...filters, SLA: v }))} />
          </div>
        )}

        <BulkBar count={selected.size} noun="alert" onClear={() => setSelected(new Set())}>
          <button className="btn small"><UserPlus size={12} />Assign to</button>
          <button className="btn small">Escalate</button>
          <button className="btn small">Close as false positive</button>
        </BulkBar>

        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th className="check"><input type="checkbox" aria-label="Select page" checked={allOnPage} onChange={() => setSelected(togglePage(selected, pageIds))} /></th>
                <th>Severity</th><th>Alert ID</th><th>Customer / entity</th><th>Detection typology</th>
                <th className="right">Amount</th><th aria-sort={dir === "desc" ? "descending" : "ascending"}>Score {dir === "desc" ? "↓" : "↑"}</th><th>Detected · UTC</th><th>Assignee</th><th>Status</th><th className="right">Action</th>
              </tr>
            </thead>
            <tbody>
              {p.items.map((a) => {
                const on = selected.has(a.id);
                return (
                  <tr key={a.id} className={on ? "featured" : undefined}>
                    <td className="check"><input type="checkbox" aria-label={`Select ${a.id}`} checked={on} onChange={() => setSelected(toggleId(selected, a.id))} /></td>
                    <td><SeverityPill level={a.severity} /></td>
                    <td><div className="id-cell">{a.id}</div><div className="entity-meta">Transaction alert</div></td>
                    <td><div className="entity-name">{a.entity}</div><div className="entity-meta">{a.entityId} · {a.entityType}</div></td>
                    <td><div>{a.typology}</div><div className="entity-meta">{a.rule}</div></td>
                    <td className="right num"><div>${a.amount.toLocaleString("en-US")}</div><div className="entity-meta">{a.txCount} transactions</div></td>
                    <td><ScoreBar score={a.score} /></td>
                    <td><div>{a.detected}</div><div className={`entity-meta${a.slaBreached ? " bad" : ""}`}>{a.sla}</div></td>
                    <td><Assignee name={a.assignee} /></td>
                    <td><StatusPill status={a.status} /></td>
                    <td className="right"><Link className={`btn small${on ? " primary" : ""}`} to={alertPath(a.id)} aria-label={`Review ${a.id}`}><ArrowUpRight size={12} />Review</Link></td>
                  </tr>
                );
              })}
              {p.items.length === 0 && (
                <tr><td colSpan={11} className="empty">{tab === "closed" ? "Closed alerts are archived and not shown in the open queue" : "No alerts match these filters"}</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <QueuePager p={p} total={visible.length} noun={tab === "all" ? "open alerts" : "alerts"} pageSize={QUEUE_PAGE_SIZE} onPage={setPage} />
      </section>

      {focus && (
        <section className="grid-2">
          <div className="card" aria-label="Selected alert snapshot" role="region">
            <div className="card-head">
              <h2>Selected alert snapshot <span className="accent">{focus.id}</span> <span className={`score ${riskBand(focus.score)}`}><b>{focus.severity} · {focus.score}/100</b></span></h2>
              <Link className="link" to={paths.investigations}>Open investigation <ArrowUpRight size={12} /></Link>
            </div>
            <p className="narrative">{focus.narrative}</p>
            <div className="facts">
              <div><span className="kpi-label">Triggered rule</span><div>{focus.rule}</div></div>
              <div><span className="kpi-label">Customer risk</span><div>{focus.customerRisk}</div></div>
              <div><span className="kpi-label">Linked activity</span><div>{focus.linked}</div></div>
            </div>
          </div>
          <div className="card" aria-label="Recommended next step" role="region">
            <h2>Recommended next step</h2>
            <p className="narrative">{focus.nextStep}</p>
            <div className="table-actions">
              <Link className="btn" to={focusCase ? casePath(focusCase.id) : paths.cases}><Briefcase size={13} />{focusCase ? `View case ${focusCase.id}` : "View cases"}</Link>
              <button className="btn"><NotebookPen size={13} />Add triage note</button>
            </div>
          </div>
        </section>
      )}
    </>
  );
}

export function ScoreBar({ score }: { score: number }) {
  const band = riskBand(score);
  return (
    <span className={`score-bar ${band}`}>
      <b>{score}</b>
      <span className="track thin"><span style={{ width: `${score}%` }} /></span>
    </span>
  );
}
