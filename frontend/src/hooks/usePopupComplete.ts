import { useCallback } from 'react';
import { useUpdateTodo } from '../api/todoApi';
import { useCreateCreature } from '../api/creatureApi';
import { pickCreatureByRarity, type CreaturePick } from '../utils/creatureRarity';

// TODO(Story 7.2): rarity escalations — bonus particle bursts, extra
// firefly spawns, ecosystem reactions for rare/legendary tier rolls.
export function useCompleteTodo(): (todoId: string) => CreaturePick {
  const updateTodo = useUpdateTodo();
  const createCreature = useCreateCreature();

  return useCallback(
    (todoId: string): CreaturePick => {
      const pick = pickCreatureByRarity();

      // Fire-and-forget: the visual flash/emerge/dissolve must not wait on
      // the network. AC #8 requires async network failures log via
      // `console.warn` without rolling back the animation — React Query
      // routes network errors through per-call `onError`, not synchronous
      // throws, so hook both the sync and async paths.
      try {
        updateTodo.mutate(
          { id: todoId, completed: true },
          {
            onError: (err) => {
              console.warn('[usePopupComplete] updateTodo failed:', err);
            },
          },
        );
      } catch (err) {
        console.warn('[usePopupComplete] updateTodo threw:', err);
      }
      try {
        createCreature.mutate(
          {
            todoId,
            creatureType: pick.creatureType,
            rarity: pick.rarity,
          },
          {
            onError: (err) => {
              console.warn('[usePopupComplete] createCreature failed:', err);
            },
          },
        );
      } catch (err) {
        console.warn('[usePopupComplete] createCreature threw:', err);
      }

      return pick;
    },
    [updateTodo, createCreature],
  );
}
