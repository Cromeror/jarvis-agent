import chalk from 'chalk';
import { writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Storage } from '@jarvis/storage';

/**
 * Exports a workflow from n8n to a local JSON file.
 * Useful after modifying a workflow in the n8n UI to promote changes back into the repo.
 */
export async function n8nExport(storage: Storage, workflowName: string, outputPath?: string): Promise<void> {
  const n8nConfig = findN8nConfig(storage);
  if (!n8nConfig) {
    console.log(chalk.red('No se encontro configuracion de n8n en ningun proyecto.'));
    console.log(chalk.gray('Configurala con: jarvis integration set <project> n8n --url <url> --api-key <key>'));
    process.exit(1);
  }

  const baseUrl = n8nConfig.url.replace(/\/$/, '');

  try {
    const listRes = await fetch(`${baseUrl}/api/v1/workflows`, {
      headers: { 'X-N8N-API-KEY': n8nConfig.api_key },
    });
    if (!listRes.ok) {
      console.log(chalk.red(`Error listando workflows (${listRes.status}): ${await listRes.text()}`));
      process.exit(1);
    }
    const data = (await listRes.json()) as {
      data: Array<{ id: string; name: string; nodes?: Array<{ type?: string; parameters?: { path?: string } }> }>;
    };

    // Match by name or webhook path
    const match = (data.data || []).find((w) => {
      if (w.name.toLowerCase().replace(/\s+/g, '-').includes(workflowName)) return true;
      return (w.nodes || []).some(
        (n) => n.type === 'n8n-nodes-base.webhook' && n.parameters?.path === workflowName,
      );
    });

    if (!match) {
      console.log(chalk.red(`Workflow "${workflowName}" no encontrado en n8n.`));
      console.log(chalk.gray('Workflows disponibles:'));
      for (const w of data.data || []) {
        console.log(chalk.gray(`  - ${w.name}`));
      }
      process.exit(1);
    }

    // Fetch full workflow
    const wfRes = await fetch(`${baseUrl}/api/v1/workflows/${match.id}`, {
      headers: { 'X-N8N-API-KEY': n8nConfig.api_key },
    });
    if (!wfRes.ok) {
      console.log(chalk.red(`Error obteniendo workflow (${wfRes.status})`));
      process.exit(1);
    }

    const full = (await wfRes.json()) as {
      name: string;
      nodes: unknown[];
      connections: unknown;
      settings?: unknown;
    };

    const exportable = {
      name: full.name,
      nodes: full.nodes,
      connections: full.connections,
      settings: full.settings ?? { executionOrder: 'v1' },
    };

    const targetPath = outputPath
      ? resolve(outputPath)
      : inferWorkflowPath(workflowName);

    writeFileSync(targetPath, JSON.stringify(exportable, null, 2) + '\n', 'utf-8');
    console.log(chalk.green(`✓ Workflow exportado a ${targetPath}`));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(chalk.red(`Error: ${msg}`));
    process.exit(1);
  }
}

function findN8nConfig(storage: Storage): { url: string; api_key: string } | null {
  const projects = storage.projects.list();
  for (const p of projects) {
    const cfg = storage.integrations.getConfig<{ url: string; api_key: string }>(p.id, 'n8n');
    if (cfg?.url && cfg?.api_key) return cfg;
  }
  return null;
}

/**
 * Given a workflow name, infer the right local path based on known tool naming conventions.
 * Example: 'jira-analyze-ticket' → packages/tools/jira/workflows/jira-analyze-ticket.json
 */
function inferWorkflowPath(workflowName: string): string {
  const cwd = process.cwd();
  const prefix = workflowName.split('-')[0];
  const toolPath = resolve(cwd, 'packages', 'tools', prefix || '', 'workflows', `${workflowName}.json`);
  if (existsSync(resolve(cwd, 'packages', 'tools', prefix || ''))) {
    return toolPath;
  }
  // Fallback: cwd
  return resolve(cwd, `${workflowName}.json`);
}
