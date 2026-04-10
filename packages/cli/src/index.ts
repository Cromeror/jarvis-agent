#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { Marked } from 'marked';
import { markedTerminal } from 'marked-terminal';
import { loadConfig } from './config.js';
import { bootstrap } from './bootstrap.js';
import { chatCommand } from './commands/chat.js';
import {
  projectCreate, projectList, projectShow, projectEdit,
  rulesList, rulesAdd, rulesRemove,
  stackList, stackSet, stackRemove,
  integrationsList, integrationsSet, integrationsRemove,
} from './commands/project.js';
import { baseShow, baseEdit, baseSync } from './commands/base.js';
import { setupCommand } from './commands/setup.js';

const program = new Command();

program
  .name('jarvis')
  .description('JARVIS — AI development agent')
  .version('0.0.1');

// Setup
program
  .command('setup')
  .description('Initialize JARVIS: create data dir, database, seed demo data')
  .action(() => {
    const config = loadConfig();
    setupCommand(config);
  });

// Chat
program
  .command('chat')
  .description('Start an interactive chat session')
  .option('-p, --project <id>', 'Project to work with')
  .option('-r, --resume', 'Resume last session')
  .action(async (opts) => {
    const config = loadConfig();
    const { agent, storage } = bootstrap(config);
    await chatCommand(agent, storage, opts);
  });

// Do (single command)
program
  .command('do <message...>')
  .description('Execute a single command')
  .option('-p, --project <id>', 'Project context')
  .action(async (messageParts: string[], opts) => {
    const config = loadConfig();
    const { agent } = bootstrap(config);
    const message = messageParts.join(' ');
    const session = await agent.startSession(opts.project);

    const marked = new Marked(markedTerminal() as any);
    const spinner = ora({ text: 'Pensando...', color: 'cyan' }).start();
    try {
      const response = await agent.run(message, session.id);
      spinner.stop();
      console.log(marked.parse(response));
    } catch (err) {
      spinner.fail('Error');
      console.error(chalk.red(err instanceof Error ? err.message : String(err)));
      process.exit(1);
    }
  });

// Sessions
program
  .command('sessions')
  .description('List recent sessions')
  .option('-p, --project <id>', 'Filter by project')
  .action((opts) => {
    const config = loadConfig();
    const { storage } = bootstrap(config);
    const sessions = storage.sessions.list(opts.project);
    if (sessions.length === 0) {
      console.log('No sessions found.');
      return;
    }
    for (const s of sessions) {
      console.log(`  ${s.id.slice(0, 8)} | ${s.title || 'Untitled'} | ${s.created_at}`);
    }
  });

// Project commands
const proj = program.command('project').description('Manage projects');
proj.command('create [id]').description('Create a new project')
  .option('-n, --name <name>', 'Project name')
  .option('-s, --sector <sector>', 'Sector')
  .option('-d, --description <desc>', 'Description')
  .action(async (id: string | undefined, opts) => {
    const config = loadConfig();
    const { storage } = bootstrap(config);
    await projectCreate(storage, id, opts);
  });
proj.command('list').description('List projects').action(async () => {
  const config = loadConfig();
  const { storage } = bootstrap(config);
  await projectList(storage);
});
proj.command('show <id>').description('Show project details').action(async (id: string) => {
  const config = loadConfig();
  const { storage } = bootstrap(config);
  await projectShow(storage, id);
});
proj.command('edit <id>').description('Edit project').action(async (id: string) => {
  const config = loadConfig();
  const { storage } = bootstrap(config);
  await projectEdit(storage, id);
});

// Project > Rules subcommands
const rules = proj.command('rules').description('Manage project rules');
rules.command('list <project-id>').description('List rules for a project')
  .option('-c, --category <category>', 'Filter by category')
  .action((projectId: string, opts) => {
    const config = loadConfig();
    const { storage } = bootstrap(config);
    rulesList(storage, projectId, opts.category);
  });
rules.command('add <project-id>').description('Add a rule to a project').action(async (projectId: string) => {
  const config = loadConfig();
  const { storage } = bootstrap(config);
  await rulesAdd(storage, projectId);
});
rules.command('remove <rule-id>').description('Remove a rule by ID').action(async (ruleId: string) => {
  const config = loadConfig();
  const { storage } = bootstrap(config);
  await rulesRemove(storage, ruleId);
});

// Project > Stack subcommands
const stack = proj.command('stack').description('Manage project stack');
stack.command('list <project-id>').description('List stack for a project').action((projectId: string) => {
  const config = loadConfig();
  const { storage } = bootstrap(config);
  stackList(storage, projectId);
});
stack.command('set <project-id>').description('Set a stack layer').action(async (projectId: string) => {
  const config = loadConfig();
  const { storage } = bootstrap(config);
  await stackSet(storage, projectId);
});
stack.command('remove <stack-id>').description('Remove a stack entry by ID').action(async (stackId: string) => {
  const config = loadConfig();
  const { storage } = bootstrap(config);
  await stackRemove(storage, stackId);
});

// Project > Integration subcommands
const integration = proj.command('integration').description('Manage project integrations');
integration.command('list <project-id>').description('List integrations').action((projectId: string) => {
  const config = loadConfig();
  const { storage } = bootstrap(config);
  integrationsList(storage, projectId);
});
integration.command('set <project-id> <type> <key> <value>').description('Set an integration')
  .option('--notes <notes>', 'Optional notes')
  .action((projectId: string, type: string, key: string, value: string, opts) => {
    const config = loadConfig();
    const { storage } = bootstrap(config);
    integrationsSet(storage, projectId, type, key, value, opts.notes);
  });
integration.command('remove <integration-id>').description('Remove an integration by ID').action(async (id: string) => {
  const config = loadConfig();
  const { storage } = bootstrap(config);
  await integrationsRemove(storage, id);
});

// Base commands
const base = program.command('base').description('Manage cognitive base');
base.command('show').description('Show active cognitive base').action(() => {
  const config = loadConfig();
  const { storage } = bootstrap(config);
  baseShow(storage);
});
base.command('edit').description('Edit cognition.md in $EDITOR').action(() => {
  const config = loadConfig();
  baseEdit(config.cognitiveBasePath);
});
base.command('sync').description('Sync cognition.md to database').action(() => {
  const config = loadConfig();
  const { storage } = bootstrap(config);
  baseSync(storage, config.cognitiveBasePath);
});

program.parse();
