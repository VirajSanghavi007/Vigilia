import { useState } from "react";
import { Check, Lock, ShieldCheck } from "lucide-react";
import { profile, type ProfileForm } from "../data/ops";
import { initials } from "../lib/format";
import { isDirty } from "../lib/ops";
import { paths } from "../routes";
import { Field, More, Note, SaveBar, Toggle } from "./OpsParts";
import { useTheme } from "./useTheme";
import { THEME_PREFS, type ThemePref } from "../lib/theme";

const LANGUAGES = ["English (United Kingdom)", "English (United States)", "Français", "Deutsch"];
const THEME_LABELS: Record<ThemePref, string> = { light: "Light", dark: "Dark", system: "Match system" };
const TIME_ZONES = ["UTC · Coordinated Universal Time", "Europe/London · GMT/BST", "Asia/Singapore · SGT", "America/New_York · ET"];

export function ProfilePage() {
  const [saved, setSaved] = useState<ProfileForm>(profile.form);
  const [form, setForm] = useState<ProfileForm>(profile.form);
  const [sessions, setSessions] = useState(profile.sessions);
  const [theme, setTheme] = useTheme();
  const set = <K extends keyof ProfileForm>(k: K, v: ProfileForm[K]) => setForm((f) => ({ ...f, [k]: v }));
  const dirty = isDirty(form, saved);
  const others = sessions.filter((s) => !s.current);

  return (
    <>
      <section className="card profile-hero" role="region" aria-label="Account">
        <span className="avatar large">{initials(saved.displayName)}</span>
        <div>
          <h2>{saved.displayName}<span className="pill teal">Active account</span></h2>
          <p className="card-sub">{profile.title} · {profile.unit}</p>
          <p className="card-sub">{profile.email} <span className="verified"><Check size={11} />Verified</span></p>
        </div>
        <span className="pill grey sso"><ShieldCheck size={12} />Corporate SSO · MFA verified</span>
      </section>

      <div className="profile-layout">
        <div className="profile-col">
          <section className="card" role="region" aria-label="Your role & access">
            <h2>Your role & access</h2>
            <dl className="kv">
              <div><dt>Role</dt><dd>{profile.title}</dd></div>
              <div><dt>Business-unit scope</dt><dd>{profile.unit}</dd></div>
              <div><dt>Investigation level</dt><dd>{profile.level}</dd></div>
            </dl>
            <ul className="access">
              {profile.granted.map((g) => <li key={g} className="granted"><Check size={12} />{g}</li>)}
              {profile.locked.map((g) => <li key={g} className="denied"><Lock size={12} />{g}</li>)}
            </ul>
            <More to={paths.accessRequest}>Request an access change</More>
          </section>
          <section className="card" role="region" aria-label="Account record">
            <h2>Account record</h2>
            <dl className="kv">
              <div><dt>User ID</dt><dd>{profile.userId}</dd></div>
              <div><dt>Member since</dt><dd>{profile.memberSince}</dd></div>
              <div><dt>Last access review</dt><dd>{profile.lastReview}</dd></div>
              <div><dt>Next scheduled review</dt><dd>{profile.nextReview}</dd></div>
            </dl>
          </section>
          <div className="card info-box">
            <strong>Personal, not workspace-wide</strong>
            <p className="card-sub">Changes here affect only your account. Shared defaults live in workspace settings.</p>
            <More to={paths.settings}>Open workspace Settings</More>
          </div>
          <div className="card info-box">
            <strong>Need to update your role?</strong>
            <p className="card-sub">Roles and business-unit scope are assigned by your workspace administrator.</p>
            <More to={paths.support}>Contact administrator</More>
          </div>
        </div>

        <div className="profile-col wide">
          <section className="card" role="region" aria-label="Personal details">
            <h2>Personal details</h2>
            <div className="form-grid">
              <Field label="Full name" value={profile.name} locked />
              <Field label="Work email" value={profile.email} locked />
              <Field label="Display name" value={form.displayName} onChange={(v) => set("displayName", v)} />
              <Field label="Job title" value={profile.title} locked />
            </div>
            <Note>To change directory-managed details, contact your workspace administrator.</Note>
          </section>
          <section className="card" role="region" aria-label="Personal preferences">
            <h2>Personal preferences</h2>
            <div className="form-grid">
              <Field label="Language" value={form.language} options={LANGUAGES} onChange={(v) => set("language", v)} />
              <Field label="Display time zone" value={form.timeZone} options={TIME_ZONES} onChange={(v) => set("timeZone", v)} />
              <Field label="Theme" value={THEME_LABELS[theme]} options={THEME_PREFS.map((p) => THEME_LABELS[p])}
                note="Applies straight away on this device; not part of the saved profile."
                onChange={(v) => setTheme(THEME_PREFS.find((p) => THEME_LABELS[p] === v) ?? "system")} />
            </div>
            <Toggle label="Email me about my assigned cases" sub="New assignments, escalations and approaching deadlines." checked={form.caseEmails} onChange={(v) => set("caseEmails", v)} />
            <Toggle label="Send me the daily operations digest" sub="18:00 UTC on weekdays." checked={form.dailyDigest} onChange={(v) => set("dailyDigest", v)} />
          </section>
          <section className="card" role="region" aria-label="Security & sessions">
            <div className="card-head"><h2>Security & sessions</h2><span className="pill teal"><ShieldCheck size={11} />Protected</span></div>
            <dl className="kv three">
              <div><dt>Sign-in method</dt><dd>{profile.signIn}</dd></div>
              <div><dt>Multi-factor authentication</dt><dd>{profile.mfa}</dd></div>
              <div><dt>Last successful sign-in</dt><dd>{profile.lastSignIn}</dd></div>
            </dl>
            <h3 className="sub-head">Active sessions <span className="card-sub">({sessions.length} trusted {sessions.length === 1 ? "device" : "devices"})</span></h3>
            <ul className="checklist" aria-label="Active sessions">
              {sessions.map((s) => (
                <li key={s.ip}>
                  <span><strong>{s.device}</strong><span className="card-sub">{s.ip} · {s.when}</span></span>
                  {s.current
                    ? <span className="pill teal">This session</span>
                    : <button className="btn small" onClick={() => setSessions((all) => all.filter((x) => x.ip !== s.ip))}>Revoke</button>}
                </li>
              ))}
            </ul>
            <div className="table-actions spaced">
              <More to={paths.audit}>View my sign-in history</More>
              <button className="btn small" disabled={others.length === 0} onClick={() => setSessions((all) => all.filter((x) => x.current))}>Sign out other sessions</button>
            </div>
            <Note>Organization-managed security. Sessions lock after 15 minutes of inactivity; password and MFA changes are made with your identity provider.</Note>
          </section>
        </div>
      </div>
      <SaveBar dirty={dirty} title="Your preferences, your workspace" sub="Personal changes do not alter workspace policies." saveLabel="Save profile"
        onSave={() => setSaved(form)} onCancel={() => setForm(saved)} />
    </>
  );
}
