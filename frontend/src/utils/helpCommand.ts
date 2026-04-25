/**
 * `/help` carve-out for TodoInput + autocomplete-dropdown registration.
 *
 * Story 6.2 AC 2: `/help` opens the agent panel with an empty composer;
 * `/help <text>` opens the panel with `<text>` pre-filled. The match
 * runs in TodoInput's Enter handler BEFORE `parseSlashCommands` so
 * the toggle-command framework from Story 3.3 stays pure and the
 * `/help <text>` form (with arbitrary trailing text) doesn't get
 * mis-parsed by the registry walker.
 *
 * Story 6.2 Group B CR D3 (choice C): the registry-entry is also
 * registered so `/help` shows up in the slash-autocomplete dropdown
 * for discoverability — but it delegates to the SAME activation
 * function the carve-out uses, rather than running a parallel
 * implementation. One source of truth for what "/help activates":
 * `activateAgentHelp(prefill)`. Both the TodoInput Enter carve-out
 * and the registry-entry's `execute()` call it.
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
 * Single source of truth for activating the agent panel via `/help`.
 * Used by:
 *   - TodoInput's Enter carve-out (after `parseHelpCommand` returns
 *     a non-null result), and
 *   - the slash-autocomplete dropdown's `execute()` (registered
 *     below).
 *
 * Bare `/help` opens the panel with an empty composer; the prefill
 * form opens it AND seeds the composer's draft so the user's intent
 * carries over.
 */
export function activateAgentHelp(prefill: string = ''): void {
  const store = useAgentStore.getState();
  store.openPanel();
  if (prefill) {
    store.setDraft(prefill);
  }
}

/**
 * Register `/help` against the global slash-command registry so it
 * appears in TodoInput's autocomplete dropdown. The `execute` path
 * delegates to `activateAgentHelp('')` — same activation function
 * the carve-out uses, just with no prefill (the dropdown variant
 * doesn't carry trailing text).
 */
export function registerHelpCommand(): void {
  const command: SlashCommand = {
    token: '/help',
    description: 'Open the agent chat panel',
    isConsumable: () => true,
    project: (world: WorldSnapshot) => world,
    execute: () => activateAgentHelp(''),
  };
  registerCommand(command);
}
