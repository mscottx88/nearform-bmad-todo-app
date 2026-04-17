import uuid

from starlette.testclient import TestClient


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
