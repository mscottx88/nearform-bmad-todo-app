# Sprint Change Proposal — Remove Groups, Promote Selection as Temporary Grouping

**Date:** 2026-04-23
**Author:** Michael (via Developer agent)
**Scope:** Major — rollback of Story 4.6 group-specific work, retirement of Story 5.6, PRD/epic trim, new minor story for selection-drag + selection-repel
**Sprint Status:** 4.6 was `review`; 5.6 was `ready-for-dev`

---

## 1. Issue Summary

**Trigger.** Direct user directive after exercising the group UX in the browser:

> "Groups are just not worth the effort. Remove groups. Group colors, labels, and backend support for groups should be removed. The ability to select one or more lily pads should remain and act as the only 'grouping' ability. They can act like a temporary group and when many are selected and one is dragged they all drag together and repel non-selected pads."

**Category.** *Strategic pivot* — the feature shipped against spec but the resulting UX complexity (halo ring, cluster label, drag handle with slide/grip phases, pop-in/pop-out, group color swatch, group label input, cluster-aware search) outweighs the value for a single-user pond. The user wants the surface-area of "grouping" reduced to the ephemeral selection primitive that already exists.

**Evidence.** Iteration log over 2026-04-22/23 ran ~30 bug-fix and polish commits against the group feature (handle flash, camera-follow feedback loops, nudge radius, label preselect, label persistence, cluster halo ride-with-drag, frog cursor). Each fix exposed another edge case. The user's request is to cut the root.

---

## 2. Impact Analysis

### Epic Impact

- **Epic 4 (Organizing the Pond).** Story 4.6 ("Lily Pad Clustering & Groups", status `review`) is **superseded**. Story 4.4 (`frontend-a11y-sweep`, `backlog`) referenced group/popup a11y — scope reduces. Story 4.5 (`react-strict-compliance-sweep`, `backlog`) is unaffected.
- **Epic 5 (Intelligent Search).** Story 5.6 ("Cluster-Aware Search / FR20", status `ready-for-dev`) is **retired** — depended entirely on `todo.groupId`.
- **Epic 2 and earlier.** No impact. The selection primitive (shift/ctrl-click) landed in Story 4.6 Task 5 and is retained.
- **Epic 7 / Epic 8.** No impact.

### Story Impact

| Story | Current | After |
|---|---|---|
| `4-6-lily-pad-clustering-and-groups` | review | **superseded** (retained subset: selection visual + Escape-clears-selection) |
| `5-6-cluster-aware-search` | ready-for-dev | **retired** |
| `4-4-frontend-a11y-sweep` | backlog | descope group-popup ARIA |
| NEW `4-7-selection-drag-and-repel` | — | **backlog** — preserves the user-visible half of what 4.6 delivered |

### Artifact Conflicts

**PRD** (`planning-artifacts/prd.md`):

- FR10 ("group two or more lily pads…shared glow aura") — **remove**
- FR11 ("ungroup a cluster…ripple") — **remove**
- FR12 ("assign optional label to a cluster") — **remove**
- FR13 ("drag to reposition…drag into/out of clusters") — **revise**: strip "drag into/out of clusters" half; keep single-pad drag
- FR20 ("matching clusters surface as units") — **remove**
- FR39 ("group membership" in state persistence) — **remove the group-membership clause**; keep position persistence
- Add FR40 (new): "Shift/Ctrl-click selects pads for a session-only temporary group. Dragging any selected pad translates the whole selection; non-selected pads slide out of the way. Escape clears the selection."

**Architecture** (`planning-artifacts/architecture.md`):

- Remove `ClusterManager` and all `/api/groups` endpoints from component + route tables
- Remove `groups` and `group_memberships` from the database-schema section
- Remove cluster-label / CSS2DRenderer reference
- Update component count estimate (~15 → ~12)

**Epics** (`planning-artifacts/epics.md`):

- Remove group-related stories (4.6, 5.6) and group sections from filesystem trees
- Update Story 4.6 entry → "Selection-drag & repel" (new 4.7 scope)
- Remove FR10/11/12/20 traceability rows

**UX Design Spec** (`planning-artifacts/ux-design-specification.md`):

- Remove cluster halo, cluster label, drag-handle, pop animation mockups
- Keep selection-ring visual (white pulsing rim from AC #1 of 4.6)

**Sprint Status** (`implementation-artifacts/sprint-status.yaml`):

- Mark `4-6-lily-pad-clustering-and-groups: superseded`
- Mark `5-6-cluster-aware-search: retired` (or remove the entry)
- Add `4-7-selection-drag-and-repel: backlog`

**Deferred Work** (`implementation-artifacts/deferred-work.md`):

- No group-specific open entries today; no retirements needed. Sanity-check after the rewrite lands.

### Technical Impact

**Backend deletions (single migration edit):**

- `backend/src/models/group.py` (Group + GroupMembership)
- `backend/src/schemas/group.py` (GroupCreate/Update/Response)
- `backend/src/services/group_service.py`
- `backend/src/api/groups.py`
- `backend/src/exceptions.py` — `GroupNotFoundError`, `MemberAlreadyGroupedError`, `GroupTooSmallError`
- `backend/src/schemas/todo.py` — drop `group_id`, `group_label`, `group_color` from `TodoResponse`
- `backend/src/services/todo_service.py` — drop `_build_response`'s group params, `_group_meta_for`, three-way outerjoin in `list_todos`
- `backend/src/main.py` — unwire `groups.router`
- `backend/tests/api/test_groups.py`, `backend/tests/services/test_group_service.py` — delete
- `backend/tests/conftest.py` — drop Group-row cleanup
- **Initial migration** `7af34c6df37c_initial_schema.py` — remove `groups` and `group_memberships` table definitions per CLAUDE.md "one migration only" principle; reset dev DB from scratch (no prod data exists)

**Frontend deletions:**

- `frontend/src/api/groupApi.ts` — delete
- `frontend/src/components/pond/ClusterHalo.tsx` — delete
- `frontend/src/components/pond/ClusterLabel.tsx` — delete
- `frontend/src/components/pond/ClusterDragHandle.tsx` — delete
- `frontend/src/components/pond/GroupHaloHover.tsx` — delete
- `frontend/src/lib/clusterGeometry.ts` — delete (unused after handle removal)
- `frontend/src/types/index.ts` — drop `groupId`, `groupLabel`, `groupColor` from `Todo`; drop `Group` interface
- `frontend/src/stores/usePondStore.ts` — drop `hoveredGroupId`, `groupDragTarget`, `clusterTranslation`, `groupMeta`, `groupColorPreviews`, `pendingPops`, related setters/selectors; retain `selectedPadIds` and `activeDragAnchor`
- `frontend/src/components/ui/ActionPopup.tsx` — remove `isGrouped` / `onUngroup` / `onDisband` / `onSpreadGroup` / `onSetLabel` / `onCommitGroupColor` / `onPreviewGroupColor` props + the entire group-action section; keep the four-button Complete/Delete/Set Color layout; remove the Group button entirely
- `frontend/src/components/pond/PondScene.tsx` — remove `useCreateGroup/useUpdateGroup/useDeleteGroup` imports, `groups` useMemo, group-meta useEffect, ClusterHalo/Label/Handle mounts, pop-in/pop-out wiring, sticky cluster patch effect, group-color preview wire
- `frontend/src/components/pond/LilyPad.tsx` — remove group-drag branches, `groupDragTarget` writes, `ownGroupSnapshotRef`/`allGroupsSnapshotRef`, pop-out/pop-in callbacks and refs, cluster-translation read, wake emission (was gated on `todo.groupId`), `pendingPops` consumer; **retain** `selectedPadIds` read + white-rim oscillation (selection visual), `activeDragAnchor` read (already general-purpose), existing single-pad drag
- `frontend/src/components/pond/WaterSurface.tsx` — remove wake shader slots and uniforms (WAKE_SLOTS, uWakeCenter/Time/Angle/Amplitude/Lifetime, wake() vertex function); remove the drain block. Wakes were a group-feature adjunct and lose their trigger.
- `frontend/src/utils/spreadOutCommand.ts` — already simplified to flat spread in commit `bb1e262`; no change
- Tests: delete group-related tests in `LilyPad.test.tsx`, `PondScene.test.tsx`, `ActionPopup.test.tsx`, `usePondStore.test.ts` (setGroupDragTarget, setClusterTranslation, firePop/clearPendingPop, addWake/drainWakes, setGroupMeta, setGroupColorPreview)

**New work (Story 4.7):**

- Rename `selectedPadIds` consumer path so dragging ANY selected pad translates the whole selection. Reuse the `clusterTranslation`-style "baseline snapshot + (dx, dz)" pattern — it's the right shape for this, just renamed/retargeted to selections.
- `activeDragAnchor` already triggers non-selected pads to repel (generalized from the group-sibling repulsion); extend so the repulsion is applied against EACH selected pad's position, not just one anchor. Either emit multiple anchors or compute one bounding radius for the selection.
- Release commits each dragged+repelled pad's final position via existing `updateTodo.mutate` path and the `stickyDragRef` pattern.
- No backend changes for Story 4.7.

---

## 3. Recommended Approach — Hybrid Rollback + New Minor Story

**Option 1 (Direct Adjustment) rejected.** Group code is too deeply intertwined with active features; patching in place would leave dead code paths and a confusing mental model.

**Option 2 (Rollback) + Option 3 (Scope reduction) hybrid, selected:**

1. **Rollback** all group code (backend + frontend) and strip group FRs from PRD/epics/architecture. ~60% deletion, ~20% simplification, ~20% test removal.
2. **Retire** Story 5.6 (cluster-aware search).
3. **Author** a new minor story `4-7-selection-drag-and-repel` that preserves the *user-visible* half of Story 4.6: multi-select via shift/ctrl-click + Escape-to-clear survives, and a new selection-based drag behavior replaces cluster drag.

**Rationale:**

- "One migration only" principle (CLAUDE.md) favors editing the initial migration over shipping an `ALTER TABLE DROP` as a second migration.
- The surviving selection primitive already has tests and working visuals — it's the cheapest path to the requested UX.
- Removing FR20 lets Story 5.3 (type-anywhere search) remain the complete search story; no "partial cluster-aware" half-state to maintain.

**Effort estimate:** Medium. Deletion is mechanical; PondScene + LilyPad need careful untangling. Expect ~4-6 hours of deletion + untangling, ~1-2 hours of PRD/epic editing, ~3-4 hours for the new Story 4.7 implementation + tests. Single-session feasible for the deletion; Story 4.7 is a follow-on.

**Risk:** Low. The deletion is bounded (no downstream consumers of groups survive), the test suite will catch collateral damage, and the DB reset is safe in dev.

---

## 4. Detailed Change Proposals

### 4.1 PRD (`_bmad-output/planning-artifacts/prd.md`)

**REMOVE FR10, FR11, FR12, FR20.** Strike the rows outright.

**REVISE FR13** — Current wording includes "drag into/out of clusters". New wording:

> **FR13.** User can drag any lily pad to reposition it. If one or more pads are currently selected (shift/ctrl-click), dragging any selected pad translates every selected pad together; non-selected pads nearby slide out of the way. Positions persist across reloads.

**REVISE FR39** (state persistence) — Remove the "group membership" clause; keep positions, completion state, color, deletion.

**ADD FR40** (new):

> **FR40.** Shift-click or Ctrl/Cmd-click on a lily pad toggles its inclusion in a session-only selection set. Selected pads display a white pulsing outer rim. Pressing Escape (with no popup/search active) clears the selection. Selection is never persisted.

### 4.2 Epics (`_bmad-output/planning-artifacts/epics.md`)

- Remove Story 4.6 and 5.6 rows.
- Add Story 4.7 row: "Selection-drag & repel" (backlog, FR13 revision + FR40).
- Remove `groups` + `group_memberships` from the database-schema section.
- Remove `/api/groups` routes from the API section.
- Remove cluster-manager from the component inventory.

### 4.3 Architecture (`_bmad-output/planning-artifacts/architecture.md`)

Mirror the epics edits — drop tables, routes, ClusterManager component, CSS2DRenderer reference for cluster labels. Update the component-count estimate.

### 4.4 UX Design Spec (`_bmad-output/planning-artifacts/ux-design-specification.md`)

Strip cluster halo / label / handle / pop-animation sections. Retain selection-ring visual spec.

### 4.5 Sprint Status (`_bmad-output/implementation-artifacts/sprint-status.yaml`)

```yaml
# Epic 4: Organizing the Pond
4-6-lily-pad-clustering-and-groups: superseded  # 2026-04-23: group feature removed per sprint-change-proposal-2026-04-23.md; selection-based replacement in 4-7
4-7-selection-drag-and-repel: backlog  # NEW — FR13 revision + FR40. Shift/ctrl-click selection drags as a unit; non-selected pads repel.
```

```yaml
# Epic 5: Intelligent Search
5-6-cluster-aware-search: retired  # 2026-04-23: FR20 removed per sprint-change-proposal-2026-04-23.md (no clusters)
```

### 4.6 Story Files

- `implementation-artifacts/4-6-lily-pad-clustering-and-groups.md` — prepend a "SUPERSEDED" banner referencing this proposal; rename to `4-6-lily-pad-clustering-and-groups.superseded.md`
- `implementation-artifacts/5-6-cluster-aware-search.md` — rename to `5-6-cluster-aware-search.retired.md` with a "RETIRED" banner
- `implementation-artifacts/4-7-selection-drag-and-repel.md` — author new story using the standard template

### 4.7 Code — Batch Deletion Pass

All files enumerated in §2 Technical Impact, in one commit per subsystem:

1. Backend deletions + migration reset + test cleanup (one commit)
2. Frontend delete-only commit (files fully removed)
3. Frontend surgical commit (LilyPad / PondScene / ActionPopup / store untangling)
4. Tests commit (remove group-related assertions, update mocks)
5. Quality gate: `pytest`, `ruff`, `mypy --strict`, `vitest`, `tsc --noEmit` all green

### 4.8 Deferred Work

No action required — scan confirms no group-specific `[OPEN]` entries in `deferred-work.md`.

---

## 5. Implementation Handoff

**Scope classification:** **Moderate** — mostly mechanical deletion + scope trim, but touches multiple planning docs + sprint status + code across two subsystems.

**Handoff plan:**

| Role | Deliverable | Files |
|---|---|---|
| Developer (rollback pass) | Delete group code; reset migration; strip TodoResponse fields; unwire router; clean ActionPopup; untangle PondScene/LilyPad; remove wake shader; all quality gates green | Backend + frontend code, backend tests, frontend tests |
| Developer (planning-doc sweep) | Edit PRD, epics, architecture, UX spec per §4.1–§4.4; flip sprint-status.yaml per §4.5; rename story files per §4.6 | Planning + implementation artifacts |
| Developer (Story 4.7 authoring) | Write `4-7-selection-drag-and-repel.md` using the standard story template; include ACs, tasks, dev notes covering the selection-drag + selection-repel behavior | `implementation-artifacts/4-7-*.md` |
| Developer (Story 4.7 implementation) | Follow-on work — NOT part of this proposal's approval. Separate session via `/bmad-dev-story 4.7`. | — |

**Success criteria:**

- `pytest` + `ruff` + `mypy --strict` clean on backend
- `vitest` + `tsc --noEmit` clean on frontend
- `git grep -iE 'group|cluster'` returns only false-positive matches (no live symbols) in `backend/src/` and `frontend/src/`
- `_bmad-output/planning-artifacts/*.md` contain no references to FR10/FR11/FR12/FR20, group labels/colors, cluster halos, or drag handles
- Sprint-status reflects the supersede/retire/new-backlog pattern above
- Application loads, pads can be dragged, and shift-click selection visibly survives

---

## 6. Next Action

Await explicit user approval. On **yes**, execute §4 in four commits + one final quality gate commit. On **revise**, identify which section needs rework and return to Step 3.
