# Vigilia — Project Charter & Working Rules

## What this project is

Vigilia is a **research-grade, production-target AML (anti-money-laundering) graph ML system**. Priority order for every decision:

1. **AI/ML correctness and rigor first** — the model, features, graph construction, and evaluation methodology are the core deliverable and must hold up to research and production scrutiny (not a toy/demo model).
2. **Production-quality engineering second** — backend, frontend, infra, and other stacks exist to serve the AI/ML core reliably. They matter, but they are not the point of the project.
3. Everything else (docs, tooling, polish) comes after both.

This is **not** a quick prototype and **not** a portfolio throwaway. Treat it as if it will run in production on real data, be audited, and be extended by other researchers/engineers later.

## Known state of the codebase (as of this writing — verify before relying on it)

The owner has flagged this codebase as currently rough, from a place of self-critique, not as a permanent excuse:

- FastAPI is used without async or dependency injection where it should be.
- The model referred to as "multignn" is reportedly just a PNAConv, not an actual multi-relational/heterogeneous GNN — naming and implementation don't match.
- Hardcoded values exist that break on machines other than the owner's.
- Standard AML-project features/capabilities are likely missing.

Do not assume these are fixed. Confirm current state by reading the relevant code before making claims about it.

## Hard rule: no unreviewed code changes

**Every code change must be verified by the user before or as part of being made.** Concretely:

- Do not make substantive code edits unprompted or "while you're at it." Propose the change, explain it, and get confirmation, unless the user has explicitly pre-approved that specific change in the current conversation.
- **Every code change must come with an explanation of *why* it's being made** (the problem it fixes, the tradeoff it makes, or the requirement it satisfies) — not just a description of what changed. No silent/unexplained diffs.
- Exception: documentation changes and read-only lookups/exploration do **not** require this — those can be done freely without prior confirmation.

## Practical implications for future sessions

- When asked to fix or build something, state the plan and reasoning first if it's non-trivial; don't just start editing.
- Don't paper over the known issues above with quick patches unless asked — flag them and let the user decide priority (model correctness issues in particular should never be silently "fixed" without discussion, since they may change results).
- When editing, call out explicitly which known issue (if any) a change addresses, or state that it's unrelated and why it's needed.
