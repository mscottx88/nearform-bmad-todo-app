#!/bin/sh
# Backend container entrypoint.
#
# Applies pending Alembic migrations against $DATABASE_URL, then
# execs the supplied CMD (uvicorn by default). Migration is the
# blocking pre-flight: if the schema can't reach `head`, the
# container exits non-zero before serving any traffic.
set -eu

echo "[entrypoint] applying migrations…"
python -m alembic upgrade head

echo "[entrypoint] launching: $*"
exec "$@"
