---
description: Generate a changelog entry from recent git history and prepend it to CHANGELOG.md
argument-hint: [time range, e.g. "since last week" | "since v1.2" | "last 20 commits"]
---

Generate a new CHANGELOG.md entry for the commit range described in: $ARGUMENTS

## Determine the range

- If an argument was given, interpret it as a git range/date expression (e.g. "since last week" → `--since="1 week ago"`, "since v1.2" → `v1.2..HEAD`, "last 20 commits" → `-20`).
- If no argument was given, default to commits made since CHANGELOG.md was last modified (find the last commit that touched CHANGELOG.md via `git log -1 --format=%H -- CHANGELOG.md`, then use `<that-sha>..HEAD`). If CHANGELOG.md doesn't exist yet or has no history, fall back to the last 20 commits.

## Gather history

Run `git log` for the resolved range with enough detail to summarize accurately (e.g. `--no-merges --stat` or `--oneline --stat`, your judgment based on volume). Exclude merge commits entirely.

## Filter and summarize

- Skip trivial commits: typo fixes, formatting-only changes, whitespace, comment-only edits, dependency lockfile bumps with no behavior change.
- Group everything else under these headings (omit any heading with nothing in it):
  - **Features**
  - **Fixes**
  - **Refactors**
  - **Other**
- Write each entry for a reader who was not watching the work happen — describe what changed and why it matters (user-visible or system-level impact), not a restatement of the commit message. Do not just copy commit subject lines.

## Write the entry

- Prepend a new dated section (use today's date) to the top of CHANGELOG.md, above all existing content. Do not remove, rewrite, or reorder any existing entries.
- If CHANGELOG.md doesn't exist, create it with a top-level `# Changelog` heading followed by the new section.

## Before committing anything

Show the full diff of CHANGELOG.md (old vs. new) in chat and stop. Do not run `git add` or `git commit` unless the user explicitly confirms after reviewing the diff.
