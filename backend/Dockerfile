# syntax=docker/dockerfile:1.7
#
# Pond Todo backend image.
#
# Multi-stage build keeps the runtime image small: stage 1 (`builder`)
# resolves the locked dependency set with `uv sync --frozen` into a
# self-contained `.venv/`; stage 2 (`runtime`) copies that venv plus
# `src/` + `migrations/` + `alembic.ini` onto a slim Python base. Test
# deps (`pytest`, `mypy`, `ruff`, etc.) are NOT installed — the
# `--no-dev` flag drops the `dev` group from `pyproject.toml`.
#
# Build:
#   docker build -t pond-backend backend/
#
# Run (standalone — assumes a reachable Postgres):
#   docker run --rm -p 8000:8000 \
#     -e DATABASE_URL='postgresql+psycopg://postgres:postgres@host.docker.internal:5432/todo_pond' \
#     pond-backend
#
# In docker-compose, the `db` service hostname is `db`, so the
# DATABASE_URL becomes `postgresql+psycopg://postgres:postgres@db:5432/todo_pond`.
#
# The container runs `alembic upgrade head` on start before launching
# uvicorn (see `entrypoint.sh`). uvicorn uses sync handlers only —
# thread-based concurrency per CLAUDE.md.

# ---------- Stage 1: builder ----------
FROM python:3.13-slim AS builder

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    UV_LINK_MODE=copy \
    UV_COMPILE_BYTECODE=1

# Install uv from the official distroless image (small, fast).
COPY --from=ghcr.io/astral-sh/uv:0.5.11 /uv /uvx /usr/local/bin/

WORKDIR /app

# Install build deps for any wheels that lack a manylinux build
# (psycopg[binary] does ship wheels, but pgvector/crewai pull a few
# transitive C extensions). Keep this list tight; runtime stage gets
# no compiler.
RUN apt-get update && apt-get install -y --no-install-recommends \
        build-essential \
    && rm -rf /var/lib/apt/lists/*

# Copy lockfile + manifest first so the dependency layer caches even
# when src/ churns.
COPY pyproject.toml uv.lock ./

# Resolve the locked set into /app/.venv. `--no-install-project`
# skips installing the project itself in the deps layer; we add the
# project source after copying it. `--no-dev` drops dev extras.
RUN uv sync --frozen --no-dev --no-install-project

# Now copy the project source and install the project on top of the
# cached deps layer.
COPY src ./src
COPY migrations ./migrations
COPY alembic.ini ./
RUN uv sync --frozen --no-dev


# ---------- Stage 2: runtime ----------
FROM python:3.13-slim AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PATH="/app/.venv/bin:$PATH" \
    PYTHONPATH="/app"

# Run as a non-root user. uid/gid 1000 matches the typical host
# developer; harmless inside the container regardless.
RUN groupadd --system --gid 1000 app \
    && useradd --system --uid 1000 --gid app --create-home --home-dir /home/app app

WORKDIR /app

# Copy the resolved venv + project source from the builder.
COPY --from=builder --chown=app:app /app/.venv /app/.venv
COPY --from=builder --chown=app:app /app/src /app/src
COPY --from=builder --chown=app:app /app/migrations /app/migrations
COPY --from=builder --chown=app:app /app/alembic.ini /app/alembic.ini

# Entrypoint applies migrations then launches uvicorn.
COPY --chown=app:app entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh

USER app

EXPOSE 8000

ENTRYPOINT ["/app/entrypoint.sh"]
CMD ["uvicorn", "src.main:app", "--host", "0.0.0.0", "--port", "8000"]
