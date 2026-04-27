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

/** Skills the chat skill is allowed to suggest via the
 *  `agent://<skill>?msg=…` link convention. Narrowing here mirrors
 *  the Pydantic `Literal` allowlist on `SuggestedAction.skill`
 *  (story 6.12) — keeps the LLM from dragging the user into a skill
 *  that isn't actually wired up. */
export const AGENT_ACTION_SKILLS = ['rephrase', 'create_todo'] as const;
export type AgentActionSkill = (typeof AGENT_ACTION_SKILLS)[number];

export type AgentMessageSegment =
  | { kind: 'text'; text: string }
  | { kind: 'bold'; text: string }
  | { kind: 'italic'; text: string }
  | { kind: 'code'; text: string }
  | { kind: 'heading'; level: 1 | 2 | 3; text: string }
  | { kind: 'hr' }
  | { kind: 'todo-link'; label: string; todoId: string }
  | {
      kind: 'agent-action';
      label: string;
      skill: AgentActionSkill;
      /** The prefilled message that becomes the next user turn's
       *  `content` if the user clicks the chip. URL-decoded from the
       *  link's `msg=` parameter at parse time so the renderer
       *  doesn't need to decode again. */
      message: string;
    }
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

// `[label](agent://<skill>?msg=<urlencoded message>)` — sibling of
// the todo-link convention for inline action suggestions. The chat
// skill emits these whenever it offers a follow-up the user can
// just click instead of typing. The skill name is restricted via
// `AGENT_ACTION_SKILLS`; anything else falls through as plain text.
//
// `msg=` payloads can include URL-encoded spaces (`+` or `%20`) and
// multi-sentence content; the regex consumes everything up to the
// closing `)` of the link form. Decoding happens at parse time.
const AGENT_ACTION_RE =
  /\[([^\]]+)\]\(agent:\/\/([a-z_]+)\?msg=([^)]*)\)/gi;

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

  // Collect all link-matches from BOTH conventions (todo:// and
  // agent://) with their start index, then walk them in document
  // order. A single pass would only honour one convention's
  // priority, but the LLM can interleave them ("[Park todo](todo://)
  // — [Rephrase](agent://rephrase?msg=…)"). Sorted-and-walked is
  // O(n log n) but n is small (one chat reply has ≤ a handful of
  // links each). Anything not part of a link falls through to the
  // inline-emphasis tokenizer as raw prose.
  type LinkHit =
    | {
        kind: 'todo';
        index: number;
        length: number;
        label: string;
        uuid: string;
      }
    | {
        kind: 'agent';
        index: number;
        length: number;
        label: string;
        skill: AgentActionSkill;
        msg: string;
      };
  const hits: LinkHit[] = [];

  for (const m of content.matchAll(TODO_LINK_RE)) {
    hits.push({
      kind: 'todo',
      index: m.index ?? 0,
      length: m[0].length,
      label: m[1],
      uuid: m[2].toLowerCase(),
    });
  }
  for (const m of content.matchAll(AGENT_ACTION_RE)) {
    const skill = m[2];
    if (!(AGENT_ACTION_SKILLS as readonly string[]).includes(skill)) {
      // Skill outside the allowlist — ignore the match so the link
      // form falls through as plain text. Mirrors the Pydantic
      // `Literal` allowlist on the backend (story 6.12).
      continue;
    }
    let decodedMsg: string;
    try {
      // `+` is the historic URL-encoding for spaces in query
      // strings; `decodeURIComponent` handles `%20` but not `+`,
      // so normalise first.
      decodedMsg = decodeURIComponent(m[3].replace(/\+/g, ' '));
    } catch {
      // Malformed `%`-encoding — skip the match so it falls
      // through as plain text rather than crashing the parse.
      continue;
    }
    hits.push({
      kind: 'agent',
      index: m.index ?? 0,
      length: m[0].length,
      label: m[1],
      skill: skill as AgentActionSkill,
      msg: decodedMsg,
    });
  }
  hits.sort((a, b) => a.index - b.index);

  let cursor = 0;
  for (const hit of hits) {
    // Overlap guard: if a later match starts inside an earlier one
    // (LLM produced a malformed nested form), skip the later.
    if (hit.index < cursor) continue;
    if (hit.index > cursor) {
      segments.push(
        ...tokenizeInlineMarkdown(content.slice(cursor, hit.index)),
      );
    }
    if (hit.kind === 'todo') {
      segments.push({
        kind: 'todo-link',
        label: hit.label,
        todoId: hit.uuid,
      });
    } else {
      segments.push({
        kind: 'agent-action',
        label: hit.label,
        skill: hit.skill,
        message: hit.msg,
      });
    }
    cursor = hit.index + hit.length;
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
