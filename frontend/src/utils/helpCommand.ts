/**
 * `/help` carve-out for TodoInput.
 *
 * Story 6.2 AC 2: `/help` opens the agent panel with an empty composer;
 * `/help <text>` opens the panel with `<text>` pre-filled. The match is
 * a parser carve-out, NOT a slash-command-registry entry — the toggle-
 * command framework from Story 3.3 stays pure.
 *
 * `parseHelpCommand` runs BEFORE `parseSlashCommands` in TodoInput's
 * Enter handler so `/help …` never reaches the registry walker.
 */

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
