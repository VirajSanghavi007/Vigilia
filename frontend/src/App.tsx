import { useState } from "react";
import { AlertsTable } from "./components/AlertsTable";
import { AlertSeverity, RiskTrend, TransactionMonitoring } from "./components/Charts";
import { Header } from "./components/Header";
import { Kpis } from "./components/Kpis";
import { CaseActivity, GeographicRisk, TypologyBreakdown } from "./components/Panels";
import { Sidebar } from "./components/Sidebar";
import { getDashboard } from "./data/mock";

export default function App() {
  const d = getDashboard();
  const [nav, setNav] = useState("overview");
  const [query, setQuery] = useState("");

  return (
    <div className="shell">
      <Sidebar active={nav} onSelect={setNav} user={d.user} />
      <main className="main">
        <Header slaBreaches={d.slaBreaches} refreshedMinsAgo={d.refreshedMinsAgo} query={query} onQuery={setQuery} />
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
      </main>
    </div>
  );
}
