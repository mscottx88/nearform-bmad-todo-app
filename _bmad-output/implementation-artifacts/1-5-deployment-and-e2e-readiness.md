# Story 1.5: Deployment & E2E Readiness

Status: ready-for-dev

> **Scope note:** Closes the three remaining open success-criteria
> gates that the project still owes:
>
> 1. **Docker deployment** — `docker-compose up` currently only
>    starts Postgres. Backend + frontend Dockerfiles are missing,
>    so the criterion "Application runs successfully via
>    docker-compose up" cannot be demonstrated without `make dev`.
> 2. **E2E tests (≥5 Playwright)** — no Playwright dependency, no
>    e2e/ folder. Existing tests are vitest unit/integration only.
> 3. **Accessibility (zero critical WCAG)** — no automated a11y
>    tooling installed. Story 4-4-frontend-a11y-sweep covers the
>    code-side sweep; this story adds the *automated audit* layer
>    that catches regressions in CI.
>
> The two remaining quick-win gates (README rewrite + 70% coverage
> tooling + AI integration log) landed earlier as a non-story chore
> commit and are NOT in scope here.
>
> **No dependencies on other open stories** — independent of 6-8 /
> 6-10 / 6-11 / 6-12. Can run in parallel with Epic 6 dev.

---

## Story

As a stakeholder evaluating the Pond Todo project,
I want to spin the full app up via `docker-compose up` and watch a green Playwright + axe-core run in CI,
So that the project demonstrates a production-ready baseline (containerized deployment, browser-level golden-path tests, automated accessibility gate) — not just a working dev loop on the maintainer's laptop.

---

## Acceptance Criteria

### AC 1 — Backend Dockerfile

**Given** a clean checkout of the repo

**When** I run `docker build -t pond-backend backend/`

**Then** the build succeeds and produces an image that:

- Uses `python:3.13-slim` (or equivalent) as the base.
- Installs deps via `uv sync --frozen` (or `pip install` if uv is
  unavailable in the build environment) — no dev extras.
- Copies `backend/src/` and `backend/alembic/` (NOT
  `backend/tests/`).
- Runs `alembic upgrade head` on container start before launching
  uvicorn.
- Launches `uvicorn src.main:app --host 0.0.0.0 --port 8000`
  (synchronous handlers per `CLAUDE.md`'s thread-based-concurrency
  rule — no `--workers` < 2 unless config makes it explicit).
- Exposes port 8000.
- Image size under ~300MB (slim base + no test deps).

The container MUST be able to reach the `db` service via the compose
network and apply migrations on first start.

### AC 2 — Frontend Dockerfile (multi-stage)

**Given** a clean checkout of the repo

**When** I run `docker build -t pond-frontend frontend/`

**Then** the build succeeds and produces an image that:

- **Stage 1 (build):** `node:22-alpine` base, runs
  `npm ci && npm run build`, produces the Vite static bundle in
  `/app/dist`.
- **Stage 2 (serve):** `nginx:alpine` base, copies the bundle to
  `/usr/share/nginx/html`. Custom nginx config that:
  - Falls back to `index.html` for SPA routing.
  - Proxies `/api/*` to the `backend` compose service.
- Exposes port 80.
- Image size under ~80MB.

### AC 3 — Extended `docker-compose.yml`

**Given** the existing single-service compose file

**When** I run `docker-compose up` from the repo root

**Then** all three services come up:

- `db` (existing) — healthy on port 5432.
- `backend` — depends_on `db` (with `condition: service_healthy`),
  applies migrations on start, listens on 8000.
- `frontend` — depends_on `backend` (with
  `condition: service_started`), serves the SPA on 80.

After a few seconds, navigating to
`http://localhost:8080` (or whichever published port the
frontend service maps) should show the empty pond and the SPA can
talk to the backend (`POST /api/todos` succeeds).

The backend and frontend Dockerfiles MUST tolerate an absent
`ANTHROPIC_API_KEY` at boot — agent skills fail at request time
with a clear error, but the container itself starts cleanly.

### AC 4 — Playwright installed + configured

**Given** no Playwright artefacts exist today

**When** I install per
[`frontend/package.json`](frontend/package.json) devDependencies

**Then** the repo has:

- `@playwright/test` and `@axe-core/playwright` as devDependencies.
- `frontend/playwright.config.ts` configured with:
  - `testDir: 'e2e'`
  - `use.baseURL: 'http://localhost:5173'` (dev server) — overridable
    via env var for the docker-compose flow.
  - One project for `chromium` (matches the desktop-Chrome target
    from the PRD); Firefox + WebKit projects are out of scope.
  - `webServer` config that auto-starts the Vite dev server (or
    skips that hook if `PLAYWRIGHT_BASE_URL` is set, so CI can run
    against the docker-compose stack).
- `frontend/e2e/` directory with the test files below.
- `.gitignore` updated to exclude
  `frontend/playwright-report/` and
  `frontend/test-results/`.

### AC 5 — Five E2E golden-path tests (≥5 ACs covered)

The following Playwright tests MUST exist and pass against a running
backend + frontend (either dev mode or compose stack):

1. **Create todo via TodoInput** —
   - Open app, type "Buy milk", press Enter.
   - Assert: a lily pad appears in the pond canvas (visible via
     a stable test-id or DOM presence check).
   - Assert: the backend received a `POST /api/todos` (intercept the
     request).

2. **Complete via in-scene popup** —
   - Pre-seed a todo via API, reload.
   - Click the pad, click "Complete" in the popup.
   - Assert: the pad performs the green-flash animation and is
     removed from the pond view (matches AC of story 2-4).

3. **Delete via in-scene popup** —
   - Same as #2 but click "Delete".
   - Assert: red-flash, removal, backend `PATCH /api/todos/:id`
     with `{ deleted: true }`.

4. **Type-anywhere search** —
   - Pre-seed three todos with distinct words.
   - Type a fragment matching one. Assert: the matching pad rises
     to the surface; the others submerge.

5. **Resizable agent panel persists across reload** —
   - Open agent panel (F1).
   - Drag the resize handle ~100px wider.
   - Reload the page.
   - Assert: the panel reopens at the dragged width (story 6-9
     persistence).

Each test MUST run in under 15 seconds against a warm dev server.

### AC 6 — Accessibility gate via axe-core (zero critical violations)

**Given** a Playwright test run

**When** the suite reaches its dedicated a11y test

**Then** an `@axe-core/playwright` scan against the empty pond view
AND the open agent panel reports **zero violations** at impact level
`critical` or `serious`. `moderate` and `minor` violations may be
present but do NOT fail the build.

Implementation:

- One Playwright test (`e2e/a11y.spec.ts`) — counts toward the AC
  5 minimum so total test count is 6, comfortably above the ≥5
  bar.
- Standard config: `AxeBuilder` with `withTags(['wcag2a', 'wcag2aa'])`.
- A small allowlist file (`e2e/a11y-allowlist.ts`) for known
  noise — e.g. third-party canvas elements that axe can't reason
  about. Each entry MUST carry a comment explaining why and link
  to a tracking item.

### AC 7 — CI pipeline runs Playwright

**Given** the new `.github/workflows/ci-e2e.yml` (or extension of an
existing workflow)

**When** a PR is opened

**Then** CI:

- Builds the docker-compose stack (or boots backend + frontend
  directly — implementer's choice; whichever is faster on the
  hosted runner).
- Runs Playwright + axe.
- Uploads `playwright-report/` as an artifact on failure.
- Fails the run if any test fails OR if the axe gate trips.

The job MUST complete in under 10 minutes on `ubuntu-latest`. Cache
the Playwright browser bundle via `actions/cache` keyed on the
`@playwright/test` version.

### AC 8 — Documentation

The README's **Quick start** section gains a "Run via Docker only"
variant:

```bash
docker compose up --build
# Visit http://localhost:8080
```

A new **Testing** subsection mentions Playwright + axe:

```bash
cd frontend
npx playwright install --with-deps  # one-time
npx playwright test                 # golden paths + a11y
```

`docs/ai-integration-log.md` is NOT updated by this story —
deployment + E2E work isn't AI-tooling commentary.

### AC 9 — Definition of Done

- All ACs satisfied with code + tests.
- `docker compose up --build` boots all 3 services and the SPA is
  reachable.
- `npx playwright test` passes locally against `make dev` AND
  against the docker-compose stack.
- `npx tsc --noEmit` clean (Playwright tests are TS-strict).
- CI workflow green on a representative PR.
- Story flipped to `review`; sprint-status synced.

---

## Tasks / Subtasks

### Task 1 — Backend Dockerfile (AC 1)

- [ ] Create `backend/Dockerfile` (multi-stage if needed for uv).
- [ ] Add `backend/.dockerignore` excluding `tests/`, `.venv/`,
  `__pycache__/`, `htmlcov/`, `.pytest_cache/`.
- [ ] Verify the container can reach the `db` service and apply
  migrations on first start.
- [ ] Document the build + run commands at the bottom of the
  Dockerfile in a comment block.

### Task 2 — Frontend Dockerfile (AC 2)

- [ ] Create `frontend/Dockerfile` (multi-stage: node build →
  nginx serve).
- [ ] Create `frontend/nginx.conf` with SPA fallback +
  `/api/` proxy to the `backend` compose service.
- [ ] Add `frontend/.dockerignore` excluding `node_modules/`,
  `dist/`, `coverage/`, `playwright-report/`, `test-results/`.

### Task 3 — Extend `docker-compose.yml` (AC 3)

- [ ] Add `backend` service: build context `backend/`, depends_on
  `db` healthy, env vars passed through.
- [ ] Add `frontend` service: build context `frontend/`,
  depends_on `backend` started, port mapping `8080:80`.
- [ ] Test full boot from a clean Docker state — capture the
  command + output in the Dev Agent Record.

### Task 4 — Playwright install + config (AC 4)

- [ ] `npm i -D @playwright/test @axe-core/playwright`.
- [ ] `npx playwright install --with-deps chromium`.
- [ ] Create `frontend/playwright.config.ts` with the shape
  described in AC 4.
- [ ] Add `frontend/e2e/.gitkeep` (placeholder until tests land).
- [ ] Update `.gitignore`.

### Task 5 — Five golden-path E2E tests (AC 5)

- [ ] `e2e/create-todo.spec.ts` — Test 1.
- [ ] `e2e/complete-todo.spec.ts` — Test 2.
- [ ] `e2e/delete-todo.spec.ts` — Test 3.
- [ ] `e2e/search.spec.ts` — Test 4.
- [ ] `e2e/agent-panel-resize.spec.ts` — Test 5.
- [ ] Add stable `data-testid` attributes where DOM hooks are
  needed (avoid relying on neon class names that may churn).

### Task 6 — Accessibility gate (AC 6)

- [ ] `e2e/a11y.spec.ts` — runs axe against the empty-pond view
  + open agent panel.
- [ ] `e2e/a11y-allowlist.ts` — initial empty list; populated
  only if real noise emerges.
- [ ] If any critical/serious violations found, fix them before
  closing the story (a11y debt is in scope here, not a deferral).

### Task 7 — CI workflow (AC 7)

- [ ] Create `.github/workflows/ci-e2e.yml` OR extend
  `ci-frontend.yml`.
- [ ] Cache Playwright browsers.
- [ ] Upload `playwright-report/` on failure.
- [ ] Verify timing under 10 min on `ubuntu-latest`.

### Task 8 — Documentation (AC 8)

- [ ] README "Run via Docker only" subsection.
- [ ] README "Testing" → Playwright + axe commands.

### Task 9 — Polish + run gates (AC 9)

- [ ] Manual smoke: `docker compose up --build` from a clean
  state. Confirm SPA loads and creates a todo.
- [ ] `make lint` + `make test` clean.
- [ ] `npx playwright test` green.
- [ ] Story → review.

---

## Dev Notes

### Why a 6th test for a11y instead of folding into one of the 5

The success criterion lists "≥5 Playwright tests" and "zero critical
WCAG violations" as separate gates. Keeping the a11y test separate
makes the gate explicit (one failing test = a11y regression, not
mixed signal with a CRUD bug) and brings the total to 6 — clear
margin above the ≥5 bar.

### Why nginx for frontend instead of `npm run preview`

`vite preview` works but isn't intended for production-style serving.
nginx adds proper SPA fallback (`try_files $uri /index.html`),
gzip, and is a closer fit to how the SPA would deploy in a real
environment. Image size penalty is small (alpine ~50MB).

### Why depend on `service_healthy` for db, `service_started` for backend

The db needs a healthcheck because Postgres is "up" before it
accepts connections; the existing `pg_isready` healthcheck handles
that. The backend, by contrast, is "ready" the moment uvicorn
binds — no separate `/health` endpoint exists today, so a
`service_started` dependency is honest about what the runtime can
guarantee. Adding a backend `/health` endpoint is out of scope for
this story but worth noting as a follow-up
(promote to deferred-work.md if not handled here).

### `docker-compose up` vs `docker-compose up --build`

The AC 9 manual smoke says `docker compose up --build`. Without
`--build`, docker reuses cached images; on first checkout there are
no images, but stale local images on the maintainer's machine can
mask Dockerfile bugs. The CI workflow always runs `--build` for the
same reason.

### File locations

**New:**
- `backend/Dockerfile`
- `backend/.dockerignore`
- `frontend/Dockerfile`
- `frontend/nginx.conf`
- `frontend/.dockerignore`
- `frontend/playwright.config.ts`
- `frontend/e2e/create-todo.spec.ts`
- `frontend/e2e/complete-todo.spec.ts`
- `frontend/e2e/delete-todo.spec.ts`
- `frontend/e2e/search.spec.ts`
- `frontend/e2e/agent-panel-resize.spec.ts`
- `frontend/e2e/a11y.spec.ts`
- `frontend/e2e/a11y-allowlist.ts`
- `.github/workflows/ci-e2e.yml`

**Modified:**
- `docker-compose.yml` — add backend + frontend services.
- `frontend/package.json` — `@playwright/test` +
  `@axe-core/playwright` devDeps; `e2e` + `e2e:ui` scripts.
- `.gitignore` — Playwright report + test-results dirs.
- `README.md` — Docker quickstart + Playwright section.

### References

- [Playwright config reference](https://playwright.dev/docs/test-configuration)
- [@axe-core/playwright README](https://github.com/dequelabs/axe-core-npm/blob/develop/packages/playwright/README.md)
- WAI-ARIA (the project's existing accessibility vocabulary uses
  `role="separator"` etc. — the audit MUST not regress what's
  already there).
- [`prd.md`](../planning-artifacts/prd.md) §"Success Criteria" — the
  source of the ≥5 / zero-critical gates this story closes.

---

## Dev Agent Record

### Agent Model Used

(populated by Dev agent)

### Debug Log References

(populated by Dev agent)

### Completion Notes List

(populated by Dev agent)

### File List

(populated by Dev agent)

### Change Log

| Date | Change |
|---|---|
| 2026-04-27 | Story drafted as a follow-up to the success-criteria audit. Closes the three remaining open gates: Docker deployment, ≥5 Playwright E2E tests, automated WCAG audit. Three quick-win gates (README, coverage tooling, AI integration log) landed earlier as a non-story chore commit. |
