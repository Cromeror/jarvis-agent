import { describe, it, expect } from 'vitest';
import { toTOON } from './index.js';

describe('toTOON', () => {
  it('serializes primitives and nested objects', () => {
    const result = toTOON({ name: 'foo', nested: { a: 1, b: 'x' } });
    expect(result).toContain('name: foo');
    expect(result).toContain('nested:');
    expect(result).toContain('a: 1');
    expect(result).toContain('b: x');
  });

  it('uses uniform-row layout for arrays of uniform scalar objects', () => {
    const result = toTOON({
      tickets: [
        { key: 'LXM-1', status: 'open' },
        { key: 'LXM-2', status: 'done' },
      ],
    });
    expect(result).toContain('tickets[2]{key,status}:');
    expect(result).toContain('LXM-1,open');
    expect(result).toContain('LXM-2,done');
  });

  it('does NOT use uniform-row layout when cells contain objects (preserves data)', () => {
    // Simulates Atlassian ADF: doc with content array of nodes
    const adf = {
      description: {
        type: 'doc',
        version: 1,
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'hello world' }],
          },
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'second line' }],
          },
        ],
      },
    };
    const result = toTOON(adf);
    // No [object Object]
    expect(result).not.toContain('[object Object]');
    // Text content is preserved
    expect(result).toContain('hello world');
    expect(result).toContain('second line');
  });

  it('recursively serializes arrays of uniform objects whose cells are non-scalar', () => {
    const nodes = [
      { type: 'text', attrs: { bold: true } },
      { type: 'text', attrs: { italic: true } },
    ];
    const result = toTOON({ content: nodes });
    expect(result).not.toContain('[object Object]');
    expect(result).toContain('bold: true');
    expect(result).toContain('italic: true');
  });

  it('escapes strings with commas, colons, or newlines', () => {
    const result = toTOON({ note: 'a, b: c\nline' });
    expect(result).toContain('"a, b: c\\nline"'.replace('\\n', '\n'));
  });

  it('handles null and undefined as null', () => {
    const result = toTOON({ a: null, b: undefined });
    expect(result).toContain('a: null');
    expect(result).toContain('b: null');
  });
});
