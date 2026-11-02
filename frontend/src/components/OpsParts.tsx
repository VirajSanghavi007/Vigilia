// Building blocks shared by the operations, governance and account pages.
import { useState, type ReactNode } from "react";
import { ArrowRight, Check, FileText, Lock, Search, SlidersHorizontal, TriangleAlert, UserPlus } from "lucide-react";
import { Link } from "react-router-dom";
import type { Activity } from "../data/ops";
import { FilterSelect } from "./QueueParts";

const actIcon = { assign: UserPlus, sar: FileText, note: Search, escalate: TriangleAlert };

/** A card-header link ("View audit log →"). Every one routes somewhere, so `to` is required. */
export function More({ to, children }: { to: string; children: string }) {
  return <Link className="link" to={to}>{children} <ArrowRight size={12} /></Link>;
}


export function ActivityCard({ title, sub, link, to, items }: { title: string; sub?: string; link: string; to: string; items: Activity[] }) {
  return (
    <div className="card" role="region" aria-label={title}>
      <div className="card-head"><div><h2>{title}</h2>{sub && <p className="card-sub">{sub}</p>}</div><More to={to}>{link}</More></div>
      <ul className="activity">
        {items.map((i) => {
          const Icon = actIcon[i.kind];
          return (
            <li key={i.title}>
              <span className={`act-icon ${i.kind}`}><Icon size={12} /></span>
              <div style={{ flex: 1 }}><div className="act-title">{i.title}</div><div className="act-sub">{i.sub}</div></div>
              <span className="act-sub">{i.ago}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Label/value pairs in a grid, e.g. "Prepared by / Daniel Cho". */
export function Facts({ items, cols = 3 }: { items: [string, ReactNode][]; cols?: number }) {
  return (
    <div className="facts" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}>
      {items.map(([k, v]) => <div key={k}><span className="kpi-label">{k}</span><div>{v}</div></div>)}
    </div>
  );
}

/** Horizontal stacked bar plus legend rows. */
export function Distribution({ parts, total }: { parts: { label: string; count: number; color: string }[]; total: number }) {
  return (
    <>
      <div className="stack-bar">
        {parts.map((p) => <span key={p.label} style={{ width: `${(p.count / total) * 100}%`, background: p.color }} />)}
      </div>
      <ul className="dist-list">
        {parts.map((p) => (
          <li key={p.label}><span className="dot" style={{ background: p.color }} />{p.label}<strong>{p.count.toLocaleString("en-US")}</strong></li>
        ))}
      </ul>
    </>
  );
}

export function Note({ tone = "info", children }: { tone?: "info" | "warn" | "good"; children: ReactNode }) {
  return <p className={`note ${tone}`}>{tone === "good" ? <Check size={13} /> : <TriangleAlert size={13} />}<span>{children}</span></p>;
}

/**
 * "More filters" toggle plus the extra dropdowns it reveals. `options` maps
 * each extra filter key (also a key of the page's table filters) to its choices.
 */
export function MoreFilters({ options, values, onChange }: {
  options: Record<string, string[]>; values: Record<string, string>; onChange: (key: string, value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const active = Object.keys(options).filter((k) => values[k] !== "All").length;
  return (
    <>
      <button className={`btn${open ? " on" : ""}`} aria-expanded={open} onClick={() => setOpen(!open)}>
        <SlidersHorizontal size={13} />More filters{active > 0 && <span className="count-badge">{active}</span>}
      </button>
      {open && (
        <div className="toolbar-extra" role="group" aria-label="More filters">
          {Object.entries(options).map(([k, opts]) => (
            <FilterSelect key={k} label={k} value={values[k]} options={opts} onChange={(v) => onChange(k, v)} />
          ))}
        </div>
      )}
    </>
  );
}

export function Toggle({ label, sub, checked, onChange, locked }: { label: string; sub?: string; checked: boolean; onChange?: (v: boolean) => void; locked?: boolean }) {
  return (
    <label className="toggle-row">
      <span><span className="field-label">{label}{locked && <Lock size={11} className="lock" />}</span>{sub && <span className="card-sub">{sub}</span>}</span>
      <input type="checkbox" role="switch" className="switch" aria-label={label} checked={checked} disabled={locked}
        onChange={(e) => onChange?.(e.target.checked)} />
    </label>
  );
}

export function Field({ label, value, onChange, locked, note, options }: {
  label: string; value: string; onChange?: (v: string) => void; locked?: boolean; note?: string; options?: string[];
}) {
  return (
    <label className="field">
      <span className="field-label">{label}{locked && <Lock size={11} className="lock" />}</span>
      {options ? (
        <select aria-label={label} value={value} disabled={locked} onChange={(e) => onChange?.(e.target.value)}>
          {options.map((o) => <option key={o}>{o}</option>)}
        </select>
      ) : (
        <input aria-label={label} value={value} readOnly={locked} disabled={locked} onChange={(e) => onChange?.(e.target.value)} />
      )}
      {note && <span className="card-sub">{note}</span>}
    </label>
  );
}

/** Persistent sticky footer; Cancel and Save are enabled only while the form differs from what was saved. */
export function SaveBar({ dirty, title, sub, saveLabel, onSave, onCancel }: {
  dirty: boolean; title: string; sub: string; saveLabel: string; onSave: () => void; onCancel: () => void;
}) {
  return (
    <div className={`save-bar${dirty ? " dirty" : ""}`} role="region" aria-label={title}>
      <div><strong>{title}</strong><div className="card-sub">{sub}</div></div>
      <div className="table-actions">
        <span className="save-state">{dirty ? "Unsaved changes" : "All changes saved"}</span>
        <button className="btn" disabled={!dirty} onClick={onCancel}>Cancel</button>
        <button className="btn primary" disabled={!dirty} onClick={onSave}>{saveLabel}</button>
      </div>
    </div>
  );
}
