# Design — project-n8n-workflow-registry

## 1. Arquitectura

```
┌─────────────────────┐      MCP        ┌───────────────────────┐
│ LLM (Claude Code    │◄──────────────►│ n8n skill             │
│  en repo del        │                 │ packages/tools/n8n    │
│  proyecto)          │                 └──────┬────────────────┘
└─────────┬───────────┘                        │
          │ Write .jarvis/workflows/*.json     │
          │ POST /api/v1/workflows             ▼
          ▼                         ┌───────────────────────┐
     ┌─────────┐                    │ storage repos         │
     │ .jarvis │                    │ • projects            │
     │ folder  │                    │ • project_workflows   │◄── NUEVO
     │ local   │                    │ • rules (con UNIQUE)  │◄── MODIFICADO
     └─────────┘                    │ • integrations        │
                                    └──────┬────────────────┘
                                           │
                                           ▼
                                    ┌──────────────┐
                                    │ sqlite DB    │
                                    │ ~/.jarvis/   │
                                    │ jarvis.db    │
                                    └──────────────┘

          ┌───────────────────┐
          │ instancia n8n     │  ← el workflow real vive acá (activo, ejecutable)
          │ localhost:5678    │
          └───────────────────┘
```

- **LLM** es quien ejecuta todos los writes: el JSON local, el POST a n8n, y la llamada a `project_register_workflow`.
- **Jarvis** es passive store + guía: provee prompts con rules, valida existencia en n8n vía GET, persiste en DB.
- **n8n** es runtime: sólo acepta comandos HTTP, no sabe nada de Jarvis.
- **Registry** (`project_workflows`) es el puntero: `(project_id, name) → n8n_workflow_id`.

El diseño preserva la separación de responsabilidades: el agente trabaja en el repo, Jarvis coordina metadata, n8n ejecuta.

## 2. Decisiones de diseño

### D1 — Tool fusionada con bifurcación por presencia de `n8n_workflow_id`

**Problema**: el user pidió explícitamente "tool fusionada" (Q1 del refinamiento iterativo). Eso significa una sola tool `project_register_workflow` que hace dos cosas distintas según el input.

**Decisión**: bifurcar por presencia de `n8n_workflow_id` en el input.

```typescript
if (!n8n_workflow_id) {
  // Modo guía: retornar prompt
} else {
  // Modo persistencia: validar + insertar
}
```

**Pros**:
- Menos superficie de API (1 tool en lugar de 2).
- El LLM recibe la tool "registrar" y la puede invocar con inputs progresivos.
- Compatible con el patrón de descripción MCP "esta tool tiene dos modos".

**Cons** aceptados:
- La tool hace dos cosas. Mitigación: descripción MCP clara + schema con todos los campos opcionales menos `project_id`.
- Si el LLM se confunde y llama con datos parciales en modo persistencia, falla con error específico (validación explícita de cada campo requerido en ese modo).

**Alternativa rechazada**: dos tools separadas (`project_workflow_guide` + `project_register_workflow`). Rechazada por el user.

### D2 — `UNIQUE(project_id, name)` en `project_workflows` habilita upsert

**Problema**: el user pidió que re-registrar con el mismo name actualice la fila (rule WR-P3). Sin UNIQUE, el repo tendría que hacer SELECT-antes-de-INSERT en dos queries.

**Decisión**: UNIQUE habilita `INSERT ... ON CONFLICT(project_id, name) DO UPDATE SET ...` en un solo statement.

**SQLite specifics**: `ON CONFLICT` requiere SQLite ≥ 3.24 (2018). El `better-sqlite3` del repo (check en `package.json`) trae una versión moderna. Cero riesgo.

### D3 — Migración de `project_rules` para agregar UNIQUE

**Problema**: `project_rules` existe sin UNIQUE. Agregarlo requiere recrear la tabla (SQLite no soporta `ALTER TABLE ADD CONSTRAINT`).

**Decisión**: patrón estándar de SQLite:

```typescript
try {
  const tableSchema = db.prepare("SELECT sql FROM sqlite_master WHERE name='project_rules'")
                        .get() as { sql?: string } | undefined;

  if (tableSchema?.sql && !tableSchema.sql.includes('UNIQUE(project_id, category, rule)')) {
    db.exec(`
      BEGIN;
      CREATE TABLE project_rules_new (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id TEXT    NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        category   TEXT    NOT NULL,
        rule       TEXT    NOT NULL,
        priority   INTEGER DEFAULT 0,
        tool_name  TEXT,
        UNIQUE(project_id, category, rule)
      );
      INSERT INTO project_rules_new (id, project_id, category, rule, priority, tool_name)
      SELECT MIN(id), project_id, category, rule, MAX(priority), tool_name
      FROM project_rules
      GROUP BY project_id, category, rule, tool_name;
      DROP TABLE project_rules;
      ALTER TABLE project_rules_new RENAME TO project_rules;
      CREATE INDEX idx_project_rules_project_id ON project_rules(project_id);
      COMMIT;
    `);
  }
} catch (e) {
  // si falla, dejar como estaba y loggear (el seed posterior va a fallar, lo cual también alerta)
}
```

**Deduplicación**: si existen filas con `(project_id, category, rule)` idéntico, se colapsan en una con el `id` mínimo y el `priority` máximo. Ordenación estable garantizada por `MIN(id)`.

**Detección**: leer `sqlite_master.sql` de la tabla y ver si contiene `UNIQUE(project_id, category, rule)`. Solo migra si falta.

### D4 — Seed idempotente de rules durante `mcp sync --project`

**Problema**: las rules son por-proyecto (decisión G2). ¿Cuándo se insertan? En el momento más natural para el user: cuando corre `jarvis mcp sync --project` (que ya hace por todos los proyectos nuevos al primer uso).

**Decisión**: el comando `mcp sync --project` llama a `storage.rules.seedWorkflowRegistryRules(project_id)` ANTES de renderizar el bloque `CLAUDE.md`.

El método `seedWorkflowRegistryRules` ejecuta 15 `INSERT OR IGNORE` con el `project_id` recibido. Gracias al UNIQUE, re-runs son no-op.

**Alternativa rechazada**: lazy seed la primera vez que se llama `project_register_workflow` con un `project_id` que no tiene rules. Rechazada porque: (a) agrega complejidad a la tool, (b) el user prefiere disparar el seed manualmente al sincronizar, (c) el sync es el canal canónico de "adoptar este proyecto en Jarvis".

### D5 — Descripciones MCP en español, siguiendo el patrón i18n

El cambio `refine-prompts-i18n` ya estableció: descripciones en español, aclarar qué hace la tool, mencionar los modos explícitamente. Las 3 tools nuevas siguen ese patrón.

Prompt de modo guía también en español, con sección `### Tu Tarea` al inicio, consistente con las 4 tools prompt-builder existentes.

### D6 — Validación de `n8n_workflow_id` vía GET a n8n

**Problema**: si el LLM pasa un `n8n_workflow_id` inventado, Jarvis lo persiste sin validar → registro inconsistente.

**Decisión**: en modo persistencia, antes de insertar, hacer `GET {n8n_url}/api/v1/workflows/{n8n_workflow_id}`. Si 404, error claro. Si ≥500, retornar error "no pude verificar con n8n" sin insertar.

**Trade-off**: agrega 1 request HTTP sincrónico al flujo. Aceptable: las operaciones de registro son infrecuentes (no está en el hot path).

### D7 — `project_unregister_workflow` NO toca n8n

**Problema**: si la tool también borra en n8n, el user puede destruir workflows por error.

**Decisión**: solo DELETE en DB. Retornar mensaje claro de que el workflow sigue vivo en n8n.

**Alternativa rechazada**: flag `--also-delete-in-n8n`. Rechazada por el user (D3 original).

### D8 — Bloque CLAUDE.md con sección de workflows

**Problema**: el contexto del LLM necesita saber qué workflows tiene disponibles. Hoy el bloque scope-project solo lista integraciones.

**Decisión**: agregar sección "## Workflows registrados (n8n)" con lista de `name — description`. Si no hay workflows, sección se omite.

**Hash del bloque**: la extensión modifica el contenido → el hash cambia → `--check` detecta drift. Esto es correcto: cuando registrás un workflow nuevo, el `CLAUDE.md` queda desactualizado hasta re-sincronizar.

### D9 — Helper HTTP reutilizable para n8n

**Estado actual**: `packages/tools/n8n/src/index.ts` hace fetch inline en cada case. Agregar 3 tools más implicaría replicar la lógica.

**Decisión**: extraer `n8nFetch(config, method, path, body?)` en un helper local del archivo (no exportado). Usado por:
- GET `/api/v1/workflows/:id` (validación en `project_register_workflow`).
- Reutilizable para futuras tools sin duplicar boilerplate.

**No se exporta**: es detalle de implementación de la skill. Si en el futuro otra skill necesita llamar a n8n, se extrae a `packages/core/src/n8n-client.ts` en un cambio separado.

## 3. Interfaces

### `ProjectWorkflowRow` (en `types.ts`)

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

### Repo `createProjectWorkflowsRepo`

```typescript
export interface ProjectWorkflowsRepo {
  register(input: {
    project_id: string;
    name: string;
    description?: string | null;
    n8n_workflow_id: string;
    local_path?: string | null;
  }): ProjectWorkflowRow;
  listByProject(project_id: string): ProjectWorkflowRow[];
  getByName(project_id: string, name: string): ProjectWorkflowRow | null;
  remove(project_id: string, name: string): boolean;
}
```

### Pseudocódigo de `register` (upsert)

```typescript
function register(input): ProjectWorkflowRow {
  return db.transaction((): ProjectWorkflowRow => {
    const existing = stmtGetByName.get(input.project_id, input.name);
    if (existing) {
      stmtUpdate.run({
        description: input.description ?? null,
        n8n_workflow_id: input.n8n_workflow_id,
        local_path: input.local_path ?? null,
        id: existing.id,
      });
      return stmtGetById.get(existing.id);
    } else {
      const result = stmtInsert.run({
        project_id: input.project_id,
        name: input.name,
        description: input.description ?? null,
        n8n_workflow_id: input.n8n_workflow_id,
        local_path: input.local_path ?? null,
      });
      return stmtGetById.get(result.lastInsertRowid as number);
    }
  })();
}
```

### Helper HTTP `n8nFetch` (en `packages/tools/n8n/src/index.ts`)

```typescript
async function n8nFetch(
  config: N8nConfig,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ ok: boolean; status: number; data: unknown; error?: string }> {
  const url = `${config.url}${path}`;
  try {
    const res = await fetch(url, {
      method,
      headers: buildHeaders(config.apiKey),
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = res.ok ? await res.json() : null;
    return { ok: res.ok, status: res.status, data };
  } catch (err) {
    return { ok: false, status: 0, data: null, error: String(err) };
  }
}
```

### Prompt de modo guía (ejemplo)

```
<!-- refine:meta
tool: project_register_workflow
mode: guide
project: lx
-->

## Registrar workflow de n8n para el proyecto lx

### Tu Tarea

Sos el encargado de crear y registrar un workflow de n8n para el proyecto lx. Seguí los pasos abajo en orden. NO ejecutes el paso final (registrar en Jarvis) hasta tener el `n8n_workflow_id` real que n8n te devuelva al crear el workflow. Respondé en español.

### Contexto

Propósito del workflow: automatizar deploy a staging

### Reglas del Registry (cuándo registrar)

- WR-W1: Solo ofrecer registrar un workflow cuando el user explícitamente pida...
- WR-W2: Antes de proponer un workflow nuevo, llamar `project_list_workflows(project_id)`...
- WR-W3: Si el proyecto no tiene integración `n8n` configurada...
- WR-W4: Antes de arrancar la creación del workflow, preguntar al user qué disparador...

### Reglas del Registry (cómo crear)

- WR-H1: El JSON del workflow debe guardarse en `.jarvis/workflows/<kebab-case-name>.json`...
- WR-H2: El `name` debe ser único, en kebab-case...
- WR-H3: La `description` debe responder en una oración...
- WR-H4: No hardcodear secretos...
- WR-H5: Después de guardar el JSON, subirlo a n8n con POST `/api/v1/workflows` + activar...
- WR-H6: Si tiene trigger webhook, informar al user la URL...

### Próximos pasos

Cuando hayas creado el JSON, subido a n8n y capturado el `n8n_workflow_id`, volvé a llamar esta tool con:

project_register_workflow({
  project_id: "lx",
  name: "<kebab-case-name>",
  description: "<una oración>",
  n8n_workflow_id: "<id de n8n>",
  local_path: ".jarvis/workflows/<name>.json"
})
```

## 4. Testing strategy

### Unit (storage)
- `register` inserta fila nueva; upsert actualiza cuando `(project_id, name)` existe.
- `listByProject` ordena por name.
- `getByName` retorna null si no existe.
- `remove` retorna true/false según haya borrado.
- `seedWorkflowRegistryRules` inserta 15 filas; corrida idempotente retorna 0 nuevas.
- CASCADE DELETE: eliminar proyecto borra sus workflows.
- Migración de `project_rules`: test con fixture que tiene tabla vieja, corre migración, verifica UNIQUE y que filas se preservan.

### Unit (tool `project_register_workflow`)
- Modo guía: sin `n8n_workflow_id` → retorna prompt con `### Tu Tarea` + rules concatenadas.
- Modo guía respeta `purpose` y lo inyecta.
- Modo persistencia: rechaza `name` inválido (no kebab-case).
- Modo persistencia: rechaza `n8n_workflow_id` que 404 en n8n (mock `fetch`).
- Modo persistencia exitoso: inserta fila + retorna `{ row, next_steps }`.
- Upsert: segunda llamada con mismo name actualiza.

### Unit (tool `project_list_workflows`)
- Proyecto sin workflows retorna array vacío + rules.
- Proyecto con 2 workflows retorna array ordenado por name.

### Unit (tool `project_unregister_workflow`)
- Workflow existente se borra, retorna `{ removed: true }`.
- Workflow inexistente retorna error.
- n8n NO se llama (mock de fetch no debe tener calls).

### Integration (DB + mock n8n)
- Secuencia completa: guide → LLM "crea workflow" → persist → list → trigger (mock) → get status (mock).

### CLI
- `jarvis project workflow add` — manual (no hay suite).
- `jarvis mcp sync --project` corre seed: verificar rules insertadas en DB + bloque CLAUDE.md incluye sección de workflows.

## 5. Rollout

### Orden de implementación recomendado

1. **Fase 1 — Storage**: tipos + migración de `project_rules` + nueva tabla `project_workflows` + repo + seed + tests.
2. **Fase 2 — Skill n8n**: helper `n8nFetch` + 3 tools nuevas + prompt builder + descripciones MCP + tests.
3. **Fase 3 — CLI**: subcomandos `jarvis project workflow` + extensión de `mcp sync --project` (seed + render).
4. **Fase 4 — Docs**: `mcp-instructions.md` + actualizar descripción de skill n8n en catálogo.
5. **Fase 5 — Verify**: tests integrados + smoke manual + build de todos los paquetes afectados.

### Rollback

`git revert` del commit. La tabla `project_workflows` queda huérfana sin código que la use (inocua). La migración de `project_rules` es destructiva (recrear tabla). Si hay que rollback DESPUÉS de que haya datos en `project_workflows`, el rollback del código no borra filas — hacer `DROP TABLE project_workflows` manual. Las rules seed quedan; limpiar con `DELETE FROM project_rules WHERE category LIKE 'workflow_registry.%'` si se desea.

## 6. Open questions

Ninguna. Todas las Q/D cerradas en el refinamiento iterativo con el user.
