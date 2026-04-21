import { describe, it, expect, beforeEach } from 'vitest';
import { createStorage } from '../index.js';
import type { Storage } from '../index.js';

describe('refinements repository', () => {
  let storage: Storage;

  beforeEach(() => {
    storage = createStorage(':memory:');
    // Seed a project so foreign key refs are valid if used
    storage.projects.create({
      id: 'test-proj',
      name: 'Test Project',
    });
  });

  // 1.7.1 — save inserts iteration=1 on a new thread
  it('save inserts iteration=1 on a new thread', () => {
    const row = storage.refinements.save({
      thread_id: 'thread-a',
      output: 'output text',
    });

    expect(row.iteration).toBe(1);
    expect(row.thread_id).toBe('thread-a');
    expect(row.status).toBe('draft');
    expect(row.parent_id).toBeNull();
  });

  // 1.7.2 — save inserts iteration=MAX+1 on existing thread (monotonically)
  it('save inserts iteration=MAX+1 on existing thread (monotonic)', () => {
    const first = storage.refinements.save({
      thread_id: 'thread-b',
      output: 'first output',
    });
    const second = storage.refinements.save({
      thread_id: 'thread-b',
      output: 'second output',
    });

    expect(first.iteration).toBe(1);
    expect(second.iteration).toBe(2);
    expect(second.parent_id).toBe(first.id);
  });

  // 1.7.3 — finalize marks all rows 'final'; idempotent on double call
  it('finalize marks all thread rows as final and is idempotent', () => {
    storage.refinements.save({ thread_id: 'thread-c', output: 'out1' });
    storage.refinements.save({ thread_id: 'thread-c', output: 'out2' });

    storage.refinements.finalize('thread-c');

    const rows = storage.refinements.listByThread('thread-c');
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.status).toBe('final');
    }

    // Idempotent — should not throw
    expect(() => storage.refinements.finalize('thread-c')).not.toThrow();

    // Status still final after double call
    const rowsAfter = storage.refinements.listByThread('thread-c');
    for (const row of rowsAfter) {
      expect(row.status).toBe('final');
    }
  });

  // 1.7.4 — finalize on non-existent thread throws controlled Error
  it('finalize on non-existent thread throws a controlled Error', () => {
    expect(() => storage.refinements.finalize('no-such-thread')).toThrow(
      'Thread no-such-thread no existe',
    );
  });

  // 1.7.5 — getLatest returns null on empty thread
  it('getLatest returns null on an empty thread', () => {
    const result = storage.refinements.getLatest('empty-thread');
    expect(result).toBeNull();
  });

  // 1.7.6 — listByThread returns [] on empty thread
  it('listByThread returns [] on an empty thread', () => {
    const result = storage.refinements.listByThread('empty-thread');
    expect(result).toEqual([]);
  });
});
