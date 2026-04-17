import type Anthropic from '@anthropic-ai/sdk';
import type { Storage } from '@jarvis/storage';
import {
  ContextResolver,
  ToolRegistry,
  createAIProvider,
  AI_NOT_CONFIGURED_MSG,
  type AIProvider,
} from '@jarvis/core';
import type { Session, JarvisConfig } from '@jarvis/core';

export class JarvisAgent {
  private provider: AIProvider | null;
  private storage: Storage;
  private contextResolver: ContextResolver;
  private toolRegistry: ToolRegistry;
  private config: JarvisConfig;

  constructor(storage: Storage, toolRegistry: ToolRegistry, config: JarvisConfig) {
    this.storage = storage;
    this.toolRegistry = toolRegistry;
    this.contextResolver = new ContextResolver(storage, toolRegistry);
    this.config = config;

    // Try to load provider from DB first
    const activeConfig = storage.aiConfig.getActive();
    if (activeConfig) {
      this.provider = createAIProvider({
        provider: activeConfig.provider as 'anthropic' | 'ollama' | 'qwen',
        apiKey: activeConfig.api_key || undefined,
        baseUrl: activeConfig.base_url || undefined,
        model: activeConfig.model,
      });
    } else if (config.anthropicApiKey) {
      // Backwards compatibility: use env var ANTHROPIC_API_KEY
      this.provider = createAIProvider({
        provider: 'anthropic',
        apiKey: config.anthropicApiKey,
        model: config.model,
      });
    } else {
      this.provider = null;
    }
  }

  async startSession(projectId?: string): Promise<Session> {
    const session = this.storage.sessions.create(projectId ?? null);
    return session;
  }

  async resumeSession(sessionId: string): Promise<Session> {
    const session = this.storage.sessions.get(sessionId);
    if (!session) throw new Error(`Session not found: ${sessionId}`);
    return session;
  }

  async run(userMessage: string, sessionId: string): Promise<string> {
    if (!this.provider || !this.provider.isConfigured()) {
      return AI_NOT_CONFIGURED_MSG;
    }

    // 1. Get session to find project
    const session = this.storage.sessions.get(sessionId);
    if (!session) throw new Error(`Session not found: ${sessionId}`);

    // 2. Resolve context
    const context = this.contextResolver.resolve(session.project_id);

    // 3. Save user message
    this.storage.sessions.addMessage(sessionId, 'user', userMessage);

    // Dispatch based on provider capabilities
    if (this.provider.name === 'anthropic') {
      return this.runWithToolUse(sessionId, context);
    } else {
      return this.runSimpleChat(sessionId, context);
    }
  }

  /**
   * Full tool_use loop for Anthropic — uses the Anthropic SDK directly
   * to support function calling with tool_use / tool_result blocks.
   */
  private async runWithToolUse(
    sessionId: string,
    context: { systemPrompt: string; availableTools: Array<{ name: string; description: string; input_schema: Record<string, unknown> }> },
  ): Promise<string> {
    // Dynamic import of Anthropic SDK — only loaded when provider is Anthropic
    const { default: Anthropic } = await import('@anthropic-ai/sdk');

    // Resolve the API key: prefer DB config, fall back to constructor config
    const activeConfig = this.storage.aiConfig.getActive();
    const apiKey = activeConfig?.api_key || this.config.anthropicApiKey;
    const model = activeConfig?.model || this.config.model;

    const client = new Anthropic({ apiKey });

    // Build messages array from history
    const history = this.storage.sessions.getMessages(sessionId);
    const messages = this.buildAnthropicMessages(history);

    // Convert tools to Anthropic format
    const tools = context.availableTools.map(t => ({
      name: t.name,
      description: t.description,
      input_schema: t.input_schema as Anthropic.Tool['input_schema'],
    }));

    // Initial call
    let response = await client.messages.create({
      model,
      max_tokens: this.config.maxTokens,
      system: context.systemPrompt,
      messages,
      tools: tools.length > 0 ? tools : undefined,
    });

    while (response.stop_reason === 'tool_use') {
      // Extract tool use blocks
      const toolUseBlocks = response.content.filter(
        (b): b is Anthropic.ContentBlock & { type: 'tool_use' } => b.type === 'tool_use'
      );

      // Save assistant message with tool calls
      const assistantContent = response.content
        .filter(b => b.type === 'text')
        .map(b => (b as Anthropic.TextBlock).text)
        .join('\n');

      const toolCallsJson = JSON.stringify(toolUseBlocks.map(t => ({
        id: t.id, name: t.name, input: t.input
      })));

      this.storage.sessions.addMessage(sessionId, 'assistant', assistantContent || '', toolCallsJson);

      // Execute each tool and collect results
      const toolResults: Anthropic.ToolResultBlockParam[] = [];
      for (const toolUse of toolUseBlocks) {
        const startTime = Date.now();
        let result: string;
        let error: string | null = null;

        try {
          result = await this.toolRegistry.execute(
            toolUse.name,
            toolUse.input as Record<string, unknown>
          );
        } catch (err) {
          error = err instanceof Error ? err.message : String(err);
          result = `Error: ${error}`;
        }

        const durationMs = Date.now() - startTime;

        // Save tool execution for audit
        this.storage.toolExecutions.save({
          session_id: sessionId,
          tool_name: toolUse.name,
          input_json: JSON.stringify(toolUse.input),
          output_json: result,
          duration_ms: durationMs,
          error,
        });

        toolResults.push({
          type: 'tool_result',
          tool_use_id: toolUse.id,
          content: result,
        });
      }

      // Save tool results as a tool message
      this.storage.sessions.addMessage(
        sessionId,
        'tool',
        JSON.stringify(toolResults)
      );

      // Build updated messages and call Claude again
      const updatedHistory = this.storage.sessions.getMessages(sessionId);
      const updatedMessages = this.buildAnthropicMessages(updatedHistory);

      response = await client.messages.create({
        model,
        max_tokens: this.config.maxTokens,
        system: context.systemPrompt,
        messages: updatedMessages,
        tools: tools.length > 0 ? tools : undefined,
      });
    }

    // Extract final text response
    const finalText = response.content
      .filter(b => b.type === 'text')
      .map(b => (b as Anthropic.TextBlock).text)
      .join('\n');

    // Save final assistant message
    this.storage.sessions.addMessage(sessionId, 'assistant', finalText);

    return finalText;
  }

  /**
   * Simple chat mode for Ollama/Qwen — no tool_use, just send the full
   * context as a system prompt and get a single response.
   */
  private async runSimpleChat(
    sessionId: string,
    context: { systemPrompt: string; availableTools: Array<{ name: string; description: string; input_schema: Record<string, unknown> }> },
  ): Promise<string> {
    const provider = this.provider!;

    // Build simple message list from history (only user/assistant turns)
    const history = this.storage.sessions.getMessages(sessionId);
    const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [];

    for (const msg of history) {
      if (msg.role === 'user') {
        messages.push({ role: 'user', content: msg.content });
      } else if (msg.role === 'assistant') {
        messages.push({ role: 'assistant', content: msg.content });
      }
      // Skip tool messages for simple chat — they are not relevant
    }

    const response = await provider.chat({
      system: context.systemPrompt,
      messages,
      maxTokens: this.config.maxTokens,
    });

    // Save final assistant message
    this.storage.sessions.addMessage(sessionId, 'assistant', response.content);

    return response.content;
  }

  /**
   * Build messages in the Anthropic SDK format, including tool_use and
   * tool_result blocks for the full agent loop.
   */
  private buildAnthropicMessages(
    history: Array<{ role: string; content: string; tool_calls: string | null }>
  ): Array<{ role: 'user' | 'assistant'; content: any }> {
    const messages: Array<{ role: 'user' | 'assistant'; content: any }> = [];

    for (const msg of history) {
      if (msg.role === 'user') {
        messages.push({ role: 'user', content: msg.content });
      } else if (msg.role === 'assistant') {
        const content: Array<Record<string, unknown>> = [];
        if (msg.content) {
          content.push({ type: 'text', text: msg.content });
        }
        if (msg.tool_calls) {
          const toolCalls = JSON.parse(msg.tool_calls) as Array<{
            id: string; name: string; input: unknown;
          }>;
          for (const tc of toolCalls) {
            content.push({
              type: 'tool_use',
              id: tc.id,
              name: tc.name,
              input: tc.input,
            });
          }
        }
        messages.push({ role: 'assistant', content });
      } else if (msg.role === 'tool') {
        const toolResults = JSON.parse(msg.content);
        messages.push({ role: 'user', content: toolResults });
      }
    }

    return messages;
  }

  getToolRegistry(): ToolRegistry {
    return this.toolRegistry;
  }

  getStorage(): Storage {
    return this.storage;
  }
}
