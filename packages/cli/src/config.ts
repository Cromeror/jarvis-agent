import { resolve } from 'node:path';
import { existsSync, mkdirSync } from 'node:fs';

export interface CliConfig {
  dbPath: string;
  anthropicApiKey: string;
  model: string;
  maxTokens: number;
  cognitiveBasePath: string;
  dataDir: string;
}

export function loadConfig(): CliConfig {
  const dataDir = resolve(process.cwd(), 'data');
  const dbPath = resolve(dataDir, 'jarvis.db');
  const cognitiveBasePath = resolve(process.cwd(), 'base', 'cognition.md');

  // Ensure data dir exists
  if (!existsSync(dataDir)) {
    mkdirSync(dataDir, { recursive: true });
  }

  const anthropicApiKey = process.env.ANTHROPIC_API_KEY || '';
  if (!anthropicApiKey) {
    console.warn('Warning: ANTHROPIC_API_KEY not set. Chat commands will fail.');
  }

  return {
    dbPath,
    anthropicApiKey,
    model: process.env.JARVIS_MODEL || 'claude-sonnet-4-20250514',
    maxTokens: parseInt(process.env.JARVIS_MAX_TOKENS || '8192', 10),
    cognitiveBasePath,
    dataDir,
  };
}
