/**
 * Story 6.2 enhancement: parse `[label](todo://<uuid>)` markdown-link
 * references out of an assistant message's content.
 *
 * The chat skill's system prompt (see backend/src/agent/system_prompt.py)
 * teaches the LLM to format any todo it names as
 * `[short label](todo://<uuid>)`. Splitting them out at render time
 * lets us turn each reference into a hover/click target wired to the
 * pond store, while leaving the surrounding prose untouched.
 *
 * UUIDs use the canonical 8-4-4-4-12 hex form. The regex deliberately
 * captures the UUID exactly so we can pass it to `usePondStore` calls
 * verbatim — anything that doesn't look like a UUID falls through as
 * plain text rather than being silently dropped.
 */

export type AgentMessageSegment =
  | { kind: 'text'; text: string }
  | { kind: 'todo-link'; label: string; todoId: string };

const TODO_LINK_RE =
  /\[([^\]]+)\]\(todo:\/\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\)/gi;

export function parseAgentMessage(content: string): AgentMessageSegment[] {
  if (!content) return [];
  const segments: AgentMessageSegment[] = [];
  let cursor = 0;

  // String.matchAll returns each match with `match.index` set to the
  // start offset, which is exactly what we need to slice the prose
  // around each link.
  for (const match of content.matchAll(TODO_LINK_RE)) {
    const start = match.index ?? 0;
    if (start > cursor) {
      segments.push({ kind: 'text', text: content.slice(cursor, start) });
    }
    segments.push({
      kind: 'todo-link',
      label: match[1],
      todoId: match[2].toLowerCase(),
    });
    cursor = start + match[0].length;
  }

  if (cursor < content.length) {
    segments.push({ kind: 'text', text: content.slice(cursor) });
  }

  return segments;
}
