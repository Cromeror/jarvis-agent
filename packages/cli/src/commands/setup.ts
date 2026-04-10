import { mkdirSync, existsSync, readFileSync } from 'node:fs';
import chalk from 'chalk';
import { createStorage } from '@jarvis/storage';
import type { CliConfig } from '../config.js';

export function setupCommand(config: CliConfig): void {
  console.log(chalk.cyan.bold('\nJARVIS Setup\n'));

  // 1. Create data directory
  if (!existsSync(config.dataDir)) {
    mkdirSync(config.dataDir, { recursive: true });
    console.log(chalk.green('✓ Created data/ directory'));
  } else {
    console.log(chalk.gray('✓ data/ directory exists'));
  }

  // 2. Initialize database
  const storage = createStorage(config.dbPath);
  console.log(chalk.green('✓ Database initialized'));

  // 3. Seed demo data
  storage.seed();
  console.log(chalk.green('✓ Demo data seeded'));

  // 4. Sync cognitive base
  if (existsSync(config.cognitiveBasePath)) {
    const content = readFileSync(config.cognitiveBasePath, 'utf-8');
    storage.cognitive.update(content);
    console.log(chalk.green('✓ Cognitive base synced'));
  } else {
    console.log(chalk.yellow('⚠ No base/cognition.md found — create one to personalize JARVIS'));
  }

  console.log(chalk.cyan.bold('\n✓ Setup complete!\n'));
  console.log('Next steps:');
  console.log(`  1. Set ${chalk.bold('ANTHROPIC_API_KEY')} environment variable`);
  console.log(`  2. Edit ${chalk.bold('base/cognition.md')} with your preferences`);
  console.log(`  3. Run ${chalk.bold('jarvis chat')} to start\n`);
}
