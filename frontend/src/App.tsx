import { useState } from "react";
import { AlertQueuePage } from "./components/AlertQueuePage";
import { AlertsTable } from "./components/AlertsTable";
import { AlertSeverity, RiskTrend, TransactionMonitoring } from "./components/Charts";
import { Header } from "./components/Header";
import { Kpis } from "./components/Kpis";
import { CasesPage } from "./components/CasesPage";
import { CaseActivity, GeographicRisk, TypologyBreakdown } from "./components/Panels";
import { Sidebar } from "./components/Sidebar";
import { getDashboard } from "./data/mock";
import { getAlertQueue, getCases } from "./data/queue";
import { caseStats } from "./lib/queue";

export default function App() {
  const d = getDashboard();
  const [nav, setNav] = useState("overview");
  const [query, setQuery] = useState("");

  return (
    <div className="shell">
      <Sidebar active={nav} onSelect={setNav} user={d.user} />
      <main className="main">
        {nav === "overview" ? (
          <>
            <Header pill={`${d.slaBreaches} SLA breaches`} refreshedMinsAgo={d.refreshedMinsAgo} query={query} onQuery={setQuery} />
            <Kpis kpis={d.kpis} />
            <section className="grid-3">
              <RiskTrend data={d.riskTrend} />
              <TransactionMonitoring data={d.volumeByHour} total={d.volumeTotal} delta={d.volumeDelta} />
              <AlertSeverity data={d.severity} note={d.severityNote} />
            </section>
            <section className="grid-3 even">
              <TypologyBreakdown data={d.typologies} coverage={d.typologyCoverage} />
              <GeographicRisk hotspots={d.hotspots} elevated={d.elevatedJurisdictions} newAlerts={d.newGeoAlerts} />
              <CaseActivity items={d.activity} today={d.activityToday} />
            </section>
            <AlertsTable alerts={d.alerts} highRisk={d.highRiskAlerts} query={query} />
          </>
        ) : nav === "alerts" ? (
          <>
            <Header
              title="Alert Queue"
              subtitle="Prioritise, assign and investigate suspicious activity across all business units"
              pill={`${d.slaBreaches} SLA breaches`}
              refreshedMinsAgo={d.refreshedMinsAgo}
            />
            <AlertQueuePage data={getAlertQueue()} />
          </>
        ) : nav === "cases" ? (
          <>
            <Header
              title="Cases"
              subtitle="Manage financial crime investigations, ownership and regulatory deadlines"
              pill={`${caseStats(getCases().cases, "").overdue} overdue cases`}
              refreshedMinsAgo={d.refreshedMinsAgo}
            />
            <CasesPage data={getCases()} />
          </>
        ) : (
          <section className="card placeholder" role="region" aria-label="Coming soon">
            <h2>Coming soon</h2>
            <p className="card-sub">This page has not been designed yet.</p>
          </section>
        )}
      </main>
    </div>
  );
}
