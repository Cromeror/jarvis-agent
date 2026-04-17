import type { Skill, ToolDefinition } from '@jarvis/core';
import type { Storage } from '@jarvis/storage';

const tools: ToolDefinition[] = [
  {
    name: 'n8n_list_workflows',
    description: 'Lists all workflows from the configured n8n instance',
    input_schema: {
      type: 'object',
      properties: {
        project_id: {
          type: 'string',
          description: 'Optional project ID to load n8n connection details',
        },
      },
      required: [],
    },
  },
  {
    name: 'n8n_trigger_workflow',
    description: 'Triggers a specific n8n workflow with optional input data',
    input_schema: {
      type: 'object',
      properties: {
        workflow_id: {
          type: 'string',
          description: 'The n8n workflow ID to trigger',
        },
        data: {
          type: 'object',
          description: 'Optional JSON payload to send to the workflow',
        },
        project_id: {
          type: 'string',
          description: 'Optional project ID to load n8n connection details',
        },
      },
      required: ['workflow_id'],
    },
  },
  {
    name: 'n8n_get_execution_status',
    description: 'Gets the status of a specific n8n workflow execution',
    input_schema: {
      type: 'object',
      properties: {
        execution_id: {
          type: 'string',
          description: 'The n8n execution ID to check',
        },
        project_id: {
          type: 'string',
          description: 'Optional project ID to load n8n connection details',
        },
      },
      required: ['execution_id'],
    },
  },
];

interface N8nServiceConfig {
  url: string;
  api_key: string;
}

interface N8nConfig {
  url: string;
  apiKey: string;
}

function getN8nConfig(storage: Storage, projectId?: string): N8nConfig | null {
  if (!projectId) return null;

  const raw = storage.integrations.getConfig<N8nServiceConfig>(projectId, 'n8n');
  if (!raw) return null;

  return {
    url: raw.url.replace(/\/$/, ''), // strip trailing slash
    apiKey: raw.api_key,
  };
}

function buildHeaders(apiKey: string): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'X-N8N-API-KEY': apiKey,
  };
}

export function createN8nSkill(storage: Storage): Skill {
  async function execute(
    toolName: string,
    input: Record<string, unknown>,
  ): Promise<string> {
    const projectId = input['project_id'] as string | undefined;
    const config = getN8nConfig(storage, projectId);

    if (!config) {
      return [
        'n8n integration is not configured.',
        '',
        'To configure n8n, run:',
        '  jarvis integration set <project-id> n8n --url https://your-n8n-instance.com --api-key your-api-key',
      ].join('\n');
    }

    try {
      switch (toolName) {
        case 'n8n_list_workflows': {
          const response = await fetch(`${config.url}/api/v1/workflows`, {
            method: 'GET',
            headers: buildHeaders(config.apiKey),
          });

          if (!response.ok) {
            const body = await response.text();
            return `n8n API error (${response.status}): ${body}`;
          }

          const data = (await response.json()) as {
            data: { id: string; name: string; active: boolean; updatedAt: string }[];
          };

          if (!data.data || data.data.length === 0) {
            return 'No workflows found in this n8n instance.';
          }

          const rows = data.data.map(
            (wf) =>
              `- [${wf.active ? 'ACTIVE' : 'INACTIVE'}] ${wf.name} (ID: ${wf.id}) — updated: ${wf.updatedAt}`,
          );

          return [`## n8n Workflows (${data.data.length} total)`, '', ...rows].join('\n');
        }

        case 'n8n_trigger_workflow': {
          const workflowId = input['workflow_id'] as string;
          const data = input['data'] as Record<string, unknown> | undefined;

          // First, get the workflow to find its webhook trigger URL or use the execution endpoint
          const triggerResponse = await fetch(
            `${config.url}/api/v1/workflows/${workflowId}/activate`,
            {
              method: 'POST',
              headers: buildHeaders(config.apiKey),
              body: JSON.stringify(data ?? {}),
            },
          );

          if (!triggerResponse.ok) {
            // Fallback: try the executions endpoint
            const execResponse = await fetch(
              `${config.url}/api/v1/executions`,
              {
                method: 'POST',
                headers: buildHeaders(config.apiKey),
                body: JSON.stringify({ workflowId, data: data ?? {} }),
              },
            );

            if (!execResponse.ok) {
              const body = await execResponse.text();
              return `n8n API error (${execResponse.status}): ${body}`;
            }

            const execData = (await execResponse.json()) as { id: string; status: string };
            return [
              `Workflow ${workflowId} triggered successfully.`,
              `Execution ID: ${execData.id}`,
              `Status: ${execData.status}`,
              '',
              `Use n8n_get_execution_status with execution_id="${execData.id}" to check progress.`,
            ].join('\n');
          }

          const result = (await triggerResponse.json()) as { id?: string; status?: string };
          return [
            `Workflow ${workflowId} triggered successfully.`,
            result.id ? `Execution ID: ${result.id}` : '',
            result.status ? `Status: ${result.status}` : '',
          ].filter(Boolean).join('\n');
        }

        case 'n8n_get_execution_status': {
          const executionId = input['execution_id'] as string;

          const response = await fetch(
            `${config.url}/api/v1/executions/${executionId}`,
            {
              method: 'GET',
              headers: buildHeaders(config.apiKey),
            },
          );

          if (!response.ok) {
            const body = await response.text();
            return `n8n API error (${response.status}): ${body}`;
          }

          const data = (await response.json()) as {
            id: string;
            status: string;
            startedAt?: string;
            stoppedAt?: string;
            workflowId?: string;
            data?: { resultData?: { error?: { message: string } } };
          };

          const lines = [
            `## Execution Status: ${executionId}`,
            `Status: ${data.status}`,
            data.workflowId ? `Workflow ID: ${data.workflowId}` : '',
            data.startedAt ? `Started: ${data.startedAt}` : '',
            data.stoppedAt ? `Finished: ${data.stoppedAt}` : '',
          ].filter(Boolean);

          if (data.data?.resultData?.error) {
            lines.push('', `Error: ${data.data.resultData.error.message}`);
          }

          return lines.join('\n');
        }

        default:
          return `Unknown tool: ${toolName}`;
      }
    } catch (err) {
      const error = err as Error;
      return [
        `Error communicating with n8n: ${error.message}`,
        '',
        `n8n URL: ${config.url}`,
        'Check that the n8n instance is reachable and the API key is valid.',
      ].join('\n');
    }
  }

  return {
    name: 'n8n',
    description: 'n8n automation skill for listing, triggering, and monitoring workflows',
    tools,
    execute,
  };
}
