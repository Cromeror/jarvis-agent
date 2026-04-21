# Tasks — refine-iterative

## Fase 1 — Schema & storage

- [x] 1.1 Agregar bloque `CREATE TABLE IF NOT EXISTS refinements` + 3 índices al final de `initDatabase()` en `packages/storage/src/database.ts` (copiar SQL exacto del design §2)
- [x] 1.2 Agregar `RefinementRow` e `SaveRefinementInput` a `packages/storage/src/types.ts` (interfaces del design §3)
- [x] 1.3 Crear `packages/storage/src/repositories/refinements.ts` con `createRefinementsRepo(db)` que expone: `save`, `getLatest`, `listByThread`, `getThreadStatus`, `finalize`, `getNextIteration`
  - [x] 1.3.1 `getNextIteration(threadId)` — `SELECT MAX(iteration)+1 FROM refinements WHERE thread_id=?`, retorna 1 si NULL
  - [x] 1.3.2 `save(input)` — `db.transaction` que llama `getNextIteration` + `getLatest` (para `parent_id`) e inserta con prepared statement; retorna `RefinementRow`
  - [x] 1.3.3 `getLatest(threadId)` — `SELECT … ORDER BY iteration DESC LIMIT 1`; retorna `RefinementRow | null`
  - [x] 1.3.4 `listByThread(threadId)` — `SELECT … ORDER BY iteration ASC`; retorna `RefinementRow[]`
  - [x] 1.3.5 `getThreadStatus(threadId)` — `SELECT status FROM refinements WHERE thread_id=? LIMIT 1`; retorna `'draft' | 'final' | null`
  - [x] 1.3.6 `finalize(threadId)` — lanzar error controlado si no existen filas; `UPDATE refinements SET status='final' WHERE thread_id=?` (idempotente)
- [x] 1.4 Exportar `createRefinementsRepo` desde `packages/storage/src/repositories/index.ts` (o crear si no existe)
- [x] 1.5 Agregar `refinements: ReturnType<typeof createRefinementsRepo>` a la interfaz `Storage` en `packages/storage/src/index.ts`
- [x] 1.6 Instanciar `createRefinementsRepo(db)` dentro de `createStorage()` y asignarlo al campo `refinements`
- [x] 1.7 Escribir tests unitarios en `packages/storage/src/__tests__/refinements.spec.ts`
  - [x] 1.7.1 `save` inserta iteration=1 en hilo nuevo
  - [x] 1.7.2 `save` inserta iteration=MAX+1 en hilo existente (monotónico)
  - [x] 1.7.3 `finalize` marca todas las filas del thread; idempotente en doble llamada
  - [x] 1.7.4 `finalize` sobre thread inexistente lanza error controlado
  - [x] 1.7.5 `getLatest` retorna null en thread vacío
  - [x] 1.7.6 `listByThread` retorna `[]` en thread vacío

---

**CHECKPOINT 1** — Después de 1.7: `pnpm nx test storage`. Todos los tests deben pasar antes de continuar.

---

## Fase 2 — Tool extension (refine_requirements)

- [ ] 2.1 Extender el JSON schema del input de `refine_requirements` en `packages/tools/refine/src/index.ts` para incluir `thread_id?`, `instructions?`, `previous_output?`
- [ ] 2.2 Adaptar el handler de `refine_requirements` en `execute` para implementar el flujo de precedencia del design §4:
  - [ ] 2.2.1 `base = explicit_previous_output ?? storage.refinements.getLatest(threadId)?.output ?? null`
  - [ ] 2.2.2 `nextIter = storage.refinements.getNextIteration(threadId)` (solo lectura)
  - [ ] 2.2.3 Si `thread_id` ausente o `""`: comportamiento legacy sin consultar DB
- [ ] 2.3 Agregar el header HTML comment al inicio del prompt retornado:
  ```
  <!-- refine:meta
  thread_id: {threadId}
  iteration: {nextIter}
  has_base: {base !== null}
  -->
  ```
- [ ] 2.4 Si `getThreadStatus(threadId) === 'final'`: anteponer advertencia en español al prompt (R10 del spec, E6)
- [ ] 2.5 Normalizar `""` a `null/undefined` para `thread_id` e `instructions` antes de cualquier lógica (edge cases del spec §5)
- [ ] 2.6 Asegurar que `createRefineSkill` recibe `storage` como parámetro (o inyectarlo desde el ToolRegistry) y que el handler puede acceder a `storage.refinements.*`
- [ ] 2.7 Tests unitarios en `packages/tools/refine/src/__tests__/refine-requirements.spec.ts`
  - [ ] 2.7.1 Sin `thread_id`: retorna prompt sin header (comportamiento legacy, E4)
  - [ ] 2.7.2 Con `thread_id` nuevo (sin filas): header con `iteration=1`, `has_base=false`
  - [ ] 2.7.3 Con `thread_id` existente y sin `previous_output`: `has_base=true`, base tomada de `getLatest`
  - [ ] 2.7.4 Con `previous_output` explícito: `has_base=true`, base = `previous_output` (ignora DB, E3)
  - [ ] 2.7.5 Con hilo finalizado: prompt incluye advertencia (E6)

---

## Fase 3 — Tools nuevas en la skill

- [ ] 3.1 **`refine_save_iteration`** en `packages/tools/refine/src/index.ts`
  - [ ] 3.1.1 Agregar entrada al array `tools[]` con JSON schema: `thread_id*`, `output*`, `instructions?`, `requirements?`, `project_id?`
  - [ ] 3.1.2 Handler en `switch`: verificar `getThreadStatus !== 'final'`; si final → error "El hilo {id} ya está finalizado y no admite nuevas iteraciones" (E5); llamar `storage.refinements.save(input)`; retornar `JSON.stringify(row)`
  - [ ] 3.1.3 Tests: save exitoso, save bloqueado en hilo final, primer save con `requirements` (iteration=1)
- [ ] 3.2 **`refine_list_iterations`**
  - [ ] 3.2.1 Agregar entrada al array `tools[]` con JSON schema: `thread_id*`
  - [ ] 3.2.2 Handler: `listByThread(thread_id)`; retornar `JSON.stringify(rows)` (lista vacía si no existe, E7)
  - [ ] 3.2.3 Tests: lista con filas ordenadas, lista vacía en thread inexistente
- [ ] 3.3 **`refine_get_latest`**
  - [ ] 3.3.1 Agregar entrada al array `tools[]` con JSON schema: `thread_id*`
  - [ ] 3.3.2 Handler: `getLatest(thread_id)`; retornar `JSON.stringify(row)` — `null` si no existe (E8)
  - [ ] 3.3.3 Tests: retorna fila correcta, retorna null en thread vacío
- [ ] 3.4 **`refine_finalize`**
  - [ ] 3.4.1 Agregar entrada al array `tools[]` con JSON schema: `thread_id*`
  - [ ] 3.4.2 Handler: llamar `storage.refinements.finalize(thread_id)`; propagar error controlado si thread inexistente; retornar `JSON.stringify({thread_id, status: 'final'})`
  - [ ] 3.4.3 Tests: finaliza exitosamente, idempotente en doble llamada, error en thread inexistente
- [ ] 3.5 Actualizar descripciones de tools (design §7) en sus respectivas entradas del array `tools[]`
- [ ] 3.6 Actualizar descripción de la skill `refine` (campo `description` de `createRefineSkill`) con el texto del design §7

---

**CHECKPOINT 2** — Después de 3.6: `pnpm nx test tools-refine` (ajustar nombre de proyecto según workspace). Todos los tests deben pasar.

---

## Fase 4 — CLI jarvis refine

- [ ] 4.1 Crear `packages/cli/src/commands/refine.ts` modelado en `packages/cli/src/commands/project.ts`
  - [ ] 4.1.1 Definir grupo `refine` con `program.command('refine').description('Gestión de refinamientos iterativos')`
  - [ ] 4.1.2 Subcomando `save <thread_id> <output-file>` — flags: `--instructions <text>`, `--requirements <file>`, `-p <project_id>`; llama `refine_save_iteration`; imprime JSON de la fila guardada
  - [ ] 4.1.3 Subcomando `iterate [thread_id]` — flags: `--input <file>`, `--instructions <text>`, `-p <project_id>`; si no se pasa `thread_id` genera UUID; llama `refine_requirements`; imprime prompt + aviso de `thread_id` e iteración en español (E9)
  - [ ] 4.1.4 Subcomando `list <thread_id>` — imprime tabla con columnas: `iteration`, `status`, `created_at`, `output (preview 60 chars)`
  - [ ] 4.1.5 Subcomando `show <thread_id>` — flag `--iteration <n>` (default: último); imprime output crudo de la iteración indicada
  - [ ] 4.1.6 Subcomando `finalize <thread_id>` — imprime "Hilo {id} finalizado correctamente"
  - [ ] 4.1.7 Todos los mensajes al usuario en español; errores con `console.error` + `process.exit(1)`
- [ ] 4.2 Registrar el grupo `refine` en `packages/cli/src/index.ts` (importar y montar con `program.addCommand` o similar)
- [ ] 4.3 Verificar que la CLI construye sin errores: `pnpm nx build cli`

---

**CHECKPOINT 3** — Después de 4.3: prueba manual interactiva del flujo CLI completo (ver escenarios E9 y E1-E8 vía CLI). Documentar el resultado antes de continuar.

---

## Fase 5 — Documentación y sync

- [ ] 5.1 Actualizar `packages/docs/mcp-instructions.md`: agregar sección "Flujo iterativo de refine" con el diagrama `refine_requirements → user review → refine_save_iteration → (repetir) → refine_finalize` y nota sobre `jarvis mcp sync` obligatorio post-deploy (R-NF4)
- [ ] 5.2 Ejecutar `jarvis mcp sync --dry-run` y confirmar que el diff del bloque en `CLAUDE.md` refleja las 4 tools nuevas y la descripción actualizada de la skill
- [ ] 5.3 Si el dry-run es correcto, ejecutar `jarvis mcp sync` (sin `--dry-run`) para escribir el bloque actualizado en `CLAUDE.md`
- [ ] 5.4 Verificar con `jarvis doctor` que no hay drift después del sync

---

## Fase 6 — Verificación end-to-end

- [ ] 6.1 Ejecutar escenario **E1**: primera iteración + save → verificar fila en DB con `iteration=1`, `status='draft'`
- [ ] 6.2 Ejecutar escenario **E2**: segunda iteración con `instructions` → verificar `iteration=2`, `instructions` guardadas
- [ ] 6.3 Ejecutar escenario **E3**: `previous_output` explícito anula DB → verificar header del prompt usa override
- [ ] 6.4 Ejecutar escenario **E4**: llamada sin `thread_id` → verificar comportamiento legacy idéntico (sin header, sin DB)
- [ ] 6.5 Ejecutar escenario **E5**: save tras finalize → verificar mensaje de error en español
- [ ] 6.6 Ejecutar escenario **E6**: `refine_requirements` sobre hilo final → verificar advertencia en el prompt
- [ ] 6.7 Ejecutar escenario **E7**: `list` sobre thread inexistente → verificar lista vacía sin error
- [ ] 6.8 Ejecutar escenario **E8**: `get_latest` sobre thread inexistente → verificar `null` sin excepción
- [ ] 6.9 Ejecutar escenario **E9**: `jarvis refine iterate <thread_id> -m "hazlo más breve"` → verificar output en español con `thread_id` e `iteration` visibles
- [ ] 6.10 Ejecutar escenario **E10**: verificar monotonía de `iteration_number` (puede simularse en test con transacción secuencial)
- [ ] 6.11 `pnpm nx test storage` — sin regresiones
- [ ] 6.12 `pnpm nx test tools-refine` — sin regresiones
- [ ] 6.13 `pnpm nx lint storage tools-refine cli` — sin errores ni warnings

---

**CHECKPOINT 4** — Después de 6.13: todos los tests y lint pasan, los 10 escenarios validados. Listo para `/sdd-archive refine-iterative`.

---

## Checkpoints

| # | Después de | Validación |
|---|---|---|
| CP1 | Fase 1 completa | `pnpm nx test storage` — todos los tests del repo pasan; schema visible en SQLite con `.schema refinements` |
| CP2 | Fase 3 completa | `pnpm nx test tools-refine` — 4 tools nuevas testeadas; comportamiento legacy de `refine_requirements` sin regresión |
| CP3 | Fase 4 completa | Prueba manual interactiva del CLI: flujo save → iterate → list → show → finalize en terminal, mensajes en español |
| CP4 | Fase 6 completa | Todos los escenarios E1–E10 documentados como pasados; `pnpm nx lint` limpio; `jarvis doctor` sin drift |
