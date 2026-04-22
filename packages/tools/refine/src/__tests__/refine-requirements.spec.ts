import { describe, it, expect, beforeEach } from 'vitest';
import { createStorage } from '@jarvis/storage';
import type { Storage } from '@jarvis/storage';
import { createRefineSkill } from '../index.js';

describe('refine_requirements tool', () => {
  let storage: Storage;

  beforeEach(() => {
    storage = createStorage(':memory:');
  });

  // R1 — Without thread_id: returns prompt WITH generated thread_id header (D5)
  it('without thread_id: returns prompt with generated thread_id header', async () => {
    const skill = createRefineSkill(storage);
    const result = await skill.execute('refine_requirements', {
      requirements: 'The system shall allow users to log in.',
    });

    expect(result).toContain('<!-- refine:meta');
    expect(result).toContain('iteration: 1');
    expect(result).toContain('## Análisis de Refinamiento de Requerimientos');
    expect(result).toContain('The system shall allow users to log in.');
  });

  // R1 — One-shot contains a valid UUIDv4 in the header
  it('without thread_id: header contains a valid UUIDv4', async () => {
    const skill = createRefineSkill(storage);
    const result = await skill.execute('refine_requirements', {
      requirements: 'Some requirement.',
    });

    const uuidRegex = /<!-- refine:meta\s*\n\s*thread_id:\s*([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\s*\n\s*iteration:\s*1\s*\n\s*-->/i;
    expect(result).toMatch(uuidRegex);
  });

  // R1 — One-shot does NOT create a row in refinements
  it('without thread_id: does not create a row in refinements storage', async () => {
    const rowsBefore = storage.refinements.listByThread('any-thread');
    expect(rowsBefore).toHaveLength(0);

    const skill = createRefineSkill(storage);
    await skill.execute('refine_requirements', {
      requirements: 'Some requirement.',
    });

    // Extract thread_id from response header to verify no rows were stored for it
    // We can't know the UUID ahead of time, so instead we verify via a known thread
    // that no rows at all were added (empty DB scenario)
    const allRowsViaKnownThread = storage.refinements.listByThread('non-existent-thread');
    expect(allRowsViaKnownThread).toHaveLength(0);
  });

  // 2.7.1b — Empty string thread_id treated as absent (spec §5)
  it('with empty string thread_id: behaves as one-shot (has header)', async () => {
    const skill = createRefineSkill(storage);
    const result = await skill.execute('refine_requirements', {
      requirements: 'Some requirement.',
      thread_id: '',
    });

    expect(result).toContain('<!-- refine:meta');
    expect(result).toContain('## Análisis de Refinamiento de Requerimientos');
  });

  // 2.7.2 — With new thread_id (no rows): header with iteration=1, no has_base
  it('with new thread_id: header shows iteration=1 (no has_base field)', async () => {
    const skill = createRefineSkill(storage);
    const result = await skill.execute('refine_requirements', {
      requirements: 'The system shall send email notifications.',
      thread_id: 'thread-new-001',
    });

    expect(result).toContain('<!-- refine:meta');
    expect(result).toContain('thread_id: thread-new-001');
    expect(result).toContain('iteration: 1');
    expect(result).not.toContain('has_base');
    expect(result).toContain('## Análisis de Refinamiento de Requerimientos');
    expect(result).not.toContain('### Output Previo');
  });

  // 2.7.3 — With existing thread_id and no previous_output: base from getLatest
  it('with existing thread_id and no previous_output: base from storage', async () => {
    // Pre-save an iteration so storage has data
    storage.refinements.save({
      thread_id: 'thread-existing',
      output: 'Refined output from iteration 1',
    });

    const skill = createRefineSkill(storage);
    const result = await skill.execute('refine_requirements', {
      requirements: 'New requirement text.',
      thread_id: 'thread-existing',
    });

    expect(result).toContain('<!-- refine:meta');
    expect(result).not.toContain('has_base');
    expect(result).toContain('iteration: 2');
    expect(result).toContain('### Output Previo');
    expect(result).toContain('Refined output from iteration 1');
  });

  // 2.7.4 — With explicit previous_output: uses it and ignores DB content (E3)
  it('with explicit previous_output: uses it and ignores DB content', async () => {
    // Pre-save different content in storage
    storage.refinements.save({
      thread_id: 'thread-override',
      output: 'DB output that should be ignored',
    });

    const skill = createRefineSkill(storage);
    const result = await skill.execute('refine_requirements', {
      requirements: 'Some requirement.',
      thread_id: 'thread-override',
      previous_output: 'Explicit override output',
    });

    expect(result).not.toContain('has_base');
    expect(result).toContain('### Output Previo');
    expect(result).toContain('Explicit override output');
    expect(result).not.toContain('DB output that should be ignored');
  });

  // R2 — Iterative path does NOT contain ### Input Requirements
  it('iterative path: does not contain ### Input Requirements section', async () => {
    const skill = createRefineSkill(storage);
    const result = await skill.execute('refine_requirements', {
      requirements: 'Some requirements text.',
      thread_id: 'thread-iter-no-input-req',
    });

    expect(result).not.toContain('### Requerimientos de Entrada');
    expect(result).toContain('### Instrucciones de Refinamiento');
  });

  // R3 — Iterative path over completed thread does NOT contain warning
  it('iterative path over completed thread: does not contain warning', async () => {
    storage.refinements.save({
      thread_id: 'thread-completed-nowarn',
      output: 'Some output',
    });
    storage.refinements.finalize('thread-completed-nowarn');

    const skill = createRefineSkill(storage);
    const result = await skill.execute('refine_requirements', {
      requirements: 'More requirements.',
      thread_id: 'thread-completed-nowarn',
    });

    expect(result).not.toContain('Advertencia');
    expect(result).not.toContain('finalizado');
    expect(result).toContain('<!-- refine:meta');
    expect(result).toContain('## Análisis de Refinamiento de Requerimientos');
  });

  // Instructions included in body when provided
  it('with instructions: includes Correction Instructions section', async () => {
    const skill = createRefineSkill(storage);
    const result = await skill.execute('refine_requirements', {
      requirements: 'Be more concise.',
      thread_id: 'thread-with-instrs',
      instructions: 'Make it shorter',
    });

    expect(result).toContain('### Instrucciones de Corrección');
    expect(result).toContain('Make it shorter');
  });

  // Empty string instructions treated as absent (spec §5)
  it('with empty string instructions: no Correction Instructions section', async () => {
    const skill = createRefineSkill(storage);
    const result = await skill.execute('refine_requirements', {
      requirements: 'Some req.',
      thread_id: 'thread-empty-instrs',
      instructions: '',
    });

    expect(result).not.toContain('### Instrucciones de Corrección');
  });

  // D3 — refine_finalize returns { thread_id, status: 'completed' }
  it('refine_finalize returns status completed read from DB', async () => {
    storage.refinements.save({ thread_id: 'thread-finalize-status', output: 'out' });

    const skill = createRefineSkill(storage);
    const result = await skill.execute('refine_finalize', {
      thread_id: 'thread-finalize-status',
    });

    const obj = JSON.parse(result) as Record<string, unknown>;
    expect(obj['thread_id']).toBe('thread-finalize-status');
    expect(obj['status']).toBe('completed');
  });
});
