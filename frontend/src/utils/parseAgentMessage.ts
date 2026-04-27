/**
 * Story 6.2 enhancement: parse `[label](todo://<uuid>)` markdown-link
 * references out of an assistant message's content, plus basic
 * markdown formatting:
 *
 *   Block:  `# h1`, `## h2`, `### h3`, `---` (horizontal rule),
 *           GFM tables (`| … |` rows + `|---|` separator)
 *   Inline: `**bold**`, `*italic*`, `` `code` ``
 *
 * The chat skill's system prompt (see backend/src/agent/system_prompt.py)
 * teaches the LLM to format any todo it names as
 * `[short label](todo://<uuid>)`. The LLM also routinely emits prose
 * markdown for emphasis and structure. Splitting both out at render
 * time lets us turn each reference into a hover/click target wired
 * to the pond store and render structure correctly, while leaving
 * the surrounding prose untouched.
 *
 * UUIDs use the canonical 8-4-4-4-12 hex form. The regex deliberately
 * captures the UUID exactly so we can pass it to `usePondStore` calls
 * verbatim — anything that doesn't look like a UUID falls through as
 * plain text rather than being silently dropped.
 *
 * The block-level pass runs first (line-aware), peeling off headings
 * and horizontal rules. Whatever remains is fed line-by-line back
 * into the inline-link + inline-emphasis tokenizer with newlines
 * preserved so `white-space: pre-wrap` on the chat bubble keeps
 * paragraph structure intact.
 */

export type CellAlignment = 'left' | 'center' | 'right';

export type AgentMessageSegment =
  | { kind: 'text'; text: string }
  | { kind: 'bold'; text: string }
  | { kind: 'italic'; text: string }
  | { kind: 'code'; text: string }
  | { kind: 'heading'; level: 1 | 2 | 3; text: string }
  | { kind: 'hr' }
  | { kind: 'todo-link'; label: string; todoId: string }
  | {
      kind: 'table';
      // Per-column alignment, one entry per header cell. `null` falls
      // back to the renderer default (left).
      alignments: (CellAlignment | null)[];
      // Inline-tokenized header / body cells. Pre-tokenizing at parse
      // time keeps the renderer dumb (it already knows how to render
      // AgentMessageSegment[]) and lets cell content carry todo-links
      // and inline emphasis.
      headers: AgentMessageSegment[][];
      rows: AgentMessageSegment[][][];
    };

const TODO_LINK_RE =
  /\[([^\]]+)\]\(todo:\/\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\)/gi;

// Block-level patterns. Both anchor on start-of-line and tolerate
// trailing whitespace so `## Title  ` and `---  ` still match.
const HR_RE = /^\s{0,3}-{3,}\s*$/;
const HEADING_RE = /^(#{1,3})\s+(.+?)\s*$/;

// GFM-style table row: starts with `|`, ends with `|`, with at least
// one cell. We require the trailing pipe — `|just text` is too easy
// to false-positive on user prose. Leading whitespace is allowed so
// the LLM can indent the table block visually in its prompt
// scratchpad without breaking the regex.
const TABLE_ROW_RE = /^\s*\|.*\|\s*$/;

// Separator-line shape: every cell is a run of `-` with optional
// `:` markers for alignment (`---`, `:---`, `---:`, `:---:`). The
// outer pipes are stripped before we test, so the regex operates on
// the inner cell sequence.
const TABLE_SEPARATOR_CELL_RE = /^:?-{1,}:?$/;

/**
 * Parse a separator line (e.g. `|:---|---:|:---:|`) into per-column
 * alignments. Returns null if the line isn't a valid separator —
 * caller treats the accumulated table-shaped lines as plain prose
 * in that case.
 */
function parseSeparatorAlignments(
  line: string,
): (CellAlignment | null)[] | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith('|') || !trimmed.endsWith('|')) return null;
  // Strip the outer pipes and split into cells. Empty cells (e.g. a
  // double `||`) reject the whole line as a separator.
  const inner = trimmed.slice(1, -1);
  const cells = inner.split('|').map((c) => c.trim());
  if (cells.length === 0 || cells.some((c) => c.length === 0)) return null;
  const alignments: (CellAlignment | null)[] = [];
  for (const cell of cells) {
    if (!TABLE_SEPARATOR_CELL_RE.test(cell)) return null;
    const left = cell.startsWith(':');
    const right = cell.endsWith(':');
    if (left && right) alignments.push('center');
    else if (right) alignments.push('right');
    else if (left) alignments.push('left');
    else alignments.push(null);
  }
  return alignments;
}

/** Split a table row into cell text. `| a | b |` → `["a", "b"]`. */
function splitTableRow(line: string): string[] {
  const trimmed = line.trim();
  // Both outer pipes are guaranteed by TABLE_ROW_RE; slice them off
  // before splitting on the inner pipes so leading/trailing empty
  // cells from the outer pipes don't appear in the result.
  const inner = trimmed.slice(1, -1);
  return inner.split('|').map((s) => s.trim());
}

/**
 * Walk one prose segment and emit inline-markdown segments. Priority
 * order on opener matching: `**` (bold) > `` ` `` (code) > `*`
 * (italic). The longer opener has to win so that `**bold**` isn't
 * mis-tokenized as `*` + `*bold*` + `*`. Each opener also requires a
 * matching closer on the SAME line — markdown emphasis spanning
 * paragraphs is rare and almost always indicates an unclosed
 * marker the LLM forgot to terminate; treating it as plain text
 * keeps the bubble readable instead of swallowing the rest of the
 * message into one giant emphasis run.
 *
 * Streaming-friendly: an opener with no closer found in the current
 * content (because the closer hasn't arrived yet) falls through as
 * plain text. The next chunk that brings the closer will re-render
 * the full segment correctly.
 */
function tokenizeInlineMarkdown(text: string): AgentMessageSegment[] {
  const out: AgentMessageSegment[] = [];
  let buffer = '';
  const flushBuffer = () => {
    if (buffer.length > 0) {
      out.push({ kind: 'text', text: buffer });
      buffer = '';
    }
  };

  let i = 0;
  while (i < text.length) {
    if (text.startsWith('**', i)) {
      const close = findInlineCloser(text, '**', i + 2);
      if (close !== -1) {
        flushBuffer();
        out.push({ kind: 'bold', text: text.slice(i + 2, close) });
        i = close + 2;
        continue;
      }
    }
    if (text[i] === '`') {
      const close = findInlineCloser(text, '`', i + 1);
      if (close !== -1) {
        flushBuffer();
        out.push({ kind: 'code', text: text.slice(i + 1, close) });
        i = close + 1;
        continue;
      }
    }
    if (
      text[i] === '*' &&
      text[i - 1] !== '*' &&
      text[i + 1] !== '*' &&
      isWordBoundaryBefore(text, i)
    ) {
      const close = findInlineCloser(text, '*', i + 1);
      if (close !== -1 && text[close + 1] !== '*' && text[close - 1] !== '*') {
        flushBuffer();
        out.push({ kind: 'italic', text: text.slice(i + 1, close) });
        i = close + 1;
        continue;
      }
    }
    buffer += text[i];
    i++;
  }
  flushBuffer();
  return out;
}

function findInlineCloser(text: string, marker: string, from: number): number {
  for (let i = from; i < text.length; i++) {
    if (text[i] === '\n') return -1;
    if (text.startsWith(marker, i)) return i;
  }
  return -1;
}

function isWordBoundaryBefore(text: string, i: number): boolean {
  if (i === 0) return true;
  const prev = text[i - 1];
  return /[\s(\[{<"',.;:!?]/.test(prev);
}

/**
 * Run the inline-link + inline-emphasis tokenizer on a prose run
 * (potentially multi-line). Used by `parseAgentMessage` after the
 * block-level pre-pass has peeled off headings and horizontal rules.
 */
function parseProse(content: string): AgentMessageSegment[] {
  const segments: AgentMessageSegment[] = [];
  let cursor = 0;

  // First pass: extract todo-link references, leaving the prose
  // between them as raw text. Keeping link extraction simple (no
  // escaping) lets the inline-emphasis tokenizer operate on plain
  // prose without worrying about overlapping delimiters inside
  // link labels.
  for (const match of content.matchAll(TODO_LINK_RE)) {
    const start = match.index ?? 0;
    if (start > cursor) {
      segments.push(...tokenizeInlineMarkdown(content.slice(cursor, start)));
    }
    segments.push({
      kind: 'todo-link',
      label: match[1],
      todoId: match[2].toLowerCase(),
    });
    cursor = start + match[0].length;
  }

  if (cursor < content.length) {
    segments.push(...tokenizeInlineMarkdown(content.slice(cursor)));
  }

  return segments;
}

export function parseAgentMessage(content: string): AgentMessageSegment[] {
  if (!content) return [];
  const segments: AgentMessageSegment[] = [];

  // Block-level pre-pass: split on newlines so we can peel off
  // headings (`#`/`##`/`###`), horizontal rules (`---`), and GFM
  // tables before running inline tokenization on the rest. Adjacent
  // non-block lines accumulate into a single prose run so the
  // existing inline tokenizer sees a multi-line buffer (necessary
  // for line-spanning text segments to render with their newlines
  // intact under `white-space: pre-wrap`).
  const lines = content.split('\n');
  let proseAcc: string[] = [];
  // Table accumulator — gathers consecutive `| … |`-shaped lines.
  // When a non-table line breaks the run (or content ends), we
  // attempt to interpret the accumulated lines as a table; on any
  // shape failure we put them back into the prose stream so the
  // raw markdown still renders something. Streaming-aware: a
  // partial table (just a header, or header + separator with no
  // body) falls back to prose until the next chunk completes the
  // block, at which point a fresh re-parse promotes it to a table.
  let tableAcc: string[] = [];
  const flushProse = () => {
    if (proseAcc.length === 0) return;
    segments.push(...parseProse(proseAcc.join('\n')));
    proseAcc = [];
  };
  const flushTable = () => {
    if (tableAcc.length === 0) return;
    // Need at least header + separator + one body row.
    if (tableAcc.length < 3) {
      proseAcc.push(...tableAcc);
      tableAcc = [];
      return;
    }
    const alignments = parseSeparatorAlignments(tableAcc[1]);
    if (alignments === null) {
      // Not a real table — second line wasn't a valid separator.
      // Fall back to plain prose so the user still sees their
      // pipe-bracketed text.
      proseAcc.push(...tableAcc);
      tableAcc = [];
      return;
    }
    const headers = splitTableRow(tableAcc[0]).map((cell) => parseProse(cell));
    const rows = tableAcc
      .slice(2)
      .map((line) => splitTableRow(line).map((cell) => parseProse(cell)));
    flushProse();
    segments.push({ kind: 'table', alignments, headers, rows });
    tableAcc = [];
  };

  for (const line of lines) {
    if (TABLE_ROW_RE.test(line)) {
      tableAcc.push(line);
      continue;
    }
    // Non-table line — drain any pending table block first.
    flushTable();
    if (HR_RE.test(line)) {
      flushProse();
      segments.push({ kind: 'hr' });
      continue;
    }
    const headingMatch = HEADING_RE.exec(line);
    if (headingMatch) {
      flushProse();
      const level = headingMatch[1].length as 1 | 2 | 3;
      segments.push({ kind: 'heading', level, text: headingMatch[2] });
      continue;
    }
    proseAcc.push(line);
  }
  // End of input: flush any pending table (treat EOF as a
  // terminator), then prose.
  flushTable();
  flushProse();

  return segments;
}
