import { useState, type ReactNode } from "react";
import { Navigate, Outlet, Route, Routes } from "react-router-dom";
import { AlertQueuePage } from "./components/AlertQueuePage";
import { AlertsTable } from "./components/AlertsTable";
import { AlertSeverity, RiskTrend, TransactionMonitoring } from "./components/Charts";
import { Header } from "./components/Header";
import { Kpis } from "./components/Kpis";
import { AuditPage } from "./components/AuditPage";
import { CasesPage } from "./components/CasesPage";
import { CustomersPage } from "./components/CustomersPage";
import { InvestigatorsPage } from "./components/InvestigatorsPage";
import { LandingPage } from "./components/LandingPage";
import { ProfilePage } from "./components/ProfilePage";
import { ReportsPage } from "./components/ReportsPage";
import { RulesPage } from "./components/RulesPage";
import { SettingsPage } from "./components/SettingsPage";
import { GraphExplorerPage } from "./components/GraphExplorerPage";
import { TransactionsPage } from "./components/TransactionsPage";
import { WorkspaceLoadingPage } from "./components/WorkspaceLoadingPage";
import { AlertDetailPage, AuditDetailPage, CaseDetailPage, ReportDetailPage, RuleDetailPage } from "./components/DetailPages";
import {
  AccessRequestPage, AssignmentPolicyPage, ConfigPolicyPage, CustomerReviewsPage, ModelDetailsPage, ReportSchedulesPage, SupportPage,
} from "./components/InfoPages";
import { NotificationsPage, RiskMapPage, RiskTrendPage, TypologiesPage } from "./components/InsightPages";
import { CaseActivity, GeographicRisk, TypologyBreakdown } from "./components/Panels";
import { ScopeProvider, useScope } from "./components/ScopeContext";
import { Sidebar } from "./components/Sidebar";
import { getDashboard } from "./data/mock";
import { getAlertQueue, getCases } from "./data/queue";
import { caseStats } from "./lib/queue";
import { scopeOptionsFrom } from "./lib/records";
import { scopeOfAlert, scopeOfCase, scopeOfQueueAlert, trendInRange } from "./lib/scope";
import { paths } from "./routes";

// Header copy and body for the pages that share the plain title/subtitle layout.
interface Page { title: string; subtitle: string; pill: string; pillTone?: "red" | "teal"; crumb?: string; meta?: ReactNode; body: () => ReactNode }

const graphSubtitle = "Ask questions of the live transaction graph in plain English, review the Cypher Claude writes, and trace the flows it returns.";

const pages: Record<string, Page> = {
  [paths.transactions]: { title: "Transactions", subtitle: "Monitor transaction activity, trace fund flows and review financial crime risk", pill: "248 high risk", body: () => <TransactionsPage /> },
  [paths.analytics]: { title: "Transaction graph explorer", subtitle: graphSubtitle, pill: "Memgraph · Claude", pillTone: "teal", body: () => <GraphExplorerPage /> },
  // No Figma frame for Investigations yet: it opens the same relationship workspace.
  [paths.investigations]: { title: "Investigations", subtitle: graphSubtitle, pill: "Memgraph · Claude", pillTone: "teal", body: () => <GraphExplorerPage /> },
  [paths.loading]: {
    title: "Preparing your workspace", subtitle: "Securely connecting your financial crime operations environment", pill: "Loading", pillTone: "teal",
    meta: <p className="header-meta"><span className="dot pulse" />Waiting for workspace data</p>, body: () => <WorkspaceLoadingPage />,
  },
  [paths.customers]: { title: "Customers", subtitle: "Review customer risk, entity relationships and KYC readiness across your portfolio", pill: "18 overdue reviews", body: () => <CustomersPage /> },
  [paths.investigators]: { title: "Investigators", subtitle: "Balance analyst capacity, assign work and monitor investigation service levels", pill: "2 cases awaiting assignment", body: () => <InvestigatorsPage /> },
  [paths.reports]: { title: "Reports", subtitle: "Prepare regulatory filings, track submission status and schedule financial crime reporting", pill: "2 filings due today", body: () => <ReportsPage /> },
  [paths.rules]: { title: "Rules & Models", subtitle: "Manage detection logic, validate changes and monitor model performance across all channels", pill: "2 changes pending approval", body: () => <RulesPage /> },
  [paths.audit]: { title: "Audit Logs", subtitle: "Trace user and system actions with attributable, immutable records across AML operations", pill: "3 access events to review", body: () => <AuditPage /> },
  [paths.settings]: { title: "Settings", subtitle: "Workspace defaults, notifications and security controls", pill: "Workspace configuration", pillTone: "teal", crumb: "Workspace settings", body: () => <SettingsPage /> },
  [paths.profile]: { title: "Profile", subtitle: "Your account details, preferences and active sessions", pill: "Personal account", pillTone: "teal", crumb: "My account", body: () => <ProfilePage /> },
};

type ScopeOptions = { jurisdictions: string[]; typologies: string[] };

// Filter choices come from every record the filters apply to, so no option
// can select an empty page by construction.
const scopeOptions: ScopeOptions = scopeOptionsFrom([
  ...getAlertQueue().alerts.map(scopeOfQueueAlert),
  ...getCases().cases.map(scopeOfCase),
  ...getDashboard().alerts.map(scopeOfAlert),
]);

// The overview reads the scope itself so the risk trend follows the date range.
function Overview({ scopeOptions }: { scopeOptions: ScopeOptions }) {
  const d = getDashboard();
  const { scope } = useScope();
  const [query, setQuery] = useState("");
  return (
    <>
      <Header pill={`${d.slaBreaches} SLA breaches`} refreshedMinsAgo={d.refreshedMinsAgo} query={query} onQuery={setQuery} scopeOptions={scopeOptions} />
      <Kpis kpis={d.kpis} />
      <section className="grid-3">
        <RiskTrend data={trendInRange(d.riskTrend, scope)} />
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
  );
}

export default function App() {
  const d = getDashboard();
  const r = d.refreshedMinsAgo;

  // One provider around the whole shell: a scope picked on one page carries over to the next.
  const shell = (
    <ScopeProvider>
      <div className="shell">
        <Sidebar user={d.user} />
        <main className="main"><Outlet /></main>
      </div>
    </ScopeProvider>
  );

  return (
    <Routes>
      <Route path={paths.landing} element={<LandingPage />} />
      <Route element={shell}>
        <Route path={paths.overview} element={<Overview scopeOptions={scopeOptions} />} />
        <Route path={paths.alerts} element={
          <>
            <Header
              title="Alert Queue"
              subtitle="Prioritize, assign and investigate suspicious activity across all business units"
              pill={`${d.slaBreaches} SLA breaches`}
              refreshedMinsAgo={d.refreshedMinsAgo}
              scopeOptions={scopeOptions}
            />
            <AlertQueuePage data={getAlertQueue()} cases={getCases().cases} />
          </>
        } />
        <Route path={paths.cases} element={
          <>
            <Header
              title="Cases"
              subtitle="Manage financial crime investigations, ownership and regulatory deadlines"
              pill={`${caseStats(getCases().cases, "").overdue} overdue cases`}
              refreshedMinsAgo={d.refreshedMinsAgo}
              scopeOptions={scopeOptions}
            />
            <CasesPage data={getCases()} />
          </>
        } />
        {Object.entries(pages).map(([path, p]) => (
          <Route key={path} path={path} element={
            <>
              <Header title={p.title} subtitle={p.subtitle} pill={p.pill} pillTone={p.pillTone} crumb={p.crumb} meta={p.meta} refreshedMinsAgo={d.refreshedMinsAgo} />
              {p.body()}
            </>
          } />
        ))}
        <Route path={`${paths.alerts}/:id`} element={<AlertDetailPage refreshedMinsAgo={r} />} />
        <Route path={`${paths.cases}/:id`} element={<CaseDetailPage refreshedMinsAgo={r} />} />
        <Route path={`${paths.rules}/:id`} element={<RuleDetailPage refreshedMinsAgo={r} />} />
        <Route path={`${paths.reports}/:id`} element={<ReportDetailPage refreshedMinsAgo={r} />} />
        <Route path={`${paths.audit}/:id`} element={<AuditDetailPage refreshedMinsAgo={r} />} />
        <Route path={paths.notifications} element={<NotificationsPage refreshedMinsAgo={r} />} />
        <Route path={paths.typologies} element={<TypologiesPage refreshedMinsAgo={r} />} />
        <Route path={paths.riskMap} element={<RiskMapPage refreshedMinsAgo={r} scopeOptions={scopeOptions} />} />
        <Route path={paths.riskTrend} element={<RiskTrendPage refreshedMinsAgo={r} scopeOptions={scopeOptions} />} />
        <Route path={paths.accessRequest} element={<AccessRequestPage refreshedMinsAgo={r} />} />
        <Route path={paths.support} element={<SupportPage refreshedMinsAgo={r} />} />
        <Route path={paths.configPolicy} element={<ConfigPolicyPage refreshedMinsAgo={r} />} />
        <Route path={paths.reportSchedules} element={<ReportSchedulesPage refreshedMinsAgo={r} />} />
        <Route path={paths.customerReviews} element={<CustomerReviewsPage refreshedMinsAgo={r} />} />
        <Route path={paths.ruleModel} element={<ModelDetailsPage refreshedMinsAgo={r} />} />
        <Route path={paths.assignmentPolicy} element={<AssignmentPolicyPage refreshedMinsAgo={r} />} />
        <Route path="*" element={<Navigate to={paths.overview} replace />} />
      </Route>
    </Routes>
  );
}
