/**
 * Converts a JavaScript object to TOON (Token-Oriented Object Notation).
 * TOON is designed for token-efficient LLM communication.
 *
 * Rules:
 * - Scalars: key: value
 * - Primitive arrays: key[N]: v1,v2,v3
 * - Object arrays (uniform shape): key[N]{field1,field2}:\n  row1\n  row2
 * - Nested objects: indented with 2 spaces
 * - Strings are NOT quoted unless they contain special chars (, or : or \n)
 */
export function toTOON(value: unknown, indent = 0): string {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'string') return escapeString(value);
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);

  if (Array.isArray(value)) {
    return formatArray(value, indent);
  }

  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) return '{}';

    const lines: string[] = [];
    for (const [key, val] of entries) {
      lines.push(formatEntry(key, val, indent));
    }
    return lines.join('\n');
  }

  return String(value);
}

function formatEntry(key: string, val: unknown, indent: number): string {
  const pad = '  '.repeat(indent);

  if (val === null || val === undefined) return `${pad}${key}: null`;

  if (Array.isArray(val)) {
    if (val.length === 0) return `${pad}${key}[0]:`;

    const isPrimitive = val.every(
      (v) => v === null || typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean',
    );

    if (isPrimitive) {
      const items = val.map((v) => escapeString(String(v ?? ''))).join(',');
      return `${pad}${key}[${val.length}]: ${items}`;
    }

    // Array of objects — check if uniform shape
    if (val.every((v) => v !== null && typeof v === 'object' && !Array.isArray(v))) {
      const firstKeys = Object.keys(val[0] as object);
      const uniform = val.every((v) => {
        const keys = Object.keys(v as object);
        return keys.length === firstKeys.length && keys.every((k) => firstKeys.includes(k));
      });

      if (uniform && firstKeys.length > 0) {
        const header = `${pad}${key}[${val.length}]{${firstKeys.join(',')}}:`;
        const rows = val.map((obj) => {
          const rowPad = '  '.repeat(indent + 1);
          return (
            rowPad +
            firstKeys
              .map((k) => {
                const v = (obj as Record<string, unknown>)[k];
                return escapeString(v === null || v === undefined ? '' : String(v));
              })
              .join(',')
          );
        });
        return [header, ...rows].join('\n');
      }
    }

    // Mixed array — serialize each as a nested object
    const lines = [`${pad}${key}[${val.length}]:`];
    for (const item of val) {
      lines.push(
        toTOON(item, indent + 1)
          .split('\n')
          .map((l) => '  '.repeat(indent + 1) + '- ' + l.trimStart())
          .join('\n'),
      );
    }
    return lines.join('\n');
  }

  if (typeof val === 'object') {
    const nested = val as Record<string, unknown>;
    const entries = Object.entries(nested);
    if (entries.length === 0) return `${pad}${key}: {}`;
    const lines = [`${pad}${key}:`];
    for (const [k, v] of entries) {
      lines.push(formatEntry(k, v, indent + 1));
    }
    return lines.join('\n');
  }

  return `${pad}${key}: ${escapeString(String(val))}`;
}

function formatArray(arr: unknown[], indent: number): string {
  if (arr.length === 0) return '[]';
  return arr.map((item) => toTOON(item, indent)).join('\n');
}

function escapeString(s: string): string {
  // If contains comma, colon, or newline — wrap in quotes
  if (/[,:\n]/.test(s)) {
    return `"${s.replace(/"/g, '\\"')}"`;
  }
  return s;
}
