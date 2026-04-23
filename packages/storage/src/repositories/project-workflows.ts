import type BetterSqlite3 from "better-sqlite3";
import type { ProjectWorkflowRow } from "../types.js";

export function createProjectWorkflowsRepo(db: BetterSqlite3.Database) {
  // -------------------------------------------------------------------
  // Prepared statements
  // -------------------------------------------------------------------

  const stmtInsert = db.prepare<{
    project_id: string;
    name: string;
    description: string | null;
    n8n_workflow_id: string;
    local_path: string | null;
  }>(
    `INSERT INTO project_workflows (project_id, name, description, n8n_workflow_id, local_path)
     VALUES (@project_id, @name, @description, @n8n_workflow_id, @local_path)`,
  );

  const stmtUpdate = db.prepare<{
    description: string | null;
    n8n_workflow_id: string;
    local_path: string | null;
    id: number;
  }>(
    `UPDATE project_workflows
        SET description     = @description,
            n8n_workflow_id = @n8n_workflow_id,
            local_path      = @local_path,
            updated_at      = datetime('now')
      WHERE id = @id`,
  );

  const stmtGetByName = db.prepare<[string, string], ProjectWorkflowRow>(
    "SELECT * FROM project_workflows WHERE project_id = ? AND name = ?",
  );

  const stmtGetById = db.prepare<[number], ProjectWorkflowRow>(
    "SELECT * FROM project_workflows WHERE id = ?",
  );

  const stmtListByProject = db.prepare<[string], ProjectWorkflowRow>(
    "SELECT * FROM project_workflows WHERE project_id = ? ORDER BY name ASC",
  );

  const stmtRemove = db.prepare<[string, string]>(
    "DELETE FROM project_workflows WHERE project_id = ? AND name = ?",
  );

  // -------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------

  function register(input: {
    project_id: string;
    name: string;
    description?: string | null;
    n8n_workflow_id: string;
    local_path?: string | null;
  }): ProjectWorkflowRow {
    return db.transaction((): ProjectWorkflowRow => {
      const existing = stmtGetByName.get(input.project_id, input.name);
      if (existing) {
        stmtUpdate.run({
          description: input.description ?? null,
          n8n_workflow_id: input.n8n_workflow_id,
          local_path: input.local_path ?? null,
          id: existing.id,
        });
        return stmtGetById.get(existing.id)!;
      } else {
        const result = stmtInsert.run({
          project_id: input.project_id,
          name: input.name,
          description: input.description ?? null,
          n8n_workflow_id: input.n8n_workflow_id,
          local_path: input.local_path ?? null,
        });
        return stmtGetById.get(result.lastInsertRowid as number)!;
      }
    })();
  }

  function listByProject(project_id: string): ProjectWorkflowRow[] {
    return stmtListByProject.all(project_id);
  }

  function getByName(project_id: string, name: string): ProjectWorkflowRow | null {
    return stmtGetByName.get(project_id, name) ?? null;
  }

  function remove(project_id: string, name: string): boolean {
    const result = stmtRemove.run(project_id, name);
    return result.changes > 0;
  }

  return { register, listByProject, getByName, remove };
}
