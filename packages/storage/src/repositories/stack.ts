import type BetterSqlite3 from "better-sqlite3";
import type { ProjectStack } from "../types.js";

export function createStackRepo(db: BetterSqlite3.Database) {
  // -------------------------------------------------------------------
  // Prepared statements
  // -------------------------------------------------------------------
  const stmtFind = db.prepare<[string, string], ProjectStack>(
    "SELECT * FROM project_stack WHERE project_id = ? AND layer = ?",
  );

  const stmtInsert = db.prepare<[string, string, string, string | null]>(
    `INSERT INTO project_stack (project_id, layer, value, notes)
     VALUES (?, ?, ?, ?)`,
  );

  const stmtUpdate = db.prepare<[string, string | null, number]>(
    `UPDATE project_stack SET value = ?, notes = COALESCE(?, notes) WHERE id = ?`,
  );

  const stmtList = db.prepare<[string], ProjectStack>(
    "SELECT * FROM project_stack WHERE project_id = ?",
  );

  const stmtRemove = db.prepare<[number]>(
    "DELETE FROM project_stack WHERE id = ?",
  );

  // -------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------

  /** Upsert: update if project+layer exists, insert otherwise. */
  function set(
    projectId: string,
    layer: string,
    value: string,
    notes?: string | null,
  ): ProjectStack {
    const existing = stmtFind.get(projectId, layer);
    if (existing) {
      stmtUpdate.run(value, notes ?? null, existing.id);
      return { ...existing, value, notes: notes ?? existing.notes };
    }
    const result = stmtInsert.run(projectId, layer, value, notes ?? null);
    return {
      id: Number(result.lastInsertRowid),
      project_id: projectId,
      layer,
      value,
      notes: notes ?? null,
    };
  }

  function list(projectId: string): ProjectStack[] {
    return stmtList.all(projectId);
  }

  function remove(id: number): void {
    stmtRemove.run(id);
  }

  return { set, list, remove };
}
