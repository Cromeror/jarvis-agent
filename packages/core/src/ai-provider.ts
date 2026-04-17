// The unified interface all providers implement
export interface AIProvider {
  readonly name: string;
  chat(options: ChatOptions): Promise<ChatResponse>;
  isConfigured(): boolean;
}

export interface ChatOptions {
  system: string;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  maxTokens?: number;
  // tool_use is Anthropic-specific — for now only the Anthropic provider supports it
  tools?: Array<{ name: string; description: string; input_schema: Record<string, unknown> }>;
}

export interface ChatResponse {
  content: string;
  toolCalls?: Array<{ id: string; name: string; input: Record<string, unknown> }>;
  stopReason: 'end_turn' | 'tool_use' | 'max_tokens';
}

// Config stored in DB
export interface AIProviderConfig {
  provider: 'anthropic' | 'ollama' | 'qwen';
  apiKey?: string;       // Anthropic & Qwen need this
  baseUrl?: string;      // Ollama: http://localhost:11434, Qwen: https://dashscope.aliyuncs.com/compatible-mode
  model: string;         // e.g. claude-sonnet-4-20250514, llama3.1:8b, qwen-plus
}

export const PROVIDER_DEFAULTS: Record<string, Partial<AIProviderConfig>> = {
  anthropic: {
    model: 'claude-sonnet-4-20250514',
  },
  ollama: {
    baseUrl: 'http://localhost:11434',
    model: 'llama3.1:8b',
  },
  qwen: {
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode',
    model: 'qwen-plus',
  },
};

export const AI_NOT_CONFIGURED_MSG = `AI provider is not configured.

To configure, run:
  jarvis ai setup

Or via HTTP API:
  POST /api/ai/config

See documentation: packages/docs/ai-configuration.md`;
