#!/usr/bin/env bash
# Backend container entrypoint.
#
# Applies pending Alembic migrations against $DATABASE_URL, then
# execs the supplied CMD (uvicorn by default). Migration is the
# blocking pre-flight: if the schema can't reach `head`, the
# container exits non-zero before serving any traffic.
#
# `pipefail` guards against a future change that pipes the alembic
# call through `tee` or similar — without it, a downstream pipe
# success would mask a migration failure and uvicorn would launch
# against an unmigrated schema.
set -euo pipefail

echo "[entrypoint] applying migrations…"
python -m alembic upgrade head

echo "[entrypoint] launching: $*"
exec "$@"
