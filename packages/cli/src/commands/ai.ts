import chalk from 'chalk';
import { select, input, confirm } from '@inquirer/prompts';
import type { Storage } from '@jarvis/storage';
import { createAIProvider, PROVIDER_DEFAULTS, type AIProviderConfig } from '@jarvis/core';

export async function aiSetup(storage: Storage): Promise<void> {
  const provider = await select({
    message: 'Select AI provider:',
    choices: [
      { name: 'Anthropic (Claude)', value: 'anthropic' },
      { name: 'Ollama (Local)', value: 'ollama' },
      { name: 'Qwen (DashScope)', value: 'qwen' },
    ],
  }) as 'anthropic' | 'ollama' | 'qwen';

  const defaults = PROVIDER_DEFAULTS[provider] || {};

  let apiKey: string | null = null;
  if (provider === 'anthropic' || provider === 'qwen') {
    const key = await input({
      message: `API Key for ${provider}:`,
    });
    apiKey = key || null;
  }

  let baseUrl: string | null = null;
  if (provider === 'ollama') {
    baseUrl = await input({
      message: 'Ollama base URL:',
      default: defaults.baseUrl || 'http://localhost:11434',
    });
  } else if (provider === 'qwen') {
    baseUrl = await input({
      message: 'Qwen API base URL:',
      default: defaults.baseUrl || 'https://dashscope.aliyuncs.com/compatible-mode',
    });
  }

  const model = await input({
    message: 'Model:',
    default: defaults.model || '',
  });

  const shouldActivate = await confirm({
    message: 'Activate this provider now?',
    default: true,
  });

  storage.aiConfig.save(provider, model, apiKey, baseUrl, shouldActivate);
  console.log(chalk.green(`\n✓ ${provider} configured${shouldActivate ? ' and activated' : ''}.`));

  // Test connection
  const shouldTest = await confirm({ message: 'Test connection?', default: true });
  if (shouldTest) {
    await aiTest(storage);
  }
}

export function aiStatus(storage: Storage): void {
  const active = storage.aiConfig.getActive();
  if (!active) {
    console.log(chalk.yellow('\n⚠ No AI provider configured.\n'));
    console.log(chalk.bold('JARVIS necesita un proveedor de IA para funcionar. Opciones:\n'));
    console.log(`  ${chalk.cyan('1. Ollama (Gratis, local)')}`);
    console.log(chalk.gray('     Corre modelos en tu maquina. No necesita API key.'));
    console.log(chalk.gray('     Instalar: curl -fsSL https://ollama.com/install.sh | sh'));
    console.log(chalk.gray('     Configurar: jarvis ai set ollama --model llama3.1:8b\n'));
    console.log(`  ${chalk.cyan('2. Qwen (Free tier)')}`);
    console.log(chalk.gray('     API de Alibaba Cloud con capa gratuita.'));
    console.log(chalk.gray('     Obtener key: https://dashscope.aliyun.com'));
    console.log(chalk.gray('     Configurar: jarvis ai set qwen --model qwen-plus --api-key <tu-key>\n'));
    console.log(`  ${chalk.cyan('3. Anthropic (Pago)')}`);
    console.log(chalk.gray('     Claude API. Requiere credito ($5 min).'));
    console.log(chalk.gray('     Obtener key: https://console.anthropic.com'));
    console.log(chalk.gray('     Configurar: jarvis ai set anthropic --model claude-sonnet-4-20250514 --api-key <tu-key>\n'));
    console.log(chalk.bold('O usa el wizard interactivo:'));
    console.log(chalk.white('  jarvis ai setup\n'));
    console.log(chalk.gray('Documentacion: packages/docs/ai-configuration.md\n'));
    return;
  }

  console.log(chalk.bold('\nActive AI Provider:\n'));
  console.log(`  ${chalk.cyan('Provider')}: ${active.provider}`);
  console.log(`  ${chalk.cyan('Model')}:    ${active.model}`);
  console.log(`  ${chalk.cyan('API Key')}: ${active.api_key ? '****' + active.api_key.slice(-4) : 'N/A'}`);
  console.log(`  ${chalk.cyan('Base URL')}: ${active.base_url || 'Default'}`);
  console.log('');
}

export function aiList(storage: Storage): void {
  const configs = storage.aiConfig.list();
  if (configs.length === 0) {
    console.log(chalk.yellow('\nNo AI providers configured.'));
    console.log(chalk.gray('Run: jarvis ai setup\n'));
    return;
  }

  console.log(chalk.bold('\nConfigured AI Providers:\n'));
  for (const c of configs) {
    const active = c.is_active ? chalk.green(' ● ACTIVE') : '';
    const key = c.api_key ? '****' + c.api_key.slice(-4) : 'N/A';
    console.log(`  ${chalk.bold(c.provider)}${active}`);
    console.log(`    Model: ${c.model} | Key: ${key} | URL: ${c.base_url || 'Default'}`);
  }
  console.log('');
}

export function aiActivate(storage: Storage, provider: string): void {
  const config = storage.aiConfig.getByProvider(provider);
  if (!config) {
    console.log(chalk.red(`Provider "${provider}" not configured.`));
    console.log(chalk.gray(`Run: jarvis ai setup`));
    return;
  }
  storage.aiConfig.activate(config.id);
  console.log(chalk.green(`✓ ${provider} activated.`));
}

export function aiSet(
  storage: Storage,
  provider: string,
  opts: { model?: string; apiKey?: string; baseUrl?: string; activate?: boolean }
): void {
  const defaults = PROVIDER_DEFAULTS[provider] || {};
  const model = opts.model || defaults.model || '';
  if (!model) {
    console.log(chalk.red('Model is required. Use --model <model>'));
    return;
  }
  storage.aiConfig.save(
    provider,
    model,
    opts.apiKey || null,
    opts.baseUrl || defaults.baseUrl || null,
    opts.activate !== false,
  );
  console.log(chalk.green(`✓ ${provider} configured.`));
}

export async function aiTest(storage: Storage): Promise<void> {
  const active = storage.aiConfig.getActive();
  if (!active) {
    console.log(chalk.red('No AI provider configured. Run: jarvis ai setup'));
    return;
  }

  const config: AIProviderConfig = {
    provider: active.provider as 'anthropic' | 'ollama' | 'qwen',
    apiKey: active.api_key || undefined,
    baseUrl: active.base_url || undefined,
    model: active.model,
  };

  const provider = createAIProvider(config);

  if (!provider.isConfigured()) {
    console.log(chalk.red(`${active.provider} is not properly configured (missing API key or URL).`));
    return;
  }

  console.log(chalk.gray(`Testing ${active.provider} (${active.model})...`));
  try {
    const response = await provider.chat({
      system: 'You are a test assistant. Reply in one short sentence.',
      messages: [{ role: 'user', content: 'Say hello and confirm you are working.' }],
      maxTokens: 100,
    });
    console.log(chalk.green(`✓ ${active.provider} is working!`));
    console.log(chalk.gray(`  Response: ${response.content.slice(0, 100)}`));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(chalk.red(`✗ ${active.provider} failed: ${msg}`));
  }
}
