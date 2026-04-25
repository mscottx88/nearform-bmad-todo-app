/**
 * `/help` carve-out for TodoInput.
 *
 * Story 6.2 AC 2: `/help` opens the agent panel with an empty composer;
 * `/help <text>` opens the panel with `<text>` pre-filled. The match
 * runs in TodoInput's Enter handler BEFORE `parseSlashCommands` so
 * the toggle-command framework from Story 3.3 stays pure and the
 * `/help <text>` form (with arbitrary trailing text) doesn't get
 * mis-parsed by the registry walker.
 *
 * `registerHelpCommand` is a separate concern: it adds a registry
 * entry so `/help` shows up in the autocomplete dropdown alongside
 * the other slash commands. The carve-out above always wins on
 * Enter, so the registry entry's `execute()` only runs in the
 * defensive case where the parser path somehow misses the form
 * (e.g. if the carve-out is removed in the future). Keeping both
 * paths means discoverability AND the existing parser carve-out
 * keep working.
 */

import { registerCommand, type SlashCommand, type WorldSnapshot } from './slashCommands';
import { useAgentStore } from '../stores/useAgentStore';

export interface HelpCommandResult {
  open: true;
  prefill: string;
}

export function parseHelpCommand(text: string): HelpCommandResult | null {
  const trimmed = text.trim();
  if (trimmed === '/help') return { open: true, prefill: '' };
  if (trimmed.startsWith('/help ')) {
    return { open: true, prefill: trimmed.slice('/help '.length).trim() };
  }
  return null;
}

/**
 * Register `/help` against the global slash-command registry so it
 * appears in TodoInput's autocomplete dropdown. The registry entry
 * is a no-op `project` (never mutates the world) and an `execute`
 * that opens the agent panel — a defensive fallback path; the
 * primary entry point is the `parseHelpCommand` carve-out in
 * TodoInput's Enter handler, which fires BEFORE the registry walk.
 */
export function registerHelpCommand(): void {
  const command: SlashCommand = {
    token: '/help',
    description: 'Open the agent chat panel',
    isConsumable: () => true,
    project: (world: WorldSnapshot) => world,
    execute: () => {
      useAgentStore.getState().openPanel();
    },
  };
  registerCommand(command);
}
