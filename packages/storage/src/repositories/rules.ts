import type BetterSqlite3 from "better-sqlite3";
import type { ProjectRule } from "../types.js";

// ---------------------------------------------------------------------------
// Seed data for workflow registry rules
// ---------------------------------------------------------------------------

const WORKFLOW_REGISTRY_SEED_RULES: Array<{
  category: string;
  rule: string;
  priority: number;
  tool_name: string;
}> = [
  // workflow_registry.when_to_register (WR-W1..W4)
  {
    category: 'workflow_registry.when_to_register',
    rule: 'Solo ofrecer registrar un workflow cuando el user explícitamente pida automatizar una tarea recurrente o un pipeline (deploy, notificación, validación). No ofrecer registrar para tareas únicas o exploratorias.',
    priority: 100,
    tool_name: 'project_register_workflow',
  },
  {
    category: 'workflow_registry.when_to_register',
    rule: 'Antes de proponer un workflow nuevo, llamar `project_list_workflows(project_id)` para verificar que no exista ya uno con el mismo propósito. Si existe uno similar, sugerir reusar o actualizar el existente en lugar de crear uno nuevo.',
    priority: 100,
    tool_name: 'project_register_workflow',
  },
  {
    category: 'workflow_registry.when_to_register',
    rule: 'Si el proyecto no tiene integración `n8n` configurada, informar al user que es requisito previo y sugerir ejecutar `jarvis project integration add n8n --url <url> --api-key <key>` antes de continuar.',
    priority: 100,
    tool_name: 'project_register_workflow',
  },
  {
    category: 'workflow_registry.when_to_register',
    rule: 'Antes de arrancar la creación del workflow, preguntar al user qué disparador (trigger) espera: manual, webhook, cron, evento externo. El trigger define la estructura inicial del JSON.',
    priority: 100,
    tool_name: 'project_register_workflow',
  },
  // workflow_registry.how_to_create (WR-H1..H6)
  {
    category: 'workflow_registry.how_to_create',
    rule: 'El JSON del workflow debe guardarse en `.jarvis/workflows/<kebab-case-name>.json` dentro del repo del proyecto. Si la carpeta no existe, crearla.',
    priority: 100,
    tool_name: 'project_register_workflow',
  },
  {
    category: 'workflow_registry.how_to_create',
    rule: 'El `name` del workflow debe ser único dentro del proyecto, en `kebab-case`, corto y descriptivo (ej. `deploy-staging`, `notify-pr-merged`). No usar espacios, mayúsculas, ni caracteres especiales distintos de `-`.',
    priority: 100,
    tool_name: 'project_register_workflow',
  },
  {
    category: 'workflow_registry.how_to_create',
    rule: 'La `description` debe responder en una oración: qué hace, cuándo dispararlo, qué input espera. Evitar descripciones genéricas tipo \'workflow de staging\'.',
    priority: 100,
    tool_name: 'project_register_workflow',
  },
  {
    category: 'workflow_registry.how_to_create',
    rule: 'No hardcodear secretos (API keys, tokens, passwords) en el JSON. Usar variables de entorno de n8n (`$env.XXX`) o credenciales referenciadas por nombre (`credentials`). Si detectás valores que parecen secretos en el JSON, advertir al user antes de subirlo.',
    priority: 100,
    tool_name: 'project_register_workflow',
  },
  {
    category: 'workflow_registry.how_to_create',
    rule: 'Después de guardar el JSON en el repo, subirlo a n8n con `POST {n8n_url}/api/v1/workflows` (incluyendo header `X-N8N-API-KEY`). Capturar el `id` devuelto. Luego activar con `POST {n8n_url}/api/v1/workflows/{id}/activate`.',
    priority: 100,
    tool_name: 'project_register_workflow',
  },
  {
    category: 'workflow_registry.how_to_create',
    rule: 'Si el workflow tiene un trigger `webhook`, informar al user la URL final del webhook (`{n8n_url}/webhook/{path}`) para que sepa cómo dispararlo desde su código.',
    priority: 100,
    tool_name: 'project_register_workflow',
  },
  // workflow_registry.what_to_persist (WR-P1..P4)
  {
    category: 'workflow_registry.what_to_persist',
    rule: 'El `n8n_workflow_id` debe ser el ID exacto que devolvió n8n al crear el workflow (string o número según la versión de n8n). No inventar IDs.',
    priority: 100,
    tool_name: 'project_register_workflow',
  },
  {
    category: 'workflow_registry.what_to_persist',
    rule: 'El `local_path` debe ser relativo al root del proyecto (ej. `.jarvis/workflows/deploy-staging.json`), sin `./` ni `/` inicial. No usar paths absolutos ni rutas fuera del repo.',
    priority: 100,
    tool_name: 'project_register_workflow',
  },
  {
    category: 'workflow_registry.what_to_persist',
    rule: 'La tool hace upsert por `(project_id, name)`: si ya existe un workflow con el mismo name en el mismo proyecto, se actualiza. Usar este comportamiento para re-registrar cuando el JSON del workflow cambió y fue re-subido a n8n con un nuevo ID.',
    priority: 100,
    tool_name: 'project_register_workflow',
  },
  {
    category: 'workflow_registry.what_to_persist',
    rule: 'Después del registro exitoso, ejecutar `jarvis mcp sync --project` para que el `CLAUDE.md` del proyecto refleje el nuevo workflow en el contexto del LLM.',
    priority: 100,
    tool_name: 'project_register_workflow',
  },
  // workflow_registry.after_registration (WR-A1..A2)
  {
    category: 'workflow_registry.after_registration',
    rule: 'Para ejecutar un workflow registrado, llamar `n8n_trigger_workflow(workflow_id=<n8n_workflow_id>, project_id=<id>, data={...})`. El `n8n_workflow_id` se obtiene de `project_list_workflows`.',
    priority: 100,
    tool_name: 'project_list_workflows',
  },
  {
    category: 'workflow_registry.after_registration',
    rule: 'Para ver el resultado de una ejecución, usar `n8n_get_execution_status(execution_id=<id>, project_id=<id>)` con el ID que devolvió el trigger.',
    priority: 100,
    tool_name: 'project_list_workflows',
  },
];

export function createRulesRepo(db: BetterSqlite3.Database) {
  // -------------------------------------------------------------------
  // Prepared statements
  // -------------------------------------------------------------------
  const stmtInsert = db.prepare<[string, string, string, number, string | null]>(
    `INSERT INTO project_rules (project_id, category, rule, priority, tool_name)
     VALUES (?, ?, ?, ?, ?)`,
  );

  const stmtGet = db.prepare<[number], ProjectRule>(
    "SELECT * FROM project_rules WHERE id = ?",
  );

  const stmtListAll = db.prepare<[string], ProjectRule>(
    "SELECT * FROM project_rules WHERE project_id = ? ORDER BY priority DESC",
  );

  const stmtListByCategory = db.prepare<[string, string], ProjectRule>(
    "SELECT * FROM project_rules WHERE project_id = ? AND category = ? ORDER BY priority DESC",
  );

  const stmtListByTool = db.prepare<[string, string], ProjectRule>(
    `SELECT * FROM project_rules WHERE project_id = ? AND (tool_name = ? OR tool_name IS NULL) ORDER BY priority DESC`,
  );

  const stmtListToolNames = db.prepare<[], { tool_name: string }>(
    "SELECT DISTINCT tool_name FROM project_rules WHERE tool_name IS NOT NULL",
  );

  const stmtRemove = db.prepare<[number]>(
    "DELETE FROM project_rules WHERE id = ?",
  );

  const stmtSeedInsert = db.prepare<[string, string, string, number, string]>(
    `INSERT OR IGNORE INTO project_rules (project_id, category, rule, priority, tool_name)
     VALUES (?, ?, ?, ?, ?)`,
  );

  const stmtUpdate = db.prepare(
    `UPDATE project_rules
        SET category = COALESCE(?, category),
            rule     = COALESCE(?, rule),
            priority = COALESCE(?, priority)
      WHERE id = ?`,
  );

  // -------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------

  function add(
    projectId: string,
    category: string,
    rule: string,
    priority = 0,
    toolName: string | null = null,
  ): ProjectRule {
    const result = stmtInsert.run(projectId, category, rule, priority, toolName);
    return stmtGet.get(Number(result.lastInsertRowid))!;
  }

  function list(projectId: string, category?: string): ProjectRule[] {
    if (category) {
      return stmtListByCategory.all(projectId, category);
    }
    return stmtListAll.all(projectId);
  }

  function listByTool(projectId: string, toolName: string): ProjectRule[] {
    return stmtListByTool.all(projectId, toolName);
  }

  function listToolNames(): string[] {
    return stmtListToolNames.all().map((row) => row.tool_name);
  }

  function remove(id: number): void {
    stmtRemove.run(id);
  }

  function update(
    id: number,
    data: Partial<Pick<ProjectRule, "category" | "rule" | "priority">>,
  ): ProjectRule | undefined {
    stmtUpdate.run(
      data.category ?? null,
      data.rule ?? null,
      data.priority ?? null,
      id,
    );
    return stmtGet.get(id);
  }

  function seedWorkflowRegistryRules(projectId: string): number {
    let totalChanges = 0;
    for (const seedRule of WORKFLOW_REGISTRY_SEED_RULES) {
      const result = stmtSeedInsert.run(
        projectId,
        seedRule.category,
        seedRule.rule,
        seedRule.priority,
        seedRule.tool_name,
      );
      totalChanges += result.changes;
    }
    return totalChanges;
  }

  return { add, list, listByTool, listToolNames, remove, update, seedWorkflowRegistryRules };
}
