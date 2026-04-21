# Propuesta — refine-iterative

## 1. Intent

Hoy `refine_requirements` es un prompt-builder puro: cada llamada arranca de cero y no deja rastro. Los usuarios refinan requerimientos en ciclos (LLM propone → humano corrige → LLM re-refina), y ese ciclo se pierde al cerrar la sesión. Este cambio agrega persistencia explícita por hilo (`thread_id`) para que el LLM pueda iterar con contexto previo, guardar el output de cada vuelta y finalizar un refinamiento cuando ya no haya más correcciones.

## 2. Scope

In-scope:
- Tabla `refinements` aditiva (una fila por iteración).
- Parámetros opcionales en `refine_requirements`: `thread_id`, `instructions`, `previous_output`.
- 4 tools nuevas en la skill `refine`: `refine_save_iteration`, `refine_list_iterations`, `refine_get_latest`, `refine_finalize`.
- Grupo CLI `jarvis refine` con subcomandos `save|iterate|list|show|finalize`.
- Descripción MCP de la skill actualizada con el flujo de uso (cuándo llamar cada tool).
- Retrocompatibilidad: llamar a `refine_requirements` sin `thread_id` se comporta como hoy.

Out-of-scope:
- Hilos multi-proyecto o hilos compartidos entre usuarios.
- Branching / forking de hilos más allá de la precedencia `previous_output` explícita.
- Locking colaborativo, merge de iteraciones paralelas.
- UI web o export a Jira directo desde refine (se cubre con `jira_add_comment` aparte).
- Embeddings / búsqueda semántica sobre iteraciones.

## 3. Approach

El tool `refine_requirements` sigue siendo puro: recibe `thread_id?`, `instructions?`, `previous_output?` y arma un prompt que prioriza `previous_output` explícito → último output del hilo (`getLatest(thread_id)`) → ninguno (iteración 1). **No persiste** — la llamada a `refine_save_iteration` es responsabilidad del caller tras validar el output. Las 4 nuevas tools viven en el mismo array `skill.tools[]` de `createRefineSkill` para que aparezcan tanto en `jarvis tool run` como en MCP `jarvis_run_tool`, con un `switch` en `execute` que ramifica por nombre.

Archivos a crear/modificar:
- `packages/storage/src/database.ts` — bloque `CREATE TABLE IF NOT EXISTS refinements`.
- `packages/storage/src/repositories/refinements.ts` — repo nuevo (`save`, `getLatest`, `listByThread`, `setStatus`).
- `packages/storage/src/types.ts` — `RefinementRow`.
- `packages/storage/src/index.ts` — wire en `Storage` + `createStorage`.
- `packages/tools/refine/src/index.ts` — extender `tools[]` y `execute`.
- `packages/mcp/src/server.ts` — sin cambios estructurales (pasan por `jarvis_run_tool`).
- `packages/cli/src/commands/refine.ts` + `packages/cli/src/index.ts` — grupo `refine`.
- `packages/core/src/jarvis-knowledge.ts` — se regenera solo; requiere `jarvis mcp sync` post-install.

## 4. Key decisions

| Decision | Choice | Rationale |
|---|---|---|
| Generación de `thread_id` | `crypto.randomUUID()` en el caller (CLI o LLM) | Hash del texto colisiona si se refina el mismo requerimiento dos veces; UUID es stdlib, sin dependencia nueva. |
| Historial de `instructions` | Una fila por iteración (append-only) | Queryable con `ORDER BY iteration`, audit-friendly, alineado con patrón `messages` existente. Evita mutar JSON serializado. |
| Semántica de `finalize` | Columna `status TEXT` (`'draft'\|'final'`) con `CHECK` | Deja espacio para `'archived'`, `'approved'` sin migración; cuesta lo mismo que `INTEGER 0/1` y es auto-documentado. |
| Pura vs side-effectful | Las 4 tools viven en `skill.tools[]` | Consistencia CLI/MCP: una sola superficie de descubrimiento (`jarvis tool list`). Aceptamos que la skill pasa de "prompt-only" a "orquestador del dominio refine"; el trade-off vale por DX. |
| Backward compat | Sin `thread_id` → comportamiento idéntico a hoy | No rompe integraciones existentes; la persistencia es opt-in. |

## 5. Affected packages

- `packages/storage` — tabla + repo + types.
- `packages/tools/refine` — 4 tools nuevas + params opcionales.
- `packages/mcp` — solo regenera catálogo, sin código nuevo.
- `packages/cli` — grupo `refine` nuevo.
- `packages/core` — `jarvis-knowledge.ts` cambia hash → sync obligatorio.
- `packages/docs` — `mcp-instructions.md`: agregar flujo iterativo.

## 6. Risks & rollback

- **Drift de CLAUDE.md post-deploy** → mitigado con `jarvis doctor` + doc existente.
- **Iteraciones huérfanas** (llamadas a `refine_requirements` sin `save` posterior) → comportamiento esperado, no bug; el caller decide persistir.
- **Crecimiento ilimitado de `refinements`** → aceptable a corto plazo; retención queda fuera de scope.

Rollback: schema es aditivo → `DROP TABLE refinements;` + `git revert` del feature branch. Sin data migration.

## 7. Non-goals

- No hay branching de hilos: solo precedencia `previous_output` explícita.
- No hay locking ni merge colaborativo.
- No hay cross-project threads.
- No hay búsqueda semántica ni embeddings.
