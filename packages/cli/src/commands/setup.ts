import { existsSync, readFileSync } from 'node:fs';
import chalk from 'chalk';
import { createStorage } from '@jarvis/storage';
import type { CliConfig } from '../config.js';

export function setupCommand(config: CliConfig): void {
  console.log(chalk.cyan.bold('\nJARVIS Setup\n'));

  console.log(chalk.gray(`Home: ${config.jarvisHome}`));

  // Database (loadConfig already created the home dir)
  const storage = createStorage(config.dbPath);
  console.log(chalk.green('✓ Database initialized'));

  // Seed demo data
  storage.seed();
  console.log(chalk.green('✓ Demo data seeded'));

  // Sync cognitive base
  if (existsSync(config.cognitiveBasePath)) {
    const content = readFileSync(config.cognitiveBasePath, 'utf-8');
    storage.cognitive.update(content);
    console.log(chalk.green('✓ Cognitive base synced'));
  } else {
    console.log(chalk.yellow(`⚠ No cognition.md at ${config.cognitiveBasePath} — create one to personalize JARVIS`));
  }

  console.log(chalk.cyan.bold('\n✓ Setup complete!\n'));
  console.log('Next steps:');
  console.log(`  1. Configure an AI provider: ${chalk.bold('jarvis ai setup')}`);
  console.log(`  2. Register MCP in Claude Code: ${chalk.bold('jarvis mcp install')}`);
  console.log(`  3. Run ${chalk.bold('jarvis chat')} to start\n`);
}
