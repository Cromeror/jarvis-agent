# Design — refine-flow-refactor

## 1. Contexto arquitectónico

```
┌────────────┐      MCP       ┌──────────────────────┐
│ LLM cliente│◄──────────────►│ refine skill         │
│ (Claude,   │                │ packages/tools/refine│
│  etc.)     │                └──────────┬───────────┘
└────────────┘                           │
                                         ▼
                              ┌──────────────────────┐
                              │ storage.refinements  │
                              │ (SQLite repo)        │
                              └──────────────────────┘
                                         ▲
                                         │
                               ┌─────────┴──────────┐
                               │ CLI jarvis refine  │
                               │ (subcomandos)      │
                               └────────────────────┘
```

- **LLM cliente** recibe el prompt de la tool vía MCP y ejecuta. No conoce la DB.
- **Skill** es prompt-builder + orquestador de persistencia. Llama al repo.
- **Repo** encapsula toda la lógica SQL + status.
- **CLI** es un caller alternativo del mismo repo (y mediato de la skill).

El refactor preserva esta separación y **mueve más responsabilidad al repo** (reapertura transaccional).

## 2. Decisiones de diseño

### D1 — Reapertura vive en el repo, no en la skill

**Problema**: hoy el guard `if (status === 'final') throw` vive en [index.ts:392](../../../packages/tools/refine/src/index.ts#L392). Si otro consumidor (tests, CLI, futuro caller) llama `storage.refinements.save(...)` directamente, no tiene el guard.

**Decisión**: la lógica "si el hilo está `completed`, flipear a `in_progress` antes de insertar" vive dentro de `save()` en el repo, como parte de la misma transacción que inserta la nueva fila.

**Implementación esperada** (pseudocódigo):

```typescript
function save(input: SaveRefinementInput): RefinementRow {
  return db.transaction((): RefinementRow => {
    const currentStatus = getThreadStatus(input.thread_id);
    if (currentStatus === 'completed') {
      stmtReopenThread.run(input.thread_id); // UPDATE ... SET status='in_progress' WHERE thread_id=?
    }
    const row = stmtInsert.run({ ...input, status: 'in_progress' });
    return row as RefinementRow;
  })();
}
```

**Trade-off aceptado**: el repo sube un pelín en "smart". A cambio, cualquier caller (CLI directa, tests, orquestación futura) hereda la semántica sin duplicar el guard.

### D2 — `stmtGetThreadStatus` con `ORDER BY iteration DESC LIMIT 1`

**Problema**: [repositories/refinements.ts:32](../../../packages/storage/src/repositories/refinements.ts#L32) usa `LIMIT 1` sin `ORDER BY`. SQLite no garantiza orden de retorno; puede devolver la primera fila **física**, no la más reciente.

**Decisión**: el statement nuevo es:

```sql
SELECT status FROM refinements
WHERE thread_id = ?
ORDER BY iteration DESC
LIMIT 1
```

**Consecuencia semántica**: `getThreadStatus` pasa a significar "status de la iteración más reciente del hilo" en lugar de "status del hilo" (que no era una definición operativa). Hoy funciona de facto porque `finalize` y `reopen` tocan todas las filas del hilo, pero conviene ser explícito.

### D3 — `refine_finalize` lee status de DB

**Problema**: [index.ts:422](../../../packages/tools/refine/src/index.ts#L422) retorna `{ thread_id, status: 'final' }` hardcodeado. Al renombrar, el literal debe actualizarse manualmente — frágil.

**Decisión**: después del `UPDATE`, la tool hace `getLatest(threadId).status` y lo incluye en el JSON. El test valida que el valor retornado coincide con el valor real en DB.

### D4 — Migración: recrear tabla

**Problema**: SQLite no soporta `ALTER TABLE ... MODIFY CHECK`. El CHECK constraint actual (`status IN ('draft','final')`) es incompatible con los valores nuevos.

**Decisión**: en `database.ts`, dentro del bloque de migraciones existente (siguiendo el patrón `try { db.exec(...) } catch { }`):

```typescript
try {
  // Detecta CHECK viejo via sqlite_master y recrea si aplica
  const tableSchema = db
    .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='refinements'")
    .get() as { sql?: string } | undefined;

  if (tableSchema?.sql?.includes("'draft'")) {
    db.exec('DROP TABLE refinements');
    // La definición inicial en el CREATE TABLE IF NOT EXISTS al cargar el schema re-crea la tabla con CHECK nuevo.
  }
} catch {
  // No-op: si algo falla, la siguiente carga re-intenta.
}
```

**Alternativa** (más simple): si el usuario confirma wipe sin preservar, el DDL principal puede actualizarse al nuevo CHECK y la migración se reduce a `DROP TABLE IF EXISTS refinements` — el `CREATE TABLE IF NOT EXISTS` posterior la recrea con el schema nuevo. Esta es la decisión recomendada.

**Decisión final**: usar la **alternativa simple**. Secuencia de boot:

1. Bloque de migraciones detecta si el schema de `refinements` tiene `'draft'` en su definición.
2. Si sí → `DROP TABLE refinements`.
3. El bloque principal de `CREATE TABLE IF NOT EXISTS` (con el DDL nuevo) crea la tabla limpia.

### D5 — Path one-shot genera UUID pero no toca DB

**Problema**: el one-shot hoy no conoce el `thread_id` por diseño (es "desechable"). Si el agente quiere iterar, tiene que generar su propio UUID.

**Decisión**: la tool genera el UUID **siempre** y lo devuelve en el header. El agente decide si usarlo o ignorarlo. **No hay inserción en DB** — el UUID es una "promesa de hilo" hasta que `refine_save_iteration` lo materialice.

**Implementación**: usar `crypto.randomUUID()` de Node (disponible sin dependencias adicionales).

**Consecuencia**: el path one-shot y el path iterativo convergen en el header. La única diferencia es que el iterativo lee/escribe DB.

### D6 — Eliminación de `### Input Requirements` solo en iterativo

**Problema**: el body iterativo hoy tiene `Previous Output` y `Input Requirements`. Dos fuentes. El usuario confirmó que `Input Requirements` no aporta al LLM en iteraciones.

**Decisión**: en el path iterativo, NO pushear `### Input Requirements`. El path one-shot (que NO es una iteración) sí mantiene `### Input Requirements` porque es el único contexto que tiene.

**Mapa de secciones del body**:

| Sección | One-shot | Iterativo (iter 1) | Iterativo (iter N>1) |
|---------|----------|--------------------|-----------------------|
| Header meta | ✅ | ✅ | ✅ |
| `## Requirements Refinement Analysis` | ✅ | ✅ | ✅ |
| `### Previous Output` | ❌ | ✅ (= `previous_output` pasado) | ✅ (= `getLatest().output`) |
| `### Correction Instructions` | ❌ | condicional | condicional |
| `### Input Requirements` | ✅ | ❌ | ❌ |
| `rulesSection` | condicional | condicional | condicional |
| `### Refinement Instructions` | ✅ | ✅ | ✅ |

### D7 — Eliminar warning, no reemplazarlo

**Problema**: el warning actual ("el hilo está finalizado, no se podrá persistir") se vuelve falso con la nueva semántica (save reabre).

**Decisión**: eliminar sin reemplazo. Si el agente invoca `refine_requirements` sobre un hilo `completed`, obtiene un prompt iterativo normal (con `Previous Output` del último save). El agente puede decidir guardar o no; si guarda, reabre.

**Nota de UX**: algunos agentes pueden querer saber "este hilo estaba cerrado". Se puede exponer vía `refine_get_latest` (retorna el row con `status: 'completed'`), pero NO en el header del prompt. El prompt es para el LLM; el status es para el agente.

### D8 — Orden de renombrado para minimizar romper la build mid-refactor

Al renombrar `'draft'|'final'` → `'in_progress'|'completed'`, conviene orden:

1. Types (`RefinementRow.status`).
2. Repo (statements, `getThreadStatus`, `finalize`, `save` con nueva lógica de reapertura).
3. DDL + migración en `database.ts`.
4. Skill (`index.ts`): comparaciones, `refine_finalize` retorno.
5. Tests (storage, tools/refine).
6. CLI (`refine.ts`).

Entre pasos 1 y 4 el tsc falla — eso está bien, nos obliga a completar. Los tests van al final porque son aserts.

### D9 — CLI `iterate`: eliminar generación local de UUID

**Problema**: [cli/commands/refine.ts:102-103](../../../packages/cli/src/commands/refine.ts#L102-L103) genera `randomUUID()` localmente si no viene `--thread`. Con el refactor, esto es redundante.

**Decisión**:
1. Si el usuario pasa `--thread`, la CLI lo usa.
2. Si no, la CLI llama a la tool SIN `thread_id`, **parsea el header** de la respuesta para extraer el UUID, y lo imprime.
3. Requiere agregar utility `extractThreadIdFromHeader(response: string): string | null` en CLI (o en la tool como export).

**Alternativa considerada**: no extraer del header y pedir al usuario que lea el header manualmente. Rechazada porque rompe la UX actual donde la CLI imprime el thread_id al final.

## 3. Interfaces

### `RefinementRow` (nuevo)

```typescript
export interface RefinementRow {
  id: number;
  thread_id: string;
  iteration: number;
  project_id: string | null;
  requirements: string | null;
  instructions: string | null;
  output: string | null;
  status: 'in_progress' | 'completed';  // ← cambio
  parent_id: number | null;
  created_at: string;
}
```

### Nuevos statements en repo

```typescript
const stmtReopenThread = db.prepare(
  `UPDATE refinements SET status = 'in_progress' WHERE thread_id = ?`
);

const stmtGetThreadStatus = db.prepare<[string], { status: string }>(
  `SELECT status FROM refinements
   WHERE thread_id = ?
   ORDER BY iteration DESC
   LIMIT 1`
);
```

### `save` actualizado (pseudocódigo)

```typescript
function save(input: SaveRefinementInput): RefinementRow {
  return db.transaction((): RefinementRow => {
    const current = getThreadStatus(input.thread_id);
    if (current === 'completed') {
      stmtReopenThread.run(input.thread_id);
    }
    // ... insert + retorno como hoy, con status default 'in_progress' en DDL
  })();
}
```

### DDL nuevo

```sql
CREATE TABLE IF NOT EXISTS refinements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  thread_id TEXT NOT NULL,
  iteration INTEGER NOT NULL,
  project_id TEXT,
  requirements TEXT,
  instructions TEXT,
  output TEXT,
  status TEXT NOT NULL DEFAULT 'in_progress' CHECK(status IN ('in_progress','completed')),
  parent_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (parent_id) REFERENCES refinements(id),
  UNIQUE(thread_id, iteration)
);
```

### Header meta (formato final, común a one-shot e iterativo)

```
<!-- refine:meta
thread_id: <uuid>
iteration: <n>
-->
```

Campo `has_base` actual se **elimina** del header. Justificación:
- En one-shot, siempre `false`.
- En iterativo iter 1, depende de si el agente pasó `previous_output`.
- En iter N>1, siempre `true` (hay algo en DB).
- El LLM no necesita el flag; la presencia de `### Previous Output` en el body lo evidencia.
- El agente tampoco — puede llamar `refine_get_latest` si lo necesita.

Simplifica el header sin pérdida semántica.

## 4. Testing strategy

### Unit (storage)
- `save` sobre hilo `completed` → reabre (todas las filas a `in_progress`) y persiste nueva iter.
- `save` sobre hilo `in_progress` → persiste sin tocar status.
- `getThreadStatus` lee la iteración más reciente.
- `finalize` marca todas las filas como `completed`.
- `getThreadStatus` sobre hilo inexistente → `null`.

### Unit (tools/refine)
- One-shot: respuesta contiene header con UUID válido + `iteration: 1`; body contiene `### Input Requirements` y `### Refinement Instructions`.
- One-shot: NO hay fila nueva en DB tras la llamada.
- Iterativo primera llamada con thread_id + previous_output: body contiene `### Previous Output` con el texto pasado; NO contiene `### Input Requirements`.
- Iterativo N>1: body contiene `### Previous Output` con el `output` del último save.
- Iterativo sobre hilo `completed`: respuesta NO contiene `⚠️ Advertencia`.
- `refine_save_iteration` sobre hilo `completed`: no tira; persiste; todas las filas quedan `in_progress`.
- `refine_finalize`: retorna `{ thread_id, status: 'completed' }`.

### Integration (DB real)
- Secuencia completa: one-shot → iterativo(1) → save → iterativo(2) → save → finalize → save(reabre) → finalize.
- Verificar estados intermedios después de cada paso.

### CLI (opcional, manual)
- `jarvis refine iterate` sin `--thread` imprime un UUID válido.
- `jarvis refine list` colorea iteraciones `completed` en verde (nuevo literal).

## 5. Rollout

### Fase orden recomendado (implementación)

1. Storage: tipos + repo + DDL + migración + tests storage.
2. Skill: refactor de prompt + `save_iteration` sin throw + `finalize` sin literal + tests tools.
3. CLI: colorización + `iterate` sin UUID local.
4. Docs: `mcp-instructions.md`, `refine-flow.md`, `openspec/specs/refine/spec.md`.
5. `pnpm nx sync` del catálogo MCP.

### Verify

- `pnpm nx test @jarvis/storage` verde.
- `pnpm nx test @jarvis/tools-refine` verde.
- `pnpm nx build @jarvis/cli` verde (typecheck).
- Ejecutar scenarios S1-S12 del spec contra DB tmp.
- `jarvis doctor` sin warnings.

### Rollback

- `git revert` de la rama.
- DB: al boot, el `CREATE TABLE IF NOT EXISTS` original no re-ejecuta si la tabla existe. Si la tabla tiene el schema nuevo, hay que dropearla manualmente antes del revert (o aceptar que queda en estado inconsistente si hay datos nuevos).
- Para dev local: dropear la DB entera es aceptable.

## 6. Open questions

Ninguna. Las 7 decisiones de scope están cerradas, y las 9 decisiones de diseño (D1–D9) fueron derivadas del explore + scope.
