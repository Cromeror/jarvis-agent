# Proposal — project-n8n-workflow-registry

## 1. Intent

Habilitar que cada proyecto registrado en Jarvis tenga su propio registry de workflows de n8n — workflows específicos que el proyecto usa para automatizar tareas recurrentes (deploys, notificaciones, validaciones, etc.). Hoy las 3 tools `n8n_*` existentes son genéricas: operan sobre la instancia de n8n sin relación con el proyecto. Un agente (Claude) que trabaja dentro de un proyecto no tiene forma fácil de descubrir "qué workflows tiene este proyecto disponibles" ni de mantener la lista sincronizada al incorporarse.

Este cambio introduce:

- Una tabla `project_workflows` en la DB de Jarvis que relaciona proyectos con workflows registrados en n8n (el workflow real vive en n8n; Jarvis guarda el puntero).
- Una tool MCP `project_register_workflow` con **doble modo**: modo guía (devuelve prompt con instrucciones sobre cómo crear el JSON, subirlo a n8n y volver a registrarlo) y modo persistencia (inserta en DB cuando el LLM trae `n8n_workflow_id`). La bifurcación es implícita: detecta el modo por la presencia de `n8n_workflow_id`.
- Dos tools MCP adicionales: `project_list_workflows` (lista los del proyecto) y `project_unregister_workflow` (elimina del registry sin tocar n8n).
- CLI equivalente (`jarvis project workflow add|list|remove`).
- Extensión del `jarvis mcp sync --project` para que el bloque `CLAUDE.md` del proyecto liste los workflows registrados (mejora el contexto del LLM).
- Seed idempotente de 15 rules iniciales (categorías `workflow_registry.*`) que guían al LLM sobre cuándo, cómo y qué datos persistir. Las rules se insertan **por proyecto** durante el sync.

Con esto, el flujo esperado queda:

```
LLM en Claude Code (dentro del repo lx):
  1. "Quiero automatizar el deploy a staging."
  2. Llama project_register_workflow(project_id="lx") → recibe prompt guía.
  3. Crea .jarvis/workflows/deploy-staging.json en el repo (Write tool).
  4. Sube a n8n con POST /api/v1/workflows, captura el ID.
  5. Llama project_register_workflow(project_id="lx", name="deploy-staging",
       description="...", n8n_workflow_id="abc123",
       local_path=".jarvis/workflows/deploy-staging.json") → persiste.
  6. En una sesión posterior, descubre el workflow con project_list_workflows
     y lo ejecuta con n8n_trigger_workflow.
```

## 2. Scope

### In-scope

1. **Storage**
   - Tabla `project_workflows`: `id`, `project_id` (FK cascade), `name`, `description`, `n8n_workflow_id`, `local_path`, `created_at`, `updated_at`. Constraint `UNIQUE(project_id, name)` para habilitar upsert.
   - Repo `createProjectWorkflowsRepo` con `register` (upsert por `project_id + name`), `listByProject`, `getByName`, `remove`.
   - Tipo `ProjectWorkflowRow`.
   - Migración aditiva siguiendo el patrón de `database.ts` (try/catch con `CREATE TABLE IF NOT EXISTS`).

2. **Rules seed idempotente**
   - Agregar constraint `UNIQUE(project_id, category, rule)` a `project_rules` para habilitar `INSERT OR IGNORE`. Esto implica recrear la tabla en la migración (SQLite no soporta agregar constraint a tabla existente).
   - Seed de las 15 rules iniciales (`WR-W1..W4`, `WR-H1..H6`, `WR-P1..P4`, `WR-A1..A2`) durante el `jarvis mcp sync --project` **por proyecto**. Cada rule con `tool_name` apropiado.

3. **Tools MCP** (extender `packages/tools/n8n/src/index.ts`)
   - `project_register_workflow`:
     - Sin `n8n_workflow_id` → modo guía: retorna prompt en español con `### Tu Tarea` + rules de `workflow_registry.when_to_register` + `workflow_registry.how_to_create`.
     - Con `n8n_workflow_id` → modo persistencia: upsert en DB. Valida que el `n8n_workflow_id` existe en n8n (GET `/api/v1/workflows/:id`). Retorna fila insertada + rules de `workflow_registry.after_registration`.
   - `project_list_workflows(project_id)`: lista los del proyecto. Retorna filas + rules de `workflow_registry.after_registration` como footer.
   - `project_unregister_workflow(project_id, name)`: elimina la fila del registry. NO borra en n8n. Confirma al LLM que el workflow sigue vivo en n8n.

4. **CLI**
   - `jarvis project workflow add <name> --n8n-id <id> --description <desc> --local-path <path> [--project <id>]`
   - `jarvis project workflow list [--project <id>] [--global]` — extiende el listado actual de `n8n_list_workflows`: modo global mantiene el comportamiento actual (todos los workflows de n8n); modo proyecto lista los del registry de Jarvis.
   - `jarvis project workflow remove <name> [--project <id>]`

5. **Sync CLAUDE.md**
   - Extender `renderBlock` scope project en `packages/cli/src/commands/mcp.ts` para incluir sección "Workflows registrados" con los nombres + descripciones.
   - Durante el sync, correr el seed idempotente de rules: `INSERT OR IGNORE` las 15 rules con `project_id` del proyecto sincronizado. Idempotente por el UNIQUE.

6. **Docs**
   - Sección nueva en `packages/docs/mcp-instructions.md` sobre el registry.
   - Actualizar descripción de la skill `n8n` en el catálogo.

7. **Tests**
   - Storage: CRUD, upsert, cascade delete, UNIQUE.
   - Tools: modo guía, modo persistencia, validación de `n8n_workflow_id`, seed idempotente.
   - CLI: manual (no hay suite).

### Out-of-scope

1. **Validación de `local_path` en disco** (G1.1 aceptada).
2. **Columna `projects.path`**. No se agrega. Seguimos confiando en `process.cwd()` en el CLI.
3. **Rules globales** (`project_id IS NULL`). Seed por-proyecto.
4. **Invocación de workflows**. Se usa `n8n_trigger_workflow` existente.
5. **Sync bidireccional n8n → Jarvis**. Si alguien borra un workflow en n8n directamente, el registry queda huérfano hasta que se corra `project_unregister_workflow`.
6. **Input schemas por workflow**. El agente consulta el JSON del repo si necesita saber los inputs.
7. **Versionado de workflows**. Un registro por `(project_id, name)`. Actualizar implica re-subir a n8n + llamar `project_register_workflow` de nuevo (upsert).
8. **UI/dashboard**.

## 3. Approach

### Seeding idempotente durante el sync

El disparador del seed es el comando `jarvis mcp sync --project`. Hoy ese comando:

1. Resuelve `project_id` (desde `.jarvis/project.json` o flag).
2. Lee integraciones y las inyecta en el bloque `CLAUDE.md` del proyecto.

Se le agrega un paso: antes de renderizar el bloque, llamar `storage.rules.seedWorkflowRegistryRules(project_id)` que ejecuta 15 `INSERT OR IGNORE INTO project_rules ...`. Idempotente.

Si querés forzar re-seed después de editar las rules base, se hace manualmente con `jarvis rules remove` + `jarvis mcp sync --project`.

### Arquitectura de la tool fusionada

```typescript
// pseudocódigo dentro del switch
case 'project_register_workflow': {
  const { project_id, name, description, n8n_workflow_id, local_path, purpose } = input;
  if (!project_id) return error("project_id required");

  // Modo guía
  if (!n8n_workflow_id) {
    const rules = resolveRulesForTool(storage, project_id, 'project_register_workflow',
                                       'workflow_registry.when_to_register');
    const rulesHow = resolveRulesForTool(storage, project_id, 'project_register_workflow',
                                          'workflow_registry.how_to_create');
    return buildGuidancePrompt({ purpose, rules, rulesHow });
  }

  // Modo persistencia
  if (!name || !n8n_workflow_id || !local_path) return error("missing fields for persistence");
  await verifyN8nWorkflowExists(config, n8n_workflow_id); // GET /api/v1/workflows/:id
  const row = storage.projectWorkflows.register({ project_id, name, description, n8n_workflow_id, local_path });
  const rulesAfter = resolveRulesForTool(storage, project_id, 'project_register_workflow',
                                          'workflow_registry.after_registration');
  return JSON.stringify({ row, next_steps_rules: rulesAfter });
}
```

### Archivos afectados

- `packages/storage/src/database.ts` — nueva tabla + migración de `project_rules` con UNIQUE.
- `packages/storage/src/types.ts` — `ProjectWorkflowRow`.
- `packages/storage/src/repositories/project-workflows.ts` — nuevo repo.
- `packages/storage/src/repositories/rules.ts` — método `seedWorkflowRegistryRules(projectId)`.
- `packages/storage/src/index.ts` — exposición del nuevo repo.
- `packages/storage/src/__tests__/` — tests del nuevo repo + seed.
- `packages/tools/n8n/src/index.ts` — 3 tools nuevas + rules con `resolveRulesForTool`.
- `packages/tools/n8n/src/__tests__/` — tests del modo guía y modo persistencia.
- `packages/cli/src/commands/project-workflow.ts` — nuevo (o extensión de `project.ts`).
- `packages/cli/src/commands/mcp.ts` — seed en sync + render de workflows en bloque project.
- `packages/cli/src/index.ts` — registrar subcomandos `jarvis project workflow`.
- `packages/docs/mcp-instructions.md` — sección del registry.

## 4. Key decisions

| Decisión | Elección | Racional |
|---|---|---|
| Tool fusionada vs. dos tools | Fusionada con bifurcación por presencia de `n8n_workflow_id` | Q1 del user. Menos superficie de API. |
| Validación de `local_path` en disco | No (G1.1) | Q de gap resuelta. Menos código. El path es metadata; trazabilidad queda en rule WR-H1. |
| Columna `projects.path` | No se agrega | Derivada de G1.1. |
| Rules globales vs. por-proyecto | Por-proyecto (seed durante sync) | Q3 + alternativa G2. No toca schema. |
| Seed idempotente | `UNIQUE(project_id, category, rule)` + `INSERT OR IGNORE` | Previene duplicados en re-runs. SQLite-friendly. |
| Ubicación de las tools nuevas | Skill `n8n` existente | Q D1 del user. Mismo dominio. |
| Eliminación con `project_unregister_workflow` | Solo DB, no n8n | Q D3. Evita destrucción accidental. |
| Sync CLAUDE.md incluye workflows | Sí | Q D4. Mejora contexto del LLM. |
| Forma de trabajo | SDD completo | Q D5. Toca storage + tools + CLI + docs. |
| Nombre del cambio | `project-n8n-workflow-registry` | Q D6. |

## 5. Affected packages

- `packages/storage` — tabla nueva + migración de rules + repo + tests.
- `packages/tools/n8n` — 3 tools nuevas + prompt builders + tests.
- `packages/cli` — subcomandos nuevos + extensión de sync.
- `packages/core` — catálogo regenerado automáticamente (sin cambios manuales).
- `packages/docs` — `mcp-instructions.md`.

Post-deploy: `jarvis mcp sync` para propagar el catálogo. Seed de rules se dispara al correr `jarvis mcp sync --project` en cada proyecto.

## 6. Risks & rollback

### Riesgos

1. **Migración destructiva de `project_rules`** (agregar `UNIQUE(project_id, category, rule)` requiere recrear la tabla en SQLite). El cambio copia filas existentes, pero si hay duplicados reales hoy, fallan. Mitigación: durante la migración, `SELECT` con `GROUP BY project_id, category, rule` + `INSERT ... ON CONFLICT DO NOTHING`. Si se encuentran duplicados, se insertan solo únicos — se **pierden** duplicados pero no datos útiles.
2. **LLM miente en `local_path`** → registro inconsistente. Aceptado por G1.1. Mitigación: rule WR-H1 explícita, prompt del modo guía recuerda la convención.
3. **Seed de rules al sincronizar un proyecto sobreescribe rules custom del user** → riesgo mitigado por `INSERT OR IGNORE` (no toca filas existentes). Si el user borró WR-W1 a mano, el próximo sync la re-inserta. Feature, no bug — el user puede editar la rule re-insertando con misma `(project_id, category)` pero texto distinto (queda una rule vieja y una nueva; el user borra la vieja con `jarvis rules remove`).
4. **Desincronización entre n8n y el registry**: borrar el workflow en n8n deja un registro huérfano. No hay sync automático. Aceptado como out-of-scope. Mitigación: `project_unregister_workflow` es el camino canónico.

### Rollback

`git revert` del commit. La tabla `project_workflows` queda con datos pero sin código que la use. La tabla `project_rules` vuelve sin UNIQUE — SQLite tolera el desvío porque no hay constraint activa. Si es crítico, `DROP TABLE project_workflows` + manual cleanup de rules con `category LIKE 'workflow_registry.%'`.

## 7. Non-goals

- No automatizar la creación del JSON de n8n. El LLM lo escribe desde su contexto.
- No pre-poblar workflows comunes (deploy, notify). El user decide qué automatiza.
- No proveer UI.
- No introducir dependencias nuevas (`node-fetch`, etc.). Se usa lo que ya está.
- No tocar el workflow `jira-analyze-ticket` del skill jira. Es un workflow de sistema, ajeno a este registry por proyecto.
- No auto-subir el JSON a n8n desde Jarvis. Lo hace el LLM (más flexible: el LLM puede decidir nombre, activación, credenciales).
