/**
 * Story 6.3: renderer for the `text_rewrite` proposal kind.
 *
 * Mounts BELOW the assistant bubble (sibling, not descendant) when an
 * assistant message arrives with `metadata.proposal.kind === 'text_rewrite'`.
 * AgentMessage.tsx owns the kind-switch and passes the payload + targets
 * here.
 *
 * v1 only renders for the `text` field; the schema is widened so future
 * field types (notes, etc.) can extend the per-suggestion block without
 * changing the wire envelope.
 *
 * Local-state-only persistence: `applied` and `dismissed` reset on
 * unmount/remount per AC 5. Accepted suggestions persist server-side
 * via the existing `PATCH /api/todos/{id}` mutation; dismissed
 * suggestions are NOT persisted (the renderer is the source of truth
 * for "dismiss"). Reload → suggestions are pending again, and a
 * staleness check (live todo text vs `original`) flags rows where the
 * underlying todo has drifted.
 */

import { useState } from 'react';
import { useTodos, useUpdateTodo } from '../../api/todoApi';
import { useAgentStore } from '../../stores/useAgentStore';
import './RephraseProposal.css';

interface Suggestion {
  field: string;
  original: string;
  revised: string;
  reason: string;
}

interface Candidate {
  id: string;
  text: string;
}

interface RephrasePayload {
  // Both arrays are nominally always present (the backend's
  // RephraseEnvelope sets defaults), but proposal envelopes from
  // older chat_messages rows or partial server responses may be
  // missing them — `?` keeps the renderer defensive.
  suggestions?: Suggestion[];
  missing_fields?: string[];
  // Story 6.3 user-driven enhancement: server-side search resolver
  // surfaces ambiguous matches as clickable chips.
  candidates?: Candidate[];
}

interface Props {
  payload: RephrasePayload;
  targets: string[];
}

const MISSING_FIELD_COPY: Record<string, string> = {
  due_date: 'Consider adding a due date — no deadline mentioned',
};

function fallbackMissingCopy(field: string): string {
  return `Consider adding ${field.replace(/_/g, ' ')}`;
}

interface SuggestionBlockProps {
  suggestion: Suggestion;
  targetId: string | undefined;
  /** Live todo's `text` for the text-suggestion staleness check
   *  (undefined ⇒ skip). */
  liveText: string | undefined;
  /** Live todo's `dueDate` for the due_date-suggestion staleness check
   *  (undefined ⇒ todo not in cache, skip; null ⇒ no date set). */
  liveDueDate: string | null | undefined;
  /** True when `useTodos` has loaded and the target id is NOT present
   *  in the active list — the underlying todo was deleted or completed
   *  after proposal generation. Distinct from "loading / cache miss". */
  liveTargetMissing: boolean;
  /** True while `useTodos` is fetching or has errored — staleness can't
   *  be determined yet, so Accept is disabled defensively. */
  liveTargetLoading: boolean;
}

// LLM produces `field="due_date"` (snake_case wire shape from the
// Pydantic model) but the frontend mutation hook expects `dueDate`
// (camelCase, axios's decamelize-keys interceptor handles the wire
// flip back to snake on the request body). Map suggestion field
// names to the mutation hook's input key. The KEYS of this map are
// the SOURCE OF TRUTH for which `field` values the renderer accepts —
// `SUPPORTED_FIELDS` derives from it so adding a new entry here is a
// one-line change in this single map.
const MUTATION_FIELD_KEY: Record<string, string> = {
  text: 'text',
  due_date: 'dueDate',
};

// CR: derive the supported-field allowlist from the mutation map so
// the two cannot drift independently. The backend's TodoUpdate schema
// rejects anything outside its own allowlist with 422; this client-side
// check shows a helpful chip first.
const SUPPORTED_FIELDS: ReadonlySet<string> = new Set(
  Object.keys(MUTATION_FIELD_KEY),
);

/**
 * Compare a live ISO datetime string against the LLM's `original`.
 * String equality is wrong here — `"2026-05-01T17:00:00+00:00"` and
 * `"2026-05-01T17:00:00Z"` represent the same instant but mismatch
 * byte-for-byte. We normalise via `Date.getTime()` and treat NaN
 * (unparseable) as a hard mismatch.
 */
function dueDatesEqual(a: string, b: string): boolean {
  if (a === b) return true; // fast path; also handles "" === ""
  if (a === '' || b === '') return false; // one side unset, other set → not equal
  const ta = new Date(a).getTime();
  const tb = new Date(b).getTime();
  if (Number.isNaN(ta) || Number.isNaN(tb)) return false;
  return ta === tb;
}

function SuggestionBlock({
  suggestion,
  targetId,
  liveText,
  liveDueDate,
  liveTargetMissing,
  liveTargetLoading,
}: SuggestionBlockProps) {
  const [applied, setApplied] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const updateTodo = useUpdateTodo();

  // AC 5: stale = the underlying todo has drifted from the LLM's
  // `original`. We disable Accept in that case so the user doesn't
  // overwrite a fresh edit with a now-irrelevant rewrite. Pick the
  // staleness reference based on which field the suggestion targets:
  //   - text → compare against live todo's text.
  //   - due_date → compare against live todo's dueDate (null ⇒ "");
  //     LLM's `original` for an empty date is "". Comparison goes
  //     through `dueDatesEqual` so format drift (`+00:00` vs `Z`,
  //     microseconds) doesn't read as stale.
  let stale = false;
  if (suggestion.field === 'text') {
    stale = liveText !== undefined && liveText !== suggestion.original;
  } else if (suggestion.field === 'due_date') {
    if (liveDueDate !== undefined) {
      const liveValue = liveDueDate ?? '';
      stale = !dueDatesEqual(liveValue, suggestion.original);
    }
  }

  const unsupportedField = !SUPPORTED_FIELDS.has(suggestion.field);

  // CR: explicit "the underlying todo is gone" state. `useTodos`
  // returns active rows only — once the query has settled and the
  // target id isn't present, the todo was completed or soft-deleted
  // after the proposal generated. Disable Accept so the user can't
  // PATCH a hidden row, and surface a distinct chip.
  const acceptDisabled =
    applied ||
    dismissed ||
    stale ||
    unsupportedField ||
    targetId === undefined ||
    liveTargetMissing ||
    liveTargetLoading ||
    updateTodo.isPending;
  const dismissDisabled = applied || dismissed;

  const onAccept = () => {
    if (acceptDisabled || targetId === undefined) return;
    setErrorMsg(null);
    // Map the LLM's snake_case field name (`due_date`) to the
    // mutation hook's camelCase input key (`dueDate`). axios's
    // decamelize-keys request interceptor flips it back to snake_case
    // on the wire so the backend's `TodoUpdate.due_date` field
    // receives it.
    const mutationKey =
      MUTATION_FIELD_KEY[suggestion.field] ?? suggestion.field;
    updateTodo.mutate(
      { id: targetId, [mutationKey]: suggestion.revised },
      {
        onSuccess: () => setApplied(true),
        onError: (err) => {
          // Surface PATCH failures (network drop, 422 from a future
          // field that slipped past `SUPPORTED_FIELDS`, etc.) instead
          // of silently leaving the suggestion in a "pending" state.
          setErrorMsg(err instanceof Error ? err.message : 'Failed to apply');
        },
      },
    );
  };

  const onDismiss = () => {
    if (dismissDisabled) return;
    setDismissed(true);
  };

  return (
    <div
      className={[
        'rephrase-proposal__suggestion',
        applied ? 'rephrase-proposal__suggestion--applied' : '',
        dismissed ? 'rephrase-proposal__suggestion--dismissed' : '',
        stale ? 'rephrase-proposal__suggestion--stale' : '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <div className="rephrase-proposal__diff">
        <span
          className={[
            'rephrase-proposal__original',
            suggestion.original === '' ? 'rephrase-proposal__original--unset' : '',
          ]
            .filter(Boolean)
            .join(' ')}
        >
          {/* CR: render "(none)" for an empty `original` (e.g. setting
              a due_date for the first time) so the diff doesn't read
              as a leading-arrow "→ revised" with a blank left side. */}
          {suggestion.original === '' ? '(none)' : suggestion.original}
        </span>
        <span className="rephrase-proposal__arrow" aria-hidden="true">
          →
        </span>
        <span className="rephrase-proposal__revised">{suggestion.revised}</span>
      </div>
      <div className="rephrase-proposal__reason">{suggestion.reason}</div>
      {stale && (
        <div className="rephrase-proposal__stale-chip">[stale]</div>
      )}
      {liveTargetMissing && (
        <div className="rephrase-proposal__stale-chip">
          [todo no longer exists]
        </div>
      )}
      {unsupportedField && (
        <div className="rephrase-proposal__stale-chip">
          [unsupported field: {suggestion.field}]
        </div>
      )}
      {errorMsg !== null && (
        <div className="rephrase-proposal__error">⚠ {errorMsg}</div>
      )}
      {applied ? (
        <div className="rephrase-proposal__applied-chip">✓ applied</div>
      ) : (
        <div className="rephrase-proposal__actions">
          <button
            type="button"
            className="rephrase-proposal__btn rephrase-proposal__btn--accept"
            onClick={onAccept}
            disabled={acceptDisabled}
            aria-label="Accept rewrite"
          >
            ✓
          </button>
          <button
            type="button"
            className="rephrase-proposal__btn rephrase-proposal__btn--dismiss"
            onClick={onDismiss}
            disabled={dismissDisabled}
            aria-label="Dismiss rewrite"
          >
            ×
          </button>
        </div>
      )}
    </div>
  );
}

export function RephraseProposal({ payload, targets }: Props) {
  const targetId = targets[0];

  // Pull live todo for the staleness check. Hook is unconditional
  // (Rules of Hooks); the targetId-undefined / cache-miss case
  // collapses both `liveText` and `liveDueDate` to undefined and
  // `SuggestionBlock` skips the check.
  const todosQuery = useTodos();
  const liveTarget = todosQuery.data?.find((t) => t.id === targetId);
  const liveText = liveTarget?.text;
  const liveDueDate = liveTarget ? liveTarget.dueDate : undefined;
  // CR: distinguish "we're still fetching" from "we know the target is
  // gone". Without this, a soft-deleted target slips through Accept
  // because the cache-miss branch silently skipped the staleness check.
  const liveTargetLoading = todosQuery.isLoading || todosQuery.isError;
  const liveTargetMissing =
    !liveTargetLoading &&
    targetId !== undefined &&
    todosQuery.data !== undefined &&
    liveTarget === undefined;

  // Coalesce to empty arrays once so the rest of the function doesn't
  // need to chain `?.length` / `?.map` checks. Older proposal rows or
  // partial server payloads may omit either key.
  const suggestions = payload.suggestions ?? [];
  const missingFields = payload.missing_fields ?? [];
  const candidates = payload.candidates ?? [];

  // Re-fire the rephrase skill with an explicit todo target when the
  // user clicks a candidate chip. CR: reuse the user's ORIGINAL prompt
  // (the most recent user message in the chat) instead of a hardcoded
  // "rephrase this" — otherwise a question like "make this about
  // staging not prod" would be lost on the second turn and the LLM
  // would do a generic rewrite. We read the prompt imperatively (via
  // getState) so the component stays subscription-light.
  const onPickCandidate = (candidate: Candidate) => {
    const store = useAgentStore.getState();
    const lastUserMessage = [...store.messages]
      .reverse()
      .find((m) => m.role === 'user');
    void store.sendMessage(lastUserMessage?.content ?? 'rephrase this', {
      todoIds: [candidate.id],
      skill: 'rephrase',
    });
  };

  // Empty render path: no suggestions AND no missing-field hints AND
  // no candidates means the bubble's prose alone is the response.
  // Keeps the DOM clean for the empty-target fallback ("I'm not sure
  // which one you mean").
  const hasSuggestions = suggestions.length > 0;
  const hasMissing = missingFields.length > 0;
  const hasCandidates = candidates.length > 0;
  if (!hasSuggestions && !hasMissing && !hasCandidates) return null;

  return (
    <div className="rephrase-proposal">
      {hasSuggestions && (
        <>
          <div className="rephrase-proposal__header">Suggested rewrite</div>
          {suggestions.map((s, i) => (
            <SuggestionBlock
              key={i}
              suggestion={s}
              targetId={targetId}
              liveText={liveText}
              liveDueDate={liveDueDate}
              liveTargetLoading={liveTargetLoading}
              liveTargetMissing={liveTargetMissing}
            />
          ))}
        </>
      )}
      {hasCandidates && (
        <div className="rephrase-proposal__candidates">
          <div className="rephrase-proposal__header">Pick a todo</div>
          <div className="rephrase-proposal__candidate-chips">
            {candidates.map((c) => (
              <button
                key={c.id}
                type="button"
                className="rephrase-proposal__candidate-chip"
                onClick={() => onPickCandidate(c)}
              >
                {c.text}
              </button>
            ))}
          </div>
        </div>
      )}
      {hasMissing && (
        <div className="rephrase-proposal__missing">
          {missingFields.map((field, i) => (
            <div key={i} className="rephrase-proposal__missing-row">
              ⚠ {MISSING_FIELD_COPY[field] ?? fallbackMissingCopy(field)}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
