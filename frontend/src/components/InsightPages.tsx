// Pages behind the overview's "View analysis", "Risk map" and typology links
// and the header bell. Each follows the workspace scope where its data has a
// date, unit and country, so the numbers match the overview it came from.
import { Activity, ArrowRight, Bell, CalendarDays, TrendingUp } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { audit, rules } from "../data/ops";
import { getDashboard } from "../data/mock";
import { getAlertQueue, getCases } from "../data/queue";
import { formatCompactCurrency } from "../lib/format";
import { buildNotifications, riskByJurisdiction, trendSummary } from "../lib/records";
import { inScope, rangeOf, scopeOfQueueAlert, trendInRange } from "../lib/scope";
import { alertPath, casePath, paths, rulePath } from "../routes";
import { RiskTrend } from "./Charts";
import { Header } from "./Header";
import { Note } from "./OpsParts";
import { SeverityPill, StatCards } from "./QueueParts";
import { useScope } from "./ScopeContext";

type ScopeOptions = { jurisdictions: string[]; typologies: string[] };

export function NotificationsPage({ refreshedMinsAgo }: { refreshedMinsAgo: number }) {
  const items = buildNotifications(getAlertQueue().alerts, getCases().cases, audit.denied, { alert: alertPath, case: casePath, audit: paths.audit });
  return (
    <>
      <Header title="Notifications" subtitle="Breached SLAs, overdue cases and blocked access that need your attention" pill={`${items.length} unread`} refreshedMinsAgo={refreshedMinsAgo} />
      <div className="card" role="region" aria-label="Notifications">
        <h2>Inbox</h2>
        {items.length === 0 ? <p className="empty">You're all caught up.</p> : (
          <ul className="notif-list">
            {items.map((n) => (
              <li key={n.id} className={n.tone}>
                <Bell size={14} aria-hidden />
                <Link to={n.to}><strong>{n.title}</strong><span className="card-sub">{n.sub}</span></Link>
                <span className="right-meta">{n.when}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}

export function TypologiesPage({ refreshedMinsAgo }: { refreshedMinsAgo: number }) {
  const d = getDashboard();
  const { scope, setScope } = useScope();
  const navigate = useNavigate();
  const total = d.typologies.reduce((s, t) => s + t.count, 0);
  const open = (typology: string) => { setScope({ ...scope, typology }); navigate(paths.alerts); };
  return (
    <>
      <Header title="Typologies" subtitle="Which money-laundering patterns drive alert volume, and the rules that detect them" pill={`${d.typologies.length} tracked typologies`} pillTone="teal" refreshedMinsAgo={refreshedMinsAgo} />
      <div className="card" role="region" aria-label="Typology breakdown">
        <h2>Alerts by typology</h2>
        <p className="card-sub">Month to date · {d.typologyCoverage}</p>
        <div className="table-scroll">
          <table>
            <thead><tr><th>Typology</th><th>Alerts</th><th>Share</th><th>Detecting rules</th><th /></tr></thead>
            <tbody>
              {d.typologies.map((t) => {
                const detecting = rules.rows.filter((r) => r.logic === t.name);
                return (
                  <tr key={t.name}>
                    <td><span className="dot" style={{ background: t.color }} /> {t.name}</td>
                    <td>{t.count.toLocaleString("en-US")}</td>
                    <td>{((t.count / total) * 100).toFixed(1)}%</td>
                    <td>{detecting.length === 0 ? <span className="card-sub">None mapped</span>
                      : detecting.map((r) => <Link key={r.id} className="id-cell rule-chip" to={rulePath(r.id)}>{r.id}</Link>)}</td>
                    <td><button type="button" className="btn small" onClick={() => open(t.name)}>Open alerts <ArrowRight size={12} /></button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <Note>Shares are of the alerts in the five tracked typologies, not of every alert.</Note>
      </div>
    </>
  );
}

export function RiskMapPage({ refreshedMinsAgo, scopeOptions }: { refreshedMinsAgo: number; scopeOptions: ScopeOptions }) {
  const d = getDashboard();
  const { scope, setScope } = useScope();
  const navigate = useNavigate();
  const rows = riskByJurisdiction(getAlertQueue().alerts.filter((a) => inScope(scopeOfQueueAlert(a), scope)));
  const open = (jurisdiction: string) => { setScope({ ...scope, jurisdiction }); navigate(paths.alerts); };
  return (
    <>
      <Header title="Risk map" subtitle="Open alerts and exposure by the customer's home jurisdiction" pill={`${d.elevatedJurisdictions} elevated jurisdictions`} refreshedMinsAgo={refreshedMinsAgo} scopeOptions={scopeOptions} />
      <section className="grid-2">
        <div className="card" role="region" aria-label="Alerts by jurisdiction">
          <h2>Alerts by jurisdiction</h2>
          <p className="card-sub">{rangeOf(scope.range).label} · open queue alerts in the current filters</p>
          {rows.length === 0 ? <p className="empty">No open alerts match the current filters.</p> : (
            <div className="table-scroll">
              <table>
                <thead><tr><th>Jurisdiction</th><th>Alerts</th><th>Critical</th><th>Exposure</th><th>Highest</th><th /></tr></thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.code}>
                      <td className="id-cell">{r.code}</td><td>{r.alerts}</td><td className={r.critical ? "bad" : undefined}>{r.critical}</td>
                      <td>{formatCompactCurrency(r.amount)}</td><td><SeverityPill level={r.topSeverity} /></td>
                      <td><button type="button" className="btn small" onClick={() => open(r.code)}>Open alerts <ArrowRight size={12} /></button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
        <div className="card" role="region" aria-label="Transaction hotspots">
          <h2>Transaction hotspots</h2>
          <p className="card-sub">Originating cities with elevated flagged volume today</p>
          <ul className="checklist">
            {d.hotspots.map((h) => <li key={h.name}><span><span className="dot" style={{ background: "var(--critical)" }} /> {h.name}</span></li>)}
          </ul>
          <p className="card-foot"><span>{d.elevatedJurisdictions} elevated jurisdictions</span><span className="bad">+{d.newGeoAlerts} alerts today</span></p>
        </div>
      </section>
    </>
  );
}

export function RiskTrendPage({ refreshedMinsAgo, scopeOptions }: { refreshedMinsAgo: number; scopeOptions: ScopeOptions }) {
  const { scope } = useScope();
  const points = trendInRange(getDashboard().riskTrend, scope);
  const s = trendSummary(points);
  return (
    <>
      <Header title="Risk trend" subtitle="Daily high- and medium-risk alert volume for the selected date range" pill={rangeOf(scope.range).label} pillTone="teal" refreshedMinsAgo={refreshedMinsAgo} scopeOptions={scopeOptions} />
      {s && <StatCards label="Trend summary" cards={[
        { label: "High-risk alerts", value: s.total.toLocaleString("en-US"), note: rangeOf(scope.range).label, noteTone: "accent", sub: "", icon: <TrendingUp size={15} />, tone: "red" },
        { label: "Peak day", value: s.peak.high, note: s.peak.date, noteTone: "warn", sub: "", icon: <CalendarDays size={15} />, tone: "amber" },
        { label: "First to last day", value: `${s.changePct > 0 ? "+" : ""}${s.changePct}%`, note: `${s.first} to ${s.last}`, noteTone: s.changePct > 0 ? "bad" : "good", sub: "", icon: <Activity size={15} />, tone: "teal" },
      ]} />}
      <RiskTrend data={points} link={false} />
      <div className="card" role="region" aria-label="Daily alerts">
        <h2>Daily alerts</h2>
        <div className="table-scroll">
          <table>
            <thead><tr><th>Date</th><th>High risk</th><th>Medium risk</th></tr></thead>
            <tbody>{[...points].reverse().map((p) => <tr key={p.date}><td>{p.date}</td><td>{p.high}</td><td>{p.medium}</td></tr>)}</tbody>
          </table>
        </div>
        <Note>Only the date range applies here: the daily series is not broken down by unit, jurisdiction or typology.</Note>
      </div>
    </>
  );
}
