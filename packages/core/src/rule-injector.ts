import type { Storage } from '@jarvis/storage';

export function resolveRulesForTool(
  storage: Storage,
  projectId: string | undefined,
  toolName: string,
  fallbackCategory?: string,
): string {
  if (!projectId) return '';

  // Try tool-specific + general rules first
  let rules = storage.rules.listByTool(projectId, toolName);

  // If no tool-specific rules found, fall back to category
  if (rules.length === 0 && fallbackCategory) {
    rules = storage.rules.list(projectId, fallbackCategory);
  }

  // If still nothing, get all project rules
  if (rules.length === 0) {
    rules = storage.rules.list(projectId);
  }

  if (rules.length === 0) return '';

  const lines = rules.map((r) => {
    const scope = r.tool_name ? `[${r.tool_name}]` : `[${r.category}]`;
    return `- ${scope} ${r.rule}`;
  });

  return ['### Project Rules (apply these to your analysis)', ...lines, ''].join('\n');
}
