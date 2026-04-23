import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { createStorage } from '@jarvis/storage';
import type { Storage } from '@jarvis/storage';
import { createN8nSkill } from '../index.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function setupProject(storage: Storage, projectId: string) {
  storage.projects.create({
    id: projectId,
    name: `Test Project ${projectId}`,
    description: null,
  });
}

function setupN8nIntegration(storage: Storage, projectId: string, url = 'http://n8n.test') {
  storage.integrations.set(projectId, 'n8n', { url, api_key: 'test-api-key' });
}

function mockFetchOk(data: unknown = { id: 'wf-123', name: 'test' }) {
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: () => Promise.resolve(data),
  });
}

function mockFetch404() {
  return vi.fn().mockResolvedValue({
    ok: false,
    status: 404,
    json: () => Promise.resolve(null),
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('project_register_workflow — modo guía', () => {
  let storage: Storage;

  beforeEach(() => {
    storage = createStorage(':memory:');
    setupProject(storage, 'proj-test');
    setupN8nIntegration(storage, 'proj-test');
    storage.rules.seedWorkflowRegistryRules('proj-test');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // 2.6.2 — Modo guía: sin n8n_workflow_id retorna prompt con ### Tu Tarea + rules
  it('sin n8n_workflow_id: retorna prompt con ### Tu Tarea y rules concatenadas', async () => {
    const skill = createN8nSkill(storage);
    const result = await skill.execute('project_register_workflow', {
      project_id: 'proj-test',
    });

    expect(result).toContain('### Tu Tarea');
    expect(result).toContain('<!-- refine:meta');
    expect(result).toContain('tool: project_register_workflow');
    expect(result).toContain('mode: guide');
    expect(result).toContain('project: proj-test');
    // Rules content from WR-W1 (when_to_register)
    expect(result).toContain('Solo ofrecer registrar un workflow');
    // Rules content from WR-H2 (how_to_create)
    expect(result).toContain('kebab-case');
    expect(result).toContain('### Próximos pasos');
  });

  // 2.6.3 — Modo guía incluye purpose cuando se pasa
  it('con purpose: incluye el purpose en el prompt', async () => {
    const skill = createN8nSkill(storage);
    const result = await skill.execute('project_register_workflow', {
      project_id: 'proj-test',
      purpose: 'automatizar deploy a staging',
    });

    expect(result).toContain('### Tu Tarea');
    expect(result).toContain('automatizar deploy a staging');
  });

  // 2.6.3 — Sin purpose: muestra "no especificado"
  it('sin purpose: muestra "no especificado" en el contexto', async () => {
    const skill = createN8nSkill(storage);
    const result = await skill.execute('project_register_workflow', {
      project_id: 'proj-test',
    });

    expect(result).toContain('no especificado');
  });
});

describe('project_register_workflow — modo persistencia', () => {
  let storage: Storage;

  beforeEach(() => {
    storage = createStorage(':memory:');
    setupProject(storage, 'proj-test');
    setupN8nIntegration(storage, 'proj-test');
    storage.rules.seedWorkflowRegistryRules('proj-test');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // 2.6.4 — Happy path: mock fetch 200 → persiste + retorna row
  it('con n8n_workflow_id válido (mock 200): persiste y retorna row', async () => {
    vi.stubGlobal('fetch', mockFetchOk({ id: 'abc123', name: 'deploy-staging' }));

    const skill = createN8nSkill(storage);
    const result = await skill.execute('project_register_workflow', {
      project_id: 'proj-test',
      name: 'deploy-staging',
      description: 'Deploy a staging con migraciones',
      n8n_workflow_id: 'abc123',
      local_path: '.jarvis/workflows/deploy-staging.json',
    });

    const parsed = JSON.parse(result) as { row: Record<string, unknown>; next_steps: string };
    expect(parsed.row).toBeDefined();
    expect(parsed.row['name']).toBe('deploy-staging');
    expect(parsed.row['n8n_workflow_id']).toBe('abc123');
    expect(parsed.row['project_id']).toBe('proj-test');
    expect(parsed.row['local_path']).toBe('.jarvis/workflows/deploy-staging.json');
    expect(parsed.next_steps).toBeDefined();

    // Verify it was persisted
    const list = storage.projectWorkflows.listByProject('proj-test');
    expect(list).toHaveLength(1);
    expect(list[0]!.name).toBe('deploy-staging');
  });

  // 2.6.5 — Mock fetch 404 → error sin persistir
  it('con n8n_workflow_id inexistente (mock 404): error sin persistir', async () => {
    vi.stubGlobal('fetch', mockFetch404());

    const skill = createN8nSkill(storage);
    const result = await skill.execute('project_register_workflow', {
      project_id: 'proj-test',
      name: 'deploy-staging',
      n8n_workflow_id: 'non-existent-id',
      local_path: '.jarvis/workflows/deploy-staging.json',
    });

    expect(result).toContain('no existe en n8n');
    expect(result).toContain('non-existent-id');

    // Verify nothing was persisted
    const list = storage.projectWorkflows.listByProject('proj-test');
    expect(list).toHaveLength(0);
  });

  // 2.6.6 — name con espacios → error de validación
  it('con name inválido (espacios): retorna error de validación', async () => {
    vi.stubGlobal('fetch', mockFetchOk());

    const skill = createN8nSkill(storage);
    const result = await skill.execute('project_register_workflow', {
      project_id: 'proj-test',
      name: 'Deploy Staging',
      n8n_workflow_id: 'abc123',
      local_path: '.jarvis/workflows/deploy.json',
    });

    expect(result).toContain('no es válido');
    expect(result).toContain('kebab-case');
    expect(result).toContain('WR-H2');
  });

  // 2.6.6 — name con un solo carácter → debería fallar el regex (requiere mínimo 2 chars por el patrón)
  it('con name de un solo carácter: retorna error de validación', async () => {
    vi.stubGlobal('fetch', mockFetchOk());

    const skill = createN8nSkill(storage);
    const result = await skill.execute('project_register_workflow', {
      project_id: 'proj-test',
      name: 'a',
      n8n_workflow_id: 'abc123',
      local_path: '.jarvis/workflows/a.json',
    });

    expect(result).toContain('no es válido');
  });

  // 2.6.7 — Upsert: dos llamadas con mismo name actualizan, no crean nueva
  it('upsert: segunda llamada con mismo name actualiza la fila', async () => {
    vi.stubGlobal('fetch', mockFetchOk());

    const skill = createN8nSkill(storage);

    await skill.execute('project_register_workflow', {
      project_id: 'proj-test',
      name: 'deploy-staging',
      description: 'Original description',
      n8n_workflow_id: 'abc123',
      local_path: '.jarvis/workflows/deploy-staging.json',
    });

    const result2 = await skill.execute('project_register_workflow', {
      project_id: 'proj-test',
      name: 'deploy-staging',
      description: 'Updated description',
      n8n_workflow_id: 'xyz789',
      local_path: '.jarvis/workflows/deploy-staging.json',
    });

    const parsed = JSON.parse(result2) as { row: Record<string, unknown> };
    expect(parsed.row['n8n_workflow_id']).toBe('xyz789');
    expect(parsed.row['description']).toBe('Updated description');

    // Verify only one row exists
    const list = storage.projectWorkflows.listByProject('proj-test');
    expect(list).toHaveLength(1);
  });
});

describe('project_list_workflows', () => {
  let storage: Storage;

  beforeEach(() => {
    storage = createStorage(':memory:');
    setupProject(storage, 'proj-test');
    setupN8nIntegration(storage, 'proj-test');
    storage.rules.seedWorkflowRegistryRules('proj-test');
  });

  // 2.6.8 — Sin workflows: retorna { workflows: [], next_steps: [...] }
  it('proyecto sin workflows: retorna array vacío + next_steps', async () => {
    const skill = createN8nSkill(storage);
    const result = await skill.execute('project_list_workflows', {
      project_id: 'proj-test',
    });

    const parsed = JSON.parse(result) as { workflows: unknown[]; next_steps: string };
    expect(parsed.workflows).toEqual([]);
    expect(parsed.next_steps).toBeDefined();
    // next_steps should contain after_registration rules (WR-A1, WR-A2)
    expect(parsed.next_steps).toContain('n8n_trigger_workflow');
  });

  it('proyecto con workflows: retorna lista + next_steps', async () => {
    storage.projectWorkflows.register({
      project_id: 'proj-test',
      name: 'deploy-prod',
      description: 'Deploy a producción',
      n8n_workflow_id: 'wf-001',
      local_path: '.jarvis/workflows/deploy-prod.json',
    });
    storage.projectWorkflows.register({
      project_id: 'proj-test',
      name: 'deploy-staging',
      description: 'Deploy a staging',
      n8n_workflow_id: 'wf-002',
      local_path: '.jarvis/workflows/deploy-staging.json',
    });

    const skill = createN8nSkill(storage);
    const result = await skill.execute('project_list_workflows', {
      project_id: 'proj-test',
    });

    const parsed = JSON.parse(result) as { workflows: Array<{ name: string }>; next_steps: string };
    expect(parsed.workflows).toHaveLength(2);
    // Ordered by name ASC
    expect(parsed.workflows[0]!.name).toBe('deploy-prod');
    expect(parsed.workflows[1]!.name).toBe('deploy-staging');
    expect(parsed.next_steps).toBeDefined();
  });
});

describe('project_unregister_workflow', () => {
  let storage: Storage;

  beforeEach(() => {
    storage = createStorage(':memory:');
    setupProject(storage, 'proj-test');
    setupN8nIntegration(storage, 'proj-test');
    storage.rules.seedWorkflowRegistryRules('proj-test');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // 2.6.9 — Happy path: unregister existente
  it('happy path: elimina workflow registrado y retorna removed=true', async () => {
    storage.projectWorkflows.register({
      project_id: 'proj-test',
      name: 'deploy-staging',
      description: null,
      n8n_workflow_id: 'wf-001',
      local_path: '.jarvis/workflows/deploy-staging.json',
    });

    const skill = createN8nSkill(storage);
    const result = await skill.execute('project_unregister_workflow', {
      project_id: 'proj-test',
      name: 'deploy-staging',
    });

    const parsed = JSON.parse(result) as { removed: boolean; name: string; note: string };
    expect(parsed.removed).toBe(true);
    expect(parsed.name).toBe('deploy-staging');
    expect(parsed.note).toContain('sigue activo en n8n');

    // Verify it was removed
    const list = storage.projectWorkflows.listByProject('proj-test');
    expect(list).toHaveLength(0);
  });

  // 2.6.10 — Nombre inexistente → error
  it('nombre inexistente: retorna error', async () => {
    const skill = createN8nSkill(storage);
    const result = await skill.execute('project_unregister_workflow', {
      project_id: 'proj-test',
      name: 'non-existent-workflow',
    });

    expect(result).toContain('Error');
    expect(result).toContain('non-existent-workflow');
    expect(result).toContain('no estaba registrado');
  });
});

describe('validaciones de proyecto', () => {
  let storage: Storage;

  beforeEach(() => {
    storage = createStorage(':memory:');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // 2.6.11 — Proyecto sin integración n8n: modo guía → error sugiriendo configurar integración
  it('proyecto sin integración n8n: modo guía retorna error con hint', async () => {
    setupProject(storage, 'proj-no-n8n');
    // No n8n integration configured

    const skill = createN8nSkill(storage);
    const result = await skill.execute('project_register_workflow', {
      project_id: 'proj-no-n8n',
    });

    expect(result).toContain('Error');
    expect(result).toContain('no tiene integración n8n');
    expect(result).toContain('jarvis project integration add n8n');
  });

  it('proyecto inexistente: retorna error', async () => {
    const skill = createN8nSkill(storage);
    const result = await skill.execute('project_register_workflow', {
      project_id: 'non-existent-project',
    });

    expect(result).toContain('Error');
    expect(result).toContain('non-existent-project');
  });

  it('project_list_workflows con proyecto inexistente: retorna error', async () => {
    const skill = createN8nSkill(storage);
    const result = await skill.execute('project_list_workflows', {
      project_id: 'non-existent',
    });

    expect(result).toContain('Error');
  });

  it('project_unregister_workflow con proyecto inexistente: retorna error', async () => {
    const skill = createN8nSkill(storage);
    const result = await skill.execute('project_unregister_workflow', {
      project_id: 'non-existent',
      name: 'some-workflow',
    });

    expect(result).toContain('Error');
  });
});
