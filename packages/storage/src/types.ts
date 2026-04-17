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

export interface ProjectIntegration {
  id: number;
  project_id: string;
  type: string;
  key: string;
  value: string;
  notes: string | null;
}

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

// ---------------------------------------------------------------------------
// Composite types
// ---------------------------------------------------------------------------

export interface ProjectContext {
  project: Project;
  stack: ProjectStack[];
  rules: ProjectRule[];
  integrations: ProjectIntegration[];
  knowledge: ProjectKnowledge[];
}
