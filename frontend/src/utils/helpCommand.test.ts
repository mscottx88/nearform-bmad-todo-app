import { describe, it, expect } from 'vitest';
import { parseHelpCommand } from './helpCommand';

describe('parseHelpCommand', () => {
  it('matches bare /help with empty prefill', () => {
    expect(parseHelpCommand('/help')).toEqual({ open: true, prefill: '' });
  });

  it('matches /help with text and trims the prefill', () => {
    expect(parseHelpCommand('/help plan my week')).toEqual({
      open: true,
      prefill: 'plan my week',
    });
  });

  it('trims trailing whitespace on bare form', () => {
    expect(parseHelpCommand('  /help   ')).toEqual({ open: true, prefill: '' });
  });

  it('trims trailing whitespace on text form', () => {
    expect(parseHelpCommand('/help foo bar   ')).toEqual({
      open: true,
      prefill: 'foo bar',
    });
  });

  it('does not match /helpme (no space after /help)', () => {
    expect(parseHelpCommand('/helpme')).toBeNull();
  });

  it('does not match plain text', () => {
    expect(parseHelpCommand('hello world')).toBeNull();
  });

  it('does not match unrelated slash commands', () => {
    expect(parseHelpCommand('/show:all')).toBeNull();
  });

  it('does not match an empty string', () => {
    expect(parseHelpCommand('')).toBeNull();
  });

  // Story 6.2 Group D CR P5: tab and newline separators (and the
  // explicit `/help/foo` shorthand) used to fall through to the
  // todo-create path. The regex now accepts any whitespace OR a
  // `/` after `/help`.
  it('matches /help with a tab separator', () => {
    expect(parseHelpCommand('/help\tfoo bar')).toEqual({
      open: true,
      prefill: 'foo bar',
    });
  });

  it('matches /help/foo (slash separator, no space)', () => {
    expect(parseHelpCommand('/help/plan my week')).toEqual({
      open: true,
      prefill: 'plan my week',
    });
  });

  it('still does not match /helpfoo (no separator at all)', () => {
    expect(parseHelpCommand('/helpfoo')).toBeNull();
  });
});
