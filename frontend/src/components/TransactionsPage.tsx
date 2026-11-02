import { Activity, AlertTriangle, ArrowDownUp, ArrowUpRight, Briefcase, Download, Flag, Globe, Network, NotebookPen, Search, ShieldCheck } from "lucide-react";
import { Link } from "react-router-dom";
import { transactions as data, type Txn } from "../data/ops";
import { riskBand } from "../lib/format";
import { corridorKind, dateKey, pagerTotal } from "../lib/ops";
import { uniqueValues } from "../lib/queue";
import { ScoreBar } from "./AlertQueuePage";
import { paths } from "../routes";
import { Facts, More, MoreFilters, Note } from "./OpsParts";
import { BulkBar, FilterSelect, QueuePager, StatCards, StatusPill, Tabs } from "./QueueParts";

// Newest first, as in the frame. Exported so the date (not score) ordering is testable:
// in the Figma rows the two orders coincide.
export const txnRank = (x: Txn) => dateKey(x.date);
import { PAGE_SIZE, useTable } from "./useTable";

const bandLabel = { critical: "Critical", high: "High", medium: "Medium", low: "Low" } as const;
const T = "Transaction monitoring";

export function TransactionsPage() {
  const rows = data.rows;
  const tbl = useTable<Txn>(rows, {
    tabs: {
      all: () => true, flagged: (x) => x.status === "Flagged", high: (x) => x.score >= 75,
      hold: (x) => x.status === "On hold", cleared: (x) => x.status === "Cleared",
    },
    filters: {
      Risk: (x) => bandLabel[riskBand(x.score)], Channel: (x) => x.channel, Status: (x) => x.status, Direction: (x) => x.direction,
      Corridor: corridorKind,
    },
    search: (x) => [x.id, x.customer, x.customerMeta, x.counterparty],
    rank: txnRank,
  }, "all");
  const f = tbl.focus;
  const detail = f && data.detail[f.id];

  return (
    <>
      <StatCards label="Transaction metrics" cards={[
        { label: "Transaction volume", value: "$2.48B", note: "+8.2%", noteTone: "good", sub: "1.84M transactions", icon: <Activity size={13} />, tone: "teal" },
        { label: "Flagged transactions", value: "12,684", note: "+4.7% this month", noteTone: "bad", sub: "0.69% of total", icon: <Flag size={13} />, tone: "amber" },
        { label: "High-risk transactions", value: "248", note: "+18.4% this month", noteTone: "bad", sub: "62 require review", icon: <AlertTriangle size={13} />, tone: "red" },
        { label: "Cross-border volume", value: "$864.2M", note: "+6.1%", noteTone: "accent", sub: "34.8% of total", icon: <Globe size={13} />, tone: "blue" },
        { label: "Screening coverage", value: "99.8%", note: "Within target", noteTone: "good", sub: "Rules + model v4.8.2", icon: <ShieldCheck size={13} />, tone: "teal" },
      ]} />

      <section className="card table-card" aria-label={T}>
        <div className="card-head">
          <div>
            <h2>{T} <span className="pill teal">1.84M transactions</span></h2>
            <p className="card-sub">Search and trace payments across all channels · Amounts in USD equivalent · All times UTC</p>
          </div>
          <div className="table-actions">
            <button className="btn"><Download size={13} />Export</button>
            <Link className="btn primary" to={paths.analytics}><Network size={13} />View linked activity</Link>
          </div>
        </div>
        <Tabs active={tbl.tab} onChange={tbl.setTab} tabs={[
          { id: "all", label: "All transactions", count: data.tabCounts.all },
          { id: "flagged", label: "Flagged", count: data.tabCounts.flagged },
          { id: "high", label: "High risk", count: data.tabCounts.high },
          { id: "hold", label: "On hold", count: data.tabCounts.hold },
          { id: "cleared", label: "Cleared", count: data.tabCounts.cleared },
        ]} />
        <div className="toolbar">
          <label className="search grow"><Search size={14} />
            <input placeholder="Search transaction ID, customer or account" aria-label="Search transactions" value={tbl.query} onChange={(e) => tbl.setQuery(e.target.value)} />
          </label>
          <FilterSelect label="Risk" value={tbl.filters.Risk} options={["Critical", "High", "Medium", "Low"]} onChange={(v) => tbl.setFilter("Risk", v)} />
          <FilterSelect label="Channel" value={tbl.filters.Channel} options={uniqueValues(rows, (x) => x.channel)} onChange={(v) => tbl.setFilter("Channel", v)} />
          <FilterSelect label="Status" value={tbl.filters.Status} options={uniqueValues(rows, (x) => x.status)} onChange={(v) => tbl.setFilter("Status", v)} />
          <FilterSelect label="Direction" value={tbl.filters.Direction} options={["Inbound", "Outbound"]} onChange={(v) => tbl.setFilter("Direction", v)} />
          <MoreFilters options={{ Corridor: ["Cross-border", "Domestic"] }} values={tbl.filters} onChange={tbl.setFilter} />
          <button className="btn sort" onClick={tbl.flipSort}><ArrowDownUp size={13} />Date: {tbl.dir === "desc" ? "Newest first" : "Oldest first"}</button>
        </div>
        <BulkBar count={tbl.selected.size} noun="transaction" onClear={tbl.clear}>
          <button className="btn small">Link to case</button>
          <button className="btn small">Create alert</button>
          <button className="btn small">Add note</button>
        </BulkBar>
        <div className="table-scroll">
          <table>
            <thead><tr>
              <th className="check"><input type="checkbox" aria-label="Select page" checked={tbl.allOnPage} onChange={tbl.togglePage} /></th>
              <th>Transaction ID</th><th>Customer / entity</th><th>Counterparty / corridor</th><th className="right">Amount</th>
              <th>Channel</th><th>Score</th><th aria-sort={tbl.dir === "desc" ? "descending" : "ascending"}>Date {tbl.dir === "desc" ? "↓" : "↑"} · UTC</th><th>Status</th><th className="right">Action</th>
            </tr></thead>
            <tbody>
              {tbl.p.items.map((x) => {
                const on = tbl.selected.has(x.id);
                return (
                  <tr key={x.id} className={on ? "featured" : undefined}>
                    <td className="check"><input type="checkbox" aria-label={`Select ${x.id}`} checked={on} onChange={() => tbl.toggle(x.id)} /></td>
                    <td><div className="id-cell">{x.id}</div><div className="entity-meta">Transaction record</div></td>
                    <td><div className="entity-name">{x.customer}</div><div className="entity-meta">{x.customerMeta}</div></td>
                    <td><div>{x.counterparty}</div><div className="entity-meta">{x.corridor}</div></td>
                    <td className="right num"><div>${x.amount.toLocaleString("en-US", { minimumFractionDigits: 2 })}</div><div className="entity-meta">USD</div></td>
                    <td><div>{x.channel}</div><div className="entity-meta">{x.direction}</div></td>
                    <td><ScoreBar score={x.score} /></td>
                    <td><div>{x.date}</div><div className="entity-meta">2026 · UTC</div></td>
                    <td><StatusPill status={x.status} /></td>
                    <td className="right"><button className="btn small" onClick={() => tbl.select(x.id)}>View</button></td>
                  </tr>
                );
              })}
              {tbl.p.items.length === 0 && <tr><td colSpan={10} className="empty">No transactions match these filters</td></tr>}
            </tbody>
          </table>
        </div>
        <QueuePager p={tbl.p} total={pagerTotal(tbl.visible.length, data.population, tbl.narrowed)} noun="transactions" pageSize={PAGE_SIZE} onPage={tbl.setPage} />
      </section>

      {f && (
        <section className="grid-2">
          <div className="card" role="region" aria-label="Selected transaction snapshot">
            <div className="card-head">
              <h2>Selected transaction snapshot <span className="accent">{f.id}</span> <span className={`score ${riskBand(f.score)}`}><b>{bandLabel[riskBand(f.score)]} · {f.score}/100</b></span></h2>
              <More to={paths.analytics}>View full details</More>
            </div>
            <p className="narrative">
              {detail?.narrative ?? `${f.customer} ${f.direction === "Inbound" ? "received" : "sent"} $${f.amount.toLocaleString("en-US")} ${f.direction === "Inbound" ? "from" : "to"} ${f.counterparty} via ${f.channel} (${f.corridor}).`}
            </p>
            <Facts items={detail?.facts ?? [["Channel", f.channel], ["Corridor", f.corridor], ["Status", f.status]]} />
            {detail && (
              <p className="ref-links">
                <Link className="link" to={paths.alerts}>Linked alert: {detail.alert} <ArrowUpRight size={12} /></Link>
                <Link className="link" to={paths.cases}>Case: {detail.case} <ArrowUpRight size={12} /></Link>
                <span className="muted">Payment ref: {detail.paymentRef}</span>
              </p>
            )}
          </div>
          <div className="card" role="region" aria-label="Recommended next step">
            <h2>Recommended next step</h2>
            <p className="narrative">{detail?.nextStep ?? `Review linked transfers and verify source-of-funds evidence for ${f.customer}.`}</p>
            {detail && <Note tone="good">{detail.screening}</Note>}
            <div className="table-actions">
              <Link className="btn" to={paths.cases}><Briefcase size={13} />View case</Link>
              <button className="btn"><NotebookPen size={13} />Add review note</button>
            </div>
          </div>
        </section>
      )}
    </>
  );
}
