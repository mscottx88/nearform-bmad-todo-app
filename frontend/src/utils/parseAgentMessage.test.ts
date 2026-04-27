import { describe, it, expect } from 'vitest';
import { parseAgentMessage } from './parseAgentMessage';

const UUID_A = '3f9a2b1c-1234-4567-89ab-cdef01234567';
const UUID_B = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

describe('parseAgentMessage', () => {
  it('returns an empty array for empty content', () => {
    expect(parseAgentMessage('')).toEqual([]);
  });

  it('returns a single text segment when there are no todo links', () => {
    expect(parseAgentMessage('hello world')).toEqual([
      { kind: 'text', text: 'hello world' },
    ]);
  });

  it('extracts a single todo-link reference', () => {
    const result = parseAgentMessage(
      `Don't forget [pick up milk](todo://${UUID_A}) before the weekend.`,
    );
    expect(result).toEqual([
      { kind: 'text', text: "Don't forget " },
      { kind: 'todo-link', label: 'pick up milk', todoId: UUID_A },
      { kind: 'text', text: ' before the weekend.' },
    ]);
  });

  it('extracts multiple todo-link references in order', () => {
    const result = parseAgentMessage(
      `[milk](todo://${UUID_A}) and [bread](todo://${UUID_B})`,
    );
    expect(result.map((s) => s.kind)).toEqual([
      'todo-link',
      'text',
      'todo-link',
    ]);
    if (result[0].kind !== 'todo-link') throw new Error('first should be link');
    expect(result[0].todoId).toBe(UUID_A);
    if (result[2].kind !== 'todo-link') throw new Error('third should be link');
    expect(result[2].todoId).toBe(UUID_B);
  });

  it('lowercases the captured UUID', () => {
    const upper = UUID_A.toUpperCase();
    const result = parseAgentMessage(`[x](todo://${upper})`);
    expect(result).toEqual([
      { kind: 'todo-link', label: 'x', todoId: UUID_A },
    ]);
  });

  it('ignores links with the wrong scheme', () => {
    expect(parseAgentMessage('[a](https://example.com)')).toEqual([
      { kind: 'text', text: '[a](https://example.com)' },
    ]);
  });

  it('ignores malformed UUIDs', () => {
    expect(parseAgentMessage('[a](todo://not-a-uuid)')).toEqual([
      { kind: 'text', text: '[a](todo://not-a-uuid)' },
    ]);
  });

  it('preserves text before the first link', () => {
    const result = parseAgentMessage(`prefix [a](todo://${UUID_A})`);
    expect(result[0]).toEqual({ kind: 'text', text: 'prefix ' });
  });

  it('preserves text after the last link', () => {
    const result = parseAgentMessage(`[a](todo://${UUID_A}) suffix`);
    expect(result[result.length - 1]).toEqual({ kind: 'text', text: ' suffix' });
  });

  // Story 6.2 Group B post-CR polish: basic inline markdown.
  describe('inline markdown', () => {
    it('renders **bold** as a bold segment', () => {
      expect(parseAgentMessage('try the **Computer Backup** first')).toEqual([
        { kind: 'text', text: 'try the ' },
        { kind: 'bold', text: 'Computer Backup' },
        { kind: 'text', text: ' first' },
      ]);
    });

    it('renders *italic* as an italic segment', () => {
      expect(parseAgentMessage('use *concise* labels')).toEqual([
        { kind: 'text', text: 'use ' },
        { kind: 'italic', text: 'concise' },
        { kind: 'text', text: ' labels' },
      ]);
    });

    it('renders `code` as an inline-code segment', () => {
      expect(parseAgentMessage('look at `crew_runner.py` line 42')).toEqual([
        { kind: 'text', text: 'look at ' },
        { kind: 'code', text: 'crew_runner.py' },
        { kind: 'text', text: ' line 42' },
      ]);
    });

    it('does not split **bold** into mismatched italic markers', () => {
      // Without the bold-first priority, this would mis-tokenize as
      // italic + plain + italic.
      const result = parseAgentMessage('**Pro Tip:**');
      expect(result).toEqual([{ kind: 'bold', text: 'Pro Tip:' }]);
    });

    it('handles bold-then-todo-link mixed content', () => {
      const result = parseAgentMessage(
        `**Laundry** — batch with [folding](todo://${UUID_A}).`,
      );
      expect(result).toEqual([
        { kind: 'bold', text: 'Laundry' },
        { kind: 'text', text: ' — batch with ' },
        { kind: 'todo-link', label: 'folding', todoId: UUID_A },
        { kind: 'text', text: '.' },
      ]);
    });

    it('falls through unclosed **bold opener as plain text', () => {
      // While streaming, a half-arrived `**foo` should NOT swallow
      // the rest of the bubble. Returns plain text until the closer
      // arrives in a subsequent chunk.
      expect(parseAgentMessage('halfway **through the')).toEqual([
        { kind: 'text', text: 'halfway **through the' },
      ]);
    });

    it('does not italicise mid-word arithmetic asterisks', () => {
      // `a*b*c` (typical arithmetic) must NOT render as `a` + italic
      // `b` + `c`. The word-boundary guard on the italic opener
      // requires whitespace/punctuation before the leading `*`.
      expect(parseAgentMessage('result is a*b*c here')).toEqual([
        { kind: 'text', text: 'result is a*b*c here' },
      ]);
    });

    it('renders multiple bold spans on the same line', () => {
      expect(parseAgentMessage('**A** and **B**')).toEqual([
        { kind: 'bold', text: 'A' },
        { kind: 'text', text: ' and ' },
        { kind: 'bold', text: 'B' },
      ]);
    });

    it('aborts an inline opener that crosses a newline', () => {
      // An opener-without-closer-on-same-line falls through as plain
      // text — emphasis spanning paragraphs almost always means the
      // LLM forgot to close, and treating it literally keeps the
      // bubble readable.
      expect(parseAgentMessage('start **bold\nnext line ends here**')).toEqual([
        { kind: 'text', text: 'start **bold\nnext line ends here**' },
      ]);
    });
  });

  // Story 6.2 Group B post-CR polish: block-level markdown.
  describe('block-level markdown', () => {
    it('renders `# Title` as an h1 heading', () => {
      expect(parseAgentMessage('# Pro Tip')).toEqual([
        { kind: 'heading', level: 1, text: 'Pro Tip' },
      ]);
    });

    it('renders `## Title` as an h2 heading', () => {
      expect(parseAgentMessage('## Computer Backups')).toEqual([
        { kind: 'heading', level: 2, text: 'Computer Backups' },
      ]);
    });

    it('renders `### Title` as an h3 heading', () => {
      expect(parseAgentMessage('### Sub-section')).toEqual([
        { kind: 'heading', level: 3, text: 'Sub-section' },
      ]);
    });

    it('renders `---` on its own line as a horizontal rule', () => {
      expect(parseAgentMessage('---')).toEqual([{ kind: 'hr' }]);
    });

    it('tolerates trailing whitespace and longer dash runs in `---`', () => {
      expect(parseAgentMessage('-----  ')).toEqual([{ kind: 'hr' }]);
    });

    it('does NOT render `####` (4 hashes) as a heading', () => {
      // Only h1-h3 are supported; `####` should fall through as
      // plain text rather than rendering as h4 (which we don't
      // style) or being silently dropped.
      expect(parseAgentMessage('#### Too deep')).toEqual([
        { kind: 'text', text: '#### Too deep' },
      ]);
    });

    it('does NOT render `#hashtag` (no space) as a heading', () => {
      // Heading requires a space after the `#` markers, otherwise
      // an inline `#hashtag` would be eaten.
      expect(parseAgentMessage('use #hashtag here')).toEqual([
        { kind: 'text', text: 'use #hashtag here' },
      ]);
    });

    it('mixes block headings with inline-formatted prose', () => {
      const content = `## Tasks
Use **automated backup** software.
---
That's the plan.`;
      const result = parseAgentMessage(content);
      expect(result).toEqual([
        { kind: 'heading', level: 2, text: 'Tasks' },
        { kind: 'text', text: 'Use ' },
        { kind: 'bold', text: 'automated backup' },
        { kind: 'text', text: ' software.' },
        { kind: 'hr' },
        { kind: 'text', text: "That's the plan." },
      ]);
    });

    it('preserves newlines BETWEEN consecutive prose lines', () => {
      // Two non-block lines should still render with a line break
      // between them when the result is concatenated as text.
      const result = parseAgentMessage('first line\nsecond line');
      expect(result).toEqual([
        { kind: 'text', text: 'first line\nsecond line' },
      ]);
    });
  });

  describe('GFM tables', () => {
    it('parses a minimal 2-column 1-row table', () => {
      const md = '| col1 | col2 |\n|------|------|\n| a    | b    |';
      const result = parseAgentMessage(md);
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        kind: 'table',
        alignments: [null, null],
      });
      const table = result[0] as Extract<
        (typeof result)[number],
        { kind: 'table' }
      >;
      expect(table.headers.map((cell) => (cell[0] as { text: string }).text)).toEqual(['col1', 'col2']);
      expect(table.rows).toHaveLength(1);
      expect(table.rows[0].map((cell) => (cell[0] as { text: string }).text)).toEqual(['a', 'b']);
    });

    it('parses left/center/right alignment markers from the separator row', () => {
      const md = '| L | C | R |\n|:--|:-:|--:|\n| a | b | c |';
      const result = parseAgentMessage(md);
      const table = result[0] as Extract<
        (typeof result)[number],
        { kind: 'table' }
      >;
      expect(table.alignments).toEqual(['left', 'center', 'right']);
    });

    it('inline-tokenizes cells (todo-links + emphasis still work inside cells)', () => {
      const md =
        `| Task | Note |\n|------|------|\n| [Park hangout](todo://${UUID_A}) | **important** |`;
      const result = parseAgentMessage(md);
      const table = result[0] as Extract<
        (typeof result)[number],
        { kind: 'table' }
      >;
      // First body cell carries the todo-link.
      expect(table.rows[0][0][0]).toEqual({
        kind: 'todo-link',
        label: 'Park hangout',
        todoId: UUID_A,
      });
      // Second body cell carries the bold inline.
      expect(table.rows[0][1][0]).toEqual({
        kind: 'bold',
        text: 'important',
      });
    });

    it('does NOT render as table when the second line is not a separator', () => {
      // Header + two body rows but no separator → not a table; the
      // pipe-shaped lines stay as plain prose.
      const md = '| a | b |\n| c | d |\n| e | f |';
      const result = parseAgentMessage(md);
      // No table segment; falls back to plain text.
      expect(result.some((s) => s.kind === 'table')).toBe(false);
    });

    it('does NOT render an incomplete table (header + separator only) as a table', () => {
      // Streaming partial: header + separator, no body rows yet —
      // falls back to prose so the rendering doesn't flash an
      // empty table.
      const md = '| a | b |\n|---|---|';
      const result = parseAgentMessage(md);
      expect(result.some((s) => s.kind === 'table')).toBe(false);
    });

    it('promotes incomplete-then-complete to a table on the next chunk re-parse', () => {
      // Streaming: round 1 sees header+separator only. Round 2
      // sees header+separator+body — it MUST render as a table
      // (the parser is purely a function of input, but this test
      // documents the streaming-friendly contract).
      const partial = '| a | b |\n|---|---|';
      const complete = '| a | b |\n|---|---|\n| 1 | 2 |';
      expect(parseAgentMessage(partial).some((s) => s.kind === 'table')).toBe(false);
      expect(parseAgentMessage(complete).some((s) => s.kind === 'table')).toBe(true);
    });

    it('detects a table when followed by prose (block terminator on non-table line)', () => {
      const md = '| a | b |\n|---|---|\n| 1 | 2 |\n\nFollowing prose.';
      const result = parseAgentMessage(md);
      expect(result[0].kind).toBe('table');
      // Prose after the table renders as a separate text segment.
      expect(
        result.some((s) => s.kind === 'text' && s.text.includes('Following prose.')),
      ).toBe(true);
    });

    it('handles two tables separated by prose', () => {
      const md =
        '| a | b |\n|---|---|\n| 1 | 2 |\n\nin between\n\n| x | y |\n|---|---|\n| 9 | 8 |';
      const result = parseAgentMessage(md);
      const tables = result.filter((s) => s.kind === 'table');
      expect(tables).toHaveLength(2);
    });

    it('does not treat a single pipe-bracketed line as a table', () => {
      const md = '| solo line |';
      const result = parseAgentMessage(md);
      expect(result.some((s) => s.kind === 'table')).toBe(false);
    });

    it('falls back to prose for malformed separator (mixed content)', () => {
      // Second line LOOKS table-shaped but isn't a valid separator
      // (cells aren't pure dash/colon). Should fall back to prose.
      const md = '| a | b |\n| not | sep |\n| 1 | 2 |';
      const result = parseAgentMessage(md);
      expect(result.some((s) => s.kind === 'table')).toBe(false);
    });
  });

  describe('agent action chips', () => {
    it('parses an `agent://rephrase?msg=...` link as an agent-action segment', () => {
      const md =
        'Try [Rephrase the PFE task](agent://rephrase?msg=rephrase+the+PFE+task+to+add+a+due+date) when ready.';
      const result = parseAgentMessage(md);
      const action = result.find((s) => s.kind === 'agent-action');
      expect(action).toMatchObject({
        kind: 'agent-action',
        label: 'Rephrase the PFE task',
        skill: 'rephrase',
        message: 'rephrase the PFE task to add a due date',
      });
    });

    it('decodes `%20`-encoded spaces in the msg payload', () => {
      const md = '[Try this](agent://rephrase?msg=hello%20world)';
      const result = parseAgentMessage(md);
      const action = result.find((s) => s.kind === 'agent-action');
      expect(action).toMatchObject({ message: 'hello world' });
    });

    it('falls through as plain text when the skill is outside the allowlist', () => {
      // `delete_all_todos` isn't in AGENT_ACTION_SKILLS — must NOT
      // produce an agent-action segment (defence in depth, mirrors
      // the Pydantic Literal allowlist on the backend).
      const md = '[Wipe pond](agent://delete_all_todos?msg=delete+everything)';
      const result = parseAgentMessage(md);
      expect(result.some((s) => s.kind === 'agent-action')).toBe(false);
    });

    it('falls through as plain text on malformed URL encoding', () => {
      const md = '[Bad](agent://rephrase?msg=foo%ZZbar)';
      const result = parseAgentMessage(md);
      expect(result.some((s) => s.kind === 'agent-action')).toBe(false);
    });

    it('interleaves todo and agent links in document order', () => {
      const md =
        `See [the task](todo://${UUID_A}) — then [Rephrase it](agent://rephrase?msg=rephrase+it).`;
      const result = parseAgentMessage(md);
      const linkSegments = result.filter(
        (s) => s.kind === 'todo-link' || s.kind === 'agent-action',
      );
      expect(linkSegments.map((s) => s.kind)).toEqual([
        'todo-link',
        'agent-action',
      ]);
    });
  });
});
