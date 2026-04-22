import uuid

from starlette.testclient import TestClient


def _make_todo(client: TestClient, text: str) -> str:
    """POST a todo and return its id. Kept tiny — every test in this
    module needs two or three pads seeded first.
    """
    resp = client.post("/api/todos", json={"text": text})
    assert resp.status_code == 201
    return str(resp.json()["id"])


def test_create_group_201(client: TestClient) -> None:
    a = _make_todo(client, "A")
    b = _make_todo(client, "B")
    resp = client.post(
        "/api/groups",
        json={"member_ids": [a, b], "label": "Errands"},
    )
    assert resp.status_code == 201
    data = resp.json()
    assert data["label"] == "Errands"
    assert set(data["member_ids"]) == {a, b}
    assert "id" in data
    assert "created_at" in data


def test_create_group_without_label(client: TestClient) -> None:
    # Label is optional — default None, no implicit placeholder.
    a = _make_todo(client, "A")
    b = _make_todo(client, "B")
    resp = client.post("/api/groups", json={"member_ids": [a, b]})
    assert resp.status_code == 201
    assert resp.json()["label"] is None


def test_create_group_with_already_grouped_member_returns_400(
    client: TestClient,
) -> None:
    a = _make_todo(client, "A")
    b = _make_todo(client, "B")
    c = _make_todo(client, "C")
    first = client.post("/api/groups", json={"member_ids": [a, b]})
    assert first.status_code == 201
    # Overlaps with existing membership — must reject.
    second = client.post("/api/groups", json={"member_ids": [b, c]})
    assert second.status_code == 400
    assert second.json()["error"] == "member_already_grouped"


def test_create_group_rejects_fewer_than_two_members(client: TestClient) -> None:
    a = _make_todo(client, "A")
    resp = client.post("/api/groups", json={"member_ids": [a]})
    assert resp.status_code == 400
    assert resp.json()["error"] == "group_too_small"


def test_create_group_rejects_unknown_member(client: TestClient) -> None:
    a = _make_todo(client, "A")
    phantom = str(uuid.uuid4())
    resp = client.post("/api/groups", json={"member_ids": [a, phantom]})
    assert resp.status_code == 404
    assert resp.json()["error"] == "not_found"


def test_patch_group_label(client: TestClient) -> None:
    a = _make_todo(client, "A")
    b = _make_todo(client, "B")
    gid = client.post("/api/groups", json={"member_ids": [a, b]}).json()["id"]
    resp = client.patch(f"/api/groups/{gid}", json={"label": "Renamed"})
    assert resp.status_code == 200
    assert resp.json()["label"] == "Renamed"


def test_patch_group_member_ids_replaces_set(client: TestClient) -> None:
    a = _make_todo(client, "A")
    b = _make_todo(client, "B")
    c = _make_todo(client, "C")
    gid = client.post("/api/groups", json={"member_ids": [a, b]}).json()["id"]
    resp = client.patch(
        f"/api/groups/{gid}",
        json={"member_ids": [a, c]},
    )
    assert resp.status_code == 200
    assert set(resp.json()["member_ids"]) == {a, c}
    # GET /api/todos confirms the swap from the other direction.
    todos = client.get("/api/todos").json()
    by_id = {t["id"]: t["group_id"] for t in todos}
    assert by_id[a] == gid
    assert by_id[c] == gid
    assert by_id[b] is None


def test_patch_group_not_found(client: TestClient) -> None:
    resp = client.patch(
        f"/api/groups/{uuid.uuid4()}",
        json={"label": "ghost"},
    )
    assert resp.status_code == 404
    assert resp.json()["error"] == "not_found"


def test_delete_group_204(client: TestClient) -> None:
    a = _make_todo(client, "A")
    b = _make_todo(client, "B")
    gid = client.post("/api/groups", json={"member_ids": [a, b]}).json()["id"]
    resp = client.delete(f"/api/groups/{gid}")
    assert resp.status_code == 204
    assert resp.content == b""
    # Pads survive disband; their group_id flips back to null.
    todos = client.get("/api/todos").json()
    for t in todos:
        assert t["group_id"] is None


def test_delete_group_missing_returns_404(client: TestClient) -> None:
    resp = client.delete(f"/api/groups/{uuid.uuid4()}")
    assert resp.status_code == 404
    assert resp.json()["error"] == "not_found"


def test_get_todos_surfaces_group_id_for_grouped_pads(
    client: TestClient,
) -> None:
    a = _make_todo(client, "A")
    b = _make_todo(client, "B")
    c = _make_todo(client, "C")  # solo
    gid = client.post("/api/groups", json={"member_ids": [a, b]}).json()["id"]
    todos = client.get("/api/todos").json()
    by_id = {t["id"]: t["group_id"] for t in todos}
    assert by_id[a] == gid
    assert by_id[b] == gid
    assert by_id[c] is None
