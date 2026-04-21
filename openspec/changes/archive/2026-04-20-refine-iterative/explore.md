# Explore — refine-iterative

## 1. Current `refine_requirements` shape

File: [packages/tools/refine/src/index.ts](../../../packages/tools/refine/src/index.ts)

- Tool registered in `tools[]` (lines 1–24) with params `requirements` (required) and `project_id` (optional).
- `execute` handler (lines 89–111) builds a static markdown prompt, injecting reglas via `resolveRulesForTool(storage, projectId, 'refine_requirements', 'refinement')` from [packages/core/src/rule-injector.ts:1-32](../../../packages/core/src/rule-injector.ts).
- Return type of `execute`: `Promise<string>` — prompt puro, sin envelope.
- Skill factory: `createRefineSkill(storage: Storage): Skill` → `{ name: 'refine', description, tools, execute }`.

## 2. Tool registration & discovery

- **MCP** ([packages/mcp/src/server.ts](../../../packages/mcp/src/server.ts), líneas 34–38 y 105–121): `ToolRegistry` se registra, luego cada tool MCP se expone con `server.tool(name, desc, zodSchema, handler)`. `jarvis_run_tool` (línea 105) enruta a `toolRegistry.execute`. Tools con efectos colaterales (persistencia) deberían ir como `server.tool(...)` directos, no pasar por `jarvis_run_tool`.
- **CLI** ([packages/cli/src/commands/tool.ts](../../../packages/cli/src/commands/tool.ts)): `toolRun` lee schemas dinámicamente de `skill.tools[].input_schema`. Agregar tools al array las expone automáticamente en `jarvis tool list` y `jarvis tool run`.
- **CLI wiring** ([packages/cli/src/index.ts:182-226](../../../packages/cli/src/index.ts)): `tool run <name>` acepta `--input` JSON o `-p key=value`. Sin cambios necesarios. Para agregar `jarvis refine ...` como grupo dedicado, se sigue el patrón de `program.command('project')` (líneas 117–178).

## 3. Storage patterns

- **Inicialización** ([packages/storage/src/database.ts:19-132](../../../packages/storage/src/database.ts)): todas las tablas se crean con `CREATE TABLE IF NOT EXISTS` dentro de un `db.exec` en `initDatabase()`. No hay carpeta de migraciones — migraciones aditivas usan `ALTER TABLE` con `try/catch` (líneas 171–175).
- **Repositorio** ([packages/storage/src/repositories/rules.ts](../../../packages/storage/src/repositories/rules.ts)): factory `createXxxRepo(db)`, prepared statements al tope, API pública como objeto plano.
- **Tipo Storage** ([packages/storage/src/index.ts:46-86](../../../packages/storage/src/index.ts)): `Storage` interface lista cada repo como `ReturnType<typeof createXxxRepo>`. Para agregar `refinements`: (1) crear `packages/storage/src/repositories/refinements.ts`, (2) agregar `refinements: ReturnType<typeof createRefinementsRepo>` a `Storage`, (3) instanciar en `createStorage`.
- **Row types**: interfaces en [packages/storage/src/types.ts](../../../packages/storage/src/types.ts) (líneas 86–101 para `Message`). `string | null` para opcionales, `TEXT` con JSON serializado cuando hace falta.

## 4. CLI command pattern

[packages/cli/src/commands/project.ts](../../../packages/cli/src/commands/project.ts) exporta funciones async individuales (`projectCreate`, `projectList`, …). En [index.ts:117-178](../../../packages/cli/src/index.ts) se agrupan bajo `const proj = program.command('project')`. Cada handler hace `loadConfig()` + `bootstrap(config)` para obtener `storage`.

Para refine: nuevo archivo `packages/cli/src/commands/refine.ts` con `refineSave`, `refineIterate`, `refineList`, `refineShow`, `refineFinalize`, más bloque `const refine = program.command('refine')` en `index.ts`.

## 5. Knowledge sync coupling

[packages/core/src/jarvis-knowledge.ts:81-94](../../../packages/core/src/jarvis-knowledge.ts) (`getJarvisKnowledge`) itera `toolRegistry.getSkills()[].tools` y emite una línea de catálogo por tool. Agregar 4 tools cambia el hash del bloque — **obliga a correr `jarvis mcp sync`** después del deploy. `jarvis doctor` marca drift si no se ejecutó. Ya documentado en [packages/docs/mcp-instructions.md](../../../packages/docs/mcp-instructions.md).

## 6. Riesgos / preguntas abiertas (decidir en propose)

- **`thread_id`**: UUID (`crypto.randomUUID`) recomendado — hash de requirements colisiona si se refina el mismo texto dos veces.
- **Historial de `instructions`**: una fila por iteración (queryable, append-only) vs JSON array en una fila (acoplado). Recomendado: una fila por iteración.
- **`finalize`**: flag booleano `finalized` (INTEGER 0/1) es simple; `status` TEXT (`draft|final|…`) deja espacio a más estados. Decidir antes de escribir schema.
- **Precedencia de `previous_output`**: explicit → `getLatest(thread_id)` → none. `better-sqlite3` es sync, no hay problema.
- **Separación pura vs persistente**: `refine_save_iteration`, `refine_finalize` mutan estado. Opción A: agregar a `tools[]` de la skill y ramificar en `execute`. Opción B: registrarlas directamente como `server.tool()` en `mcp/src/server.ts` y mantener la skill pura. Recomendación: Opción A para que también aparezcan en `jarvis tool run` (consistencia CLI/MCP), aceptando que la skill deja de ser "solo prompts" y pasa a ser "orquestador del dominio refine".

## Envelope

- status: ok
- executive_summary: Skill refine es prompt-builder puro sin persistencia. Agregar iteración requiere (1) tabla `refinements` aditiva en `database.ts`, (2) nuevo repo en `storage/repositories/`, (3) 4 tools nuevas registradas en la skill (o en mcp/server.ts), (4) grupo CLI `jarvis refine` espejando el patrón de `project`. `CLAUDE.md` cambia hash → requiere `jarvis mcp sync` post-deploy.
- artifacts: openspec/changes/refine-iterative/explore.md
- next_recommended: proposal
- risks: thread_id strategy · instructions storage layout · finalize flag vs enum · puras vs con efectos · sync drift post-deploy
- skill_resolution: injected
