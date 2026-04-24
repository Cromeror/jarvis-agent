import { execSync } from 'node:child_process';
import { writeFileSync, unlinkSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { Skill, ToolDefinition } from '@jarvis/core';
import { toTOON } from '@jarvis/toon';
import type { Storage } from '@jarvis/storage';
import { markdownToAdf } from './markdown-to-adf.js';

const tools: ToolDefinition[] = [
  {
    name: 'jira_get_ticket',
    description:
      'Gets a Jira ticket via ACLI. Returns the ticket serialized in TOON format (Token-Oriented Object Notation) for efficient LLM consumption. TOON is a compact, indentation-based format: scalars as `key: value`, primitive arrays as `key[N]: v1,v2`, uniform object arrays as `key[N]{f1,f2}:` followed by rows.',
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
    name: 'jira_list_my_tickets',
    description:
      'Lists Jira tickets assigned to the current user. Returns an array of tickets serialized in TOON format (Token-Oriented Object Notation) for efficient LLM consumption.',
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
  {
    name: 'jira_update_ticket',
    description:
      'Updates editable fields of a Jira ticket via ACLI: summary, description (Markdown → ADF auto-conversion for rich formatting), assignee, labels. The description input MUST be Markdown; the tool converts it to Atlassian Document Format (ADF) internally so Jira renders it with proper headings, bold/italic, lists, code blocks, blockquotes, links, horizontal rules, and colored panels (:::info | :::warning | :::error | :::success | :::note). Emojis work as plain Unicode. This is the standard format to use for maximum compatibility across Jira Cloud and Data Center.',
    input_schema: {
      type: 'object',
      properties: {
        ticket_id: {
          type: 'string',
          description: 'The Jira ticket ID (e.g. PROJ-123)',
        },
        summary: {
          type: 'string',
          description: 'New summary/title (plain text, < 255 chars recommended)',
        },
        description: {
          type: 'string',
          description:
            'New description in Markdown. Supports: # headings, **bold**, *italic*, `inline code`, ```code blocks```, - bullet lists, 1. numbered lists, > blockquotes, [links](url), --- horizontal rule, and panels via :::info / :::warning / :::error / :::success / :::note ... :::. Emojis as Unicode (🚀, ✅, ⚠️). Auto-converted to ADF.',
        },
        assignee: {
          type: 'string',
          description:
            'Assignee email, Atlassian account ID, "@me" to self-assign, or "default" for project default',
        },
        labels: {
          type: 'array',
          items: { type: 'string' },
          description: 'Labels to set (replaces existing labels on the ticket)',
        },
        project_id: {
          type: 'string',
          description: 'Optional project ID for ACLI profile lookup',
        },
      },
      required: ['ticket_id'],
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

function ensureAcliSession(config: JiraServiceConfig | null): void {
  if (!config) return;
  execSync(`acli jira auth switch --site ${config.site} --email ${config.email}`, {
    encoding: 'utf-8',
    timeout: 30000,
    stdio: ['ignore', 'ignore', 'pipe'],
  });
}

function runAcli(config: JiraServiceConfig | null, cmd: string): string {
  ensureAcliSession(config);
  return execSync(cmd, { encoding: 'utf-8', timeout: 30000 });
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
          const raw = runAcli(jiraConfig, `acli jira workitem view ${ticketId} --json`);
          const parsed = JSON.parse(raw);
          return toTOON(parsed);
        }

        case 'jira_list_my_tickets': {
          const projectKey = input['project_key'] as string | undefined;
          const status = input['status'] as string | undefined;

          let jql = 'assignee = currentUser()';
          if (projectKey) jql += ` AND project = "${projectKey}"`;
          if (status) jql += ` AND status = "${status}"`;
          jql += ' ORDER BY updated DESC';

          const cmd = `acli jira workitem search --jql "${jql}" --json`;
          const raw = runAcli(jiraConfig, cmd);
          const parsed = JSON.parse(raw);
          return toTOON(parsed);
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

        case 'jira_update_ticket': {
          const ticketId = input['ticket_id'] as string;
          const summary = input['summary'] as string | undefined;
          const description = input['description'] as string | undefined;
          const assignee = input['assignee'] as string | undefined;
          const labels = input['labels'] as string[] | undefined;

          if (!summary && !description && !assignee && (!labels || labels.length === 0)) {
            return `No fields provided to update on ${ticketId}. Pass at least one of: summary, description, assignee, labels.`;
          }

          const flags: string[] = [`--key "${ticketId}"`, '--yes'];
          if (summary) {
            const escaped = summary.replace(/"/g, '\\"');
            flags.push(`--summary "${escaped}"`);
          }
          if (assignee) {
            const escaped = assignee.replace(/"/g, '\\"');
            flags.push(`--assignee "${escaped}"`);
          }
          if (labels && labels.length > 0) {
            const escaped = labels.map((l) => l.replace(/"/g, '\\"')).join(',');
            flags.push(`--labels "${escaped}"`);
          }

          let tmpFile: string | null = null;
          if (description) {
            const adf = markdownToAdf(description);
            const dir = mkdtempSync(join(tmpdir(), 'jarvis-jira-'));
            tmpFile = join(dir, `${ticketId}-desc.json`);
            writeFileSync(tmpFile, JSON.stringify(adf), 'utf-8');
            flags.push(`--description-file "${tmpFile}"`);
          }

          try {
            const cmd = `acli jira workitem edit ${flags.join(' ')}`;
            runAcli(jiraConfig, cmd);
          } finally {
            if (tmpFile) {
              try {
                unlinkSync(tmpFile);
              } catch {
                /* best effort */
              }
            }
          }

          const updated: string[] = [];
          if (summary) updated.push('summary');
          if (description) updated.push('description');
          if (assignee) updated.push('assignee');
          if (labels && labels.length > 0) updated.push('labels');
          return `Ticket ${ticketId} updated successfully (${updated.join(', ')}).`;
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
        '- ACLI returned non-JSON output for --json command (check ACLI version)',
        '',
        `Jira config: ${configInfo}`,
      ].join('\n');
    }
  }

  return {
    name: 'jira',
    description: 'Interact with Jira via ACLI: get, list, comment, transition, and update tickets',
    tools,
    execute,
  };
}
