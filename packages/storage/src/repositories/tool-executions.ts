import type BetterSqlite3 from "better-sqlite3";
import type { ToolExecution } from "../types.js";

export function createToolExecutionsRepo(db: BetterSqlite3.Database) {
  // -------------------------------------------------------------------
  // Prepared statements
  // -------------------------------------------------------------------
  const stmtInsert = db.prepare<
    [
      string | null,
      string,
      string | null,
      string | null,
      number | null,
      string | null,
    ]
  >(
    `INSERT INTO tool_executions (session_id, tool_name, input_json, output_json, duration_ms, error)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );

  const stmtGet = db.prepare<[number], ToolExecution>(
    "SELECT * FROM tool_executions WHERE id = ?",
  );

  const stmtList = db.prepare<[string], ToolExecution>(
    "SELECT * FROM tool_executions WHERE session_id = ? ORDER BY created_at ASC",
  );

  // -------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------

  function save(data: {
    session_id?: string | null;
    tool_name: string;
    input_json?: string | null;
    output_json?: string | null;
    duration_ms?: number | null;
    error?: string | null;
  }): ToolExecution {
    const result = stmtInsert.run(
      data.session_id ?? null,
      data.tool_name,
      data.input_json ?? null,
      data.output_json ?? null,
      data.duration_ms ?? null,
      data.error ?? null,
    );
    return stmtGet.get(Number(result.lastInsertRowid))!;
  }

  function list(sessionId: string): ToolExecution[] {
    return stmtList.all(sessionId);
  }

  function get(id: number): ToolExecution | undefined {
    return stmtGet.get(id);
  }

  return { save, list, get };
}
