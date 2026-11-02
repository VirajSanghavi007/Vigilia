import { AlarmClock, ArrowRight, Briefcase, Download, Gauge, Inbox, Users } from "lucide-react";
import { Link } from "react-router-dom";
import { investigators as data, type Assignment } from "../data/ops";
import { initials } from "../lib/format";
import { capacityTone } from "../lib/ops";
import { alertPath, casePath, paths } from "../routes";
import { SEVERITY_RANK, uniqueValues } from "../lib/queue";
import { ActivityCard, More, Note } from "./OpsParts";
import { Assignee, FilterSelect, SeverityPill, StatCards, Tabs } from "./QueueParts";
import { PAGE_SIZE, useTable } from "./useTable";

const D = "Assignment & escalation desk";
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
// Team of the suggested owner ("N. Karim" -> "Retail"), matched on surname against the roster.
export function teamOf(name: string | null): string {
  const surname = name?.split(" ").at(-1);
  const p = surname ? data.team.find((t) => t.name.split(" ").at(-1) === surname) : undefined;
  return p?.role.split(" · ")[1] ?? "Unassigned";
}

export function InvestigatorsPage() {
  const rows = data.rows;
  // Only attention items are mocked; the 11 completed today are archived.
  const tbl = useTable<Assignment>(rows, {
    tabs: { attention: () => true, all: () => true, completed: () => false },
    filters: { Team: (x) => teamOf(x.suggested), Priority: (x) => x.priority },
    search: (x) => [x.id, x.entity],
    rank: (x) => SEVERITY_RANK[x.priority] * 10 + (x.late ? 5 : 0) + (x.owner ? 0 : 1),
  }, "attention");
  const stageTotal = data.stages.reduce((s, x) => s + x.count, 0);

  return (
    <>
      <StatCards label="Team metrics" cards={[
        { label: "Active investigators", value: 4, note: "4 online", noteTone: "good", sub: "Financial crime operations", icon: <Users size={13} />, tone: "teal" },
        { label: "Assigned cases", value: 12, note: "14 open cases", noteTone: "accent", sub: "2 awaiting assignment", icon: <Briefcase size={13} />, tone: "blue" },
        { label: "Unassigned alerts", value: 12, note: "3 critical priority", noteTone: "bad", sub: "27 open alerts in queue", icon: <Inbox size={13} />, tone: "amber" },
        { label: "Team utilization", value: "76%", note: "Within target", noteTone: "good", sub: "Target range: 65–85%", icon: <Gauge size={13} />, tone: "teal" },
        { label: "Overdue cases", value: 2, note: "Oldest: 18h", noteTone: "bad", sub: "Review with team lead", icon: <AlarmClock size={13} />, tone: "red" },
      ]} />

      <section className="people" aria-label="Investigators">
        {data.team.map((p) => (
          <div className="card person" key={p.name} role="region" aria-label={p.name}>
            <div className="person-head">
              <span className="avatar">{initials(p.name)}</span>
              <div style={{ flex: 1 }}><div className="entity-name">{p.name}</div><div className="entity-meta">{p.role}</div></div>
              <span className="live-tag"><span className="dot green" />Online</span>
            </div>
            <div className="person-nums">
              <div><span className="card-sub">Open cases</span><span className="big">{plural(p.openCases, "case")}</span></div>
              <div><span className="card-sub">Assigned alerts</span><span className="big">{plural(p.alerts, "alert")}</span></div>
              <div><span className={`big delta ${capacityTone(p.capacity)}`}>{p.capacity}% capacity</span></div>
            </div>
            <div className="track thin"><span style={{ width: `${p.capacity}%`, background: `var(--${capacityTone(p.capacity) === "good" ? "accent" : capacityTone(p.capacity) === "warn" ? "medium" : "critical"})` }} /></div>
            <div className="card-foot"><span>{p.note}</span><More to={paths.cases}>View workload</More></div>
          </div>
        ))}
      </section>

      <section className="card table-card" aria-label={D}>
        <div className="card-head">
          <div>
            <h2>{D} <span className="pill teal">2 cases · 12 alerts unassigned</span></h2>
            <p className="card-sub">Suggested owners reflect skill coverage and current capacity · All times UTC</p>
          </div>
          <div className="table-actions"><button className="btn"><Download size={13} />Export</button><button className="btn primary">Auto-assign work</button></div>
        </div>
        <Tabs active={tbl.tab} onChange={tbl.setTab} tabs={[
          { id: "attention", label: "Needs attention", count: data.tabCounts.attention },
          { id: "all", label: "All assignments", count: data.tabCounts.all },
          { id: "completed", label: "Completed today", count: data.tabCounts.completed },
        ]} />
        <div className="toolbar">
          <FilterSelect label="Team" value={tbl.filters.Team} options={uniqueValues(rows, (x) => teamOf(x.suggested))} onChange={(v) => tbl.setFilter("Team", v)} />
          <FilterSelect label="Priority" value={tbl.filters.Priority} options={["Critical", "High", "Medium", "Low"]} onChange={(v) => tbl.setFilter("Priority", v)} />
        </div>
        <div className="table-scroll">
          <table>
            <thead><tr><th>Record</th><th>Customer / typology</th><th>Priority</th><th>Current owner</th><th>Deadline · UTC</th><th>Suggested owner</th><th className="right">Action</th></tr></thead>
            <tbody>
              {tbl.p.items.map((x) => (
                <tr key={x.id}>
                  <td><div className="id-cell">{x.id}</div><div className="entity-meta">{x.kind}</div></td>
                  <td><div className="entity-name">{x.entity}</div><div className="entity-meta">{x.typology}</div></td>
                  <td><SeverityPill level={x.priority} /></td>
                  <td><Assignee name={x.owner} /><div className="entity-meta">{x.ownerNote}</div></td>
                  <td><div>{x.deadline}</div><div className={`entity-meta${x.late ? " bad" : ""}`}>{x.deadlineNote}</div></td>
                  <td><Assignee name={x.suggested} /><div className="entity-meta">{x.suggestedNote}</div></td>
                  <td className="right">{x.action === "Review"
                    // Review opens the record; Assign is an in-place action with no destination.
                    ? <Link className="btn small" to={x.id.startsWith("ALT-") ? alertPath(x.id) : casePath(x.id)} aria-label={`Review ${x.id}`}>Review <ArrowRight size={12} /></Link>
                    : <button className="btn small primary">{x.action} <ArrowRight size={12} /></button>}</td>
                </tr>
              ))}
              {tbl.p.items.length === 0 && (
                <tr><td colSpan={7} className="empty">{tbl.tab === "completed" ? "Completed assignments are archived in the audit log" : "No assignments match these filters"}</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="table-foot"><span>Showing {tbl.p.items.length} attention items · 12 assigned cases across 4 investigators</span><span>Rows per page: {PAGE_SIZE}</span></div>
      </section>

      <section className="grid-3 even">
        <div className="card" role="region" aria-label="Workload by investigation stage">
          <div className="card-head"><div><h2>Workload by investigation stage</h2><p className="card-sub">{stageTotal} assigned cases · Current team portfolio</p></div><More to={paths.cases}>Case queue</More></div>
          <ul className="dist-list">
            {data.stages.map((s) => <li key={s.label}><span className="dot" style={{ background: s.color }} />{s.label}<strong>{plural(s.count, "case")}</strong></li>)}
          </ul>
          <p className="foot-note">4 reviews due today · 1 awaiting approval</p>
        </div>
        <div className="card" role="region" aria-label="Coverage & assignment guidance">
          <h2>Coverage & assignment guidance</h2>
          <p className="card-sub">Monday, Sep 28 · 08:00–18:00 UTC</p>
          <ul className="checklist">
            <li><span><strong>L2 / cross-border</strong><span className="card-sub">D. Cho · M. Alvarez</span></span></li>
            <li><span><strong>Retail / KYC</strong><span className="card-sub">N. Karim · A. Patel</span></span></li>
          </ul>
          <Note>Nadia Karim has the most available capacity. Route critical cases through an L2 reviewer before final disposition.</Note>
          <div className="table-actions spaced"><button className="btn">Manage availability</button><Link className="btn" to={paths.assignmentPolicy}>Assignment policy</Link></div>
        </div>
        <ActivityCard title="Recent team activity" sub="Today · All times UTC" link="View audit log" to={paths.audit} items={data.activity} />
      </section>
    </>
  );
}
