/**
 * Story 6.3 — neon-themed date + time picker.
 *
 * Custom React component (no native browser picker): the panel's
 * design vocabulary is `var(--neon-cyan)` borders, `var(--font-mono)`
 * for chrome text, glowing focus, dim-grid-on-black background.
 * Anchored absolutely by the parent (e.g. InfoPopup's due-date row);
 * this component is concerned only with the picker's internals.
 *
 * Layout (compact, ~260px wide):
 *
 *   ┌── Month header ──────────┐
 *   │  ◀  May 2026         ▶  │
 *   ├── Day grid 7×6 ──────────┤
 *   │  Mo Tu We Th Fr Sa Su   │
 *   │  …                       │
 *   ├── Time row ──────────────┤
 *   │  Hours [ 17 ]  Mins [ 00 ] │
 *   ├── Actions ───────────────┤
 *   │  [ Clear ]    [ Save ]   │
 *   └──────────────────────────┘
 *
 * Inputs are uncontrolled-ish — the picker holds local state for the
 * draft selection and only commits via `onSave(isoString)`. The
 * caller is the source of truth for the persisted value.
 *
 * Time format: 24-hour. Output is an ISO 8601 string with the
 * browser's local timezone offset, suitable for the backend's
 * `DateTime(timezone=True)` column via the existing PATCH endpoint.
 */

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import './NeonDateTimePicker.css';

interface Props {
  /** ISO datetime string of the current value, or null if unset.
   *  Used to seed the picker's initial draft selection. */
  value: string | null;
  /** Fired when the user clicks "Save". Argument is an ISO datetime
   *  string with timezone offset (e.g. "2026-05-01T17:00:00+00:00"). */
  onSave: (iso: string) => void;
  /** Fired when the user clicks "Clear" — request to unset the
   *  deadline. */
  onClear: () => void;
  /** Fired when the user dismisses the picker without committing
   *  (Escape key, click outside). */
  onCancel: () => void;
}

const DAY_LABELS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];
const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/**
 * Build the calendar grid (always 7×6 = 42 cells) for the given
 * year/month. Days from the previous and following month fill the
 * corners so the grid is always rectangular. Each cell carries a
 * Date and an `inMonth` flag for dimming.
 */
interface DayCell {
  date: Date;
  inMonth: boolean;
}

function buildMonthGrid(year: number, month: number): DayCell[] {
  const firstOfMonth = new Date(year, month, 1);
  // JavaScript's getDay returns 0=Sun..6=Sat; we want 0=Mon..6=Sun.
  const firstWeekdayJsSunStart = firstOfMonth.getDay();
  const offsetFromMonday = (firstWeekdayJsSunStart + 6) % 7;
  const gridStart = new Date(year, month, 1 - offsetFromMonday);

  const cells: DayCell[] = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(gridStart);
    d.setDate(gridStart.getDate() + i);
    cells.push({ date: d, inMonth: d.getMonth() === month });
  }
  return cells;
}

function clampHour(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.max(0, Math.min(23, Math.floor(value)));
}

function clampMinute(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.max(0, Math.min(59, Math.floor(value)));
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/**
 * Compose an ISO 8601 string with the browser's local timezone
 * offset from the draft year/month/day/hour/minute. We avoid
 * `toISOString()` because it forces UTC — for a "5pm meeting"
 * deadline the user expects 5pm in their own timezone, not 5pm UTC.
 */
function composeIsoLocal(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = pad2(d.getMonth() + 1);
  const dd = pad2(d.getDate());
  const hh = pad2(d.getHours());
  const mi = pad2(d.getMinutes());
  const ss = '00';
  const tzMins = -d.getTimezoneOffset();
  const tzSign = tzMins >= 0 ? '+' : '-';
  const tzHrs = pad2(Math.floor(Math.abs(tzMins) / 60));
  const tzRem = pad2(Math.abs(tzMins) % 60);
  return `${yyyy}-${mm}-${dd}T${hh}:${mi}:${ss}${tzSign}${tzHrs}:${tzRem}`;
}

export function NeonDateTimePicker({
  value,
  onSave,
  onClear,
  onCancel,
}: Props) {
  // Seed draft state from `value` (or now-rounded-to-next-hour if unset).
  const initial = (() => {
    if (value !== null) {
      const d = new Date(value);
      if (!Number.isNaN(d.getTime())) return d;
    }
    const next = new Date();
    next.setMinutes(0, 0, 0);
    next.setHours(next.getHours() + 1);
    return next;
  })();

  const [year, setYear] = useState(initial.getFullYear());
  const [month, setMonth] = useState(initial.getMonth());
  const [day, setDay] = useState(initial.getDate());
  const [hour, setHour] = useState(initial.getHours());
  const [minute, setMinute] = useState(initial.getMinutes());

  const containerRef = useRef<HTMLDivElement>(null);

  // Dismiss on Escape. Backdrop click is handled directly by the
  // wrapper element below. The picker is rendered modally (portal +
  // dark backdrop) so there's no "outside click" inside the popup
  // any more — only Escape and backdrop click can cancel.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCancel();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [onCancel]);

  const monthGrid = buildMonthGrid(year, month);
  const isSelected = (cell: DayCell): boolean =>
    cell.date.getFullYear() === year &&
    cell.date.getMonth() === month &&
    cell.date.getDate() === day &&
    cell.inMonth;
  const isToday = (cell: DayCell): boolean => {
    const t = new Date();
    return (
      cell.date.getFullYear() === t.getFullYear() &&
      cell.date.getMonth() === t.getMonth() &&
      cell.date.getDate() === t.getDate()
    );
  };

  const stepMonth = (delta: number) => {
    let nextMonth = month + delta;
    let nextYear = year;
    while (nextMonth < 0) {
      nextMonth += 12;
      nextYear -= 1;
    }
    while (nextMonth > 11) {
      nextMonth -= 12;
      nextYear += 1;
    }
    setMonth(nextMonth);
    setYear(nextYear);
  };

  const onPickDay = (cell: DayCell) => {
    setYear(cell.date.getFullYear());
    setMonth(cell.date.getMonth());
    setDay(cell.date.getDate());
  };

  const onSaveClick = () => {
    const composed = new Date(year, month, day, hour, minute, 0, 0);
    onSave(composeIsoLocal(composed));
  };

  // Modal: rendered in a portal at document.body so the picker
  // escapes any z-index / overflow constraints from the InfoPopup
  // (which lives inside an `<Html>` drei container in the 3D scene).
  // Backdrop click fires onCancel; the inner panel stops propagation
  // so clicks inside don't accidentally cancel.
  const modal = (
    <div
      className="neon-dtp-backdrop"
      onClick={onCancel}
      role="presentation"
    >
    <div
      className="neon-dtp"
      ref={containerRef}
      role="dialog"
      aria-modal="true"
      aria-label="Pick due date and time"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="neon-dtp__header">
        <button
          type="button"
          className="neon-dtp__nav-btn"
          onClick={() => stepMonth(-1)}
          aria-label="Previous month"
        >
          ◀
        </button>
        <span className="neon-dtp__month-label">
          {MONTH_NAMES[month]} {year}
        </span>
        <button
          type="button"
          className="neon-dtp__nav-btn"
          onClick={() => stepMonth(1)}
          aria-label="Next month"
        >
          ▶
        </button>
      </div>

      <div className="neon-dtp__day-labels">
        {DAY_LABELS.map((label) => (
          <span key={label} className="neon-dtp__day-label">
            {label}
          </span>
        ))}
      </div>

      <div className="neon-dtp__grid">
        {monthGrid.map((cell, i) => {
          const selected = isSelected(cell);
          const today = isToday(cell);
          return (
            <button
              key={i}
              type="button"
              className={[
                'neon-dtp__cell',
                cell.inMonth ? '' : 'neon-dtp__cell--out',
                selected ? 'neon-dtp__cell--selected' : '',
                today ? 'neon-dtp__cell--today' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              onClick={() => onPickDay(cell)}
              aria-label={cell.date.toDateString()}
              aria-pressed={selected}
            >
              {cell.date.getDate()}
            </button>
          );
        })}
      </div>

      <div className="neon-dtp__time-row">
        <label className="neon-dtp__time-field">
          <span className="neon-dtp__time-label">HH</span>
          <input
            type="number"
            min={0}
            max={23}
            value={pad2(hour)}
            onChange={(e) => setHour(clampHour(Number(e.target.value)))}
            className="neon-dtp__time-input"
            aria-label="Hour (24h)"
          />
        </label>
        <span className="neon-dtp__time-sep">:</span>
        <label className="neon-dtp__time-field">
          <span className="neon-dtp__time-label">MM</span>
          <input
            type="number"
            min={0}
            max={59}
            value={pad2(minute)}
            onChange={(e) => setMinute(clampMinute(Number(e.target.value)))}
            className="neon-dtp__time-input"
            aria-label="Minute"
          />
        </label>
      </div>

      <div className="neon-dtp__actions">
        <button
          type="button"
          className="neon-dtp__btn neon-dtp__btn--clear"
          onClick={onClear}
        >
          Clear
        </button>
        <button
          type="button"
          className="neon-dtp__btn neon-dtp__btn--save"
          onClick={onSaveClick}
        >
          Save
        </button>
      </div>
    </div>
    </div>
  );

  // SSR-safe: only portal when document is available. Tests run in
  // jsdom which provides document.body, so the portal works there
  // too.
  if (typeof document === 'undefined') return modal;
  return createPortal(modal, document.body);
}
