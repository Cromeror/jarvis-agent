import { describe, it, expect, beforeEach } from 'vitest';
import { createStorage } from '@jarvis/storage';
import type { Storage } from '@jarvis/storage';
import { createRefineSkill } from '../index.js';

describe('refine_requirements tool', () => {
  let storage: Storage;

  beforeEach(() => {
    storage = createStorage(':memory:');
  });

  // 2.7.1 — Without thread_id: returns prompt without header (legacy behavior, E4)
  it('without thread_id: returns prompt without HTML header', async () => {
    const skill = createRefineSkill(storage);
    const result = await skill.execute('refine_requirements', {
      requirements: 'The system shall allow users to log in.',
    });

    expect(result).not.toContain('<!-- refine:meta');
    expect(result).toContain('## Requirements Refinement Analysis');
    expect(result).toContain('The system shall allow users to log in.');
  });

  // 2.7.1b — Empty string thread_id treated as absent (spec §5)
  it('with empty string thread_id: behaves as legacy (no header)', async () => {
    const skill = createRefineSkill(storage);
    const result = await skill.execute('refine_requirements', {
      requirements: 'Some requirement.',
      thread_id: '',
    });

    expect(result).not.toContain('<!-- refine:meta');
    expect(result).toContain('## Requirements Refinement Analysis');
  });

  // 2.7.2 — With new thread_id (no rows): header with iteration=1, has_base=false
  it('with new thread_id: header shows iteration=1 and has_base=false', async () => {
    const skill = createRefineSkill(storage);
    const result = await skill.execute('refine_requirements', {
      requirements: 'The system shall send email notifications.',
      thread_id: 'thread-new-001',
    });

    expect(result).toContain('<!-- refine:meta');
    expect(result).toContain('thread_id: thread-new-001');
    expect(result).toContain('iteration: 1');
    expect(result).toContain('has_base: false');
    expect(result).toContain('## Requirements Refinement Analysis');
    expect(result).not.toContain('### Previous Output');
  });

  // 2.7.3 — With existing thread_id and no previous_output: has_base=true, base from getLatest
  it('with existing thread_id and no previous_output: has_base=true, base from storage', async () => {
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
    expect(result).toContain('has_base: true');
    expect(result).toContain('iteration: 2');
    expect(result).toContain('### Previous Output');
    expect(result).toContain('Refined output from iteration 1');
  });

  // 2.7.4 — With explicit previous_output: has_base=true, base = previous_output (ignores DB, E3)
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

    expect(result).toContain('has_base: true');
    expect(result).toContain('### Previous Output');
    expect(result).toContain('Explicit override output');
    expect(result).not.toContain('DB output that should be ignored');
  });

  // 2.7.5 — With finalized thread: prompt includes warning in Spanish (E6)
  it('with finalized thread: prompt includes warning in Spanish', async () => {
    storage.refinements.save({
      thread_id: 'thread-final',
      output: 'Some output',
    });
    storage.refinements.finalize('thread-final');

    const skill = createRefineSkill(storage);
    const result = await skill.execute('refine_requirements', {
      requirements: 'More requirements.',
      thread_id: 'thread-final',
    });

    expect(result).toContain('Advertencia');
    expect(result).toContain('thread-final');
    expect(result).toContain('finalizado');
    expect(result).toContain('<!-- refine:meta');
    expect(result).toContain('## Requirements Refinement Analysis');
  });

  // Instructions included in body when provided
  it('with instructions: includes Correction Instructions section', async () => {
    const skill = createRefineSkill(storage);
    const result = await skill.execute('refine_requirements', {
      requirements: 'Be more concise.',
      thread_id: 'thread-with-instrs',
      instructions: 'Make it shorter',
    });

    expect(result).toContain('### Correction Instructions');
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

    expect(result).not.toContain('### Correction Instructions');
  });
});
