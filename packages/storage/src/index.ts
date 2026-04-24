import type BetterSqlite3 from "better-sqlite3";
import { initDatabase } from "./database.js";
import { createAIConfigRepo } from "./repositories/ai-config.js";
import { createCognitiveRepo } from "./repositories/cognitive.js";
import { createIntegrationsRepo } from "./repositories/integrations.js";
import { createKnowledgeRepo } from "./repositories/knowledge.js";
import { createOutputsRepo } from "./repositories/outputs.js";
import { createProjectWorkflowsRepo } from "./repositories/project-workflows.js";
import { createProjectsRepo } from "./repositories/projects.js";
import { createRefinementsRepo } from "./repositories/refinements.js";
import { createRulesRepo } from "./repositories/rules.js";
import { createSessionsRepo } from "./repositories/sessions.js";
import { createStackRepo } from "./repositories/stack.js";
import { createToolExecutionsRepo } from "./repositories/tool-executions.js";
import { seedDatabase } from "./seed.js";

// Re-export all types
export type {
  AIConfig,
  CognitiveBase,
  CreateProjectInput,
  GithubServiceConfig,
  JiraServiceConfig,
  Message,
  N8nServiceConfig,
  Output,
  Project,
  ProjectContext,
  ProjectIntegration,
  ProjectKnowledge,
  ProjectRule,
  ProjectStack,
  ProjectWorkflowRow,
  RefinementRow,
  SaveOutputInput,
  SaveRefinementInput,
  ServiceConfig,
  Session,
  ToolExecution,
  ToolIntegration,
} from "./types.js";

// Re-export database initializer
export { initDatabase } from "./database.js";
export { seedDatabase } from "./seed.js";
export { applyDefaults } from "./seeds/apply-defaults.js";
export type { ApplyDefaultsOptions, ApplyDefaultsResult } from "./seeds/apply-defaults.js";

// ---------------------------------------------------------------------------
// Storage type
// ---------------------------------------------------------------------------

export interface Storage {
  db: BetterSqlite3.Database;
  cognitive: ReturnType<typeof createCognitiveRepo>;
  projects: ReturnType<typeof createProjectsRepo>;
  stack: ReturnType<typeof createStackRepo>;
  rules: ReturnType<typeof createRulesRepo>;
  integrations: ReturnType<typeof createIntegrationsRepo>;
  knowledge: ReturnType<typeof createKnowledgeRepo>;
  projectWorkflows: ReturnType<typeof createProjectWorkflowsRepo>;
  sessions: ReturnType<typeof createSessionsRepo>;
  outputs: ReturnType<typeof createOutputsRepo>;
  toolExecutions: ReturnType<typeof createToolExecutionsRepo>;
  aiConfig: ReturnType<typeof createAIConfigRepo>;
  refinements: ReturnType<typeof createRefinementsRepo>;
  seed: () => void;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Initialize the SQLite database and return a fully wired storage object
 * with all repositories ready to use.
 */
export function createStorage(dbPath: string): Storage {
  const db = initDatabase(dbPath);

  return {
    db,
    cognitive: createCognitiveRepo(db),
    projects: createProjectsRepo(db),
    stack: createStackRepo(db),
    rules: createRulesRepo(db),
    integrations: createIntegrationsRepo(db),
    knowledge: createKnowledgeRepo(db),
    projectWorkflows: createProjectWorkflowsRepo(db),
    sessions: createSessionsRepo(db),
    outputs: createOutputsRepo(db),
    toolExecutions: createToolExecutionsRepo(db),
    aiConfig: createAIConfigRepo(db),
    refinements: createRefinementsRepo(db),
    seed: () => seedDatabase(db),
  };
}
