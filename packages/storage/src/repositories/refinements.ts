import type BetterSqlite3 from "better-sqlite3";
import type { RefinementRow, SaveRefinementInput } from "../types.js";

export function createRefinementsRepo(db: BetterSqlite3.Database) {
  // ---------------------------------------------------------------------------
  // Prepared statements
  // ---------------------------------------------------------------------------

  const stmtGetNextIteration = db.prepare<[string], { next: number | null }>(
    `SELECT MAX(iteration) + 1 AS next FROM refinements WHERE thread_id = ?`,
  );

  const stmtInsert = db.prepare<
    [string, number, string | null, string | null, string | null, string | null, number | null]
  >(
    `INSERT INTO refinements (thread_id, iteration, project_id, requirements, instructions, output, parent_id)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );

  const stmtGetById = db.prepare<[number], RefinementRow>(
    `SELECT * FROM refinements WHERE id = ?`,
  );

  const stmtGetLatest = db.prepare<[string], RefinementRow>(
    `SELECT * FROM refinements WHERE thread_id = ? ORDER BY iteration DESC LIMIT 1`,
  );

  const stmtListByThread = db.prepare<[string], RefinementRow>(
    `SELECT * FROM refinements WHERE thread_id = ? ORDER BY iteration ASC`,
  );

  const stmtGetThreadStatus = db.prepare<[string], { status: string }>(
    `SELECT status FROM refinements WHERE thread_id = ? ORDER BY iteration DESC LIMIT 1`,
  );

  const stmtFinalize = db.prepare<[string]>(
    `UPDATE refinements SET status = 'completed' WHERE thread_id = ?`,
  );

  const stmtReopenThread = db.prepare<[string]>(
    `UPDATE refinements SET status = 'in_progress' WHERE thread_id = ?`,
  );

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  function getNextIteration(threadId: string): number {
    const row = stmtGetNextIteration.get(threadId);
    return row?.next ?? 1;
  }

  function getLatest(threadId: string): RefinementRow | null {
    return stmtGetLatest.get(threadId) ?? null;
  }

  function save(input: SaveRefinementInput): RefinementRow {
    return db.transaction((): RefinementRow => {
      const currentStatus = getThreadStatus(input.thread_id);
      if (currentStatus === 'completed') {
        stmtReopenThread.run(input.thread_id);
      }

      const iteration = getNextIteration(input.thread_id);
      const latest = getLatest(input.thread_id);
      const parentId = latest?.id ?? null;

      const result = stmtInsert.run(
        input.thread_id,
        iteration,
        input.project_id ?? null,
        input.requirements ?? null,
        input.instructions ?? null,
        input.output,
        parentId,
      );

      return stmtGetById.get(Number(result.lastInsertRowid))!;
    })();
  }

  function listByThread(threadId: string): RefinementRow[] {
    return stmtListByThread.all(threadId);
  }

  function getThreadStatus(threadId: string): 'in_progress' | 'completed' | null {
    const row = stmtGetThreadStatus.get(threadId);
    if (!row) return null;
    return row.status as 'in_progress' | 'completed';
  }

  function finalize(threadId: string): void {
    const existing = getLatest(threadId);
    if (!existing) {
      throw new Error(`Thread ${threadId} no existe`);
    }
    stmtFinalize.run(threadId);
  }

  return { save, getLatest, listByThread, getThreadStatus, finalize, getNextIteration };
}
