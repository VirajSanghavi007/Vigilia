import { ArrowRight, Briefcase, ClipboardCheck, Download, FileClock, Search, ShieldAlert, Users, UserCheck } from "lucide-react";
import { customers as data, type Customer } from "../data/ops";
import { riskBand } from "../lib/format";
import { paths } from "../routes";
import { Link } from "react-router-dom";
import { pagerTotal, share } from "../lib/ops";
import { uniqueValues } from "../lib/queue";
import { ActivityCard, Distribution, Facts, More, MoreFilters, Note } from "./OpsParts";
import { Assignee, BulkBar, FilterSelect, QueuePager, StatCards, StatusPill, Tabs } from "./QueueParts";
import { PAGE_SIZE, useTable } from "./useTable";

const bandLabel = { critical: "Critical", high: "High", medium: "Medium", low: "Low" } as const;
const C = "Customer risk directory";
const initials = (name: string) => name.split(" ").slice(0, 2).map((w) => w[0]).join("");

export function CustomersPage() {
  const rows = data.rows;
  const tbl = useTable<Customer>(rows, {
    tabs: {
      all: () => true, high: (x) => x.score >= 75, due: (x) => x.kyc === "Review due" || x.nextWarn,
      evidence: (x) => x.kyc === "Documents due",
    },
    filters: {
      Risk: (x) => bandLabel[riskBand(x.score)], KYC: (x) => x.kyc,
      Type: (x) => x.meta.split(" · ").at(-1) ?? "",
      Owner: (x) => x.owner ?? "Unassigned",
    },
    search: (x) => [x.id, x.name, x.owner],
    rank: (x) => x.score,
  }, "all");
  const f = tbl.focus;
  const total = data.distribution.reduce((s, d) => s + d.count, 0);

  return (
    <>
      <StatCards label="Customer metrics" cards={[
        { label: "Monitored customers", value: "24,816", note: "+126 this month", noteTone: "accent", sub: "Individuals and entities", icon: <Users size={13} />, tone: "teal" },
        { label: "High-risk customers", value: "486", note: `${share(486, data.population)} of portfolio`, noteTone: "bad", sub: "Enhanced monitoring", icon: <ShieldAlert size={13} />, tone: "red" },
        { label: "KYC reviews due", value: "64", note: "18 overdue", noteTone: "bad", sub: "September review cycle", icon: <FileClock size={13} />, tone: "amber" },
        { label: "Pending evidence", value: "23", note: "8 due today", noteTone: "warn", sub: "Source of funds / identity", icon: <ClipboardCheck size={13} />, tone: "blue" },
        { label: "KYC completion", value: "98.4%", note: "+0.6 pts", noteTone: "good", sub: "vs. previous month", icon: <UserCheck size={13} />, tone: "teal" },
      ]} />

      <section className="card table-card" aria-label={C}>
        <div className="card-head">
          <div>
            <h2>{C} <span className="pill teal">24,816 customers</span></h2>
            <p className="card-sub">Risk-ranked customer records · KYC status and linked activity</p>
          </div>
          <div className="table-actions"><button className="btn"><Download size={13} />Export</button><Link className="btn primary" to={paths.customerReviews}>Start review</Link></div>
        </div>
        <Tabs active={tbl.tab} onChange={tbl.setTab} tabs={[
          { id: "all", label: "All customers", count: data.tabCounts.all },
          { id: "high", label: "High risk", count: data.tabCounts.high },
          { id: "due", label: "Review due", count: data.tabCounts.due },
          { id: "evidence", label: "Pending evidence", count: data.tabCounts.evidence },
        ]} />
        <div className="toolbar">
          <label className="search grow"><Search size={14} />
            <input placeholder="Search customer, entity or ID" aria-label="Search customers" value={tbl.query} onChange={(e) => tbl.setQuery(e.target.value)} />
          </label>
          <FilterSelect label="Risk" value={tbl.filters.Risk} options={["Critical", "High", "Medium", "Low"]} onChange={(v) => tbl.setFilter("Risk", v)} />
          <FilterSelect label="KYC" value={tbl.filters.KYC} options={uniqueValues(rows, (x) => x.kyc)} onChange={(v) => tbl.setFilter("KYC", v)} />
          <FilterSelect label="Type" value={tbl.filters.Type} options={["Corporate", "Individual", "MSB"]} onChange={(v) => tbl.setFilter("Type", v)} />
          <MoreFilters options={{ Owner: uniqueValues(rows, (x) => x.owner ?? "Unassigned") }} values={tbl.filters} onChange={tbl.setFilter} />
        </div>
        <BulkBar count={tbl.selected.size} noun="customer" onClear={tbl.clear}>
          <button className="btn small">Request evidence</button>
          <button className="btn small">Assign owner</button>
        </BulkBar>
        <div className="table-scroll">
          <table>
            <thead><tr>
              <th className="check"><input type="checkbox" aria-label="Select page" checked={tbl.allOnPage} onChange={tbl.togglePage} /></th>
              <th>Customer / entity</th><th aria-sort={tbl.dir === "desc" ? "descending" : "ascending"}><button className="th-sort" onClick={tbl.flipSort}>Risk score {tbl.dir === "desc" ? "↓" : "↑"}</button></th><th>KYC status</th><th>Last review</th><th>Linked activity</th><th>Owner</th>
            </tr></thead>
            <tbody>
              {tbl.p.items.map((x) => {
                const on = tbl.selected.has(x.id);
                const band = riskBand(x.score);
                return (
                  <tr key={x.id} className={on ? "featured" : undefined}>
                    <td className="check"><input type="checkbox" aria-label={`Select ${x.id}`} checked={on} onChange={() => tbl.toggle(x.id)} /></td>
                    <td><div className="entity-name">{x.name}</div><div className="entity-meta">{x.meta}</div></td>
                    <td><span className={`score ${band}`}><b>{x.score}</b>{bandLabel[band]}</span></td>
                    <td><StatusPill status={x.kyc} /></td>
                    <td><div>{x.lastReview}</div><div className={`entity-meta${x.nextWarn ? " bad" : ""}`}>{x.next}</div></td>
                    <td>{x.linked}</td>
                    <td><Assignee name={x.owner} /><div className="entity-meta">{x.ownerRole}</div></td>
                  </tr>
                );
              })}
              {tbl.p.items.length === 0 && <tr><td colSpan={7} className="empty">No customers match these filters</td></tr>}
            </tbody>
          </table>
        </div>
        <QueuePager p={tbl.p} total={pagerTotal(tbl.visible.length, data.population, tbl.narrowed)} noun="customers" pageSize={PAGE_SIZE} onPage={tbl.setPage} />
      </section>

      {f && (
        <section className="grid-2">
          <div className="card" role="region" aria-label="Selected customer">
            <div className="card-head">
              <h2>Selected customer</h2>
              <More to={paths.investigations}>Full profile</More>
            </div>
            <div className="profile-head">
              <span className="entity-avatar">{initials(f.name)}</span>
              <div>
                <h2>{f.name} <span className={`score ${riskBand(f.score)}`}><b>{bandLabel[riskBand(f.score)]} · {f.score}/100</b></span> <StatusPill status={f.kyc} /></h2>
                <p className="card-sub">{f.id === "C-10842" ? "C-10842 · Corporate · United Arab Emirates" : f.meta}</p>
              </div>
            </div>
            {f.id === "C-10842" ? (
              <>
                <p className="narrative">Rapid fund movement across 3 elevated-risk jurisdictions. Activity is 6.4× the customer's 30-day baseline.</p>
                <Facts cols={4} items={[["Relationship since", "Mar 14, 2022"], ["Business unit", "Corporate banking"], ["Flagged activity", "$482,750 · 12 transfers"], ["Case owner", "Daniel Cho"]]} />
                <h2 className="sub-head">KYC evidence checklist</h2>
                <ul className="checklist">
                  <li><span><strong>Identity & incorporation</strong><span className="card-sub">Verified Sep 12 · Registry matched</span></span><StatusPill status="Verified" /></li>
                  <li><span><strong>Beneficial ownership</strong><span className="card-sub">2 beneficial owners · 1 controller</span></span><StatusPill status="Verified" /></li>
                  <li><span><strong>Source of funds</strong><span className="card-sub">Requested Sep 28 · Due Sep 30</span></span><StatusPill status="Pending" /></li>
                </ul>
                <Note tone="warn">No direct sanctions match. Adverse media requires enhanced due diligence before review can be completed.</Note>
              </>
            ) : (
              <Facts items={[["Last review", f.lastReview], ["Next", f.next], ["Linked activity", f.linked]]} />
            )}
            <div className="table-actions spaced"><button className="btn primary">Request evidence</button><Link className="btn" to={paths.cases}><Briefcase size={13} />View case</Link></div>
          </div>
          <div className="card" role="region" aria-label="Linked records">
            <h2>Linked records</h2>
            {f.id === "C-10842" ? (
              <ul className="checklist">
                <li><span><strong className="accent">AML-4821</strong> · Rapid movement of funds<span className="card-sub">Escalated · Daniel Cho · 6 linked alerts</span></span><span className="pill teal">Open</span></li>
                <li><span><strong className="accent">ALT-92841</strong> · Velocity anomaly<span className="card-sub">TM-014 · Detected Sep 28, 09:42 UTC</span></span><span className="pill red">96/100</span></li>
              </ul>
            ) : <p className="card-sub">{f.linked}</p>}
          </div>
        </section>
      )}

      <section className="grid-3 even">
        <div className="card" role="region" aria-label="Portfolio risk distribution">
          <div className="card-head"><div><h2>Portfolio risk distribution</h2><p className="card-sub">{total.toLocaleString("en-US")} monitored customers</p></div><More to={paths.analytics}>Risk analysis</More></div>
          <Distribution parts={data.distribution} total={total} />
          <p className="foot-note">Risk scores refreshed daily using transaction behavior, jurisdiction exposure and customer profile.</p>
        </div>
        <div className="card" role="region" aria-label="Review priorities">
          <div className="card-head"><div><h2>Review priorities</h2><p className="card-sub">September 2026 · Due diligence workload</p></div><More to={paths.customerReviews}>Review queue</More></div>
          <div className="workload three">
            {data.priorities.map((p) => <div key={p.label}><span className="kpi-label">{p.label}</span><span className={`big delta ${p.tone}`}>{p.count}</span><span className="card-sub">reviews</span></div>)}
          </div>
          <Note tone="warn">6 high-risk entities are awaiting source-of-funds evidence. Prioritize overdue EDD reviews.</Note>
          <button className="link spaced-link" onClick={() => { tbl.setTab("due"); }}>Open overdue review queue <ArrowRight size={12} /></button>
        </div>
        <ActivityCard title="Recent customer activity" link="View log" to={paths.audit} items={data.activity} />
      </section>
    </>
  );
}
