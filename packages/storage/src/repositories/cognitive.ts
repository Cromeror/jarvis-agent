import type BetterSqlite3 from "better-sqlite3";
import type { CognitiveBase } from "../types.js";

export function createCognitiveRepo(db: BetterSqlite3.Database) {
  // -------------------------------------------------------------------
  // Prepared statements
  // -------------------------------------------------------------------
  const stmtGetActive = db.prepare<[], CognitiveBase>(
    "SELECT * FROM cognitive_base WHERE is_active = 1 LIMIT 1",
  );

  const stmtGetHistory = db.prepare<[], CognitiveBase>(
    "SELECT * FROM cognitive_base ORDER BY version DESC",
  );

  const stmtDeactivateAll = db.prepare(
    "UPDATE cognitive_base SET is_active = 0 WHERE is_active = 1",
  );

  const stmtMaxVersion = db.prepare<[], { max_version: number | null }>(
    "SELECT MAX(version) AS max_version FROM cognitive_base",
  );

  const stmtInsert = db.prepare<[string, number]>(
    "INSERT INTO cognitive_base (content, version, is_active) VALUES (?, ?, 1)",
  );

  // -------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------

  function getActive(): CognitiveBase | undefined {
    return stmtGetActive.get();
  }

  function update(content: string): CognitiveBase {
    const row = stmtMaxVersion.get();
    const nextVersion = (row?.max_version ?? 0) + 1;

    const txn = db.transaction(() => {
      stmtDeactivateAll.run();
      stmtInsert.run(content, nextVersion);
    });
    txn();

    return getActive()!;
  }

  function getHistory(): CognitiveBase[] {
    return stmtGetHistory.all();
  }

  return { getActive, update, getHistory };
}
