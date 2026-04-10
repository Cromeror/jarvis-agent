import type BetterSqlite3 from "better-sqlite3";
import type { ProjectIntegration } from "../types.js";

export function createIntegrationsRepo(db: BetterSqlite3.Database) {
  // -------------------------------------------------------------------
  // Prepared statements
  // -------------------------------------------------------------------
  const stmtFind = db.prepare<[string, string, string], ProjectIntegration>(
    "SELECT * FROM project_integrations WHERE project_id = ? AND type = ? AND key = ?",
  );

  const stmtInsert = db.prepare<
    [string, string, string, string, string | null]
  >(
    `INSERT INTO project_integrations (project_id, type, key, value, notes)
     VALUES (?, ?, ?, ?, ?)`,
  );

  const stmtUpdate = db.prepare<[string, string | null, number]>(
    `UPDATE project_integrations SET value = ?, notes = COALESCE(?, notes) WHERE id = ?`,
  );

  const stmtGetByType = db.prepare<[string, string], ProjectIntegration>(
    "SELECT * FROM project_integrations WHERE project_id = ? AND type = ?",
  );

  const stmtList = db.prepare<[string], ProjectIntegration>(
    "SELECT * FROM project_integrations WHERE project_id = ?",
  );

  const stmtRemove = db.prepare<[number]>(
    "DELETE FROM project_integrations WHERE id = ?",
  );

  // -------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------

  /** Upsert: update if project+type+key exists, insert otherwise. */
  function set(
    projectId: string,
    type: string,
    key: string,
    value: string,
    notes?: string | null,
  ): ProjectIntegration {
    const existing = stmtFind.get(projectId, type, key);
    if (existing) {
      stmtUpdate.run(value, notes ?? null, existing.id);
      return { ...existing, value, notes: notes ?? existing.notes };
    }
    const result = stmtInsert.run(
      projectId,
      type,
      key,
      value,
      notes ?? null,
    );
    return {
      id: Number(result.lastInsertRowid),
      project_id: projectId,
      type,
      key,
      value,
      notes: notes ?? null,
    };
  }

  function get(projectId: string, type: string): ProjectIntegration[] {
    return stmtGetByType.all(projectId, type);
  }

  function list(projectId: string): ProjectIntegration[] {
    return stmtList.all(projectId);
  }

  function remove(id: number): void {
    stmtRemove.run(id);
  }

  return { set, get, list, remove };
}
