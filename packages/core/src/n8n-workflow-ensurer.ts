export interface EnsureWorkflowOptions {
  n8nUrl: string;
  apiKey: string | null;
  workflowName: string; // logical name (e.g. 'jira-analyze-ticket'), used to match existing workflows
  workflowJson: {
    name: string;
    nodes: unknown[];
    connections: unknown;
    settings?: unknown;
  };
}

export type EnsureWorkflowResult =
  | { status: 'exists'; id: string; active: boolean }
  | { status: 'created'; id: string }
  | { status: 'activated'; id: string }
  | { status: 'error'; message: string };

/**
 * Verifies that a given workflow exists (by name match) and is active in the n8n instance.
 * If missing, creates it from the provided JSON and activates it.
 *
 * Matches workflows by:
 *  1. Exact name match (e.g. "Jira - Analyze Ticket")
 *  2. Fallback: webhook path inside the workflow matches `workflowName`
 */
export async function ensureWorkflow(opts: EnsureWorkflowOptions): Promise<EnsureWorkflowResult> {
  const { n8nUrl, apiKey, workflowName, workflowJson } = opts;

  if (!apiKey) {
    return {
      status: 'error',
      message: [
        'Falta la API key de n8n.',
        'JARVIS necesita la API key para verificar/crear el workflow automaticamente.',
        '',
        'Configurala con:',
        '  jarvis integration set <project> n8n --url <url> --api-key <key>',
      ].join('\n'),
    };
  }

  const baseUrl = n8nUrl.replace(/\/$/, '');

  try {
    // 1. List existing workflows
    const listRes = await fetch(`${baseUrl}/api/v1/workflows`, {
      headers: { 'X-N8N-API-KEY': apiKey },
    });

    if (!listRes.ok) {
      return {
        status: 'error',
        message: `Error listando workflows de n8n (${listRes.status}): ${await listRes.text()}`,
      };
    }

    const listData = (await listRes.json()) as {
      data: Array<{ id: string; name: string; active: boolean; nodes?: Array<{ type?: string; parameters?: { path?: string } }> }>;
    };

    // 2. Try to find existing workflow by name or by webhook path
    const existing = (listData.data || []).find((w) => {
      if (w.name === workflowJson.name) return true;
      if (w.nodes) {
        return w.nodes.some(
          (n) => n.type === 'n8n-nodes-base.webhook' && n.parameters?.path === workflowName,
        );
      }
      return false;
    });

    if (existing) {
      // 3. Exists — ensure it is active
      if (!existing.active) {
        const actRes = await fetch(`${baseUrl}/api/v1/workflows/${existing.id}/activate`, {
          method: 'POST',
          headers: { 'X-N8N-API-KEY': apiKey },
        });
        if (!actRes.ok) {
          return {
            status: 'error',
            message: `Workflow existe pero no pude activarlo: ${actRes.status}`,
          };
        }
        return { status: 'activated', id: existing.id };
      }
      return { status: 'exists', id: existing.id, active: true };
    }

    // 4. Not found — create it
    const createRes = await fetch(`${baseUrl}/api/v1/workflows`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-N8N-API-KEY': apiKey,
      },
      body: JSON.stringify(workflowJson),
    });

    if (!createRes.ok) {
      const body = await createRes.text();
      return {
        status: 'error',
        message: `Error creando workflow en n8n (${createRes.status}): ${body}`,
      };
    }

    const createdData = (await createRes.json()) as { id: string };

    // 5. Activate the new workflow
    const activateRes = await fetch(`${baseUrl}/api/v1/workflows/${createdData.id}/activate`, {
      method: 'POST',
      headers: { 'X-N8N-API-KEY': apiKey },
    });

    if (!activateRes.ok) {
      return {
        status: 'error',
        message: `Workflow creado pero no pude activarlo: ${activateRes.status}`,
      };
    }

    return { status: 'created', id: createdData.id };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { status: 'error', message: `Excepcion al ensurar workflow: ${msg}` };
  }
}
