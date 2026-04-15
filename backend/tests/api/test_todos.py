from starlette.testclient import TestClient


def test_list_todos_returns_empty_array(client: TestClient) -> None:
    response = client.get("/api/todos")
    assert response.status_code == 200
    assert response.json() == []
