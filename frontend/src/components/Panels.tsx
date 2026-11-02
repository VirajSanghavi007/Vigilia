import { AlertOctagon, ChevronRight, FileCheck, StickyNote, UserPlus } from "lucide-react";
import type { Dashboard } from "../data/types";
import { percentOf } from "../lib/format";

export function TypologyBreakdown({ data, coverage }: { data: Dashboard["typologies"]; coverage: string }) {
  const total = data.reduce((s, d) => s + d.count, 0);
  const max = Math.max(...data.map((d) => d.count));
  return (
    <div className="card">
      <div className="card-head">
        <div><h2>Alert typology breakdown</h2><p className="card-sub">Active alert mix</p></div>
        <a className="link" href="#">All typologies <ChevronRight size={13} /></a>
      </div>
      <ul className="typologies">
        {data.map((t) => (
          <li key={t.name}>
            <div className="typ-row">
              <span>{t.name}</span>
              <span className="typ-nums"><strong>{t.count}</strong><span>{percentOf(t.count, total)}</span></span>
            </div>
            <div className="track thin"><span style={{ width: `${(t.count / max) * 100}%`, background: t.color }} /></div>
          </li>
        ))}
      </ul>
      <div className="card-foot"><span>Top five typologies</span><strong className="accent">{coverage}</strong></div>
    </div>
  );
}

// Coarse continent blobs on a 100x60 grid: enough to read as a world map
// without shipping a map library or a large GeoJSON file.
const continents = [
  "M8 12 L28 8 L34 18 L30 26 L22 30 L18 26 L10 22 Z",
  "M24 32 L32 34 L34 44 L30 54 L26 52 L24 42 Z",
  "M44 10 L56 8 L58 16 L50 20 L44 18 Z",
  "M44 22 L56 22 L60 32 L54 46 L48 46 L44 34 Z",
  "M58 8 L88 8 L92 18 L84 28 L72 30 L62 24 L58 16 Z",
  "M80 40 L92 40 L94 48 L84 50 Z",
];

export function GeographicRisk({ hotspots, elevated, newAlerts }: { hotspots: Dashboard["hotspots"]; elevated: number; newAlerts: number }) {
  return (
    <div className="card">
      <div className="card-head">
        <div><h2>Geographic risk</h2><p className="card-sub">Originating jurisdictions</p></div>
        <a className="link" href="#">Risk map <ChevronRight size={13} /></a>
      </div>
      <div className="map">
        <svg viewBox="0 0 100 60" preserveAspectRatio="none" aria-hidden>
          {continents.map((d, i) => <path key={i} d={d} fill="var(--map-land)" />)}
        </svg>
        {hotspots.map((h) => (
          <span key={h.name} className="hotspot" style={{ left: `${h.x}%`, top: `${h.y}%` }}>
            <span className="dot" style={{ background: "var(--critical)" }} />{h.name}
          </span>
        ))}
      </div>
      <div className="card-foot"><span>{elevated} elevated jurisdictions</span><span className="bad">+{newAlerts} alerts today</span></div>
    </div>
  );
}

const activityIcon = { assign: UserPlus, sar: FileCheck, note: StickyNote, escalate: AlertOctagon };

export function CaseActivity({ items, today }: { items: Dashboard["activity"]; today: Dashboard["activityToday"] }) {
  return (
    <div className="card">
      <div className="card-head">
        <div><h2>Case activity</h2><p className="card-sub">Latest team actions</p></div>
        <a className="link" href="#">View log <ChevronRight size={13} /></a>
      </div>
      <ul className="activity">
        {items.map((a) => {
          const Icon = activityIcon[a.kind];
          return (
            <li key={a.title}>
              <span className={`act-icon ${a.kind}`}><Icon size={13} /></span>
              <div><div className="act-title">{a.title}</div><div className="act-sub">{a.sub}</div></div>
            </li>
          );
        })}
      </ul>
      <div className="card-foot"><span>Today</span><span>{today.actions} actions · {today.escalations} escalations</span></div>
    </div>
  );
}
