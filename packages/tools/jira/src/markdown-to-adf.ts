export interface AdfNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: AdfNode[];
  marks?: Array<{ type: string; attrs?: Record<string, unknown> }>;
  text?: string;
}

export interface AdfDoc {
  version: 1;
  type: 'doc';
  content: AdfNode[];
}

const PANEL_RE = /^:::\s*(info|warning|error|success|note)\s*$/;
const PANEL_END_RE = /^:::\s*$/;
const HEADING_RE = /^(#{1,6})\s+(.*)$/;
const BULLET_RE = /^(\s*)[-*]\s+(.*)$/;
const NUMBERED_RE = /^(\s*)\d+\.\s+(.*)$/;
const CODE_FENCE_RE = /^```(\w*)\s*$/;
const BLOCKQUOTE_RE = /^>\s?(.*)$/;
const HR_RE = /^[-*_]{3,}\s*$/;

const PANEL_TYPE_MAP: Record<string, string> = {
  info: 'info',
  warning: 'warning',
  error: 'error',
  success: 'success',
  note: 'note',
};

export function markdownToAdf(markdown: string): AdfDoc {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const content: AdfNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i] ?? '';

    if (line.trim() === '') {
      i++;
      continue;
    }

    const panelMatch = PANEL_RE.exec(line);
    if (panelMatch) {
      const panelType = PANEL_TYPE_MAP[panelMatch[1]!] ?? 'info';
      const panelLines: string[] = [];
      i++;
      while (i < lines.length && !PANEL_END_RE.test(lines[i] ?? '')) {
        panelLines.push(lines[i] ?? '');
        i++;
      }
      if (i < lines.length) i++;
      const inner = markdownToAdf(panelLines.join('\n'));
      content.push({
        type: 'panel',
        attrs: { panelType },
        content: inner.content.length > 0 ? inner.content : [emptyParagraph()],
      });
      continue;
    }

    const fenceMatch = CODE_FENCE_RE.exec(line);
    if (fenceMatch) {
      const language = fenceMatch[1] || undefined;
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !CODE_FENCE_RE.test(lines[i] ?? '')) {
        codeLines.push(lines[i] ?? '');
        i++;
      }
      if (i < lines.length) i++;
      content.push({
        type: 'codeBlock',
        attrs: language ? { language } : {},
        content: [{ type: 'text', text: codeLines.join('\n') }],
      });
      continue;
    }

    if (HR_RE.test(line)) {
      content.push({ type: 'rule' });
      i++;
      continue;
    }

    const headingMatch = HEADING_RE.exec(line);
    if (headingMatch) {
      const level = headingMatch[1]!.length;
      const text = headingMatch[2]!;
      content.push({
        type: 'heading',
        attrs: { level },
        content: parseInline(text),
      });
      i++;
      continue;
    }

    if (BLOCKQUOTE_RE.test(line)) {
      const quoteLines: string[] = [];
      while (i < lines.length && BLOCKQUOTE_RE.test(lines[i] ?? '')) {
        const m = BLOCKQUOTE_RE.exec(lines[i] ?? '');
        quoteLines.push(m?.[1] ?? '');
        i++;
      }
      const inner = markdownToAdf(quoteLines.join('\n'));
      content.push({
        type: 'blockquote',
        content: inner.content.length > 0 ? inner.content : [emptyParagraph()],
      });
      continue;
    }

    if (BULLET_RE.test(line) || NUMBERED_RE.test(line)) {
      const ordered = NUMBERED_RE.test(line);
      const listType = ordered ? 'orderedList' : 'bulletList';
      const items: AdfNode[] = [];
      const itemRe = ordered ? NUMBERED_RE : BULLET_RE;

      while (i < lines.length) {
        const curr = lines[i] ?? '';
        const match = itemRe.exec(curr);
        if (!match) break;
        const itemText = match[2]!;
        items.push({
          type: 'listItem',
          content: [
            { type: 'paragraph', content: parseInline(itemText) },
          ],
        });
        i++;
      }
      content.push({ type: listType, content: items });
      continue;
    }

    const paragraphLines: string[] = [line];
    i++;
    while (i < lines.length) {
      const next = lines[i] ?? '';
      if (
        next.trim() === '' ||
        HEADING_RE.test(next) ||
        BULLET_RE.test(next) ||
        NUMBERED_RE.test(next) ||
        CODE_FENCE_RE.test(next) ||
        BLOCKQUOTE_RE.test(next) ||
        HR_RE.test(next) ||
        PANEL_RE.test(next)
      ) {
        break;
      }
      paragraphLines.push(next);
      i++;
    }
    content.push({
      type: 'paragraph',
      content: parseInline(paragraphLines.join(' ')),
    });
  }

  return { version: 1, type: 'doc', content };
}

function emptyParagraph(): AdfNode {
  return { type: 'paragraph', content: [] };
}

const INLINE_TOKEN_RE =
  /(\*\*([^*]+)\*\*)|(\*([^*]+)\*)|(__([^_]+)__)|(_([^_]+)_)|(~~([^~]+)~~)|(`([^`]+)`)|(\[([^\]]+)\]\(([^)]+)\))/;

function parseInline(text: string): AdfNode[] {
  if (!text) return [];
  const nodes: AdfNode[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    const match = INLINE_TOKEN_RE.exec(remaining);
    if (!match) {
      nodes.push({ type: 'text', text: remaining });
      break;
    }
    if (match.index > 0) {
      nodes.push({ type: 'text', text: remaining.slice(0, match.index) });
    }

    if (match[2] !== undefined) {
      nodes.push(markedText(match[2], [{ type: 'strong' }]));
    } else if (match[4] !== undefined) {
      nodes.push(markedText(match[4], [{ type: 'em' }]));
    } else if (match[6] !== undefined) {
      nodes.push(markedText(match[6], [{ type: 'strong' }]));
    } else if (match[8] !== undefined) {
      nodes.push(markedText(match[8], [{ type: 'em' }]));
    } else if (match[10] !== undefined) {
      nodes.push(markedText(match[10], [{ type: 'strike' }]));
    } else if (match[12] !== undefined) {
      nodes.push(markedText(match[12], [{ type: 'code' }]));
    } else if (match[14] !== undefined && match[15] !== undefined) {
      nodes.push(
        markedText(match[14], [
          { type: 'link', attrs: { href: match[15] } },
        ]),
      );
    }

    remaining = remaining.slice(match.index + match[0].length);
  }

  return nodes;
}

function markedText(
  text: string,
  marks: Array<{ type: string; attrs?: Record<string, unknown> }>,
): AdfNode {
  return { type: 'text', text, marks };
}
