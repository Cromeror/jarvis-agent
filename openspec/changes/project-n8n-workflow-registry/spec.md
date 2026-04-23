# Spec Delta — project-n8n-workflow-registry

Cambios sobre:
- [`openspec/specs/storage/spec.md`](../../specs/storage/) (si existe).
- Extiende el skill `n8n` (nuevo delta sobre `packages/tools/n8n`).

## Requirements

### R1 — Tabla `project_workflows` (ADD)

Nueva tabla con schema:

```sql
CREATE TABLE IF NOT EXISTS project_workflows (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id        TEXT    NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name              TEXT    NOT NULL,
  description       TEXT,
  n8n_workflow_id   TEXT    NOT NULL,
  local_path        TEXT,
  created_at        TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE(project_id, name)
);

CREATE INDEX IF NOT EXISTS idx_project_workflows_project_id
  ON project_workflows(project_id);
```

- `project_id`: FK cascade, `NOT NULL`.
- `name`: identificador en kebab-case, único por proyecto.
- `description`: una oración.
- `n8n_workflow_id`: ID en n8n. Puede ser string o numérico (n8n varía por versión). Almacenado como TEXT.
- `local_path`: ruta **relativa al root del repo** del proyecto (ej. `.jarvis/workflows/deploy.json`). No se valida en disco.
- `created_at` y `updated_at`: ISO 8601 en UTC.

### R2 — Tipo `ProjectWorkflowRow` (ADD)

En `packages/storage/src/types.ts`:

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

### R3 — Repo `createProjectWorkflowsRepo` (ADD)

En `packages/storage/src/repositories/project-workflows.ts`:

- `register(input: { project_id, name, description?, n8n_workflow_id, local_path? }): ProjectWorkflowRow`
  - Upsert por `(project_id, name)`: si existe, actualiza `description`, `n8n_workflow_id`, `local_path`, `updated_at`.
  - Retorna la fila final.
- `listByProject(project_id: string): ProjectWorkflowRow[]` — ordena por `name ASC`.
- `getByName(project_id: string, name: string): ProjectWorkflowRow | null`.
- `remove(project_id: string, name: string): boolean` — `DELETE ... WHERE project_id=? AND name=?`. Retorna `true` si se borró fila, `false` si no existía.

El repo se expone en `packages/storage/src/index.ts` como `storage.projectWorkflows`.

### R4 — Migración aditiva de `project_rules` con `UNIQUE(project_id, category, rule)` (REPLACE)

La migración actual no tiene constraint UNIQUE. Se agrega mediante recreación de tabla:

1. Crear `project_rules_new` con el schema nuevo (idéntico al actual + `UNIQUE(project_id, category, rule)`).
2. `INSERT INTO project_rules_new SELECT ... FROM project_rules GROUP BY project_id, category, rule` (deduplica por la tupla al copiar).
3. `DROP TABLE project_rules`.
4. `ALTER TABLE project_rules_new RENAME TO project_rules`.
5. Recrear el índice `idx_project_rules_project_id`.

El bloque se envuelve en try/catch siguiendo el patrón existente (idempotente). Detectar si la migración ya corrió leyendo `sqlite_master` y verificando si la definición incluye `UNIQUE(project_id, category, rule)`.

### R5 — Método `seedWorkflowRegistryRules(project_id)` en el repo de rules (ADD)

En `packages/storage/src/repositories/rules.ts`:

```typescript
function seedWorkflowRegistryRules(projectId: string): number
```

Inserta las 15 rules iniciales con `INSERT OR IGNORE` (requiere la UNIQUE del R4). Retorna la cantidad de filas insertadas (0 si todas ya existían). El contenido exacto de las rules está en [proposal.md §7 del cambio](./proposal.md) y replicado abajo:

**Categoría `workflow_registry.when_to_register`**
- `WR-W1`: "Solo ofrecer registrar un workflow cuando el user explícitamente pida automatizar una tarea recurrente o un pipeline (deploy, notificación, validación). No ofrecer registrar para tareas únicas o exploratorias."
- `WR-W2`: "Antes de proponer un workflow nuevo, llamar `project_list_workflows(project_id)` para verificar que no exista ya uno con el mismo propósito. Si existe uno similar, sugerir reusar o actualizar el existente en lugar de crear uno nuevo."
- `WR-W3`: "Si el proyecto no tiene integración `n8n` configurada, informar al user que es requisito previo y sugerir ejecutar `jarvis project integration add n8n --url <url> --api-key <key>` antes de continuar."
- `WR-W4`: "Antes de arrancar la creación del workflow, preguntar al user qué disparador (trigger) espera: manual, webhook, cron, evento externo. El trigger define la estructura inicial del JSON."

**Categoría `workflow_registry.how_to_create`**
- `WR-H1`: "El JSON del workflow debe guardarse en `.jarvis/workflows/<kebab-case-name>.json` dentro del repo del proyecto. Si la carpeta no existe, crearla."
- `WR-H2`: "El `name` del workflow debe ser único dentro del proyecto, en `kebab-case`, corto y descriptivo (ej. `deploy-staging`, `notify-pr-merged`). No usar espacios, mayúsculas, ni caracteres especiales distintos de `-`."
- `WR-H3`: "La `description` debe responder en una oración: qué hace, cuándo dispararlo, qué input espera. Evitar descripciones genéricas tipo 'workflow de staging'."
- `WR-H4`: "No hardcodear secretos (API keys, tokens, passwords) en el JSON. Usar variables de entorno de n8n (`$env.XXX`) o credenciales referenciadas por nombre (`credentials`). Si detectás valores que parecen secretos en el JSON, advertir al user antes de subirlo."
- `WR-H5`: "Después de guardar el JSON en el repo, subirlo a n8n con `POST {n8n_url}/api/v1/workflows` (incluyendo header `X-N8N-API-KEY`). Capturar el `id` devuelto. Luego activar con `POST {n8n_url}/api/v1/workflows/{id}/activate`."
- `WR-H6`: "Si el workflow tiene un trigger `webhook`, informar al user la URL final del webhook (`{n8n_url}/webhook/{path}`) para que sepa cómo dispararlo desde su código."

**Categoría `workflow_registry.what_to_persist`**
- `WR-P1`: "El `n8n_workflow_id` debe ser el ID exacto que devolvió n8n al crear el workflow (string o número según la versión de n8n). No inventar IDs."
- `WR-P2`: "El `local_path` debe ser relativo al root del proyecto (ej. `.jarvis/workflows/deploy-staging.json`), sin `./` ni `/` inicial. No usar paths absolutos ni rutas fuera del repo."
- `WR-P3`: "La tool hace upsert por `(project_id, name)`: si ya existe un workflow con el mismo name en el mismo proyecto, se actualiza. Usar este comportamiento para re-registrar cuando el JSON del workflow cambió y fue re-subido a n8n con un nuevo ID."
- `WR-P4`: "Después del registro exitoso, ejecutar `jarvis mcp sync --project` para que el `CLAUDE.md` del proyecto refleje el nuevo workflow en el contexto del LLM."

**Categoría `workflow_registry.after_registration`**
- `WR-A1`: "Para ejecutar un workflow registrado, llamar `n8n_trigger_workflow(workflow_id=<n8n_workflow_id>, project_id=<id>, data={...})`. El `n8n_workflow_id` se obtiene de `project_list_workflows`."
- `WR-A2`: "Para ver el resultado de una ejecución, usar `n8n_get_execution_status(execution_id=<id>, project_id=<id>)` con el ID que devolvió el trigger."

Cada rule se inserta con:
- `project_id`: el parámetro.
- `category`: una de `workflow_registry.when_to_register`, `workflow_registry.how_to_create`, `workflow_registry.what_to_persist`, `workflow_registry.after_registration`.
- `rule`: el texto completo.
- `priority`: `100` (alto, para que aparezca antes de rules de bajo nivel).
- `tool_name`: `'project_register_workflow'` para las 3 primeras categorías, `'project_list_workflows'` para `after_registration`.

### R6 — Tool `project_register_workflow` con bifurcación (ADD)

Agregar al skill `n8n` en `packages/tools/n8n/src/index.ts`:

**Schema**:
```json
{
  "project_id": "string (required)",
  "purpose": "string (optional)",
  "name": "string (optional, required para persistir)",
  "description": "string (optional)",
  "n8n_workflow_id": "string (optional, su presencia activa modo persistencia)",
  "local_path": "string (optional, required para persistir)"
}
```

**Descripción MCP** (en español, siguiendo el patrón i18n del cambio `refine-prompts-i18n`):

> "Registra un workflow de n8n como disponible para el proyecto. **Esta tool tiene dos modos.** Modo **guía** (sin `n8n_workflow_id`): devuelve un prompt en español con instrucciones para crear el JSON del workflow, subirlo a n8n y volver a llamar esta tool con los datos. Modo **persistencia** (con `n8n_workflow_id`): valida que el workflow exista en n8n, inserta o actualiza la fila en el registry de Jarvis, y retorna los siguientes pasos para ejecutarlo. Upsert por `(project_id, name)`."

**Lógica**:

1. Validar que `project_id` existe en la tabla `projects`. Si no, error.
2. Validar que el proyecto tiene integración `n8n` configurada. Si no, error con mensaje sugiriendo `jarvis project integration add n8n`.
3. Si `n8n_workflow_id` está vacío:
   - Llamar `resolveRulesForTool(storage, project_id, 'project_register_workflow', 'workflow_registry.when_to_register')` y con `'workflow_registry.how_to_create'`.
   - Construir prompt guía en español con header meta (opcional), sección `### Tu Tarea`, sección `### Contexto` (incluye `purpose` si vino), sección `### Reglas del Registry` (rules concatenadas), sección `### Próximos Pasos` explicando cómo re-llamar la tool.
4. Si `n8n_workflow_id` presente:
   - Validar `name` y `local_path` requeridos.
   - Validar formato de `name` (regex `/^[a-z0-9][a-z0-9-]*[a-z0-9]$/`).
   - Llamar `GET {n8n_url}/api/v1/workflows/{n8n_workflow_id}` para validar existencia. Si 404, error claro.
   - Llamar `storage.projectWorkflows.register({ project_id, name, description, n8n_workflow_id, local_path })`.
   - Resolver rules de `workflow_registry.after_registration`.
   - Retornar `JSON.stringify({ row, next_steps: rulesAfter })`.

### R7 — Tool `project_list_workflows` (ADD)

**Schema**: `{ project_id: string (required) }`.

**Descripción MCP**:
> "Lista los workflows de n8n registrados para el proyecto. Devuelve las filas del registry (nombre, descripción, `n8n_workflow_id`, `local_path`) más las reglas de uso para invocarlos."

**Lógica**:
1. Validar proyecto.
2. Llamar `storage.projectWorkflows.listByProject(project_id)`.
3. Resolver rules `workflow_registry.after_registration`.
4. Retornar `JSON.stringify({ workflows: rows, next_steps: rulesAfter })`.

### R8 — Tool `project_unregister_workflow` (ADD)

**Schema**: `{ project_id: string (required), name: string (required) }`.

**Descripción MCP**:
> "Elimina un workflow del registry de Jarvis para el proyecto. **NO borra el workflow en n8n** — solo lo quita de la lista de workflows disponibles para este proyecto. El workflow sigue activo en n8n y puede re-registrarse si hace falta."

**Lógica**:
1. Validar proyecto.
2. Llamar `storage.projectWorkflows.remove(project_id, name)`.
3. Si retornó `false`, error "workflow no estaba registrado".
4. Retornar `JSON.stringify({ removed: true, name, note: "El workflow sigue activo en n8n. Para borrarlo ahí, usá la UI de n8n directamente." })`.

### R9 — CLI `jarvis project workflow` (ADD)

Subcomandos:

- `jarvis project workflow add <name> --n8n-id <id> [--description <desc>] [--local-path <path>] [--project <project_id>]`
- `jarvis project workflow list [--project <project_id>] [--global]`
  - Sin flag: si `--project` viene o hay `.jarvis/project.json`, lista los del proyecto. Si no, error.
  - `--global`: llama `n8n_list_workflows` legacy — lista todos los workflows de n8n sin filtrar por proyecto.
- `jarvis project workflow remove <name> [--project <project_id>]`

Output en formato tabla. Si no se encuentra `project_id`, error con hint.

### R10 — Sync `jarvis mcp sync --project` corre seed + incluye workflows en el bloque (REPLACE)

En `packages/cli/src/commands/mcp.ts`, al renderizar el bloque para scope project:

1. **Antes** de construir el bloque: `storage.rules.seedWorkflowRegistryRules(project_id)` (idempotente).
2. **En el bloque**: agregar sección "## Workflows registrados (n8n)" con la lista de workflows del proyecto (`storage.projectWorkflows.listByProject`), formateado como:
   ```
   - `<name>` — <description>
   ```
   Si no hay workflows, omitir la sección.

### R11 — Descripción de la skill `n8n` actualizada (REPLACE)

Extender la descripción de la skill en `createN8nSkill` para mencionar las 3 tools nuevas y la separación entre "workflows de n8n globales" (vía `n8n_list_workflows`) y "workflows registrados por proyecto" (vía `project_list_workflows`).

## Scenarios

### S1 — Primera llamada a `project_register_workflow` sin `n8n_workflow_id` → modo guía

**Given** proyecto `lx` con integración `n8n` configurada.
**When** el LLM llama `project_register_workflow({ project_id: "lx", purpose: "automatizar deploy a staging" })`.
**Then** la respuesta es un prompt en español que contiene:
- Sección `### Tu Tarea` con instrucción de crear el JSON, subirlo a n8n, y re-llamar esta tool.
- Sección con las rules de `workflow_registry.when_to_register` (WR-W1..W4).
- Sección con las rules de `workflow_registry.how_to_create` (WR-H1..H6).
- Texto "automatizar deploy a staging" (el `purpose` recibido).
- NO hay fila nueva en `project_workflows`.

### S2 — Segunda llamada con `n8n_workflow_id` → persistencia

**Given** el LLM creó el workflow, lo subió a n8n, y capturó `n8n_workflow_id: "abc123"`.
**When** llama `project_register_workflow({ project_id: "lx", name: "deploy-staging", description: "Deploy a staging + migraciones + notificación Slack", n8n_workflow_id: "abc123", local_path: ".jarvis/workflows/deploy-staging.json" })`.
**Then**:
- Jarvis llamó `GET /api/v1/workflows/abc123` y recibió 200.
- Se insertó fila con `{ project_id: "lx", name: "deploy-staging", n8n_workflow_id: "abc123", local_path: ".jarvis/workflows/deploy-staging.json", created_at, updated_at }`.
- La respuesta contiene la fila + rules `workflow_registry.after_registration` (WR-A1, WR-A2).

### S3 — Validación de `n8n_workflow_id` inexistente

**Given** el LLM pasa `n8n_workflow_id: "non-existent-id"`.
**When** llama modo persistencia.
**Then**:
- Jarvis llama `GET /api/v1/workflows/non-existent-id` y recibe 404.
- Retorna error claro: "El workflow_id non-existent-id no existe en n8n. Verificá que lo subiste correctamente."
- NO inserta fila.

### S4 — Upsert al re-registrar

**Given** el workflow `deploy-staging` del proyecto `lx` ya existe con `n8n_workflow_id: "abc123"`.
**When** el LLM llama `project_register_workflow` con el mismo `name` pero `n8n_workflow_id: "xyz789"` (ejemplo: re-subió el JSON actualizado).
**Then**:
- Se ejecuta UPDATE: la fila queda con `n8n_workflow_id: "xyz789"`, `updated_at: <now>`. `created_at` queda igual.
- No se crea fila nueva (UNIQUE se respeta).

### S5 — Listar workflows del proyecto

**Given** proyecto `lx` con 2 workflows registrados (`deploy-staging`, `deploy-prod`).
**When** el LLM llama `project_list_workflows({ project_id: "lx" })`.
**Then** respuesta contiene:
- Array de 2 filas con nombre, descripción, `n8n_workflow_id`, `local_path`.
- Rules `workflow_registry.after_registration` como footer.

### S6 — Eliminar del registry sin tocar n8n

**Given** workflow `deploy-staging` registrado.
**When** el LLM llama `project_unregister_workflow({ project_id: "lx", name: "deploy-staging" })`.
**Then**:
- Se ejecuta DELETE en `project_workflows`.
- La respuesta contiene `{ removed: true, name: "deploy-staging", note: "El workflow sigue activo en n8n..." }`.
- El workflow sigue en n8n (Jarvis no llama a la API de n8n).

### S7 — Seed idempotente durante `jarvis mcp sync --project`

**Given** proyecto `lx` sin rules en categorías `workflow_registry.*`.
**When** se ejecuta `jarvis mcp sync --project` por primera vez.
**Then**:
- Se insertan 15 filas en `project_rules` con `project_id='lx'` y categorías `workflow_registry.*`.
- El bloque `CLAUDE.md` del proyecto se genera con la sección "Workflows registrados (n8n)" (vacía si no hay workflows).

**Given** se corre el sync por segunda vez sin cambios.
**When** sync idempotente.
**Then**:
- `INSERT OR IGNORE` no inserta filas duplicadas.
- La cantidad de filas en `project_rules` con `project_id='lx'` y `category LIKE 'workflow_registry.%'` sigue siendo 15.

### S8 — Migración de `project_rules` con UNIQUE

**Given** DB existente con filas en `project_rules` (sin UNIQUE).
**When** se carga el módulo de storage y corre la migración nueva.
**Then**:
- La tabla `project_rules` se recrea con `UNIQUE(project_id, category, rule)`.
- Filas existentes se preservan (deduplicadas si había duplicados exactos).
- El índice `idx_project_rules_project_id` se recrea.

### S9 — Bloque `CLAUDE.md` lista workflows

**Given** proyecto `lx` con 2 workflows registrados.
**When** se ejecuta `jarvis mcp sync --project`.
**Then** el bloque `CLAUDE.md` contiene sección:
```
## Workflows registrados (n8n)

- `deploy-staging` — Deploy a staging + migraciones + notificación Slack
- `deploy-prod` — Deploy a producción con backup y smoke test
```

### S10 — CLI `jarvis project workflow list`

**Given** proyecto `lx` sincronizado.
**When** se ejecuta `jarvis project workflow list --project lx`.
**Then** imprime tabla con columnas: nombre, descripción, `n8n_workflow_id`, `local_path`, ordenada por nombre.

### S11 — Proyecto sin integración n8n rechaza el register

**Given** proyecto `test-project` sin integración `n8n`.
**When** el LLM llama `project_register_workflow({ project_id: "test-project" })` (modo guía).
**Then** retorna error: "El proyecto test-project no tiene integración n8n configurada. Ejecutá `jarvis project integration add n8n --url <url> --api-key <key>` antes de continuar."

### S12 — CASCADE DELETE al borrar proyecto

**Given** proyecto `temp-project` con 3 workflows registrados.
**When** se ejecuta `jarvis project remove temp-project` (si existe, o se hace a mano con `DELETE FROM projects WHERE id='temp-project'`).
**Then**:
- Las 3 filas en `project_workflows` se eliminan automáticamente por `ON DELETE CASCADE`.

### S13 — `project_list_workflows` para proyecto sin workflows

**Given** proyecto recién creado sin workflows registrados.
**When** el LLM llama `project_list_workflows({ project_id: "new-proj" })`.
**Then** respuesta `{ workflows: [], next_steps: [rules WR-A1, WR-A2] }`.

### S14 — Validación de `name` en modo persistencia

**Given** el LLM pasa `name: "Deploy Staging"` (con espacios y mayúsculas).
**When** modo persistencia.
**Then** Jarvis retorna error: "El name 'Deploy Staging' no es válido. Debe estar en kebab-case (ej. 'deploy-staging'). Ver rule WR-H2."

## Glosario

- **Registry**: la tabla `project_workflows` en la DB de Jarvis.
- **Workflow**: JSON de definición de n8n. Vive en dos lugares: (a) `.jarvis/workflows/<name>.json` del repo (fuente de verdad del código), (b) en la instancia de n8n (runtime). El registry es el puntero.
- **Modo guía**: invocación de `project_register_workflow` sin `n8n_workflow_id`. Devuelve prompt.
- **Modo persistencia**: invocación con `n8n_workflow_id`. Inserta/actualiza en DB.
- **Seed**: inserción idempotente de las 15 rules iniciales durante `jarvis mcp sync --project`.
- **Upsert**: `INSERT ... ON CONFLICT DO UPDATE` sobre `(project_id, name)`.
