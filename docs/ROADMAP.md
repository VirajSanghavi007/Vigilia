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
13. TO BE CONTINUED
