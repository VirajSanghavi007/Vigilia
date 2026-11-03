# Vigilia — Roadmap

Status tracking only. See [CLAUDE.md](../CLAUDE.md) for current implementation state and architecture rules.

1. Build a scalable graphical structure through Memgraph for visualization, with each transaction marked illicit / licit / unknown.
   - Hot/cold architecture: Memgraph (in-memory) holds the active/recent working set; a disk-backed store handles the cold tier.
   - **Cold-tier backend (Neo4j vs. Postgres-based graph schema) is not yet decided — needs a benchmarking pass before committing** (see step 9).
2. Cypher query the graph (manually / LLM query generation).
3. A connection endpoint to this graph, to test for scalability, through FastAPI.
4. Build a Postgres database (locally) to hold the durable source-of-truth event log — the graph is a derived/rebuildable view over this, not the source of truth itself (addresses Memgraph's in-memory durability model: snapshot + WAL alone isn't sufficient for AML audit/reconstruction requirements).
5. Test the ingestion pipeline from Postgres to the API endpoint.

--- We will work the initial pipeline with only labelled data for the following steps ---

6. Implement a baseline rule-based (non-ML) detector for illicit transactions.
   - Where Memgraph's MAGE library doesn't cover a needed algorithm (vs. Neo4j GDS), port/implement it — budget real time for this, not a drop-in replacement.
7. Baseline GCN.
8. Work through the unknown-labeled data via self-supervised learning.
9. Benchmark across several GNN workflows, alongside rule-based/non-ML methods.
   9.1) Scalability — includes validating the hot/cold tiering design (eviction policy, promotion path, cache coherence) under load, and deciding the cold-tier backend (Neo4j vs. Postgres-graph-schema) empirically rather than upfront.
   9.2) Efficiency.
   9.3) Cost of production.
10. Finalize a production ML model.
11. **Harden graph algorithms (rule-based detectors + any custom MAGE ports) against edge cases and heavy synthetic load** — generate a synthetic ~1B-node/edge dataset purely for benchmarking (not real data) and stress-test correctness and performance at that scale before considering anything production-ready.
12. **Solve Memgraph durability/reconstructability properly** — formalize the "Postgres event log is source of truth, Memgraph is a rebuildable derived view" pattern from step 4: define snapshot/WAL intervals, test crash recovery, and define how full graph state at an arbitrary past timestamp T is reconstructed for audit/regulatory purposes. Not yet solved — flagged as an open problem, not a decided design.
13. **Full-stack benchmark — one integration at a time, benchmarked before the next is added.** Explicit policy, not a suggestion: never bolt on a new component (Postgres event log, cache layer, a message queue, the GNN inference path) without first having a clean benchmark of the system *without* it. The point is bottleneck attribution — if everything gets built at once and something's slow, there's no way to tell which piece did it. Order: (a) Memgraph alone (steps 9/11 — in progress, see docs/BENCHMARK.md), (b) add Postgres (step 4's event log) and re-benchmark the combined write path, (c) add the hot/cold cache layer (step 1) and re-benchmark, (d) add a message queue only if direct API ingestion (step 3) turns out not to be enough — re-benchmark, (e) only then the GNN's classification accuracy/latency under the same realistic synthetic stream. Each stage's numbers land in docs/BENCHMARK.md before the next stage starts.
14. **Wire the dashboard frontend to real data.** Every page under `frontend/` currently renders design mock data (`frontend/src/data/*.ts`). The full backlog of backend, DB and model work it needs is in [Frontend integration backlog](#frontend-integration-backlog-step-14) below. Each piece still follows step 13's one-at-a-time benchmark policy.
15. TO BE CONTINUED

---

## Frontend integration backlog (step 14)

Inventory taken 2026-11-03 by going through every route in `frontend/src/App.tsx` and the mock data behind it. For each page: what the **API** must serve, what the **DB** (Postgres, step 4) must store, and what the **model** must produce. Items marked *(exists)* are already implemented; everything else is new.

What exists today: `/health`, `/v1/ingest/{transaction,edge}[/batch]` (writes to Memgraph), `/v1/graph/{schema,ask,query}` (graph explorer, NL to Cypher via Claude), the Elliptic loader (`scripts/load_elliptic_memgraph.py`) and `LocalRegistry`. No Postgres layer, no auth, no detector, no trained model.

### 14.0 Cross-cutting prerequisites (block almost every page)

1. **Data model gap: decide the domain dataset first.** The frontend speaks in bank terms (customers, accounts, counterparties, amounts in USD, corridors like AE → HK, channels like SWIFT wire / cash deposit, KYC status). Elliptic has none of that: anonymised Bitcoin transactions, 165 anonymised features, no amounts, no entities, no typology labels. Options, to be decided with a short comparison before any schema is written:
   - a synthetic bank-transaction dataset with accounts, amounts, payment formats and typology labels (e.g. IBM's AMLworld synthetic AML data, which labels fan-in / fan-out / cycle / scatter-gather / stack patterns), used as the product's working dataset while Elliptic stays the research benchmark;
   - or keep the product on Elliptic and cut the frontend down to what Elliptic can support (transaction graph, class, time step, score).
   **Decided 2026-11-03: neither.** Vigilia will generate its own realistic synthetic bank-transaction data (customers, accounts, counterparties, amounts, channels, corridors, KYC, with injected and labelled laundering typologies), rather than downloading AMLworld or staying on Elliptic. Elliptic stays the research benchmark for the GNN. The generator's design is the next piece of work.
   This choice changes the Postgres schema, the graph schema (`Transaction` only vs. `Customer`/`Account`/`Transaction`) and what the model can be trained to output (typology needs typology labels).
2. **Postgres layer (`infra/db/`)**, with `domain/` Protocols for every repository below. Migrations tool to be chosen (Alembic is the obvious candidate; it would be a new dependency in `pyproject.toml`). The event log from step 4 is the source of truth; the tables below are read models and workflow state built on top of it.
3. **Authentication and RBAC (`domain/auth/`, `api/deps`).** The UI assumes SSO (SAML 2.0) with MFA, a signed-in user (name, role, level, user ID), per-role permissions ("Granted" vs "Restricted" on the profile page) and service accounts with scopes (`customer:export` in the audit log). Needs: `users`, `roles`, `permissions`, `role_permissions`, `user_roles`, `service_accounts` + scopes, `sessions` (device, IP, started/last active, revocable). Every endpoint below enforces a permission. Start with local login for development; SSO/SAML when there is an IdP to integrate with.
4. **Audit trail on every write.** Every state change (assign, escalate, note, evidence request, SAR approve/submit, rule/model change, settings save, access denied) writes an append-only `audit_events` row with actor, role, action, record, before/after, reason, request ID, session ID, source (web app / API gateway), IP, result (Success / Denied) and a digest. The UI shows a per-event digest marked "Verified" and "7 years · Immutable storage", so the design needs tamper evidence (hash chain over events or a signed manifest per export) and a retention policy. Ties into step 12 (reconstruction at time T).
5. **Workspace scope filters as API parameters.** The header filters (date range, business unit, jurisdiction, typology, minimum score) are currently applied client-side by `lib/scope.ts`. Every list and aggregate endpoint takes the same filter set, so server-side counts match the page.
6. **List conventions.** Server-side pagination, sorting and tab counts (`tabCounts` on every list page), free-text search (the header search box; global search is currently unwired), and **Export** (8 pages have an Export button; exports are permission-checked and audited, and the audit page expects "CSV + signed manifest").
7. **Time.** All timestamps stored and returned in UTC; the UI's "SLA overdue · 32m", "6h remaining", "8 min ago" are computed from `due_at` / `detected_at`, not stored strings. The mock data is frozen at Sep 28, 2026 (`TODAY` in `lib/scope.ts`); that goes away.
8. **"Last refreshed" indicator.** Every page header shows "refreshed N min ago". Decide polling vs. push (SSE/WebSocket) for the queue and notifications.

### 14.1 Overview dashboard (`/overview`, `getDashboard()` in `data/mock.ts`)

- **API:** `GET /v1/dashboard?{scope}` returning the `Dashboard` shape in `data/types.ts` (the type comment already says the API schema should match it).
- **DB / aggregates:** KPIs (transaction volume, flagged count, high-risk alerts, open cases, false-positive rate) with period-over-period deltas; risk trend series; volume by hour; alerts by severity; alerts by typology with coverage; jurisdiction hotspots and elevated-jurisdiction count; recent activity feed (from `audit_events`); top alerts. Likely materialised views or a periodic aggregation job rather than live scans of the transaction log.
- **Model:** the risk score behind "flagged" / "high-risk"; false-positive rate needs analyst dispositions (see 14.2 feedback loop), so it cannot be computed from the model alone.
- **Reference data:** `jurisdiction_risk` list (which countries are "elevated-risk"), versioned.

### 14.2 Alert queue (`/alerts`) and alert detail (`/alerts/:id`)

- **API:** `GET /v1/alerts?{scope,status,assignee,severity,sla}` (tabs: all open, my alerts, unassigned, SLA breached, closed); `GET /v1/alerts/{id}`; actions `POST /v1/alerts/{id}/assign`, `/escalate`, `/notes`, `/request-evidence`, `/link-case`, `/close` (with disposition); "Review next alert" = `GET /v1/alerts/next` for the current user. Queue stats: closed count, new today, median triage time and its delta, oldest SLA breach.
- **DB:** `alerts` (id, entity/customer, severity, typology, triggering rule or model version, amount, tx count, score, status `New / In review / Pending info / Escalated / Closed`, assignee, detected_at, sla_due_at, disposition, closed_at), `alert_transactions` (which transactions make up the alert), `alert_events` (status history, for triage time), `notes`. SLA policy per severity in settings.
- **Model:**
  - **Alert score (0-100)** per alert: calibrated, versioned, recorded with the model version that produced it (registry version ID stored on the alert).
  - **Typology** label per alert ("Rapid movement of funds", "Layering / circular flows", "Structuring / smurfing", ...). Needs either typology labels in the training data (14.0.1) or rule-derived typology; must not be invented by the model without labels.
  - **Narrative** ("moved $482,750 through 12 transactions in 38 minutes, 6.4× its 30-day baseline across 3 elevated-risk jurisdictions"): generate from computed facts (burst window, total, baseline multiplier, jurisdictions), optionally phrased by an LLM, but every number must come from the data, not the LLM. Store the facts alongside the text.
  - **Explanation** of why the model scored it: per-alert attributions (e.g. GNNExplainer / feature attribution over the subgraph), shown next to the narrative.
  - **Customer risk** and **linked alerts / open cases** counts on the alert (entity-level aggregation, 14.5).
  - **Analyst disposition as feedback:** true positive / false positive on close. This is the label source for false-positive rate, rule FPR, precision trends (14.9) and future retraining. Define the label schema early; it is research-critical.
- **Detector:** alerts are produced by step 6 (rules) and step 10 (model). Need an alert generation job: score new transactions, apply thresholds, dedupe/merge into existing open alerts for the same entity and window.

### 14.3 Cases (`/cases`) and case detail (`/cases/:id`)

- **API:** `GET /v1/cases?{scope,status,investigator,priority}` (tabs: all open, my cases, unassigned, overdue, pending approval, closed); `GET /v1/cases/{id}` with linked alerts, reports, audit events and evidence; `POST /v1/cases` (open from alerts), `/assign`, `/status`, `/notes`, `/evidence-requests`, `/close`. Stats: closed count, opened this week, oldest overdue, activity feed, investigator workload.
- **DB:** `cases` (id, customer, type and sub-type, priority, status `New / In progress / Pending info / Pending approval / Escalated / Closed`, investigator, opened_at, due_at), `case_alerts`, `case_notes`, `evidence_requests` (what, from whom, requested_at, fulfilled_at), `evidence_files` (metadata in Postgres, bytes in `infra/storage/`, local filesystem until there is a bucket, same rule as the registry).
- **Model:** none directly; case priority can default from the max alert score, but priority is an analyst decision.

### 14.4 Transactions (`/transactions`)

- **API:** `GET /v1/transactions?{scope,status,direction,channel,min_score}` (tabs: all, flagged, high risk, on hold, cleared) and `GET /v1/transactions/{id}` with the investigation detail (narrative, originating / beneficiary account, triggered rule, linked alert and case, payment reference, next step, sanctions screening result). Actions: hold / release / clear.
- **DB:** the event log's transactions with customer, counterparty, corridor (origin and destination country), amount and currency, channel, direction, timestamp, payment reference; `transaction_status` (Flagged / In review / On hold / Cleared) as workflow state, not a mutation of the event log. Population is ~1.84M in the mock, so list queries need indexes and keyset pagination.
- **Model:** per-transaction score (the node-level output of the GNN; Elliptic's task is exactly this). Batch scoring for the backlog plus online scoring on ingest (`/v1/ingest` path).
- **Screening:** sanctions screening of counterparties ("no direct match"). Needs watchlist data (`watchlists`, `watchlist_entries`, refresh job) and a screening service. Out of scope for the ML core; flag as a dependency.

### 14.5 Customers (`/customers`) and customer reviews (`/customers/reviews`)

- **API:** `GET /v1/customers?{scope,risk,kyc}` (tabs: all, high risk, review due, evidence pending), `GET /v1/customers/{id}`, risk distribution, review priorities (overdue / due today / due this week), activity feed; `GET /v1/customers/reviews` for the review page.
- **DB:** `customers` (id, name, type Individual / Corporate / MSB, country, business unit, owner), `accounts`, `kyc_reviews` (status `EDD required / In review / Documents due / Verified / Review due`, last review, next due date, reviewer), review cadence by risk tier.
- **Model:** **customer (entity-level) risk score**, distinct from transaction score. Options: aggregate of transaction/alert scores, or a node classifier on the customer/account graph. Requires the entity-level graph from 14.0.1.

### 14.6 Graph explorer (`/graph`)

- *(exists)* `GET /v1/graph/schema`, `POST /v1/graph/ask` (NL to Cypher), `POST /v1/graph/query` (read-only Cypher) over the Elliptic `Transaction` graph.
- **Still needed for the Figma design** (`data/graph.ts` mock): entity/account/alert/case/evidence node kinds, typed edges (payment vs. context vs. risk), linked-activity summary (total value, transfer count, burst duration, baseline multiplier, jurisdictions), investigation notes. Means: `GET /v1/graph/neighbourhood/{entity_or_tx_id}?hops=N` returning a bounded subgraph, plus joining Postgres workflow records (alerts, cases, evidence) onto graph nodes. Requires the richer graph schema from 14.0.1.
- **Model:** per-node scores and class on the canvas; the explanation subgraph from 14.2 should be viewable here.
- **Security:** `/query` takes raw Cypher; it must stay read-only and permission-gated once auth exists, and be audited.

### 14.7 Investigators (`/investigators`) and assignment policy (`/investigators/assignment-policy`)

- **API:** `GET /v1/investigators` (team with open cases, alerts, capacity %, notes), `GET /v1/assignments?{tab}` (needs attention / all / completed), stage counts, `POST /v1/assignments/{id}/assign`, "Manage availability" (`PUT /v1/investigators/{id}/availability`), activity feed.
- **DB:** `teams`, investigator level (L1 / L2 / senior) and specialism (corporate, cross-border, retail), `availability`, capacity definition (what 88% means: weighted open work vs. a target), `assignment_policy` (versioned rules: critical goes to L2+, specialist match, nobody above 90% capacity, overdue escalates to team lead).
- **Model:** none. The "Suggested" assignee is a deterministic routing function in `domain/` implementing the policy, with its reason ("Capacity available", "Cross-border specialist"). Keep it rule-based and explainable.

### 14.8 Reports: SAR / CTR (`/reports`, `/reports/:id`, `/reports/schedules`)

- **API:** `GET /v1/reports?{status,type}` (tabs: all, draft, in review, approved, filed), `GET /v1/reports/{id}`, `POST /v1/reports` (draft from a case), `/submit-for-review`, `/approve` (four-eyes: approver must differ from preparer), `/submit`, receipt/acknowledgement ingestion; overview and performance stats (filed this month, on-time filing rate, median preparation / approval time, accepted / awaiting / rejected); `GET/POST /v1/report-schedules`.
- **DB:** `reports` (id, type SAR/CTR, subject, case ref, status `Draft / In review / Approved / Submitted / Accepted`, preparer, reviewer, deadline, receipt ID), `report_versions` (narrative history), `report_attachments`, `report_schedules` (cadence, format PDF/XLSX/CSV, owner, next run) and a scheduler to run them.
- **Model / LLM:** optional SAR narrative drafting from case facts. Same rule as 14.2: grounded in stored facts only, human-approved, version recorded.
- **External:** regulator filing gateway integration (FinCEN BSA E-Filing or the relevant FIU) is a separate later project; until then "Submit" is a recorded manual step.

### 14.9 Rules & models (`/rules`, `/rules/:id`, `/rules/model`)

- **API:** `GET /v1/rules` (tabs: rules, models, change requests, validation), `GET /v1/rules/{id}` (version, logic, latest match, recent alerts), change requests (`POST /v1/rule-changes`, approve / reject), overview (active rules, rules in shadow, screening coverage, FPR, model health, pending changes, active model); `GET /v1/models` and `GET /v1/models/{version}`.
- **DB:** `rules` and `rule_versions` (parameters such as "12+ transfers / 60 min, ≥5× baseline", status Active / Testing (shadow), owner team), `rule_change_requests` with approvals, per-rule daily alert counts and FPR (from dispositions).
- **Model:**
  - Model version, stage and metrics come from the **registry** (`metadata.json` of the version in the `production` stage), not from Postgres and never hardcoded. The UI already notes the current figures are illustrative.
  - **Precision / recall** on a defined evaluation set, plus a **28-day precision trend**: production precision needs dispositions (14.2); define it explicitly (alert-level precision on closed alerts) so it is not confused with offline test-set precision.
  - **PSI / drift monitoring** on input features and score distribution against the training reference, computed by a scheduled job and stored per day.
  - **Shadow mode** for rules and candidate models (score in parallel, raise no alerts, compare), and a **champion/challenger promotion flow** with an approval record ("v4.8.3 candidate model review"). Promotion = moving the registry stage pointer, audited.
  - **Validation history** tab: per-version validation report stored with the version in the registry.
  - Rule FPR deltas and "share of alerts" per rule need alert-to-rule attribution on every alert.

### 14.10 Audit log (`/audit`, `/audit/:id`)

- **API:** `GET /v1/audit?{actor,action,result,record,from,to}` with search, `GET /v1/audit/{id}` (narrative, request ID, session, authentication method, authorization policy, digest verification), distribution by category, recent denied actions, retention info, signed export.
- **DB:** `audit_events` from 14.0.4; ~18.6k events in the mock, growing fast in production, so partition by month. Denied-access events must be written by the auth layer, not by the endpoints.

### 14.11 Settings (`/settings`), configuration policy, support

- **API:** `GET/PUT /v1/workspace/settings` (name, compliance contact, time zone, currency, notification toggles: critical escalation, deadline reminders, daily digest), `GET /v1/workspace` (ID, region, last saved by / at, policy revision, active model version).
- **DB:** `workspace_settings` with versioning (policy revision "POL-2026.09 · Revision 12"); every save audited before it takes effect (the page says so).
- Support page is static text from settings; no new backend beyond the settings record.

### 14.12 Profile (`/profile`) and access request (`/profile/access`)

- **API:** `GET/PUT /v1/me` (display name, language, time zone, case emails, digest), `GET /v1/me/sessions` + `DELETE /v1/me/sessions/{id}` ("Revoke", "Sign out other sessions"), `GET /v1/me/permissions` (granted vs. restricted), access review dates; access request flow (`POST /v1/access-requests`, admin approval, audited) or keep the current "email the compliance contact" text.
- **DB:** user preferences, sessions, `access_reviews`, `access_requests`.

### 14.13 Notifications (`/notifications` and the header bell)

- Currently derived client-side (`buildNotifications` in `lib/records.ts`) from breached SLAs, overdue cases and denied access.
- **API:** `GET /v1/notifications` (unread count for the bell), `POST /v1/notifications/{id}/read`.
- **DB:** `notifications` (user, kind, record, created_at, read_at), produced by an SLA watcher job and by workflow events; delivery by email (case emails / digest toggles) needs a mail integration later.

### 14.14 Typologies, risk map, risk trend (`/typologies`, `/risk-map`, `/risk-trend`)

- **API:** `GET /v1/analytics/typologies?{scope}` (alerts per typology, share, detecting rules), `GET /v1/analytics/risk-by-jurisdiction?{scope}`, `GET /v1/analytics/risk-trend?{scope}` (series plus summary: peak day, first-to-last change).
- **DB:** same aggregates as 14.1; jurisdiction requires country on customers/counterparties (14.0.1).
- **Model:** typology per alert (14.2) is the input; without typology labels this page can only show rule-derived typologies.

### 14.15 Suggested order (to respect step 13)

1. Decide 14.0.1 (dataset / domain model). Nothing else can be designed properly before this.
2. Postgres + migrations + event log (step 4 / 13b), then read-only list endpoints for transactions and customers.
3. Auth + audit trail (14.0.3 / 14.0.4), before any write endpoint exists, so no write is ever unaudited.
4. Rule-based detector (step 6) producing real alerts, then the alert queue and case workflow (14.2, 14.3) with dispositions.
5. Baseline model (steps 7-10) scoring transactions; registry-backed model page (14.9); drift monitoring.
6. Dashboard / analytics aggregates (14.1, 14.14), investigators and routing (14.7), reports (14.8), notifications (14.13), settings / profile (14.11, 14.12).
7. Graph explorer enrichment (14.6) once the entity-level graph exists.
Each step gets its benchmark entry in `docs/BENCHMARK.md` before the next is added.
