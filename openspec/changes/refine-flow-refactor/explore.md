# Explore — refine-flow-refactor

## Contexto

Refactor del flujo de la skill `refine` para simplificar la interacción agente ↔ tool. Referencia visual: [packages/docs/refine-flow.md](../../../packages/docs/refine-flow.md).

El cambio anterior `refine-gated-flow` fue descartado (ver `openspec/changes/archive/refine-gated-flow-DISCARDED-2026-04-21/`). Este cambio NO reintroduce fases ni preguntas `[Ax]/[Mx]`.

## Scope sintetizado

| # | Cambio | Estado actual | Estado deseado |
|---|--------|---------------|----------------|
| 1 | Path one-shot (sin `thread_id`) | prompt plano sin header | genera UUID + header meta + prompt; NO persiste |
| 2 | Body iterativo | incluye `### Input Requirements` | solo `### Previous Output` |
| 3 | Warning por hilo finalizado | banner no bloqueante | eliminado |
| 4 | `refine_save_iteration` sobre hilo cerrado | `throw Error` | reabre (`completed` → `in_progress`) y persiste |
| 5 | Valores de status | `'draft'` / `'final'` | `'in_progress'` / `'completed'` |
| 6 | Datos existentes | preservados | wipe total como parte de la migración |
| 7 | Derivados | — | tests, catálogo MCP, docs, CLI |

## A. Skill y tools

Archivo: [packages/tools/refine/src/index.ts](../../../packages/tools/refine/src/index.ts)

- Tools registradas en el switch (líneas 176+): `refine_requirements`, `check_definition_of_ready`, `generate_user_stories`, `identify_dependencies`, `refine_save_iteration`, `refine_list_iterations`, `refine_get_latest`, `refine_finalize`.
- **Path one-shot** (líneas 192-209): sin `thread_id` retorna prompt plano sin header. Contiene `### Input Requirements` en línea 197.
- **Path iterativo** (líneas 211-269): resuelve base, construye header, consulta `getThreadStatus`, emite warning si `'final'` (228-231), ensambla body incluyendo `### Input Requirements` (líneas 250-251).
- **Llamadas a storage** en `refine_requirements`: `getLatest(threadId)` (214), `getNextIteration(threadId)` (216), `getThreadStatus(threadId)` (228).
- **`refine_save_iteration`** (líneas 384-405): chequea `getThreadStatus === 'final'` y tira `throw new Error(...)` en línea 392-394.
- **`refine_finalize`** (líneas 419-423): retorna `{ thread_id, status: 'final' }` **hardcodeado como literal** — no lee de DB.

## B. Storage

- **Types** ([packages/storage/src/types.ts:163](../../../packages/storage/src/types.ts#L163)): `RefinementRow.status: 'draft' | 'final'`. `SaveRefinementInput` sin campo `status` (default del DDL).
- **Repo** ([packages/storage/src/repositories/refinements.ts](../../../packages/storage/src/repositories/refinements.ts)):
  - `stmtGetThreadStatus` (línea 32): `LIMIT 1` sin `ORDER BY` → no determinístico. ⚠️
  - `stmtFinalize` (línea 37): `UPDATE refinements SET status = 'final' WHERE thread_id = ?` (actualiza todas las filas).
  - `save` (53-71): NO valida status previo. El guard vive en la skill.
  - `finalize` (83-89): valida existencia vía `getLatest`; si no existe tira error. No idempotente estricto.
  - `getThreadStatus` (77-81): retorno tipado como `'draft' | 'final' | null`.
- **DDL** ([packages/storage/src/database.ts:133-146](../../../packages/storage/src/database.ts#L133-L146)): `status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','final'))`.
- **Patrón de migración** existente (líneas 190-194): único caso es `ALTER TABLE project_rules ADD COLUMN` con try/catch. **No hay versioning ni `schema_migrations` table**. SQLite no soporta `ALTER TABLE ... MODIFY COLUMN`, por lo que cambiar el CHECK constraint requiere recrear la tabla.

## C. CLI

[packages/cli/src/commands/refine.ts](../../../packages/cli/src/commands/refine.ts)

- Subcomandos existentes: `save`, `iterate`, `list`, `show`, `finalize`.
- Referencias a status hardcodeadas:
  - Línea 179: `row.status === 'final'` para colorizar verde/amarillo en `list`.
  - Línea 74: interpola `row.status` (solo imprime, no compara).
  - Línea 58: mensaje de error hardcodeado `'El hilo $1 ya está finalizado...'` en `save`.
- Línea 102-103: `iterate` genera `randomUUID()` **localmente** cuando no hay `thread_id` — lógica duplicada con la que el refactor quiere mover al tool.
- [packages/cli/src/index.ts:358-405](../../../packages/cli/src/index.ts#L358-L405): registra los 5 subcomandos.

## D. MCP catalog + docs

- [packages/core/src/jarvis-knowledge.ts](../../../packages/core/src/jarvis-knowledge.ts): catálogo generado dinámicamente desde `toolRegistry.getSkills()`. Las descripciones vienen del `tools[]` en la skill. Ninguna referencia hardcodeada a `'draft'/'final'`.
- [packages/docs/mcp-instructions.md:107-187](../../../packages/docs/mcp-instructions.md): sección de flujo iterativo. **Línea 179** afirma retrocompatibilidad del one-shot sin thread_id — el cambio 1 invalida esa afirmación.
- [packages/docs/refine-flow.md](../../../packages/docs/refine-flow.md): el diagrama YA usa `'in_progress'/'completed'` (líneas 42-52), la prosa descriptiva todavía habla de `'final'` (línea 90). Inconsistencia interna a corregir.
- [openspec/specs/refine/spec.md](../../../openspec/specs/refine/spec.md): spec base usa `'draft'/'final'` (líneas ~19, ~25, ~76, ~81). Queda desincronizado.

## E. Referencias cruzadas

- [packages/mcp/src/server.ts:36](../../../packages/mcp/src/server.ts#L36): registra `createRefineSkill(storage)` vía `toolRegistry`. Sin lógica especial.
- [packages/storage/src/index.ts:32](../../../packages/storage/src/index.ts#L32): re-exporta `RefinementRow`.

### Grep global de literales

| Archivo | Línea | Valor |
|---------|-------|-------|
| storage/types.ts | 163 | `'draft' \| 'final'` |
| storage/repositories/refinements.ts | 37 | `'final'` (SQL UPDATE) |
| storage/repositories/refinements.ts | 77,80 | `'draft' \| 'final'` (retorno tipado) |
| storage/database.ts | 141-142 | `DEFAULT 'draft'`, `CHECK(...)` |
| tools/refine/index.ts | 229, 392, 422 | `'final'` (comparaciones, retorno JSON) |
| cli/commands/refine.ts | 179 | `'final'` (colorización display) |

## Tests impactados

- **`packages/storage/src/__tests__/refinements.spec.ts`**: 6 tests. Líneas 26, 56, 65, 71 asertan `'draft'`/`'final'` → fallarán.
- **`packages/tools/refine/src/__tests__/refine-storage-tools.spec.ts`**:
  - Líneas 27, 155, 158, 174 asertan estados literales.
  - Líneas 64-75 (`throws error when saving to finalized thread`): fallará al cambiar semántica a "reabre" (cambio 4).
- **`packages/tools/refine/src/__tests__/refine-requirements.spec.ts`**:
  - Líneas 96-113 (`prompt includes warning in Spanish`): fallará al eliminar warning (cambio 3).
  - Tests del path one-shot (`returns prompt without HTML header`): fallarán al generar header siempre (cambio 1).

## Riesgos y gotchas detectados

1. **CHECK constraint destructivo en SQLite.** Cambiar el enum requiere recrear la tabla. El patrón try/catch actual no alcanza. Con wipe sin preservar (punto 6), la estrategia más simple es `DROP TABLE refinements; CREATE TABLE refinements ...` dentro del bloque de migraciones.

2. **`stmtGetThreadStatus` con `LIMIT 1` sin ORDER BY.** Bug latente: retorna la primera fila física, no la más reciente. Si en un refactor futuro queda una fila `in_progress` y otra `completed`, el status del thread es no determinístico. El cambio 4 (reabrir) lo agrava: `UPDATE ... SET status='in_progress' WHERE thread_id=?` sigue tocando todas las filas, pero el getter puede leer cualquiera. Conviene:
   - **(a)** Cambiar `stmtGetThreadStatus` a `ORDER BY iteration DESC LIMIT 1`.
   - **(b)** O confiar en que `finalize` y `reopen` siempre tocan toda la tabla del hilo (hoy ya pasa).
   - **(c)** O mover el status a otra tabla `refinement_threads` (cambio mayor, fuera de scope).

3. **`refine_finalize` retorna literal hardcodeado** (`'final'` en línea 422). Al renombrar debe actualizarse manualmente, no es solo un tipo.

4. **`refineList` CLI compara `'final'`** (línea 179) — hay que ajustar en el mismo cambio o se rompe el display.

5. **`mcp-instructions.md:179`** afirma "sin acceso a la base de datos" para el one-shot. El refactor rompe esa garantía documentada (aunque el UUID no requiere DB; solo header). Actualizar la redacción para decir "no persiste" en lugar de "sin acceso a DB".

6. **`openspec/specs/refine/spec.md`** desincroniza con el código tras el refactor. Conviene actualizar en este mismo cambio (la spec base, no la delta).

7. **Reabrir en el repo vs. skill.** Hoy el guard de status vive en la skill (`throw` desde `index.ts:392`). Si el refactor mueve "reabrir" a la skill, el repo sigue permitiendo insertar sin chequeo. Alternativa limpia: la lógica de "si está completed, flipear a in_progress antes de insertar" vive en el repo (`save` transacional) para que cualquier caller (tests, otros consumidores) herede la semántica. Decisión de diseño a cerrar en `design.md`.

8. **`refineIterate` en CLI duplica la generación de UUID** (línea 102-103). Una vez que el tool genera el UUID en el path one-shot, ese fallback en la CLI queda redundante. Se puede eliminar sin romper nada.

## Preguntas abiertas

Ninguna crítica — las 7 decisiones de scope están cerradas por el usuario. Para el design:

- **D1**: ¿Dónde vive la lógica de "reabrir"? Opciones (a) skill, (b) repo. Recomendación: repo — cualquier caller obtiene la semántica consistente (ver riesgo 7).
- **D2**: ¿`stmtGetThreadStatus` se corrige en este cambio? Recomendación: sí, con `ORDER BY iteration DESC LIMIT 1`. Es una línea y evita bug latente (riesgo 2).
- **D3**: ¿Spec base `openspec/specs/refine/spec.md` se actualiza dentro del cambio o aparte? Recomendación: dentro — evita desincronización del día 1.

## Hallazgos no obvios

- El diagrama Mermaid en `refine-flow.md` ya está **adelantado** respecto al código (usa estados nuevos). Esto **valida** el scope del refactor: el doc es la fuente de verdad del comportamiento deseado.
- El one-shot genera UUID también **resuelve** un problema secundario: hoy si el agente quiere iterar después de una llamada sin thread_id, tiene que inventar un UUID y pasar `requirements` + `previous_output` como si fuera primera iteración. Con el header, el agente captura el UUID directamente.
- Los 3 tools prompt-puros (`check_definition_of_ready`, `generate_user_stories`, `identify_dependencies`) no se tocan — confirmado fuera de scope.
- `refine_list_iterations` y `refine_get_latest` no requieren cambios; solo heredan el tipo nuevo de `RefinementRow`.
