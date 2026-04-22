import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from src.api.creatures import router as creatures_router
from src.api.groups import router as groups_router
from src.api.search import router as search_router
from src.api.todos import router as todos_router
from src.config import settings
from src.exceptions import AppError
from src.workers import embedding_worker

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    # Framework contract forces `async def`, but the body is sync —
    # thread-based concurrency only (see CLAUDE.md § concurrency).
    embedding_worker.start_embedding_executor(max_workers=4)
    if not settings.google_api_key:
        logger.warning(
            "GOOGLE_API_KEY not configured — embedding generation will be "
            "disabled; todos will save with embedding_status='pending'",
        )
    if not settings.embedding_model.strip():
        # Empty/whitespace-only model name → every embedding call 400s at
        # Google and burns 3 retries per todo before operators notice. Fail
        # fast instead: a blank model name is always a misconfiguration.
        raise RuntimeError(
            "EMBEDDING_MODEL is empty or whitespace — refusing to start; "
            "set a valid model name (e.g. 'gemini-embedding-001') in the environment",
        )
    try:
        yield
    finally:
        embedding_worker.stop_embedding_executor(wait=True)


app = FastAPI(
    title="nearform-bmad-todo-app",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in settings.cors_origins.split(",")],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(AppError)
def app_error_handler(request: Request, exc: AppError) -> JSONResponse:
    return JSONResponse(
        status_code=exc.status_code,
        content={"error": exc.error, "message": exc.message, "detail": exc.detail},
    )


@app.exception_handler(RequestValidationError)
def validation_error_handler(
    request: Request,
    exc: RequestValidationError,
) -> JSONResponse:
    return JSONResponse(
        status_code=422,
        content={
            "error": "validation_error",
            "message": "Invalid request data",
            "detail": exc.errors(),
        },
    )


app.include_router(todos_router)
app.include_router(creatures_router)
app.include_router(search_router)
app.include_router(groups_router)
