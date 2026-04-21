# Design — refine-iterative

## 1. Arquitectura

```
  CLI (jarvis refine …)     MCP (jarvis_run_tool)
           \                        /
            \                      /
             v                    v
       ToolRegistry.execute('refine', toolName, input)
                        |
                        v
           createRefineSkill(storage).execute
                        |
        ┌───────────────┼─────────────────────────┐
        v               v                         v
  prompt-only     storage.refinements.*     resolveRulesForTool
 (refine_requirements, (save / getLatest /    (inyecta reglas como hoy)
  generate_user_stories,listByThread /
  identify_dependencies,finalize /
  check_definition…)   getThreadStatus)
                             |
                             v
                   better-sqlite3 (WAL, sync)
```

`refine_requirements` sigue devolviendo un `string` (prompt). Las 4 tools nuevas devuelven `string` con JSON serializado para que el caller LLM pueda parsearlo sin envelope nuevo en `Skill`.

## 2. Esquema de base de datos

Se agrega al `db.exec` de `initDatabase()` en `packages/storage/src/database.ts`:

```sql
CREATE TABLE IF NOT EXISTS refinements (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  thread_id     TEXT    NOT NULL,
  iteration     INTEGER NOT NULL,
  project_id    TEXT             REFERENCES projects(id) ON DELETE SET NULL,
  requirements  TEXT,
  instructions  TEXT,
  output        TEXT,
  status        TEXT    NOT NULL DEFAULT 'draft'
                CHECK(status IN ('draft','final')),
  parent_id     INTEGER          REFERENCES refinements(id) ON DELETE SET NULL,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE(thread_id, iteration)
);

CREATE INDEX IF NOT EXISTS idx_refinements_thread_id ON refinements(thread_id);
CREATE INDEX IF NOT EXISTS idx_refinements_project_id ON refinements(project_id);
CREATE INDEX IF NOT EXISTS idx_refinements_status ON refinements(status);
```

**Decisión: `requirements` solo en `iteration=1`** (NULL en iteraciones siguientes). Razones: (a) evita duplicar texto potencialmente largo en cada vuelta, (b) el dato no muta — lo original es única fuente de verdad, (c) `listByThread` reconstruye historia con un JOIN mental barato (`ORDER BY iteration` trae la fila raíz primero). El repo expone helper `getRequirements(threadId)` que busca `WHERE thread_id=? AND iteration=1`. Trade-off aceptado: una query extra en `listByThread`; compensado por no acoplar caller a serializar texto repetido.

`parent_id` es redundante con `(thread_id, iteration-1)` pero lo dejamos explícito para permitir futuro branching sin migración.

## 3. Interfaces TypeScript

**`packages/storage/src/types.ts`** — agregar:

```ts
export interface RefinementRow {
  id: number;
  thread_id: string;
  iteration: number;
  project_id: string | null;
  requirements: string | null;
  instructions: string | null;
  output: string | null;
  status: 'draft' | 'final';
  parent_id: number | null;
  created_at: string;
}

export interface SaveRefinementInput {
  thread_id: string;
  project_id?: string | null;
  requirements?: string | null;
  instructions?: string | null;
  output: string;
}
```

**`packages/storage/src/repositories/refinements.ts`** — `createRefinementsRepo(db)` devuelve:

```ts
{
  save(input: SaveRefinementInput): RefinementRow;
  getLatest(threadId: string): RefinementRow | null;
  listByThread(threadId: string): RefinementRow[];
  getThreadStatus(threadId: string): 'draft' | 'final' | null;
  finalize(threadId: string): void;
  getNextIteration(threadId: string): number; // MAX(iteration)+1, o 1
}
```

`save` resuelve internamente `iteration = getNextIteration(thread_id)` y `parent_id = getLatest(thread_id)?.id ?? null` para mantener atomicidad (transacción `db.transaction`).

**`Storage`** gana `refinements: ReturnType<typeof createRefinementsRepo>` en `index.ts`.

**Input schemas de tools** (JSON schema dentro de `tools[]`):

- `refine_requirements` (extendido):
  - `requirements: string` (required)
  - `project_id?: string`, `thread_id?: string`, `instructions?: string`, `previous_output?: string`
- `refine_save_iteration`:
  - `thread_id: string`, `output: string` (required)
  - `instructions?: string`, `requirements?: string`, `project_id?: string`
- `refine_list_iterations`: `thread_id: string` (required)
- `refine_get_latest`: `thread_id: string` (required)
- `refine_finalize`: `thread_id: string` (required)

## 4. Flujo de `refine_requirements` extendido

```
execute('refine_requirements', input):
  threadId   = input.thread_id ?? crypto.randomUUID()
  instrs     = input.instructions
  explicit   = input.previous_output
  base       = explicit
            ?? storage.refinements.getLatest(threadId)?.output
            ?? null
  nextIter   = storage.refinements.getNextIteration(threadId)  // read-only
  rules      = resolveRulesForTool(storage, project_id, 'refine_requirements', 'refinement')

  header = [
    '<!-- refine:meta',
    `thread_id: ${threadId}`,
    `iteration: ${nextIter}`,
    `has_base: ${base !== null}`,
    '-->'
  ].join('\n')

  body = [
    '## Requirements Refinement Analysis',
    base    ? '### Previous Output\n' + base : '',
    instrs  ? '### Correction Instructions\n' + instrs : '',
    '### Input Requirements\n' + input.requirements,
    rules,
    '### Refinement Instructions', ...(hoy)
  ]

  return header + '\n\n' + body.join('\n')
```

**Formato del header**: comentario HTML (`<!-- refine:meta … -->`). Justificación: (a) invisible en render markdown del LLM, (b) trivial de parsear con regex `/thread_id:\s*([0-9a-f-]+)/`, (c) no rompe copy-paste a Jira/Notion, (d) no colisiona con frontmatter YAML que ya usamos en docs. Alternativas descartadas: JSON al inicio (contamina visual), frontmatter YAML (ambiguo si el user pega el prompt en otro flujo markdown).

**NO escribe en DB** — `getNextIteration` solo lee. La persistencia es responsabilidad del caller post-validación.

## 5. Flujos de las otras tools

```
refine_save_iteration(input):
  if getThreadStatus(thread_id) === 'final': throw 'thread finalized'
  row = storage.refinements.save({thread_id, output, instructions?, requirements?, project_id?})
  return JSON.stringify(row)

refine_list_iterations({thread_id}):
  rows = storage.refinements.listByThread(thread_id)  // ORDER BY iteration ASC
  return JSON.stringify(rows)

refine_get_latest({thread_id}):
  return JSON.stringify(storage.refinements.getLatest(thread_id))  // null si no existe

refine_finalize({thread_id}):
  storage.refinements.finalize(thread_id)  // UPDATE … SET status='final' WHERE thread_id=?
  return JSON.stringify({thread_id, status: 'final'})
```

**Decisión de `finalize`: UPDATE todas las filas del thread**, no solo la última. Razón: `getThreadStatus` puede chequear cualquier fila (todas coherentes), y queries por `WHERE status='final'` devuelven historial completo del refinamiento cerrado sin JOIN. El costo de escribir N filas es despreciable (N<20 en práctica).

## 6. CLI `jarvis refine …`

| Subcomando | Flags | Llama a | Output |
|---|---|---|---|
| `save <thread_id> <output-file>` | `--instructions <text>`, `--requirements <file>`, `-p <project_id>` | `refine_save_iteration` | JSON de la fila guardada |
| `iterate [thread_id]` | `--input <file>`, `--instructions <text>`, `-p <project_id>` | `refine_requirements` | prompt string con header meta |
| `list <thread_id>` | — | `refine_list_iterations` | tabla (iteration, status, created_at, first-chars-output) |
| `show <thread_id>` | `--iteration <n>` (default latest) | `refine_get_latest` o query directa | output crudo de la iteración |
| `finalize <thread_id>` | — | `refine_finalize` | mensaje "Hilo {id} finalizado" |

`iterate` sin `thread_id` genera UUID nuevo (primera vuelta); con `thread_id` resuelve base vía `getLatest`. Strings en español, código en inglés. Patrón espeja `packages/cli/src/commands/project.ts`.

## 7. Tool descriptions (MCP-visible)

**Skill `refine`** (campo `description`):

> Skill de refinamiento iterativo de requerimientos. Soporta ciclos de "propose → user corrige → re-refine" mediante `thread_id`. Incluye prompt-builders puros (`refine_requirements`, `generate_user_stories`, `identify_dependencies`, `check_definition_of_ready`) y tools de persistencia por hilo (`refine_save_iteration`, `refine_list_iterations`, `refine_get_latest`, `refine_finalize`).

**`refine_requirements`** (description):

> Refina requerimientos crudos contra reglas del proyecto. Para iterar: pasá `thread_id` (UUID) y opcionalmente `instructions` con las correcciones del user y/o `previous_output` con el texto a re-refinar. Si no pasás `previous_output`, el tool carga automáticamente el último output guardado del hilo. Si omitís `thread_id`, el tool genera uno nuevo y lo incluye en un header HTML (`<!-- refine:meta thread_id: … iteration: … -->`) al principio de la respuesta — extraelo para llamadas siguientes. Este tool NO persiste: después de mostrar el resultado al user y obtener aprobación, llamá `refine_save_iteration` con `thread_id` + `output`. Cuando el user confirme que está listo, llamá `refine_finalize`.

## 8. Decisiones y alternativas descartadas

- **`requirements` solo en iteration=1**: evita duplicación, fuente única; descartado "copiar en cada fila" por costo sin beneficio.
- **Header HTML comment**: invisible en render y regex-friendly; descartado JSON inline (ruidoso) y YAML frontmatter (colisión con docs).
- **`status` TEXT + CHECK**: deja espacio a `archived`/`approved`; descartado `INTEGER 0/1` (menos autodoc).
- **`finalize` actualiza todo el thread**: queries simples `WHERE status='final'`; descartado "solo última fila" (requiere subquery con MAX).
- **Tools en `skill.tools[]` (no `server.tool()` directo)**: una superficie (`jarvis tool list` + MCP); trade-off: skill deja de ser prompt-pure.
- **`parent_id` redundante**: habilita branching futuro sin migración.

## 9. Impactos cross-package

- **`packages/core/src/jarvis-knowledge.ts`** → al agregar 4 tools al catálogo, el hash del bloque cambia. Post-merge requiere `jarvis mcp sync` para reescribir `CLAUDE.md`.
- **`packages/docs/mcp-instructions.md`** → agregar sección "Flujo iterativo de refine" con diagrama: `refine_requirements` → user review → `refine_save_iteration` → (repetir) → `refine_finalize`.
- **`jarvis doctor`** → ya detecta drift de hash; no requiere cambio, solo mensaje actualizado en README de troubleshooting.
- **Migración de data**: ninguna. Schema aditivo (`CREATE TABLE IF NOT EXISTS`), sin `ALTER` a tablas existentes. Rollback = `DROP TABLE refinements`.

---

## Envelope

- **status**: ok
- **executive_summary**: Design técnico completo para refine-iterative: tabla `refinements` aditiva con UNIQUE(thread_id,iteration) y `requirements` solo en iter 1; repo `createRefinementsRepo` con `save/getLatest/listByThread/getThreadStatus/finalize/getNextIteration`; `refine_requirements` extendido con `thread_id/instructions/previous_output` (sin persistir, header HTML comment con meta); 4 tools nuevas en `skill.tools[]`; grupo CLI `jarvis refine` con save/iterate/list/show/finalize; descripciones MCP actualizadas para guiar al LLM en el flujo iterativo.
- **artifacts**: `openspec/changes/refine-iterative/design.md`
- **next_recommended**: tasks
- **risks**: header HTML comment puede no ser parseado por LLMs débiles (mitigación: regex robusto en CLI) · `requirements` NULL en iter>1 obliga a cuidado en `listByThread` (mitigación: helper `getRequirements`) · crecimiento ilimitado de `refinements` (out-of-scope, aceptado) · drift de `CLAUDE.md` post-deploy si no se corre `jarvis mcp sync` (mitigado por `jarvis doctor`).
- **skill_resolution**: injected
