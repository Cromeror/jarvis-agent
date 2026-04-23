# Change: jira-toon-migration

## Why

`jira_analyze_ticket` duplicates `jira_get_ticket` with extra rule-analysis orchestration via n8n. The analysis layer has no active consumers and the TOON serializer lives buried inside `@jarvis/core`, making it hard to reuse from other tools. We want a single Jira-read tool that returns structured, token-efficient data.

## What changes

- Extract `toTOON` into a new standalone package `@jarvis/toon`.
- Delete `toTOON` from `@jarvis/core`.
- Rewrite `jira_get_ticket` handler to call `acli jira workitem view --json`, parse JSON, serialize via `@jarvis/toon`.
- Update MCP description of `jira_get_ticket` to advertise TOON output.
- Remove `jira_analyze_ticket` tool, `analyzeTicketViaN8n` handler, `jira-analyze-ticket.json` workflow, and now-orphan imports (`verifyN8n`, `ensureWorkflow`, `loadWorkflowJson`, `resolveRulesForTool` in this file).
- Update `~/.claude/CLAUDE.md` catalog.

## Out of scope

- Other tools migrating to `@jarvis/toon` (opportunistic, future work).
- Backwards compat: `jira_analyze_ticket` disappears in this PR.
