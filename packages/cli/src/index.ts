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
import { n8nExport } from './commands/n8n.js';
import { mcpInstall, mcpUpdate, mcpUninstall, mcpStatus, mcpSync } from './commands/mcp.js';
import { refineSave, refineIterate, refineList, refineShow, refineFinalize } from './commands/refine.js';

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
    const { storage, toolRegistry } = bootstrap(config);
    await doctorCommand(storage, toolRegistry, config);
  });

// n8n utilities
const n8n = program.command('n8n').description('n8n workflow utilities');
n8n.command('export <workflow-name>')
  .description('Export a workflow from n8n to the local repo as JSON')
  .option('-o, --output <path>', 'Output path (defaults to packages/tools/<tool>/workflows/<name>.json)')
  .action(async (workflowName: string, opts: { output?: string }) => {
    const config = loadConfig();
    const { storage } = bootstrap(config);
    await n8nExport(storage, workflowName, opts.output);
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

// MCP registration commands — manage Jarvis as an MCP server for Claude Code
const mcp = program.command('mcp').description('Manage Jarvis as an MCP server for Claude Code');

mcp.command('install')
  .description('Build and register Jarvis MCP in Claude Code')
  .option('-s, --scope <scope>', 'Registration scope: user | local | project', 'user')
  .option('-e, --env <kv...>', 'Extra env var(s) as KEY=VALUE (can repeat)')
  .option('--skip-build', 'Skip rebuilding @jarvis/mcp before registering')
  .action((opts: { scope?: 'user' | 'local' | 'project'; env?: string[]; skipBuild?: boolean }) => {
    mcpInstall(opts);
  });

mcp.command('update')
  .description('Rebuild @jarvis/mcp and re-register it in Claude Code')
  .option('-s, --scope <scope>', 'Registration scope: user | local | project', 'user')
  .option('-e, --env <kv...>', 'Extra env var(s) as KEY=VALUE (can repeat)')
  .action((opts: { scope?: 'user' | 'local' | 'project'; env?: string[] }) => {
    mcpUpdate(opts);
  });

mcp.command('uninstall')
  .description('Remove Jarvis MCP registration from Claude Code')
  .option('-s, --scope <scope>', 'Scope to remove from: user | local | project', 'user')
  .action((opts: { scope?: 'user' | 'local' | 'project' }) => {
    mcpUninstall(opts.scope ?? 'user');
  });

mcp.command('status')
  .description('Show Jarvis MCP registration status')
  .action(() => {
    mcpStatus();
  });

mcp.command('sync')
  .description('Sync Jarvis instruction block in CLAUDE.md (user scope by default)')
  .option('--project', 'Write to ./CLAUDE.md in the current directory instead of ~/.claude/CLAUDE.md')
  .option('--project-id <id>', 'Pin a specific Jarvis project_id (only with --project)')
  .option('--dry-run', 'Show what would change without writing')
  .option('--check', 'Exit non-zero if the block is out of sync; do not write')
  .option('--force', 'Overwrite even if duplicate/malformed blocks are detected')
  .action((opts: { project?: boolean; projectId?: string; dryRun?: boolean; check?: boolean; force?: boolean }) => {
    const config = loadConfig();
    const { storage, toolRegistry } = bootstrap(config);
    mcpSync(storage, toolRegistry, opts);
  });

// Refine commands — iterative requirements refinement
const refine = program.command('refine').description('Gestión de refinamientos iterativos');

refine.command('save <thread-id> <output-file>')
  .description('Guardar el output de una iteración de refinamiento en un hilo')
  .option('--instructions <text>', 'Instrucciones de corrección usadas en esta iteración')
  .option('--requirements <file>', 'Archivo con los requerimientos originales (solo para iteración 1)')
  .option('-p, --project <id>', 'ID del proyecto')
  .action(async (threadId: string, outputFile: string, opts: { instructions?: string; requirements?: string; project?: string }) => {
    const config = loadConfig();
    const { storage, toolRegistry } = bootstrap(config);
    await refineSave({ storage, toolRegistry }, threadId, outputFile, opts);
  });

refine.command('iterate [thread-id]')
  .description('Generar una nueva iteración de refinamiento de requerimientos')
  .option('--input <file>', 'Archivo con los requerimientos a refinar (requerido)')
  .option('--instructions <text>', 'Instrucciones de corrección para esta iteración')
  .option('-p, --project <id>', 'ID del proyecto')
  .action(async (threadId: string | undefined, opts: { input?: string; instructions?: string; project?: string }) => {
    const config = loadConfig();
    const { storage, toolRegistry } = bootstrap(config);
    await refineIterate({ storage, toolRegistry }, threadId, opts);
  });

refine.command('list <thread-id>')
  .description('Listar todas las iteraciones de un hilo de refinamiento')
  .action(async (threadId: string) => {
    const config = loadConfig();
    const { storage, toolRegistry } = bootstrap(config);
    await refineList({ storage, toolRegistry }, threadId);
  });

refine.command('show <thread-id>')
  .description('Mostrar el output de una iteración (por defecto: la última)')
  .option('--iteration <n>', 'Número de iteración a mostrar')
  .action(async (threadId: string, opts: { iteration?: string }) => {
    const config = loadConfig();
    const { storage, toolRegistry } = bootstrap(config);
    await refineShow({ storage, toolRegistry }, threadId, opts);
  });

refine.command('finalize <thread-id>')
  .description('Finalizar un hilo de refinamiento (no se admitirán nuevas iteraciones)')
  .action(async (threadId: string) => {
    const config = loadConfig();
    const { storage, toolRegistry } = bootstrap(config);
    await refineFinalize({ storage, toolRegistry }, threadId);
  });

program.parse();
