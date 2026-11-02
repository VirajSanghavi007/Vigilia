import { useEffect, useState } from "react";
import { ArrowUpRight, ChevronLeft, ChevronRight, Download, ListChecks, Workflow } from "lucide-react";
import type { Alert, AlertStatus } from "../data/types";
import { filterAlerts, paginate } from "../lib/alerts";
import { formatCompactCurrency, initials, riskBand } from "../lib/format";

const statusClass: Record<AlertStatus, string> = {
  Escalated: "escalated",
  Unassigned: "unassigned",
  "In review": "review",
  "Pending info": "pending",
};

const PAGE_SIZE = 5;

interface Props { alerts: Alert[]; highRisk: number; query: string }

export function AlertsTable({ alerts, highRisk, query }: Props) {
  const [page, setPage] = useState(1);
  useEffect(() => setPage(1), [query]);

  const filtered = filterAlerts(alerts, query);
  const p = paginate(filtered, page, PAGE_SIZE);

  return (
    <section className="card table-card" aria-label="Recent alerts">
      <div className="card-head">
        <div>
          <h2>Recent alerts <span className="pill red">{highRisk} high risk</span></h2>
          <p className="card-sub">Prioritised by model risk score, recency and customer exposure</p>
        </div>
        <div className="table-actions">
          <button className="btn"><Download size={13} />Export</button>
          <button className="btn primary"><ListChecks size={13} />Review alert queue</button>
        </div>
      </div>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Customer / entity</th><th>Amount</th><th>Risk score</th><th>Typology</th>
              <th>Status</th><th>Analyst</th><th className="right">Action</th>
            </tr>
          </thead>
          <tbody>
            {p.items.map((a, i) => {
              const band = riskBand(a.score);
              const first = p.page === 1 && i === 0 && !query;
              return (
                <tr key={a.id} className={first ? "featured" : undefined}>
                  <td>
                    <div className="entity">
                      <span className="entity-avatar">{initials(a.entity)}</span>
                      <div><div className="entity-name">{a.entity}</div><div className="entity-meta">{a.entityId} · {a.meta}</div></div>
                    </div>
                  </td>
                  <td className="num">{formatCompactCurrency(a.amount)}</td>
                  <td><span className={`score ${band}`}><b>{a.score}</b>{band[0].toUpperCase() + band.slice(1)}</span></td>
                  <td><span className="typology"><Workflow size={12} />{a.typology}</span></td>
                  <td><span className={`status ${statusClass[a.status]}`}><span className="dot" />{a.status}</span></td>
                  <td>{a.analyst ? <span className="analyst"><span className="mini-avatar" />{a.analyst}</span> : <span className="muted">-</span>}</td>
                  <td className="right">
                    <button className={`btn small${first ? " primary" : ""}`}>Review <ArrowUpRight size={12} /></button>
                  </td>
                </tr>
              );
            })}
            {p.items.length === 0 && (
              <tr><td colSpan={7} className="empty">No alerts match "{query}"</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="table-foot">
        <span>Showing {p.start}-{p.end} of {filtered.length} alerts</span>
        <div className="pager">
          <button aria-label="Previous page" disabled={p.page <= 1} onClick={() => setPage(p.page - 1)}><ChevronLeft size={13} /></button>
          {Array.from({ length: p.pageCount }, (_, i) => i + 1).map((n) => (
            <button key={n} className={n === p.page ? "current" : undefined} aria-current={n === p.page ? "page" : undefined} onClick={() => setPage(n)}>{n}</button>
          ))}
          <button aria-label="Next page" disabled={p.page >= p.pageCount} onClick={() => setPage(p.page + 1)}><ChevronRight size={13} /></button>
        </div>
      </div>
    </section>
  );
}
