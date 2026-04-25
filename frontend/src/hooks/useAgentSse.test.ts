import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { streamAgentChat } from './useAgentSse';
import type { SseEvent } from '../types/agent';

/**
 * Build a Response whose body is a ReadableStream emitting the given
 * UTF-8 strings, one chunk per `enqueue` call. Each chunk is encoded
 * with TextEncoder so the consumer's TextDecoder can stitch them back
 * together — this mirrors how a real network response delivers data.
 */
function makeStreamingResponse(chunks: string[], status = 200): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });
  return new Response(stream, {
    status,
    headers: { 'Content-Type': 'text/event-stream' },
  });
}

const originalFetch = globalThis.fetch;

describe('streamAgentChat', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('parses well-formed SSE frames into typed events', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      makeStreamingResponse([
        'data: {"type":"start","session_id":"sess-1","skill":"chat","message_id":"m1"}\n\n',
        'data: {"type":"chunk","text":"hello "}\n\n',
        'data: {"type":"chunk","text":"world"}\n\n',
        'data: {"type":"done"}\n\n',
      ]),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const events: SseEvent[] = [];
    let closeReason: 'done' | 'aborted' | 'error' | null = null;
    await new Promise<void>((resolve) => {
      void streamAgentChat({
        sessionId: 'sess-1',
        content: 'hi',
        skill: null,
        onEvent: (e) => events.push(e),
        onClose: (reason) => {
          closeReason = reason;
          resolve();
        },
      });
    });

    expect(events).toEqual([
      { type: 'start', session_id: 'sess-1', skill: 'chat', message_id: 'm1' },
      { type: 'chunk', text: 'hello ' },
      { type: 'chunk', text: 'world' },
      { type: 'done' },
    ]);
    expect(closeReason).toBe('done');

    // The POST is hit at the right URL with the right body shape.
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/agent/sessions/sess-1/chat',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          content: 'hi',
          skill: null,
          context: { todo_ids: [] },
        }),
      }),
    );
  });

  it('handles a frame split across two reads (partial buffering)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      makeStreamingResponse([
        'data: {"type":"chunk","text":"hel',
        'lo"}\n\ndata: {"type":"done"}\n\n',
      ]),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const events: SseEvent[] = [];
    await new Promise<void>((resolve) => {
      void streamAgentChat({
        sessionId: 'sess-1',
        content: 'hi',
        skill: null,
        onEvent: (e) => events.push(e),
        onClose: () => resolve(),
      });
    });

    expect(events).toEqual([
      { type: 'chunk', text: 'hello' },
      { type: 'done' },
    ]);
  });

  it('drops malformed JSON frames without aborting the stream', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      makeStreamingResponse([
        'data: this-is-not-json\n\ndata: {"type":"done"}\n\n',
      ]),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const events: SseEvent[] = [];
    await new Promise<void>((resolve) => {
      void streamAgentChat({
        sessionId: 'sess-1',
        content: 'hi',
        skill: null,
        onEvent: (e) => events.push(e),
        onClose: () => resolve(),
      });
    });

    expect(events).toEqual([{ type: 'done' }]);
  });

  it('reports onClose("error") when the response is non-OK', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response('boom', { status: 500 }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const closeReasons: string[] = [];
    await streamAgentChat({
      sessionId: 'sess-1',
      content: 'hi',
      skill: null,
      onEvent: () => {},
      onClose: (reason) => closeReasons.push(reason),
    });

    expect(closeReasons).toEqual(['error']);
  });
});
