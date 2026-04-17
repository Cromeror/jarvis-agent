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
} from './commands/project.js';
import { integrationList, integrationSet, integrationRemove } from './commands/integration.js';
import { baseShow, baseEdit, baseSync } from './commands/base.js';
import { setupCommand } from './commands/setup.js';
import { aiSetup, aiStatus, aiList, aiActivate, aiSet, aiTest } from './commands/ai.js';
import { toolList, toolRun, toolHelp } from './commands/tool.js';
import { doctorCommand } from './commands/doctor.js';

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

// Doctor — checks prerequisites and health
program
  .command('doctor')
  .description('Verify JARVIS prerequisites and report health status')
  .action(async () => {
    const config = loadConfig();
    const { storage } = bootstrap(config);
    await doctorCommand(storage, config);
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

// Tool commands — invoke tools directly without the AI agent loop
const tool = program.command('tool').description('Invoke JARVIS tools directly');
tool.command('list').description('List all available tools').action(() => {
  const config = loadConfig();
  const { toolRegistry } = bootstrap(config);
  toolList(toolRegistry);
});
tool.command('help <tool-name>').description('Show usage help for a specific tool').action((toolName: string) => {
  const config = loadConfig();
  const { toolRegistry } = bootstrap(config);
  toolHelp(toolRegistry, toolName);
});
tool.command('run <tool-name>')
  .description('Run a tool with JSON input. Example: jarvis tool run jira_analyze_ticket --input \'{"ticket_id":"LXM-473","project_id":"lx"}\'')
  .option('-i, --input <json>', 'Tool input as JSON string')
  .option('-p, --param <key=value...>', 'Input param (can be used multiple times, e.g. -p ticket_id=LXM-473 -p project_id=lx)')
  .allowUnknownOption()
  .action(async (toolName: string, opts: { input?: string; param?: string[] }) => {
    const config = loadConfig();
    const { toolRegistry } = bootstrap(config);

    const inputs: Record<string, unknown> = {};

    if (opts.input) {
      try {
        Object.assign(inputs, JSON.parse(opts.input));
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`Invalid JSON in --input: ${msg}`);
        process.exit(1);
      }
    }

    if (opts.param) {
      for (const p of opts.param) {
        const idx = p.indexOf('=');
        if (idx === -1) {
          console.error(`Invalid param "${p}". Use key=value format.`);
          process.exit(1);
        }
        inputs[p.slice(0, idx)] = p.slice(idx + 1);
      }
    }

    await toolRun(toolRegistry, toolName, inputs);
  });

// Integration commands (top-level)
const integ = program.command('integration').description('Manage tool integrations');
integ.command('list <project-id>').description('List integrations for a project')
  .action((projectId: string) => {
    const config = loadConfig();
    const { storage } = bootstrap(config);
    integrationList(storage, projectId);
  });
integ.command('set <project-id> <service>').description('Set a tool integration')
  .option('--site <site>', 'Jira site (e.g. myorg.atlassian.net)')
  .option('--email <email>', 'Jira email')
  .option('--url <url>', 'Service URL (n8n)')
  .option('--api-key <key>', 'API key (n8n)')
  .option('--repo <repo>', 'GitHub repo (org/repo)')
  .option('--token <token>', 'GitHub token')
  .action((projectId: string, service: string, opts) => {
    const config = loadConfig();
    const { storage } = bootstrap(config);
    integrationSet(storage, projectId, service, opts);
  });
integ.command('remove <project-id> <service>').description('Remove a tool integration')
  .action((projectId: string, service: string) => {
    const config = loadConfig();
    const { storage } = bootstrap(config);
    integrationRemove(storage, projectId, service);
  });

// AI commands
const ai = program.command('ai').description('Configure AI providers');
ai.command('setup').description('Interactive AI provider setup').action(async () => {
  const config = loadConfig();
  const { storage } = bootstrap(config);
  await aiSetup(storage);
});
ai.command('status').description('Show active AI provider').action(() => {
  const config = loadConfig();
  const { storage } = bootstrap(config);
  aiStatus(storage);
});
ai.command('list').description('List configured providers').action(() => {
  const config = loadConfig();
  const { storage } = bootstrap(config);
  aiList(storage);
});
ai.command('activate <provider>').description('Activate a provider').action((provider: string) => {
  const config = loadConfig();
  const { storage } = bootstrap(config);
  aiActivate(storage, provider);
});
ai.command('set <provider>').description('Configure a provider (non-interactive)')
  .option('--model <model>', 'Model name')
  .option('--api-key <key>', 'API key')
  .option('--base-url <url>', 'Base URL')
  .option('--no-activate', 'Do not activate after setting')
  .action((provider: string, opts) => {
    const config = loadConfig();
    const { storage } = bootstrap(config);
    aiSet(storage, provider, opts);
  });
ai.command('test').description('Test active AI provider').action(async () => {
  const config = loadConfig();
  const { storage } = bootstrap(config);
  await aiTest(storage);
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
