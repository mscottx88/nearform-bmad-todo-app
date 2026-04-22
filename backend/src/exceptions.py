class AppError(Exception):
    def __init__(
        self,
        error: str,
        message: str,
        status_code: int = 400,
        detail: str | None = None,
    ):
        self.error = error
        self.message = message
        self.status_code = status_code
        self.detail = detail
        super().__init__(message)


class TodoNotFoundError(AppError):
    def __init__(self, todo_id: str):
        super().__init__(
            error="not_found",
            message=f"Todo with id {todo_id} not found",
            status_code=404,
        )


class GroupNotFoundError(AppError):
    def __init__(self, group_id: str):
        super().__init__(
            error="not_found",
            message=f"Group with id {group_id} not found",
            status_code=404,
        )


class MemberAlreadyGroupedError(AppError):
    """Raised on POST /api/groups or PATCH /api/groups/{id} when one
    or more of the incoming member IDs already belongs to a different
    group. One pad can be in at most one group at a time; the caller
    must dissolve / pop-out the pad before it can join a new group.
    """

    def __init__(self, conflicts: list[str]):
        super().__init__(
            error="member_already_grouped",
            message="One or more members are already in a group",
            status_code=400,
            detail=",".join(conflicts),
        )


class GroupTooSmallError(AppError):
    """Raised on POST /api/groups when fewer than 2 distinct
    `member_ids` are supplied. A group of one pad is meaningless UI
    (no shared halo, no "inside the halo" threshold) so we reject
    it at the service boundary rather than propagate the degenerate
    state into the DB.
    """

    def __init__(self) -> None:
        super().__init__(
            error="group_too_small",
            message="A group must contain at least two distinct members",
            status_code=400,
        )


class EmbeddingServiceError(AppError):
    def __init__(self, message: str = "Embedding service temporarily unavailable"):
        super().__init__(
            error="embedding_generation_failed",
            message=message,
            status_code=503,
        )


class EmbeddingApiKeyMissingError(AppError):
    recoverable = True

    def __init__(self) -> None:
        super().__init__(
            error="embedding_generation_failed",
            message="Embedding service not configured",
            status_code=503,
        )


class EmbeddingDimensionError(AppError):
    recoverable = True

    def __init__(self, got: int, expected: int = 768) -> None:
        super().__init__(
            error="embedding_generation_failed",
            message="Embedding service returned unexpected response",
            status_code=500,
            detail=f"expected {expected}-dim vector, got {got}-dim",
        )
