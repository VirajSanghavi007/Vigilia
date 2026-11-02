import { AlertTriangle, ArrowLeftRight, Briefcase, Flag, Target } from "lucide-react";
import type { Kpi } from "../data/types";
import { formatDelta } from "../lib/format";

const icons = { volume: ArrowLeftRight, flag: Flag, alert: AlertTriangle, case: Briefcase, target: Target };
const tones = { volume: "teal", flag: "amber", alert: "red", case: "blue", target: "teal" } as const;

/** Green when the move is good for the business, red when bad. */
export function deltaTone(kpi: Pick<Kpi, "delta" | "higherIsBetter">): "good" | "bad" {
  return kpi.delta >= 0 === kpi.higherIsBetter ? "good" : "bad";
}

export function Kpis({ kpis }: { kpis: Kpi[] }) {
  return (
    <section className="kpis" aria-label="Key metrics">
      {kpis.map((k) => {
        const Icon = icons[k.icon];
        return (
          <div className="card kpi" key={k.id}>
            <div className="kpi-head">
              <span className="kpi-label">{k.label}</span>
              <span className={`kpi-icon ${tones[k.icon]}`}><Icon size={13} /></span>
            </div>
            <div className="kpi-body">
              <span className="kpi-value">{k.value}</span>
              <span className="kpi-meta">
                <span className={`delta ${deltaTone(k)}`}>{formatDelta(k.delta, k.deltaUnit)}</span>
                <span className="kpi-sub">{k.sub}</span>
              </span>
            </div>
          </div>
        );
      })}
    </section>
  );
}
