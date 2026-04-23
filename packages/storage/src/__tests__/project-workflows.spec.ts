import { describe, it, expect, beforeEach } from 'vitest';
import { createStorage } from '../index.js';
import type { Storage } from '../index.js';

describe('project-workflows repository', () => {
  let storage: Storage;

  beforeEach(() => {
    storage = createStorage(':memory:');
    storage.projects.create({ id: 'proj-a', name: 'Project A' });
    storage.projects.create({ id: 'proj-b', name: 'Project B' });
  });

  // 1.5.1 — register inserts a new row with populated created_at and updated_at
  it('register inserts a new row with correct data and timestamps', () => {
    const row = storage.projectWorkflows.register({
      project_id: 'proj-a',
      name: 'deploy-staging',
      description: 'Deploy to staging environment',
      n8n_workflow_id: 'wf-001',
      local_path: '.jarvis/workflows/deploy-staging.json',
    });

    expect(row.id).toBeGreaterThan(0);
    expect(row.project_id).toBe('proj-a');
    expect(row.name).toBe('deploy-staging');
    expect(row.description).toBe('Deploy to staging environment');
    expect(row.n8n_workflow_id).toBe('wf-001');
    expect(row.local_path).toBe('.jarvis/workflows/deploy-staging.json');
    expect(typeof row.created_at).toBe('string');
    expect(row.created_at.length).toBeGreaterThan(0);
    expect(typeof row.updated_at).toBe('string');
    expect(row.updated_at.length).toBeGreaterThan(0);
  });

  // 1.5.2 — upsert: second call with same (project_id, name) updates fields but keeps created_at
  it('upsert updates description, n8n_workflow_id, local_path and updated_at; created_at stays immutable', () => {
    const first = storage.projectWorkflows.register({
      project_id: 'proj-a',
      name: 'deploy-staging',
      description: 'Initial description',
      n8n_workflow_id: 'wf-001',
      local_path: '.jarvis/workflows/deploy-staging.json',
    });

    const second = storage.projectWorkflows.register({
      project_id: 'proj-a',
      name: 'deploy-staging',
      description: 'Updated description',
      n8n_workflow_id: 'wf-002',
      local_path: '.jarvis/workflows/deploy-staging-v2.json',
    });

    expect(second.id).toBe(first.id);
    expect(second.description).toBe('Updated description');
    expect(second.n8n_workflow_id).toBe('wf-002');
    expect(second.local_path).toBe('.jarvis/workflows/deploy-staging-v2.json');
    expect(second.created_at).toBe(first.created_at);
  });

  // 1.5.3 — listByProject returns rows ordered by name ASC
  it('listByProject returns rows ordered by name ASC', () => {
    storage.projectWorkflows.register({ project_id: 'proj-a', name: 'notify-pr', n8n_workflow_id: 'wf-n', local_path: null });
    storage.projectWorkflows.register({ project_id: 'proj-a', name: 'deploy-staging', n8n_workflow_id: 'wf-d', local_path: null });
    storage.projectWorkflows.register({ project_id: 'proj-a', name: 'build-docker', n8n_workflow_id: 'wf-b', local_path: null });

    const rows = storage.projectWorkflows.listByProject('proj-a');

    expect(rows).toHaveLength(3);
    expect(rows[0].name).toBe('build-docker');
    expect(rows[1].name).toBe('deploy-staging');
    expect(rows[2].name).toBe('notify-pr');
  });

  // 1.5.4 — listByProject on project with no workflows returns empty array
  it('listByProject on project without workflows returns empty array', () => {
    const rows = storage.projectWorkflows.listByProject('proj-b');
    expect(rows).toEqual([]);
  });

  // 1.5.5 — getByName returns row or null
  it('getByName returns the row when it exists, null when it does not', () => {
    storage.projectWorkflows.register({
      project_id: 'proj-a',
      name: 'deploy-staging',
      n8n_workflow_id: 'wf-001',
      local_path: null,
    });

    const found = storage.projectWorkflows.getByName('proj-a', 'deploy-staging');
    expect(found).not.toBeNull();
    expect(found?.name).toBe('deploy-staging');

    const notFound = storage.projectWorkflows.getByName('proj-a', 'nonexistent');
    expect(notFound).toBeNull();
  });

  // 1.5.6 — remove returns true if deleted, false if not found
  it('remove returns true if row was deleted, false if it did not exist', () => {
    storage.projectWorkflows.register({
      project_id: 'proj-a',
      name: 'deploy-staging',
      n8n_workflow_id: 'wf-001',
      local_path: null,
    });

    const deleted = storage.projectWorkflows.remove('proj-a', 'deploy-staging');
    expect(deleted).toBe(true);

    const notFound = storage.projectWorkflows.remove('proj-a', 'deploy-staging');
    expect(notFound).toBe(false);
  });

  // 1.5.7 — CASCADE DELETE: deleting project removes its workflows
  it('CASCADE DELETE: deleting project removes all its workflows', () => {
    storage.projectWorkflows.register({ project_id: 'proj-a', name: 'wf-1', n8n_workflow_id: 'id-1', local_path: null });
    storage.projectWorkflows.register({ project_id: 'proj-a', name: 'wf-2', n8n_workflow_id: 'id-2', local_path: null });

    expect(storage.projectWorkflows.listByProject('proj-a')).toHaveLength(2);

    storage.db.prepare('DELETE FROM projects WHERE id = ?').run('proj-a');

    expect(storage.projectWorkflows.listByProject('proj-a')).toHaveLength(0);
  });

  // 1.5.8 — UNIQUE constraint: direct INSERT with duplicate (project_id, name) must fail
  it('UNIQUE constraint: direct INSERT with duplicate (project_id, name) throws', () => {
    storage.projectWorkflows.register({
      project_id: 'proj-a',
      name: 'deploy-staging',
      n8n_workflow_id: 'wf-001',
      local_path: null,
    });

    expect(() => {
      storage.db
        .prepare(
          `INSERT INTO project_workflows (project_id, name, n8n_workflow_id)
           VALUES (?, ?, ?)`,
        )
        .run('proj-a', 'deploy-staging', 'wf-999');
    }).toThrow();
  });
});
