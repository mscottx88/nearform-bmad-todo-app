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
