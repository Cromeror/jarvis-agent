export interface AdfMark {
  type: string;
  attrs?: Record<string, unknown>;
}

export interface AdfNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: AdfNode[];
  marks?: AdfMark[];
  text?: string;
}

export interface AdfDoc {
  version: 1;
  type: 'doc';
  content: AdfNode[];
}

const PANEL_RE = /^:::\s*(info|warning|error|success|note)\s*$/;
const EXPAND_RE = /^:::\s*expand(?:\s+(.+))?\s*$/;
const FENCE_END_RE = /^:::\s*$/;
const HEADING_RE = /^(#{1,6})\s+(.*)$/;
const BULLET_RE = /^(\s*)[-*]\s+(.*)$/;
const NUMBERED_RE = /^(\s*)\d+\.\s+(.*)$/;
const CODE_FENCE_RE = /^```(\w*)\s*$/;
const BLOCKQUOTE_RE = /^>\s?(.*)$/;
const HR_RE = /^[-*_]{3,}\s*$/;
const TABLE_ROW_RE = /^\|.*\|\s*$/;
const TABLE_ALIGN_RE = /^\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

const PANEL_TYPE_MAP: Record<string, string> = {
  info: 'info',
  warning: 'warning',
  error: 'error',
  success: 'success',
  note: 'note',
};

const STATUS_COLORS = new Set(['neutral', 'purple', 'blue', 'red', 'yellow', 'green']);

const HEX_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

const MARK_INCOMPATIBLE: Record<string, Set<string>> = {
  code: new Set(['textColor', 'backgroundColor', 'link']),
  link: new Set(['code']),
  textColor: new Set(['code']),
  backgroundColor: new Set(['code']),
};

export function markdownToAdf(markdown: string): AdfDoc {
  const content = parseBlocks(markdown);
  return { version: 1, type: 'doc', content };
}

function parseBlocks(markdown: string): AdfNode[] {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const content: AdfNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i] ?? '';

    if (line.trim() === '') {
      i++;
      continue;
    }

    // :::expand Título ... :::
    const expandMatch = EXPAND_RE.exec(line);
    if (expandMatch) {
      const title = (expandMatch[1] ?? '').trim() || 'Details';
      const inner: string[] = [];
      i++;
      while (i < lines.length && !FENCE_END_RE.test(lines[i] ?? '')) {
        inner.push(lines[i] ?? '');
        i++;
      }
      if (i < lines.length) i++;
      const innerNodes = parseBlocks(inner.join('\n'));
      content.push({
        type: 'expand',
        attrs: { title },
        content: innerNodes.length > 0 ? innerNodes : [emptyParagraph()],
      });
      continue;
    }

    // :::info|warning|error|success|note ... :::
    const panelMatch = PANEL_RE.exec(line);
    if (panelMatch) {
      const panelType = PANEL_TYPE_MAP[panelMatch[1]!] ?? 'info';
      const inner: string[] = [];
      i++;
      while (i < lines.length && !FENCE_END_RE.test(lines[i] ?? '')) {
        inner.push(lines[i] ?? '');
        i++;
      }
      if (i < lines.length) i++;
      const innerNodes = parseBlocks(inner.join('\n'));
      content.push({
        type: 'panel',
        attrs: { panelType },
        content:
          innerNodes.length > 0
            ? stripMarksInPanelChildren(innerNodes)
            : [emptyParagraph()],
      });
      continue;
    }

    // ```lang ... ```
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
      const inner = parseBlocks(quoteLines.join('\n'));
      content.push({
        type: 'blockquote',
        content: inner.length > 0 ? inner : [emptyParagraph()],
      });
      continue;
    }

    // Table: two consecutive TABLE_ROW_RE lines where the 2nd is the align row
    if (TABLE_ROW_RE.test(line) && i + 1 < lines.length && TABLE_ALIGN_RE.test(lines[i + 1] ?? '')) {
      const tableLines: string[] = [];
      while (i < lines.length && TABLE_ROW_RE.test(lines[i] ?? '')) {
        tableLines.push(lines[i] ?? '');
        i++;
      }
      // Skip align row (second element)
      const headerLine = tableLines[0]!;
      const bodyLines = tableLines.slice(2);
      content.push(parseTable(headerLine, bodyLines));
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
          content: [{ type: 'paragraph', content: parseInline(itemText) }],
        });
        i++;
      }
      content.push({ type: listType, content: items });
      continue;
    }

    // Paragraph (default)
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
        PANEL_RE.test(next) ||
        EXPAND_RE.test(next) ||
        TABLE_ROW_RE.test(next)
      ) {
        break;
      }
      paragraphLines.push(next);
      i++;
    }
    content.push({
      type: 'paragraph',
      content: parseInline(paragraphLines.join('\n')),
    });
  }

  return content;
}

function parseTable(headerLine: string, bodyLines: string[]): AdfNode {
  const headers = splitTableRow(headerLine);
  const rows: AdfNode[] = [];

  const headerRow: AdfNode = {
    type: 'tableRow',
    content: headers.map((h) => ({
      type: 'tableHeader',
      attrs: {},
      content: [{ type: 'paragraph', content: parseInline(h.text) }],
    })),
  };
  rows.push(headerRow);

  for (const bodyLine of bodyLines) {
    const cells = splitTableRow(bodyLine);
    const rowCells: AdfNode[] = cells.map((c) => {
      const attrs: Record<string, unknown> = {};
      if (c.background) attrs.background = c.background;
      return {
        type: 'tableCell',
        attrs,
        content: [{ type: 'paragraph', content: parseInline(c.text) }],
      };
    });
    rows.push({ type: 'tableRow', content: rowCells });
  }

  return {
    type: 'table',
    attrs: { isNumberColumnEnabled: false, layout: 'center' },
    content: rows,
  };
}

interface TableCellParsed {
  text: string;
  background?: string;
}

function splitTableRow(line: string): TableCellParsed[] {
  // Strip leading/trailing pipes, then split by unescaped pipe
  let trimmed = line.trim();
  if (trimmed.startsWith('|')) trimmed = trimmed.slice(1);
  if (trimmed.endsWith('|')) trimmed = trimmed.slice(0, -1);

  // Split on `|` not preceded by `\`
  const parts: string[] = [];
  let current = '';
  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed[i];
    const prev = trimmed[i - 1];
    if (ch === '|' && prev !== '\\') {
      parts.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  parts.push(current);

  return parts.map((raw) => {
    let text = raw.trim().replace(/\\\|/g, '|');
    let background: string | undefined;
    // Extract {bg:#hex} prefix from cell content if present
    const bgMatch = /^\{bg:(#[0-9a-fA-F]{3,6})\}(.*)$/s.exec(text);
    if (bgMatch) {
      background = bgMatch[1];
      text = bgMatch[2]!.trim();
    }
    return { text, background };
  });
}

function emptyParagraph(): AdfNode {
  return { type: 'paragraph', content: [] };
}

// ---------------------------------------------------------------------------
// Inline parsing (recursive-descent over tokens)
// ---------------------------------------------------------------------------

type InlineToken =
  | { kind: 'text'; value: string }
  | { kind: 'strong'; inner: InlineToken[] }
  | { kind: 'em'; inner: InlineToken[] }
  | { kind: 'underline'; inner: InlineToken[] }
  | { kind: 'strike'; inner: InlineToken[] }
  | { kind: 'code'; value: string }
  | { kind: 'link'; text: string; href: string }
  | { kind: 'textColor'; color: string; inner: InlineToken[] }
  | { kind: 'backgroundColor'; color: string; inner: InlineToken[] }
  | { kind: 'sub'; inner: InlineToken[] }
  | { kind: 'sup'; inner: InlineToken[] }
  | { kind: 'status'; text: string; color: string }
  | { kind: 'emoji'; shortName: string }
  | { kind: 'hardBreak' };

function parseInline(text: string): AdfNode[] {
  if (!text) return [];
  const tokens = tokenizeInline(text);
  return tokensToNodes(tokens, []);
}

function tokenizeInline(text: string): InlineToken[] {
  const tokens: InlineToken[] = [];
  let i = 0;
  let buffer = '';

  const flushBuffer = () => {
    if (buffer.length > 0) {
      tokens.push({ kind: 'text', value: buffer });
      buffer = '';
    }
  };

  while (i < text.length) {
    const rest = text.slice(i);

    // Hard break: "\\" at EOL or "  \n"
    if (rest.startsWith('\\\\')) {
      flushBuffer();
      tokens.push({ kind: 'hardBreak' });
      i += 2;
      continue;
    }
    if (rest.startsWith('  \n')) {
      flushBuffer();
      tokens.push({ kind: 'hardBreak' });
      i += 3;
      continue;
    }
    if (rest.startsWith('\n')) {
      // Soft break → convert to space in the same paragraph
      buffer += ' ';
      i += 1;
      continue;
    }

    // Inline code: `...`
    if (rest.startsWith('`')) {
      const end = rest.indexOf('`', 1);
      if (end > 0) {
        flushBuffer();
        tokens.push({ kind: 'code', value: rest.slice(1, end) });
        i += end + 1;
        continue;
      }
    }

    // Strong: ** ... ** or __ ... __
    if (rest.startsWith('**')) {
      const end = rest.indexOf('**', 2);
      if (end > 0) {
        flushBuffer();
        tokens.push({ kind: 'strong', inner: tokenizeInline(rest.slice(2, end)) });
        i += end + 2;
        continue;
      }
    }
    if (rest.startsWith('__')) {
      const end = rest.indexOf('__', 2);
      if (end > 0) {
        flushBuffer();
        tokens.push({ kind: 'strong', inner: tokenizeInline(rest.slice(2, end)) });
        i += end + 2;
        continue;
      }
    }

    // Underline: ++ ... ++
    if (rest.startsWith('++')) {
      const end = rest.indexOf('++', 2);
      if (end > 0) {
        flushBuffer();
        tokens.push({ kind: 'underline', inner: tokenizeInline(rest.slice(2, end)) });
        i += end + 2;
        continue;
      }
    }

    // Strike: ~~ ... ~~
    if (rest.startsWith('~~')) {
      const end = rest.indexOf('~~', 2);
      if (end > 0) {
        flushBuffer();
        tokens.push({ kind: 'strike', inner: tokenizeInline(rest.slice(2, end)) });
        i += end + 2;
        continue;
      }
    }

    // Subscript: ~ ... ~   (avoid matching ~~)
    if (rest.startsWith('~') && !rest.startsWith('~~')) {
      const end = rest.indexOf('~', 1);
      if (end > 0 && !rest.slice(1, end).includes(' ')) {
        flushBuffer();
        tokens.push({ kind: 'sub', inner: tokenizeInline(rest.slice(1, end)) });
        i += end + 1;
        continue;
      }
    }

    // Superscript: ^ ... ^
    if (rest.startsWith('^')) {
      const end = rest.indexOf('^', 1);
      if (end > 0 && !rest.slice(1, end).includes(' ')) {
        flushBuffer();
        tokens.push({ kind: 'sup', inner: tokenizeInline(rest.slice(1, end)) });
        i += end + 1;
        continue;
      }
    }

    // Em: * ... *  or _ ... _
    if (rest.startsWith('*') && !rest.startsWith('**')) {
      const end = rest.indexOf('*', 1);
      if (end > 0) {
        flushBuffer();
        tokens.push({ kind: 'em', inner: tokenizeInline(rest.slice(1, end)) });
        i += end + 1;
        continue;
      }
    }
    if (rest.startsWith('_') && !rest.startsWith('__')) {
      const end = rest.indexOf('_', 1);
      if (end > 0) {
        flushBuffer();
        tokens.push({ kind: 'em', inner: tokenizeInline(rest.slice(1, end)) });
        i += end + 1;
        continue;
      }
    }

    // Link: [text](url)
    if (rest.startsWith('[')) {
      const linkMatch = /^\[([^\]]+)\]\(([^)]+)\)/.exec(rest);
      if (linkMatch) {
        flushBuffer();
        tokens.push({ kind: 'link', text: linkMatch[1]!, href: linkMatch[2]! });
        i += linkMatch[0].length;
        continue;
      }
    }

    // {color:#hex}text{/color}
    if (rest.startsWith('{color:')) {
      const m = /^\{color:(#[0-9a-fA-F]{3,6})\}([\s\S]*?)\{\/color\}/.exec(rest);
      if (m && HEX_RE.test(m[1]!)) {
        flushBuffer();
        tokens.push({ kind: 'textColor', color: m[1]!, inner: tokenizeInline(m[2]!) });
        i += m[0].length;
        continue;
      }
    }

    // {bg:#hex}text{/bg}
    if (rest.startsWith('{bg:')) {
      const m = /^\{bg:(#[0-9a-fA-F]{3,6})\}([\s\S]*?)\{\/bg\}/.exec(rest);
      if (m && HEX_RE.test(m[1]!)) {
        flushBuffer();
        tokens.push({ kind: 'backgroundColor', color: m[1]!, inner: tokenizeInline(m[2]!) });
        i += m[0].length;
        continue;
      }
    }

    // {status:color|text}
    if (rest.startsWith('{status:')) {
      const m = /^\{status:([a-z]+)\|([^}]+)\}/.exec(rest);
      if (m) {
        const color = STATUS_COLORS.has(m[1]!) ? m[1]! : 'neutral';
        flushBuffer();
        tokens.push({ kind: 'status', text: m[2]!, color });
        i += m[0].length;
        continue;
      }
    }

    // :shortname:  (emoji node)
    if (rest.startsWith(':')) {
      const m = /^:([a-z0-9_+-]+):/i.exec(rest);
      if (m) {
        flushBuffer();
        tokens.push({ kind: 'emoji', shortName: `:${m[1]!}:` });
        i += m[0].length;
        continue;
      }
    }

    buffer += text[i];
    i++;
  }

  flushBuffer();
  return tokens;
}

function tokensToNodes(tokens: InlineToken[], activeMarks: AdfMark[]): AdfNode[] {
  const out: AdfNode[] = [];
  for (const tok of tokens) {
    switch (tok.kind) {
      case 'text':
        out.push(applyMarks({ type: 'text', text: tok.value }, activeMarks));
        break;
      case 'hardBreak':
        out.push({ type: 'hardBreak' });
        break;
      case 'code':
        out.push(applyMarks({ type: 'text', text: tok.value }, mergeMarks(activeMarks, [{ type: 'code' }])));
        break;
      case 'link': {
        const linkMark: AdfMark = { type: 'link', attrs: { href: tok.href } };
        out.push(applyMarks({ type: 'text', text: tok.text }, mergeMarks(activeMarks, [linkMark])));
        break;
      }
      case 'strong':
      case 'em':
      case 'underline':
      case 'strike': {
        const markType =
          tok.kind === 'strong' ? 'strong' : tok.kind === 'em' ? 'em' : tok.kind === 'underline' ? 'underline' : 'strike';
        const nested = tokensToNodes(tok.inner, mergeMarks(activeMarks, [{ type: markType }]));
        out.push(...nested);
        break;
      }
      case 'sub':
      case 'sup': {
        const nested = tokensToNodes(
          tok.inner,
          mergeMarks(activeMarks, [{ type: 'subsup', attrs: { type: tok.kind } }]),
        );
        out.push(...nested);
        break;
      }
      case 'textColor': {
        const nested = tokensToNodes(
          tok.inner,
          mergeMarks(activeMarks, [{ type: 'textColor', attrs: { color: tok.color } }]),
        );
        out.push(...nested);
        break;
      }
      case 'backgroundColor': {
        const nested = tokensToNodes(
          tok.inner,
          mergeMarks(activeMarks, [{ type: 'backgroundColor', attrs: { color: tok.color } }]),
        );
        out.push(...nested);
        break;
      }
      case 'status':
        out.push({
          type: 'status',
          attrs: { text: tok.text, color: tok.color },
        });
        break;
      case 'emoji':
        out.push({
          type: 'emoji',
          attrs: { shortName: tok.shortName },
        });
        break;
    }
  }
  return out;
}

function applyMarks(node: AdfNode, marks: AdfMark[]): AdfNode {
  if (marks.length === 0) return node;
  return { ...node, marks };
}

function mergeMarks(existing: AdfMark[], incoming: AdfMark[]): AdfMark[] {
  const result = [...existing];
  for (const mark of incoming) {
    // Drop incoming if incompatible with any existing
    const incomp = MARK_INCOMPATIBLE[mark.type];
    if (incomp) {
      const conflict = result.some((m) => incomp.has(m.type));
      if (conflict) continue;
    }
    // Drop existing that are incompatible with this new mark
    for (let k = result.length - 1; k >= 0; k--) {
      const existingIncomp = MARK_INCOMPATIBLE[result[k]!.type];
      if (existingIncomp?.has(mark.type)) {
        result.splice(k, 1);
      }
    }
    // Avoid duplicates
    if (!result.some((m) => m.type === mark.type && JSON.stringify(m.attrs) === JSON.stringify(mark.attrs))) {
      result.push(mark);
    }
  }
  return result;
}

function stripMarksInPanelChildren(nodes: AdfNode[]): AdfNode[] {
  // Per ADF spec, `heading` and `paragraph` inside `panel` cannot carry marks
  // on their TEXT children. We walk one level deep.
  return nodes.map((n) => {
    if ((n.type === 'heading' || n.type === 'paragraph') && n.content) {
      return {
        ...n,
        content: n.content.map((c) =>
          c.type === 'text' ? { type: 'text', text: c.text ?? '' } : c,
        ),
      };
    }
    return n;
  });
}
