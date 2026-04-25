/**
 * SSE streaming consumer for `POST /api/agent/sessions/{id}/chat`.
 *
 * Native `EventSource` is GET-only — the agent endpoint requires a JSON
 * POST body — so this uses `fetch()` + `ReadableStream` to consume the
 * stream by hand. The parser is ~30 lines of inline code; no external
 * SSE library.
 *
 * The exported function is `streamAgentChat`. It is named "use…" only
 * by file convention (not a React hook). Returns an `{ abort }` handle
 * that the store wires into its cancel action.
 */

import type { SseEvent } from '../types/agent';

export interface AgentChatStreamHandle {
  abort: () => void;
}

interface StreamArgs {
  sessionId: string;
  content: string;
  skill: string | null;
  onEvent: (event: SseEvent) => void;
  /**
   * Called after the network stream ends cleanly OR after an error.
   * Always fires exactly once. The store uses this to clear
   * `streamingMessageId` even if the server forgets to emit `done`.
   */
  onClose: (reason: 'done' | 'aborted' | 'error', error?: Error) => void;
}

/**
 * Parse one full SSE frame (the part between two `\n\n` separators).
 * Returns the parsed event or `null` if the frame is malformed or
 * doesn't match the `data: {...}` shape we're expecting.
 */
function parseFrame(frame: string): SseEvent | null {
  const trimmed = frame.trim();
  if (!trimmed.startsWith('data: ')) return null;
  const json = trimmed.slice(6).trim();
  if (!json) return null;
  try {
    return JSON.parse(json) as SseEvent;
  } catch {
    return null;
  }
}

export async function streamAgentChat({
  sessionId,
  content,
  skill,
  onEvent,
  onClose,
}: StreamArgs): Promise<AgentChatStreamHandle> {
  const controller = new AbortController();

  const response = await fetch(`/api/agent/sessions/${sessionId}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content, skill, context: { todo_ids: [] } }),
    signal: controller.signal,
  });

  if (!response.ok || !response.body) {
    onClose('error', new Error(`stream failed: ${response.status}`));
    return { abort: () => controller.abort() };
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();

  // Drive the stream asynchronously. The `void` swallows the promise
  // because we don't want callers to await stream completion — they
  // get incremental events via `onEvent` and a single `onClose`.
  void (async () => {
    let buffer = '';
    let closed = false;
    const closeOnce = (reason: 'done' | 'aborted' | 'error', err?: Error) => {
      if (closed) return;
      closed = true;
      onClose(reason, err);
    };

    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) {
          // Stream ended without `done` event — still treat as done so
          // the store's streaming flag clears and the bubble freezes.
          closeOnce('done');
          return;
        }
        buffer += decoder.decode(value, { stream: true });
        const frames = buffer.split('\n\n');
        // The last fragment may be a partial frame waiting for more
        // bytes — keep it in the buffer for the next read.
        buffer = frames.pop() ?? '';
        for (const frame of frames) {
          const event = parseFrame(frame);
          if (event === null) continue;
          onEvent(event);
        }
      }
    } catch (err) {
      // AbortError shows up as a DOMException with name 'AbortError'.
      // It's the user-initiated cancel path, not a server error.
      if (err instanceof DOMException && err.name === 'AbortError') {
        closeOnce('aborted');
      } else {
        closeOnce('error', err instanceof Error ? err : new Error(String(err)));
      }
    }
  })();

  return { abort: () => controller.abort() };
}
