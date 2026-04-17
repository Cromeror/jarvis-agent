import type { AIProvider, ChatOptions, ChatResponse, AIProviderConfig } from '../ai-provider.js';

export class OllamaProvider implements AIProvider {
  readonly name = 'ollama';
  private config: AIProviderConfig;

  constructor(config: AIProviderConfig) {
    this.config = config;
  }

  isConfigured(): boolean {
    return !!this.config.baseUrl;
  }

  async chat(options: ChatOptions): Promise<ChatResponse> {
    const baseUrl = this.config.baseUrl || 'http://localhost:11434';

    const messages: Array<{ role: string; content: string }> = [];
    if (options.system) {
      messages.push({ role: 'system', content: options.system });
    }
    for (const m of options.messages) {
      messages.push({ role: m.role, content: m.content });
    }

    const response = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.config.model,
        messages,
        max_tokens: options.maxTokens || 4096,
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Ollama API error (${response.status}): ${body}`);
    }

    const data = await response.json() as {
      choices: Array<{ message: { content: string }; finish_reason: string }>;
    };

    const choice = data.choices[0];
    return {
      content: choice?.message?.content || '',
      stopReason: choice?.finish_reason === 'length' ? 'max_tokens' : 'end_turn',
    };
  }
}
