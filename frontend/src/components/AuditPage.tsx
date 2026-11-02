import { ArrowRight, Search, ShieldX } from "lucide-react";
import { Link } from "react-router-dom";
import { audit as data, type AuditEvent } from "../data/ops";
import { pagerTotal } from "../lib/ops";
import { uniqueValues } from "../lib/queue";
import { auditPath, paths } from "../routes";
import { Distribution, Facts, More, MoreFilters, Note } from "./OpsParts";
import { FilterSelect, QueuePager, StatusPill } from "./QueueParts";
import { PAGE_SIZE, useTable } from "./useTable";

const A = "Chronological review";
const total = data.distribution.reduce((s, d) => s + d.count, 0);

export function AuditPage() {
  const rows = data.rows;
  const tbl = useTable<AuditEvent>(rows, {
    tabs: { all: () => true },
    filters: { Actor: (x) => x.actor, Action: (x) => x.action, Result: (x) => x.result, Source: (x) => x.source, Role: (x) => x.role },
    search: (x) => [x.id, x.actor, x.action, x.record, x.recordSub],
    // Event ids embed the timestamp, so lexical order is chronological.
    rank: (x) => Number(x.id.slice(4, 19).replace("-", "")),
  }, "all");
  const f = tbl.focus;
  const d = f && data.detail[f.id];

  return (
    <>
      <section className="card table-card" aria-label={A}>
        <div className="card-head">
          <div>
            <h2>{A}</h2>
            <p className="card-sub">Review the latest audit events in the order they were recorded, with the most recent event first.</p>
          </div>
          <span className="pill teal">{rows.length} events in review</span>
        </div>
        <div className="toolbar">
          <label className="search grow"><Search size={14} />
            <input placeholder="Search actor, record ID or action" aria-label="Search audit events" value={tbl.query} onChange={(e) => tbl.setQuery(e.target.value)} />
          </label>
          <FilterSelect label="Actor" value={tbl.filters.Actor} options={uniqueValues(rows, (x) => x.actor)} onChange={(v) => tbl.setFilter("Actor", v)} />
          <FilterSelect label="Action" value={tbl.filters.Action} options={uniqueValues(rows, (x) => x.action)} onChange={(v) => tbl.setFilter("Action", v)} />
          <FilterSelect label="Result" value={tbl.filters.Result} options={["Success", "Denied"]} onChange={(v) => tbl.setFilter("Result", v)} />
          <MoreFilters options={{ Source: uniqueValues(rows, (x) => x.source), Role: uniqueValues(rows, (x) => x.role) }} values={tbl.filters} onChange={tbl.setFilter} />
        </div>
        <div className="table-scroll">
          <table>
            <thead><tr><th aria-sort="descending">Time · UTC</th><th>Actor</th><th>Action</th><th>Record</th><th>Result</th><th>Source</th></tr></thead>
            <tbody>
              {tbl.p.items.map((x) => (
                <tr key={x.id} className={f?.id === x.id ? "featured clickable" : "clickable"} onClick={() => tbl.select(x.id)}
                  aria-selected={f?.id === x.id}>
                  <td><div>{x.time}</div><div className="entity-meta">2026 · UTC</div></td>
                  <td><div className="entity-name">{x.actor}</div><div className="entity-meta">{x.role}</div></td>
                  <td><div>{x.action}</div><div className="entity-meta">{x.actionSub}</div></td>
                  <td><div className="id-cell">{x.record}</div><div className="entity-meta">{x.recordSub}</div></td>
                  <td><StatusPill status={x.result} /></td>
                  <td><div>{x.source}</div><div className="entity-meta">{x.ip}</div></td>
                </tr>
              ))}
              {tbl.p.items.length === 0 && <tr><td colSpan={6} className="empty">No events match these filters</td></tr>}
            </tbody>
          </table>
        </div>
        <QueuePager p={tbl.p} total={pagerTotal(tbl.visible.length, data.population, tbl.narrowed)} noun="events · Newest first" pageSize={PAGE_SIZE} onPage={tbl.setPage} />
      </section>

      {f && (
        <section className="grid-2">
          <div className="card" role="region" aria-label="Evidence panel">
            <div className="card-head">
              <div><h2>Evidence panel</h2><p className="card-sub">Review the selected event and its immutable evidence in one place.</p></div>
              <button className="link" onClick={() => void navigator.clipboard?.writeText(f.id)}>Copy ID <ArrowRight size={12} /></button>
            </div>
            <h2 className="sub-head">{f.action} <StatusPill status={f.result} /></h2>
            <p className="narrative">{d?.narrative ?? `${f.actor} · ${f.action} · ${f.record} (${f.recordSub}).`}</p>
            <Facts cols={4} items={[
              ["Performed by", f.actor], ["Role", f.role],
              ["Timestamp · UTC", f.time.replace(/^(\w+ \d+), /, "$1, 2026 · ")], ["Source IP", f.ip],
            ]} />
            {f.change ? (
              <>
                <h2 className="sub-head">Record changes</h2>
                <Facts items={[["Field", f.change.field], ["Before", f.change.before], ["After", f.change.after]]} />
                <p className="narrative">Reason: {f.change.reason}</p>
              </>
            ) : f.result === "Denied" ? (
              <Note tone="warn">Request blocked before any data was returned. Security operations notified.</Note>
            ) : <p className="card-sub">No field-level changes recorded for this event.</p>}
            {d && <Facts cols={1} items={[["Request / session", `${d.request} · ${d.session}`]]} />}
            <Note tone="good">Record integrity verified. This event is append-only and cannot be modified or deleted.</Note>
            <div className="table-actions">
              {f.record.startsWith("AML-") && <Link className="btn" to={paths.cases}>View case</Link>}
              <button className="btn" onClick={() => tbl.setQuery(f.record)}>Related events</button>
            </div>
            {d && <Facts items={[["Authentication", d.authentication], ["Authorization", d.authorization], ["Integrity digest · SHA-256", d.digest]]} />}
          </div>
          <div className="card" role="region" aria-label="Evidence summary">
            <div className="card-head"><div><h2>Evidence summary</h2><p className="card-sub">Key facts preserved with the selected event.</p></div>{f && <More to={auditPath(f.id)}>View manifest</More>}</div>
            <dl className="perf-list">
              {([
                ["Event ID", f.id], ["Record ID", f.record], ["Entity", f.recordSub], ["Source", `${f.source} · ${f.ip}`],
                ...(d ? [["Request", d.request], ["Session", d.session]] : []),
                ...(f.change ? [["Changed field", f.change.field], ["Before", f.change.before], ["After", f.change.after], ["Reason", f.change.reason]] : []),
                ...(d ? [["Authentication", d.authentication], ["Authorization", d.authorization], ["Integrity digest · SHA-256", d.digest]] : []),
              ] as [string, string][]).map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}
            </dl>
          </div>
        </section>
      )}

      <section className="grid-3 even">
        <div className="card" role="region" aria-label="Event distribution">
          <div className="card-head"><div><h2>Event distribution</h2><p className="card-sub">September 2026 · By action category</p></div><More to={paths.analytics}>View breakdown</More></div>
          <Distribution parts={data.distribution} total={total} />
          <p className="card-sub">User and service activity is recorded automatically across every monitored business unit.</p>
        </div>
        <div className="card" role="region" aria-label="Access review">
          <div className="card-head"><div><h2>Access review</h2><p className="card-sub">{data.denied.length} denied actions · No unauthorized modifications</p></div>
            <button className="link" onClick={() => tbl.setFilter("Result", "Denied")}>Review events <ArrowRight size={12} /></button></div>
          <ul className="activity">
            {data.denied.map((x) => (
              <li key={x.title}><span className="act-icon escalate"><ShieldX size={12} /></span>
                <div style={{ flex: 1 }}><div className="act-title">{x.title}</div><div className="act-sub">{x.sub}</div></div><span className="act-sub">{x.ago}</span></li>
            ))}
          </ul>
          <p className="card-sub">All events awaiting security review</p>
        </div>
        <div className="card" role="region" aria-label="Retention & evidence controls">
          <div className="card-head"><div><h2>Retention &amp; evidence controls</h2><p className="card-sub">Audit policy · Production workspace</p></div></div>
          <Facts cols={2} items={data.retention} />
          <Note tone="good">Hash chain verified · No missing events detected</Note>
          <More to={paths.settings}>View audit retention policy</More>
        </div>
      </section>
    </>
  );
}
