/** Format an ISO timestamp as "YYYY-MM-DD HH:mm" in local time. */
export function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    ` ${pad(d.getHours())}:${pad(d.getMinutes())}`
  );
}

/** Return a relative-time hint string, snapshotted at call time (no live ticking). */
export function formatRelative(iso: string): string {
  const now = Date.now();
  const then = new Date(iso).getTime();
  const diffMs = now - then;
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
