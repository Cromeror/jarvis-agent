# Default contexts for Jarvis

This directory contains **default context** that Jarvis installs automatically into projects on setup and whenever a matching integration is enabled.

## How it works

- `manifest.json` declares what to install and when.
- `knowledge/*.md` contains the content of each knowledge entry.
- `rules/*.md` (future) will contain rule sets.

Each entry has an `applyTo` selector:

| Selector | Applies to |
|----------|-----------|
| `"all"` | every project |
| `"integration:<service>"` | only projects with that integration configured (e.g. `integration:jira`) |
| `"project:<id>"` | a specific project only |

## Triggering

Defaults are applied in three situations:

1. **`jarvis setup`** — runs once per machine; applies all defaults whose selectors match current projects.
2. **`jarvis defaults apply [--project <id>] [--force]`** — manual re-application. Run this after `git pull` if the manifest changed, or to backfill a project.
3. **`jarvis integration set <project> <service> ...`** — auto-triggers `defaults apply --project <project>` at the end so the new integration gets its context immediately.

Defaults are **idempotent by `(project_id, slug)`** — running apply twice is safe. Use `--force` to overwrite content that drifted from the seed.

## Adding a new default

1. Write the content in `knowledge/<slug>.md` (or `rules/<slug>.md`).
2. Add an entry to `manifest.json`:
   ```json
   {
     "slug": "<slug>",
     "file": "knowledge/<slug>.md",
     "title": "<Human-readable title>",
     "tags": ["<tag1>", "..."],
     "applyTo": "integration:<service>"
   }
   ```
3. Commit. Users pull → run `jarvis defaults apply` → get the new context.
