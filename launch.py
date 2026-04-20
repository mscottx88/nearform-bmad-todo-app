"""Development server launcher for nearform-bmad-todo-app.

Launches Docker (PostgreSQL), backend (FastAPI), and frontend (Vite) servers
in separate processes and handles graceful shutdown on keyboard interrupt.

Usage:
    python launch.py
"""

from pathlib import Path
import subprocess
import sys
import time
from typing import NoReturn


def start_docker(script_dir: Path) -> None:
    """Start Docker containers (PostgreSQL with pgvector).

    Args:
        script_dir: Root directory of the project
    """
    print("Starting PostgreSQL via docker compose...")
    subprocess.run(
        ["docker", "compose", "up", "-d"],
        cwd=str(script_dir),
        check=True,
    )
    print("[OK] PostgreSQL started")


def start_backend(script_dir: Path) -> subprocess.Popen[bytes]:
    """Start the backend FastAPI server.

    Args:
        script_dir: Root directory of the project

    Returns:
        Backend process handle
    """
    print("Starting backend server (FastAPI on http://localhost:8000)...")
    backend_cwd: Path = script_dir / "backend"
    backend_process: subprocess.Popen[bytes] = subprocess.Popen(
        ["uv", "run", "uvicorn", "src.main:app", "--reload", "--port", "8000"],
        cwd=str(backend_cwd),
        shell=sys.platform == "win32",
    )
    print(f"[OK] Backend started (PID: {backend_process.pid})")
    return backend_process


def start_frontend(script_dir: Path) -> subprocess.Popen[bytes]:
    """Start the frontend Vite server.

    Args:
        script_dir: Root directory of the project

    Returns:
        Frontend process handle
    """
    print("Starting frontend server (Vite on http://localhost:5173)...")
    frontend_cwd: Path = script_dir / "frontend"
    frontend_process: subprocess.Popen[bytes] = subprocess.Popen(
        ["npm", "run", "dev"],
        cwd=str(frontend_cwd),
        shell=sys.platform == "win32",
    )
    print(f"[OK] Frontend started (PID: {frontend_process.pid})")
    return frontend_process


def stop_process(process: subprocess.Popen[bytes], name: str) -> None:
    """Stop a process and its entire child tree.

    On Windows, shell=True wraps the real server in cmd.exe — `.terminate()`
    only kills the wrapper, leaving uvicorn/node orphaned and holding
    stdin/stdout pipes to the terminal (which then hangs). `taskkill /F /T`
    terminates the whole process tree, reaching the grandchild.
    """
    if process.poll() is not None:
        return
    print(f"Stopping {name}...")
    try:
        if sys.platform == "win32":
            subprocess.run(
                ["taskkill", "/F", "/T", "/PID", str(process.pid)],
                check=False,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
        else:
            process.terminate()
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            print(f"[WARN] {name} didn't stop gracefully, killing...")
            process.kill()
            process.wait(timeout=5)
        print(f"[OK] {name} stopped")
    except (OSError, ValueError) as e:
        print(f"[WARN] Error stopping {name}: {e}")
        process.kill()


def monitor_processes(
    backend_process: subprocess.Popen[bytes],
    frontend_process: subprocess.Popen[bytes],
) -> None:
    """Monitor running processes and exit if either dies.

    Args:
        backend_process: Backend process handle
        frontend_process: Frontend process handle
    """
    while True:
        backend_status: int | None = backend_process.poll()
        frontend_status: int | None = frontend_process.poll()

        if backend_status is not None:
            print(f"\n[ERROR] Backend exited with code {backend_status}")
            sys.exit(1)

        if frontend_status is not None:
            print(f"\n[ERROR] Frontend exited with code {frontend_status}")
            sys.exit(1)

        time.sleep(1)


def main() -> NoReturn:
    """Launch all development servers with graceful shutdown.

    The `finally` block is the only reliable cleanup path — `SystemExit`
    raised from `monitor_processes` (one child died) would otherwise skip
    the `except` clauses, leaking the surviving child and hanging the
    terminal on its open stdout/stderr pipes.
    """
    backend_process: subprocess.Popen[bytes] | None = None
    frontend_process: subprocess.Popen[bytes] | None = None
    exit_code = 0

    try:
        print("=" * 60)
        print("nearform-bmad-todo-app — Development Server Launcher")
        print("=" * 60)
        print()

        script_dir: Path = Path(__file__).parent

        start_docker(script_dir)
        print()

        backend_process = start_backend(script_dir)
        print()

        time.sleep(2)

        frontend_process = start_frontend(script_dir)
        print()

        print("=" * 60)
        print("Servers running. Press Ctrl+C to stop.")
        print("=" * 60)
        print()
        print("Backend:  http://localhost:8000")
        print("Frontend: http://localhost:5173")
        print("API Docs: http://localhost:8000/docs")
        print()

        monitor_processes(backend_process, frontend_process)

    except KeyboardInterrupt:
        print("\n")
        print("=" * 60)
        print("Shutting down servers...")
        print("=" * 60)
    except SystemExit as e:
        # Raised by monitor_processes when a child dies; fall through to
        # finally for cleanup of whichever child is still alive.
        exit_code = e.code if isinstance(e.code, int) else 1
    except (subprocess.SubprocessError, OSError) as e:
        print(f"\n[ERROR] Process error: {e}")
        exit_code = 1
    finally:
        if backend_process is not None:
            stop_process(backend_process, "backend server")
        if frontend_process is not None:
            stop_process(frontend_process, "frontend server")
        print()
        print("All servers stopped. Goodbye!")

    sys.exit(exit_code)


if __name__ == "__main__":
    main()
