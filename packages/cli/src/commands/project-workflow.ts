import chalk from 'chalk';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Storage } from '@jarvis/storage';

// ---------------------------------------------------------------------------
// Helper: resolve project_id from flag → env var → .jarvis/project.json
// ---------------------------------------------------------------------------

export function resolveProjectId(flagValue?: string): string {
  if (flagValue) return flagValue;

  const envVal = process.env['JARVIS_PROJECT_ID'];
  if (envVal) return envVal;

  const jsonPath = resolve(process.cwd(), '.jarvis', 'project.json');
  if (existsSync(jsonPath)) {
    try {
      const raw = readFileSync(jsonPath, 'utf-8');
      const parsed = JSON.parse(raw) as { project_id?: string; id?: string };
      const id = parsed.project_id ?? parsed.id;
      if (id) return id;
    } catch {
      // malformed file — fall through to error
    }
  }

  console.error(
    chalk.red(
      '✗ No se pudo determinar el project_id. Usá --project <id>, JARVIS_PROJECT_ID, o creá .jarvis/project.json.',
    ),
  );
  process.exit(1);
}

// ---------------------------------------------------------------------------
// add <name> --n8n-id <id> [--description <desc>] [--local-path <path>]
// ---------------------------------------------------------------------------

const NAME_REGEX = /^[a-z0-9][a-z0-9-]*[a-z0-9]$/;

export async function projectWorkflowAdd(
  storage: Storage,
  name: string,
  opts: { n8nId: string; description?: string; localPath?: string; project?: string },
): Promise<void> {
  const project_id = resolveProjectId(opts.project);

  // Validate name
  if (!NAME_REGEX.test(name)) {
    console.error(
      chalk.red(
        `✗ Nombre inválido: "${name}". Debe coincidir con /^[a-z0-9][a-z0-9-]*[a-z0-9]$/ (solo minúsculas, dígitos y guiones, sin empezar/terminar en guión).`,
      ),
    );
    process.exit(1);
  }

  // Validate project exists
  const project = storage.projects.get(project_id);
  if (!project) {
    console.error(chalk.red(`✗ Proyecto no encontrado: "${project_id}".`));
    process.exit(1);
  }

  // Validate n8n integration exists
  const n8nConfig = storage.integrations.getConfig(project_id, 'n8n');
  if (!n8nConfig) {
    console.error(
      chalk.red(
        `✗ El proyecto "${project_id}" no tiene integración n8n configurada.`,
      ),
    );
    console.error(
      chalk.dim(
        '  Configurala con: jarvis integration set <project_id> n8n --url <url> --api-key <key>',
      ),
    );
    process.exit(1);
  }

  // Persist directly via storage (no n8n API validation in CLI — less friction)
  const row = storage.projectWorkflows.register({
    project_id,
    name,
    description: opts.description ?? null,
    n8n_workflow_id: opts.n8nId,
    local_path: opts.localPath ?? null,
  });

  console.log(chalk.green(`✓ Workflow "${name}" registrado en proyecto "${project_id}"`));
  console.log(chalk.dim(`  n8n_workflow_id : ${row.n8n_workflow_id}`));
  if (row.description) console.log(chalk.dim(`  description     : ${row.description}`));
  if (row.local_path) console.log(chalk.dim(`  local_path      : ${row.local_path}`));
  console.log(chalk.dim(`  id              : ${row.id} | created_at: ${row.created_at}`));
}

// ---------------------------------------------------------------------------
// list [--project <id>] [--global]
// ---------------------------------------------------------------------------

export async function projectWorkflowList(
  storage: Storage,
  opts: { project?: string; global?: boolean },
): Promise<void> {
  if (opts.global) {
    // List all workflows from n8n API (raw, global scope)
    // Find any project with n8n integration
    const projects = storage.projects.list();
    let n8nCfg: { url: string; api_key: string } | null = null;
    for (const p of projects) {
      const cfg = storage.integrations.getConfig<{ url: string; api_key: string }>(p.id, 'n8n');
      if (cfg?.url && cfg?.api_key) {
        n8nCfg = cfg;
        break;
      }
    }

    if (!n8nCfg) {
      console.error(chalk.red('✗ No se encontró ningún proyecto con integración n8n configurada.'));
      console.error(chalk.dim('  Configurala con: jarvis integration set <project_id> n8n --url <url> --api-key <key>'));
      process.exit(1);
    }

    const baseUrl = n8nCfg.url.replace(/\/$/, '');
    try {
      const res = await fetch(`${baseUrl}/api/v1/workflows`, {
        headers: { 'X-N8N-API-KEY': n8nCfg.api_key },
      });
      if (!res.ok) {
        console.error(chalk.red(`✗ Error al listar workflows en n8n (${res.status}): ${await res.text()}`));
        process.exit(1);
      }
      const data = (await res.json()) as { data: Array<{ id: string; name: string; active: boolean }> };
      const workflows = data.data ?? [];

      if (workflows.length === 0) {
        console.log(chalk.yellow('No hay workflows en la instancia de n8n.'));
        return;
      }

      console.log(chalk.bold('\nWorkflows en n8n (global):\n'));
      const idW = 10;
      const nameW = 40;
      console.log(
        chalk.dim('id'.padEnd(idW) + 'active'.padEnd(8) + 'name'),
      );
      console.log(chalk.dim('─'.repeat(idW + 8 + nameW)));
      for (const wf of workflows) {
        const active = wf.active ? chalk.green('yes') : chalk.gray('no');
        console.log(`${String(wf.id).padEnd(idW)}${active.padEnd(8 + (wf.active ? 0 : 0))}${wf.name}`);
      }
      console.log('');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(chalk.red(`✗ Error: ${msg}`));
      process.exit(1);
    }
    return;
  }

  // Project-scoped list
  const project_id = resolveProjectId(opts.project);
  const project = storage.projects.get(project_id);
  if (!project) {
    console.error(chalk.red(`✗ Proyecto no encontrado: "${project_id}".`));
    process.exit(1);
  }

  const rows = storage.projectWorkflows.listByProject(project_id);
  if (rows.length === 0) {
    console.log(chalk.yellow(`No hay workflows registrados para el proyecto "${project_id}".`));
    return;
  }

  console.log(chalk.bold(`\nWorkflows registrados — ${project.name} (${project_id}):\n`));

  const nameW = 28;
  const idW = 14;
  const descW = 36;
  const header =
    'nombre'.padEnd(nameW) +
    'n8n_id'.padEnd(idW) +
    'descripción'.padEnd(descW) +
    'local_path';
  console.log(chalk.bold(header));
  console.log(chalk.dim('─'.repeat(header.length + 10)));

  for (const row of rows) {
    const name = chalk.cyan(row.name.padEnd(nameW));
    const wfId = (row.n8n_workflow_id ?? '').padEnd(idW);
    const desc = (row.description ?? '').slice(0, descW - 1).padEnd(descW);
    const path = row.local_path ?? chalk.dim('—');
    console.log(`${name}${wfId}${desc}${path}`);
  }
  console.log('');
}

// ---------------------------------------------------------------------------
// remove <name> [--project <id>]
// ---------------------------------------------------------------------------

export async function projectWorkflowRemove(
  storage: Storage,
  name: string,
  opts: { project?: string },
): Promise<void> {
  const project_id = resolveProjectId(opts.project);

  const removed = storage.projectWorkflows.remove(project_id, name);
  if (!removed) {
    console.error(
      chalk.red(`✗ El workflow "${name}" no estaba registrado en el proyecto "${project_id}".`),
    );
    process.exit(1);
  }

  console.log(chalk.green(`✓ Workflow "${name}" eliminado del registro del proyecto "${project_id}".`));
  console.log(chalk.dim('  Nota: el workflow sigue activo en n8n. Para borrarlo allí, hacelo desde la UI de n8n.'));
}
