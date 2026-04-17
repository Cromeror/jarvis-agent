import { resolve, dirname } from 'node:path';
import { existsSync, mkdirSync, copyFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

export interface CliConfig {
  jarvisHome: string;
  dbPath: string;
  anthropicApiKey: string;
  model: string;
  maxTokens: number;
  cognitiveBasePath: string;
  dataDir: string;
}

// Resolve Jarvis home directory per OS — always lives in the user's home,
// never tied to cwd. This lets `jarvis` run from any project.
export function resolveJarvisHome(): string {
  if (process.platform === 'win32') {
    const appData = process.env.APPDATA || resolve(homedir(), 'AppData', 'Roaming');
    return resolve(appData, 'jarvis');
  }
  return resolve(homedir(), '.jarvis');
}

// Seed cognition.md shipped with the CLI package (assets/cognition.md).
// Falls back silently if the asset is missing — user can create one manually.
function seedCognitionIfMissing(targetPath: string): void {
  if (existsSync(targetPath)) return;
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    resolve(here, '..', 'assets', 'cognition.md'),
    resolve(here, 'assets', 'cognition.md'),
  ];
  for (const src of candidates) {
    if (existsSync(src)) {
      copyFileSync(src, targetPath);
      return;
    }
  }
}

export function loadConfig(): CliConfig {
  const jarvisHome = resolveJarvisHome();
  const dataDir = resolve(jarvisHome, 'data');
  const dbPath = resolve(jarvisHome, 'jarvis.db');
  const cognitiveBasePath = resolve(jarvisHome, 'cognition.md');

  if (!existsSync(jarvisHome)) {
    mkdirSync(jarvisHome, { recursive: true });
  }
  if (!existsSync(dataDir)) {
    mkdirSync(dataDir, { recursive: true });
  }
  seedCognitionIfMissing(cognitiveBasePath);

  // Env var is used as fallback when no AI provider is configured in the DB
  const anthropicApiKey = process.env.ANTHROPIC_API_KEY || '';

  return {
    jarvisHome,
    dbPath,
    anthropicApiKey,
    model: process.env.JARVIS_MODEL || 'claude-sonnet-4-20250514',
    maxTokens: parseInt(process.env.JARVIS_MAX_TOKENS || '8192', 10),
    cognitiveBasePath,
    dataDir,
  };
}
