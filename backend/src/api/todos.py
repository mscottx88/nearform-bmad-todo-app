from fastapi import APIRouter

router = APIRouter(prefix="/api/todos", tags=["todos"])


@router.get("")
def list_todos() -> list[dict]:
    return []
