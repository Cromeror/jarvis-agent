# Tasks — refine-flow-refactor

## Fase 1 — Storage: tipos, repo, DDL, migración

- [x] **1.1** Actualizar `RefinementRow.status` en [packages/storage/src/types.ts](../../../packages/storage/src/types.ts)
  - [x] 1.1.1 Cambiar `status: 'draft' | 'final'` por `status: 'in_progress' | 'completed'` (línea 163).

- [x] **1.2** Refactor de [packages/storage/src/repositories/refinements.ts](../../../packages/storage/src/repositories/refinements.ts)
  - [x] 1.2.1 Cambiar `stmtGetThreadStatus` a `SELECT status FROM refinements WHERE thread_id = ? ORDER BY iteration DESC LIMIT 1`.
  - [x] 1.2.2 Actualizar `getThreadStatus` retorno tipado a `'in_progress' | 'completed' | null`.
  - [x] 1.2.3 Cambiar `stmtFinalize` de `SET status = 'final'` a `SET status = 'completed'`.
  - [x] 1.2.4 Agregar nuevo statement `stmtReopenThread`: `UPDATE refinements SET status = 'in_progress' WHERE thread_id = ?`.
  - [x] 1.2.5 Modificar `save()` dentro de su transacción: si `getThreadStatus(thread_id) === 'completed'`, ejecutar `stmtReopenThread` antes del insert.
  - [x] 1.2.6 Verificar que `save()` sigue retornando el `RefinementRow` recién insertado.

- [x] **1.3** Actualizar DDL en [packages/storage/src/database.ts](../../../packages/storage/src/database.ts)
  - [x] 1.3.1 Cambiar `status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','final'))` por `status TEXT NOT NULL DEFAULT 'in_progress' CHECK(status IN ('in_progress','completed'))` (líneas 141-142).
  - [x] 1.3.2 En el bloque de migraciones (dentro del try/catch existente), agregar detección:
    ```typescript
    try {
      const tableSchema = db
        .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='refinements'")
        .get() as { sql?: string } | undefined;
      if (tableSchema?.sql?.includes("'draft'")) {
        db.exec('DROP TABLE refinements');
      }
    } catch {}
    ```
  - [x] 1.3.3 Verificar que el `CREATE TABLE IF NOT EXISTS` posterior recrea con el DDL nuevo.

- [x] **1.4** Tests de storage
  - [x] 1.4.1 Actualizar [packages/storage/src/__tests__/refinements.spec.ts](../../../packages/storage/src/__tests__/refinements.spec.ts) líneas 26, 56, 65, 71: reemplazar `'draft'` por `'in_progress'` y `'final'` por `'completed'`.
  - [x] 1.4.2 Agregar test: `save()` sobre hilo con status `'completed'` reabre todas las filas a `'in_progress'` y persiste la nueva iter como `'in_progress'`.
  - [x] 1.4.3 Agregar test: `save()` sobre hilo `'in_progress'` no toca el status existente.
  - [x] 1.4.4 Agregar test: `getThreadStatus` retorna el status de la iteración con mayor `iteration` number.
  - [x] 1.4.5 Verificar test existente de `finalize` usa `'completed'`.

**CHECKPOINT 1:** `pnpm nx test @jarvis/storage` pasa en verde.

---

## Fase 2 — Skill refine: prompt + save sin throw + finalize sin literal

- [x] **2.1** Refactor de [packages/tools/refine/src/index.ts](../../../packages/tools/refine/src/index.ts) — path one-shot
  - [x] 2.1.1 En el branch `if (!threadId)` (líneas 192-209), generar UUID con `crypto.randomUUID()`.
  - [x] 2.1.2 Construir header:
    ```typescript
    const header = ['<!-- refine:meta', `thread_id: ${newThreadId}`, 'iteration: 1', '-->'].join('\n');
    ```
  - [x] 2.1.3 Retornar `${header}\n\n${promptActual}` (body con `### Input Requirements` y `### Refinement Instructions` como está hoy, sin cambios al cuerpo one-shot).
  - [x] 2.1.4 NO llamar a storage en este path.

- [x] **2.2** Refactor de `index.ts` — path iterativo
  - [x] 2.2.1 Eliminar las líneas que pushean `### Input Requirements` (líneas 250-252) del body iterativo.
  - [x] 2.2.2 Eliminar `warningSection` (líneas 228-231) y su uso en la línea del return (línea 269). El return queda `${header}\n\n${body}`.
  - [x] 2.2.3 Eliminar `has_base` del header (solo quedan `thread_id` e `iteration`).
  - [x] 2.2.4 Verificar que las secciones `### Previous Output` (condicional a `base !== null`) y `### Correction Instructions` (condicional a `instrs`) siguen funcionando.

- [x] **2.3** Refactor de `refine_save_iteration` (líneas 384-405)
  - [x] 2.3.1 Eliminar el `if (storage.refinements.getThreadStatus(threadId) === 'final') throw ...` (líneas 392-394).
  - [x] 2.3.2 Dejar solo `storage.refinements.save(...)` que ahora maneja reapertura internamente.

- [x] **2.4** Refactor de `refine_finalize` (líneas 419-423)
  - [x] 2.4.1 Después de `storage.refinements.finalize(threadId)`, leer el status real: `const status = storage.refinements.getLatest(threadId)?.status ?? 'completed';`.
  - [x] 2.4.2 Retornar `JSON.stringify({ thread_id: threadId, status })` (no literal).

- [x] **2.5** Tests de tools/refine
  - [x] 2.5.1 Actualizar [packages/tools/refine/src/__tests__/refine-storage-tools.spec.ts](../../../packages/tools/refine/src/__tests__/refine-storage-tools.spec.ts) líneas 27, 155, 158, 174: nuevos valores.
  - [x] 2.5.2 Eliminar (o refactorizar) el test "throws error when trying to save to a finalized thread" (líneas 64-75): ahora debe verificar que `save` sobre hilo `'completed'` reabre y persiste sin error.
  - [x] 2.5.3 Actualizar [packages/tools/refine/src/__tests__/refine-requirements.spec.ts](../../../packages/tools/refine/src/__tests__/refine-requirements.spec.ts):
    - Eliminar test "prompt includes warning in Spanish" (líneas 96-113) — warning ya no existe.
    - Actualizar test "without thread_id: returns prompt without HTML header" para verificar que AHORA sí incluye header con UUID + `iteration: 1`.
    - Agregar test: one-shot contiene header con UUID válido (regex para UUIDv4).
    - Agregar test: one-shot NO crea fila en `refinements` (verificar `listByThread` antes/después).
    - Agregar test: path iterativo NO contiene `### Input Requirements`.
    - Agregar test: path iterativo sobre hilo `completed` NO contiene `⚠️ Advertencia`.
    - Agregar test: `refine_finalize` retorna `status: 'completed'`.

**CHECKPOINT 2:** `pnpm nx test @jarvis/tools-refine` pasa en verde.

---

## Fase 3 — CLI

- [x] **3.1** Actualizar colorización en [packages/cli/src/commands/refine.ts](../../../packages/cli/src/commands/refine.ts)
  - [x] 3.1.1 Cambiar `row.status === 'final'` por `row.status === 'completed'` (línea 179).

- [x] **3.2** Actualizar mensaje de error en `refineSave`
  - [x] 3.2.1 Eliminar el mapeo del error "el hilo está finalizado" (línea 58) — ya no se produce. Si el tool retorna exitosamente, la CLI simplemente muestra la fila guardada.

- [x] **3.3** Simplificar `refineIterate`
  - [x] 3.3.1 Eliminar la generación local de UUID en líneas 102-103.
  - [x] 3.3.2 Si no hay `--thread`, llamar al tool SIN `thread_id`; extraer el UUID del header de la respuesta con regex `/<!-- refine:meta\s*\n\s*thread_id:\s*(\S+)/`.
  - [x] 3.3.3 Imprimir el UUID extraído para que el usuario pueda copiarlo.
  - [x] 3.3.4 Si hay `--thread`, pasar a la tool tal cual (comportamiento actual).

- [x] **3.4** Build CLI
  - [x] 3.4.1 `pnpm nx build @jarvis/cli` sin errores TypeScript.
  - [x] 3.4.2 Si existe suite de tests de CLI: `pnpm nx test @jarvis/cli` verde.

**CHECKPOINT 3:** CLI compila y tests (si existen) pasan.

---

## Fase 4 — Docs y spec base

- [x] **4.1** Actualizar [packages/docs/mcp-instructions.md](../../../packages/docs/mcp-instructions.md)
  - [x] 4.1.1 Revisar sección de flujo iterativo (líneas 107-187).
  - [x] 4.1.2 Corregir la afirmación del one-shot: reemplazar "sin acceso a la base de datos" por "sin persistencia (el tool genera un thread_id en el header para que el agente pueda iterar después)".
  - [x] 4.1.3 Documentar el flujo de reapertura implícita en `refine_save_iteration`.
  - [x] 4.1.4 Actualizar terminología de estados (`draft`/`final` → `in_progress`/`completed`) en cualquier referencia.

- [x] **4.2** Corregir inconsistencia en [packages/docs/refine-flow.md](../../../packages/docs/refine-flow.md)
  - [x] 4.2.1 Actualizar la prosa "Paso a paso" (línea ~90) que todavía menciona `'final'` → usar `'completed'`.
  - [x] 4.2.2 Verificar que el paso a paso descriptivo sea coherente con el diagrama Mermaid.

- [x] **4.3** Actualizar spec base [openspec/specs/refine/spec.md](../../../openspec/specs/refine/spec.md)
  - [x] 4.3.1 Cambiar `status = 'draft'` por `status = 'in_progress'` (línea ~19).
  - [x] 4.3.2 Cambiar `status = 'final'` por `status = 'completed'` (líneas ~25, ~76, ~81).
  - [x] 4.3.3 Actualizar requisito de "throw on save to finalized" por "reopen on save to completed".
  - [x] 4.3.4 Documentar que one-shot genera thread_id en header.
  - [x] 4.3.5 Eliminar referencias al warning por hilo finalizado.

- [x] **4.4** Sync del catálogo MCP
  - [x] 4.4.1 Intentado `jarvis mcp sync --dry-run` — CLI no disponible en entorno actual (comando no encontrado). Ver nota en reporte: sync debe ejecutarse manualmente cuando CLI esté disponible (post-deploy).
  - [x] 4.4.2 Sync deferred: requiere CLI en path.
  - [x] 4.4.3 Deferred: user ejecutará `jarvis mcp sync` post-deploy según instrucciones en mcp-instructions.md.

---

## Fase 5 — Verify E2E

- [x] **5.1** Ejecutar los 12 escenarios del spec (S1-S12) contra DB temporal
  - [x] 5.1.1 S1: primera llamada sin thread_id retorna header con UUID + body con `### Input Requirements`; NO persiste.
  - [x] 5.1.2 S2: agente recupera thread_id del header y llama con `previous_output` → body con `### Previous Output`, sin `### Input Requirements`.
  - [x] 5.1.3 S3: primer `refine_save_iteration` inserta fila con `iteration=1`, `status='in_progress'`.
  - [x] 5.1.4 S4: segunda iteración sin `previous_output` explícito recupera `base` de DB.
  - [x] 5.1.5 S5: `refine_finalize` marca todas las filas como `completed`; retorna `{ thread_id, status: 'completed' }`.
  - [x] 5.1.6 S6: `refine_save_iteration` sobre hilo `completed` reabre todo (iter 1,2 → `in_progress`) e inserta iter 3 `in_progress` en una sola transacción.
  - [x] 5.1.7 S7: `refine_requirements` sobre hilo `completed` NO contiene warning.
  - [x] 5.1.8 S8: `getThreadStatus` con secuencia in_progress → finalize → reopen retorna `'in_progress'`.
  - [ ] 5.1.9 S9: migración con wipe borra datos viejos correctamente. **GAP — sin test unitario de migración.**
  - [ ] 5.1.10 S10: CLI `iterate` sin `--thread` imprime UUID extraído del header. **GAP — sin tests de CLI.**
  - [x] 5.1.11 S11: `refine_list_iterations` devuelve filas con `status: 'in_progress'`.
  - [ ] 5.1.12 S12: verificar que `mcp-instructions.md` refleja nueva realidad del one-shot. **GAP — `mcp-instructions.md` línea 158 y `refine-flow.md` línea 29 aún referencian `has_base` que fue eliminado en Fase 2.**

- [x] **5.2** Regression tests — paquetes afectados
  - [x] 5.2.1 `pnpm nx test @jarvis/storage` suite completa verde. (9/9)
  - [x] 5.2.2 `pnpm nx test @jarvis/tools-refine` suite completa verde. (24/24)
  - [x] 5.2.3 `pnpm nx build @jarvis/cli` build limpio.
  - [x] 5.2.4 `pnpm nx build @jarvis/mcp` build limpio.
  - [x] 5.2.5 `pnpm nx build @jarvis/core` build limpio (tipo `RefinementRow` re-exportado).

- [x] **5.3** Smoke test de flujo completo end-to-end
  - [x] 5.3.1 Ejecutar manualmente la secuencia del diagrama: `refine_requirements` (sin thread) → capturar UUID → `refine_requirements` (con thread + previous_output) → `refine_save_iteration` → `refine_requirements` (iter 2) → `refine_save_iteration` → `refine_finalize` → `refine_save_iteration` (reabre) → `refine_finalize`.
  - [x] 5.3.2 Verificar en cada paso que el estado de la DB es el esperado.

**CHECKPOINT 4:** Todos los tests en verde. S1-S12 pasan. Builds limpios en storage, tools-refine, cli, mcp, core. Smoke test OK.

---

## Fase 6 — Cleanup y PR

- [ ] **6.1** Revisar diff completo: no hay literales `'draft'` ni `'final'` restantes en producción (sí pueden quedar en archive/).
- [ ] **6.2** Revisar que `refine-flow.md` queda 100% consistente con el código final.
- [ ] **6.3** Crear PR siguiendo la skill `branch-pr` (issue-first enforcement).
- [ ] **6.4** Verify: orchestrator lanza `sdd-verify` sobre `refine-flow-refactor` para validar implementación vs. spec.
- [ ] **6.5** Archive: una vez mergeado, orchestrator lanza `sdd-archive` para consolidar deltas en spec base y mover a `openspec/changes/archive/`.
