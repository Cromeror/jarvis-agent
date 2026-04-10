import type BetterSqlite3 from "better-sqlite3";
import type { ProjectKnowledge } from "../types.js";

export function createKnowledgeRepo(db: BetterSqlite3.Database) {
  // -------------------------------------------------------------------
  // Prepared statements
  // -------------------------------------------------------------------
  const stmtInsert = db.prepare<[string, string, string, string | null]>(
    `INSERT INTO project_knowledge (project_id, title, content, tags)
     VALUES (?, ?, ?, ?)`,
  );

  const stmtGet = db.prepare<[number], ProjectKnowledge>(
    "SELECT * FROM project_knowledge WHERE id = ?",
  );

  const stmtSearch = db.prepare<[string, string, string], ProjectKnowledge>(
    `SELECT * FROM project_knowledge
      WHERE project_id = ?
        AND (title LIKE ? OR content LIKE ?)
      ORDER BY updated_at DESC`,
  );

  const stmtUpdate = db.prepare(
    `UPDATE project_knowledge
        SET title      = COALESCE(?, title),
            content    = COALESCE(?, content),
            tags       = COALESCE(?, tags),
            updated_at = datetime('now')
      WHERE id = ?`,
  );

  const stmtRemove = db.prepare<[number]>(
    "DELETE FROM project_knowledge WHERE id = ?",
  );

  // -------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------

  function add(
    projectId: string,
    title: string,
    content: string,
    tags?: string[],
  ): ProjectKnowledge {
    const tagsJson = tags ? JSON.stringify(tags) : null;
    const result = stmtInsert.run(projectId, title, content, tagsJson);
    return stmtGet.get(Number(result.lastInsertRowid))!;
  }

  function search(projectId: string, query: string): ProjectKnowledge[] {
    const pattern = `%${query}%`;
    return stmtSearch.all(projectId, pattern, pattern);
  }

  function get(id: number): ProjectKnowledge | undefined {
    return stmtGet.get(id);
  }

  function update(
    id: number,
    data: Partial<Pick<ProjectKnowledge, "title" | "content" | "tags">>,
  ): ProjectKnowledge | undefined {
    stmtUpdate.run(
      data.title ?? null,
      data.content ?? null,
      data.tags ?? null,
      id,
    );
    return stmtGet.get(id);
  }

  function remove(id: number): void {
    stmtRemove.run(id);
  }

  return { add, search, get, update, remove };
}
