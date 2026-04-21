# Spec Delta — refine-flow-refactor

Cambios sobre [`openspec/specs/refine/spec.md`](../../specs/refine/spec.md). Este delta reemplaza comportamientos específicos; al archivar, los cambios se consolidan en la spec base.

## Requirements

### R1 — Path one-shot genera thread_id y header meta (REPLACE)

Cuando `refine_requirements` se invoca **sin** `thread_id` (o con `thread_id` vacío/whitespace), la tool DEBE:

1. Generar un UUID v4 como `thread_id`.
2. Anteponer un header HTML con formato exacto:
   ```
   <!-- refine:meta
   thread_id: <uuid>
   iteration: 1
   -->
   ```
3. Retornar `header + "\n\n" + prompt` donde `prompt` es el prompt one-shot (secciones: `## Requirements Refinement Analysis`, `### Input Requirements`, `rulesSection` si aplica, `### Refinement Instructions`).
4. NO realizar ninguna escritura a storage.

**Reemplaza** el comportamiento anterior en el que el path sin `thread_id` retornaba prompt plano sin header.

### R2 — Path iterativo sin `### Input Requirements` (REPLACE)

Cuando `refine_requirements` se invoca **con** `thread_id` válido, el body del prompt NO DEBE incluir la sección `### Input Requirements`. El parámetro `requirements` en el input sigue siendo requerido por el schema (compatibilidad) pero no se renderiza como sección del prompt iterativo.

El body iterativo DEBE contener en orden:
1. `## Requirements Refinement Analysis` (título fijo).
2. `### Previous Output` con el contenido de `base` (**solo si `base !== null`**).
3. `### Correction Instructions` con el contenido de `instructions` (solo si no vacío).
4. `rulesSection` (solo si hay reglas).
5. `### Refinement Instructions` (bloque SMART+AC fijo).

**Reemplaza** el comportamiento actual que pushea `### Input Requirements` siempre en el path iterativo.

### R3 — Eliminar warning por hilo finalizado (REMOVE)

`refine_requirements` NO DEBE emitir el banner `⚠️ Advertencia: el hilo <id> está finalizado...` cuando el hilo está en status `completed`. El prompt se retorna sin ninguna sección de advertencia independientemente del status.

**Elimina** el `warningSection` actual en el path iterativo.

### R4 — `refine_save_iteration` reabre hilo cerrado (REPLACE)

Cuando `refine_save_iteration` se invoca sobre un hilo cuyo status es `completed`, la tool DEBE:

1. Dentro de la misma transacción que inserta la nueva iteración:
   - Actualizar todas las filas del hilo a `status='in_progress'` (reapertura).
   - Insertar la nueva fila con `status='in_progress'`.
2. Retornar la `RefinementRow` recién insertada, como hoy.
3. NO emitir error, NO emitir warning.

Si el status es `in_progress`, comportamiento inalterado (solo inserta la nueva fila con `status='in_progress'`).

**Reemplaza** el `throw new Error("El hilo X ya está finalizado...")` actual.

### R5 — Valores de status renombrados (REPLACE)

El tipo `RefinementRow.status` DEBE ser `'in_progress' | 'completed'`. Consecuencias:

- DDL: `CHECK(status IN ('in_progress','completed'))`, `DEFAULT 'in_progress'`.
- Repo: `stmtFinalize` usa `'completed'`; `getThreadStatus` retorna `'in_progress' | 'completed' | null`.
- Skill: `getThreadStatus === 'completed'` (en lugar de `'final'`).
- `refine_finalize` retorna `{ thread_id, status: 'completed' }` (leído de DB, no hardcodeado).
- CLI: comparación `row.status === 'completed'` para colorización.

**Reemplaza** el dominio `'draft' | 'final'`.

### R6 — Migración con wipe total (ADD)

El bloque de migraciones en `database.ts` DEBE incluir un paso que:

1. Detecta si la tabla `refinements` existe con el CHECK antiguo (`status IN ('draft','final')`) o con los valores viejos en filas.
2. Si aplica, ejecuta:
   ```sql
   DROP TABLE IF EXISTS refinements;
   ```
3. Recrea la tabla con el nuevo CHECK constraint.

No se preservan datos existentes. El paso es idempotente (segundo `DROP` sobre tabla ya renovada es no-op via `IF EXISTS`).

Alternativa aceptable: un solo bloque con `try { db.exec(DROP + CREATE) } catch { }` siguiendo el patrón existente.

### R7 — `stmtGetThreadStatus` lee iteración más reciente (FIX)

`stmtGetThreadStatus` DEBE incluir `ORDER BY iteration DESC LIMIT 1` para retornar el status de la iteración más reciente del hilo, no la primera fila física. Esto es un fix a bug latente detectado durante explore.

### R8 — CLI `iterate` no genera UUID localmente (SIMPLIFY)

El subcomando `jarvis refine iterate` DEBE delegar la generación del `thread_id` a la tool (el path one-shot ahora lo devuelve en el header). Si el usuario no pasa `--thread`, el comando llama a la tool sin `thread_id`, extrae el UUID del header de la respuesta y lo imprime.

**Elimina** el `randomUUID()` local en [packages/cli/src/commands/refine.ts:102-103](../../../packages/cli/src/commands/refine.ts#L102-L103).

### R9 — Paths prompt-puros intactos (KEEP)

Las tools `check_definition_of_ready`, `generate_user_stories`, `identify_dependencies` NO se modifican. Siguen comportándose igual: prompt puro, sin storage, sin header.

### R10 — `refine_list_iterations` y `refine_get_latest` (KEEP)

Ambas tools siguen retornando `JSON.stringify(row)` / `JSON.stringify(rows)`. Los consumidores que parsean el JSON heredan el nuevo dominio de `status`.

## Scenarios

### S1 — Primera llamada sin thread_id

**Given** el agente invoca `refine_requirements({ requirements: "quiero X" })` sin pasar `thread_id`.
**When** la tool responde.
**Then** la respuesta contiene:
- Header HTML con `thread_id: <uuid v4>` e `iteration: 1`.
- Body con `## Requirements Refinement Analysis`, `### Input Requirements`, `### Refinement Instructions`.
- NO hay fila nueva en la tabla `refinements`.

### S2 — Agente recupera thread_id y pasa a iterar

**Given** la llamada S1 devolvió un `thread_id` en el header.
**When** el agente captura el UUID y llama `refine_requirements({ thread_id: <uuid>, requirements: "quiero X", previous_output: "<output del LLM del one-shot>" })`.
**Then** la respuesta contiene:
- Header con mismo `thread_id`, `iteration: 1` (porque aún no hay fila persistida; `getNextIteration` devuelve 1).
- Body con `### Previous Output` (= `previous_output` pasado), SIN `### Input Requirements`, con `### Refinement Instructions`.
- NO hay fila nueva en `refinements`.

### S3 — Agente llama `refine_save_iteration` por primera vez

**Given** el escenario S2.
**When** el agente llama `refine_save_iteration({ thread_id: <uuid>, output: "texto refinado" })`.
**Then**:
- Se inserta una fila con `iteration=1`, `status='in_progress'`.
- La tool retorna el `RefinementRow` serializado.

### S4 — Segunda iteración con base recuperada de DB

**Given** S3 completado.
**When** el agente llama `refine_requirements({ thread_id: <uuid>, requirements: "quiero X", instructions: "el AC3 está mal" })` (sin `previous_output` explícito).
**Then**:
- Header indica `iteration: 2`.
- `### Previous Output` contiene el `output` de la fila guardada en S3.
- `### Correction Instructions` contiene `"el AC3 está mal"`.
- NO hay `### Input Requirements`.

### S5 — Finalizar hilo

**Given** hilo con 2 iteraciones en `in_progress`.
**When** el agente llama `refine_finalize({ thread_id: <uuid> })`.
**Then**:
- Todas las filas del hilo tienen `status='completed'`.
- La tool retorna `{ thread_id: "<uuid>", status: "completed" }` (el `"completed"` viene de la lectura real, no de un literal hardcodeado).

### S6 — Reabrir hilo guardando una nueva iteración

**Given** hilo finalizado (S5).
**When** el agente llama `refine_save_iteration({ thread_id: <uuid>, output: "revisión post-cierre" })`.
**Then** (en una sola transacción):
- Todas las filas existentes del hilo pasan de `completed` a `in_progress`.
- Se inserta una nueva fila con `iteration=3`, `status='in_progress'`.
- La tool retorna el nuevo `RefinementRow`. NO hay error ni warning.

### S7 — `refine_requirements` sobre hilo cerrado no emite warning

**Given** hilo finalizado.
**When** el agente llama `refine_requirements({ thread_id: <uuid>, requirements: "..." })`.
**Then** la respuesta NO contiene el banner `⚠️ Advertencia...`. El prompt se emite como un iterativo normal, leyendo el último `output` como base.

### S8 — `getThreadStatus` lee iteración más reciente

**Given** hilo con iteración 1 `in_progress` y iteración 2 `in_progress`, luego `finalize` marca ambas como `completed`, luego `save` inserta iteración 3 que reabre (1,2 → `in_progress`, 3 → `in_progress`).
**When** se llama `getThreadStatus(<uuid>)`.
**Then** retorna `'in_progress'` (reflejando la última iteración).

### S9 — Wipe de datos en migración

**Given** DB con tabla `refinements` con CHECK viejo y filas con `status='draft'` y `status='final'`.
**When** se carga el módulo de storage (ejecuta migraciones).
**Then**:
- La tabla se recrea con el nuevo CHECK constraint.
- Todas las filas viejas se pierden.
- No hay errores.

### S10 — CLI `iterate` sin `--thread` usa UUID del header

**Given** el usuario ejecuta `jarvis refine iterate` sin flag `--thread`.
**When** la CLI completa la llamada.
**Then**:
- La tool generó el UUID (no la CLI).
- El output de la CLI incluye el `thread_id` (extraído del header) para que el usuario pueda continuar.

### S11 — `refine_list_iterations` retorna status nuevos

**Given** hilo con 2 iteraciones `in_progress`.
**When** el agente llama `refine_list_iterations({ thread_id: <uuid> })`.
**Then** cada `RefinementRow` en el array tiene `status: "in_progress"`.

### S12 — Retrocompatibilidad eliminada del one-shot

**Given** el doc `mcp-instructions.md` afirmaba que el path sin `thread_id` era "sin acceso a la base de datos".
**When** se ejecuta `refine_requirements` sin `thread_id` tras el refactor.
**Then** la afirmación "sin acceso a DB" sigue siendo cierta (UUID no toca DB), pero la afirmación "sin header" ya no. La doc DEBE reflejar el nuevo comportamiento.

## Glosario

- **One-shot**: invocación de `refine_requirements` sin `thread_id`. Genera UUID + header, retorna prompt, no persiste.
- **Iterativo**: invocación con `thread_id`. Retorna prompt con `Previous Output` como fuente.
- **Hilo** (thread): conjunto de filas en `refinements` que comparten `thread_id`.
- **Reapertura**: transición automática del status de todas las filas del hilo de `completed` a `in_progress` al guardar una nueva iteración sobre un hilo cerrado.
- **Promesa de hilo**: `thread_id` generado en el one-shot que aún no tiene filas persistidas. Se materializa al primer `refine_save_iteration`.
