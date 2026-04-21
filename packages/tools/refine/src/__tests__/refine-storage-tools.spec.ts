import { describe, it, expect, beforeEach } from 'vitest';
import { createStorage } from '@jarvis/storage';
import type { Storage } from '@jarvis/storage';
import { createRefineSkill } from '../index.js';

describe('refine storage tools', () => {
  let storage: Storage;

  beforeEach(() => {
    storage = createStorage(':memory:');
  });

  // ---------------------------------------------------------------------------
  // refine_save_iteration (task 3.1.3)
  // ---------------------------------------------------------------------------
  describe('refine_save_iteration', () => {
    it('saves a new iteration and returns the row as JSON', async () => {
      const skill = createRefineSkill(storage);
      const result = await skill.execute('refine_save_iteration', {
        thread_id: 'thread-save-1',
        output: 'Refined output text',
      });

      const row = JSON.parse(result) as Record<string, unknown>;
      expect(row['thread_id']).toBe('thread-save-1');
      expect(row['iteration']).toBe(1);
      expect(row['status']).toBe('in_progress');
      expect(row['output']).toBe('Refined output text');
    });

    it('saves iteration=1 with requirements on first save', async () => {
      const skill = createRefineSkill(storage);
      const result = await skill.execute('refine_save_iteration', {
        thread_id: 'thread-with-reqs',
        output: 'First output',
        requirements: 'The original requirements text',
      });

      const row = JSON.parse(result) as Record<string, unknown>;
      expect(row['iteration']).toBe(1);
      expect(row['requirements']).toBe('The original requirements text');
    });

    it('increments iteration number on subsequent saves', async () => {
      const skill = createRefineSkill(storage);

      await skill.execute('refine_save_iteration', {
        thread_id: 'thread-incr',
        output: 'Output 1',
      });

      const result2 = await skill.execute('refine_save_iteration', {
        thread_id: 'thread-incr',
        output: 'Output 2',
        instructions: 'Be more specific',
      });

      const row2 = JSON.parse(result2) as Record<string, unknown>;
      expect(row2['iteration']).toBe(2);
      expect(row2['instructions']).toBe('Be more specific');
    });

    // R4 — save on completed thread reopens and persists without error
    it('save on completed thread reopens all rows and persists new iteration (R4)', async () => {
      const skill = createRefineSkill(storage);

      // Save iter 1 — status should be in_progress
      const result1 = await skill.execute('refine_save_iteration', {
        thread_id: 'thread-reopen',
        output: 'Iteration 1 output',
      });
      const row1 = JSON.parse(result1) as Record<string, unknown>;
      expect(row1['status']).toBe('in_progress');

      // Finalize — all rows become completed
      storage.refinements.finalize('thread-reopen');
      expect(storage.refinements.getThreadStatus('thread-reopen')).toBe('completed');

      // Save iter 2 — should NOT throw; should reopen and persist
      await expect(
        skill.execute('refine_save_iteration', {
          thread_id: 'thread-reopen',
          output: 'Iteration 2 output after reopen',
        }),
      ).resolves.toBeTruthy();

      // All rows (including iter 1) should now be in_progress
      const rows = storage.refinements.listByThread('thread-reopen');
      expect(rows).toHaveLength(2);
      for (const row of rows) {
        expect(row.status).toBe('in_progress');
      }
    });
  });

  // ---------------------------------------------------------------------------
  // refine_list_iterations (task 3.2.3)
  // ---------------------------------------------------------------------------
  describe('refine_list_iterations', () => {
    it('returns rows ordered by iteration ASC', async () => {
      storage.refinements.save({ thread_id: 'thread-list', output: 'out1' });
      storage.refinements.save({ thread_id: 'thread-list', output: 'out2' });
      storage.refinements.save({ thread_id: 'thread-list', output: 'out3' });

      const skill = createRefineSkill(storage);
      const result = await skill.execute('refine_list_iterations', {
        thread_id: 'thread-list',
      });

      const rows = JSON.parse(result) as Array<Record<string, unknown>>;
      expect(rows).toHaveLength(3);
      expect(rows[0]?.['iteration']).toBe(1);
      expect(rows[1]?.['iteration']).toBe(2);
      expect(rows[2]?.['iteration']).toBe(3);
    });

    // E7 — empty list for non-existent thread (R6)
    it('returns empty array for non-existent thread (E7)', async () => {
      const skill = createRefineSkill(storage);
      const result = await skill.execute('refine_list_iterations', {
        thread_id: 'thread-nope',
      });

      const rows = JSON.parse(result) as unknown[];
      expect(rows).toEqual([]);
    });

    // S11 — list returns rows with status in_progress
    it('returns rows with status in_progress (S11)', async () => {
      storage.refinements.save({ thread_id: 'thread-s11', output: 'out1' });
      storage.refinements.save({ thread_id: 'thread-s11', output: 'out2' });

      const skill = createRefineSkill(storage);
      const result = await skill.execute('refine_list_iterations', {
        thread_id: 'thread-s11',
      });

      const rows = JSON.parse(result) as Array<Record<string, unknown>>;
      expect(rows).toHaveLength(2);
      for (const row of rows) {
        expect(row['status']).toBe('in_progress');
      }
    });
  });

  // ---------------------------------------------------------------------------
  // refine_get_latest (task 3.3.3)
  // ---------------------------------------------------------------------------
  describe('refine_get_latest', () => {
    it('returns the latest iteration row', async () => {
      storage.refinements.save({ thread_id: 'thread-latest', output: 'first' });
      storage.refinements.save({ thread_id: 'thread-latest', output: 'second' });

      const skill = createRefineSkill(storage);
      const result = await skill.execute('refine_get_latest', {
        thread_id: 'thread-latest',
      });

      const row = JSON.parse(result) as Record<string, unknown>;
      expect(row['iteration']).toBe(2);
      expect(row['output']).toBe('second');
    });

    // E8 — returns null for non-existent thread (R7)
    it('returns null for non-existent thread (E8)', async () => {
      const skill = createRefineSkill(storage);
      const result = await skill.execute('refine_get_latest', {
        thread_id: 'thread-empty',
      });

      const value = JSON.parse(result) as unknown;
      expect(value).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // refine_finalize (task 3.4.3)
  // ---------------------------------------------------------------------------
  describe('refine_finalize', () => {
    it('finalizes thread and returns JSON with status=completed', async () => {
      storage.refinements.save({ thread_id: 'thread-to-finalize', output: 'out' });

      const skill = createRefineSkill(storage);
      const result = await skill.execute('refine_finalize', {
        thread_id: 'thread-to-finalize',
      });

      const obj = JSON.parse(result) as Record<string, unknown>;
      expect(obj['thread_id']).toBe('thread-to-finalize');
      expect(obj['status']).toBe('completed');

      // Verify DB state
      expect(storage.refinements.getThreadStatus('thread-to-finalize')).toBe('completed');
    });

    // Idempotent on double call (spec §5)
    it('is idempotent on double finalize call', async () => {
      storage.refinements.save({ thread_id: 'thread-idem', output: 'out' });
      storage.refinements.finalize('thread-idem');

      const skill = createRefineSkill(storage);
      // Should not throw
      await expect(
        skill.execute('refine_finalize', { thread_id: 'thread-idem' }),
      ).resolves.toBeTruthy();

      const result = await skill.execute('refine_finalize', { thread_id: 'thread-idem' });
      const obj = JSON.parse(result) as Record<string, unknown>;
      expect(obj['status']).toBe('completed');
    });

    // Error on non-existent thread (spec §5)
    it('propagates error for non-existent thread', async () => {
      const skill = createRefineSkill(storage);
      await expect(
        skill.execute('refine_finalize', { thread_id: 'thread-missing' }),
      ).rejects.toThrow();
    });
  });
});
