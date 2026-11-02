import { useState } from "react";
import { ShieldCheck } from "lucide-react";
import { workspaceRecord, workspaceSettings, type WorkspaceSettings } from "../data/ops";
import { isDirty } from "../lib/ops";
import { paths } from "../routes";
import { Field, More, Note, SaveBar, Toggle } from "./OpsParts";

const TIME_ZONES = ["UTC · Coordinated Universal Time", "Europe/London · GMT/BST", "Asia/Singapore · SGT", "America/New_York · ET"];
const CURRENCIES = ["USD · US Dollar", "EUR · Euro", "GBP · Pound Sterling", "SGD · Singapore Dollar"];
const sections = [["general", "General"], ["security", "Security & access"], ["notifications", "Notification defaults"], ["audit", "Audit & retention"]];

export function SettingsPage() {
  const [saved, setSaved] = useState<WorkspaceSettings>(workspaceSettings);
  const [form, setForm] = useState<WorkspaceSettings>(workspaceSettings);
  const set = <K extends keyof WorkspaceSettings>(k: K, v: WorkspaceSettings[K]) => setForm((f) => ({ ...f, [k]: v }));
  const dirty = isDirty(form, saved);

  return (
    <>
      <div className="admin-layout">
        <aside className="admin-nav">
          <nav className="card" aria-label="On this page">
            <p className="eyebrow">On this page</p>
            {sections.map(([id, label]) => <a key={id} href={`#${id}`}>{label}</a>)}
          </nav>
          <div className="card">
            <strong>Looking for your account?</strong>
            <p className="card-sub">Language, display and personal alerts are managed in your profile.</p>
            <More to={paths.profile}>Go to Profile</More>
          </div>
          <div className="card ws-id">
            <span className="eyebrow">Workspace ID</span>
            <code>{workspaceRecord.id}</code>
            <span className="card-sub">Production · {workspaceRecord.region}</span>
          </div>
        </aside>

        <div className="admin-main">
          <section className="card" id="general" role="region" aria-label="General">
            <h2>General</h2>
            <p className="card-sub">Shared defaults for the Vigilia AML production workspace.</p>
            <div className="form-grid">
              <Field label="Workspace name" value={form.workspaceName} onChange={(v) => set("workspaceName", v)} />
              <Field label="Compliance contact" value={form.complianceContact} onChange={(v) => set("complianceContact", v)} />
              <Field label="Default time zone" value={form.timeZone} options={TIME_ZONES} onChange={(v) => set("timeZone", v)} note="Audit timestamps always remain in UTC." />
              <Field label="Base reporting currency" value={form.currency} options={CURRENCIES} onChange={(v) => set("currency", v)} note="Original transaction currencies are preserved." />
            </div>
          </section>
          <section className="card" id="security" role="region" aria-label="Security & access">
            <div className="card-head">
              <div><h2>Security & access</h2><p className="card-sub">Mandatory safeguards for investigators and privileged workspace users.</p></div>
              <span className="pill grey">Administrator managed</span>
            </div>
            <div className="form-grid">
              <Field label="Authentication policy" value="Corporate SSO only · SAML 2.0" locked />
              <Field label="Idle session timeout" value="15 minutes" locked />
            </div>
            <Toggle label="Require multi-factor authentication" sub="Enforced for every sign-in, including privileged accounts." checked locked />
            <Toggle label="Four-eyes approval for sensitive actions" sub="Separate approval for SAR filings and production rule or model changes." checked locked />
            <Note>Least privilege by default · Access follows assigned roles and business unit scope. New access and policy exceptions require administrator approval.</Note>
          </section>
          <section className="card" id="notifications" role="region" aria-label="Notification defaults">
            <h2>Notification defaults</h2>
            <p className="card-sub">Workspace delivery defaults. Individuals can refine optional alerts in Profile.</p>
            <Toggle label="Critical alert escalation" sub="Notify assigned investigators and team leads immediately · In-app + email." checked={form.criticalEscalation} onChange={(v) => set("criticalEscalation", v)} />
            <Toggle label="Case deadlines & overdue reminders" sub="Send reminders 24 hours before a deadline and when a case becomes overdue." checked={form.deadlineReminders} onChange={(v) => set("deadlineReminders", v)} />
            <Toggle label="Daily operations digest" sub="Summary of open alerts, case workload and filing deadlines · Email at 18:00 UTC." checked={form.dailyDigest} onChange={(v) => set("dailyDigest", v)} />
            <p className="card-sub spaced">Security incidents and regulatory deadline notices are mandatory and cannot be muted.</p>
          </section>
          <section className="card" id="audit" role="region" aria-label="Audit & retention">
            <h2>Audit & retention</h2>
            <p className="card-sub">Immutable evidence controls apply to all users and service accounts.</p>
            <div className="form-grid">
              <Field label="Audit retention period" value="7 years · Immutable storage" locked />
              <Field label="Audit export format" value="CSV + signed manifest" locked />
            </div>
            <Note>Records cannot be shortened or deleted. All configuration changes are logged with actor, before/after values and a UTC timestamp. Legal holds override scheduled deletion.</Note>
          </section>
        </div>

        <aside className="admin-rail">
          <div className="card" role="region" aria-label="A governed workspace">
            <h2><ShieldCheck size={14} className="accent" />A governed workspace</h2>
            <p className="card-sub">Production policies protect sensitive customer data and preserve defensible investigation records. General and notification edits can be saved here. Locked security controls require a workspace administrator.</p>
            <More to={paths.configPolicy}>Read configuration policy</More>
          </div>
          <div className="card" role="region" aria-label="Configuration record">
            <h2>Configuration record</h2>
            <dl className="kv">
              <div><dt>Last saved by</dt><dd>{workspaceRecord.savedBy}</dd></div>
              <div><dt>Last saved · UTC</dt><dd>{workspaceRecord.savedAt}</dd></div>
              <div><dt>Policy version</dt><dd>{workspaceRecord.policy}</dd></div>
            </dl>
            <More to={paths.audit}>View configuration history</More>
          </div>
          <div className="card" role="region" aria-label="Detection environment">
            <div className="card-head"><h2>Detection environment</h2><span className="pill teal">Active in production</span></div>
            <dl className="kv"><div><dt>Active production model</dt><dd>{workspaceRecord.model}</dd></div></dl>
            <p className="card-sub">Detection logic is versioned separately. Saving these settings does not deploy a model or change a rule.</p>
            <More to={paths.rules}>Open Rules & models</More>
          </div>
          <div className="card">
            <h2>Need a policy exception?</h2>
            <p className="card-sub">Contact your compliance administrator. Include the workspace ID and a documented business reason.</p>
            <More to={paths.support}>Contact administrator</More>
          </div>
        </aside>
      </div>
      <SaveBar dirty={dirty} title="Changes apply across this workspace" sub="Every saved change is attributed and recorded in the audit log." saveLabel="Save changes"
        onSave={() => setSaved(form)} onCancel={() => setForm(saved)} />
    </>
  );
}
