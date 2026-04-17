import chalk from 'chalk';
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import type { Storage } from '@jarvis/storage';
import type { ToolRegistry } from '@jarvis/core';
import type { CliConfig } from '../config.js';
import { mcpCheckDrift } from './mcp.js';
import { homedir } from 'node:os';

interface CheckResult {
  name: string;
  status: 'ok' | 'warn' | 'error';
  message: string;
  hint?: string;
}

// Workflows the tools expect to find in n8n.
// When a tool is refactored to use a workflow, add its name here.
const REQUIRED_WORKFLOWS = [
  'jira-analyze-ticket',
];

export async function doctorCommand(
  storage: Storage,
  toolRegistry: ToolRegistry,
  config: CliConfig
): Promise<void> {
  console.log(chalk.bold('\n🔍 JARVIS Doctor\n'));

  const results: CheckResult[] = [];

  results.push(checkNode());
  results.push(checkDatabase(config));
  results.push(checkCognitiveBase(config));
  results.push(checkAIProvider(storage));
  results.push(await checkGateway());
  results.push(await checkN8n(storage));
  results.push(...(await checkN8nWorkflows(storage)));
  results.push(checkAcli());
  results.push(checkDocker());
  results.push(checkMcpInstructions(storage, toolRegistry));

  // Render
  for (const r of results) {
    renderResult(r);
  }

  // Summary
  const errors = results.filter((r) => r.status === 'error').length;
  const warns = results.filter((r) => r.status === 'warn').length;
  console.log('');
  if (errors === 0 && warns === 0) {
    console.log(chalk.green.bold('✓ JARVIS listo para usar.\n'));
  } else {
    const parts: string[] = [];
    if (errors > 0) parts.push(chalk.red(`${errors} error${errors === 1 ? '' : 'es'}`));
    if (warns > 0) parts.push(chalk.yellow(`${warns} advertencia${warns === 1 ? '' : 's'}`));
    console.log(chalk.bold(`Resumen: ${parts.join(', ')}.\n`));
    if (errors > 0) process.exitCode = 1;
  }
}

function renderResult(r: CheckResult): void {
  const icon = r.status === 'ok' ? chalk.green('✓') : r.status === 'warn' ? chalk.yellow('⚠') : chalk.red('✗');
  console.log(`${icon} ${chalk.bold(r.name)}: ${r.message}`);
  if (r.hint) {
    for (const line of r.hint.split('\n')) {
      console.log(chalk.gray(`   ${line}`));
    }
  }
}

function checkNode(): CheckResult {
  const version = process.versions.node;
  const major = parseInt(version.split('.')[0] ?? '0', 10);
  if (major >= 20) {
    return { name: 'Node.js', status: 'ok', message: `${version}` };
  }
  return {
    name: 'Node.js',
    status: 'error',
    message: `${version} (requiere >= 20)`,
    hint: 'Actualiza Node.js a la version 20 LTS o superior',
  };
}

function checkDatabase(config: CliConfig): CheckResult {
  if (existsSync(config.dbPath)) {
    return { name: 'Database', status: 'ok', message: config.dbPath };
  }
  return {
    name: 'Database',
    status: 'error',
    message: `No existe en ${config.dbPath}`,
    hint: 'Ejecuta: jarvis setup',
  };
}

function checkCognitiveBase(config: CliConfig): CheckResult {
  if (existsSync(config.cognitiveBasePath)) {
    return { name: 'Cognitive base', status: 'ok', message: config.cognitiveBasePath };
  }
  return {
    name: 'Cognitive base',
    status: 'warn',
    message: 'No existe base/cognition.md',
    hint: 'Crea el archivo para personalizar la forma de pensar de JARVIS',
  };
}

function checkAIProvider(storage: Storage): CheckResult {
  const active = storage.aiConfig.getActive();
  if (!active) {
    return {
      name: 'AI provider',
      status: 'error',
      message: 'No hay proveedor activo',
      hint: 'Ejecuta: jarvis ai setup',
    };
  }
  const hasKey = active.api_key || active.provider === 'ollama';
  if (!hasKey) {
    return {
      name: 'AI provider',
      status: 'error',
      message: `${active.provider} sin API key`,
      hint: `Ejecuta: jarvis ai set ${active.provider} --api-key <key>`,
    };
  }
  return { name: 'AI provider', status: 'ok', message: `${active.provider} (${active.model})` };
}

async function checkGateway(): Promise<CheckResult> {
  const url = 'http://localhost:3100/api/health';
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);
    if (res.ok) {
      return { name: 'HTTP Gateway', status: 'ok', message: 'http://localhost:3100' };
    }
    return {
      name: 'HTTP Gateway',
      status: 'error',
      message: `Respondio ${res.status}`,
      hint: 'Reinicia el gateway: make http-gateway',
    };
  } catch {
    return {
      name: 'HTTP Gateway',
      status: 'error',
      message: 'No disponible en puerto 3100',
      hint: 'Ejecuta: make http-gateway\nO en background: node packages/http-gateway/dist/index.js &',
    };
  }
}

async function checkN8n(storage: Storage): Promise<CheckResult> {
  const url = resolveN8nUrl(storage);
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);
    const res = await fetch(`${url}/healthz`, { signal: controller.signal });
    clearTimeout(timeout);
    if (res.ok) {
      return { name: 'n8n', status: 'ok', message: url };
    }
    return { name: 'n8n', status: 'error', message: `Respondio ${res.status}`, hint: `Verifica n8n en ${url}` };
  } catch {
    return {
      name: 'n8n',
      status: 'error',
      message: `No disponible en ${url}`,
      hint: 'Ejecuta: make docker-up\nO: docker run -d -p 5678:5678 n8nio/n8n',
    };
  }
}

async function checkN8nWorkflows(storage: Storage): Promise<CheckResult[]> {
  const url = resolveN8nUrl(storage);
  const apiKey = resolveN8nApiKey(storage);
  if (!apiKey) {
    return [{
      name: 'n8n workflows',
      status: 'warn',
      message: 'No se puede verificar (falta api_key)',
      hint: 'Configura: jarvis integration set <project> n8n --url <url> --api-key <key>',
    }];
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(`${url}/api/v1/workflows`, {
      headers: { 'X-N8N-API-KEY': apiKey },
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!res.ok) {
      return [{
        name: 'n8n workflows',
        status: 'error',
        message: `API respondio ${res.status}`,
        hint: 'Verifica que la API key sea valida',
      }];
    }
    const data = (await res.json()) as { data: Array<{ name: string; active: boolean }> };
    const existing = new Map<string, boolean>();
    for (const w of data.data || []) {
      existing.set(w.name.toLowerCase().replace(/\s+/g, '-'), w.active);
    }

    return REQUIRED_WORKFLOWS.map((required) => {
      const match = [...existing.entries()].find(([k]) => k.includes(required));
      if (!match) {
        return {
          name: `Workflow "${required}"`,
          status: 'error' as const,
          message: 'No encontrado en n8n',
          hint: 'Ejecuta: jarvis n8n install (pendiente de implementar)',
        };
      }
      if (!match[1]) {
        return {
          name: `Workflow "${required}"`,
          status: 'warn' as const,
          message: 'Existe pero esta inactivo',
          hint: 'Activalo desde la UI o con: jarvis n8n install',
        };
      }
      return { name: `Workflow "${required}"`, status: 'ok' as const, message: 'Activo' };
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return [{ name: 'n8n workflows', status: 'warn', message: `No se pudo listar: ${msg}` }];
  }
}

function checkAcli(): CheckResult {
  try {
    execSync('acli --version', { stdio: 'pipe', timeout: 5000 });
    return { name: 'ACLI (Jira)', status: 'ok', message: 'Instalado (opcional)' };
  } catch {
    return {
      name: 'ACLI (Jira)',
      status: 'warn',
      message: 'No esta en el PATH',
      hint: 'Solo requerido para la tool de Jira.\nInstalacion: https://bobswift.atlassian.net/wiki/spaces/ACLI',
    };
  }
}

function checkDocker(): CheckResult {
  try {
    execSync('docker --version', { stdio: 'pipe', timeout: 5000 });
    return { name: 'Docker', status: 'ok', message: 'Instalado (opcional)' };
  } catch {
    return {
      name: 'Docker',
      status: 'warn',
      message: 'No esta en el PATH',
      hint: 'Opcional, pero recomendado para correr n8n facilmente.\nInstalacion: https://docs.docker.com/get-docker',
    };
  }
}

function resolveN8nUrl(storage: Storage): string {
  // Try to find any project with n8n integration configured
  const projects = storage.projects.list();
  for (const p of projects) {
    const cfg = storage.integrations.getConfig<{ url: string }>(p.id, 'n8n');
    if (cfg?.url) return cfg.url.replace(/\/$/, '');
  }
  return 'http://localhost:5678';
}

function resolveN8nApiKey(storage: Storage): string | null {
  const projects = storage.projects.list();
  for (const p of projects) {
    const cfg = storage.integrations.getConfig<{ api_key: string }>(p.id, 'n8n');
    if (cfg?.api_key) return cfg.api_key;
  }
  return null;
}

function checkMcpInstructions(storage: Storage, toolRegistry: ToolRegistry): CheckResult {
  try {
    const drifts = mcpCheckDrift(storage, toolRegistry);
    if (drifts.length === 0) {
      return {
        name: 'MCP instructions',
        status: 'warn',
        message: 'No ~/.claude/CLAUDE.md found',
        hint: 'Run: jarvis mcp sync',
      };
    }
    const outOfSync = drifts.filter((d) => d.drift);
    if (outOfSync.length === 0) {
      return { name: 'MCP instructions', status: 'ok', message: 'Instruction block up to date' };
    }
    const paths = outOfSync.map((d) => d.path.replace(homedir(), '~')).join(', ');
    return {
      name: 'MCP instructions',
      status: 'warn',
      message: `Drift detected: ${paths}`,
      hint: 'Run: jarvis mcp sync',
    };
  } catch (err) {
    return {
      name: 'MCP instructions',
      status: 'warn',
      message: err instanceof Error ? err.message : String(err),
    };
  }
}
