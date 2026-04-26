import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  availableCommands,
  clearRegistry,
  findCommand,
  getRegistry,
  parseSlashCommands,
  registerCommand,
  walkState,
  worldFromVisibility,
  type SlashCommand,
  type VisibilityState,
  type WorldSnapshot,
} from './slashCommands';

// Story 3.3 — framework unit tests use FAKE commands so the framework
// stays decoupled from any one command category. Each test registers
// its own fakes against a fresh registry.

const DEFAULT_VIS: VisibilityState = {
  showActive: true,
  showCompleted: false,
  showDeleted: false,
};

function worldFromVis(vis: Partial<VisibilityState> = {}): WorldSnapshot {
  return worldFromVisibility({ ...DEFAULT_VIS, ...vis });
}

/** A fake command that toggles a marker flag on the visibility slice. */
function makeFake(
  token: string,
  opts: {
    consumeWhen?: (w: WorldSnapshot) => boolean;
    projectTo?: Partial<VisibilityState>;
  } = {},
): SlashCommand {
  return {
    token,
    description: `fake ${token}`,
    isConsumable: opts.consumeWhen ?? (() => true),
    project: (w) =>
      opts.projectTo
        ? { ...w, visibility: { ...w.visibility, ...opts.projectTo } }
        : w,
    execute: vi.fn(),
  };
}

describe('slashCommands framework', () => {
  beforeEach(() => {
    clearRegistry();
  });

  describe('registerCommand / getRegistry', () => {
    it('pushes commands in registration order', () => {
      const a = makeFake('/a');
      const b = makeFake('/b');
      registerCommand(a);
      registerCommand(b);
      expect(getRegistry()).toEqual([a, b]);
    });

    // Story 6.2 Group E CR P2: duplicate-token registration is now a
    // silent no-op (was: throw). Vite HMR can re-evaluate the
    // bootstrap module that calls `register*Command()` at the top
    // level; the throw was a dev-ergonomics regression on hot-reload.
    it('silently deduplicates duplicate-token registration', () => {
      const a = makeFake('/foo');
      const b = makeFake('/foo');
      registerCommand(a);
      expect(() => registerCommand(b)).not.toThrow();
      // The first registration wins; the second is dropped.
      expect(getRegistry()).toEqual([a]);
    });

    it('clearRegistry empties the registry', () => {
      registerCommand(makeFake('/a'));
      clearRegistry();
      expect(getRegistry()).toEqual([]);
    });
  });

  describe('findCommand', () => {
    it('returns the command by canonical token', () => {
      const a = makeFake('/a');
      registerCommand(a);
      expect(findCommand('/a')).toBe(a);
    });

    it('is case-insensitive', () => {
      const a = makeFake('/foo');
      registerCommand(a);
      expect(findCommand('/FOO')).toBe(a);
      expect(findCommand('/Foo')).toBe(a);
    });

    it('returns undefined for unknown tokens', () => {
      expect(findCommand('/nope')).toBeUndefined();
    });
  });

  describe('availableCommands', () => {
    it('filters by isConsumable against the given world', () => {
      const a = makeFake('/a', { consumeWhen: () => true });
      const b = makeFake('/b', { consumeWhen: () => true });
      const c = makeFake('/c', { consumeWhen: () => false });
      registerCommand(a);
      registerCommand(b);
      registerCommand(c);
      expect(availableCommands(worldFromVis())).toEqual([a, b]);
    });

    it('preserves registration order', () => {
      const b = makeFake('/b');
      const a = makeFake('/a');
      registerCommand(b);
      registerCommand(a);
      // b registered first — even though alphabet would put a first.
      expect(availableCommands(worldFromVis())).toEqual([b, a]);
    });
  });

  describe('walkState', () => {
    it('empty string returns initial world and no fragment', () => {
      const init = worldFromVis();
      expect(walkState('', init)).toEqual({
        world: init,
        invalid: false,
        fragment: '',
      });
    });

    it('lone "/" is a fragment, not a complete token', () => {
      const init = worldFromVis();
      expect(walkState('/', init)).toEqual({
        world: init,
        invalid: false,
        fragment: '/',
      });
    });

    it('leading whitespace is invalid', () => {
      registerCommand(makeFake('/a'));
      const result = walkState('  /a', worldFromVis());
      expect(result.invalid).toBe(true);
    });

    it('advances virtual world across a completed token (trailing space)', () => {
      const a = makeFake('/test-a', { projectTo: { showCompleted: true } });
      registerCommand(a);
      const result = walkState('/test-a ', worldFromVis());
      expect(result.invalid).toBe(false);
      expect(result.fragment).toBe('');
      expect(result.world.visibility.showCompleted).toBe(true);
    });

    it('trailing non-space token becomes the fragment (not projected)', () => {
      const a = makeFake('/test-a', { projectTo: { showCompleted: true } });
      registerCommand(a);
      const result = walkState('/test-a /te', worldFromVis());
      // First token is complete (trailing space separator) so projected:
      expect(result.world.visibility.showCompleted).toBe(true);
      expect(result.fragment).toBe('/te');
      expect(result.invalid).toBe(false);
    });

    it('a non-consumable complete token marks the walk invalid', () => {
      // /test-a sets showCompleted=true on projection.
      // Second /test-a is NOT consumable against the post-first world
      // (its consumeWhen requires showCompleted=false).
      const a: SlashCommand = {
        token: '/test-a',
        description: 'fake',
        isConsumable: (w) => !w.visibility.showCompleted,
        project: (w) => ({ ...w, visibility: { ...w.visibility, showCompleted: true } }),
        execute: vi.fn(),
      };
      registerCommand(a);
      const result = walkState('/test-a /test-a /te', worldFromVis());
      expect(result.invalid).toBe(true);
      expect(result.fragment).toBe('/te');
    });

    it('unknown complete token marks invalid', () => {
      const result = walkState('/nope ', worldFromVis());
      expect(result.invalid).toBe(true);
    });
  });

  describe('parseSlashCommands', () => {
    it('returns null when text does not start with /', () => {
      registerCommand(makeFake('/a'));
      expect(parseSlashCommands('a', worldFromVis())).toBeNull();
      expect(parseSlashCommands('regular todo text', worldFromVis())).toBeNull();
    });

    it('returns null on leading whitespace', () => {
      registerCommand(makeFake('/a'));
      expect(parseSlashCommands('  /a', worldFromVis())).toBeNull();
    });

    it('returns null for an unknown command', () => {
      expect(parseSlashCommands('/xyz', worldFromVis())).toBeNull();
    });

    it('returns [cmd] for a single valid token', () => {
      const a = makeFake('/test-a');
      registerCommand(a);
      expect(parseSlashCommands('/test-a', worldFromVis())).toEqual([a]);
    });

    it('accepts trailing whitespace (Tab-completion artifact)', () => {
      const a = makeFake('/test-a');
      registerCommand(a);
      expect(parseSlashCommands('/test-a ', worldFromVis())).toEqual([a]);
      expect(parseSlashCommands('/test-a  \t ', worldFromVis())).toEqual([a]);
    });

    it('chains multiple valid tokens in order', () => {
      const a = makeFake('/test-a', { projectTo: { showCompleted: true } });
      const b = makeFake('/test-b', { projectTo: { showDeleted: true } });
      registerCommand(a);
      registerCommand(b);
      expect(parseSlashCommands('/test-a /test-b', worldFromVis())).toEqual([a, b]);
    });

    it('returns null when the second token is not consumable against the post-first virtual world', () => {
      const a: SlashCommand = {
        token: '/test-a',
        description: 'fake',
        isConsumable: (w) => !w.visibility.showCompleted,
        project: (w) => ({ ...w, visibility: { ...w.visibility, showCompleted: true } }),
        execute: vi.fn(),
      };
      registerCommand(a);
      expect(parseSlashCommands('/test-a /test-a', worldFromVis())).toBeNull();
    });

    it('case-insensitive token match', () => {
      const a = makeFake('/test-a');
      registerCommand(a);
      expect(parseSlashCommands('/TEST-A', worldFromVis())).toEqual([a]);
    });

    it('empty text + just "/" are null', () => {
      expect(parseSlashCommands('', worldFromVis())).toBeNull();
      expect(parseSlashCommands('/', worldFromVis())).toBeNull();
    });

    it('collapses consecutive spaces between tokens', () => {
      const a = makeFake('/test-a', { projectTo: { showCompleted: true } });
      const b = makeFake('/test-b', { projectTo: { showDeleted: true } });
      registerCommand(a);
      registerCommand(b);
      expect(parseSlashCommands('/test-a   /test-b', worldFromVis())).toEqual([a, b]);
    });
  });
});
