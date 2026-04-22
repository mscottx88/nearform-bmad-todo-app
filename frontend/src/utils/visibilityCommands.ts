// Story 3.3: the eight concrete visibility commands that ship in
// this story — `/show-active`, `/hide-active`, `/show-completed`,
// `/hide-completed`, `/show-deleted`, `/hide-deleted`, `/show-all`,
// `/hide-all`. Each is a self-contained `SlashCommand` registration
// built on top of the generic framework in `slashCommands.ts`.
//
// This file is the reference implementation future stories copy when
// adding a new command category (see story 3.3 Dev Notes § "Adding a
// new slash command").

import {
  registerCommand,
  type SlashCommand,
  type VisibilityState,
  type WorldSnapshot,
} from './slashCommands';
import { usePondStore } from '../stores/usePondStore';

type VisibilityFlag = keyof VisibilityState;

function patch(world: WorldSnapshot, change: Partial<VisibilityState>): WorldSnapshot {
  return { ...world, visibility: { ...world.visibility, ...change } };
}

function visibilityPair(flag: VisibilityFlag, label: string): [SlashCommand, SlashCommand] {
  const show: SlashCommand = {
    token: `/show-${label}`,
    description: `Show ${label} pads`,
    isConsumable: (w) => !w.visibility[flag],
    project: (w) => patch(w, { [flag]: true }),
    execute: () => usePondStore.getState().setVisibility({ [flag]: true }),
  };
  const hide: SlashCommand = {
    token: `/hide-${label}`,
    description: `Hide ${label} pads`,
    isConsumable: (w) => w.visibility[flag],
    project: (w) => patch(w, { [flag]: false }),
    execute: () => usePondStore.getState().setVisibility({ [flag]: false }),
  };
  return [show, hide];
}

export const [showActive, hideActive] = visibilityPair('showActive', 'active');
export const [showCompleted, hideCompleted] = visibilityPair('showCompleted', 'completed');
export const [showDeleted, hideDeleted] = visibilityPair('showDeleted', 'deleted');

export const showAll: SlashCommand = {
  token: '/show-all',
  description: 'Show active, completed, and deleted pads',
  isConsumable: (w) =>
    !w.visibility.showActive || !w.visibility.showCompleted || !w.visibility.showDeleted,
  project: (w) =>
    patch(w, { showActive: true, showCompleted: true, showDeleted: true }),
  execute: () =>
    usePondStore
      .getState()
      .setVisibility({ showActive: true, showCompleted: true, showDeleted: true }),
};

export const hideAll: SlashCommand = {
  token: '/hide-all',
  description: 'Hide every pad (empty pond)',
  isConsumable: (w) =>
    w.visibility.showActive || w.visibility.showCompleted || w.visibility.showDeleted,
  project: (w) =>
    patch(w, { showActive: false, showCompleted: false, showDeleted: false }),
  execute: () =>
    usePondStore
      .getState()
      .setVisibility({ showActive: false, showCompleted: false, showDeleted: false }),
};

/**
 * Register all eight visibility commands in stable dropdown order:
 * active → completed → deleted → show-all → hide-all. Call exactly
 * once at app bootstrap (main.tsx) — the registry throws on
 * duplicate tokens, so a double-call surfaces as a dev-time error.
 */
export function registerVisibilityCommands(): void {
  registerCommand(showActive);
  registerCommand(hideActive);
  registerCommand(showCompleted);
  registerCommand(hideCompleted);
  registerCommand(showDeleted);
  registerCommand(hideDeleted);
  registerCommand(showAll);
  registerCommand(hideAll);
}
