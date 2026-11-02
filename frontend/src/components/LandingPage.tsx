import { useState } from "react";
import { ArrowRight, ArrowUpRight, Check } from "lucide-react";
import { Link } from "react-router-dom";
import { paths } from "../routes";
import { Logo } from "./Logo";
import { GraphLegend, TransactionGraph } from "./TransactionGraph";

// Public product page (Figma "Landing page"). Copy is example-data marketing
// content; every figure shown is labelled as sample data on the page itself.

const challenge = [
  ["01", "Connect the records", "Customers, payments, alerts and cases stay linked, so context travels with the work."],
  ["02", "Follow the evidence", "Trace the payment path and the relationships around it before deciding what it means."],
  ["03", "Own the decision", "Assignment, review and deadlines sit with the case, so every outcome has an owner."],
];

const jobs = [
  { name: "Customers", head: "Know the entity.", body: "Bring entity profiles, customer risk and KYC readiness into focus before you assess the activity.",
    rec: "Orion Trading FZE", meta: "C-10842 · Corporate · United Arab Emirates", tag: "EDD required", tone: "amber" },
  { name: "Transactions", head: "Understand the movement.", body: "Review payment records and fund flows, then follow a selected transfer into its wider relationship context.",
    rec: "TXN-984218", meta: "$98,500 USD · SWIFT · AE → HK", tag: "Flagged", tone: "red" },
  { name: "Investigations", head: "Connect the evidence.", body: "Explore relationships, inspect linked records and identify the evidence needed to develop the investigation.",
    rec: "Source-of-funds review", meta: "Orion Trading FZE · Linked to AML-4821", tag: "Evidence requested", tone: "blue" },
  { name: "Cases", head: "Make the work accountable.", body: "Keep assignment, decisions and deadlines visible, with a clear home for case ownership and review.",
    rec: "AML-4821", meta: "Rapid movement of funds · Assigned to Daniel Cho", tag: "Escalated", tone: "red" },
];

const flow = [
  ["01", "Start with a signal", "Review the flagged activity and the rule that brought it to attention.", "Alert queue → Selected transaction"],
  ["02", "Trace the relationships", "Follow the payment path and expand the surrounding entities and activity.", "Transactions → Graph explorer"],
  ["03", "Develop the evidence", "Inspect customer context, review linked records and request missing evidence.", "Customers → Investigations"],
  ["04", "Reach a case decision", "Assign ownership, document the review and manage the decision and deadline.", "Investigations → Cases"],
];

const teams = [
  ["Banks", "Connect customer due diligence with cross-border payment review and case oversight.", ["Customer context", "Payment tracing", "Case review"]],
  ["Fintechs", "Follow fund flows beyond an isolated transaction and understand the activity around a flagged payment.", ["Transaction review", "Linked activity", "Investigation"]],
  ["Compliance & investigation teams", "Keep evidence, ownership and deadlines in view as work moves from analyst to reviewer.", ["Evidence requests", "Assignment", "Decisions"]],
] as const;

const evaluation = [
  ["01", "Map your investigation process", "Where signals originate, how evidence is reviewed and who makes the decision."],
  ["02", "Explore the product together", "Walk through payment tracing, customer context and case management."],
  ["03", "Define the next conversation", "Discuss data, security, deployment and rollout requirements with the team."],
];

const faq = [
  ["What does Vigilia AML bring together?", "Customer profiles and KYC, payment records and fund flows, relationship-led investigations, and case assignment, decisions and deadlines. Supporting workspaces include the alert queue, reports, rules & models and audit log."],
  ["How is the graph different from a summary chart?", "The graph traces relationships around a selected payment: its originator, beneficiary, accounts, linked activity, alert, case and evidence request. A dedicated inspector shows details without losing the relationship view."],
  ["Where do Investigations end and Cases begin?", "Investigations focus on relationships and evidence. Cases organize the work around ownership, review decisions and deadlines. Linked records keep the two connected."],
  ["Are the figures on this page customer results?", "No. All product records, risk scores, amounts and activity values shown are example data used to explain the workflow. They are not measured customer outcomes."],
  ["How do we discuss pricing, deployment and data requirements?", "Book a demo or talk to sales. Use that conversation to review your scope, data, security and deployment needs, and agree what should be evaluated next."],
];

const riskRows = [
  ["Triggering rule", "TM-014 · Velocity anomaly"], ["Linked activity", "12 transfers · $482,750"],
  ["Activity window", "38 minutes · 6.4× baseline"], ["Jurisdiction exposure", "3 elevated-risk jurisdictions"],
];

function Eyebrow({ children }: { children: string }) {
  return <p className="lp-eyebrow">{children}</p>;
}

function Demo({ label = "Book a demo" }: { label?: string }) {
  return <a className="lp-btn primary" href="#contact">{label} <ArrowUpRight size={14} /></a>;
}

export function LandingPage() {
  const [selected, setSelected] = useState("txn");
  return (
    <div className="landing">
      <section className="lp-hero">
        <nav className="lp-nav" aria-label="Product">
          <Logo tone="inverse" />
          <div className="lp-links">
            <a href="#platform">Platform</a><a href="#graph">Graph explorer</a><a href="#teams">Who it's for</a><a href="#faq">FAQ</a>
          </div>
          <Demo />
        </nav>
        <div className="lp-hero-body">
          <div>
            <Eyebrow>Financial crime intelligence / Connected by context</Eyebrow>
            <h1>See the connection. Build the case.</h1>
            <p className="lp-lead">From a flagged payment to the relationships behind it. Vigilia AML brings monitoring, investigation and case decisions into one connected workspace.</p>
            <div className="lp-cta-row">
              <Demo />
              <Link className="lp-btn ghost" to={paths.overview}>Explore the platform <ArrowRight size={14} /></Link>
            </div>
          </div>
          <div className="lp-preview" role="figure" aria-label="Example payment preview">
            <div className="lp-preview-head">
              <span>Transaction graph explorer</span><span className="lp-mono">Example data · Relationship view</span>
            </div>
            <div className="lp-preview-title"><strong>One payment. A wider story.</strong><span className="pill red">Flagged · Risk 96/100</span></div>
            <div className="lp-path">
              <div><span className="lp-mono">Originator</span><strong>Account •••• 4821</strong><span>Orion Trading FZE</span><span>United Arab Emirates · Corporate</span></div>
              <ArrowRight size={16} className="lp-arrow" />
              <div className="hot"><span className="lp-mono">TXN-984218 / SWIFT wire</span><strong>$98,500 USD</strong><span>Sep 28, 09:42 UTC · AE → HK</span></div>
              <ArrowRight size={16} className="lp-arrow" />
              <div><span className="lp-mono">Beneficiary</span><strong>Account •••• 9036</strong><span>Al Noor General Trading LLC</span><span>Hong Kong · Beneficiary entity</span></div>
            </div>
            <div className="lp-context">
              <span>12 related transfers</span><span>ALT-92841 · Velocity anomaly</span><span>AML-4821 · Linked case</span><span>Source-of-funds evidence</span>
            </div>
          </div>
        </div>
        <div className="lp-strip">
          <Eyebrow>Built for the work behind the alert</Eyebrow>
          <span>Banks</span><span>Fintechs</span><span>Compliance & investigation teams</span>
        </div>
      </section>

      <section className="lp-section" id="platform">
        <Eyebrow>The challenge isn't another alert.</Eyebrow>
        <h2>It's understanding what sits behind it.</h2>
        <p className="lp-lead dark">A payment record tells you what moved. An investigation needs to explain who is connected, why activity stands out and what evidence still needs review.</p>
        <div className="lp-three">
          {challenge.map(([n, t, b]) => <div key={n}><span className="lp-num">{n}</span><h3>{t}</h3><p>{b}</p></div>)}
        </div>
      </section>

      <section className="lp-section tint" id="graph">
        <Eyebrow>Follow the payment</Eyebrow>
        <h2>Not just a transaction. The network around it.</h2>
        <p className="lp-lead dark">Trace accounts, entities and linked activity. Inspect the selected record while keeping the relationships that matter in view.</p>
        <div className="lp-frame">
          <div className="lp-frame-bar"><span /><span /><span /><span className="lp-mono">Vigilia AML · Transaction graph explorer</span></div>
          <GraphLegend />
          <TransactionGraph selected={selected} onSelect={setSelected} />
        </div>
        <div className="lp-foot-row">
          <p>Solid arrows show the recorded payment path. Dashed lines show linked context, not additional payments. All records and operational values shown are example data.</p>
          <strong>Move from "what happened?" to "what is connected?"</strong>
        </div>
      </section>

      <section className="lp-section">
        <Eyebrow>One platform. Distinct jobs.</Eyebrow>
        <h2>Every record has a role. Every role stays connected.</h2>
        <p className="lp-lead dark">Purpose-built workspaces for the different questions your team needs to answer.</p>
        <div className="lp-jobs">
          {jobs.map((j) => (
            <div key={j.name} className="lp-job">
              <div><span className="lp-mono">{j.name}</span><h3>{j.head}</h3><p>{j.body}</p></div>
              <div className="lp-record"><div><strong>{j.rec}</strong><span>{j.meta}</span></div><span className={`lp-tag ${j.tone}`}>{j.tag}</span></div>
            </div>
          ))}
        </div>
        <p className="lp-small">Supported by Overview, Alert queue, Investigators, Reports, Rules & models and Audit log.</p>
      </section>

      <section className="lp-section dark">
        <Eyebrow>From signal to decision</Eyebrow>
        <h2>Keep the thread of the investigation.</h2>
        <p className="lp-lead">A connected sequence of work, not a collection of disconnected views.</p>
        <ol className="lp-flow">
          {flow.map(([n, t, b, path]) => <li key={n}><span className="lp-num">{n}</span><h3>{t}</h3><p>{b}</p><span className="lp-mono">{path}</span></li>)}
        </ol>
      </section>

      <section className="lp-section lp-split">
        <div>
          <Eyebrow>Risk with reasons</Eyebrow>
          <h2>A score is a starting point. Context is the substance.</h2>
          <p className="lp-lead dark">Put the triggering rule beside the activity, customer profile and jurisdiction exposure. Give investigators something to examine, not just a number to accept.</p>
          <ul className="lp-checks">
            {["Inspect the rule behind the alert", "Compare activity with the customer's baseline", "Separate risk signals from evidence still required"].map((c) => (
              <li key={c}><Check size={14} />{c}</li>
            ))}
          </ul>
        </div>
        <div className="lp-risk" role="figure" aria-label="Example risk card">
          <div className="lp-risk-head"><strong>Orion Trading FZE</strong><span className="lp-mono">Sample data</span></div>
          <div className="lp-score"><span>96</span><span>Risk score / 100</span><span className="pill red">Critical · Review required</span></div>
          <div className="track"><span style={{ width: "96%", background: "var(--critical)" }} /></div>
          <dl>{riskRows.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
          <p className="note warn">No direct sanctions match. Source-of-funds evidence requested; review is not complete.</p>
        </div>
      </section>

      <section className="lp-section tint" id="teams">
        <Eyebrow>Built around the work</Eyebrow>
        <h2>Different teams. A shared picture.</h2>
        <p className="lp-lead dark">For the people connecting financial activity to an informed review.</p>
        <div className="lp-three cards">
          {teams.map(([t, b, tags]) => (
            <div key={t}><h3>{t}</h3><p>{b}</p><div className="lp-tags">{tags.map((x) => <span key={x}>{x}</span>)}</div></div>
          ))}
        </div>
      </section>

      <section className="lp-section lp-split" id="contact">
        <div>
          <Eyebrow>Start with your operating reality</Eyebrow>
          <h2>A meaningful evaluation starts with your workflow.</h2>
          <p className="lp-lead dark">Let's discuss the records you review, the teams involved and the requirements that shape your rollout.</p>
          <a className="lp-btn primary" href="#contact">Talk to sales <ArrowUpRight size={14} /></a>
        </div>
        <ol className="lp-steps">
          {evaluation.map(([n, t, b]) => <li key={n}><span className="lp-num">{n}</span><div><h3>{t}</h3><p>{b}</p></div></li>)}
        </ol>
      </section>

      <section className="lp-section lp-split" id="faq">
        <div>
          <Eyebrow>A few things to know</Eyebrow>
          <h2>Clear answers. Before we talk.</h2>
          <p className="lp-lead dark">The product, the graph and what to expect from a conversation.</p>
          <a className="lp-btn outline" href="#contact">Talk to sales <ArrowUpRight size={14} /></a>
        </div>
        <div className="lp-faq">
          {faq.map(([q, a], i) => <details key={q} open={i === 0}><summary>{q}</summary><p>{a}</p></details>)}
        </div>
      </section>

      <section className="lp-section dark lp-final">
        <Eyebrow>See Vigilia AML in context</Eyebrow>
        <h2>Follow the money. Keep the whole story.</h2>
        <p className="lp-lead">Walk through a payment, explore its relationships and see how the evidence connects to a case decision.</p>
        <Demo />
        <p className="lp-small">A product conversation focused on your team's investigation workflow.</p>
      </section>

      <footer className="lp-footer">
        <div><Logo tone="inverse" /><p>Connected intelligence for financial-crime monitoring and investigation.</p></div>
        <div><span className="lp-mono">Platform</span><a href="#platform">Customers</a><a href="#platform">Transactions</a><a href="#platform">Investigations</a><a href="#platform">Cases</a></div>
        <div><span className="lp-mono">Explore</span><a href="#graph">Graph explorer</a><a href="#platform">Investigation workflow</a><a href="#teams">Who it's for</a><a href="#faq">FAQ</a></div>
        <div><span className="lp-mono">Let's talk</span><a href="#contact">Book a demo ↗</a><a href="#contact">Talk to sales ↗</a></div>
        <div className="lp-legal"><span>© 2026 Vigilia AML</span><span>Product visuals use example data. No customer outcomes are implied.</span></div>
      </footer>
    </div>
  );
}
