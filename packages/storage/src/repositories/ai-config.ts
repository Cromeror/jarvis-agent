import type BetterSqlite3 from 'better-sqlite3';
import type { AIConfig } from '../types.js';

export function createAIConfigRepo(db: BetterSqlite3.Database) {
  const stmtInsert = db.prepare<[string, string | null, string | null, string, number]>(
    `INSERT INTO ai_config (provider, api_key, base_url, model, is_active)
     VALUES (?, ?, ?, ?, ?)`
  );

  const stmtGet = db.prepare<[number], AIConfig>(
    'SELECT * FROM ai_config WHERE id = ?'
  );

  const stmtGetActive = db.prepare<[], AIConfig>(
    'SELECT * FROM ai_config WHERE is_active = 1 LIMIT 1'
  );

  const stmtGetByProvider = db.prepare<[string], AIConfig>(
    'SELECT * FROM ai_config WHERE provider = ? ORDER BY updated_at DESC LIMIT 1'
  );

  const stmtList = db.prepare<[], AIConfig>(
    'SELECT * FROM ai_config ORDER BY is_active DESC, updated_at DESC'
  );

  const stmtDeactivateAll = db.prepare(
    'UPDATE ai_config SET is_active = 0, updated_at = datetime(\'now\')'
  );

  const stmtActivate = db.prepare<[number]>(
    'UPDATE ai_config SET is_active = 1, updated_at = datetime(\'now\') WHERE id = ?'
  );

  const stmtUpdate = db.prepare(
    `UPDATE ai_config SET
       provider = COALESCE(?, provider),
       api_key  = COALESCE(?, api_key),
       base_url = COALESCE(?, base_url),
       model    = COALESCE(?, model),
       updated_at = datetime('now')
     WHERE id = ?`
  );

  const stmtRemove = db.prepare<[number]>(
    'DELETE FROM ai_config WHERE id = ?'
  );

  // Use transactions for activate (deactivate all first, then activate one)
  const activateTransaction = db.transaction((id: number) => {
    stmtDeactivateAll.run();
    stmtActivate.run(id);
  });

  function save(
    provider: string,
    model: string,
    apiKey?: string | null,
    baseUrl?: string | null,
    activate = true,
  ): AIConfig {
    // Check if provider already has a config
    const existing = stmtGetByProvider.get(provider);
    if (existing) {
      // Update existing
      stmtUpdate.run(provider, apiKey ?? null, baseUrl ?? null, model, existing.id);
      if (activate) {
        activateTransaction(existing.id);
      }
      return stmtGet.get(existing.id)!;
    }

    // Insert new
    if (activate) {
      stmtDeactivateAll.run();
    }
    const result = stmtInsert.run(provider, apiKey ?? null, baseUrl ?? null, model, activate ? 1 : 0);
    return stmtGet.get(Number(result.lastInsertRowid))!;
  }

  function getActive(): AIConfig | undefined {
    return stmtGetActive.get();
  }

  function getByProvider(provider: string): AIConfig | undefined {
    return stmtGetByProvider.get(provider);
  }

  function list(): AIConfig[] {
    return stmtList.all();
  }

  function activate(id: number): void {
    activateTransaction(id);
  }

  function remove(id: number): void {
    stmtRemove.run(id);
  }

  return { save, getActive, getByProvider, list, activate, remove };
}
