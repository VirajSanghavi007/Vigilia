import { ArrowUpRight, Check, Loader2, ShieldCheck } from "lucide-react";
import { Link } from "react-router-dom";
import { stepState } from "../lib/ops";
import { paths } from "../routes";

const steps = [
  ["Verify secure access", "Your role and workspace permissions are confirmed"],
  ["Connect data sources", "Retrieving transaction and screening data"],
  ["Prepare analytical views", "Build trends, channels and corridor summaries"],
  ["Open workspace", "Display your authorized analytical view"],
];
/** Zero-based index of the step in progress (Figma: stage 2 of 4). */
const STAGE = 1;
const stateLabel = { done: "Complete", active: "In progress", todo: "Waiting" };

const guide = [
  { to: paths.customers, name: "Customers", q: "Who is the entity?", body: "Entity profiles, KYC evidence and portfolio risk.", view: "Profile cards + evidence checklist" },
  { to: paths.investigations, name: "Investigations", q: "How is the activity connected?", body: "Relationships, evidence and investigative hypotheses.", view: "Relationship graph + evidence timeline" },
  { to: paths.transactions, name: "Transactions", q: "Where did the money move?", body: "Individual payments, ledger entries and fund flows.", view: "Payment ledger + flow trace" },
  { to: paths.cases, name: "Cases", q: "Who owns the next decision?", body: "Ownership, disposition and regulatory deadlines.", view: "Work queue + deadline milestones" },
];

export function WorkspaceLoadingPage() {
  return (
    <>
      <section className="grid-2 loading-grid">
        <div className="card" role="region" aria-label="Connecting your workspace">
          <h2>Connecting your workspace</h2>
          <p className="card-sub">We're retrieving your authorized data and preparing Transaction analytics. Keep this window open while we finish.</p>
          <p className="secure-line"><ShieldCheck size={13} />Secure session established · Access permissions verified</p>
          <ol className="load-steps">
            {steps.map(([title, sub], i) => {
              const s = stepState(i, STAGE);
              return (
                <li key={title} className={s} aria-current={s === "active" ? "step" : undefined}>
                  <span className="load-icon">{s === "done" ? <Check size={12} /> : s === "active" ? <Loader2 size={12} /> : i + 1}</span>
                  <span><strong>{title}</strong><span className="card-sub">{sub}</span></span>
                  <span className={`pill ${s === "done" ? "teal" : s === "active" ? "blue" : "grey"}`}>{stateLabel[s]}</span>
                </li>
              );
            })}
          </ol>
          <div className="card-foot">
            <span>Stage {STAGE + 1} of {steps.length} · {steps[STAGE][0]}</span>
            <span>Metrics and charts will appear after loading completes</span>
          </div>
        </div>
        <div className="card" role="region" aria-label="Transaction analytics preview" aria-busy="true">
          <h2>Transaction analytics preview</h2>
          <p className="card-sub">Awaiting data · No results displayed</p>
          <div className="skeleton-kpis">{[0, 1, 2, 3].map((i) => <span key={i} className="skeleton" />)}</div>
          <p className="kpi-label skel-title">Transaction volume trend</p>
          <span className="skeleton tall" />
          <p className="kpi-label skel-title">Channel composition</p>
          <span className="skeleton" />
        </div>
      </section>
      <section className="card" role="region" aria-label="Workspace guide">
        <div className="card-head">
          <div>
            <h2>One workspace. Four distinct jobs.</h2>
            <p className="card-sub">Choose the record type that matches your question, not just a different list.</p>
          </div>
          <span className="pill teal">Workspace guide</span>
        </div>
        <div className="guide">
          {guide.map((g) => (
            <Link key={g.name} to={g.to} className="guide-card">
              <span className="eyebrow">{g.name}</span>
              <strong>{g.q}</strong>
              <span className="card-sub">{g.body}</span>
              <span className="guide-view">{g.view}</span>
            </Link>
          ))}
        </div>
      </section>
      <footer className="page-foot">
        <span>Your saved views and workspace preferences will be restored automatically.</span>
        <Link className="link" to={paths.support}>Taking longer than expected? Contact support <ArrowUpRight size={12} /></Link>
      </footer>
    </>
  );
}
