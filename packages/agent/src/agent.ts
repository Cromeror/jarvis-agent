import Anthropic from '@anthropic-ai/sdk';
import type { Storage } from '@jarvis/storage';
import { ContextResolver, ToolRegistry } from '@jarvis/core';
import type { Session, JarvisConfig } from '@jarvis/core';

export class JarvisAgent {
  private client: Anthropic;
  private storage: Storage;
  private contextResolver: ContextResolver;
  private toolRegistry: ToolRegistry;
  private config: JarvisConfig;

  constructor(storage: Storage, toolRegistry: ToolRegistry, config: JarvisConfig) {
    this.client = new Anthropic({ apiKey: config.anthropicApiKey });
    this.storage = storage;
    this.toolRegistry = toolRegistry;
    this.contextResolver = new ContextResolver(storage, toolRegistry);
    this.config = config;
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
    // 1. Get session to find project
    const session = this.storage.sessions.get(sessionId);
    if (!session) throw new Error(`Session not found: ${sessionId}`);

    // 2. Resolve context
    const context = this.contextResolver.resolve(session.project_id);

    // 3. Save user message
    this.storage.sessions.addMessage(sessionId, 'user', userMessage);

    // 4. Build messages array from history
    const history = this.storage.sessions.getMessages(sessionId);
    const messages = this.buildMessages(history);

    // 5. Convert tools to Anthropic format
    const tools = context.availableTools.map(t => ({
      name: t.name,
      description: t.description,
      input_schema: t.input_schema as Anthropic.Tool['input_schema'],
    }));

    // 6. Agent loop — call Claude until end_turn or no more tool_use
    let response = await this.client.messages.create({
      model: this.config.model,
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
      const updatedMessages = this.buildMessages(updatedHistory);

      response = await this.client.messages.create({
        model: this.config.model,
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

  private buildMessages(history: Array<{ role: string; content: string; tool_calls: string | null }>): Anthropic.MessageParam[] {
    const messages: Anthropic.MessageParam[] = [];

    for (const msg of history) {
      if (msg.role === 'user') {
        messages.push({ role: 'user', content: msg.content });
      } else if (msg.role === 'assistant') {
        const content: Anthropic.ContentBlockParam[] = [];
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
            } as Anthropic.ToolUseBlockParam);
          }
        }
        messages.push({ role: 'assistant', content });
      } else if (msg.role === 'tool') {
        const toolResults = JSON.parse(msg.content) as Anthropic.ToolResultBlockParam[];
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
