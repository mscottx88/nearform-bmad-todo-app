/**
 * Story 4.9: Periodic + exit save for the in-memory world-metadata
 * store.
 *
 * Mount ONCE at the app root (or PondScene). On a recurring interval,
 * collects every dirty entry from `useWorldStore` and fires a single
 * `PATCH /api/todos/positions` with the batch. On tab exit
 * (`beforeunload` / `visibilitychange=hidden`), flushes the same set
 * via `navigator.sendBeacon` with a `fetch({keepalive: true})`
 * fallback.
 *
 * Design notes:
 * - The interval uses a simple `setInterval`. A real one-per-app
 *   instance is enforced by the hook being called at a single mount
 *   point; no global singleton needed for the current app shape.
 * - An in-flight guard prevents overlapping saves. The dispatch
 *   timestamp is captured BEFORE the request so entries mutated
 *   during the flight stay dirty for the next cycle.
 * - Errors in the periodic save path are logged via console.error
 *   and NOT surfaced to the user (background save).
 * - The exit save doesn't bump `lastSavedAtMs` because we can't
 *   await the response; the next mount will re-hydrate from whatever
 *   the server actually persisted.
 */

import { useEffect, useRef } from 'react';
import apiClient from '../api/client';
import {
  PERIODIC_SAVE_INTERVAL_MS,
  useWorldStore,
  type WorldEntry,
} from '../stores/useWorldStore';

/** URL hit by both the periodic and exit save paths. */
export const WORLD_SAVE_URL = '/todos/positions';

/** Shape the axios request-interceptor accepts (it decamelizes keys). */
interface AxiosSaveEntry {
  id: string;
  positionX: number;
  positionY: number;
  rotationY: number;
}

/** Shape the beacon / keepalive fetch path writes to the wire (raw snake_case). */
interface BeaconSaveEntry {
  id: string;
  position_x: number;
  position_y: number;
  rotation_y: number;
}

function buildAxiosPayload(
  dirty: Array<{ id: string; entry: WorldEntry }>,
): { positions: AxiosSaveEntry[] } {
  return {
    positions: dirty.map(({ id, entry }) => ({
      id,
      positionX: entry.positionX,
      positionY: entry.positionY,
      rotationY: entry.rotationY,
    })),
  };
}

function buildBeaconPayload(
  dirty: Array<{ id: string; entry: WorldEntry }>,
): { positions: BeaconSaveEntry[] } {
  return {
    positions: dirty.map(({ id, entry }) => ({
      id,
      position_x: entry.positionX,
      position_y: entry.positionY,
      rotation_y: entry.rotationY,
    })),
  };
}

/**
 * Send the payload via `fetch({ method: 'PATCH', keepalive: true })`.
 *
 * `navigator.sendBeacon` is NOT used here even though it's the
 * canonical exit-flush API — it only supports POST, and our endpoint
 * requires PATCH. Using sendBeacon against `/api/todos/positions`
 * returns 405 Method Not Allowed at the backend. Modern browsers
 * (Chrome 62+, Firefox 71+, Safari 13+) honour `keepalive: true` on
 * fetch during the unload phase, so the reliability gap vs sendBeacon
 * is small in practice.
 *
 * The response is not awaited. The local `lastSavedAtMs` is NOT
 * bumped — next mount re-hydrates from server truth.
 */
export function sendExitPayload(payload: { positions: BeaconSaveEntry[] }): boolean {
  const url = (apiClient.defaults.baseURL ?? '') + WORLD_SAVE_URL;
  const body = JSON.stringify(payload);
  if (typeof fetch !== 'function') return false;
  try {
    void fetch(url, {
      method: 'PATCH',
      body,
      keepalive: true,
      headers: { 'Content-Type': 'application/json' },
    });
    return true;
  } catch {
    return false;
  }
}

export interface PeriodicWorldSaveOptions {
  /**
   * Override the save interval. Defaults to `PERIODIC_SAVE_INTERVAL_MS`
   * (5 minutes). Exposed mostly for tests — production mounts pass
   * nothing and take the default.
   */
  intervalMs?: number;
}

export function usePeriodicWorldSave(options: PeriodicWorldSaveOptions = {}): void {
  const intervalMs = options.intervalMs ?? PERIODIC_SAVE_INTERVAL_MS;
  const inFlightRef = useRef(false);

  useEffect(() => {
    const tick = async (): Promise<void> => {
      if (inFlightRef.current) return;
      const dirty = useWorldStore.getState().getDirtyEntries();
      if (dirty.length === 0) return;
      const dispatchMs = performance.now();
      const ids = dirty.map((d) => d.id);
      const payload = buildAxiosPayload(dirty);
      inFlightRef.current = true;
      try {
        await apiClient.patch(WORLD_SAVE_URL, payload);
        // Mark only the committed ids as saved — mutations that
        // arrived during the flight stay dirty (their
        // lastUpdatedLocalMs > dispatchMs).
        useWorldStore.getState().applySaveCommit(ids, dispatchMs);
      } catch (err) {
        // Silent — this is a background save. Entries stay dirty and
        // retry on the next cycle.
        console.error('[useWorldStore] periodic save failed', err);
      } finally {
        inFlightRef.current = false;
      }
    };

    const intervalId = window.setInterval(() => { void tick(); }, intervalMs);
    return () => { window.clearInterval(intervalId); };
  }, [intervalMs]);

  useEffect(() => {
    const flushOnExit = (): void => {
      const dirty = useWorldStore.getState().getDirtyEntries();
      if (dirty.length === 0) return;
      sendExitPayload(buildBeaconPayload(dirty));
    };
    const onVisibilityChange = (): void => {
      if (document.visibilityState === 'hidden') flushOnExit();
    };
    window.addEventListener('beforeunload', flushOnExit);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      window.removeEventListener('beforeunload', flushOnExit);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, []);
}
