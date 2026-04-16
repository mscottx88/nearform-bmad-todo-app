---
workflow: correct-course
date: 2026-04-16
trigger: PRD simplification — creature-based controls dropped, Action Popup introduced
scope: Major (full rescope of Epics 2, 4, 6, 7 + architecture + UX spec)
approvalStatus: APPROVED (incremental review)
---

# Sprint Change Proposal — 2026-04-16

**Author:** Michael
**Mode:** Incremental (proposal-by-proposal approval)
**Source trigger:** PRD edit on 2026-04-16 dropping creature-based controls (egg, aphid, chameleon, trash lizard) in favor of an in-scene neon wireframe Action Popup and a unified dissolve visual.

---

## Section 1: Issue Summary

**Problem statement:** During Story 2.3 (Completion Egg — Hatch to Complete) implementation, the developer determined that the intricate 3D animation quality for creature-based controls (egg hatch with cracking/wobble, aphid wake-sleep-eat-burp, chameleon color-shift, trash lizard regurgitate) could not meet the product's polish bar, and iteration cost per animation was disproportionate to the value. Evidence: repeated iteration on egg crack animation (commit `12391f0`), uncommitted debugging on `CompletionEgg.tsx`, `Firefly.tsx`, `WaterStrider.tsx`, `LilyPad.tsx`, `PondCamera.tsx`; direct developer statement that "3D animations are not realistic and taking way too long to iterate... end result is not good."

**Category:** Failed approach requiring different solution + Technical limitation discovered during implementation.

**Discovery context:** Found mid-Epic 2 execution after Stories 2.1 (backend CRUD) and 2.2 (lily pad drop) completed successfully and Story 2.3 (completion egg) was marked done with acknowledged quality issues.

---

## Section 2: Impact Analysis

### Epic Impact

| Epic | Status | Action |
|---|---|---|
| Epic 1 — Living Pond | Done | No change |
| Epic 2 — Todo Life | In progress | Stories 2.3-2.5 rewritten; 2.6 kept |
| Epic 3 — Exploring | Backlog | No change |
| Epic 4 — Organizing | Backlog | Story 4.1 rewritten (chameleon → popup swatch); 4.2, 4.3 unchanged |
| Epic 5 — Search | Backlog | Minor: exclude completed/deleted from search results |
| **Epic 6 — Pond Keeper** | Backlog | **Removed entirely** |
| Epic 7 — Ecosystem | Backlog | Story 7.2 rewritten (rarity via popup Complete, not egg); "resident" tier removed |
| Epic 8 — Soundscape | Backlog | Minor: "crunch on delete" → "soft pad-dissolve" |

### Story-level impact

- **Superseded (done):** Story 2.3 Completion Egg — renamed `.superseded.md` with pointer to replacement
- **Replaced (backlog):** 2.4 (aphid → popup delete), 2.5 (state viz → popup primitive), 4.1 (chameleon → popup swatch)
- **Removed entirely:** 6.1 (trash lizard belly), 6.2 (auto-archive), 6.3 (first-run tutorial)
- **New:** 2.3 Completion via Popup, 2.4 Deletion via Popup, 2.5 In-Scene Action Popup, 4.1 Popup Color Swatch

### Artifact impact

- **PRD** — already updated and validated (5/5) on 2026-04-16
- **Architecture** — ~30 edits (schema deprecation comments, API endpoints removed, component tree rewritten, hooks renamed, traceability table updated, tutorial sections removed)
- **UX spec** — ~20 edits (creature controls section replaced with Action Popup, Flows 1/4/5 rewritten, sound descriptors updated, tutorial flow removed)
- **Epics document** — Epic 2 + Epic 4 + Epic 7 story rewrites; Epic 6 deleted; FR coverage map updated
- **Sprint status** — superseded markers, renamed stories, Epic 6 block removed
- **Implementation code** — Story 2.3 implementation work (CompletionEgg.tsx, useCreatureHatch.ts, egg backend endpoints) to be removed during new Story 2.3 execution; `PondCamera.tsx` uncommitted optimization kept and committed separately

---

## Section 3: Recommended Approach

**Selected: Hybrid — Direct Adjustment (rewrite stories in-place) + partial PRD MVP Review (already applied)**

**Rationale:**
- PRD edit already completed the scope review — no further MVP reconsideration needed
- Direct adjustment is lowest-risk: architecture mostly aligns (schema supports soft-state transitions natively; `deleted` column already present)
- Git history preserved (commits 339c2ec, 12391f0) — reverting creates churn without value since replacement code will delete the components anyway
- PondCamera optimization is directly useful for the new popup model — keep it

**Effort:** Medium. **Risk:** Low — the popup primitive is a narrower scope than four separate creature interactions; replacing a fragile animation-heavy component set with one reusable primitive net-reduces surface area.

**Alternatives considered:**
- *Full rollback of Story 2.3 commits* — unnecessary; rewrite forward is cleaner
- *Defer trash/archive to post-MVP* — rejected in favor of full removal since the code path was custom-built around the lizard; future re-intro would be a clean rebuild

---

## Section 4: Detailed Change Proposals (applied)

### Proposal 1 — Epic 2 story rewrite ✓
- 2.3 → "Completion via Popup — Green Flash + Dissolve" (supersedes prior done story)
- 2.4 → "Deletion via Popup — Red Flash + Dissolve" (replaces aphid)
- 2.5 → "In-Scene Neon Wireframe Action Popup" (new primitive; density folded in)
- 2.6 → unchanged

### Proposal 2 — Epic 4 Story 4.1 rewrite ✓
- "Color Chameleon & Neon Picker" → "Popup Color Swatch — Neon Selector"

### Proposal 3 — Remove Epic 6 entirely ✓
- Dropped: trash lizard, belly recovery, auto-archive, first-run tutorial
- Onboarding delegated to Story 1.4 empty-pond hint

### Proposal 4 — Epic 7 Story 7.2 rewrite ✓
- Rarity triggered by popup Complete action instead of egg hatch
- "Resident" tier removed (was lizard-only)

### Proposal 5 — Architecture updates ✓ (~30 edits)
- Schema: `archived`, `archived_at` marked deprecated (not dropped)
- API: removed `/restore`, `/api/trash`, `POST /api/creatures`
- Components: removed 4 creature components + 2 UI panels; added ActionPopup + 2 sub-components
- Hooks: removed 3 hooks; added 3 popup-focused hooks
- Auto-archive service removed; `ARCHIVE_THRESHOLD_DAYS` env var removed
- Tutorial flow, tutorial-complete flag, "resident" rarity tier all removed
- Traceability table: updated FR ranges, removed Trash & Archive row

### Proposal 6 — UX spec updates ✓ (~20 edits)
- Creature Controls section replaced with Action Popup section
- Trash lizard pond resident removed
- Flow 1 (First Encounter) rewritten without tutorial
- Flow 4 (Grouping), Flow 5 (Demo) rewritten with popup
- "Creature Interaction Pattern" → "Pad Interaction Pattern"
- Sound design descriptor: "crunch" → "soft pad-dissolve"

### Proposal 7 — Story 2.3 code disposition ✓
- Git history preserved
- Superseded story file renamed with pointer
- New story file created with detailed popup-based AC
- PondCamera.tsx uncommitted optimization flagged to keep (separate commit by user)
- Other uncommitted files (CompletionEgg, Firefly, WaterStrider, LilyPad) flagged for user's manual `git restore`

### Proposal 8 — Sprint-status.yaml ✓
- Story 2.3 marked `superseded` (was `done`)
- New stories added with `backlog` status
- Epic 6 block removed
- Story names renamed to match new intents

---

## Section 5: Implementation Handoff

**Scope classification:** **Major** — touches PRD, architecture, UX spec, epics, sprint plan, and in-flight code.

**Handoff recipients and responsibilities:**

### Developer (Michael)
- **Manual git steps (destructive, not taken by correct-course):**
  - Commit the kept `PondCamera.tsx` optimization as its own commit
  - `git restore` the debugging diffs on `CompletionEgg.tsx`, `Firefly.tsx`, `WaterStrider.tsx`, `LilyPad.tsx`
- **Fresh-context story execution** (recommended order):
  1. Story 2.5 (In-Scene Action Popup) — the foundational primitive
  2. Story 2.3 (Completion via Popup) — depends on 2.5; includes deletion of egg-hatch code
  3. Story 2.4 (Deletion via Popup) — shares dissolve animation with 2.3
  4. Story 4.1 (Popup Color Swatch) — extends popup
  5. Story 7.2 (Rarity rework) — can land alongside 2.3
  6. Epic 3, 4.2, 4.3, Epic 5, Epic 8 — unchanged sequencing

### Implementation readiness (IR workflow)
- Re-run `bmad-check-implementation-readiness` once epics/architecture/UX are aligned to verify alignment with updated PRD before resuming dev work

### Success criteria for this correct-course execution
- ✓ All 8 proposals applied
- ✓ PRD validated 5/5 with simplified model
- ✓ Architecture + UX + epics + sprint plan consistent with new PRD
- ⏳ Developer completes manual git cleanup
- ⏳ Fresh-context run of IR to verify final alignment
- ⏳ Story 2.5 (popup primitive) completes and unblocks 2.3/2.4/4.1

---

## Appendix: Files Modified

- `_bmad-output/planning-artifacts/prd.md` (prior edit workflow)
- `_bmad-output/planning-artifacts/prd-validation-report.md` (prior validate workflow)
- `_bmad-output/planning-artifacts/architecture.md`
- `_bmad-output/planning-artifacts/ux-design-specification.md`
- `_bmad-output/planning-artifacts/epics.md`
- `_bmad-output/planning-artifacts/sprint-change-proposal-2026-04-16.md` (this file)
- `_bmad-output/implementation-artifacts/sprint-status.yaml`
- `_bmad-output/implementation-artifacts/2-3-completion-egg-hatch-to-complete.superseded.md` (renamed)
- `_bmad-output/implementation-artifacts/2-3-completion-via-popup-green-flash-and-dissolve.md` (created)

**Files NOT modified (implementation code — developer will handle during story execution):**
- `frontend/src/components/creatures/CompletionEgg.tsx` (to be deleted in new Story 2.3)
- `frontend/src/hooks/useCreatureHatch.ts` (to be deleted in new Story 2.3)
- `backend/src/api/creatures.py`, `services/creature_service.py` (refactor in new Story 2.3)
- `frontend/src/components/pond/PondCamera.tsx` (user will commit the optimization separately)
