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


class EmbeddingServiceError(AppError):
    def __init__(self, message: str = "Embedding service temporarily unavailable"):
        super().__init__(
            error="embedding_generation_failed",
            message=message,
            status_code=503,
        )
