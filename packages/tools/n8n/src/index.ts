import type { Skill, ToolDefinition } from '@jarvis/core';
import { resolveRulesForTool } from '@jarvis/core';
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
  {
    name: 'project_register_workflow',
    description:
      'Registra un workflow de n8n como disponible para el proyecto. **Esta tool tiene dos modos.** Modo **guía** (sin `n8n_workflow_id`): devuelve un prompt en español con instrucciones para crear el JSON del workflow, subirlo a n8n y volver a llamar esta tool con los datos. Modo **persistencia** (con `n8n_workflow_id`): valida que el workflow exista en n8n, inserta o actualiza la fila en el registry de Jarvis, y retorna los siguientes pasos para ejecutarlo. Upsert por `(project_id, name)`.',
    input_schema: {
      type: 'object',
      properties: {
        project_id: {
          type: 'string',
          description: 'ID del proyecto en Jarvis (requerido)',
        },
        purpose: {
          type: 'string',
          description: 'Descripción del propósito del workflow (opcional, solo en modo guía)',
        },
        name: {
          type: 'string',
          description: 'Nombre en kebab-case del workflow (requerido en modo persistencia)',
        },
        description: {
          type: 'string',
          description: 'Descripción en una oración de lo que hace el workflow',
        },
        n8n_workflow_id: {
          type: 'string',
          description: 'ID del workflow en n8n. Su presencia activa el modo persistencia.',
        },
        local_path: {
          type: 'string',
          description: 'Ruta relativa al root del repo donde vive el JSON (requerido en modo persistencia, ej. .jarvis/workflows/deploy.json)',
        },
      },
      required: ['project_id'],
    },
  },
  {
    name: 'project_list_workflows',
    description:
      'Lista los workflows de n8n registrados para el proyecto. Devuelve las filas del registry (nombre, descripción, `n8n_workflow_id`, `local_path`) más las reglas de uso para invocarlos.',
    input_schema: {
      type: 'object',
      properties: {
        project_id: {
          type: 'string',
          description: 'ID del proyecto en Jarvis',
        },
      },
      required: ['project_id'],
    },
  },
  {
    name: 'project_unregister_workflow',
    description:
      'Elimina un workflow del registry de Jarvis para el proyecto. **NO borra el workflow en n8n** — solo lo quita de la lista de workflows disponibles para este proyecto. El workflow sigue activo en n8n y puede re-registrarse si hace falta.',
    input_schema: {
      type: 'object',
      properties: {
        project_id: {
          type: 'string',
          description: 'ID del proyecto en Jarvis',
        },
        name: {
          type: 'string',
          description: 'Nombre en kebab-case del workflow a eliminar del registry',
        },
      },
      required: ['project_id', 'name'],
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

async function n8nFetch(
  config: N8nConfig,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ ok: boolean; status: number; data: unknown; error?: string }> {
  const url = `${config.url}${path}`;
  try {
    const res = await fetch(url, {
      method,
      headers: buildHeaders(config.apiKey),
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = res.ok ? await res.json() : null;
    return { ok: res.ok, status: res.status, data };
  } catch (err) {
    return { ok: false, status: 0, data: null, error: String(err) };
  }
}

export function createN8nSkill(storage: Storage): Skill {
  async function execute(
    toolName: string,
    input: Record<string, unknown>,
  ): Promise<string> {
    const projectId = input['project_id'] as string | undefined;

    // For the 3 project-scoped tools, handle them before the n8n config check
    if (
      toolName === 'project_register_workflow' ||
      toolName === 'project_list_workflows' ||
      toolName === 'project_unregister_workflow'
    ) {
      return executeProjectTool(toolName, input);
    }

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
          const result = await n8nFetch(config, 'GET', '/api/v1/workflows');

          if (!result.ok) {
            return `n8n API error (${result.status}): ${result.error ?? 'unknown error'}`;
          }

          const data = result.data as {
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
          const triggerResult = await n8nFetch(
            config,
            'POST',
            `/api/v1/workflows/${workflowId}/activate`,
            data ?? {},
          );

          if (!triggerResult.ok) {
            // Fallback: try the executions endpoint
            const execResult = await n8nFetch(
              config,
              'POST',
              '/api/v1/executions',
              { workflowId, data: data ?? {} },
            );

            if (!execResult.ok) {
              return `n8n API error (${execResult.status}): ${execResult.error ?? 'unknown error'}`;
            }

            const execData = execResult.data as { id: string; status: string };
            return [
              `Workflow ${workflowId} triggered successfully.`,
              `Execution ID: ${execData.id}`,
              `Status: ${execData.status}`,
              '',
              `Use n8n_get_execution_status with execution_id="${execData.id}" to check progress.`,
            ].join('\n');
          }

          const result = triggerResult.data as { id?: string; status?: string };
          return [
            `Workflow ${workflowId} triggered successfully.`,
            result.id ? `Execution ID: ${result.id}` : '',
            result.status ? `Status: ${result.status}` : '',
          ].filter(Boolean).join('\n');
        }

        case 'n8n_get_execution_status': {
          const executionId = input['execution_id'] as string;

          const result = await n8nFetch(
            config,
            'GET',
            `/api/v1/executions/${executionId}`,
          );

          if (!result.ok) {
            return `n8n API error (${result.status}): ${result.error ?? 'unknown error'}`;
          }

          const data = result.data as {
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

  async function executeProjectTool(
    toolName: string,
    input: Record<string, unknown>,
  ): Promise<string> {
    const project_id = input['project_id'] as string | undefined;

    // Validate project_id
    if (!project_id) {
      return 'Error: project_id es requerido.';
    }

    // Verify project exists
    const project = storage.projects.get(project_id);
    if (!project) {
      return `Error: El proyecto '${project_id}' no existe en Jarvis.`;
    }

    switch (toolName) {
      case 'project_register_workflow': {
        // Validate n8n integration
        const rawConfig = storage.integrations.getConfig<N8nServiceConfig>(project_id, 'n8n');
        if (!rawConfig) {
          return `Error: El proyecto ${project_id} no tiene integración n8n configurada. Ejecutá \`jarvis project integration add n8n --url <url> --api-key <key>\` antes de continuar.`;
        }

        const config: N8nConfig = {
          url: rawConfig.url.replace(/\/$/, ''),
          apiKey: rawConfig.api_key,
        };

        const n8n_workflow_id = input['n8n_workflow_id'] as string | undefined;

        if (!n8n_workflow_id) {
          // Modo guía
          const purpose = input['purpose'] as string | undefined;

          const rulesWhen = resolveRulesForTool(
            storage,
            project_id,
            'project_register_workflow',
            'workflow_registry.when_to_register',
          );
          const rulesHow = resolveRulesForTool(
            storage,
            project_id,
            'project_register_workflow',
            'workflow_registry.how_to_create',
          );

          const prompt = [
            `<!-- refine:meta`,
            `tool: project_register_workflow`,
            `mode: guide`,
            `project: ${project_id}`,
            `-->`,
            ``,
            `## Registrar workflow de n8n para el proyecto ${project_id}`,
            ``,
            `### Tu Tarea`,
            ``,
            `Sos el encargado de crear y registrar un workflow de n8n para el proyecto ${project_id}. Seguí los pasos abajo en orden. NO ejecutes el paso final (registrar en Jarvis) hasta tener el \`n8n_workflow_id\` real que n8n te devuelva al crear el workflow. Respondé en español.`,
            ``,
            `### Contexto`,
            ``,
            `Propósito del workflow: ${purpose ?? 'no especificado'}`,
            ``,
            `### Reglas del Registry (cuándo registrar)`,
            ``,
            rulesWhen,
            `### Reglas del Registry (cómo crear)`,
            ``,
            rulesHow,
            `### Próximos pasos`,
            ``,
            `Cuando hayas creado el JSON, subido a n8n y capturado el \`n8n_workflow_id\`, volvé a llamar esta tool con:`,
            ``,
            `project_register_workflow({`,
            `  project_id: "${project_id}",`,
            `  name: "<kebab-case-name>",`,
            `  description: "<una oración>",`,
            `  n8n_workflow_id: "<id de n8n>",`,
            `  local_path: ".jarvis/workflows/<name>.json"`,
            `})`,
          ].join('\n');

          return prompt;
        }

        // Modo persistencia
        const name = input['name'] as string | undefined;
        const local_path = input['local_path'] as string | undefined;

        if (!name) {
          return `Error: El campo 'name' es requerido en modo persistencia.`;
        }

        const nameRegex = /^[a-z0-9][a-z0-9-]*[a-z0-9]$/;
        if (!nameRegex.test(name)) {
          return `Error: El name '${name}' no es válido. Debe estar en kebab-case. Ver rule WR-H2.`;
        }

        if (!local_path) {
          return `Error: El campo 'local_path' es requerido en modo persistencia.`;
        }

        // Validate workflow exists in n8n
        const fetchResult = await n8nFetch(config, 'GET', `/api/v1/workflows/${n8n_workflow_id}`);
        if (!fetchResult.ok || fetchResult.status === 404) {
          return `Error: El workflow_id ${n8n_workflow_id} no existe en n8n. Verificá que lo subiste correctamente.`;
        }

        // Register in DB
        const row = storage.projectWorkflows.register({
          project_id,
          name,
          description: (input['description'] as string | undefined) ?? null,
          n8n_workflow_id,
          local_path,
        });

        // Resolve after_registration rules
        const rulesAfter = resolveRulesForTool(
          storage,
          project_id,
          'project_register_workflow',
          'workflow_registry.after_registration',
        );

        return JSON.stringify({ row, next_steps: rulesAfter });
      }

      case 'project_list_workflows': {
        const rows = storage.projectWorkflows.listByProject(project_id);

        const rulesAfter = resolveRulesForTool(
          storage,
          project_id,
          'project_list_workflows',
          'workflow_registry.after_registration',
        );

        return JSON.stringify({ workflows: rows, next_steps: rulesAfter });
      }

      case 'project_unregister_workflow': {
        const name = input['name'] as string | undefined;
        if (!name) {
          return `Error: El campo 'name' es requerido.`;
        }

        const removed = storage.projectWorkflows.remove(project_id, name);
        if (!removed) {
          return `Error: El workflow '${name}' no estaba registrado en el proyecto ${project_id}.`;
        }

        return JSON.stringify({
          removed: true,
          name,
          note: 'El workflow sigue activo en n8n. Para borrarlo ahí, usá la UI de n8n directamente.',
        });
      }

      default:
        return `Unknown project tool: ${toolName}`;
    }
  }

  return {
    name: 'n8n',
    description:
      'Skill de automatización n8n para gestionar workflows globales y por proyecto. ' +
      'Workflows globales de n8n: `n8n_list_workflows` (lista todos), `n8n_trigger_workflow` (dispara un workflow), `n8n_get_execution_status` (consulta una ejecución). ' +
      'Workflows registrados por proyecto: `project_register_workflow` (registra o guía la creación de un workflow en el registry del proyecto), `project_list_workflows` (lista los workflows registrados para un proyecto), `project_unregister_workflow` (elimina un workflow del registry del proyecto, sin borrarlo en n8n).',
    tools,
    execute,
  };
}
