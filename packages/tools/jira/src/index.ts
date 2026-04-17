import { execSync } from 'node:child_process';
import type { Skill, ToolDefinition } from '@jarvis/core';
import { resolveRulesForTool } from '@jarvis/core';
import type { Storage } from '@jarvis/storage';

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
    description: 'Analyzes a Jira ticket for quality and completeness',
    input_schema: {
      type: 'object',
      properties: {
        ticket_id: {
          type: 'string',
          description: 'The Jira ticket ID to analyze',
        },
        project_id: {
          type: 'string',
          description: 'Optional project ID for context',
        },
      },
      required: ['ticket_id'],
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

function getAcliProfile(storage: Storage, projectId?: string): string | null {
  if (!projectId) return null;
  const integrations = storage.integrations.get(projectId, 'jira');
  const profileEntry = integrations.find((i) => i.key === 'acli_profile');
  return profileEntry?.value ?? null;
}

function buildAcliBase(profile: string | null): string {
  return profile ? `acli --profile ${profile}` : 'acli';
}

export function createJiraSkill(storage: Storage): Skill {
  async function execute(
    toolName: string,
    input: Record<string, unknown>,
  ): Promise<string> {
    const projectId = input['project_id'] as string | undefined;
    const profile = getAcliProfile(storage, projectId);
    const acli = buildAcliBase(profile);

    try {
      switch (toolName) {
        case 'jira_get_ticket': {
          const ticketId = input['ticket_id'] as string;
          const cmd = `${acli} jira --action getIssue --issue ${ticketId}`;
          const result = execSync(cmd, { encoding: 'utf-8', timeout: 30000 });
          return result;
        }

        case 'jira_analyze_ticket': {
          const ticketId = input['ticket_id'] as string;
          const rulesSection = resolveRulesForTool(storage, projectId, 'jira_analyze_ticket', 'jira');
          return [
            `## Jira Ticket Analysis Request: ${ticketId}`,
            '',
            'To analyze this ticket, first use jira_get_ticket to retrieve the ticket details,',
            'then evaluate the following dimensions:',
            '',
            rulesSection,
            '### Quality Checklist',
            '- **Summary**: Is it concise and descriptive?',
            '- **Description**: Does it clearly explain the problem/feature?',
            '- **Acceptance Criteria**: Are they specific and measurable?',
            '- **Story Points**: Are they estimated?',
            '- **Priority**: Is it set appropriately?',
            '- **Components/Labels**: Are they tagged correctly?',
            '- **Dependencies**: Are blockers/linked issues documented?',
            '',
            '### Completeness Score',
            'Rate each dimension 0–2 and sum for a total out of 14.',
            '',
            '### Recommendations',
            'List specific improvements needed for this ticket to meet the Definition of Ready.',
          ].join('\n');
        }

        case 'jira_list_my_tickets': {
          const projectKey = input['project_key'] as string | undefined;
          const status = input['status'] as string | undefined;

          let jql = 'assignee = currentUser()';
          if (projectKey) jql += ` AND project = "${projectKey}"`;
          if (status) jql += ` AND status = "${status}"`;
          jql += ' ORDER BY updated DESC';

          const cmd = `${acli} jira --action getIssueList --jql "${jql}"`;
          const result = execSync(cmd, { encoding: 'utf-8', timeout: 30000 });
          return result;
        }

        case 'jira_add_comment': {
          const ticketId = input['ticket_id'] as string;
          const comment = input['comment'] as string;
          const escapedComment = comment.replace(/"/g, '\\"');
          const cmd = `${acli} jira --action addComment --issue ${ticketId} --comment "${escapedComment}"`;
          execSync(cmd, { encoding: 'utf-8', timeout: 30000 });
          return `Comment added successfully to ${ticketId}.`;
        }

        case 'jira_transition_ticket': {
          const ticketId = input['ticket_id'] as string;
          const transition = input['transition'] as string;
          const cmd = `${acli} jira --action transitionIssue --issue ${ticketId} --transition "${transition}"`;
          execSync(cmd, { encoding: 'utf-8', timeout: 30000 });
          return `Ticket ${ticketId} transitioned to "${transition}" successfully.`;
        }

        default:
          return `Unknown tool: ${toolName}`;
      }
    } catch (err) {
      const error = err as Error & { status?: number; stderr?: string };
      const details = error.stderr ?? error.message ?? String(err);
      return [
        `Error executing ${toolName}: ${details}`,
        '',
        'Possible causes:',
        '- ACLI is not installed (install from https://bobswift.atlassian.net/wiki/spaces/ACLI)',
        '- ACLI profile is not configured (set via storage.integrations with type="jira", key="acli_profile")',
        '- Invalid ticket ID or insufficient permissions',
        '',
        `Profile used: ${profile ?? 'none (default)'}`,
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
