import type BetterSqlite3 from 'better-sqlite3';
import type { ToolIntegration } from '../types.js';

export function createIntegrationsRepo(db: BetterSqlite3.Database) {
  const stmtFind = db.prepare<[string, string], ToolIntegration>(
    'SELECT * FROM tool_integrations WHERE project_id = ? AND service = ?'
  );

  const stmtInsert = db.prepare<[string, string, string]>(
    `INSERT INTO tool_integrations (project_id, service, config)
     VALUES (?, ?, ?)`
  );

  const stmtUpdate = db.prepare<[string, number]>(
    `UPDATE tool_integrations SET config = ?, updated_at = datetime('now') WHERE id = ?`
  );

  const stmtList = db.prepare<[string], ToolIntegration>(
    'SELECT * FROM tool_integrations WHERE project_id = ? ORDER BY service'
  );

  const stmtRemoveByService = db.prepare<[string, string]>(
    'DELETE FROM tool_integrations WHERE project_id = ? AND service = ?'
  );

  const stmtRemoveById = db.prepare<[number]>(
    'DELETE FROM tool_integrations WHERE id = ?'
  );

  const stmtGet = db.prepare<[number], ToolIntegration>(
    'SELECT * FROM tool_integrations WHERE id = ?'
  );

  // Upsert: one connection per project+service
  function set(projectId: string, service: string, config: Record<string, unknown>): ToolIntegration {
    const configJson = JSON.stringify(config);
    const existing = stmtFind.get(projectId, service);
    if (existing) {
      stmtUpdate.run(configJson, existing.id);
      return { ...existing, config: configJson, updated_at: new Date().toISOString() };
    }
    const result = stmtInsert.run(projectId, service, configJson);
    return stmtGet.get(Number(result.lastInsertRowid))!;
  }

  function get(projectId: string, service: string): ToolIntegration | undefined {
    return stmtFind.get(projectId, service);
  }

  // Helper to get parsed config
  function getConfig<T = Record<string, unknown>>(projectId: string, service: string): T | undefined {
    const integration = stmtFind.get(projectId, service);
    if (!integration) return undefined;
    return JSON.parse(integration.config) as T;
  }

  function list(projectId: string): ToolIntegration[] {
    return stmtList.all(projectId);
  }

  function remove(projectId: string, service: string): void {
    stmtRemoveByService.run(projectId, service);
  }

  function removeById(id: number): void {
    stmtRemoveById.run(id);
  }

  return { set, get, getConfig, list, remove, removeById };
}
