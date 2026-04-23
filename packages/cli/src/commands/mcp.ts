import chalk from 'chalk';
import { execSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, join } from 'node:path';
import { homedir } from 'node:os';
import type { Storage } from '@jarvis/storage';
import type { ToolRegistry } from '@jarvis/core';
import { getJarvisKnowledge } from '@jarvis/core';

const SERVER_NAME = 'jarvis';
const BLOCK_BEGIN = '<!-- JARVIS:BEGIN';
const BLOCK_END = '<!-- JARVIS:END -->';

function repoRoot(): string {
  return resolve(process.cwd());
}

function mcpDistPath(root: string): string {
  return resolve(root, 'packages/mcp/dist/index.js');
}

function hasClaudeCli(): boolean {
  const r = spawnSync('claude', ['--version'], { stdio: 'ignore' });
  return r.status === 0;
}

function runClaude(args: string[]): { status: number; stdout: string; stderr: string } {
  const r = spawnSync('claude', args, { encoding: 'utf-8' });
  return {
    status: r.status ?? 1,
    stdout: r.stdout ?? '',
    stderr: r.stderr ?? '',
  };
}

function isInstalled(scope: 'user' | 'local' | 'project'): boolean {
  const r = runClaude(['mcp', 'get', SERVER_NAME]);
  return r.status === 0 && r.stdout.includes(SERVER_NAME);
}

function buildMcp(root: string): void {
  console.log(chalk.cyan('› Building @jarvis/mcp...'));
  try {
    execSync('pnpm nx run @jarvis/mcp:build', {
      cwd: root,
      stdio: 'inherit',
    });
  } catch {
    console.error(chalk.red('✗ Build failed'));
    process.exit(1);
  }
}

function buildEnvArgs(envVars: Record<string, string>): string[] {
  const args: string[] = [];
  for (const [k, v] of Object.entries(envVars)) {
    args.push('-e', `${k}=${v}`);
  }
  return args;
}

function parseEnvOption(envOpt: string[] | undefined): Record<string, string> {
  // MCP server resolves ~/.jarvis/ on its own — no DB path env var needed.
  const envVars: Record<string, string> = {};
  if (!envOpt) return envVars;
  for (const pair of envOpt) {
    const idx = pair.indexOf('=');
    if (idx === -1) {
      console.error(chalk.red(`Invalid --env entry "${pair}". Use KEY=VALUE.`));
      process.exit(1);
    }
    envVars[pair.slice(0, idx)] = pair.slice(idx + 1);
  }
  return envVars;
}

export interface McpInstallOptions {
  scope?: 'user' | 'local' | 'project';
  env?: string[];
  skipBuild?: boolean;
}

export function mcpInstall(opts: McpInstallOptions): void {
  if (!hasClaudeCli()) {
    console.error(chalk.red('✗ `claude` CLI not found in PATH.'));
    console.error(chalk.dim('  Install Claude Code first: https://docs.claude.com/claude-code'));
    process.exit(1);
  }

  const root = repoRoot();
  const distPath = mcpDistPath(root);
  const scope = opts.scope ?? 'user';
  const envVars = parseEnvOption(opts.env);

  if (!opts.skipBuild || !existsSync(distPath)) {
    buildMcp(root);
  }

  if (!existsSync(distPath)) {
    console.error(chalk.red(`✗ MCP dist not found at ${distPath}`));
    process.exit(1);
  }

  if (isInstalled(scope)) {
    console.log(chalk.yellow(`↻ ${SERVER_NAME} already registered — re-installing`));
    runClaude(['mcp', 'remove', SERVER_NAME, '-s', scope]);
  }

  const args = [
    'mcp', 'add', SERVER_NAME,
    '--scope', scope,
    ...buildEnvArgs(envVars),
    '--', 'node', distPath,
  ];
  const r = runClaude(args);
  if (r.status !== 0) {
    console.error(chalk.red('✗ Failed to register Jarvis MCP:'));
    console.error(r.stderr || r.stdout);
    process.exit(1);
  }

  console.log(chalk.green(`✓ Jarvis MCP registered (scope: ${scope})`));
  console.log(chalk.dim(`  Command: node ${distPath}`));
  for (const [k, v] of Object.entries(envVars)) {
    console.log(chalk.dim(`  ${k}=${v}`));
  }
  console.log(chalk.dim('\nVerify with: claude mcp get jarvis'));
}

export interface McpUpdateOptions extends McpInstallOptions {}

export function mcpUpdate(opts: McpUpdateOptions): void {
  console.log(chalk.bold('↻ Updating Jarvis MCP\n'));
  mcpInstall({ ...opts, skipBuild: false });
}

export function mcpUninstall(scope: 'user' | 'local' | 'project' = 'user'): void {
  if (!hasClaudeCli()) {
    console.error(chalk.red('✗ `claude` CLI not found in PATH.'));
    process.exit(1);
  }
  const r = runClaude(['mcp', 'remove', SERVER_NAME, '-s', scope]);
  if (r.status !== 0) {
    console.error(chalk.red('✗ Uninstall failed:'));
    console.error(r.stderr || r.stdout);
    process.exit(1);
  }
  console.log(chalk.green(`✓ Jarvis MCP removed (scope: ${scope})`));
}

export function mcpStatus(): void {
  if (!hasClaudeCli()) {
    console.error(chalk.red('✗ `claude` CLI not found in PATH.'));
    process.exit(1);
  }
  const r = runClaude(['mcp', 'get', SERVER_NAME]);
  if (r.status !== 0) {
    console.log(chalk.yellow(`✗ Jarvis MCP not registered.`));
    console.log(chalk.dim('  Run: jarvis mcp install'));
    return;
  }
  console.log(r.stdout);
}

// ── sync: keep CLAUDE.md instruction blocks in sync with Jarvis state ────────

function hash(content: string): string {
  return createHash('sha256').update(content).digest('hex').slice(0, 12);
}

function userClaudeMd(): string {
  return join(homedir(), '.claude', 'CLAUDE.md');
}

function projectClaudeMd(): string {
  return resolve(process.cwd(), 'CLAUDE.md');
}

export interface BlockSource {
  scope: 'user' | 'project';
  toolRegistry?: ToolRegistry;
  projects?: Array<{ id: string; name: string }>;
  projectContext?: {
    id: string;
    name: string;
    integrations: Array<{ service: string }>;
    workflows?: Array<{ name: string; description: string | null }>;
  };
}

function renderBlock(src: BlockSource): string {
  const lines: string[] = [];

  if (src.scope === 'user') {
    if (!src.toolRegistry) throw new Error('toolRegistry required for user scope');
    return getJarvisKnowledge(src.toolRegistry, {
      projects: src.projects,
      forSystemPrompt: false,
    });
  } else {
    lines.push('## Jarvis MCP (project)');
    lines.push('');
    if (src.projectContext) {
      lines.push(`**project_id**: \`${src.projectContext.id}\` (${src.projectContext.name})`);
      lines.push('');
      lines.push('Pass this `project_id` when calling Jarvis tools that accept it.');
      if (src.projectContext.integrations.length > 0) {
        lines.push('');
        lines.push('### Active integrations');
        for (const i of src.projectContext.integrations) {
          lines.push(`- \`${i.service}\``);
        }
      } else {
        lines.push('');
        lines.push('### Active integrations');
        lines.push('_(none configured — run `jarvis integration set ...`)_');
      }
      // Registered n8n workflows section (only if non-empty)
      if (src.projectContext.workflows && src.projectContext.workflows.length > 0) {
        lines.push('');
        lines.push('## Workflows registrados (n8n)');
        lines.push('');
        for (const wf of src.projectContext.workflows) {
          const desc = wf.description ? ` — ${wf.description}` : '';
          lines.push(`- \`${wf.name}\`${desc}`);
        }
      }
    } else {
      lines.push('_No Jarvis project pinned for this directory. Run `jarvis mcp sync --project --project-id <id>`._');
    }
  }

  return lines.join('\n');
}

function wrapBlock(body: string): string {
  const h = hash(body);
  return `${BLOCK_BEGIN} hash=${h} -->\n${body}\n${BLOCK_END}`;
}

interface ExistingBlock {
  full: string;
  body: string;
  hash: string;
  startIdx: number;
  endIdx: number;
}

function findBlock(content: string): ExistingBlock | null | 'duplicate' {
  const beginMatches = [...content.matchAll(/<!-- JARVIS:BEGIN hash=([a-f0-9]+) -->/g)];
  const endMatches = [...content.matchAll(/<!-- JARVIS:END -->/g)];
  if (beginMatches.length === 0 && endMatches.length === 0) return null;
  if (beginMatches.length > 1 || endMatches.length > 1) return 'duplicate';
  if (beginMatches.length !== endMatches.length) return 'duplicate';

  const begin = beginMatches[0];
  const end = endMatches[0];
  if (begin.index === undefined || end.index === undefined) return 'duplicate';
  if (begin.index > end.index) return 'duplicate';

  const startIdx = begin.index;
  const endIdx = end.index + end[0].length;
  const full = content.slice(startIdx, endIdx);
  const bodyMatch = full.match(/<!-- JARVIS:BEGIN hash=[a-f0-9]+ -->\n([\s\S]*)\n<!-- JARVIS:END -->/);
  const body = bodyMatch ? bodyMatch[1] : '';

  return { full, body, hash: begin[1], startIdx, endIdx };
}

export interface SyncResult {
  action: 'created' | 'appended' | 'updated' | 'unchanged' | 'would-create' | 'would-append' | 'would-update' | 'drift';
  path: string;
  newHash?: string;
  oldHash?: string;
}

export function computeSync(
  filePath: string,
  src: BlockSource,
  opts: { dryRun?: boolean; check?: boolean; force?: boolean } = {}
): SyncResult {
  const body = renderBlock(src);
  const newHash = hash(body);
  const newBlock = wrapBlock(body);

  const existed = existsSync(filePath);
  const content = existed ? readFileSync(filePath, 'utf-8') : '';

  const found = findBlock(content);

  if (found === 'duplicate' && !opts.force) {
    throw new Error(
      `Malformed or duplicate Jarvis block in ${filePath}. ` +
        `Inspect manually and clean up, or re-run with --force to overwrite.`
    );
  }

  if (found && found !== 'duplicate') {
    const bodyHash = hash(found.body);
    if (bodyHash === newHash && found.hash === newHash) {
      return { action: 'unchanged', path: filePath, newHash, oldHash: found.hash };
    }
  }

  if (opts.check) {
    const currentHash =
      found && found !== 'duplicate' ? hash(found.body) : undefined;
    return {
      action: 'drift',
      path: filePath,
      newHash,
      oldHash: currentHash,
    };
  }

  let next: string;
  if (!existed) {
    next = newBlock + '\n';
  } else if (found && found !== 'duplicate') {
    next = content.slice(0, found.startIdx) + newBlock + content.slice(found.endIdx);
  } else {
    const sep = content.length === 0 || content.endsWith('\n\n') ? '' : content.endsWith('\n') ? '\n' : '\n\n';
    next = content + sep + newBlock + '\n';
  }

  const dryAction: SyncResult['action'] =
    found && found !== 'duplicate' ? 'would-update' : existed ? 'would-append' : 'would-create';
  const writeAction: SyncResult['action'] =
    found && found !== 'duplicate' ? 'updated' : existed ? 'appended' : 'created';

  if (opts.dryRun) {
    return {
      action: dryAction,
      path: filePath,
      newHash,
      oldHash: found && found !== 'duplicate' ? found.hash : undefined,
    };
  }

  writeFileSync(filePath, next, 'utf-8');
  return {
    action: writeAction,
    path: filePath,
    newHash,
    oldHash: found && found !== 'duplicate' ? hash(found.body) : undefined,
  };
}

export interface McpSyncOptions {
  project?: boolean;
  projectId?: string;
  dryRun?: boolean;
  check?: boolean;
  force?: boolean;
}

export function mcpSync(
  storage: Storage,
  toolRegistry: ToolRegistry,
  opts: McpSyncOptions
): void {
  const scope: 'user' | 'project' = opts.project ? 'project' : 'user';
  const filePath = scope === 'user' ? userClaudeMd() : projectClaudeMd();

  let src: BlockSource;
  if (scope === 'user') {
    const projects = storage.projects.list().map((p) => ({ id: p.id, name: p.name }));
    src = { scope, toolRegistry, projects };
  } else {
    let projectContext;
    if (opts.projectId) {
      const project = storage.projects.get(opts.projectId);
      if (!project) {
        console.error(chalk.red(`✗ Project not found: ${opts.projectId}`));
        process.exit(1);
      }
      const integrations = storage.integrations.list(opts.projectId).map((i) => ({ service: i.service }));
      // Seed workflow registry rules (idempotent — safe to call every sync)
      storage.rules.seedWorkflowRegistryRules(opts.projectId);
      // Load registered workflows for this project
      const workflows = storage.projectWorkflows
        .listByProject(opts.projectId)
        .map((wf) => ({ name: wf.name, description: wf.description }));
      projectContext = { id: project.id, name: project.name, integrations, workflows };
    }
    src = { scope, projectContext };
  }

  let result: SyncResult;
  try {
    result = computeSync(filePath, src, opts);
  } catch (err) {
    console.error(chalk.red(`✗ ${err instanceof Error ? err.message : String(err)}`));
    process.exit(1);
  }

  const rel = filePath.replace(homedir(), '~');
  switch (result.action) {
    case 'unchanged':
      console.log(chalk.green(`✓ Up to date: ${rel}`));
      break;
    case 'created':
      console.log(chalk.green(`✓ Created ${rel} with Jarvis block (${result.newHash})`));
      break;
    case 'appended':
      console.log(chalk.green(`✓ Appended Jarvis block to ${rel} (${result.newHash})`));
      break;
    case 'updated':
      console.log(chalk.green(`✓ Updated Jarvis block in ${rel} (${result.oldHash} → ${result.newHash})`));
      break;
    case 'would-create':
      console.log(chalk.cyan(`[dry-run] would create ${rel} with Jarvis block (${result.newHash})`));
      break;
    case 'would-append':
      console.log(chalk.cyan(`[dry-run] would append Jarvis block to ${rel} (${result.newHash})`));
      break;
    case 'would-update':
      console.log(chalk.cyan(`[dry-run] would update Jarvis block in ${rel} (${result.oldHash} → ${result.newHash})`));
      break;
    case 'drift':
      console.log(chalk.yellow(`⚠ Drift detected: ${rel}`));
      console.log(chalk.dim(`  Current: ${result.oldHash ?? 'none'}  → Expected: ${result.newHash}`));
      console.log(chalk.dim(`  Run: jarvis mcp sync${opts.project ? ' --project' : ''}`));
      process.exit(2);
  }
}

export function mcpCheckDrift(
  storage: Storage,
  toolRegistry: ToolRegistry
): { scope: 'user' | 'project'; path: string; drift: boolean; reason?: string }[] {
  const results: { scope: 'user' | 'project'; path: string; drift: boolean; reason?: string }[] = [];

  const userPath = userClaudeMd();
  if (existsSync(userPath)) {
    const projects = storage.projects.list().map((p) => ({ id: p.id, name: p.name }));
    try {
      const r = computeSync(userPath, { scope: 'user', toolRegistry, projects }, { check: true });
      results.push({ scope: 'user', path: userPath, drift: r.action === 'drift', reason: r.action === 'drift' ? 'hash mismatch' : undefined });
    } catch (err) {
      results.push({ scope: 'user', path: userPath, drift: true, reason: err instanceof Error ? err.message : 'check failed' });
    }
  }

  return results;
}
