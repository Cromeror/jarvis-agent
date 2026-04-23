import { describe, it, expect, beforeEach } from 'vitest';
import { createStorage } from '../index.js';
import type { Storage } from '../index.js';

describe('rules repository', () => {
  let storage: Storage;

  beforeEach(() => {
    storage = createStorage(':memory:');
    storage.projects.create({ id: 'proj-a', name: 'Project A' });
  });

  // 1.5.9 — seedWorkflowRegistryRules: first call inserts 16 rules; second call inserts 0 (idempotent)
  // Note: spec lists 16 explicit WR codes (WR-W1..W4, WR-H1..H6, WR-P1..P4, WR-A1..A2); tasks.md typo says 15
  it('seedWorkflowRegistryRules inserts all rules on first call and 0 on second call (idempotent)', () => {
    const firstCount = storage.rules.seedWorkflowRegistryRules('proj-a');
    expect(firstCount).toBe(16);

    const allRules = storage.rules.list('proj-a');
    const workflowRules = allRules.filter((r) => r.category.startsWith('workflow_registry.'));
    expect(workflowRules).toHaveLength(16);

    const secondCount = storage.rules.seedWorkflowRegistryRules('proj-a');
    expect(secondCount).toBe(0);

    const allRulesAfter = storage.rules.list('proj-a');
    const workflowRulesAfter = allRulesAfter.filter((r) => r.category.startsWith('workflow_registry.'));
    expect(workflowRulesAfter).toHaveLength(16);
  });

  // 1.5.10 — after seed, listByTool returns correct rules for project_register_workflow
  it('after seed, listByTool returns rules for project_register_workflow by category', () => {
    storage.rules.seedWorkflowRegistryRules('proj-a');

    const rules = storage.rules.listByTool('proj-a', 'project_register_workflow');

    // Should include rules from when_to_register (4), how_to_create (6), what_to_persist (4)
    // tool_name='project_register_workflow' — that's 14 rules + tool_name IS NULL rules (none seeded)
    const registerRules = rules.filter((r) => r.tool_name === 'project_register_workflow');
    expect(registerRules).toHaveLength(14);

    const categories = new Set(registerRules.map((r) => r.category));
    expect(categories).toContain('workflow_registry.when_to_register');
    expect(categories).toContain('workflow_registry.how_to_create');
    expect(categories).toContain('workflow_registry.what_to_persist');
  });
});
