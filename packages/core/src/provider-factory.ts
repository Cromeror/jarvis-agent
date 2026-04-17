import type { AIProvider, AIProviderConfig } from './ai-provider.js';
import { AnthropicProvider } from './providers/anthropic-provider.js';
import { OllamaProvider } from './providers/ollama-provider.js';
import { QwenProvider } from './providers/qwen-provider.js';

export function createAIProvider(config: AIProviderConfig): AIProvider {
  switch (config.provider) {
    case 'anthropic':
      return new AnthropicProvider(config);
    case 'ollama':
      return new OllamaProvider(config);
    case 'qwen':
      return new QwenProvider(config);
    default:
      throw new Error(`Unknown AI provider: ${(config as AIProviderConfig).provider}`);
  }
}
