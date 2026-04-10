import type BetterSqlite3 from "better-sqlite3";
import type { Output, SaveOutputInput } from "../types.js";

export function createOutputsRepo(db: BetterSqlite3.Database) {
  // -------------------------------------------------------------------
  // Prepared statements
  // -------------------------------------------------------------------
  const stmtInsert = db.prepare<
    [string | null, string | null, string, string | null, string]
  >(
    `INSERT INTO outputs (session_id, project_id, type, reference, content)
     VALUES (?, ?, ?, ?, ?)`,
  );

  const stmtGet = db.prepare<[number], Output>(
    "SELECT * FROM outputs WHERE id = ?",
  );

  const stmtListAll = db.prepare<[], Output>(
    "SELECT * FROM outputs ORDER BY created_at DESC",
  );

  const stmtListByProject = db.prepare<[string], Output>(
    "SELECT * FROM outputs WHERE project_id = ? ORDER BY created_at DESC",
  );

  const stmtListByType = db.prepare<[string], Output>(
    "SELECT * FROM outputs WHERE type = ? ORDER BY created_at DESC",
  );

  const stmtListByProjectAndType = db.prepare<[string, string], Output>(
    "SELECT * FROM outputs WHERE project_id = ? AND type = ? ORDER BY created_at DESC",
  );

  // -------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------

  function save(data: SaveOutputInput): Output {
    const result = stmtInsert.run(
      data.session_id ?? null,
      data.project_id ?? null,
      data.type,
      data.reference ?? null,
      data.content,
    );
    return stmtGet.get(Number(result.lastInsertRowid))!;
  }

  function list(projectId?: string | null, type?: string | null): Output[] {
    if (projectId && type) {
      return stmtListByProjectAndType.all(projectId, type);
    }
    if (projectId) {
      return stmtListByProject.all(projectId);
    }
    if (type) {
      return stmtListByType.all(type);
    }
    return stmtListAll.all();
  }

  function get(id: number): Output | undefined {
    return stmtGet.get(id);
  }

  return { save, list, get };
}
