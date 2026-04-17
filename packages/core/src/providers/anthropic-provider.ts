import type { AIProvider, ChatOptions, ChatResponse, AIProviderConfig } from '../ai-provider.js';

export class AnthropicProvider implements AIProvider {
  readonly name = 'anthropic';
  private client: any;  // We'll use dynamic import since not all consumers have the SDK
  private config: AIProviderConfig;

  constructor(config: AIProviderConfig) {
    this.config = config;
  }

  isConfigured(): boolean {
    return !!this.config.apiKey;
  }

  async chat(options: ChatOptions): Promise<ChatResponse> {
    if (!this.client) {
      const { default: Anthropic } = await import('@anthropic-ai/sdk');
      this.client = new Anthropic({ apiKey: this.config.apiKey });
    }

    const messages = options.messages.map(m => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    }));

    const tools = options.tools?.map(t => ({
      name: t.name,
      description: t.description,
      input_schema: t.input_schema as any,
    }));

    const response = await this.client.messages.create({
      model: this.config.model,
      max_tokens: options.maxTokens || 4096,
      system: options.system,
      messages,
      tools: tools && tools.length > 0 ? tools : undefined,
    });

    const textContent = response.content
      .filter((b: any) => b.type === 'text')
      .map((b: any) => b.text)
      .join('\n');

    const toolCalls = response.content
      .filter((b: any) => b.type === 'tool_use')
      .map((b: any) => ({ id: b.id, name: b.name, input: b.input }));

    return {
      content: textContent,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      stopReason: response.stop_reason === 'tool_use' ? 'tool_use' :
                  response.stop_reason === 'max_tokens' ? 'max_tokens' : 'end_turn',
    };
  }
}
