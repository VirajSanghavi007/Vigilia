// One page per record (alert, case, rule, report, audit event), reached from
// the Review / Open / View links on the list pages. Each looks its id up in
// the mock data and links to the records around it.
import type { ReactNode } from "react";
import { ArrowRight, ChevronLeft } from "lucide-react";
import { Link, useParams } from "react-router-dom";
import { audit, reports, rules } from "../data/ops";
import { getAlertQueue, getCases } from "../data/queue";
import { filingStep, stepState } from "../lib/ops";
import { caseFor } from "../lib/queue";
import { alertsForCase, alertsForRule, eventsFor, findById, reportsForCase } from "../lib/records";
import { paths, recordPath, rulePath } from "../routes";
import { Header } from "./Header";
import { Facts, Note } from "./OpsParts";
import { Assignee, SeverityPill, StatusPill } from "./QueueParts";

interface Shell { title: string; subtitle: string; pill: string; pillTone?: "red" | "teal"; back: [string, string]; children: ReactNode; refreshedMinsAgo: number }

function DetailShell({ title, subtitle, pill, pillTone, back: [to, label], children, refreshedMinsAgo }: Shell) {
  return (
    <>
      <Link className="link back" to={to}><ChevronLeft size={13} />Back to {label}</Link>
      <Header title={title} subtitle={subtitle} pill={pill} pillTone={pillTone} refreshedMinsAgo={refreshedMinsAgo} />
      {children}
    </>
  );
}

function NotFound({ noun, id, back, refreshedMinsAgo }: { noun: string; id?: string; back: [string, string]; refreshedMinsAgo: number }) {
  return (
    <DetailShell title={`${noun} not found`} subtitle={`No ${noun.toLowerCase()} with ID ${id ?? ""} exists in this workspace`} pill="Not found" back={back} refreshedMinsAgo={refreshedMinsAgo}>
      <div className="card" role="region" aria-label="Record not found">
        <p className="narrative">The link may be out of date, or the record may have been archived. Search the list it came from instead.</p>
        <div className="table-actions"><Link className="btn primary" to={back[0]}>Open {back[1]}</Link></div>
      </div>
    </DetailShell>
  );
}

/** A record id as a link when it has a page, plain text otherwise. */
export function RecordLink({ id }: { id: string }) {
  const to = recordPath(id);
  return to ? <Link className="id-cell" to={to}>{id}</Link> : <span>{id}</span>;
}

/** Linked-record list: one row per item, each row a link. */
function Linked({ title, empty, items }: { title: string; empty: string; items: { id: string; label: string; meta: ReactNode }[] }) {
  return (
    <div className="card" role="region" aria-label={title}>
      <h2>{title}</h2>
      {items.length === 0 ? <p className="card-sub">{empty}</p> : (
        <ul className="checklist">
          {items.map((x) => (
            <li key={x.id}><span><RecordLink id={x.id} /><span className="card-sub">{x.label}</span></span><span className="right-meta">{x.meta}</span></li>
          ))}
        </ul>
      )}
    </div>
  );
}

const eventItems = (id: string) => eventsFor(audit.rows, id).map((e) => ({ id: e.id, label: `${e.action} · ${e.actor}`, meta: e.time }));
const alertsBack: [string, string] = [paths.alerts, "Alert queue"];
const casesBack: [string, string] = [paths.cases, "Cases"];
const rulesBack: [string, string] = [paths.rules, "Rules & models"];
const reportsBack: [string, string] = [paths.reports, "Reports"];
const auditBack: [string, string] = [paths.audit, "Audit log"];

export function AlertDetailPage({ refreshedMinsAgo }: { refreshedMinsAgo: number }) {
  const { id } = useParams();
  const a = findById(getAlertQueue().alerts, id);
  if (!a) return <NotFound noun="Alert" id={id} back={alertsBack} refreshedMinsAgo={refreshedMinsAgo} />;
  const ruleId = a.rule.split(" · ")[0];
  const c = caseFor(getCases().cases, a.entityId);
  return (
    <DetailShell title={`Alert ${a.id}`} subtitle={`${a.entity} · ${a.typology}`} pill={`${a.severity} · score ${a.score}`} back={alertsBack} refreshedMinsAgo={refreshedMinsAgo}>
      <section className="grid-2">
        <div className="card" role="region" aria-label="Alert summary">
          <h2>Alert summary <SeverityPill level={a.severity} /> <StatusPill status={a.status} /></h2>
          <p className="narrative">{a.narrative}</p>
          <Facts items={[
            ["Customer", `${a.entity} · ${a.entityId}`], ["Entity", a.entityType], ["Triggered rule", <Link key="r" className="id-cell" to={rulePath(ruleId)}>{a.rule}</Link>],
            ["Amount", `$${a.amount.toLocaleString("en-US")}`], ["Transactions", a.txCount], ["Detected · UTC", a.detected],
            ["SLA", <span key="s" className={a.slaBreached ? "bad" : undefined}>{a.sla}</span>], ["Assignee", <Assignee key="a" name={a.assignee} />], ["Customer risk", a.customerRisk],
          ]} />
          <Note tone={a.slaBreached ? "warn" : "info"}>{a.nextStep}</Note>
        </div>
        <Linked title="Linked case" empty="No case is open for this customer yet." items={c ? [{ id: c.id, label: `${c.type} · ${c.status}`, meta: c.due }] : []} />
      </section>
      <Linked title="Audit trail" empty="No audited actions on this alert yet." items={eventItems(a.id)} />
    </DetailShell>
  );
}

export function CaseDetailPage({ refreshedMinsAgo }: { refreshedMinsAgo: number }) {
  const { id } = useParams();
  const c = findById(getCases().cases, id);
  if (!c) return <NotFound noun="Case" id={id} back={casesBack} refreshedMinsAgo={refreshedMinsAgo} />;
  const alerts = alertsForCase(getAlertQueue().alerts, c);
  return (
    <DetailShell title={`Case ${c.id}`} subtitle={`${c.entity} · ${c.type}`} pill={c.overdue ? "Overdue" : `${c.priority} priority`} pillTone={c.overdue ? "red" : "teal"} back={casesBack} refreshedMinsAgo={refreshedMinsAgo}>
      <div className="card" role="region" aria-label="Case summary">
        <h2>Case summary <SeverityPill level={c.priority} /> <StatusPill status={c.status} /></h2>
        <p className="narrative">{c.typeSub}. {c.alerts} linked alert{c.alerts === 1 ? "" : "s"}.</p>
        <Facts items={[
          ["Customer", `${c.entity} · ${c.entityId}`], ["Entity", c.entityType], ["Opened", c.opened.replace(/^Opened /, "")],
          ["Investigator", <Assignee key="i" name={c.investigator} />], ["Due · UTC", c.due],
          ["Deadline", <span key="d" className={c.overdue ? "bad" : undefined}>{c.dueNote}</span>],
        ]} />
      </div>
      <section className="grid-3 even">
        <Linked title="Open alerts" empty="No open alerts on this customer." items={alerts.map((a) => ({ id: a.id, label: a.typology, meta: <SeverityPill level={a.severity} /> }))} />
        <Linked title="Regulatory filings" empty="No SAR or CTR filed from this case." items={reportsForCase(reports.rows, c.id).map((r) => ({ id: r.id, label: r.subject, meta: <StatusPill status={r.status} /> }))} />
        <Linked title="Audit trail" empty="No audited actions on this case yet." items={eventItems(c.id)} />
      </section>
    </DetailShell>
  );
}

export function RuleDetailPage({ refreshedMinsAgo }: { refreshedMinsAgo: number }) {
  const { id } = useParams();
  const r = findById(rules.rows, id);
  if (!r) return <NotFound noun="Rule" id={id} back={rulesBack} refreshedMinsAgo={refreshedMinsAgo} />;
  const d = rules.detail[r.id];
  return (
    <DetailShell title={`${r.id} · ${r.name}`} subtitle={`${r.logic} · ${r.ownerTeam}`} pill={r.status === "Active" ? "Active in production" : "Shadow testing"} pillTone="teal" back={rulesBack} refreshedMinsAgo={refreshedMinsAgo}>
      <section className="grid-2">
        <div className="card" role="region" aria-label="Detection logic">
          <h2>Detection logic</h2>
          {d && <p className="card-sub">{d.version}</p>}
          <p className="narrative">{d?.logic ?? `${r.logic}: ${r.logicSub}.`}</p>
          <Facts items={[
            ["Alerts · 30d", `${r.alerts} · ${r.alertsNote}`], ["False-positive rate", `${r.fpr}% · ${r.fprDelta}`],
            ["Owner", `${r.owner} · ${r.ownerTeam}`], ["Last updated", `${r.updated} · ${r.updatedNote}`], ...(d?.facts ?? []),
          ]} />
          {d && <Note>{d.note}</Note>}
          <Note tone="warn">Design mock figures, not evaluated detection metrics.</Note>
        </div>
        <Linked title="Open alerts from this rule" empty="No open alerts raised by this rule." items={alertsForRule(getAlertQueue().alerts, r.id).map((a) => ({ id: a.id, label: a.entity, meta: <SeverityPill level={a.severity} /> }))} />
      </section>
      <Linked title="Change history" empty="No audited changes to this rule yet." items={eventItems(r.id)} />
    </DetailShell>
  );
}

const WORKFLOW = ["Evidence", "Narrative", "Approval", "Submit"] as const;

export function ReportDetailPage({ refreshedMinsAgo }: { refreshedMinsAgo: number }) {
  const { id } = useParams();
  const r = findById(reports.rows, id);
  if (!r) return <NotFound noun="Report" id={id} back={reportsBack} refreshedMinsAgo={refreshedMinsAgo} />;
  const d = reports.detail[r.id];
  const current = filingStep(r.status);
  return (
    <DetailShell title={r.id} subtitle={`${r.subject} · ${r.type}`} pill={r.status} pillTone={r.status === "Draft" ? "red" : "teal"} back={reportsBack} refreshedMinsAgo={refreshedMinsAgo}>
      <section className="grid-2">
        <div className="card" role="region" aria-label="Filing">
          <h2>Filing <StatusPill status={r.status} /></h2>
          <ol className="stepper" aria-label="Filing steps">
            {WORKFLOW.map((s, i) => <li key={s} className={stepState(i, current)} aria-current={i === current ? "step" : undefined}><span className="step-dot" />{i + 1} {s}</li>)}
          </ol>
          {d && <p className="narrative">{d.narrative}</p>}
          <Facts items={[
            ["Source", <RecordLink key="s" id={r.ref} />], ["Prepared by", d?.preparer ?? r.preparer], ["Reviewer", d?.reviewer ?? r.reviewer ?? "Not required"],
            ["Deadline · UTC", `${r.deadline} · ${r.deadlineNote}`], ["Last updated", r.updated], ["Status note", r.note],
          ]} />
          {d && <Note tone="warn">{d.nextStep}</Note>}
        </div>
        <Linked title="Audit trail" empty="No audited actions on this filing yet." items={eventItems(r.id)} />
      </section>
    </DetailShell>
  );
}

export function AuditDetailPage({ refreshedMinsAgo }: { refreshedMinsAgo: number }) {
  const { id } = useParams();
  const e = findById(audit.rows, id);
  if (!e) return <NotFound noun="Audit event" id={id} back={auditBack} refreshedMinsAgo={refreshedMinsAgo} />;
  const d = audit.detail[e.id];
  return (
    <DetailShell title={e.action} subtitle={`${e.id} · ${e.actionSub}`} pill={e.result} pillTone={e.result === "Denied" ? "red" : "teal"} back={auditBack} refreshedMinsAgo={refreshedMinsAgo}>
      <section className="grid-2">
        <div className="card" role="region" aria-label="Event">
          <h2>Event <StatusPill status={e.result} /></h2>
          <p className="narrative">{d?.narrative ?? `${e.actor} · ${e.action} · ${e.record} (${e.recordSub}).`}</p>
          <Facts items={[
            ["Performed by", `${e.actor} · ${e.role}`], ["Timestamp · UTC", e.time], ["Record", <RecordLink key="r" id={e.record} />],
            ["Entity", e.recordSub], ["Source", e.source], ["Source IP", e.ip],
          ]} />
          {e.change && <Facts items={[["Changed field", e.change.field], ["Before", e.change.before], ["After", e.change.after]]} />}
          {e.change && <p className="narrative">Reason: {e.change.reason}</p>}
          {e.result === "Denied" && <Note tone="warn">Request blocked before any data was returned.</Note>}
          <Note tone="good">This event is append-only and cannot be modified or deleted.</Note>
        </div>
        <div className="card" role="region" aria-label="Evidence manifest">
          <h2>Evidence manifest</h2>
          {d ? (
            <dl className="perf-list">
              {([["Request", d.request], ["Session", d.session], ["Authentication", d.authentication], ["Authorization", d.authorization], ["Integrity digest · SHA-256", d.digest]] as [string, string][])
                .map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}
            </dl>
          ) : <p className="card-sub">The signed manifest for this event is held in immutable storage and included in exports.</p>}
          <div className="table-actions spaced">
            {recordPath(e.record) && <Link className="btn" to={recordPath(e.record)!}>Open {e.record} <ArrowRight size={12} /></Link>}
            <Link className="btn" to={paths.audit}>All events</Link>
          </div>
        </div>
      </section>
    </DetailShell>
  );
}
