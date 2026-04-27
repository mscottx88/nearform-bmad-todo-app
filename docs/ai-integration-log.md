# AI Integration Log

How AI tooling — and specifically Anthropic's Claude — was used during
the development of the Pond Todo project. This is the audit trail for
the **Documentation → AI integration log** success criterion.

**Window covered:** 2026-04-14 (initial commit) → 2026-04-27 (current).

---

## At a glance

| Metric | Value |
|---|---|
| Total commits | 283 |
| Commits co-authored by Claude | 277 (97.9%) |
| Commits without AI co-author | 6 (initial scaffolding + a few human-only edits) |
| Distinct Claude models that signed commits | 3 |
| Active development days | ~14 |

**Model attribution from commit trailers** (`Co-Authored-By: Claude …`):

| Model | Commits | Notes |
|---|---:|---|
| `claude-opus-4-7`  (Opus 4.7) | 207 | Default driver model from 2026-04-26 onwards. Highest-capability model in the Claude 4 family. |
| `claude-sonnet-4-6` (Sonnet 4.6) | 49 | Used for code review passes and lighter-weight refactors where Opus was overkill. |
| `claude-opus-4-6`  (Opus 4.6) | 22 | Default driver before 4.7 became available. |

Roughly 95% of the production code under [`backend/src/`](../backend/src/)
and [`frontend/src/`](../frontend/src/) was authored or refactored by
an AI agent operating within the BMad-method workflow described
below. Tests, comments, and design notes were authored under the same
workflow, with human review at each story checkpoint.

---

## Tooling

| Layer | Tool | Role |
|---|---|---|
| Agent harness | **Claude Code** (CLI) running in a VSCode-attached terminal | Driver agent — read-write filesystem access, runs shell, commits via git. |
| Method | **[BMad Method](https://docs.bmad-method.org/llms.txt)** v6.3 (BMM module) | Phase + skill structure: planning artefacts → epics + stories → dev cycle → code review → retrospective. |
| Story format | BMad story templates with explicit Acceptance Criteria, Tasks, Dev Notes, Dev Agent Record, File List, Change Log | Each story is a self-contained unit the dev-agent can execute end-to-end without ambient context. |
| Model API | **Anthropic Claude 4.x** (Opus + Sonnet) via the Claude Code harness | All implementation, review, and planning passes. |
| In-app agent | **CrewAI 1.14** with the `[anthropic]` extra; backend skills (`chat`, `rephrase`, `create_todo`, etc.) call Claude via the same SDK | Powers the agent panel inside the running app — see [`backend/src/agent/`](../backend/src/agent/). |

The user-facing agent panel (Epic 6, stories 6-1 through 6-12) is a
separate concern from the developer-facing AI tooling — it ships
Claude as a feature of the product. See
[`prd.md`](../_bmad-output/planning-artifacts/prd.md) §
"Intelligent Pond Companion" for the user-facing scope.

---

## BMad skills exercised

The repository ships a configured BMad Method module at
[`_bmad/`](../_bmad/) with skills installed under
[`.claude/skills/bmad-*`](../.claude/skills/). Skills used during
this project:

### Planning phase (1-2)

- `bmad-create-prd` — produced
  [`prd.md`](../_bmad-output/planning-artifacts/prd.md) over a guided
  multi-step elicitation session.
- `bmad-create-architecture` — produced
  [`architecture.md`](../_bmad-output/planning-artifacts/architecture.md).
- `bmad-create-ux-design` — produced
  [`ux-design-specification.md`](../_bmad-output/planning-artifacts/ux-design-specification.md).
- `bmad-validate-prd` — gate before solutioning; output in
  [`prd-validation-report.md`](../_bmad-output/planning-artifacts/prd-validation-report.md).
- `bmad-create-epics-and-stories` — broke the PRD into 8 epics in
  [`epics.md`](../_bmad-output/planning-artifacts/epics.md).
- `bmad-check-implementation-readiness` — pre-implementation gate
  ([`implementation-readiness-report-2026-04-14.md`](../_bmad-output/planning-artifacts/implementation-readiness-report-2026-04-14.md),
  [`implementation-readiness-report-2026-04-16.md`](../_bmad-output/planning-artifacts/implementation-readiness-report-2026-04-16.md)).

### Implementation phase (4)

- `bmad-sprint-planning` — produced
  [`sprint-status.yaml`](../_bmad-output/implementation-artifacts/sprint-status.yaml).
- `bmad-create-story` — generated each story spec with full
  Acceptance Criteria + Dev Notes context.
- `bmad-dev-story` — executed the implementation cycle for each
  story end-to-end (red-green-refactor TDD, file edits, tests,
  quality gates).
- `bmad-code-review` — adversarial review pass in a fresh context
  window with a different model (per the workflow's "different LLM"
  recommendation).
- `bmad-correct-course` — used for two mid-sprint pivots (see
  [`sprint-change-proposal-2026-04-16.md`](../_bmad-output/planning-artifacts/sprint-change-proposal-2026-04-16.md)
  + [`sprint-change-proposal-2026-04-23.md`](../_bmad-output/planning-artifacts/sprint-change-proposal-2026-04-23.md)).

### Anytime / utility

- `bmad-help` — orientation between phases.
- `bmad-quick-dev` — small, scope-bounded changes that didn't
  warrant a full story (e.g. README + coverage tooling).

---

## Workflow shape per story

Each numbered story in
[`_bmad-output/implementation-artifacts/`](../_bmad-output/implementation-artifacts/)
follows the same lifecycle:

1. **Create** (`bmad-create-story`) — generates the story spec from
   the relevant epic, fills in Acceptance Criteria, Tasks, Dev Notes
   (architecture references, prior-art snippets, file paths). Status
   → `ready-for-dev`.
2. **Validate** (`bmad-create-story:validate`, optional) — quality
   gate on the story itself before any code is written.
3. **Dev** (`bmad-dev-story`) — fresh-context dev agent picks up the
   story, runs red-green-refactor through every Task, runs lint +
   type-check + test gates, marks the story `review`. Per
   [`CLAUDE.md`](../CLAUDE.md), checkpoint commits are made at each
   completed task and at quality-gate boundaries.
4. **Review** (`bmad-code-review`) — adversarial review in a fresh
   context with a **different model** than the dev agent
   (Sonnet-reviewed-Opus or vice versa). Findings written back into
   the story file's "Senior Developer Review (AI)" section as
   actionable items with severities. Status returns to `in-progress`
   if changes requested; `done` once all action items checked off.
5. **Retrospective** (`bmad-retrospective`, at epic close) — drains
   `deferred-work.md` and gates the epic's transition to `done`.

The Dev Agent Record + Change Log inside each story file are the
canonical record of what each AI session did. Skim any story under
[`_bmad-output/implementation-artifacts/`](../_bmad-output/implementation-artifacts/)
for a worked example —
[`6-9-chat-panel-resizable.md`](../_bmad-output/implementation-artifacts/6-9-chat-panel-resizable.md)
is a good reference (covers planning, dev, code-review-style
refinement, and post-AC user feedback in one file).

---

## Commit conventions

Every AI-assisted commit ends with a `Co-Authored-By:` trailer
identifying the exact Claude model used:

```
Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
```

This makes the AI authorship grep-able. Examples:

```bash
# All AI-assisted commits
git log --grep "Co-Authored-By: Claude"

# Per-model breakdown
git log --pretty=format:'%b' | grep -oE "Claude (Sonnet|Opus|Haiku) [0-9.]+" | sort | uniq -c

# Per-day AI activity
git log --pretty=format:'%ad' --date=short --grep "Co-Authored-By: Claude" | sort | uniq -c
```

Commit messages themselves follow Conventional Commits
(`feat`, `fix`, `chore`, etc.), enforced by a pre-commit hook. The
*content* of the message — the rationale lines, the design notes —
is generated by the agent and reviewed by the human committer
before push.

---

## Standing engineering rules ([`CLAUDE.md`](../CLAUDE.md))

The repository's [`CLAUDE.md`](../CLAUDE.md) carries non-negotiable
project rules that every AI agent invocation reads on startup:

- **Checkpoint commits** at task / quality-gate boundaries —
  enables `git diff` based failure diagnosis.
- **Conventional Commit** format for every message.
- **Thread-based concurrency only** — `async`/`await`/`asyncio` are
  prohibited project-wide. Enforced in code review.
- **Strict typing** — backend is `mypy --strict` clean; frontend is
  `tsc --noEmit` clean.

These rules exist primarily because they mitigate AI-specific failure
modes (sprawling diffs, unprincipled abstractions, mixing sync/async
in the same module) that a less-rule-constrained workflow would
permit.

---

## Lessons / what worked

- **Small story cycles + adversarial code review with a different
  model** is the single most-leveraged practice. Catches a much
  larger class of bugs than single-model loops.
- **Structured story templates** (full ACs, Dev Notes, Tasks, File
  List) eliminate the ambient-context problem — a fresh dev agent
  can pick up any story without prior conversation history.
- **`CLAUDE.md` standing rules** prevent recurring drift (the
  thread-based concurrency rule has been re-justified mid-story
  more than once; having it in `CLAUDE.md` short-circuits the
  re-litigation).
- **Pre-commit hooks** enforce the rules even when a model would
  otherwise skip them under user pressure.

## Lessons / what didn't

- **Pure async-elimination wasn't always natural** — a few sites
  needed careful redesign to fit thread-based concurrency. Captured
  in story dev notes; not a regret in retrospect.
- **Coverage thresholds were retrofitted** — adding the gate as a
  follow-up (this commit) rather than as Story 1.1 scaffolding.
  Future projects: bake `pytest-cov` + `@vitest/coverage-v8` into the
  initial scaffolding story.

---

*This log is hand-curated but the underlying commit data is
reproducible — see the `git log` recipes above. Refresh as the
project evolves.*

*Last updated: 2026-04-27.*
