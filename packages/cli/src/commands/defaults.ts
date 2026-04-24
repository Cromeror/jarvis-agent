import chalk from 'chalk';
import { applyDefaults, type Storage } from '@jarvis/storage';

export interface DefaultsApplyOptions {
  project?: string;
  force?: boolean;
}

export function defaultsApply(storage: Storage, opts: DefaultsApplyOptions): void {
  if (opts.project && !storage.projects.get(opts.project)) {
    console.log(chalk.red(`Project "${opts.project}" not found.`));
    process.exit(1);
  }

  const result = applyDefaults(storage, {
    projectId: opts.project,
    force: opts.force,
  });

  if (result.appliedKnowledge.length === 0) {
    console.log(chalk.yellow('No defaults matched (no projects or no matching selectors).'));
    return;
  }

  const grouped = new Map<string, typeof result.appliedKnowledge>();
  for (const entry of result.appliedKnowledge) {
    if (!grouped.has(entry.projectId)) grouped.set(entry.projectId, []);
    grouped.get(entry.projectId)!.push(entry);
  }

  console.log(chalk.bold('\nDefaults applied:\n'));
  for (const [projectId, entries] of grouped) {
    console.log(`  ${chalk.cyan.bold(projectId)}`);
    for (const entry of entries) {
      const icon =
        entry.action === 'inserted' ? chalk.green('+') :
        entry.action === 'updated'  ? chalk.yellow('↻') :
                                      chalk.gray('·');
      const label =
        entry.action === 'inserted' ? chalk.green('inserted') :
        entry.action === 'updated'  ? chalk.yellow('updated') :
                                      chalk.gray('skipped');
      console.log(`    ${icon} ${entry.slug} — ${label}`);
    }
  }

  const inserted = result.appliedKnowledge.filter((k) => k.action === 'inserted').length;
  const updated = result.appliedKnowledge.filter((k) => k.action === 'updated').length;
  const skipped = result.appliedKnowledge.filter((k) => k.action === 'skipped').length;
  console.log(
    chalk.bold(`\nSummary: ${chalk.green(inserted + ' inserted')}, ${chalk.yellow(updated + ' updated')}, ${chalk.gray(skipped + ' skipped')}`),
  );
  if (skipped > 0 && !opts.force) {
    console.log(chalk.gray('\nTip: run with --force to overwrite existing entries.'));
  }
  console.log('');
}
