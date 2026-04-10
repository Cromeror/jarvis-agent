import { execSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import chalk from 'chalk';
import type { Storage } from '@jarvis/storage';

export function baseShow(storage: Storage): void {
  const active = storage.cognitive.getActive();
  if (!active) {
    console.log(chalk.yellow('No cognitive base loaded. Run "jarvis base sync" first.'));
    return;
  }
  console.log(chalk.bold('\nCognitive Base (v' + active.version + '):\n'));
  console.log(active.content);
  console.log('');
}

export function baseEdit(cognitiveBasePath: string): void {
  const editor = process.env.EDITOR || 'vim';
  try {
    execSync(`${editor} "${cognitiveBasePath}"`, { stdio: 'inherit' });
    console.log(chalk.green('\nFile saved. Run "jarvis base sync" to update the database.\n'));
  } catch {
    console.error(chalk.red('Failed to open editor.'));
  }
}

export function baseSync(storage: Storage, cognitiveBasePath: string): void {
  if (!existsSync(cognitiveBasePath)) {
    console.log(chalk.red(`File not found: ${cognitiveBasePath}`));
    return;
  }

  const content = readFileSync(cognitiveBasePath, 'utf-8');
  const current = storage.cognitive.getActive();

  if (current && current.content === content) {
    console.log(chalk.gray('Cognitive base is already up to date.'));
    return;
  }

  storage.cognitive.update(content);
  const updated = storage.cognitive.getActive();
  console.log(chalk.green(`Cognitive base synced to v${updated?.version || 1}.`));
}
