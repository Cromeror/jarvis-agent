# Proposal — refine-flow-refactor

## 1. Intent

Simplificar el flujo de la skill `refine` para que la interacción agente ↔ tool sea más consistente y menos ambigua. El refactor:

- Da al agente un `thread_id` + header meta desde la **primera** llamada (incluso sin iteración persistida), para que decidir "iterar" después sea trivial.
- Elimina la duplicidad semántica del body iterativo (hoy tiene `Previous Output` **y** `Input Requirements` compitiendo como fuente), dejando `Previous Output` como única fuente sobre la que el LLM aplica correcciones.
- Elimina el `throw` en `refine_save_iteration` sobre hilo cerrado: persistir una iteración nueva **reabre** el hilo automáticamente. No hay tool `refine_reopen` dedicada.
- Renombra los estados (`'draft' | 'final'` → `'in_progress' | 'completed'`) para que reflejen el estado del hilo desde la perspectiva del usuario (no el estado de escritura SQL).
- Elimina el warning por hilo finalizado en `refine_requirements` — con el nuevo comportamiento de "reabrir en save", el warning deja de tener sentido.

No introduce fases, parser de preguntas, ni clasificación de ambigüedad. Es un refactor de superficie + renombres + simplificación semántica del cierre del hilo.

## 2. Scope

### In-scope

1. **Path one-shot** (`refine_requirements` sin `thread_id`): generar UUID, construir header meta (`thread_id`, `iteration: 1`), devolver `header + prompt`. **No persistir**. El thread_id es una "promesa de hilo" hasta que haya `save`.

2. **Path iterativo** (`refine_requirements` con `thread_id`): eliminar la sección `### Input Requirements` del body. Queda `### Previous Output` como única fuente. En la primera iteración con thread_id, el agente debe pasar `previous_output` explícito (el output del one-shot); de ahí en adelante se recupera de storage.

3. **Eliminar el warning por hilo finalizado** en `refine_requirements` (banner `⚠️ Advertencia: el hilo ... está finalizado`).

4. **`refine_save_iteration` sobre hilo cerrado**: en lugar de `throw`, reabre el hilo (`completed` → `in_progress`) y persiste la nueva iteración. La lógica de reapertura vive en el **repo** (transaccional), no en la skill, para que sea consistente para cualquier caller.

5. **Renombrar valores de status** en todos los consumidores:
   - `RefinementRow.status` → `'in_progress' | 'completed'`.
   - DDL/CHECK constraint de la tabla `refinements`.
   - Repo (statements, retornos tipados).
   - Tools (`refine_save_iteration`, `refine_finalize`).
   - CLI (comparaciones, colorización).

6. **Wipe de datos existentes**: la migración borra cualquier fila existente de `refinements` (SQLite no permite `ALTER` del CHECK constraint; se recrea la tabla).

7. **Derivados**:
   - Corregir `stmtGetThreadStatus` para usar `ORDER BY iteration DESC LIMIT 1` (bug latente detectado en explore).
   - Tests actualizados con nuevos valores + nuevo comportamiento de reapertura.
   - Catálogo MCP refleja nuevas descripciones (generado dinámicamente).
   - Docs: `mcp-instructions.md`, `refine-flow.md` (consistencia interna), `openspec/specs/refine/spec.md` (spec base).
   - CLI: eliminar generación duplicada de UUID en `iterate` (ahora la tool lo provee).

### Out-of-scope

1. Fases `discovery`/`refinement` con preguntas `[Ax]/[Mx]` — descartado con `refine-gated-flow`.
2. Persistir el `requirements` crudo original en DB. La persistencia arranca desde la **primera iteración con thread_id** (i.e., `refine_save_iteration`), no desde el one-shot. El "contexto inicial" no se guarda.
3. Límite de reaperturas o historial de cambios de status. Un hilo se puede reabrir N veces sin contador ni log.
4. Tool dedicada `refine_reopen`. La reapertura es un efecto secundario implícito de `refine_save_iteration`.
5. Preservar datos existentes. Wipe total.
6. Tocar tools prompt-puros (`check_definition_of_ready`, `generate_user_stories`, `identify_dependencies`). Se mantienen intactos.
7. Migrar a una tabla separada `refinement_threads` para aislar el status del thread del status por iteración. Evaluado y descartado como cambio mayor.

## 3. Approach

### Flujo deseado (resumen)

**Llamada 1** (sin `thread_id`):
1. La tool genera `thread_id` UUID.
2. Construye header meta `<!-- refine:meta thread_id: <uuid> iteration: 1 -->`.
3. Arma el prompt one-shot (igual que hoy, con `Input Requirements` + `Refinement Instructions` SMART+AC — este path no representa una iteración del hilo, es un refinamiento "desechable" con promesa de thread_id).
4. Retorna `header + prompt` al LLM cliente vía MCP.
5. **No persiste nada**.

**Llamada N≥1** (con `thread_id`):
1. Resolver `base`: `previous_output` explícito o `storage.refinements.getLatest(threadId)?.output`. En la primera iteración con thread_id, el agente DEBE pasar `previous_output` (el output que produjo el one-shot).
2. Calcular `iteration = getNextIteration(threadId)`.
3. Construir header meta.
4. Ensamblar body: `Previous Output` (obligatorio si hay base) + `Correction Instructions` (opcional) + `rulesSection` (opcional) + `Refinement Instructions` (SMART+AC).
5. **Sin warning** por status final.
6. Retornar `header + body`.

**`refine_save_iteration`** (agente persiste):
1. Entrar en transacción.
2. Si `getThreadStatus(threadId) === 'completed'`, actualizar todas las filas del hilo a `'in_progress'` (reapertura silenciosa).
3. Insertar nueva fila con `status='in_progress'`.
4. Commit.
5. Retornar `RefinementRow`.

**`refine_finalize`**:
1. Verificar existencia del hilo.
2. `UPDATE refinements SET status='completed' WHERE thread_id=?`.
3. Retornar `{ thread_id, status: 'completed' }` (leído de DB, no hardcodeado).

### Archivos afectados

- `packages/storage/src/types.ts` — tipos de status.
- `packages/storage/src/repositories/refinements.ts` — statements, `save` transacción con reapertura, `getThreadStatus` con `ORDER BY`.
- `packages/storage/src/database.ts` — DDL + migración (recrear tabla con CHECK nuevo).
- `packages/storage/src/__tests__/refinements.spec.ts` — nuevos valores + test de reapertura.
- `packages/tools/refine/src/index.ts` — path one-shot genera UUID+header; body iterativo sin `Input Requirements`; eliminar warning; `refine_save_iteration` sin throw; `refine_finalize` lee de DB.
- `packages/tools/refine/src/__tests__/*.spec.ts` — actualizar asserts.
- `packages/cli/src/commands/refine.ts` — colorización, eliminar UUID local en `iterate`.
- `packages/docs/mcp-instructions.md` — redacción del one-shot.
- `packages/docs/refine-flow.md` — prosa consistente con diagrama.
- `openspec/specs/refine/spec.md` — spec base actualizada.

## 4. Key decisions

| Decisión | Elección | Racional |
|----------|----------|----------|
| Dónde vive la lógica de reapertura | En el repo `save()` (transacción) | Consistencia para cualquier caller; evita duplicar el guard. |
| Fix de `stmtGetThreadStatus` | `ORDER BY iteration DESC LIMIT 1` | Bug latente detectado en explore; una línea que evita no-determinismo. |
| Status del hilo vs. por iteración | Status vive en cada fila (como hoy) | Mover a tabla separada es cambio mayor; `UPDATE ... WHERE thread_id=?` ya actualiza todas las filas del hilo. |
| Path one-shot genera UUID | Siempre | Le da al agente un thread_id listo para iterar sin re-llamar con parámetros adicionales. |
| One-shot persiste | No | El usuario lo definió: "contexto inicial no se guarda". |
| Wipe de datos | Incluido en la migración | SQLite no permite `ALTER` del CHECK; wipe es simple y el usuario confirmó sin datos a preservar. |
| Renombre `draft`/`final` | `in_progress`/`completed` | Refleja estado del hilo desde perspectiva del usuario, no del SQL. |
| Warning en `refine_requirements` | Eliminado | Con reapertura implícita en save, el warning no tiene sentido. |
| Actualizar `openspec/specs/refine/spec.md` | Dentro de este cambio | Evita desincronización día 1. |

## 5. Affected packages

- `packages/storage` — tipos, DDL, repo, tests.
- `packages/tools/refine` — tool principal + tests.
- `packages/cli` — comando refine (pequeños ajustes).
- `packages/docs` — `mcp-instructions.md`, `refine-flow.md`.
- `packages/core` — catálogo regenerado automáticamente (sin cambios manuales).
- `openspec/specs/refine` — spec base actualizada.

Post-deploy requiere `jarvis mcp sync` para propagar el catálogo.

## 6. Risks & rollback

### Riesgos

1. **Wipe destructivo**: si algún entorno tiene datos de refine no documentados, se pierden. Mitigación: el usuario confirmó que no hay datos a preservar; el refactor documenta explícitamente el wipe.
2. **Breaking change para callers que asumen `throw` en save sobre hilo cerrado**: la CLI muestra un mensaje de error en `save` que asume el throw. Mitigación: actualizar CLI en el mismo cambio.
3. **Break de `mcp-instructions.md`**: afirma "sin acceso a DB" para el one-shot. Mitigación: actualizar redacción en el mismo cambio.
4. **Agent que leía `status: 'final'` del JSON de `refine_finalize`**: cambio de string literal. Mitigación: el valor nuevo es documentable y se actualiza la spec base.

### Rollback

- `git revert` de la rama. SQLite recrea la tabla con el schema viejo. Se pierden las filas creadas post-migración (aceptable para dev).
- Si hay datos en producción post-refactor que se necesitan preservar, se hace dump antes del revert.

## 7. Non-goals

- No introducir fases, preguntas, o parser estructurado.
- No clasificar preguntas por tipo.
- No auto-responder desde integraciones externas.
- No agregar contador de reaperturas ni tabla de historial.
- No cambiar el comportamiento de los 3 tools prompt-puros (`check_definition_of_ready`, `generate_user_stories`, `identify_dependencies`).
- No mover el status a una tabla separada.
