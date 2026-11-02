import { CalendarClock, CheckCircle2, ClipboardCheck, Download, FileText, Plus, Search, Timer } from "lucide-react";
import { reports as data, type Report } from "../data/ops";
import { filingStep, pagerTotal, stepState } from "../lib/ops";
import { uniqueValues } from "../lib/queue";
import { paths, reportPath } from "../routes";
import { ActivityCard, Facts, More, MoreFilters, Note } from "./OpsParts";
import { Assignee, FilterSelect, QueuePager, StatCards, StatusPill, Tabs } from "./QueueParts";
import { PAGE_SIZE, useTable } from "./useTable";

const R = "Regulatory report register";
const STATUSES = ["Draft", "In review", "Approved", "Submitted", "Accepted"] as const;
const WORKFLOW = ["Evidence", "Narrative", "Approval", "Submit"] as const;
// Filing urgency: open work first, then by how far through the workflow it is.
const stage = (x: Report) => STATUSES.length - STATUSES.indexOf(x.status);

export function ReportsPage() {
  const rows = data.rows;
  const tbl = useTable<Report>(rows, {
    tabs: {
      all: () => true, draft: (x) => x.status === "Draft", review: (x) => x.status === "In review",
      approved: (x) => x.status === "Approved", filed: (x) => x.status === "Submitted" || x.status === "Accepted",
    },
    filters: { Type: (x) => x.type, Status: (x) => x.status, Owner: (x) => x.preparer, Reviewer: (x) => x.reviewer ?? "Unassigned" },
    search: (x) => [x.id, x.subject, x.ref],
    rank: stage,
  }, "all");
  const f = tbl.focus;
  const current = f ? filingStep(f.status) : 0;
  const detail = f && data.detail[f.id];

  return (
    <>
      <section className="card overview-card" aria-label="Reporting overview">
        <div className="card-head">
          <div><h2>Reporting overview</h2><p className="card-sub">Current workflow state · September 2026</p></div>
          <span className="pill teal">{data.population} reports</span>
        </div>
        <StatCards label="Reporting metrics" cards={[
          { label: data.overview[0].label, value: data.overview[0].value, note: data.overview[0].note, noteTone: "accent", sub: "SAR and CTR filings", icon: <FileText size={13} />, tone: "teal" },
          { label: data.overview[1].label, value: data.overview[1].value, note: data.overview[1].note, noteTone: "warn", sub: "Drafting in progress", icon: <Timer size={13} />, tone: "amber" },
          { label: data.overview[2].label, value: data.overview[2].value, note: data.overview[2].note, noteTone: "bad", sub: "Four-eyes approval", icon: <ClipboardCheck size={13} />, tone: "red" },
          { label: data.overview[3].label, value: data.overview[3].value, note: data.overview[3].note, noteTone: "good", sub: "Rolling 90 days", icon: <CheckCircle2 size={13} />, tone: "teal" },
          { label: data.overview[4].label, value: data.overview[4].value, note: data.overview[4].note, noteTone: "accent", sub: "Automated exports", icon: <CalendarClock size={13} />, tone: "blue" },
        ]} />
      </section>

      <section className="card table-card" aria-label={R}>
        <div className="card-head">
          <div>
            <h2>{R} <span className="pill teal">{data.population} reports</span></h2>
            <p className="card-sub">SAR / CTR lifecycle and regulatory deadlines · All times UTC</p>
          </div>
          <div className="table-actions"><button className="btn"><Download size={13} />Export</button><button className="btn primary"><Plus size={13} />Create report</button></div>
        </div>
        <Tabs active={tbl.tab} onChange={tbl.setTab} tabs={[
          { id: "all", label: "All reports", count: data.tabCounts.all },
          { id: "draft", label: "Draft", count: data.tabCounts.draft },
          { id: "review", label: "In review", count: data.tabCounts.review },
          { id: "approved", label: "Approved", count: data.tabCounts.approved },
          { id: "filed", label: "Filed", count: data.tabCounts.filed },
        ]} />
        <div className="toolbar">
          <label className="search grow"><Search size={14} />
            <input placeholder="Search report ID, case or customer" aria-label="Search reports" value={tbl.query} onChange={(e) => tbl.setQuery(e.target.value)} />
          </label>
          <FilterSelect label="Type" value={tbl.filters.Type} options={["SAR", "CTR"]} onChange={(v) => tbl.setFilter("Type", v)} />
          <FilterSelect label="Status" value={tbl.filters.Status} options={[...STATUSES]} onChange={(v) => tbl.setFilter("Status", v)} />
          <FilterSelect label="Owner" value={tbl.filters.Owner} options={uniqueValues(rows, (x) => x.preparer)} onChange={(v) => tbl.setFilter("Owner", v)} />
          <MoreFilters options={{ Reviewer: uniqueValues(rows, (x) => x.reviewer ?? "Unassigned") }} values={tbl.filters} onChange={tbl.setFilter} />
        </div>
        <div className="table-scroll">
          <table>
            <thead><tr><th>Report / subject</th><th>Type / case</th><th>Status</th><th>Prepared by</th><th>Filing deadline</th><th>Last updated · UTC</th></tr></thead>
            <tbody>
              {tbl.p.items.map((x) => (
                <tr key={x.id} className={f?.id === x.id ? "featured" : undefined}>
                  <td><button className="id-cell id-link" aria-label={`Open ${x.id}`} onClick={() => tbl.select(x.id)}>{x.id}</button><div className="entity-meta">{x.subject}</div></td>
                  <td><span className={`pill ${x.type === "SAR" ? "red" : "teal"}`}>{x.type}</span><div className="entity-meta">{x.ref}</div></td>
                  <td><StatusPill status={x.status} /></td>
                  <td><Assignee name={x.preparer} /><div className="entity-meta">{x.reviewer ? `${x.reviewer} · Reviewer` : "Regulatory reporting"}</div></td>
                  <td><div>{x.deadline}</div><div className="entity-meta">{x.deadlineNote}</div></td>
                  <td><div>{x.updated}</div><div className="entity-meta">{x.note}</div></td>
                </tr>
              ))}
              {tbl.p.items.length === 0 && <tr><td colSpan={6} className="empty">No reports match these filters</td></tr>}
            </tbody>
          </table>
        </div>
        <QueuePager p={tbl.p} total={pagerTotal(tbl.visible.length, data.population, tbl.narrowed)} noun="reports · September 2026" pageSize={PAGE_SIZE} onPage={tbl.setPage} />
      </section>

      <section className="grid-2">
        {f && (
          <div className="card" role="region" aria-label="Selected report">
            <div className="card-head">
              <div><h2>Selected report · <span className="accent">{f.id}</span> <StatusPill status={f.status} /></h2><p className="card-sub">{f.subject} · {f.type === "SAR" ? `Case ${f.ref}` : f.ref}</p></div>
              <More to={reportPath(f.id)}>{f.status === "Draft" ? "Open draft" : "Open filing"}</More>
            </div>
            <ol className="stepper" aria-label="Filing steps">
              {WORKFLOW.map((s, i) => <li key={s} className={stepState(i, current)} aria-current={i === current ? "step" : undefined}><span className="step-dot" />{i + 1} {s}</li>)}
            </ol>
            {detail && <p className="narrative">{detail.narrative}</p>}
            <Facts items={[
              ["Prepared by", detail?.preparer ?? f.preparer], ["Reviewer", detail?.reviewer ?? f.reviewer ?? "Not required"],
              ["Attachments", detail?.attachments ?? `Deadline ${f.deadline} · ${f.deadlineNote}`],
            ]} />
            {detail && <Note tone="warn">{detail.nextStep}</Note>}
            {f.status === "Accepted" && <Note tone="good">Accepted by the regulatory gateway. {f.note}.</Note>}
          </div>
        )}
        <div className="card" role="region" aria-label="Scheduled reporting">
          <div className="card-head"><div><h2>Scheduled reporting</h2><p className="card-sub">Automated delivery · All times UTC</p></div><More to={paths.reportSchedules}>Manage</More></div>
          <ul className="checklist">
            {data.schedules.map((s) => (
              <li key={s.name}>
                <span><strong>{s.name} <span className="pill teal">Active</span></strong><span className="card-sub">{s.cadence}</span></span>
                <span className="right-meta"><span>{s.next}</span><span className="card-sub">{s.owner}</span></span>
              </li>
            ))}
          </ul>
          <Note tone="good">Last scheduled delivery completed today at 08:00. All recipients received the report.</Note>
          <div className="table-actions spaced"><button className="btn"><CalendarClock size={13} />Schedule report</button></div>
        </div>
      </section>

      <section className="grid-2">
        <div className="card" role="region" aria-label="Filing performance">
          <div className="card-head"><div><h2>Filing performance</h2><p className="card-sub">September 2026 · 28 filed reports</p></div><More to={paths.analytics}>View analytics</More></div>
          <dl className="perf-list">
            {data.performance.map((p) => <div key={p.label}><dt>{p.label}</dt><dd>{p.value}</dd></div>)}
          </dl>
        </div>
        <ActivityCard title="Recent reporting activity" sub="Latest filings and quality reviews" link="View history" to={paths.audit} items={data.activity} />
      </section>
    </>
  );
}
