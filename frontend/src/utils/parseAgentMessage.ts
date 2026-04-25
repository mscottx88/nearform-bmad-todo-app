/**
 * Story 6.2 enhancement: parse `[label](todo://<uuid>)` markdown-link
 * references out of an assistant message's content, plus basic
 * markdown formatting:
 *
 *   Block:  `# h1`, `## h2`, `### h3`, `---` (horizontal rule)
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

export type AgentMessageSegment =
  | { kind: 'text'; text: string }
  | { kind: 'bold'; text: string }
  | { kind: 'italic'; text: string }
  | { kind: 'code'; text: string }
  | { kind: 'heading'; level: 1 | 2 | 3; text: string }
  | { kind: 'hr' }
  | { kind: 'todo-link'; label: string; todoId: string };

const TODO_LINK_RE =
  /\[([^\]]+)\]\(todo:\/\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\)/gi;

// Block-level patterns. Both anchor on start-of-line and tolerate
// trailing whitespace so `## Title  ` and `---  ` still match.
const HR_RE = /^\s{0,3}-{3,}\s*$/;
const HEADING_RE = /^(#{1,3})\s+(.+?)\s*$/;

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
  // headings (`#`/`##`/`###`) and horizontal rules (`---`) before
  // running inline tokenization on the rest. Adjacent non-block
  // lines accumulate into a single prose run so the existing
  // inline tokenizer sees a multi-line buffer (necessary for
  // line-spanning text segments to render with their newlines
  // intact under `white-space: pre-wrap`).
  const lines = content.split('\n');
  let proseAcc: string[] = [];
  const flushProse = () => {
    if (proseAcc.length === 0) return;
    segments.push(...parseProse(proseAcc.join('\n')));
    proseAcc = [];
  };

  for (const line of lines) {
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
  flushProse();

  return segments;
}
