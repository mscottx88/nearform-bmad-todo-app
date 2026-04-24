import threading
import time
import uuid
from unittest.mock import patch

from starlette.testclient import TestClient


def test_create_todo_assigns_random_rotation(client: TestClient) -> None:
    # 2026-04-23: rotation_y is server-generated random at insert so
    # pads keep the same orientation across reloads. Client never
    # sends it. Two consecutive creates should land on different
    # rotations (modulo astronomically-unlikely collisions) and both
    # values must be in [0, 2π).
    import math

    r1 = client.post("/api/todos", json={"text": "First"}).json()["rotation_y"]
    r2 = client.post("/api/todos", json={"text": "Second"}).json()["rotation_y"]
    assert 0 <= r1 < 2 * math.pi
    assert 0 <= r2 < 2 * math.pi
    assert r1 != r2


def test_update_positions_applies_rotation(client: TestClient) -> None:
    # 2026-04-23 (revised): rotation_y is now part of the batch so a
    # cascade-pushed pad can persist the facing direction it rotated
    # to during the shove. The batch value overwrites the stored
    # rotation_y.
    create_resp = client.post("/api/todos", json={"text": "Rotates on push"})
    todo_id = create_resp.json()["id"]
    response = client.patch(
        "/api/todos/positions",
        json={
            "positions": [
                {
                    "id": todo_id,
                    "position_x": 4.0,
                    "position_y": 5.0,
                    "rotation_y": 1.57,
                }
            ]
        },
    )
    assert response.status_code == 200
    row = response.json()[0]
    assert row["position_x"] == 4.0
    assert row["rotation_y"] == 1.57


def test_create_todo(client: TestClient) -> None:
    response = client.post(
        "/api/todos",
        json={"text": "Review Q2 roadmap"},
    )
    assert response.status_code == 201
    data = response.json()
    assert data["text"] == "Review Q2 roadmap"
    assert data["completed"] is False
    assert data["color"] == "#00ff88"
    assert data["embedding_status"] == "pending"
    assert data["deleted"] is False
    assert "id" in data
    assert "created_at" in data


def test_create_todo_with_color(client: TestClient) -> None:
    response = client.post(
        "/api/todos",
        json={"text": "Pink task", "color": "#ff10f0"},
    )
    assert response.status_code == 201
    assert response.json()["color"] == "#ff10f0"


def test_create_todo_invalid_color(client: TestClient) -> None:
    response = client.post(
        "/api/todos",
        json={"text": "Bad color", "color": "red"},
    )
    assert response.status_code == 422
    data = response.json()
    assert data["error"] == "validation_error"
    assert "message" in data


def test_create_todo_empty_text(client: TestClient) -> None:
    response = client.post("/api/todos", json={"text": ""})
    assert response.status_code == 422
    assert response.json()["error"] == "validation_error"


def test_create_todo_whitespace_only_text(client: TestClient) -> None:
    # min_length=1 lets "   " through; the field_validator rejects it.
    response = client.post("/api/todos", json={"text": "   "})
    assert response.status_code == 422
    assert response.json()["error"] == "validation_error"


def test_update_todo_whitespace_only_text(client: TestClient) -> None:
    create_resp = client.post("/api/todos", json={"text": "valid"})
    todo_id = create_resp.json()["id"]
    response = client.patch(
        f"/api/todos/{todo_id}",
        json={"text": "   \t\n"},
    )
    assert response.status_code == 422
    assert response.json()["error"] == "validation_error"


def test_list_todos_empty(client: TestClient) -> None:
    response = client.get("/api/todos")
    assert response.status_code == 200
    assert response.json() == []


def test_list_todos_returns_created(client: TestClient) -> None:
    client.post("/api/todos", json={"text": "First"})
    client.post("/api/todos", json={"text": "Second"})
    response = client.get("/api/todos")
    assert response.status_code == 200
    data = response.json()
    assert len(data) == 2
    texts = {d["text"] for d in data}
    assert texts == {"First", "Second"}


def test_list_todos_excludes_deleted(client: TestClient) -> None:
    create_resp = client.post(
        "/api/todos",
        json={"text": "Delete me"},
    )
    todo_id = create_resp.json()["id"]
    client.delete(f"/api/todos/{todo_id}")
    response = client.get("/api/todos")
    assert response.json() == []


def test_update_todo(client: TestClient) -> None:
    create_resp = client.post(
        "/api/todos",
        json={"text": "Update me"},
    )
    todo_id = create_resp.json()["id"]
    response = client.patch(
        f"/api/todos/{todo_id}",
        json={"completed": True},
    )
    assert response.status_code == 200
    assert response.json()["completed"] is True
    assert response.json()["text"] == "Update me"


def test_update_todo_color(client: TestClient) -> None:
    create_resp = client.post(
        "/api/todos",
        json={"text": "Color me"},
    )
    todo_id = create_resp.json()["id"]
    response = client.patch(
        f"/api/todos/{todo_id}",
        json={"color": "#ffd700"},
    )
    assert response.status_code == 200
    assert response.json()["color"] == "#ffd700"


def test_update_positions_batch(client: TestClient) -> None:
    # Create three pads with distinct starting positions. The batch
    # endpoint then shifts all three in a single request; the response
    # echoes the committed state and GET reflects the same values.
    id_a = client.post("/api/todos", json={"text": "A"}).json()["id"]
    id_b = client.post("/api/todos", json={"text": "B"}).json()["id"]
    id_c = client.post("/api/todos", json={"text": "C"}).json()["id"]
    response = client.patch(
        "/api/todos/positions",
        json={
            "positions": [
                {"id": id_a, "position_x": 1.5, "position_y": 2.5, "rotation_y": 0.1},
                {"id": id_b, "position_x": -3.0, "position_y": 4.0, "rotation_y": 0.2},
                {"id": id_c, "position_x": 0.0, "position_y": -1.0, "rotation_y": 0.3},
            ]
        },
    )
    assert response.status_code == 200
    body = response.json()
    assert len(body) == 3
    # Response preserves input order.
    assert [row["id"] for row in body] == [id_a, id_b, id_c]
    assert body[0]["position_x"] == 1.5
    assert body[0]["position_y"] == 2.5
    assert body[1]["position_x"] == -3.0
    assert body[2]["position_y"] == -1.0


def test_update_positions_skips_missing_ids(client: TestClient) -> None:
    # Mixed batch: one real id, one fabricated id. The batch applies
    # the real one and silently drops the missing — keeps drag-release
    # batches robust against a sibling being deleted between drag-start
    # and drag-release.
    real_id = client.post("/api/todos", json={"text": "Real"}).json()["id"]
    fake_id = str(uuid.uuid4())
    response = client.patch(
        "/api/todos/positions",
        json={
            "positions": [
                {"id": real_id, "position_x": 7.0, "position_y": 8.0, "rotation_y": 0.0},
                {
                    "id": fake_id,
                    "position_x": 99.0,
                    "position_y": 99.0,
                    "rotation_y": 0.0,
                },
            ]
        },
    )
    assert response.status_code == 200
    body = response.json()
    assert len(body) == 1
    assert body[0]["id"] == real_id
    assert body[0]["position_x"] == 7.0


def test_update_positions_rejects_empty_batch(client: TestClient) -> None:
    response = client.patch("/api/todos/positions", json={"positions": []})
    assert response.status_code == 422
    assert response.json()["error"] == "validation_error"


def test_update_positions_does_not_touch_other_fields(client: TestClient) -> None:
    # Batch must leave text / completed / color untouched — it is a
    # position-only endpoint. Verifies no accidental setattr of other
    # request keys via model_dump side effects.
    create_resp = client.post(
        "/api/todos",
        json={"text": "Stays intact", "color": "#ff00aa"},
    )
    todo_id = create_resp.json()["id"]
    # Complete the pad first so we can see if the batch accidentally
    # flips it.
    client.patch(f"/api/todos/{todo_id}", json={"completed": True})
    response = client.patch(
        "/api/todos/positions",
        json={
            "positions": [
                {
                    "id": todo_id,
                    "position_x": 5.5,
                    "position_y": 6.5,
                    "rotation_y": 0.0,
                }
            ]
        },
    )
    assert response.status_code == 200
    row = response.json()[0]
    assert row["position_x"] == 5.5
    assert row["position_y"] == 6.5
    assert row["text"] == "Stays intact"
    assert row["color"] == "#ff00aa"
    assert row["completed"] is True


def test_update_positions_accepts_soft_deleted(client: TestClient) -> None:
    # Soft-deleted pads remain draggable through `/show-deleted`, and
    # the client's drag pipeline drives position through this batch
    # endpoint. Position is a layout attribute that should persist
    # regardless of deletion state, so the batch MUST apply to a
    # soft-deleted row.
    create_resp = client.post("/api/todos", json={"text": "Deleted but draggable"})
    todo_id = create_resp.json()["id"]
    client.delete(f"/api/todos/{todo_id}")
    response = client.patch(
        "/api/todos/positions",
        json={
            "positions": [
                {
                    "id": todo_id,
                    "position_x": 1.0,
                    "position_y": 2.0,
                    "rotation_y": 0.0,
                }
            ]
        },
    )
    assert response.status_code == 200
    body = response.json()
    assert len(body) == 1
    assert body[0]["id"] == todo_id
    assert body[0]["position_x"] == 1.0
    assert body[0]["position_y"] == 2.0
    assert body[0]["deleted"] is True


def test_update_positions_post_beacon_alias(client: TestClient) -> None:
    # navigator.sendBeacon is POST-only; the POST /positions alias must
    # accept the same payload and produce the same result as PATCH.
    id_a = client.post("/api/todos", json={"text": "Beacon A"}).json()["id"]
    id_b = client.post("/api/todos", json={"text": "Beacon B"}).json()["id"]
    response = client.post(
        "/api/todos/positions",
        json={
            "positions": [
                {"id": id_a, "position_x": 3.5, "position_y": 4.5, "rotation_y": 0.1},
                {"id": id_b, "position_x": -2.0, "position_y": 1.0, "rotation_y": 0.2},
            ]
        },
    )
    assert response.status_code == 204
    assert response.content == b""
    # Verify positions were actually persisted (fire-and-forget gives no body).
    todos = client.get("/api/todos").json()
    a = next(t for t in todos if t["id"] == id_a)
    b = next(t for t in todos if t["id"] == id_b)
    assert a["position_x"] == 3.5
    assert a["position_y"] == 4.5
    assert b["position_x"] == -2.0


def test_update_todo_not_found(client: TestClient) -> None:
    fake_id = str(uuid.uuid4())
    response = client.patch(
        f"/api/todos/{fake_id}",
        json={"text": "nope"},
    )
    assert response.status_code == 404
    data = response.json()
    assert data["error"] == "not_found"


def test_delete_todo(client: TestClient) -> None:
    create_resp = client.post(
        "/api/todos",
        json={"text": "Delete me"},
    )
    todo_id = create_resp.json()["id"]
    response = client.delete(f"/api/todos/{todo_id}")
    assert response.status_code == 200
    data = response.json()
    assert data["deleted"] is True
    assert data["deleted_at"] is not None


def test_delete_todo_not_found(client: TestClient) -> None:
    fake_id = str(uuid.uuid4())
    response = client.delete(f"/api/todos/{fake_id}")
    assert response.status_code == 404
    data = response.json()
    assert data["error"] == "not_found"


def test_create_todo_enqueues_embedding(client: TestClient) -> None:
    with patch(
        "src.services.todo_service.embedding_worker.enqueue_embedding",
    ) as mock_enqueue:
        response = client.post("/api/todos", json={"text": "Review Q2 roadmap"})

    assert response.status_code == 201
    todo_id = uuid.UUID(response.json()["id"])
    mock_enqueue.assert_called_once_with(todo_id)


def test_create_todo_response_time_not_affected(client: TestClient) -> None:
    # Patch the embedding SDK call to block on an Event. If anyone moves
    # the embedding work onto the request path (direct generate_embedding
    # call, FastAPI BackgroundTasks, etc.), the POST will block waiting
    # for this Event and the time assertion fails. If the work runs in
    # the ThreadPoolExecutor as intended, the POST returns fast and the
    # worker thread sits on `release.wait()` until the `finally` unblocks
    # it. This is a real thread-isolation test, not a tautology.
    release = threading.Event()

    def blocking_embed(_text: str) -> list[float]:
        # Bounded wait so a bug can't deadlock the test suite.
        release.wait(timeout=5.0)
        return [0.0] * 768

    with patch(
        "src.workers.embedding_worker.embedding_service.generate_embedding",
        side_effect=blocking_embed,
    ):
        try:
            start = time.perf_counter()
            response = client.post("/api/todos", json={"text": "Fast path"})
            elapsed = time.perf_counter() - start
        finally:
            # Always release the worker so lifespan shutdown (wait=True)
            # doesn't stall teardown by 5s.
            release.set()

    assert response.status_code == 201
    # The blocking_embed sleeps up to 5s on the worker thread. A response
    # time under 1s proves the embedding is NOT on the request path.
    assert elapsed < 1.0, (
        f"POST /api/todos took {elapsed:.3f}s — embedding in request path?"
    )


# Story 3.3: visibility-flag query params on GET /api/todos.
def _seed_visibility_mix(client: TestClient) -> dict[str, list[str]]:
    active_texts = ["Active-A", "Active-B", "Active-C"]
    for text in active_texts:
        client.post("/api/todos", json={"text": text})
    completed_resp = client.post("/api/todos", json={"text": "Completed-1"})
    client.patch(
        f"/api/todos/{completed_resp.json()['id']}",
        json={"completed": True},
    )
    deleted_resp = client.post("/api/todos", json={"text": "Deleted-1"})
    client.delete(f"/api/todos/{deleted_resp.json()['id']}")
    return {
        "active": active_texts,
        "completed": ["Completed-1"],
        "deleted": ["Deleted-1"],
    }


def test_list_todos_default_preserves_pre_3_3_contract(client: TestClient) -> None:
    seed = _seed_visibility_mix(client)
    response = client.get("/api/todos")
    assert response.status_code == 200
    assert {t["text"] for t in response.json()} == set(seed["active"])


def test_list_todos_include_completed_only(client: TestClient) -> None:
    seed = _seed_visibility_mix(client)
    response = client.get(
        "/api/todos?include_active=false&include_completed=true&include_deleted=false",
    )
    assert response.status_code == 200
    assert {t["text"] for t in response.json()} == set(seed["completed"])


def test_list_todos_include_deleted_only(client: TestClient) -> None:
    seed = _seed_visibility_mix(client)
    response = client.get(
        "/api/todos?include_active=false&include_completed=false&include_deleted=true",
    )
    assert response.status_code == 200
    assert {t["text"] for t in response.json()} == set(seed["deleted"])


def test_list_todos_all_three_flags_true(client: TestClient) -> None:
    seed = _seed_visibility_mix(client)
    response = client.get(
        "/api/todos?include_active=true&include_completed=true&include_deleted=true",
    )
    assert response.status_code == 200
    expected = set(seed["active"]) | set(seed["completed"]) | set(seed["deleted"])
    assert {t["text"] for t in response.json()} == expected


def test_list_todos_all_flags_false_returns_empty(client: TestClient) -> None:
    _seed_visibility_mix(client)
    response = client.get(
        "/api/todos?include_active=false&include_completed=false&include_deleted=false",
    )
    assert response.status_code == 200
    assert response.json() == []


def test_restore_deleted_todo_round_trip(client: TestClient) -> None:
    # Story 3.3: POST /api/todos/:id/restore undeletes a soft-deleted row.
    create_resp = client.post("/api/todos", json={"text": "Bring me back"})
    todo_id = create_resp.json()["id"]
    client.delete(f"/api/todos/{todo_id}")
    # After delete: default list excludes it.
    assert client.get("/api/todos").json() == []
    # Restore returns deleted=false + deleted_at=null.
    restore_resp = client.post(f"/api/todos/{todo_id}/restore")
    assert restore_resp.status_code == 200
    assert restore_resp.json()["deleted"] is False
    assert restore_resp.json()["deleted_at"] is None
    # And the default list now includes it again.
    listed = client.get("/api/todos").json()
    assert [t["id"] for t in listed] == [todo_id]


def test_restore_missing_todo_returns_404(client: TestClient) -> None:
    import uuid as _uuid

    response = client.post(f"/api/todos/{_uuid.uuid4()}/restore")
    assert response.status_code == 404
    assert response.json()["error"] == "not_found"


def test_response_uses_snake_case(client: TestClient) -> None:
    create_resp = client.post(
        "/api/todos",
        json={"text": "Snake case"},
    )
    data = create_resp.json()
    assert "embedding_status" in data
    assert "created_at" in data
    assert "updated_at" in data
    assert "position_x" in data
    assert "embeddingStatus" not in data
    assert "createdAt" not in data
