---
description: Derive and explain the current system architecture from the actual code, for a non-technical stakeholder
---

Produce a fresh architecture explanation of this repository, derived directly from the current code and folder structure — do not rely on README, HISTORY, CLAUDE.md, or any other existing docs as a source of truth (they may be stale or wrong). Explore the actual file/folder structure and entry points yourself.

## Output structure

1. **Plain-English summary** — one paragraph, no jargon, describing what the system does and who/what it's for.
2. **Major components** — a list of the significant files/folders, each with its single-sentence responsibility. Group by layer (e.g. frontend, backend/API, model, data/storage) if that fits the repo's shape.
3. **End-to-end flow** — walk through how a request or piece of data moves through the system from entry point to result, in terms of data flow between components, not line-by-line implementation detail.
4. **Notable/non-obvious quirks** — anything structurally unusual, inconsistent, misleadingly named, or that would surprise someone reading the code cold (e.g. a component named one thing that actually does another). Be honest here even if unflattering.

## Output destination

Print the full explanation directly in the chat response. Do **not** write it to `docs/ARCHITECTURE.md` or any other file unless the user explicitly asks you to save it in this same conversation.
