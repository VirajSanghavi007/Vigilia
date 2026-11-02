import { ChevronRight, TrendingUp } from "lucide-react";
import { Link } from "react-router-dom";
import {
  Bar, BarChart, CartesianGrid, Cell, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import type { Dashboard } from "../data/types";
import { formatDelta } from "../lib/format";
import { paths } from "../routes";

const axis = { fontSize: 10, fill: "var(--muted)" };

export function RiskTrend({ data, link = true }: { data: Dashboard["riskTrend"]; link?: boolean }) {
  const peak = data.reduce((m, d) => (d.high > m.high ? d : m), data[0]);
  // A one-day range ("Today") has no line to draw, so show the points.
  const dot = data.length < 3;
  return (
    <div className="card chart-card">
      <div className="card-head">
        <div>
          <h2>Risk trend</h2>
          <p className="card-sub">Alerts generated · daily</p>
        </div>
        {link && <Link className="link" to={paths.riskTrend}>View analysis <ChevronRight size={13} /></Link>}
      </div>
      <div className="legend">
        <span><span className="dot" style={{ background: "var(--critical)" }} />High risk</span>
        <span><span className="dot" style={{ background: "var(--medium)" }} />Medium risk</span>
        <span className="peak">Peak {peak.high} · {peak.date}</span>
      </div>
      <div className="chart-box">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 6, right: 8, left: -22, bottom: 0 }}>
            <CartesianGrid stroke="var(--grid)" vertical={false} />
            <XAxis dataKey="date" tick={axis} tickLine={false} axisLine={false} interval={data.length > 10 ? 6 : 0} />
            <YAxis tick={axis} tickLine={false} axisLine={false} />
            <Tooltip />
            <Line type="monotone" dataKey="medium" stroke="var(--medium)" strokeWidth={1.5} dot={dot} strokeOpacity={0.6} />
            <Line type="monotone" dataKey="high" stroke="var(--critical)" strokeWidth={2} dot={dot} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export function TransactionMonitoring({ data, total, delta }: { data: Dashboard["volumeByHour"]; total: string; delta: number }) {
  const max = Math.max(...data.map((d) => d.value));
  return (
    <div className="card chart-card">
      <div className="card-head">
        <div>
          <h2>Transaction monitoring</h2>
          <p className="card-sub">Volume by hour · UTC</p>
        </div>
      </div>
      <div className="vol-head">
        <span className="big">{total}</span>
        <span className="delta good">{formatDelta(delta)} vs. avg</span>
      </div>
      <div className="chart-box">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 6, right: 0, left: 0, bottom: 0 }} barCategoryGap={2}>
            <XAxis dataKey="hour" tick={axis} tickLine={false} axisLine={false} interval={5}
              tickFormatter={(h: number) => `${String(h).padStart(2, "0")}:00`} />
            <Tooltip cursor={{ fill: "var(--grid)" }} />
            <Bar dataKey="value" radius={[2, 2, 0, 0]}>
              {data.map((d) => (
                <Cell key={d.hour} fill={d.value === max ? "var(--accent-dark)" : d.value > max * 0.6 ? "var(--accent)" : "var(--bar-muted)"} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export function AlertSeverity({ data, note }: { data: Dashboard["severity"]; note: string }) {
  const total = data.reduce((s, d) => s + d.count, 0);
  const max = Math.max(...data.map((d) => d.count));
  return (
    <div className="card chart-card">
      <div className="card-head">
        <div>
          <h2>Alert severity</h2>
          <p className="card-sub">{total.toLocaleString("en-US")} active alerts</p>
        </div>
      </div>
      <ul className="severity">
        {data.map((d) => (
          <li key={d.level}>
            <div className="sev-row"><span>{d.level}</span><strong>{d.count.toLocaleString("en-US")}</strong></div>
            <div className="track"><span style={{ width: `${(d.count / max) * 100}%`, background: d.color }} /></div>
          </li>
        ))}
      </ul>
      <p className="foot-note"><TrendingUp size={12} />{note}</p>
    </div>
  );
}
