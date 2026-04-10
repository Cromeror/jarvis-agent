// Tool definition that skills register
export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

// What the ContextResolver returns
export interface ResolvedContext {
  systemPrompt: string;
  availableTools: ToolDefinition[];
  projectId: string | null;
}

// Skill registration
export interface Skill {
  name: string;
  description: string;
  tools: ToolDefinition[];
  // The executor function: takes tool name + input, returns result string
  execute: (toolName: string, input: Record<string, unknown>) => Promise<string>;
}

// Config for JARVIS
export interface JarvisConfig {
  dbPath: string;
  anthropicApiKey: string;
  model: string;
  maxTokens: number;
}

// Re-export storage types that other packages need
export type {
  CognitiveBase,
  Project,
  ProjectContext,
  ProjectStack,
  ProjectRule,
  ProjectIntegration,
  ProjectKnowledge,
  Session,
  Message,
  Output,
  ToolExecution,
  CreateProjectInput,
  SaveOutputInput,
  Storage,
} from '@jarvis/storage';
