# Synthetic bank-transaction data: design (draft for review)

Status: **design agreed (section 8), not implemented.** Decided 2026-11-03 (ROADMAP step 14.0.1): Vigilia generates its own realistic synthetic bank data instead of using AMLworld or building the product on Elliptic. Elliptic stays the research benchmark for the GNN.

Not to be confused with `scripts/generate_synthetic_stream.py`, which samples Elliptic's anonymous 165-feature space to load-test ingestion. That stays as is; it has no customers, amounts or typologies.

## 1. What "good" means here

The data is only useful if a model trained on it learns laundering behaviour, not generator artefacts. So the bar is:

1. **Coherent world, not independent rows.** Every transaction is made by a simulated customer with a profile, so amounts, channels, counterparties and timing are consistent with who that customer is.
2. **Laundering hidden inside normal behaviour.** Launderers are ordinary customers most of the time; the illicit activity is injected into the same world and graph, not generated as a separate population.
3. **No shortcut features.** Nothing the model can see may separate illicit from licit by itself unless real laundering also shows it: round amounts, a channel, a country, an account age, an ID range, a time-of-day pattern. Checked automatically (section 6).
4. **Hard negatives.** Legitimate activity that looks suspicious on purpose: payroll and merchant fan-in, treasury sweeps between a company's own accounts (cycles), seasonal businesses with bursts, remittance-heavy customers on high-risk corridors, cash-intensive small businesses.
5. **Realistic label situation.** Elliptic-like: most transactions unlabelled; labels come from "investigated" cases, with configurable label noise and delay, so the self-supervised work in step 8 stays meaningful.
6. **Every parameter documented.** Each distribution parameter has a comment citing where it came from (public payment statistics, regulatory thresholds, typology guidance such as FATF / FinCEN advisories) or saying plainly that it is an assumption.
7. **Reproducible.** Same config + seed gives the same dataset, byte for byte, regardless of worker count.

## 2. The world

A US-based bank (USD reporting currency, FinCEN thresholds: CTR at $10,000 cash, so structuring sits just under it) with international corridors. That matches the frontend (SAR/CTR, USD, SWIFT corridors).

| Entity | Key attributes |
|---|---|
| Customer | type (Individual / Corporate / MSB), country, business unit (Retail / Corporate / Payments & remittance), industry (corporates), income or turnover band, onboarding date, KYC status and review dates, risk tier |
| Account | owner customer, type (checking / savings / business / correspondent), opened date, currency, home bank (ours vs. external) |
| Counterparty | external accounts at other banks, with country; customers' suppliers, employers, landlords, family abroad |
| Transaction | id, timestamp (UTC), from account, to account, amount, currency, channel (card, ACH, wire domestic, SWIFT, cash deposit, cash withdrawal, check, internal transfer), payment reference, corridor |

The graph (for Memgraph and the GNN) is `(:Customer)-[:OWNS]->(:Account)-[:TX {id, ts, amount, channel, ...}]->(:Account)`, a directed multigraph. The Elliptic-style transaction-as-node view is derived from it (section 8, decision 2).

## 3. Normal behaviour

Agent-based, one behaviour profile per customer segment, simulated day by day:

- **Individuals:** salary in (monthly / biweekly), rent or mortgage, utilities, card spend (many small, lognormal), occasional transfers to family (some cross-border remittances), cash withdrawals, rare large purchases.
- **Corporates:** supplier and client networks with heavy-tailed degree (a few hubs, many small firms), invoices with net-30/60 timing, payroll fan-out, tax payments, intra-group transfers, seasonality by industry.
- **MSBs:** high-volume remittance in and out on specific corridors, cash-heavy.
- **Time:** daily and weekly cycles, payday spikes, month and quarter ends, holidays; behaviour drifts slowly over months (income growth, new counterparties, churn) so there is real temporal drift.
- **Amounts:** per segment and per transaction purpose, lognormal or mixture distributions, with realistic rounding habits for *both* licit and illicit (people pay rent in round numbers too).

## 4. Injected typologies (each labelled with typology and pattern-instance id)

Matching the frontend's typology list:

| Typology | Mechanism |
|---|---|
| Structuring / smurfing | repeated cash deposits under $10k, across days and branches, possibly several people into one account |
| Rapid movement of funds (pass-through) | money in, out within hours, little balance retained |
| Layering / circular flows | multi-hop chains and cycles across accounts and jurisdictions, back to origin |
| Fan-in / fan-out (money mules) | many accounts funnel into one, or one spreads to many, then consolidate |
| High-risk jurisdiction | flows routed through elevated-risk corridors without business rationale |
| Dormant account activity | 180+ days quiet, then sudden large outflows |
| Unusual cash activity | cash volume inconsistent with the customer's profile |
| Trade-based laundering | invoice payments whose amounts don't match the supplier relationship's history |
| Unusual remittance activity | new corridors or beneficiary concentration for an MSB or individual |
| Sanctions proximity | payments to counterparties linked to a (synthetic) watchlist entity |

Each pattern has randomised size, duration, hop count, amount split and camouflage (how much normal activity the launderers keep doing). Overall illicit rate configurable (default 0.1% of transactions, section 8).

## 5. Outputs

- **Parquet shards** (customers, accounts, counterparties, transactions, labels, pattern instances), append-only per chunk so a killed run resumes (global rule: checkpoint/resume, progress + ETA).
- **Loaders:** Postgres event log (step 4) and Memgraph (extending the existing loader pattern).
- **Ground truth kept separate** from what the model and the app see: the full pattern labels for evaluation; a partial, noisy "investigated" label set for training.
- **Sizes:** `dev` (~10k customers, seconds), `medium` (~1M customers), and a streaming mode for the ~1B-edge benchmark in step 11.

## 6. Validation (part of the deliverable, not an afterthought)

1. **Leakage check:** train simple baselines (per-transaction tabular model, single-feature models) on the generated data. Any single raw attribute giving near-perfect separation, or a tabular baseline near AUC 1.0, fails the build. The point is that graph structure should matter, as in real AML.
2. **Distribution report:** amounts, degree distribution, inter-arrival times, channel mix, cross-border share, per segment, rendered to a report, compared against the cited public statistics.
3. **Typology fidelity:** each injected pattern instance is recoverable by its defining rule (e.g. structuring instances really are sub-threshold cash) and the rule-based detector (step 6) finds a plausible but imperfect share of them.
4. **Determinism:** two runs with the same seed and different worker counts produce identical files.

## 7. Where the code goes (proposal)

- `src/vigilia/ml/synthetic/`: world config, entity generation, behaviour profiles, typology injectors, writers. In `ml/` because it produces training and evaluation data; no framework imports, so it is testable in isolation.
- `scripts/generate_bank_data.py`: thin CLI (size preset, seed, output dir, workers).
- New dependency: **pyarrow** for Parquet (pandas is already a dependency; pyarrow would be added to `pyproject.toml` + `uv.lock`).
- Parallelism: customers are partitioned into shards generated by a `Pool` with per-shard seeds derived from the master seed; cross-shard flows (counterparties, laundering rings spanning shards) are planned first, in the main process, so shards stay independent.

## 8. Decisions (agreed 2026-11-03)

1. **Jurisdiction: US bank** with international corridors. USD, FinCEN SAR/CTR, $10,000 CTR cash threshold.
2. **Graph shape: transactions are edges** in a directed account multigraph (the canonical form). An Elliptic-style transaction-as-node view is *derived* from it (line-graph style: transaction A links to transaction B when A's receiving account later sends B), so the existing GNN code still runs on this data.
3. **Labels:** default illicit rate **0.1% of transactions** (configurable; also to be tested at 0.05% and 0.5%). Two label views:
   - **ground truth**: every transaction's true class, typology and pattern-instance id; evaluation only, never a training input;
   - **investigated labels**: ~20-25% of transactions labelled, chosen with an alert-driven bias (customers that a simple rule would flag are far more likely to be investigated), only part of the illicit patterns discovered, and 2-5% label noise. Training uses only this view.
4. **Milestone 1:** `dev` size (~10k customers), individuals + corporates, 4 typologies (structuring, rapid pass-through, layering / cycles, fan-in / fan-out), Parquet output, leakage check and distribution report, plus unit / smoke / integration tests. MSBs, the other 6 typologies, Postgres / Memgraph loaders and the large-scale streaming mode come after milestone 1's leakage check passes.
5. **Leakage gate (agreed 2026-11-04), "stricter":** the build fails if any single raw attribute reaches out-of-fold AUC above **0.70**, or a per-transaction tabular gradient-boosted model with no graph features reaches AUC above **0.85**. Illicit rows are grouped by pattern across folds, so a model cannot memorise one pattern's amounts and score them again.
6. **Simulated span (agreed 2026-11-04): 24 months**, starting 2024-01-01: two full years for seasonality, drift and a temporal train / validation / test split.
7. **pyarrow (agreed 2026-11-04)** goes in core dependencies, since Parquet output is part of the data contract, not an optional extra.
