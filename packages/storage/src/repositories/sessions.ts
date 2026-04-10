import type BetterSqlite3 from "better-sqlite3";
import { v4 as uuidv4 } from "uuid";
import type { Message, Session } from "../types.js";

export function createSessionsRepo(db: BetterSqlite3.Database) {
  // -------------------------------------------------------------------
  // Prepared statements
  // -------------------------------------------------------------------
  const stmtInsert = db.prepare<[string, string | null, string | null]>(
    `INSERT INTO sessions (id, project_id, title) VALUES (?, ?, ?)`,
  );

  const stmtGet = db.prepare<[string], Session>(
    "SELECT * FROM sessions WHERE id = ?",
  );

  const stmtListAll = db.prepare<[], Session>(
    "SELECT * FROM sessions ORDER BY updated_at DESC",
  );

  const stmtListByProject = db.prepare<[string], Session>(
    "SELECT * FROM sessions WHERE project_id = ? ORDER BY updated_at DESC",
  );

  const stmtAddMessage = db.prepare<
    [string, string, string, string | null]
  >(
    `INSERT INTO messages (session_id, role, content, tool_calls)
     VALUES (?, ?, ?, ?)`,
  );

  const stmtUpdateSessionTimestamp = db.prepare<[string]>(
    `UPDATE sessions SET updated_at = datetime('now') WHERE id = ?`,
  );

  const stmtGetMessages = db.prepare<[string], Message>(
    "SELECT * FROM messages WHERE session_id = ? ORDER BY created_at ASC",
  );

  const stmtUpdateTitle = db.prepare<[string, string]>(
    `UPDATE sessions SET title = ?, updated_at = datetime('now') WHERE id = ?`,
  );

  // -------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------

  function create(projectId?: string | null, title?: string | null): Session {
    const id = uuidv4();
    stmtInsert.run(id, projectId ?? null, title ?? null);
    return stmtGet.get(id)!;
  }

  function get(id: string): Session | undefined {
    return stmtGet.get(id);
  }

  function list(projectId?: string | null): Session[] {
    if (projectId) {
      return stmtListByProject.all(projectId);
    }
    return stmtListAll.all();
  }

  function addMessage(
    sessionId: string,
    role: string,
    content: string,
    toolCalls?: string | null,
  ): Message {
    const result = stmtAddMessage.run(
      sessionId,
      role,
      content,
      toolCalls ?? null,
    );
    stmtUpdateSessionTimestamp.run(sessionId);
    return {
      id: Number(result.lastInsertRowid),
      session_id: sessionId,
      role,
      content,
      tool_calls: toolCalls ?? null,
      created_at: new Date().toISOString(),
    };
  }

  function getMessages(sessionId: string): Message[] {
    return stmtGetMessages.all(sessionId);
  }

  function updateTitle(sessionId: string, title: string): Session | undefined {
    stmtUpdateTitle.run(title, sessionId);
    return stmtGet.get(sessionId);
  }

  return { create, get, list, addMessage, getMessages, updateTitle };
}
