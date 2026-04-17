import chalk from 'chalk';
import type { Storage } from '@jarvis/storage';

const SERVICE_SCHEMAS: Record<string, { fields: string[]; required: string[] }> = {
  jira:   { fields: ['site', 'email'], required: ['site', 'email'] },
  n8n:    { fields: ['url', 'api_key'], required: ['url', 'api_key'] },
  github: { fields: ['repo', 'token'], required: ['repo'] },
};

export function integrationList(storage: Storage, projectId: string): void {
  const project = storage.projects.get(projectId);
  if (!project) {
    console.log(chalk.red(`Project "${projectId}" not found.`));
    return;
  }

  const integrations = storage.integrations.list(projectId);
  if (integrations.length === 0) {
    console.log(chalk.yellow(`\nNo integrations for "${projectId}".`));
    console.log(chalk.gray('Available services: jira, n8n, github'));
    console.log(chalk.gray('Example: jarvis integration set ' + projectId + ' jira --site myorg.atlassian.net --email user@email.com\n'));
    return;
  }

  console.log(chalk.bold(`\nIntegrations for ${project.name}:\n`));
  for (const i of integrations) {
    const config = JSON.parse(i.config);
    console.log(`  ${chalk.magenta.bold(i.service)}`);
    for (const [key, value] of Object.entries(config)) {
      const display = key.includes('key') || key.includes('token')
        ? '****' + String(value).slice(-4)
        : String(value);
      console.log(`    ${chalk.gray(key)}: ${display}`);
    }
  }
  console.log('');
}

export function integrationSet(
  storage: Storage,
  projectId: string,
  service: string,
  opts: Record<string, string>,
): void {
  const project = storage.projects.get(projectId);
  if (!project) {
    console.log(chalk.red(`Project "${projectId}" not found.`));
    return;
  }

  const schema = SERVICE_SCHEMAS[service];
  if (!schema) {
    console.log(chalk.red(`Unknown service: ${service}`));
    console.log(chalk.gray('Available: ' + Object.keys(SERVICE_SCHEMAS).join(', ')));
    return;
  }

  // Build config from opts, mapping --api-key to api_key
  const config: Record<string, string> = {};
  for (const field of schema.fields) {
    const optKey = field.replace(/_/g, '-'); // api_key -> api-key (commander converts --api-key to apiKey)
    const camelKey = field.replace(/_([a-z])/g, (_, c) => c.toUpperCase()); // api_key -> apiKey
    const value = opts[field] || opts[optKey] || opts[camelKey];
    if (value) {
      config[field] = value;
    }
  }

  // Check required fields
  const missing = schema.required.filter(f => !config[f]);
  if (missing.length > 0) {
    console.log(chalk.red(`Missing required fields for ${service}: ${missing.join(', ')}`));
    console.log(chalk.gray(`Usage: jarvis integration set ${projectId} ${service} ${schema.required.map(f => `--${f.replace(/_/g, '-')} <value>`).join(' ')}`));
    return;
  }

  storage.integrations.set(projectId, service, config);
  console.log(chalk.green(`Integration ${service} set for ${projectId}`));
}

export function integrationRemove(storage: Storage, projectId: string, service: string): void {
  const project = storage.projects.get(projectId);
  if (!project) {
    console.log(chalk.red(`Project "${projectId}" not found.`));
    return;
  }

  storage.integrations.remove(projectId, service);
  console.log(chalk.green(`Integration ${service} removed from ${projectId}`));
}
