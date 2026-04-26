/**
 * Format an ISO timestamp as "YYYY-MM-DD HH:mm" in local time.
 * Returns "—" for invalid input (missing, malformed, or NaN) so UI
 * consumers can't accidentally render "NaN-NaN-NaN NaN:NaN".
 */
export function formatTimestamp(iso: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const pad = (n: number): string => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    ` ${pad(d.getHours())}:${pad(d.getMinutes())}`
  );
}

/**
 * Relative-time hint snapshotted at call time (no live ticking).
 * Invalid input returns an empty string. Future timestamps (negative
 * diff — clock skew between server and client) are normalized via
 * `Math.abs` so they still read as a sensible amount of time rather
 * than collapsing to "just now".
 */
export function formatRelative(iso: string): string {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const diffMs = Math.abs(Date.now() - then);
  const diffMins = Math.floor(diffMs / 60_000);
  if (diffMins < 1) return '(just now)';
  if (diffMins < 60) return `(${diffMins}m ago)`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `(${diffHours}h ago)`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 14) return `(${diffDays}d ago)`;
  const diffWeeks = Math.floor(diffDays / 7);
  if (diffWeeks < 8) return `(${diffWeeks} weeks ago)`;
  return `(on ${formatTimestamp(iso).slice(0, 10)})`;
}

/**
 * Story 6.3: format a due deadline (ISO datetime string with
 * timezone, e.g. "2026-05-01T17:00:00+00:00") for the InfoPopup.
 * Renders "YYYY-MM-DD HH:mm" plus a relative day-bucket hint:
 * "today", "tomorrow", "in 4d", "overdue 2d", etc.
 *
 * **Viewer-local timezone:** the day-bucket comparison snaps both
 * timestamps to LOCAL midnight, so a Sydney user and a London user
 * looking at the same UTC instant may see different buckets when the
 * deadline straddles their respective midnight. This is intentional
 * — the user wants "is this due today _for me_". The exact ISO
 * datetime is rendered alongside, so the underlying value is always
 * unambiguous.
 *
 * **DST-safe day diff:** computing `(due - today) / 86_400_000`
 * across a DST boundary yields 23 or 25 hours instead of 24, and
 * `Math.round` flips the bucket. We compare ordinal calendar-day
 * indices (`Date.UTC(local Y, local M, local D)` rounded to days)
 * which is purely calendar-based and stable across DST.
 */
export function formatDueDate(iso: string): string {
  if (!iso) return '—';
  const due = new Date(iso);
  if (Number.isNaN(due.getTime())) return '—';

  const todayIndex = calendarDayIndex(new Date());
  const dueIndex = calendarDayIndex(due);
  const diffDays = dueIndex - todayIndex;

  let hint: string;
  if (diffDays === 0) hint = '(today)';
  else if (diffDays === 1) hint = '(tomorrow)';
  else if (diffDays === -1) hint = '(yesterday — overdue 1d)';
  else if (diffDays > 1) hint = `(in ${diffDays}d)`;
  else hint = `(overdue ${Math.abs(diffDays)}d)`;

  // Reuse formatTimestamp for the "YYYY-MM-DD HH:mm" rendering so
  // both Created/Updated and Due rows look consistent.
  return `${formatTimestamp(iso)} ${hint}`;
}

/**
 * Ordinal calendar-day index that increments by exactly 1 between
 * consecutive LOCAL-time calendar days. Stable across DST.
 */
function calendarDayIndex(d: Date): number {
  return Math.floor(
    Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86_400_000,
  );
}
