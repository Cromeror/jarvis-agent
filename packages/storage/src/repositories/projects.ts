import type BetterSqlite3 from "better-sqlite3";
import type {
  CreateProjectInput,
  Project,
  ProjectContext,
  ProjectKnowledge,
  ProjectRule,
  ProjectStack,
  ToolIntegration,
} from "../types.js";

export function createProjectsRepo(db: BetterSqlite3.Database) {
  // -------------------------------------------------------------------
  // Prepared statements
  // -------------------------------------------------------------------
  const stmtInsert = db.prepare<
    [string, string, string | null, string | null, string]
  >(
    `INSERT INTO projects (id, name, description, sector, status)
     VALUES (?, ?, ?, ?, ?)`,
  );

  const stmtGet = db.prepare<[string], Project>(
    "SELECT * FROM projects WHERE id = ?",
  );

  const stmtListAll = db.prepare<[], Project>(
    "SELECT * FROM projects ORDER BY created_at DESC",
  );

  const stmtListByStatus = db.prepare<[string], Project>(
    "SELECT * FROM projects WHERE status = ? ORDER BY created_at DESC",
  );

  const stmtUpdate = db.prepare(
    `UPDATE projects
        SET name        = COALESCE(?, name),
            description = COALESCE(?, description),
            sector      = COALESCE(?, sector),
            status      = COALESCE(?, status),
            updated_at  = datetime('now')
      WHERE id = ?`,
  );

  const stmtArchive = db.prepare(
    `UPDATE projects SET status = 'archived', updated_at = datetime('now') WHERE id = ?`,
  );

  const stmtStack = db.prepare<[string], ProjectStack>(
    "SELECT * FROM project_stack WHERE project_id = ?",
  );

  const stmtRules = db.prepare<[string], ProjectRule>(
    "SELECT * FROM project_rules WHERE project_id = ? ORDER BY priority DESC",
  );

  const stmtIntegrations = db.prepare<[string], ToolIntegration>(
    "SELECT * FROM tool_integrations WHERE project_id = ? ORDER BY service",
  );

  const stmtKnowledge = db.prepare<[string], ProjectKnowledge>(
    "SELECT * FROM project_knowledge WHERE project_id = ? ORDER BY created_at DESC",
  );

  // -------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------

  function create(data: CreateProjectInput): Project {
    stmtInsert.run(
      data.id,
      data.name,
      data.description ?? null,
      data.sector ?? null,
      data.status ?? "active",
    );
    return stmtGet.get(data.id)!;
  }

  function get(id: string): Project | undefined {
    return stmtGet.get(id);
  }

  function list(filters?: { status?: string }): Project[] {
    if (filters?.status) {
      return stmtListByStatus.all(filters.status);
    }
    return stmtListAll.all();
  }

  function update(
    id: string,
    data: Partial<Pick<Project, "name" | "description" | "sector" | "status">>,
  ): Project | undefined {
    stmtUpdate.run(
      data.name ?? null,
      data.description ?? null,
      data.sector ?? null,
      data.status ?? null,
      id,
    );
    return stmtGet.get(id);
  }

  function archive(id: string): Project | undefined {
    stmtArchive.run(id);
    return stmtGet.get(id);
  }

  function getFullContext(id: string): ProjectContext | undefined {
    const project = stmtGet.get(id);
    if (!project) return undefined;

    return {
      project,
      stack: stmtStack.all(id),
      rules: stmtRules.all(id),
      integrations: stmtIntegrations.all(id),
      knowledge: stmtKnowledge.all(id),
    };
  }

  return { create, get, list, update, archive, getFullContext };
}
