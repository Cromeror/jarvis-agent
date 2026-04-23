# Tasks

- [x] 1. Create `packages/toon/` with `package.json`, `tsconfig.json`, `tsconfig.lib.json`, `src/index.ts`
- [x] 2. Copy `toTOON` from `packages/core/src/toon.ts` into `packages/toon/src/index.ts`
- [x] 3. Delete `packages/core/src/toon.ts` and remove the re-export from `packages/core/src/index.ts`
- [x] 4. Add `@jarvis/toon` as dependency of `@jarvis/tools-jira`
- [x] 5. Rewrite `jira_get_ticket` handler in `packages/tools/jira/src/index.ts`:
  - run `acli jira workitem view <id> --json`
  - `JSON.parse` and serialize via `toTOON`
  - update MCP `description` to advertise TOON
- [x] 6. Remove `jira_analyze_ticket` tool entry + `case` + `analyzeTicketViaN8n` helper
- [x] 7. Remove orphan imports: `verifyN8n`, `ensureWorkflow`, `resolveRulesForTool`, `loadWorkflowJson`, `readFileSync`, path helpers
- [x] 8. Delete `packages/tools/jira/workflows/jira-analyze-ticket.json`
- [x] 9. Update skill description (remove "analyze")
- [x] 10. Update `~/.claude/CLAUDE.md` jira catalog block
- [x] 11. `pnpm install` and `pnpm nx run-many -t build` to verify
