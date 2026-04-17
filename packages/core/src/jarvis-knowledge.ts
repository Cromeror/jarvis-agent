import type { ToolRegistry } from './tool-registry.js';

export interface JarvisKnowledgeOptions {
  projects?: Array<{ id: string; name: string }>;
  // When true, output is shaped for an LLM system prompt (includes strict
  // anti-hallucination / scope rules). When false, output is shaped for
  // ~/.claude/CLAUDE.md (Claude Code already enforces its own scope).
  forSystemPrompt?: boolean;
}

const INTEGRATION_PREFIXES: Record<string, string> = {
  jira: 'jira',
  n8n: 'n8n',
};

function requiredIntegration(toolName: string): string | null {
  for (const [prefix, service] of Object.entries(INTEGRATION_PREFIXES)) {
    if (toolName.startsWith(`${prefix}_`)) return service;
  }
  return null;
}

function formatParams(schema: Record<string, unknown>): string {
  const props = (schema.properties as Record<string, unknown>) || {};
  const required = new Set((schema.required as string[]) || []);
  const names = Object.keys(props);
  if (names.length === 0) return '(no params)';
  return names.map((n) => (required.has(n) ? `${n}*` : n)).join(', ');
}

/**
 * Single source of truth for what Jarvis knows about itself. Consumed by:
 * - `jarvis mcp sync` to write the ~/.claude/CLAUDE.md block
 * - `ContextResolver` when building the system prompt for `jarvis_chat`
 *   calls that have no project context
 *
 * Keep outputs plain markdown — Claude Code reads it natively and LLMs
 * handle it without a parsing layer.
 */
export function getJarvisKnowledge(
  toolRegistry: ToolRegistry,
  opts: JarvisKnowledgeOptions = {}
): string {
  const lines: string[] = [];
  const skills = toolRegistry.getSkills();

  if (opts.forSystemPrompt) {
    lines.push('# JARVIS — MCP server self-knowledge');
    lines.push('');
    lines.push('Sos Jarvis. Solo sabés sobre vos mismo: qué tools tenés, cómo se usan, sus params y limitaciones.');
    lines.push('');
    lines.push('## Reglas estrictas');
    lines.push('1. NO inventes tools, params ni proyectos. Solo existe lo listado abajo.');
    lines.push('2. NO respondés sobre proyectos específicos (stack, reglas, tickets). Ese contexto lo maneja Claude Code, no vos. Si preguntan algo del proyecto, respondé: *"El contexto del proyecto lo maneja Claude. Yo solo sé de mis tools."*');
    lines.push('3. Si no tenés información suficiente para responder, decilo: *"No tengo esa información en mi base."* — no improvises.');
    lines.push('4. Respondé en español, corto y directo.');
    lines.push('');
  } else {
    lines.push('## Jarvis MCP');
    lines.push('');
    lines.push('Jarvis is an MCP server (`mcp__jarvis__*`). Four meta-tools: `jarvis_chat`,');
    lines.push('`jarvis_list_projects`, `jarvis_project_context`, `jarvis_run_tool`.');
    lines.push('');
    lines.push('### Rules');
    lines.push('1. **Do not invent** tools, params, or projects. Only use what is listed below. If something is missing, say so and stop — never improvise.');
    lines.push('2. **Project context belongs to you**, not to Jarvis. Read the project\'s own `CLAUDE.md` for `project_id` and active integrations. `jarvis_chat` only knows about Jarvis itself.');
    lines.push('3. **Never call tools** that require an integration the project does not have.');
    lines.push('');
    lines.push('### How to invoke a tool');
    lines.push('Use `jarvis_run_tool` with `{tool_name, input}`. Do NOT route tool calls through `jarvis_chat` — with Ollama/Qwen it runs text-only and cannot execute tools.');
    lines.push('');
  }

  lines.push('## Catálogo de tools');
  lines.push('');
  lines.push('Params: `*` = required. Integration requirement in parentheses.');
  lines.push('');

  for (const skill of skills) {
    const first = skill.tools[0];
    if (!first) continue;
    const integ = requiredIntegration(first.name);
    const header = integ
      ? `**${skill.name}** _(requires \`${integ}\` integration)_`
      : `**${skill.name}** _(always available)_`;
    lines.push(header);
    for (const t of skill.tools) {
      const params = formatParams(t.input_schema as Record<string, unknown>);
      lines.push(`- \`${t.name}\` — ${params}`);
    }
    lines.push('');
  }

  if (!opts.forSystemPrompt && opts.projects && opts.projects.length > 0) {
    lines.push('### Known projects');
    for (const p of opts.projects) {
      lines.push(`- \`${p.id}\` — ${p.name}`);
    }
    lines.push('');
  }

  if (!opts.forSystemPrompt) {
    lines.push('### Finding `project_id`');
    lines.push('If the project\'s `CLAUDE.md` does not pin one, call `jarvis_list_projects`. Never guess — if no project matches, ask the user.');
  }

  return lines.join('\n').trimEnd();
}
