# Development Guidelines

<!-- MANUAL ADDITIONS START -->

## Git Workflow - Checkpoint Commits

**CRITICAL: Commit changes at reasonable checkpoints to enable diagnosis of critical failures.**

### When to Commit

You MUST create git commits at the following checkpoints:

1. **Unit of Work Completed**: After implementing a complete feature, service, or endpoint
2. **Quality Gate Passed**: After all tests pass and quality checks succeed (ruff, mypy, pylint)
3. **Phase Boundary**: After completing a user story or major phase (e.g., "Phase 3 complete")
4. **Refactoring Checkpoint**: After completing a significant refactoring task
5. **Before Major Changes**: Before starting a complex or risky change
6. **Error Recovery Points**: After fixing a critical bug or recovering from a failure

### Commit Message Format

Use descriptive commit messages that explain WHAT changed and WHY:

```bash
git commit -m "$(cat <<'EOF'
feat: implement text-to-SQL service with CrewAI

- Added TextToSQLService with SQL generation agent
- Integrated Claude Opus API for natural language processing
- Added parameterized query generation for security
- Tests: 95% coverage on service methods

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>
EOF
)"
```

### Commit Frequency Guidelines

- **Minimum**: Commit after each completed task in tasks.md (e.g., T077-T089)
- **Ideal**: Commit after each file or logical group of files is implemented and tested
- **Maximum**: Never go more than 1 hour without a commit if actively working

### Why This Matters

**Checkpoint commits enable:**

1. **Failure Diagnosis**: Compare working vs broken states using `git diff`
2. **Selective Rollback**: Revert specific changes without losing all progress
3. **Progress Tracking**: Clear history of what was completed when
4. **Collaboration**: Other developers (or future Claude sessions) can pick up where you left off
5. **Code Review**: Smaller, focused commits are easier to review than large diffs

### Enforcement

- **Before Quality Gates**: Always commit working code before running quality checks
- **After Quality Gates**: Always commit after achieving passing quality gates
- **During Implementation**: Commit each file or service as it's completed
- **Session Boundaries**: Always commit at the end of a work session

**Bottom line**: Commit early, commit often. Each commit should represent a coherent, working checkpoint.

## Code Style

**Python 3.13**: Follow strict constitutional standards (ruff, mypy --strict, pylint 10.00/10.00, thread-based concurrency)
**TypeScript**: Follow React + TypeScript best practices with strict type checking

### ⚠️ CRITICAL: CONCURRENCY MODEL - THREAD-BASED ONLY (NON-NEGOTIABLE)

**ALL Python code MUST use thread-based concurrency. Async/await patterns are STRICTLY PROHIBITED.**

This is a core constitutional principle (see constitution.md "Principle VI: Concurrency Model").

#### Async/Await Prohibition

The following patterns are **ABSOLUTELY FORBIDDEN** anywhere in this repository:

- ❌ **NEVER** use `async def` function definitions
- ❌ **NEVER** use `await` keyword
- ❌ **NEVER** import or use `asyncio` module (event loops, tasks, futures, coroutines)
- ❌ **NEVER** use `async with` context managers
- ❌ **NEVER** use `async for` iteration
- ❌ **NEVER** create async generators (`async def` with `yield`)
- ❌ **NEVER** use async third-party libraries (aiohttp, asyncpg, motor, httpx async client, etc.)
- ❌ **NEVER** use FastAPI async route handlers (use sync route handlers only)
- ❌ **NEVER** suggest async/await as a solution to any problem

#### Thread-Based Concurrency Requirements

**ALWAYS use these patterns instead:**

**Database Connections:**

- ✅ Use `psycopg_pool.ConnectionPool` (synchronous connection pooling)
- ✅ NEVER use `asyncpg` or `psycopg` async variants
- ✅ Configure pool with appropriate size (min_size, max_size)
- ✅ Use context managers for connection acquisition: `with pool.connection() as conn:`

**Parallel I/O Operations:**

- ✅ Use `concurrent.futures.ThreadPoolExecutor` with context manager
- ✅ Example: `with ThreadPoolExecutor(max_workers=10) as executor:`
- ✅ Use `executor.map()` for parallel mapping operations
- ✅ Use `executor.submit()` for individual task submission
- ✅ Use `concurrent.futures.wait()` with timeout for cancellation support

**Inter-Thread Communication:**

- ✅ Use `threading.Event` for signaling (set(), clear(), wait(), is_set())
- ✅ Use `threading.Lock` for mutual exclusion of shared state
- ✅ Use `threading.RLock` for reentrant locks (when needed)
- ✅ Use `queue.Queue` for thread-safe producer-consumer patterns

**HTTP Requests:**

- ✅ Use `requests` library (synchronous)
- ✅ NEVER use `aiohttp`, `httpx async client`, or other async HTTP clients
- ✅ For parallel HTTP requests: use ThreadPoolExecutor with requests

**Web Framework (FastAPI):**

- ✅ Use **synchronous route handlers only** (regular `def`, not `async def`)
- ✅ Example: `@app.get("/") def read_root() -> dict[str, str]:`
- ✅ FastAPI fully supports synchronous handlers - use them exclusively
- ✅ Background tasks: use `Thread` with `Event`, NOT `BackgroundTasks` with async

**Timeouts and Cancellation:**

- ✅ Use `concurrent.futures.wait(futures, timeout=30)` for operation timeouts
- ✅ Use `threading.Timer` for delayed execution
- ✅ Use `threading.Event` to signal cancellation between threads
- ✅ NEVER use `asyncio.wait_for()` or similar async timeout mechanisms

#### Code Patterns

**ThreadPoolExecutor Pattern (Parallel I/O):**

```python
from concurrent.futures import ThreadPoolExecutor
from typing import Callable, Any

def process_items(items: list[Any], processor: Callable[[Any], Any], max_workers: int = 10) -> list[Any]:
    """Process items in parallel using thread pool."""
    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        results: list[Any] = list(executor.map(processor, items))
    return results

# Example usage
def fetch_data(url: str) -> dict[str, Any]:
    """Fetch data from URL using requests (synchronous)."""
    import requests
    response: requests.Response = requests.get(url, timeout=10)
    return response.json()

urls: list[str] = ["http://api.example.com/1", "http://api.example.com/2"]
data: list[dict[str, Any]] = process_items(urls, fetch_data, max_workers=5)
```

**Event-Based Signaling Pattern (Background Tasks):**

```python
from threading import Event, Thread
from typing import Callable
import time

def background_worker(stop_event: Event, task_fn: Callable[[], None]) -> None:
    """Run task in background thread until stop_event is set."""
    while not stop_event.is_set():
        task_fn()
        if stop_event.wait(timeout=1.0):  # Check every second
            break

# Usage
def do_work() -> None:
    """Perform background work."""
    print("Working...")
    time.sleep(0.5)

stop_event: Event = Event()
worker: Thread = Thread(target=background_worker, args=(stop_event, do_work))
worker.start()

# Later: signal graceful shutdown
stop_event.set()
worker.join(timeout=5.0)
```

**Database Connection Pool Pattern:**

```python
from psycopg_pool import ConnectionPool
from psycopg import Connection
from typing import Any

# Initialize pool (do once at application startup)
pool: ConnectionPool = ConnectionPool(
    conninfo="postgresql://user:pass@localhost/dbname",
    min_size=2,
    max_size=10,
    timeout=30.0
)

# Use pool in request handlers (synchronous)
def get_user(user_id: int) -> dict[str, Any]:
    """Fetch user from database using connection pool."""
    with pool.connection() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT * FROM users WHERE id = %s", (user_id,))
            row: tuple[Any, ...] | None = cur.fetchone()
            if row is None:
                raise ValueError(f"User {user_id} not found")
            return {"id": row[0], "name": row[1], "email": row[2]}
```

**FastAPI Synchronous Route Handler Pattern:**

```python
from fastapi import FastAPI, HTTPException
from typing import Any

app: FastAPI = FastAPI()

# ✅ CORRECT: Synchronous route handler
@app.get("/users/{user_id}")
def read_user(user_id: int) -> dict[str, Any]:
    """Get user by ID (synchronous handler)."""
    try:
        user: dict[str, Any] = get_user(user_id)  # Calls synchronous function
        return user
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))

# ❌ INCORRECT: Async route handler (PROHIBITED)
# @app.get("/users/{user_id}")
# async def read_user(user_id: int) -> dict[str, Any]:
#     user = await get_user_async(user_id)  # NEVER DO THIS
#     return user
```

#### Rationale

**Why Thread-Based Concurrency:**

1. **Simplicity**: No event loop management, no "color" functions (sync vs async)
2. **Ecosystem Compatibility**: Most Python libraries support threading; async support is fragmented
3. **Testing Simplicity**: Standard pytest works; no async fixtures or event loop in tests
4. **I/O-Bound Workloads**: ThreadPoolExecutor provides sufficient parallelism for database, HTTP, file I/O
5. **GIL Considerations**: For I/O-bound code (typical in web apps), GIL is released during I/O operations
6. **Debuggability**: Standard debuggers work seamlessly with threads; async debugging is more complex
7. **Library Consistency**: Avoids mixing sync/async libraries (requests vs aiohttp, psycopg vs asyncpg)
8. **Production Maturity**: Thread pools have decades of production hardening

**Why Async/Await is Prohibited:**

- Adds significant complexity without meaningful performance benefits for I/O-bound Python workloads
- Creates "colored function" problem (sync functions can't call async functions without changes)
- Fragments ecosystem (must choose between sync and async versions of libraries)
- Complicates testing (requires async test fixtures, event loop management)
- Makes debugging harder (async stack traces, event loop debugging)
- Violates "explicit is better than implicit" - async/await hides control flow

#### Enforcement

**During Code Review:**

- Any use of `async`, `await`, or `asyncio` is grounds for immediate rejection
- Any suggestion to use async libraries must be rejected with thread-based alternative
- Verify all route handlers in FastAPI use `def`, not `async def`
- Verify database drivers are synchronous (psycopg, not asyncpg)
- Verify HTTP clients are synchronous (requests, not aiohttp)

**During Implementation:**

- If you think a task "requires" async/await, STOP and consider thread-based alternatives:
  - High concurrency → ThreadPoolExecutor with appropriate `max_workers` (100+ threads is fine for I/O)
  - Timeouts → `concurrent.futures.wait()` with timeout parameter
  - Cancellation → `threading.Event` to signal cancellation
  - WebSockets → Use synchronous WebSocket libraries (e.g., `websocket-client`)
  - Background tasks → `Thread` with `Event` for graceful shutdown

**Bottom Line**: If it's async/await, it's not allowed. No exceptions. Use threads.

<!-- MANUAL ADDITIONS END -->
