// Story 3.3: generic slash-command framework.
//
// This module is deliberately command-category-agnostic. It knows how
// to register `SlashCommand` objects, walk a space-separated token
// chain through each command's virtual-state projection, and return
// either an ordered command list (valid pure chain) or `null` (fall
// through to todo-create). The concrete visibility commands live in
// `visibilityCommands.ts`; future categories register into the same
// registry without touching the parser.

import type { Todo } from '../types';

export interface VisibilityState {
  showActive: boolean;
  showCompleted: boolean;
  showDeleted: boolean;
}

/**
 * Read-only snapshot of whatever world state a command needs to
 * inspect. Starts with just `visibility` — a future story adding
 * a command that reads a todo list (e.g. `/delete-all`) extends
 * this interface with an optional field. Keep fields OPTIONAL so
 * existing commands that only read one slice don't care about
 * unused additions.
 */
export interface WorldSnapshot {
  visibility: VisibilityState;
  /**
   * Story 4.2: optional visible-todo list. Commands that read the
   * current pad layout (e.g. `/spread-out`) can consult this to
   * decide consumability or to build execute() inputs. Optional
   * because the visibility commands (story 3.3) never care about
   * the pad list and would otherwise have to supply an empty
   * array at every `worldFromVisibility` call. TodoInput passes
   * the current `useTodos()` data when building the snapshot.
   */
  todos?: readonly Todo[];
}

export interface SlashCommand {
  /** Canonical text with leading '/'. MUST be lowercase + unique across the registry. */
  readonly token: string;
  /** Human-readable help shown in the autocomplete dropdown next to the token. */
  readonly description: string;
  /**
   * Is this command runnable against the current world? Return `false`
   * for no-ops (e.g. `/show-completed` when already shown). The
   * dropdown filters by this predicate; the parser rejects chains
   * that would dispatch a non-consumable command.
   */
  isConsumable(world: WorldSnapshot): boolean;
  /**
   * Return the world snapshot that WOULD exist after running this
   * command. MUST be pure — this is used to walk virtual state for
   * mid-chain dropdown preview (AC #9).
   */
  project(world: WorldSnapshot): WorldSnapshot;
  /**
   * Run the real side effects (store writes, API calls). Called by
   * the dispatcher when the user presses Enter on a validated chain.
   * Takes nothing; the command closes over whatever it needs
   * (usePondStore, queryClient, etc.) at registration time.
   */
  execute(): void;
}

const registry: SlashCommand[] = [];

/**
 * Register a command. Duplicate tokens throw — surface as a dev-time
 * error rather than silently deduping. Callers register exactly once
 * at app bootstrap (see frontend/src/main.tsx).
 */
export function registerCommand(cmd: SlashCommand): void {
  if (registry.some((c) => c.token === cmd.token)) {
    throw new Error(`slashCommands: duplicate token ${cmd.token}`);
  }
  registry.push(cmd);
}

/**
 * Test-only: empty the registry so tests can register fake commands
 * per-case without bleed from other suites. Call inside `beforeEach`.
 */
export function clearRegistry(): void {
  registry.length = 0;
}

/** Read-only snapshot for tests and the UI layer. */
export function getRegistry(): readonly SlashCommand[] {
  return registry;
}

/**
 * Return the subset of registered commands that are consumable
 * against the given world. Preserves registration order so each
 * command file decides where it sits in the dropdown by the order
 * its `register<Category>Commands()` pushes into the registry.
 */
export function availableCommands(world: WorldSnapshot): SlashCommand[] {
  return registry.filter((c) => c.isConsumable(world));
}

/**
 * Look up a command by its canonical token (case-insensitive —
 * tokens in the registry are stored lowercase; input tokens are
 * lowercased before comparison).
 */
export function findCommand(token: string): SlashCommand | undefined {
  const lc = token.toLowerCase();
  return registry.find((c) => c.token === lc);
}

export interface WalkResult {
  world: WorldSnapshot;
  invalid: boolean;
  fragment: string;
}

/**
 * Walk every complete token in `text` (terminated by a space),
 * projecting each token's effect into a virtual world snapshot.
 * Returns the post-walk world + the trailing fragment (the token
 * currently being typed, with no trailing space yet).
 *
 * Rules:
 *   - Leading whitespace → invalid (text must start with '/').
 *   - Empty text or exact '' → `{ world: initial, invalid: false, fragment: '' }`.
 *   - Exact '/' with no space → `{ world: initial, invalid: false, fragment: '/' }`.
 *   - A complete token (terminated by space) that is not found OR
 *     not consumable against the walked-so-far world sets
 *     `invalid: true`. The remaining text is still tokenised so
 *     `fragment` is the trailing incomplete piece (useful for
 *     dropdown UX even on an invalid prefix).
 *
 * The parser uses `invalid` to reject the chain; the dropdown uses
 * it to render an empty list (signals "Enter will fall through").
 */
export function walkState(text: string, initial: WorldSnapshot): WalkResult {
  // Leading whitespace: cannot be a command chain.
  if (text.length > 0 && /^\s/.test(text)) {
    return { world: initial, invalid: true, fragment: '' };
  }
  if (text === '') {
    return { world: initial, invalid: false, fragment: '' };
  }
  // Split on single-space boundaries; filter empty tokens so
  // `a  b` (double space) reads the same as `a b`. Trailing space
  // produces an empty final element — we strip that after splitting
  // and treat `text.endsWith(' ')` separately to drive the fragment.
  const rawTokens = text.split(' ');
  const trailingSpace = text.endsWith(' ');
  const tokens = rawTokens.filter((t) => t.length > 0);

  // `fragment` is the trailing incomplete token (no trailing space),
  // or '' when the input ends in a space.
  const fragment = trailingSpace ? '' : (tokens[tokens.length - 1] ?? '');
  // Complete tokens are every token EXCEPT the fragment (when there
  // is no trailing space). When the input ends in a space, every
  // token is "complete".
  const completeTokens = trailingSpace ? tokens : tokens.slice(0, -1);

  let world = initial;
  for (const tok of completeTokens) {
    const cmd = findCommand(tok);
    if (!cmd || !cmd.isConsumable(world)) {
      return { world, invalid: true, fragment };
    }
    world = cmd.project(world);
  }
  return { world, invalid: false, fragment };
}

/**
 * Parse raw input text and return an ordered array of commands to
 * execute, or `null` if the text is NOT a pure command chain. The
 * caller falls through to the todo-create path on `null`.
 *
 * Returns commands iff:
 *   (a) text starts with '/' (no leading whitespace),
 *   (b) `walkState` returns `invalid: false` — every complete token
 *       resolved to a consumable command against the accumulated
 *       virtual state,
 *   (c) if a trailing fragment exists, it ALSO matches a consumable
 *       command (i.e. the user completed the last token they typed;
 *       Enter on an incomplete prefix falls through to todo-create).
 *
 * Trimming: trailing whitespace is trimmed before tokenising so
 * `/show-completed ` (trailing space from Tab completion) parses the
 * same as `/show-completed`.
 */
export function parseSlashCommands(
  text: string,
  world: WorldSnapshot,
): SlashCommand[] | null {
  if (!text.startsWith('/')) return null;
  // Trim ONLY trailing whitespace — leading whitespace was already
  // rejected by the `startsWith('/')` guard.
  const trimmed = text.replace(/\s+$/, '');
  if (trimmed === '') return null;

  const tokens = trimmed.split(/\s+/).filter((t) => t.length > 0);
  const commands: SlashCommand[] = [];
  let virtualWorld = world;
  for (const tok of tokens) {
    const cmd = findCommand(tok);
    if (!cmd || !cmd.isConsumable(virtualWorld)) return null;
    commands.push(cmd);
    virtualWorld = cmd.project(virtualWorld);
  }
  return commands;
}

/**
 * Build a `WorldSnapshot` from the current visibility state. Exposed
 * so TodoInput and tests can cheaply construct snapshots without
 * reaching into the store shape.
 */
export function worldFromVisibility(visibility: VisibilityState): WorldSnapshot {
  return { visibility };
}
