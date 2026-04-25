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
});
