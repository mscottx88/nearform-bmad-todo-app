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
}

// Story 6.3: rephrase suggestions can target `text` or `due_date`.
// The backend's TodoUpdate schema rejects anything else with 422 due
// to the `extra="forbid"` config; reject unsupported fields
// client-side too so the user sees a helpful chip instead of a silent
// 422.
const SUPPORTED_FIELDS: ReadonlySet<string> = new Set(['text', 'due_date']);

// LLM produces `field="due_date"` (snake_case wire shape from the
// Pydantic model) but the frontend mutation hook expects `dueDate`
// (camelCase, axios's decamelize-keys interceptor handles the wire
// flip back to snake on the request body). Map suggestion field
// names to the mutation hook's input key.
const MUTATION_FIELD_KEY: Record<string, string> = {
  text: 'text',
  due_date: 'dueDate',
};

function SuggestionBlock({
  suggestion,
  targetId,
  liveText,
  liveDueDate,
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
  //     LLM's `original` for an empty date is "".
  let stale = false;
  if (suggestion.field === 'text') {
    stale = liveText !== undefined && liveText !== suggestion.original;
  } else if (suggestion.field === 'due_date') {
    if (liveDueDate !== undefined) {
      const liveValue = liveDueDate ?? '';
      stale = liveValue !== suggestion.original;
    }
  }

  const unsupportedField = !SUPPORTED_FIELDS.has(suggestion.field);

  const acceptDisabled =
    applied || dismissed || stale || unsupportedField || targetId === undefined;
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
        <span className="rephrase-proposal__original">{suggestion.original}</span>
        <span className="rephrase-proposal__arrow" aria-hidden="true">
          →
        </span>
        <span className="rephrase-proposal__revised">{suggestion.revised}</span>
      </div>
      <div className="rephrase-proposal__reason">{suggestion.reason}</div>
      {stale && (
        <div className="rephrase-proposal__stale-chip">[stale]</div>
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

  // Coalesce to empty arrays once so the rest of the function doesn't
  // need to chain `?.length` / `?.map` checks. Older proposal rows or
  // partial server payloads may omit either key.
  const suggestions = payload.suggestions ?? [];
  const missingFields = payload.missing_fields ?? [];
  const candidates = payload.candidates ?? [];

  // Re-fire the rephrase skill with an explicit todo target when the
  // user clicks a candidate chip. Reads from the store imperatively
  // (via getState) inside the click handler so the component stays
  // re-render-cheap — no subscription needed for one-shot dispatch.
  const onPickCandidate = (candidate: Candidate) => {
    const store = useAgentStore.getState();
    void store.sendMessage('rephrase this', {
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
