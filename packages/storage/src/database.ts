import Database from "better-sqlite3";
import type BetterSqlite3 from "better-sqlite3";

/**
 * Open (or create) a SQLite database at `dbPath`, apply all schema
 * migrations and return the ready-to-use Database instance.
 */
export function initDatabase(dbPath: string): BetterSqlite3.Database {
  const db = new Database(dbPath);

  // Performance / concurrency
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  // ------------------------------------------------------------------
  // Schema
  // ------------------------------------------------------------------

  db.exec(`
    CREATE TABLE IF NOT EXISTS cognitive_base (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      content    TEXT    NOT NULL,
      version    INTEGER NOT NULL,
      created_at TEXT    NOT NULL DEFAULT (datetime('now')),
      is_active  INTEGER DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS projects (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      description TEXT,
      sector      TEXT,
      status      TEXT DEFAULT 'active',
      created_at  TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS project_stack (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      layer      TEXT NOT NULL,
      value      TEXT NOT NULL,
      notes      TEXT
    );

    CREATE TABLE IF NOT EXISTS project_rules (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id TEXT    NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      category   TEXT    NOT NULL,
      rule       TEXT    NOT NULL,
      priority   INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS project_integrations (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      type       TEXT NOT NULL,
      key        TEXT NOT NULL,
      value      TEXT NOT NULL,
      notes      TEXT
    );

    -- Migration v2: structured tool integrations replacing key-value project_integrations
    CREATE TABLE IF NOT EXISTS tool_integrations (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      service    TEXT NOT NULL,
      config     TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(project_id, service)
    );

    CREATE TABLE IF NOT EXISTS project_knowledge (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      title      TEXT NOT NULL,
      content    TEXT NOT NULL,
      tags       TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id         TEXT PRIMARY KEY,
      project_id TEXT REFERENCES projects(id),
      title      TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS messages (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      role       TEXT NOT NULL,
      content    TEXT NOT NULL,
      tool_calls TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS outputs (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT REFERENCES sessions(id),
      project_id TEXT REFERENCES projects(id),
      type       TEXT NOT NULL,
      reference  TEXT,
      content    TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS tool_executions (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id  TEXT REFERENCES sessions(id),
      tool_name   TEXT NOT NULL,
      input_json  TEXT,
      output_json TEXT,
      duration_ms INTEGER,
      error       TEXT,
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS ai_config (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      provider   TEXT NOT NULL,
      api_key    TEXT,
      base_url   TEXT,
      model      TEXT NOT NULL,
      is_active  INTEGER DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // ------------------------------------------------------------------
  // Indices
  // ------------------------------------------------------------------

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_messages_session_id
      ON messages(session_id);

    CREATE INDEX IF NOT EXISTS idx_project_stack_project_id
      ON project_stack(project_id);

    CREATE INDEX IF NOT EXISTS idx_project_rules_project_id
      ON project_rules(project_id);

    CREATE INDEX IF NOT EXISTS idx_project_integrations_project_id
      ON project_integrations(project_id);

    CREATE INDEX IF NOT EXISTS idx_tool_integrations_project_id
      ON tool_integrations(project_id);

    CREATE INDEX IF NOT EXISTS idx_project_knowledge_project_id
      ON project_knowledge(project_id);

    CREATE INDEX IF NOT EXISTS idx_outputs_project_id
      ON outputs(project_id);

    CREATE INDEX IF NOT EXISTS idx_outputs_session_id
      ON outputs(session_id);

    CREATE INDEX IF NOT EXISTS idx_tool_executions_session_id
      ON tool_executions(session_id);
  `);

  // ------------------------------------------------------------------
  // Additive migrations
  // ------------------------------------------------------------------

  try {
    db.exec(`ALTER TABLE project_rules ADD COLUMN tool_name TEXT`);
  } catch {
    // Column already exists — ignore
  }

  return db;
}
