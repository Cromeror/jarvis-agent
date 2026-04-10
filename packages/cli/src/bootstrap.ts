import { createStorage } from '@jarvis/storage';
import { ToolRegistry } from '@jarvis/core';
import { JarvisAgent } from '@jarvis/agent';
import { existsSync, readFileSync } from 'node:fs';
import type { CliConfig } from './config.js';
import { createJiraSkill } from '@jarvis/skills-jira';
import { createRefineSkill } from '@jarvis/skills-refine';
import { createCodeSkill } from '@jarvis/skills-code';
import { createN8nSkill } from '@jarvis/skills-n8n';

export function bootstrap(config: CliConfig) {
  const storage = createStorage(config.dbPath);

  // Sync cognitive base from file if it exists
  if (existsSync(config.cognitiveBasePath)) {
    const fileContent = readFileSync(config.cognitiveBasePath, 'utf-8');
    const current = storage.cognitive.getActive();
    if (!current || current.content !== fileContent) {
      storage.cognitive.update(fileContent);
    }
  }

  // Create tool registry and register all skills
  const toolRegistry = new ToolRegistry();
  toolRegistry.register(createJiraSkill(storage));
  toolRegistry.register(createRefineSkill(storage));
  toolRegistry.register(createCodeSkill(storage));
  toolRegistry.register(createN8nSkill(storage));

  // Create agent
  const agent = new JarvisAgent(storage, toolRegistry, {
    dbPath: config.dbPath,
    anthropicApiKey: config.anthropicApiKey,
    model: config.model,
    maxTokens: config.maxTokens,
  });

  return { storage, toolRegistry, agent };
}
