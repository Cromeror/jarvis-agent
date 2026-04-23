# Tasks — project-n8n-workflow-registry

## Fase 1 — Storage: tipos, migración, tabla nueva, repo, seed

### 1.1 Tipos

- [x] 1.1.1 Agregar `ProjectWorkflowRow` en [packages/storage/src/types.ts](../../../packages/storage/src/types.ts):
  ```typescript
  export interface ProjectWorkflowRow {
    id: number;
    project_id: string;
    name: string;
    description: string | null;
    n8n_workflow_id: string;
    local_path: string | null;
    created_at: string;
    updated_at: string;
  }
  ```

### 1.2 DDL y migraciones en [packages/storage/src/database.ts](../../../packages/storage/src/database.ts)

- [x] 1.2.1 Agregar `CREATE TABLE IF NOT EXISTS project_workflows (...)` al bloque principal de schema (con columnas según R1 de [spec.md](./spec.md)).
- [x] 1.2.2 Agregar `CREATE INDEX IF NOT EXISTS idx_project_workflows_project_id ON project_workflows(project_id)`.
- [x] 1.2.3 Agregar migración de `project_rules` para incluir `UNIQUE(project_id, category, rule)`:
  - Detectar si la definición actual (via `sqlite_master.sql`) NO contiene `UNIQUE(project_id, category, rule)`.
  - Si falta: recrear tabla dentro de transacción (`CREATE project_rules_new → INSERT SELECT con GROUP BY → DROP → RENAME → recreate index`).
  - Envolver en try/catch siguiendo patrón existente.
- [x] 1.2.4 Verificar que el orden de definición es compatible: `projects` debe existir antes del `CREATE TABLE project_workflows` por la FK.

### 1.3 Repo de `project_workflows`

- [x] 1.3.1 Crear [packages/storage/src/repositories/project-workflows.ts](../../../packages/storage/src/repositories/project-workflows.ts) con:
  - Prepared statements: `stmtInsert`, `stmtUpdate`, `stmtGetByName`, `stmtGetById`, `stmtListByProject`, `stmtRemove`.
  - Función `createProjectWorkflowsRepo(db)` que retorna `{ register, listByProject, getByName, remove }`.
  - `register(input)` usa transaction: busca por `(project_id, name)`; si existe, update; si no, insert. Retorna la fila final via `stmtGetById`.
  - `listByProject(project_id)` retorna filas ordenadas por `name ASC`.
  - `getByName(project_id, name)` retorna `ProjectWorkflowRow | null`.
  - `remove(project_id, name)` ejecuta `DELETE` y retorna `result.changes > 0`.

- [x] 1.3.2 Exponer en [packages/storage/src/index.ts](../../../packages/storage/src/index.ts):
  - Import: `import { createProjectWorkflowsRepo } from './repositories/project-workflows.js'`.
  - Re-export del tipo: `export type { ProjectWorkflowRow }`.
  - Instanciar en la factory: `projectWorkflows: createProjectWorkflowsRepo(db)`.
  - Agregar a la interfaz `Storage`.

### 1.4 Seed de rules en repo de rules

- [x] 1.4.1 En [packages/storage/src/repositories/rules.ts](../../../packages/storage/src/repositories/rules.ts):
  - Definir constante `WORKFLOW_REGISTRY_SEED_RULES` como array de objetos `{ category, rule, priority, tool_name }` con los 16 textos del spec R5 (WR-W1..W4, WR-H1..H6, WR-P1..P4, WR-A1..A2). Nota: spec lista 16 códigos WR explícitos; el "15" en tasks.md es un typo.
  - Agregar prepared statement `stmtSeedInsert` con `INSERT OR IGNORE INTO project_rules (project_id, category, rule, priority, tool_name) VALUES (?, ?, ?, ?, ?)`.
  - Agregar método `seedWorkflowRegistryRules(project_id: string): number` que itera el array y ejecuta `stmtSeedInsert.run(...)`. Retorna suma de `result.changes`.

### 1.5 Tests de storage

Archivo: [packages/storage/src/__tests__/project-workflows.spec.ts](../../../packages/storage/src/__tests__/project-workflows.spec.ts) (nuevo).

- [x] 1.5.1 Test `register` inserta fila nueva con datos correctos (`created_at`, `updated_at` populados).
- [x] 1.5.2 Test upsert: segunda llamada con mismo `(project_id, name)` actualiza `description`, `n8n_workflow_id`, `local_path`, `updated_at`; `created_at` queda inmutable.
- [x] 1.5.3 Test `listByProject` retorna filas ordenadas por `name` ASC.
- [x] 1.5.4 Test `listByProject` sobre proyecto sin workflows retorna array vacío.
- [x] 1.5.5 Test `getByName` retorna fila o `null`.
- [x] 1.5.6 Test `remove` retorna `true` si borró, `false` si no existía.
- [x] 1.5.7 Test CASCADE DELETE: insertar 2 workflows en un proyecto, `DELETE FROM projects WHERE id=?`, verificar que quedan 0 workflows del proyecto.
- [x] 1.5.8 Test UNIQUE constraint: intentar `INSERT` directo (bypass repo) con `(project_id, name)` duplicado debe fallar.

Archivo: [packages/storage/src/__tests__/rules.spec.ts](../../../packages/storage/src/__tests__/rules.spec.ts) (existente).

- [x] 1.5.9 Test `seedWorkflowRegistryRules(project_id)`: primera llamada inserta 16 rules; segunda llamada inserta 0 (idempotente).
- [x] 1.5.10 Test después del seed, `listByTool(project_id, 'project_register_workflow')` retorna las rules correctas por categoría.

**CHECKPOINT 1:** `pnpm nx test @jarvis/storage` verde.

---

## Fase 2 — Skill n8n: helper HTTP + 3 tools nuevas

### 2.1 Helper HTTP

- [x] 2.1.1 En [packages/tools/n8n/src/index.ts](../../../packages/tools/n8n/src/index.ts), agregar función local `n8nFetch(config, method, path, body?)` según pseudocódigo en [design.md §3](./design.md). Retorna `{ ok, status, data, error? }`.
- [x] 2.1.2 Refactorizar los 3 cases existentes (`n8n_list_workflows`, `n8n_trigger_workflow`, `n8n_get_execution_status`) para usar `n8nFetch`. Verificar que comportamiento no cambia.

### 2.2 Tool `project_register_workflow`

- [x] 2.2.1 Agregar definición al array `tools[]`:
  ```json
  {
    "name": "project_register_workflow",
    "description": "<ver R6 del spec>",
    "input_schema": {
      "type": "object",
      "properties": {
        "project_id": { "type": "string", "description": "..." },
        "purpose": { "type": "string", "description": "..." },
        "name": { "type": "string", "description": "..." },
        "description": { "type": "string", "description": "..." },
        "n8n_workflow_id": { "type": "string", "description": "..." },
        "local_path": { "type": "string", "description": "..." }
      },
      "required": ["project_id"]
    }
  }
  ```

- [x] 2.2.2 En el switch de `execute`, agregar `case 'project_register_workflow':`.
- [x] 2.2.3 Validación inicial: `project_id` requerido; consultar `storage.projects.getById(project_id)` — si null, retornar error "proyecto no encontrado".
- [x] 2.2.4 Validar integración n8n: `storage.integrations.getConfig(project_id, 'n8n')` — si null, error en español sugiriendo `jarvis project integration add n8n`.
- [x] 2.2.5 Si `!input.n8n_workflow_id` (modo guía):
  - Resolver rules: `resolveRulesForTool(storage, project_id, 'project_register_workflow', 'workflow_registry.when_to_register')` y `'workflow_registry.how_to_create'`.
  - Construir prompt en español con: header meta comentario HTML (tool, mode, project), `## Registrar workflow...`, `### Tu Tarea`, `### Contexto` (con `purpose` si vino), `### Reglas del Registry (cuándo registrar)`, `### Reglas del Registry (cómo crear)`, `### Próximos pasos` con ejemplo literal de la llamada a re-hacer.
  - Retornar el prompt como string.
- [x] 2.2.6 Si `input.n8n_workflow_id` presente (modo persistencia):
  - Validar `name` requerido + regex `/^[a-z0-9][a-z0-9-]*[a-z0-9]$/`. Si inválido, error específico.
  - Validar `local_path` requerido.
  - Llamar `n8nFetch(config, 'GET', `/api/v1/workflows/${n8n_workflow_id}`)`. Si `!ok` o `status === 404`, error "workflow no existe en n8n".
  - Llamar `storage.projectWorkflows.register({ project_id, name, description: input.description ?? null, n8n_workflow_id, local_path: input.local_path })`.
  - Resolver rules: `resolveRulesForTool(storage, project_id, 'project_register_workflow', 'workflow_registry.after_registration')`.
  - Retornar `JSON.stringify({ row, next_steps: rulesAfter })`.

### 2.3 Tool `project_list_workflows`

- [x] 2.3.1 Agregar definición al array `tools[]`.
- [x] 2.3.2 En el switch: validar `project_id`, llamar `storage.projectWorkflows.listByProject(project_id)`.
- [x] 2.3.3 Resolver rules `workflow_registry.after_registration` con `tool_name='project_list_workflows'`.
- [x] 2.3.4 Retornar `JSON.stringify({ workflows: rows, next_steps: rules })`.

### 2.4 Tool `project_unregister_workflow`

- [x] 2.4.1 Agregar definición al array `tools[]`.
- [x] 2.4.2 En el switch: validar `project_id` y `name`.
- [x] 2.4.3 Llamar `storage.projectWorkflows.remove(project_id, name)`.
- [x] 2.4.4 Si `false`, error "workflow <name> no estaba registrado en este proyecto".
- [x] 2.4.5 Si `true`, retornar `JSON.stringify({ removed: true, name, note: "El workflow sigue activo en n8n..." })`.

### 2.5 Actualizar descripción del skill

- [x] 2.5.1 En la descripción de `createN8nSkill`, mencionar las 3 tools nuevas y la distinción global vs. proyecto.

### 2.6 Tests

Archivo: [packages/tools/n8n/src/__tests__/project-workflow-tools.spec.ts](../../../packages/tools/n8n/src/__tests__/project-workflow-tools.spec.ts) (nuevo).

- [x] 2.6.1 Setup: in-memory DB + mock del fetch global (o MSW).
- [x] 2.6.2 Test modo guía: llamada sin `n8n_workflow_id` retorna prompt con `### Tu Tarea` + rules concatenadas.
- [x] 2.6.3 Test modo guía incluye `purpose` cuando se pasa.
- [x] 2.6.4 Test modo persistencia: happy path con `n8n_workflow_id` válido (mock fetch 200) persiste + retorna row.
- [x] 2.6.5 Test modo persistencia: `n8n_workflow_id` inexistente (mock fetch 404) retorna error sin persistir.
- [x] 2.6.6 Test modo persistencia: `name` inválido (con espacios) retorna error de validación.
- [x] 2.6.7 Test upsert: dos llamadas con mismo `name` actualizan, no crean nueva.
- [x] 2.6.8 Test `project_list_workflows` sobre proyecto sin workflows retorna `{ workflows: [], next_steps: [...] }`.
- [x] 2.6.9 Test `project_unregister_workflow` happy path.
- [x] 2.6.10 Test `project_unregister_workflow` sobre name inexistente retorna error.
- [x] 2.6.11 Test proyecto sin integración n8n: modo guía retorna error sugiriendo configurar integración.

**CHECKPOINT 2:** `pnpm nx test @jarvis/tools-n8n` verde.

---

## Fase 3 — CLI + sync

### 3.1 Nuevo comando `jarvis project workflow`

- [x] 3.1.1 Crear [packages/cli/src/commands/project-workflow.ts](../../../packages/cli/src/commands/project-workflow.ts) (o extender `project.ts` si existe esa estructura).
- [x] 3.1.2 Función `projectWorkflowAdd(name, { n8nId, description, localPath, project })`:
  - Resolver `project_id` (flag `--project` o `.jarvis/project.json` o preguntar).
  - Llamar al tool runner (o directamente al storage) con el equivalente a `project_register_workflow` modo persistencia.
  - Imprimir confirmación.
- [x] 3.1.3 Función `projectWorkflowList({ project, global })`:
  - Si `--global`: delegar a `n8n_list_workflows` (comportamiento existente).
  - Si `--project`: llamar `project_list_workflows`, imprimir tabla con columnas `name | description | n8n_workflow_id | local_path`.
- [x] 3.1.4 Función `projectWorkflowRemove(name, { project })`:
  - Resolver project_id.
  - Llamar `project_unregister_workflow`.
  - Imprimir confirmación.

### 3.2 Registrar subcomandos en [packages/cli/src/index.ts](../../../packages/cli/src/index.ts)

- [x] 3.2.1 Agregar comando `project workflow` con subcomandos `add`, `list`, `remove`.

### 3.3 Extender `jarvis mcp sync --project`

- [x] 3.3.1 En [packages/cli/src/commands/mcp.ts](../../../packages/cli/src/commands/mcp.ts), función `renderBlock` para scope project:
  - Antes de renderizar, llamar `storage.rules.seedWorkflowRegistryRules(project_id)` (idempotente).
  - Después de renderizar integraciones, agregar sección "## Workflows registrados (n8n)" si `storage.projectWorkflows.listByProject(project_id)` no está vacío.
  - Formato de cada workflow: `- \`<name>\` — <description>`.

### 3.4 Build

- [x] 3.4.1 `pnpm nx build @jarvis/cli` verde.

**CHECKPOINT 3:** CLI compila. Smoke manual de `jarvis project workflow list --project <id>`.

---

## Fase 4 — Docs

### 4.1 `mcp-instructions.md`

- [x] 4.1.1 En [packages/docs/mcp-instructions.md](../../../packages/docs/mcp-instructions.md), agregar sección "## Workflow Registry por Proyecto" explicando:
  - El concepto: registry en Jarvis + JSON local en `.jarvis/workflows/` + workflow en n8n.
  - Las 3 tools nuevas con descripción y ejemplo de uso.
  - Flujo típico: guide → crear JSON → subir a n8n → registrar → list → trigger.
  - Comandos CLI equivalentes.
- [x] 4.1.2 Actualizar la sección "rules" (si existe) mencionando las categorías `workflow_registry.*`.

### 4.2 Sync MCP catalog

- [x] 4.2.1 Ejecutar `jarvis mcp sync --dry-run` (si está disponible en el entorno) — verificar que refleja las 3 tools nuevas.
- [x] 4.2.2 Si hay drift, ejecutar `jarvis mcp sync` para propagar.

---

## Fase 5 — Verify E2E + regression

### 5.1 Tests E2E

- [ ] 5.1.1 Ejecutar todos los escenarios S1–S14 de [spec.md](./spec.md) como tests o smoke manual documentado.
- [ ] 5.1.2 Verificar específicamente S7 (seed idempotente en re-runs de sync).
- [ ] 5.1.3 Verificar S8 (migración de `project_rules` con UNIQUE).
- [ ] 5.1.4 Verificar S12 (CASCADE DELETE).

### 5.2 Regression builds

- [ ] 5.2.1 `pnpm nx build @jarvis/storage` verde.
- [ ] 5.2.2 `pnpm nx build @jarvis/tools-n8n` verde.
- [ ] 5.2.3 `pnpm nx build @jarvis/cli` verde.
- [ ] 5.2.4 `pnpm nx build @jarvis/mcp` verde.
- [ ] 5.2.5 `pnpm nx build @jarvis/core` verde (tipos re-exportados).

### 5.3 Regression tests

- [ ] 5.3.1 `pnpm nx test @jarvis/storage` verde (incluye tests existentes + nuevos).
- [ ] 5.3.2 `pnpm nx test @jarvis/tools-n8n` verde.
- [ ] 5.3.3 `pnpm nx test @jarvis/tools-refine` verde (regresión: las rules nuevas no deben afectar el comportamiento de refine).

### 5.4 Smoke E2E con proyecto real

- [ ] 5.4.1 Ejecutar `jarvis mcp sync --project` sobre un proyecto real (ej. `lx`) — verificar:
  - Se crearon 15 rules en `project_rules` con categorías `workflow_registry.*`.
  - El `CLAUDE.md` del proyecto tiene sección "## Workflows registrados (n8n)" (vacía).
- [ ] 5.4.2 Crear un workflow simple en n8n manualmente, capturar su ID.
- [ ] 5.4.3 Ejecutar `jarvis project workflow add test-workflow --n8n-id <id> --description "Test" --local-path ".jarvis/workflows/test.json"` y verificar que se registró.
- [ ] 5.4.4 Ejecutar `jarvis project workflow list --project <id>` y verificar que aparece.
- [ ] 5.4.5 Re-sincronizar y verificar que `CLAUDE.md` ahora lista `test-workflow`.
- [ ] 5.4.6 `jarvis project workflow remove test-workflow` y verificar que se borró del registry (y que sigue en n8n).

**CHECKPOINT 4:** Todos los builds + tests en verde. Smoke E2E exitoso.

---

## Fase 6 — Cleanup y commit

- [ ] 6.1 Revisar diff completo.
- [ ] 6.2 Remover `console.log` y código de debug.
- [ ] 6.3 Verificar que `tsbuildinfo` NO están en el commit.
- [ ] 6.4 Commit en rama actual con mensaje:
  ```
  feat(n8n-registry): agrega workflow registry por proyecto con 3 tools MCP y seed de rules
  
  Introduce tabla project_workflows, 3 tools MCP (project_register_workflow con
  doble modo guía/persistencia, project_list_workflows, project_unregister_workflow),
  CLI equivalente, y seed idempotente de 15 rules (workflow_registry.*) durante
  mcp sync --project. Migra project_rules para incluir UNIQUE(project_id, category, rule).
  
  SDD: openspec/changes/project-n8n-workflow-registry/
  ```
