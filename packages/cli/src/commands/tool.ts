import chalk from 'chalk';
import type { ToolRegistry } from '@jarvis/core';

export function toolList(registry: ToolRegistry): void {
  const skills = registry.getSkills();
  if (skills.length === 0) {
    console.log(chalk.yellow('No tools registered.'));
    return;
  }

  console.log(chalk.bold('\nAvailable tools:\n'));
  for (const skill of skills) {
    console.log(chalk.cyan.bold(`${skill.name}`));
    console.log(chalk.gray(`  ${skill.description}`));
    for (const tool of skill.tools) {
      const required = (tool.input_schema['required'] as string[]) || [];
      const props = (tool.input_schema['properties'] as Record<string, { description?: string }>) || {};
      console.log(`  - ${chalk.white.bold(tool.name)}`);
      console.log(chalk.gray(`      ${tool.description}`));
      const fields = Object.entries(props).map(([key, val]) => {
        const req = required.includes(key) ? '*' : '';
        return `${key}${req}`;
      });
      if (fields.length > 0) {
        console.log(chalk.gray(`      params: ${fields.join(', ')} (* = required)`));
      }
    }
    console.log('');
  }
}

export async function toolRun(
  registry: ToolRegistry,
  toolName: string,
  inputs: Record<string, unknown>,
): Promise<void> {
  console.log(chalk.gray(`Running ${toolName}...`));
  try {
    const result = await registry.execute(toolName, inputs);
    console.log('');
    console.log(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(chalk.red(`\nError: ${msg}`));
    process.exit(1);
  }
}

/**
 * Parses CLI options into a tool input object.
 * All unknown options are passed through to the tool.
 * Example: --ticket-id LXM-473 --project-id lx → { ticket_id: 'LXM-473', project_id: 'lx' }
 */
export function parseToolInputs(opts: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(opts)) {
    if (value === undefined || value === null) continue;
    // Commander converts --ticket-id to ticketId — convert back to snake_case
    const snakeKey = key.replace(/[A-Z]/g, (m) => '_' + m.toLowerCase());
    result[snakeKey] = value;
  }
  return result;
}

/**
 * Shows usage help for a specific tool — both CLI param form and JSON form.
 */
export function toolHelp(registry: ToolRegistry, toolName: string): void {
  const skills = registry.getSkills();
  let found: { skillName: string; tool: { name: string; description: string; input_schema: Record<string, unknown> } } | null = null;
  for (const skill of skills) {
    const tool = skill.tools.find((t) => t.name === toolName);
    if (tool) {
      found = { skillName: skill.name, tool };
      break;
    }
  }

  if (!found) {
    console.log(chalk.red(`\nTool "${toolName}" not found.\n`));
    console.log(chalk.gray('Run `jarvis tool list` to see all available tools.\n'));
    return;
  }

  const { skillName, tool } = found;
  const props = (tool.input_schema['properties'] as Record<string, { type?: string; description?: string }>) || {};
  const required = (tool.input_schema['required'] as string[]) || [];

  console.log('');
  console.log(chalk.bold(`${tool.name}`) + chalk.gray(`  (tool: ${skillName})`));
  console.log(chalk.gray(tool.description));
  console.log('');

  // Parameters table
  console.log(chalk.bold('Parameters:'));
  for (const [key, schema] of Object.entries(props)) {
    const req = required.includes(key) ? chalk.red(' *') : '';
    const type = schema.type ? chalk.gray(`(${schema.type})`) : '';
    console.log(`  ${chalk.cyan(key)}${req} ${type}`);
    if (schema.description) console.log(chalk.gray(`      ${schema.description}`));
  }
  console.log(chalk.gray('  * = required'));
  console.log('');

  // Build example values
  const exampleValues: Record<string, string> = {};
  for (const key of Object.keys(props)) {
    exampleValues[key] = placeholderFor(key);
  }

  // Form 1: CLI params
  console.log(chalk.bold('Usage form 1 — CLI params:'));
  const paramFlags = Object.entries(exampleValues)
    .map(([k, v]) => `-p ${k}=${v}`)
    .join(' ');
  console.log(chalk.white(`  jarvis tool run ${tool.name} ${paramFlags}`));
  console.log('');

  // Form 2: JSON input
  console.log(chalk.bold('Usage form 2 — JSON input:'));
  const jsonStr = JSON.stringify(exampleValues);
  console.log(chalk.white(`  jarvis tool run ${tool.name} --input '${jsonStr}'`));
  console.log('');
}

function placeholderFor(key: string): string {
  if (key.includes('ticket')) return 'LXM-473';
  if (key.includes('project_id') || key === 'project') return 'lx';
  if (key.includes('comment')) return '"mi comentario"';
  if (key.includes('transition')) return '"In Progress"';
  if (key.includes('status')) return '"To Do"';
  if (key.includes('jql') || key.includes('query')) return '"assignee = currentUser()"';
  if (key.includes('url')) return 'http://localhost:5678';
  if (key.includes('key') || key.includes('token')) return 'xxx';
  return '<value>';
}
