import uuid

import pytest
from sqlalchemy.orm import Session

from src.exceptions import (
    GroupNotFoundError,
    GroupTooSmallError,
    MemberAlreadyGroupedError,
    TodoNotFoundError,
)
from src.models.group import GroupMembership
from src.schemas.group import GroupCreate, GroupUpdate
from src.schemas.todo import TodoCreate
from src.services import group_service, todo_service


def _make_todos(db: Session, count: int) -> list[uuid.UUID]:
    """Seed `count` active todos and return their ids in order.

    Each test builds its own fresh set because `_clean_db` in conftest
    wipes the world between tests — keeping seeds inline is less
    magical than a shared fixture and matches test_todo_service's
    style.
    """
    return [
        todo_service.create_todo(db, TodoCreate(text=f"Todo {i}")).id
        for i in range(count)
    ]


def test_create_group_round_trip(db_session: Session) -> None:
    ids = _make_todos(db_session, 3)
    response = group_service.create_group(
        db_session,
        GroupCreate(member_ids=ids, label="Errands"),
    )
    assert response.label == "Errands"
    assert set(response.member_ids) == set(ids)
    assert response.id is not None
    # list_todos should surface each member's group_id on the next fetch.
    todos = todo_service.list_todos(db_session)
    for t in todos:
        assert t.group_id == response.id


def test_create_group_fails_if_member_already_grouped(
    db_session: Session,
) -> None:
    ids = _make_todos(db_session, 4)
    group_service.create_group(
        db_session,
        GroupCreate(member_ids=ids[:2]),
    )
    # Overlapping member — second create must reject.
    with pytest.raises(MemberAlreadyGroupedError):
        group_service.create_group(
            db_session,
            GroupCreate(member_ids=[ids[1], ids[2], ids[3]]),
        )


def test_create_group_rejects_fewer_than_two_distinct_members(
    db_session: Session,
) -> None:
    ids = _make_todos(db_session, 1)
    with pytest.raises(GroupTooSmallError):
        group_service.create_group(
            db_session,
            GroupCreate(member_ids=ids),
        )
    # Duplicates collapse — [a, a] has one distinct member → reject.
    dup_ids = _make_todos(db_session, 1)
    with pytest.raises(GroupTooSmallError):
        group_service.create_group(
            db_session,
            GroupCreate(member_ids=[dup_ids[0], dup_ids[0]]),
        )


def test_create_group_rejects_missing_todo(db_session: Session) -> None:
    ids = _make_todos(db_session, 1)
    phantom = uuid.uuid4()
    with pytest.raises(TodoNotFoundError):
        group_service.create_group(
            db_session,
            GroupCreate(member_ids=[ids[0], phantom]),
        )


def test_create_group_rejects_deleted_todo(db_session: Session) -> None:
    ids = _make_todos(db_session, 2)
    todo_service.delete_todo(db_session, ids[1])
    # The soft-deleted pad is hidden from the UI; it must not be
    # allowed into a new group either — otherwise the cluster would
    # render with a ghost member.
    with pytest.raises(TodoNotFoundError):
        group_service.create_group(
            db_session,
            GroupCreate(member_ids=ids),
        )


def test_update_group_label_only(db_session: Session) -> None:
    ids = _make_todos(db_session, 2)
    created = group_service.create_group(
        db_session,
        GroupCreate(member_ids=ids),
    )
    updated = group_service.update_group(
        db_session,
        created.id,
        GroupUpdate(label="Renamed"),
    )
    assert updated.label == "Renamed"
    # Membership untouched.
    assert set(updated.member_ids) == set(ids)


def test_update_group_label_to_null(db_session: Session) -> None:
    ids = _make_todos(db_session, 2)
    created = group_service.create_group(
        db_session,
        GroupCreate(member_ids=ids, label="Temp"),
    )
    cleared = group_service.update_group(
        db_session,
        created.id,
        GroupUpdate(label=None),
    )
    assert cleared.label is None


def test_update_group_member_ids_replaces_set(db_session: Session) -> None:
    ids = _make_todos(db_session, 3)
    created = group_service.create_group(
        db_session,
        GroupCreate(member_ids=ids[:2]),
    )
    updated = group_service.update_group(
        db_session,
        created.id,
        GroupUpdate(member_ids=[ids[0], ids[2]]),
    )
    # Replacement semantics — ids[1] is dropped from the set.
    assert set(updated.member_ids) == {ids[0], ids[2]}
    # And the DB reflects the swap (no orphaned rows).
    rows = (
        db_session.query(GroupMembership)
        .filter(GroupMembership.group_id == created.id)
        .all()
    )
    assert {r.todo_id for r in rows} == {ids[0], ids[2]}


def test_update_group_rejects_member_already_in_another_group(
    db_session: Session,
) -> None:
    ids = _make_todos(db_session, 4)
    group_a = group_service.create_group(
        db_session,
        GroupCreate(member_ids=ids[:2]),
    )
    group_service.create_group(
        db_session,
        GroupCreate(member_ids=ids[2:]),
    )
    # Trying to pull ids[2] into group_a must fail — it's still in group_b.
    with pytest.raises(MemberAlreadyGroupedError):
        group_service.update_group(
            db_session,
            group_a.id,
            GroupUpdate(member_ids=[ids[0], ids[2]]),
        )


def test_update_group_not_found(db_session: Session) -> None:
    with pytest.raises(GroupNotFoundError):
        group_service.update_group(
            db_session,
            uuid.uuid4(),
            GroupUpdate(label="ghost"),
        )


def test_update_group_member_ids_respects_size_floor(
    db_session: Session,
) -> None:
    ids = _make_todos(db_session, 2)
    created = group_service.create_group(
        db_session,
        GroupCreate(member_ids=ids),
    )
    # Reducing to a single member is meaningless — reject. The Ungroup
    # flow in the frontend knows to DELETE instead of PATCH in this
    # case (see story AC #6).
    with pytest.raises(GroupTooSmallError):
        group_service.update_group(
            db_session,
            created.id,
            GroupUpdate(member_ids=[ids[0]]),
        )


def test_delete_group_removes_group_but_keeps_todos(
    db_session: Session,
) -> None:
    ids = _make_todos(db_session, 2)
    created = group_service.create_group(
        db_session,
        GroupCreate(member_ids=ids),
    )
    group_service.delete_group(db_session, created.id)
    # Group gone — re-fetch must raise.
    with pytest.raises(GroupNotFoundError):
        group_service.get_group(db_session, created.id)
    # Cascade dropped the join rows.
    assert (
        db_session.query(GroupMembership)
        .filter(GroupMembership.group_id == created.id)
        .count()
        == 0
    )
    # But the pads themselves are still on the pond.
    todos = todo_service.list_todos(db_session)
    assert {t.id for t in todos} == set(ids)
    # And their group_id is now null (solo again).
    for t in todos:
        assert t.group_id is None


def test_delete_group_not_found(db_session: Session) -> None:
    with pytest.raises(GroupNotFoundError):
        group_service.delete_group(db_session, uuid.uuid4())


def test_list_todos_includes_group_id_for_members(db_session: Session) -> None:
    ids = _make_todos(db_session, 3)
    created = group_service.create_group(
        db_session,
        GroupCreate(member_ids=ids[:2]),
    )
    todos = todo_service.list_todos(db_session)
    id_to_group = {t.id: t.group_id for t in todos}
    assert id_to_group[ids[0]] == created.id
    assert id_to_group[ids[1]] == created.id
    # Solo pad (never grouped) reports null.
    assert id_to_group[ids[2]] is None


def test_update_todo_response_carries_group_id(db_session: Session) -> None:
    # Regression guard — before story 4.6, update_todo returned a raw
    # Todo ORM row so the response had no group_id. A PATCH on a
    # grouped pad would appear to unclaim it in the React Query cache
    # until the next list_todos fetch landed. The service now echoes
    # the current membership back.
    ids = _make_todos(db_session, 2)
    created = group_service.create_group(
        db_session,
        GroupCreate(member_ids=ids),
    )
    from src.schemas.todo import TodoUpdate

    updated = todo_service.update_todo(
        db_session,
        ids[0],
        TodoUpdate(position_x=1.0, position_y=2.0),
    )
    assert updated.group_id == created.id


def test_delete_todo_response_carries_group_id(db_session: Session) -> None:
    # Same contract as update — soft-delete via popup still returns
    # the pad's current group_id so the optimistic cache stays
    # coherent until the list refetches.
    ids = _make_todos(db_session, 2)
    created = group_service.create_group(
        db_session,
        GroupCreate(member_ids=ids),
    )
    deleted = todo_service.delete_todo(db_session, ids[0])
    assert deleted.group_id == created.id
