# Skill Registry — Jarvis-agent

Source of truth for user-level + project-level skills and conventions. Read by the orchestrator at session start; compact rules are injected into sub-agent prompts.

## Project Conventions (auto-loaded)

- [AGENTS.md](../AGENTS.md) — Nx guidelines (run tasks via `pnpm nx`, kebab-case, conventional commits)
- [CLAUDE.md](../CLAUDE.md) — mirrors AGENTS.md for Claude Code

## User Skills

| Skill | Trigger | Location |
|-------|---------|----------|
| branch-pr | Creating a pull request / opening a PR | ~/.claude/skills/branch-pr/ |
| go-testing | Writing Go tests, teatest, test coverage | ~/.claude/skills/go-testing/ |
| humanizer | Removing AI writing patterns from text | ~/.claude/skills/humanizer/ |
| issue-creation | Creating a GitHub issue / bug report / feature request | ~/.claude/skills/issue-creation/ |
| judgment-day | Adversarial dual review ("judgment day", "juzgar") | ~/.claude/skills/judgment-day/ |
| skill-creator | Creating new agent skills | ~/.claude/skills/skill-creator/ |

## Compact Rules (inject into sub-agent prompts)

### TypeScript / Nx monorepo (applies to any package under `packages/`)

- Run tasks via `pnpm nx <target> <project>`. Never call `tsc`, `vitest`, `eslint` directly.
- File names: kebab-case (e.g. `rule-injector.ts`).
- TypeScript strict mode is on — fix types, don't `any`.
- Imports: use package aliases (`@jarvis/storage`, `@jarvis/core`) across packages, relative within a package.
- Conventional commits: `feat|fix|chore|docs|refactor(scope): msg`.

### Storage layer (`packages/storage/`)

- All schema changes require a migration under `packages/storage/src/migrations/` (if that dir doesn't exist, add one and register it in the init flow).
- Use `better-sqlite3` prepared statements; never string-concat SQL.
- Export a repository class per table with typed methods, not raw query helpers.

### Tools (`packages/tools/*`)

- Each tool package exports a `createXxxSkill(storage)` factory returning `{ name, tools, execute }`.
- Tool outputs are prompt strings for the LLM caller unless explicitly otherwise (e.g. n8n-backed tools).
- Read project rules via `resolveRulesForTool` from `@jarvis/core`.

### MCP (`packages/mcp/`)

- Tool signatures exposed to MCP must match `input_schema` in the skill registration.
- After changing tool signatures or descriptions, user must run `jarvis mcp update` AND restart Claude Code sessions.

### CLI (`packages/cli/`)

- Commands registered in `packages/cli/src/index.ts`, implementations in `packages/cli/src/commands/*.ts`.
- Use `commander` options with short+long flags (`-p, --project`).
- User-facing strings: Spanish; code comments and identifiers: English.

### PR / Branch conventions

- Branches: `feat/`, `fix/`, `chore/`, `docs/`, `refactor/` prefix.
- PRs created via `gh pr create` with HEREDOC body.

## Notes

- No `.cursorrules`, `GEMINI.md`, or `copilot-instructions.md` present in this repo.
- Engram MCP not active in this project — openspec is the only SDD backend.
