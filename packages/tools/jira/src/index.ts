import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import type { Skill, ToolDefinition } from '@jarvis/core';
import { resolveRulesForTool, verifyN8n, ensureWorkflow } from '@jarvis/core';
import type { Storage } from '@jarvis/storage';

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadWorkflowJson(name: string): {
  name: string;
  nodes: unknown[];
  connections: unknown;
  settings?: unknown;
} {
  // dist/ lives one level below src/ in the built package, so ../workflows works for both
  const candidates = [
    resolve(__dirname, '..', 'workflows', `${name}.json`),
    resolve(__dirname, 'workflows', `${name}.json`),
  ];
  for (const path of candidates) {
    try {
      return JSON.parse(readFileSync(path, 'utf-8'));
    } catch {
      // try next
    }
  }
  throw new Error(`Workflow JSON not found: ${name}.json`);
}

const tools: ToolDefinition[] = [
  {
    name: 'jira_get_ticket',
    description: 'Gets a Jira ticket via ACLI command',
    input_schema: {
      type: 'object',
      properties: {
        ticket_id: {
          type: 'string',
          description: 'The Jira ticket ID (e.g. PROJ-123)',
        },
        project_id: {
          type: 'string',
          description: 'Optional project ID for ACLI profile lookup',
        },
      },
      required: ['ticket_id'],
    },
  },
  {
    name: 'jira_analyze_ticket',
    description: 'Analyzes a Jira ticket against project rules. Uses n8n to execute ACLI and returns TOON-formatted data for interpretation.',
    input_schema: {
      type: 'object',
      properties: {
        ticket_id: {
          type: 'string',
          description: 'The Jira ticket ID to analyze',
        },
        project_id: {
          type: 'string',
          description: 'Project ID (required to load Jira integration and rules)',
        },
      },
      required: ['ticket_id', 'project_id'],
    },
  },
  {
    name: 'jira_list_my_tickets',
    description: 'Lists Jira tickets assigned to the current user',
    input_schema: {
      type: 'object',
      properties: {
        project_key: {
          type: 'string',
          description: 'Optional Jira project key to filter by (e.g. PROJ)',
        },
        status: {
          type: 'string',
          description: 'Optional status to filter by (e.g. "In Progress", "To Do")',
        },
        project_id: {
          type: 'string',
          description: 'Optional project ID for ACLI profile lookup',
        },
      },
      required: [],
    },
  },
  {
    name: 'jira_add_comment',
    description: 'Adds a comment to a Jira ticket',
    input_schema: {
      type: 'object',
      properties: {
        ticket_id: {
          type: 'string',
          description: 'The Jira ticket ID',
        },
        comment: {
          type: 'string',
          description: 'The comment text to add',
        },
        project_id: {
          type: 'string',
          description: 'Optional project ID for ACLI profile lookup',
        },
      },
      required: ['ticket_id', 'comment'],
    },
  },
  {
    name: 'jira_transition_ticket',
    description: 'Transitions a Jira ticket to a new status',
    input_schema: {
      type: 'object',
      properties: {
        ticket_id: {
          type: 'string',
          description: 'The Jira ticket ID',
        },
        transition: {
          type: 'string',
          description: 'The transition name (e.g. "In Progress", "Done", "Review")',
        },
        project_id: {
          type: 'string',
          description: 'Optional project ID for ACLI profile lookup',
        },
      },
      required: ['ticket_id', 'transition'],
    },
  },
];

interface JiraServiceConfig {
  site: string;
  email: string;
}

function getJiraConfig(storage: Storage, projectId?: string): JiraServiceConfig | null {
  if (!projectId) return null;
  return storage.integrations.getConfig<JiraServiceConfig>(projectId, 'jira') ?? null;
}

function ensureAcliSession(config: JiraServiceConfig | null): string[] {
  if (!config) return [];
  return [`acli jira auth switch --site ${config.site} --email ${config.email}`];
}

function runAcli(config: JiraServiceConfig | null, cmd: string): string {
  const preamble = ensureAcliSession(config);
  const fullCmd = [...preamble, cmd].join(' && ');
  return execSync(fullCmd, { encoding: 'utf-8', timeout: 30000 });
}

async function analyzeTicketViaN8n(
  storage: Storage,
  projectId: string,
  ticketId: string,
): Promise<string> {
  const availability = await verifyN8n(storage, projectId);
  if (!availability.available) {
    return availability.message;
  }

  const jiraConfig = getJiraConfig(storage, projectId);
  if (!jiraConfig) {
    return [
      '⚠ Jira no esta configurado para este proyecto.',
      '',
      'Configuralo con:',
      `  jarvis integration set ${projectId} jira --site <site> --email <email>`,
    ].join('\n');
  }

  // Ensure the n8n workflow exists (lazy single-shot init)
  const n8nConfig = storage.integrations.getConfig<{ url: string; api_key: string }>(projectId, 'n8n');
  const ensureResult = await ensureWorkflow({
    n8nUrl: availability.url,
    apiKey: n8nConfig?.api_key || null,
    workflowName: 'jira-analyze-ticket',
    workflowJson: loadWorkflowJson('jira-analyze-ticket'),
  });

  if (ensureResult.status === 'error') {
    return [
      '⚠ No pude asegurar que el workflow "jira-analyze-ticket" este disponible.',
      '',
      ensureResult.message,
    ].join('\n');
  }

  if (ensureResult.status === 'created') {
    console.error(`⏳ Workflow "jira-analyze-ticket" no existia en n8n, creado y activado (id: ${ensureResult.id})`);
  } else if (ensureResult.status === 'activated') {
    console.error(`⏳ Workflow "jira-analyze-ticket" existia pero estaba inactivo, activado (id: ${ensureResult.id})`);
  }

  const webhookUrl = `${availability.url}/webhook/jira-analyze-ticket`;

  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ticketId,
        site: jiraConfig.site,
        email: jiraConfig.email,
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      return [
        `⚠ Error disparando workflow n8n (${response.status})`,
        '',
        body,
        '',
        `Verifica que el workflow "jira-analyze-ticket" este activo en ${availability.url}`,
      ].join('\n');
    }

    const ticketToon = await response.text();
    const rulesSection = resolveRulesForTool(storage, projectId, 'jira_analyze_ticket', 'jira');

    return [
      `## Jira Ticket Analysis: ${ticketId}`,
      '',
      '### Ticket Data (TOON format)',
      '```',
      ticketToon,
      '```',
      '',
      rulesSection,
      '### Instructions',
      'Evalua el ticket contra las reglas del proyecto y la Definition of Ready.',
      'Para cada criterio responde:',
      '- ✅ PASS',
      '- ❌ FAIL (con explicacion)',
      '- ⚠️ PARTIAL (con explicacion)',
      '',
      'Concluye con un veredicto **READY** o **NOT READY** y lista las mejoras necesarias.',
    ].join('\n');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return `Error ejecutando workflow n8n: ${msg}`;
  }
}

export function createJiraSkill(storage: Storage): Skill {
  async function execute(
    toolName: string,
    input: Record<string, unknown>,
  ): Promise<string> {
    const projectId = input['project_id'] as string | undefined;
    const jiraConfig = getJiraConfig(storage, projectId);

    try {
      switch (toolName) {
        case 'jira_get_ticket': {
          const ticketId = input['ticket_id'] as string;
          const cmd = `acli jira workitem view ${ticketId}`;
          return runAcli(jiraConfig, cmd);
        }

        case 'jira_analyze_ticket': {
          const ticketId = input['ticket_id'] as string;
          if (!projectId) {
            return 'Error: project_id es requerido para jira_analyze_ticket';
          }
          return analyzeTicketViaN8n(storage, projectId, ticketId);
        }

        case 'jira_list_my_tickets': {
          const projectKey = input['project_key'] as string | undefined;
          const status = input['status'] as string | undefined;

          let jql = 'assignee = currentUser()';
          if (projectKey) jql += ` AND project = "${projectKey}"`;
          if (status) jql += ` AND status = "${status}"`;
          jql += ' ORDER BY updated DESC';

          const cmd = `acli jira workitem search --jql "${jql}"`;
          return runAcli(jiraConfig, cmd);
        }

        case 'jira_add_comment': {
          const ticketId = input['ticket_id'] as string;
          const comment = input['comment'] as string;
          const escapedComment = comment.replace(/"/g, '\\"');
          const cmd = `acli jira workitem comment ${ticketId} --body "${escapedComment}"`;
          runAcli(jiraConfig, cmd);
          return `Comment added successfully to ${ticketId}.`;
        }

        case 'jira_transition_ticket': {
          const ticketId = input['ticket_id'] as string;
          const transition = input['transition'] as string;
          const cmd = `acli jira workitem transition ${ticketId} --transition "${transition}"`;
          runAcli(jiraConfig, cmd);
          return `Ticket ${ticketId} transitioned to "${transition}" successfully.`;
        }

        default:
          return `Unknown tool: ${toolName}`;
      }
    } catch (err) {
      const error = err as Error & { status?: number; stderr?: string };
      const details = error.stderr ?? error.message ?? String(err);
      const configInfo = jiraConfig
        ? `site=${jiraConfig.site}, email=${jiraConfig.email}`
        : 'none (default)';
      return [
        `Error executing ${toolName}: ${details}`,
        '',
        'Possible causes:',
        '- ACLI is not installed (install from https://bobswift.atlassian.net/wiki/spaces/ACLI)',
        '- Jira integration is not configured (use: jarvis integration set <project> jira --site <site> --email <email>)',
        '- Invalid ticket ID or insufficient permissions',
        '',
        `Jira config: ${configInfo}`,
      ].join('\n');
    }
  }

  return {
    name: 'jira',
    description: 'Interact with Jira via ACLI: get, analyze, list, comment, and transition tickets',
    tools,
    execute,
  };
}
