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
    expect(row.status).toBe('in_progress');
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

  // 1.7.3 — finalize marks all rows 'completed'; idempotent on double call
  it('finalize marks all thread rows as completed and is idempotent', () => {
    storage.refinements.save({ thread_id: 'thread-c', output: 'out1' });
    storage.refinements.save({ thread_id: 'thread-c', output: 'out2' });

    storage.refinements.finalize('thread-c');

    const rows = storage.refinements.listByThread('thread-c');
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.status).toBe('completed');
    }

    // Idempotent — should not throw
    expect(() => storage.refinements.finalize('thread-c')).not.toThrow();

    // Status still completed after double call
    const rowsAfter = storage.refinements.listByThread('thread-c');
    for (const row of rowsAfter) {
      expect(row.status).toBe('completed');
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

  // 1.4.2 — save() on a completed thread reopens all rows to 'in_progress' and persists new iter
  it('save() on a completed thread reopens all rows and inserts new iter as in_progress', () => {
    // Setup: iter 1, then finalize
    storage.refinements.save({ thread_id: 'thread-reopen', output: 'iter1 output' });
    storage.refinements.finalize('thread-reopen');

    // Verify finalized
    const beforeReopen = storage.refinements.listByThread('thread-reopen');
    expect(beforeReopen[0].status).toBe('completed');

    // Save on completed thread — should reopen and persist
    const newRow = storage.refinements.save({ thread_id: 'thread-reopen', output: 'iter2 output' });

    // New iter is in_progress
    expect(newRow.iteration).toBe(2);
    expect(newRow.status).toBe('in_progress');

    // All rows (including the previously completed one) are now in_progress
    const allRows = storage.refinements.listByThread('thread-reopen');
    expect(allRows).toHaveLength(2);
    for (const row of allRows) {
      expect(row.status).toBe('in_progress');
    }
  });

  // 1.4.3 — save() on an in_progress thread does not change existing row statuses
  it('save() on an in_progress thread does not modify existing row statuses', () => {
    storage.refinements.save({ thread_id: 'thread-inprog', output: 'iter1 output' });

    // Verify in_progress
    const before = storage.refinements.listByThread('thread-inprog');
    expect(before[0].status).toBe('in_progress');

    // Save again on still-in_progress thread
    const newRow = storage.refinements.save({ thread_id: 'thread-inprog', output: 'iter2 output' });

    expect(newRow.iteration).toBe(2);
    expect(newRow.status).toBe('in_progress');

    // Both rows remain in_progress
    const allRows = storage.refinements.listByThread('thread-inprog');
    expect(allRows).toHaveLength(2);
    for (const row of allRows) {
      expect(row.status).toBe('in_progress');
    }
  });

  // 1.4.4 — getThreadStatus returns the status of the iteration with the highest iteration number
  it('getThreadStatus returns status of the most recent iteration', () => {
    // Insert iter 1 (in_progress via default)
    storage.refinements.save({ thread_id: 'thread-status', output: 'iter1' });
    // Insert iter 2 (in_progress)
    storage.refinements.save({ thread_id: 'thread-status', output: 'iter2' });

    // Finalize marks all rows as completed
    storage.refinements.finalize('thread-status');

    // getThreadStatus should reflect the latest iteration's status
    expect(storage.refinements.getThreadStatus('thread-status')).toBe('completed');

    // Reopen by saving iter 3
    storage.refinements.save({ thread_id: 'thread-status', output: 'iter3' });

    // Now status should reflect iter 3 (in_progress)
    expect(storage.refinements.getThreadStatus('thread-status')).toBe('in_progress');
  });
});
