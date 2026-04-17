import chalk from 'chalk';
import { input, select, confirm } from '@inquirer/prompts';
import type { Storage } from '@jarvis/storage';

interface CreateOpts {
  name?: string;
  sector?: string;
  description?: string;
}

export async function projectCreate(storage: Storage, id?: string, opts?: CreateOpts): Promise<void> {
  // Non-interactive if id and name are provided via flags
  if (id && opts?.name) {
    storage.projects.create({
      id,
      name: opts.name,
      description: opts.description || null,
      sector: opts.sector || null,
    });
    console.log(chalk.green(`Project "${opts.name}" created with id "${id}"`));
    return;
  }

  // Interactive mode
  const inputId = id || await input({ message: 'Project slug (e.g. my-api):' });
  const name = await input({ message: 'Project name:' });
  const sector = await input({ message: 'Sector (e.g. fintech, retail, salud):' });
  const description = await input({ message: 'Description (optional):' });

  storage.projects.create({
    id: inputId,
    name,
    description: description || null,
    sector: sector || null,
  });

  console.log(chalk.green(`\nProject "${name}" created with id "${inputId}"\n`));
}

export async function projectList(storage: Storage): Promise<void> {
  const projects = storage.projects.list();
  if (projects.length === 0) {
    console.log(chalk.yellow('No projects found. Use "jarvis project create" to create one.'));
    return;
  }

  console.log(chalk.bold('\nProjects:\n'));
  for (const p of projects) {
    const status = p.status === 'active' ? chalk.green('●') : chalk.gray('○');
    const sector = p.sector ? chalk.gray(` [${p.sector}]`) : '';
    console.log(`  ${status} ${chalk.bold(p.id)} — ${p.name}${sector}`);
  }
  console.log('');
}

export async function projectShow(storage: Storage, id: string): Promise<void> {
  const ctx = storage.projects.getFullContext(id);
  if (!ctx) {
    console.log(chalk.red(`Project "${id}" not found.`));
    return;
  }

  console.log(chalk.bold(`\n${ctx.project.name}`));
  if (ctx.project.description) console.log(chalk.gray(ctx.project.description));
  if (ctx.project.sector) console.log(chalk.gray(`Sector: ${ctx.project.sector}`));
  console.log(chalk.gray(`Status: ${ctx.project.status}`));

  if (ctx.stack.length > 0) {
    console.log(chalk.bold('\nStack:'));
    for (const s of ctx.stack) {
      console.log(`  ${chalk.cyan(s.layer)}: ${s.value}${s.notes ? chalk.gray(` (${s.notes})`) : ''}`);
    }
  }

  if (ctx.rules.length > 0) {
    console.log(chalk.bold('\nRules:'));
    for (const r of ctx.rules) {
      console.log(`  ${chalk.yellow(r.category)}: ${r.rule}`);
    }
  }

  if (ctx.integrations.length > 0) {
    console.log(chalk.bold('\nIntegrations:'));
    for (const i of ctx.integrations) {
      const config = JSON.parse(i.config);
      const summary = Object.entries(config)
        .map(([k, v]) => {
          const display = k.includes('key') || k.includes('token')
            ? '****' + String(v).slice(-4)
            : String(v);
          return `${k}=${display}`;
        })
        .join(', ');
      console.log(`  ${chalk.magenta(i.service)}: ${summary}`);
    }
  }

  if (ctx.knowledge.length > 0) {
    console.log(chalk.bold('\nKnowledge:'));
    for (const k of ctx.knowledge) {
      console.log(`  ${chalk.blue(k.title)}`);
    }
  }
  console.log('');
}

export async function projectEdit(storage: Storage, id: string): Promise<void> {
  const project = storage.projects.get(id);
  if (!project) {
    console.log(chalk.red(`Project "${id}" not found.`));
    return;
  }

  const action = await select({
    message: `Edit ${project.name}:`,
    choices: [
      { name: 'Add stack layer', value: 'stack' },
      { name: 'Add rule', value: 'rule' },
      { name: 'Add integration', value: 'integration' },
      { name: 'Add knowledge', value: 'knowledge' },
      { name: 'Update project info', value: 'info' },
      { name: 'Cancel', value: 'cancel' },
    ],
  });

  switch (action) {
    case 'stack': {
      const layer = await input({ message: 'Layer (e.g. frontend, backend, database):' });
      const value = await input({ message: 'Value (e.g. React 18 + TypeScript):' });
      const notes = await input({ message: 'Notes (optional):' });
      storage.stack.set(id, layer, value, notes || undefined);
      console.log(chalk.green('Stack layer added.'));
      break;
    }
    case 'rule': {
      const category = await input({ message: 'Category (e.g. code_conventions, git, definition_of_ready):' });
      const rule = await input({ message: 'Rule:' });
      storage.rules.add(id, category, rule);
      console.log(chalk.green('Rule added.'));
      break;
    }
    case 'integration': {
      const service = await input({ message: 'Service (jira, n8n, github):' });
      const configStr = await input({ message: 'Config as JSON (e.g. {"site":"myorg.atlassian.net","email":"me@co.com"}):' });
      try {
        const config = JSON.parse(configStr);
        storage.integrations.set(id, service, config);
        console.log(chalk.green(`Integration ${service} set.`));
      } catch {
        console.log(chalk.red('Invalid JSON config.'));
      }
      break;
    }
    case 'knowledge': {
      const title = await input({ message: 'Title:' });
      const content = await input({ message: 'Content (markdown):' });
      const tags = await input({ message: 'Tags (comma-separated, optional):' });
      const tagsArr = tags ? tags.split(',').map(t => t.trim()) : undefined;
      storage.knowledge.add(id, title, content, tagsArr);
      console.log(chalk.green('Knowledge entry added.'));
      break;
    }
    case 'info': {
      const name = await input({ message: 'Name:', default: project.name });
      const description = await input({ message: 'Description:', default: project.description || '' });
      const sector = await input({ message: 'Sector:', default: project.sector || '' });
      storage.projects.update(id, { name, description, sector });
      console.log(chalk.green('Project updated.'));
      break;
    }
  }
}

// --- Rules subcommands ---

export function rulesList(storage: Storage, projectId: string, category?: string): void {
  const project = storage.projects.get(projectId);
  if (!project) {
    console.log(chalk.red(`Project "${projectId}" not found.`));
    return;
  }

  const rules = storage.rules.list(projectId, category);
  if (rules.length === 0) {
    const filter = category ? ` in category "${category}"` : '';
    console.log(chalk.yellow(`No rules found for "${projectId}"${filter}.`));
    return;
  }

  console.log(chalk.bold(`\nRules for ${project.name}:\n`));

  const byCategory = new Map<string, Array<{ id: number; rule: string; priority: number }>>();
  for (const r of rules) {
    if (!byCategory.has(r.category)) byCategory.set(r.category, []);
    byCategory.get(r.category)!.push({ id: r.id, rule: r.rule, priority: r.priority });
  }

  for (const [cat, items] of byCategory) {
    console.log(`  ${chalk.yellow.bold(cat)}`);
    for (const item of items) {
      console.log(`    ${chalk.gray(`[${item.id}]`)} ${item.rule}`);
    }
  }
  console.log('');
}

export async function rulesAdd(storage: Storage, projectId: string): Promise<void> {
  const project = storage.projects.get(projectId);
  if (!project) {
    console.log(chalk.red(`Project "${projectId}" not found.`));
    return;
  }

  const category = await input({ message: 'Category (e.g. code_conventions, git, definition_of_ready):' });
  const rule = await input({ message: 'Rule:' });
  const priorityStr = await input({ message: 'Priority (0 = default):', default: '0' });
  const priority = parseInt(priorityStr, 10) || 0;

  storage.rules.add(projectId, category, rule, priority);
  console.log(chalk.green('Rule added.'));
}

export async function rulesRemove(storage: Storage, id: string): Promise<void> {
  const ruleId = parseInt(id, 10);
  if (isNaN(ruleId)) {
    console.log(chalk.red('Invalid rule ID.'));
    return;
  }

  const yes = await confirm({ message: `Remove rule #${ruleId}?`, default: false });
  if (yes) {
    storage.rules.remove(ruleId);
    console.log(chalk.green(`Rule #${ruleId} removed.`));
  }
}

// --- Stack subcommands ---

export function stackList(storage: Storage, projectId: string): void {
  const project = storage.projects.get(projectId);
  if (!project) {
    console.log(chalk.red(`Project "${projectId}" not found.`));
    return;
  }

  const stack = storage.stack.list(projectId);
  if (stack.length === 0) {
    console.log(chalk.yellow(`No stack defined for "${projectId}".`));
    return;
  }

  console.log(chalk.bold(`\nStack for ${project.name}:\n`));
  for (const s of stack) {
    const notes = s.notes ? chalk.gray(` (${s.notes})`) : '';
    console.log(`  ${chalk.cyan.bold(s.layer)}: ${s.value}${notes}`);
  }
  console.log('');
}

export async function stackSet(storage: Storage, projectId: string): Promise<void> {
  const project = storage.projects.get(projectId);
  if (!project) {
    console.log(chalk.red(`Project "${projectId}" not found.`));
    return;
  }

  const layer = await input({ message: 'Layer (e.g. frontend, backend, database, infra):' });
  const value = await input({ message: 'Value (e.g. React 18 + TypeScript):' });
  const notes = await input({ message: 'Notes (optional):' });

  storage.stack.set(projectId, layer, value, notes || undefined);
  console.log(chalk.green(`Stack layer "${layer}" set.`));
}

export async function stackRemove(storage: Storage, id: string): Promise<void> {
  const stackId = parseInt(id, 10);
  if (isNaN(stackId)) {
    console.log(chalk.red('Invalid stack ID.'));
    return;
  }

  const yes = await confirm({ message: `Remove stack entry #${stackId}?`, default: false });
  if (yes) {
    storage.stack.remove(stackId);
    console.log(chalk.green(`Stack entry #${stackId} removed.`));
  }
}
