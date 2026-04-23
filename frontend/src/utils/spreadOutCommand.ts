// Story 4.2: the `/spread-out` slash command. Registered once at
// app bootstrap in main.tsx after `registerVisibilityCommands()`.
//
// `execute()` pulls the current pad list from whatever source the
// caller wired in at registration time (React Query cache in
// main.tsx; a test double in unit tests), runs
// `computeSpreadPositions`, and pushes the result into the
// `padTargetPositions` store slice. LilyPad's useFrame then lerps
// each pad toward its target and fires `PATCH /api/todos/{id}` on
// arrival (see LilyPad resting-phase spread-target branch).
//
// The command is always consumable — on an already-spread pond the
// `computeSpreadPositions` result is empty and `setTargetPositions`
// is skipped, so `/spread-out` becomes a cheap no-op. This keeps
// it chain-able (e.g. `/show-all /spread-out`) without needing
// context-aware consumability.

import { registerCommand, type SlashCommand } from './slashCommands';
import { computeSpreadPositions } from './spreadOut';
import { usePondStore } from '../stores/usePondStore';
import type { Todo } from '../types';

/**
 * Register the `/spread-out` command against the global slash-
 * command registry. `getTodos` is invoked inside `execute()` at
 * dispatch time, so every invocation pulls the latest pad list
 * rather than closing over a stale snapshot.
 */
export function registerSpreadOutCommand(
  getTodos: () => readonly Todo[],
): void {
  const command: SlashCommand = {
    token: '/spread-out',
    description: 'Spread pads apart so none overlap',
    // Always consumable — a no-op on already-spread pads is
    // preferable to context-aware disabling (which would require
    // walking the pad list on every keystroke to decide whether
    // the command should appear in the autocomplete dropdown).
    isConsumable: () => true,
    // No WorldSnapshot change — the command operates on pad
    // positions, which aren't part of `VisibilityState`.
    project: (world) => world,
    execute: () => {
      const todos = getTodos();
      // Every pad is its own singleton — groups were removed per
      // sprint-change-proposal-2026-04-23; spreadOut's `groupings`
      // arg stays in its signature for forward-compatibility but
      // we always hand it an empty map now.
      const targets = computeSpreadPositions(todos, new Map());
      if (targets.size > 0) {
        usePondStore.getState().setTargetPositions(targets);
      }
    },
  };
  registerCommand(command);
}
