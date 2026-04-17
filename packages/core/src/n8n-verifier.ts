import type { Storage } from '@jarvis/storage';

export interface N8nAvailability {
  available: boolean;
  url: string;
  message: string;
}

/**
 * Verifies that n8n is reachable for the given project.
 * Returns an informative message when not available so the tool
 * can return it directly to the agent/user.
 */
export async function verifyN8n(
  storage: Storage,
  projectId: string | undefined,
): Promise<N8nAvailability> {
  const config = projectId
    ? storage.integrations.getConfig<{ url: string; api_key: string }>(projectId, 'n8n')
    : undefined;

  const url = config?.url || 'http://localhost:5678';

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);
    const res = await fetch(`${url}/healthz`, { signal: controller.signal });
    clearTimeout(timeout);
    if (res.ok) {
      return { available: true, url, message: 'n8n is available' };
    }
    return {
      available: false,
      url,
      message: buildUnavailableMessage(url, projectId, `responded with status ${res.status}`),
    };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return {
      available: false,
      url,
      message: buildUnavailableMessage(url, projectId, reason),
    };
  }
}

function buildUnavailableMessage(url: string, projectId: string | undefined, reason: string): string {
  return [
    `⚠ n8n no esta disponible en ${url}`,
    '',
    `Motivo: ${reason}`,
    '',
    '## Por que se necesita n8n',
    '',
    'JARVIS usa n8n como orquestador determinista para ejecutar integraciones',
    'con servicios externos (Jira, GitHub, APIs). Esto permite:',
    '- Reducir el uso de tokens (la IA no ejecuta los pasos, solo interpreta resultados)',
    '- Flujos visibles y editables en la UI de n8n',
    '- Manejo de errores, reintentos y credenciales centralizado',
    '',
    '## Como instalar n8n',
    '',
    'Opcion 1 - Docker (recomendado):',
    '  docker run -d --name n8n -p 5678:5678 n8nio/n8n',
    '',
    'Opcion 2 - Docker Compose:',
    '  make docker-up',
    '',
    'Opcion 3 - NPM:',
    '  npx n8n',
    '',
    '## Verificar que n8n esta corriendo',
    '',
    `  curl ${url}/healthz`,
    '',
    projectId
      ? `## Configurar la URL de n8n para este proyecto\n\n  jarvis integration set ${projectId} n8n --url <url> --api-key <key>`
      : '## Configurar n8n\n\n  jarvis integration set <project> n8n --url <url> --api-key <key>',
    '',
    'Documentacion: packages/docs/n8n-setup.md',
  ].join('\n');
}
