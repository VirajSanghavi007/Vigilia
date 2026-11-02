// Small read-only pages behind the secondary links on the list, settings and
// profile pages (policies, schedules, support). Each shows the mock record the
// link refers to; none of them edits anything.
import type { ReactNode } from "react";
import { ChevronLeft } from "lucide-react";
import { Link } from "react-router-dom";
import { customers, investigators, profile, reports, rules, workspaceRecord, workspaceSettings } from "../data/ops";
import { paths } from "../routes";
import { Header } from "./Header";
import { Facts, Note } from "./OpsParts";
import { Assignee } from "./QueueParts";

interface InfoProps { refreshedMinsAgo: number }

function Info({ title, subtitle, pill, crumb, back: [to, label], refreshedMinsAgo, children }: {
  title: string; subtitle: string; pill: string; crumb?: string; back: [string, string]; refreshedMinsAgo: number; children: ReactNode;
}) {
  return (
    <>
      <Link className="link back" to={to}><ChevronLeft size={13} />Back to {label}</Link>
      <Header title={title} subtitle={subtitle} pill={pill} pillTone="teal" crumb={crumb} refreshedMinsAgo={refreshedMinsAgo} />
      {children}
    </>
  );
}

export function AccessRequestPage({ refreshedMinsAgo }: InfoProps) {
  return (
    <Info title="Request access" subtitle="What your role can do today, and how to ask for more" pill={profile.level} crumb="My account" back={[paths.profile, "Profile"]} refreshedMinsAgo={refreshedMinsAgo}>
      <section className="grid-2">
        <div className="card" role="region" aria-label="Current access">
          <h2>Current access</h2>
          <ul className="checklist">{profile.granted.map((g) => <li key={g}><span>{g}</span><span className="pill teal">Granted</span></li>)}</ul>
          <ul className="checklist">{profile.locked.map((g) => <li key={g}><span>{g}</span><span className="pill">Restricted</span></li>)}</ul>
        </div>
        <div className="card" role="region" aria-label="How to request">
          <h2>How to request more access</h2>
          <p className="narrative">Access changes are approved by a workspace administrator under {workspaceRecord.policy} and recorded in the audit log. Email {workspaceSettings.complianceContact} with the permission you need and the case or task it is for.</p>
          <Facts cols={2} items={[["Last access review", profile.lastReview], ["Next access review", profile.nextReview]]} />
          <Note>Restricted permissions are separated by policy and cannot be granted to an investigator role.</Note>
        </div>
      </section>
    </Info>
  );
}

export function SupportPage({ refreshedMinsAgo }: InfoProps) {
  return (
    <Info title="Support" subtitle="Who to contact about this workspace, and what to include" pill="Compliance operations" back={[paths.settings, "Settings"]} refreshedMinsAgo={refreshedMinsAgo}>
      <div className="card" role="region" aria-label="Contact">
        <h2>Contact</h2>
        <Facts items={[["Compliance contact", workspaceSettings.complianceContact], ["Workspace", `${workspaceSettings.workspaceName} · ${workspaceRecord.id}`], ["Region", workspaceRecord.region]]} />
        <p className="narrative">Include the workspace ID and any alert, case or audit event ID in your message. Never send customer data or credentials by email.</p>
      </div>
    </Info>
  );
}

export function ConfigPolicyPage({ refreshedMinsAgo }: InfoProps) {
  return (
    <Info title="Configuration policy" subtitle="The policy that governs workspace settings changes" pill={workspaceRecord.policy} crumb="Workspace settings" back={[paths.settings, "Settings"]} refreshedMinsAgo={refreshedMinsAgo}>
      <div className="card" role="region" aria-label="Policy record">
        <h2>Policy record</h2>
        <Facts items={[["Policy", workspaceRecord.policy], ["Last saved by", workspaceRecord.savedBy], ["Saved at · UTC", workspaceRecord.savedAt], ["Workspace", workspaceRecord.id], ["Region", workspaceRecord.region], ["Active model", workspaceRecord.model]]} />
        <Note>Every settings change is attributed, timestamped and written to the audit log before it takes effect.</Note>
      </div>
    </Info>
  );
}

export function ReportSchedulesPage({ refreshedMinsAgo }: InfoProps) {
  return (
    <Info title="Report schedules" subtitle="Recurring operational and compliance reports, and when each runs next" pill={`${reports.schedules.length} schedules`} back={[paths.reports, "Reports"]} refreshedMinsAgo={refreshedMinsAgo}>
      <div className="card" role="region" aria-label="Schedules">
        <h2>Schedules</h2>
        <div className="table-scroll">
          <table>
            <thead><tr><th>Report</th><th>Cadence</th><th>Next run · UTC</th><th>Owner</th></tr></thead>
            <tbody>{reports.schedules.map((s) => <tr key={s.name}><td>{s.name}</td><td>{s.cadence}</td><td>{s.next}</td><td><Assignee name={s.owner} /></td></tr>)}</tbody>
          </table>
        </div>
      </div>
    </Info>
  );
}

export function CustomerReviewsPage({ refreshedMinsAgo }: InfoProps) {
  const due = customers.rows.filter((c) => c.nextWarn);
  return (
    <Info title="Customer reviews" subtitle="Periodic KYC reviews that are overdue, due soon or waiting on evidence" pill={`${customers.priorities[0].count} overdue reviews`} back={[paths.customers, "Customers"]} refreshedMinsAgo={refreshedMinsAgo}>
      <section className="grid-2">
        <div className="card" role="region" aria-label="Reviews needing action">
          <h2>Needs action</h2>
          <div className="table-scroll">
            <table>
              <thead><tr><th>Customer</th><th>KYC</th><th>Last review</th><th>Status</th><th>Owner</th></tr></thead>
              <tbody>{due.map((c) => <tr key={c.id}><td>{c.name}<div className="entity-meta">{c.meta}</div></td><td>{c.kyc}</td><td>{c.lastReview}</td><td className="bad">{c.next}</td><td><Assignee name={c.owner} /></td></tr>)}</tbody>
            </table>
          </div>
        </div>
        <div className="card" role="region" aria-label="Review workload">
          <h2>Review workload</h2>
          <ul className="checklist">{customers.priorities.map((p) => <li key={p.label}><span>{p.label}</span><strong className={p.tone}>{p.count}</strong></li>)}</ul>
          <Note>Counts cover the whole portfolio; the table lists the sample customers loaded in this workspace.</Note>
        </div>
      </section>
    </Info>
  );
}

export function ModelDetailsPage({ refreshedMinsAgo }: InfoProps) {
  const m = rules.model;
  return (
    <Info title={`Model ${m.version}`} subtitle="The scoring model behind alert risk scores" pill="Production" back={[paths.rules, "Rules & models"]} refreshedMinsAgo={refreshedMinsAgo}>
      <div className="card" role="region" aria-label="Model summary">
        <h2>Model summary</h2>
        <Facts items={[["Version", m.version], ["Precision", `${m.precision}% · ${m.precisionDelta}`], ["Recall", `${m.recall}% · ${m.recallDelta}`], ["Population stability (PSI)", m.psi], ["In production since", "Sep 12"]]} />
        <Note tone="warn">These are illustrative design figures, not evaluated metrics. Real numbers will come from the model registry's metadata for the version in the production stage.</Note>
      </div>
    </Info>
  );
}

export function AssignmentPolicyPage({ refreshedMinsAgo }: InfoProps) {
  return (
    <Info title="Assignment policy" subtitle="How new alerts and cases are routed to investigators" pill="Capacity-based routing" back={[paths.investigators, "Investigators"]} refreshedMinsAgo={refreshedMinsAgo}>
      <section className="grid-2">
        <div className="card" role="region" aria-label="Routing rules">
          <h2>Routing rules</h2>
          <ul className="checklist">
            <li><span>Critical alerts and cases go to an L2 investigator or above</span></li>
            <li><span>Cross-border and corporate work goes to the matching specialist first</span></li>
            <li><span>Nobody is assigned new work above 90% capacity</span></li>
            <li><span>Overdue work escalates to the team lead</span></li>
          </ul>
        </div>
        <div className="card" role="region" aria-label="Team capacity">
          <h2>Team capacity</h2>
          <div className="table-scroll">
            <table>
              <thead><tr><th>Investigator</th><th>Open cases</th><th>Alerts</th><th>Capacity</th></tr></thead>
              <tbody>{investigators.team.map((i) => <tr key={i.name}><td><Assignee name={i.name} /><div className="entity-meta">{i.role}</div></td><td>{i.openCases}</td><td>{i.alerts}</td><td className={i.capacity >= 85 ? "bad" : undefined}>{i.capacity}%</td></tr>)}</tbody>
            </table>
          </div>
        </div>
      </section>
    </Info>
  );
}
