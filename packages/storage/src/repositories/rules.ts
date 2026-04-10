import type BetterSqlite3 from "better-sqlite3";
import type { ProjectRule } from "../types.js";

export function createRulesRepo(db: BetterSqlite3.Database) {
  // -------------------------------------------------------------------
  // Prepared statements
  // -------------------------------------------------------------------
  const stmtInsert = db.prepare<[string, string, string, number]>(
    `INSERT INTO project_rules (project_id, category, rule, priority)
     VALUES (?, ?, ?, ?)`,
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

  const stmtRemove = db.prepare<[number]>(
    "DELETE FROM project_rules WHERE id = ?",
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
  ): ProjectRule {
    const result = stmtInsert.run(projectId, category, rule, priority);
    return stmtGet.get(Number(result.lastInsertRowid))!;
  }

  function list(projectId: string, category?: string): ProjectRule[] {
    if (category) {
      return stmtListByCategory.all(projectId, category);
    }
    return stmtListAll.all(projectId);
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

  return { add, list, remove, update };
}
