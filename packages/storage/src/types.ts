// ---------------------------------------------------------------------------
// Entity interfaces
// ---------------------------------------------------------------------------

export interface CognitiveBase {
  id: number;
  content: string;
  version: number;
  created_at: string;
  is_active: number; // 0 | 1
}

export interface Project {
  id: string;
  name: string;
  description: string | null;
  sector: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface ProjectStack {
  id: number;
  project_id: string;
  layer: string;
  value: string;
  notes: string | null;
}

export interface ProjectRule {
  id: number;
  project_id: string;
  category: string;
  rule: string;
  priority: number;
  tool_name: string | null;
}

/** @deprecated Use ToolIntegration instead */
export interface ProjectIntegration {
  id: number;
  project_id: string;
  type: string;
  key: string;
  value: string;
  notes: string | null;
}

export interface ToolIntegration {
  id: number;
  project_id: string;
  service: string;
  config: string; // JSON string
  created_at: string;
  updated_at: string;
}

export interface JiraServiceConfig {
  site: string;
  email: string;
}

export interface N8nServiceConfig {
  url: string;
  api_key: string;
}

export interface GithubServiceConfig {
  repo: string;
  token?: string;
}

export type ServiceConfig = JiraServiceConfig | N8nServiceConfig | GithubServiceConfig;

export interface ProjectKnowledge {
  id: number;
  project_id: string;
  title: string;
  content: string;
  tags: string | null; // JSON array string
  created_at: string;
  updated_at: string;
}

export interface Session {
  id: string;
  project_id: string | null;
  title: string | null;
  created_at: string;
  updated_at: string;
}

export interface Message {
  id: number;
  session_id: string;
  role: string;
  content: string;
  tool_calls: string | null; // JSON string
  created_at: string;
}

export interface Output {
  id: number;
  session_id: string | null;
  project_id: string | null;
  type: string;
  reference: string | null;
  content: string;
  created_at: string;
}

export interface ToolExecution {
  id: number;
  session_id: string | null;
  tool_name: string;
  input_json: string | null;
  output_json: string | null;
  duration_ms: number | null;
  error: string | null;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Input types
// ---------------------------------------------------------------------------

export interface CreateProjectInput {
  id: string;
  name: string;
  description?: string | null;
  sector?: string | null;
  status?: string;
}

export interface SaveOutputInput {
  session_id?: string | null;
  project_id?: string | null;
  type: string;
  reference?: string | null;
  content: string;
}

export interface AIConfig {
  id: number;
  provider: string;
  api_key: string | null;
  base_url: string | null;
  model: string;
  is_active: number;
  created_at: string;
  updated_at: string;
}

export interface ProjectWorkflowRow {
  id: number;
  project_id: string;
  name: string;
  description: string | null;
  n8n_workflow_id: string;
  local_path: string | null;
  created_at: string;
  updated_at: string;
}

export interface RefinementRow {
  id: number;
  thread_id: string;
  iteration: number;
  project_id: string | null;
  requirements: string | null;
  instructions: string | null;
  output: string | null;
  status: 'in_progress' | 'completed';
  parent_id: number | null;
  created_at: string;
}

export interface SaveRefinementInput {
  thread_id: string;
  project_id?: string | null;
  requirements?: string | null;
  instructions?: string | null;
  output: string;
}

// ---------------------------------------------------------------------------
// Composite types
// ---------------------------------------------------------------------------

export interface ProjectContext {
  project: Project;
  stack: ProjectStack[];
  rules: ProjectRule[];
  integrations: ToolIntegration[];
  knowledge: ProjectKnowledge[];
}
