import { ArrowDownUp, ArrowRight, Download, Plus, Search } from "lucide-react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { rules as data, type Rule } from "../data/ops";
import { pagerTotal } from "../lib/ops";
import { uniqueValues } from "../lib/queue";
import { paths, rulePath } from "../routes";
import { Facts, More, MoreFilters, Note } from "./OpsParts";
import { Assignee, FilterSelect, QueuePager, StatusPill, Tabs } from "./QueueParts";
import { PAGE_SIZE, useTable } from "./useTable";

const L = "Detection rule library";
// Rule family from the ID prefix: TM- transaction monitoring, SC- sanctions screening.
export const ruleType = (id: string) => (id.startsWith("SC-") ? "Screening" : "Monitoring");

export function RulesPage() {
  const rows = data.rows;
  // Model, change and validation tabs have no rule rows; their content lives in the cards below.
  const tbl = useTable<Rule>(rows, {
    tabs: { rules: () => true, models: () => false, changes: (x) => x.status === "Testing", validation: () => false },
    filters: { Status: (x) => x.status, Type: (x) => ruleType(x.id), Owner: (x) => x.owner, Team: (x) => x.ownerTeam },
    search: (x) => [x.id, x.name, x.logic],
    // Rows are stored in review-priority order; earlier means higher priority.
    rank: (x) => rows.length - rows.indexOf(x),
  }, "rules");
  const m = data.model;
  const f = tbl.focus;
  const detail = f && data.detail[f.id];

  return (
    <>
      <section className="card overview-card" aria-label="Overview">
        <div className="card-head">
          <div><h2>Overview</h2><p className="card-sub">Detection rule and model health across the current production configuration</p></div>
          <span className="pill teal">42 active rules</span>
        </div>
        <div className="kpis six" role="group" aria-label="Rule and model metrics">
          {data.overview.map((o) => (
            <div className="card kpi" key={o.label}><span className="kpi-label">{o.label}</span><span className="big">{o.value}</span><span className="card-sub">{o.note}</span></div>
          ))}
        </div>
      </section>
      <p className="foot-note">Rule and model figures on this page are design mock data, not Elliptic benchmark results.</p>
      <ModelCard />

      <section className="card table-card" aria-label={L}>
        <div className="card-head">
          <div>
            <h2>{L} <span className="pill teal">42 active rules</span></h2>
            <p className="card-sub">Production configuration and monitored outcomes · Alert mix as of Sep 28, 2026</p>
          </div>
          <div className="table-actions"><button className="btn"><Download size={13} />Export</button><button className="btn primary"><Plus size={13} />Create rule</button></div>
        </div>
        <Tabs active={tbl.tab} onChange={tbl.setTab} tabs={[
          { id: "rules", label: "Detection rules", count: data.tabCounts.rules },
          { id: "models", label: "Models", count: data.tabCounts.models },
          { id: "changes", label: "Change requests", count: data.tabCounts.changes },
          { id: "validation", label: "Validation history" },
        ]} />
        <div className="toolbar">
          <label className="search grow"><Search size={14} />
            <input placeholder="Search rule ID, name or typology" aria-label="Search rules" value={tbl.query} onChange={(e) => tbl.setQuery(e.target.value)} />
          </label>
          <FilterSelect label="Status" value={tbl.filters.Status} options={["Active", "Testing"]} onChange={(v) => tbl.setFilter("Status", v)} />
          <FilterSelect label="Type" value={tbl.filters.Type} options={["Monitoring", "Screening"]} onChange={(v) => tbl.setFilter("Type", v)} />
          <FilterSelect label="Owner" value={tbl.filters.Owner} options={uniqueValues(rows, (x) => x.owner)} onChange={(v) => tbl.setFilter("Owner", v)} />
          <MoreFilters options={{ Team: uniqueValues(rows, (x) => x.ownerTeam) }} values={tbl.filters} onChange={tbl.setFilter} />
          <button className="btn sort" onClick={tbl.flipSort}><ArrowDownUp size={13} />Priority: {tbl.dir === "desc" ? "Highest first" : "Lowest first"}</button>
        </div>
        <div className="table-scroll">
          <table>
            <thead><tr><th>Rule ID / name</th><th>Detection logic</th><th>Status</th><th className="right">Alerts · 30d</th><th className="right">False positive</th><th>Owner</th><th>Last updated · UTC</th><th className="right">Action</th></tr></thead>
            <tbody>
              {tbl.p.items.map((x) => (
                <tr key={x.id} className={f?.id === x.id ? "featured" : undefined}>
                  <td><div className="id-cell">{x.id}</div><div className="entity-meta">{x.name}</div></td>
                  <td><div>{x.logic}</div><div className="entity-meta">{x.logicSub}</div></td>
                  <td><StatusPill status={x.status} /></td>
                  <td className="right num"><div>{x.alerts}</div><div className="entity-meta">{x.alertsNote}</div></td>
                  <td className="right num"><div>{x.fpr.toFixed(1)}%</div><div className={`entity-meta${x.fprDelta.startsWith("+") ? " bad" : ""}`}>{x.fprDelta}</div></td>
                  <td><Assignee name={x.owner} /><div className="entity-meta">{x.ownerTeam}</div></td>
                  <td><div>{x.updated}</div><div className="entity-meta">{x.updatedNote}</div></td>
                  <td className="right"><button className="link" onClick={() => tbl.select(x.id)}>{x.status === "Testing" ? "Review test" : "Configure"} <ArrowRight size={12} /></button></td>
                </tr>
              ))}
              {tbl.p.items.length === 0 && (
                <tr><td colSpan={8} className="empty">{tbl.tab === "models" ? "Model versions are summarised in the Model monitoring card" : "No rules match these filters"}</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <QueuePager p={tbl.p} total={pagerTotal(tbl.visible.length, data.population, tbl.narrowed)} noun="rules · Production and shadow configurations" pageSize={PAGE_SIZE} onPage={tbl.setPage} />
      </section>

      <section className="grid-2">
        {f && (
          <div className="card" role="region" aria-label="Selected rule">
            <div className="card-head">
              <div><h2>Selected rule · <span className="accent">{f.id}</span> <StatusPill status={f.status === "Active" ? "Active in production" : "Shadow testing"} /></h2>
                <p className="card-sub">{detail?.version ?? `${f.name} · ${f.ownerTeam}`}</p></div>
              <More to={rulePath(f.id)}>View logic</More>
            </div>
            <p className="narrative">{detail?.logic ?? `${f.logic}: ${f.logicSub}.`}</p>
            <Facts items={detail?.facts ?? [["Alerts · 30d", `${f.alerts} · ${f.alertsNote}`], ["Owner", `${f.owner} · ${f.ownerTeam}`]]} />
            {detail && <Note>{detail.note}</Note>}
          </div>
        )}
        <div className="card" role="region" aria-label="Change control">
          <div className="card-head"><div><h2>Change control</h2><p className="card-sub">Approval required before deployment</p></div><More to={paths.audit}>Review changes</More></div>
          <ul className="checklist">
            {data.changes.map((c) => (
              <li key={c.title}><span><strong>{c.title}</strong><span className="card-sub">{c.sub}</span></span>
                {c.state === "Pending" ? <StatusPill status="Pending" /> : <span className="card-sub">{c.state}</span>}</li>
            ))}
          </ul>
          <Note>Every change is versioned and audit logged. Model {m.version} remains the active production model.</Note>
        </div>
      </section>
    </>
  );
}

function ModelCard() {
  const m = data.model;
  return (
    <div className="card" role="region" aria-label="Model monitoring">
      <div className="card-head">
        <div><h2>Model monitoring · {m.version}</h2><p className="card-sub">Transaction risk scoring · Production since Sep 12, 2026</p></div>
        <More to={paths.ruleModel}>Model details</More>
      </div>
      <Facts items={[
        ["Precision", <span key="p">{m.precision}% · <span className="delta good">{m.precisionDelta}</span></span>],
        ["Recall", <span key="r">{m.recall}% · <span className="delta good">{m.recallDelta}</span></span>],
        ["Population drift", `PSI ${m.psi} · Stable`],
      ]} />
      <p className="card-sub chart-label">Precision · 30-day trend</p>
      <div className="chart" style={{ height: 180 }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data.precisionTrend} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
            <CartesianGrid stroke="var(--grid)" vertical={false} />
            <XAxis dataKey="date" tick={{ fontSize: 11, fill: "var(--muted)" }} interval={6} tickLine={false} axisLine={false} />
            <YAxis domain={[74, 80]} tick={{ fontSize: 11, fill: "var(--muted)" }} tickLine={false} axisLine={false} unit="%" />
            <Tooltip formatter={(v: number) => [`${v}%`, "Precision"]} />
            <Line type="monotone" dataKey="precision" stroke="var(--accent)" strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <Note tone="good">No drift breach · Last validation Sep 27 · Next review Oct 12</Note>
    </div>
  );
}
