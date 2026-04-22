"""Story 4.6: group lifecycle — create/get/update/delete.

All methods are synchronous per CLAUDE.md Principle VI (thread-based
concurrency only — no async/await anywhere). Uses the same
`db: Session` + commit-then-refresh pattern as todo_service.
"""

import uuid

from sqlalchemy.orm import Session

from src.exceptions import (
    GroupNotFoundError,
    GroupTooSmallError,
    MemberAlreadyGroupedError,
    TodoNotFoundError,
)
from src.models.group import Group, GroupMembership
from src.models.todo import Todo
from src.schemas.group import GroupCreate, GroupResponse, GroupUpdate


def _build_response(db: Session, group: Group) -> GroupResponse:
    """Shape a Group ORM row + its memberships into a GroupResponse.

    Centralised so create/update/get responses all flatten the join
    table identically — keeps the route layer from reaching into the
    ORM directly.
    """
    member_ids = [
        row.todo_id
        for row in db.query(GroupMembership)
        .filter(GroupMembership.group_id == group.id)
        .all()
    ]
    return GroupResponse.model_validate(
        {
            "id": group.id,
            "label": group.label,
            "color": group.color,
            "member_ids": member_ids,
            "created_at": group.created_at,
        }
    )


def _require_unclaimed_members(
    db: Session,
    member_ids: list[uuid.UUID],
    allow_group_id: uuid.UUID | None = None,
) -> None:
    """Reject if any member is already in a DIFFERENT group.

    `allow_group_id` is set during PATCH so the members currently IN
    the group being updated are not flagged as "already grouped" —
    otherwise every member_ids update would fail on itself. On
    create, `allow_group_id` is None so ANY existing membership is
    a conflict.
    """
    if not member_ids:
        return
    query = db.query(GroupMembership).filter(GroupMembership.todo_id.in_(member_ids))
    if allow_group_id is not None:
        query = query.filter(GroupMembership.group_id != allow_group_id)
    conflicts = query.all()
    if conflicts:
        raise MemberAlreadyGroupedError([str(row.todo_id) for row in conflicts])


def _require_todos_exist(db: Session, member_ids: list[uuid.UUID]) -> None:
    """Guard against a group pointing at todos that don't exist (or
    have been soft-deleted). Without this, a group could be created
    with dangling member IDs and `_build_response` would still
    return them — which would confuse the frontend on first fetch.
    """
    if not member_ids:
        return
    rows = (
        db.query(Todo.id)
        .filter(Todo.id.in_(member_ids), Todo.deleted == False)  # noqa: E712
        .all()
    )
    found = {row[0] for row in rows}
    missing = [mid for mid in member_ids if mid not in found]
    if missing:
        raise TodoNotFoundError(str(missing[0]))


def create_group(db: Session, data: GroupCreate) -> GroupResponse:
    """Create a new group with the supplied members.

    Validates (in order): distinct-member count >= 2, every referenced
    todo exists and is not deleted, none of the members are already
    in a different group. Each check raises a typed AppError so the
    global handler can render a stable error envelope.
    """
    distinct_members = list(dict.fromkeys(data.member_ids))
    if len(distinct_members) < 2:
        raise GroupTooSmallError()
    _require_todos_exist(db, distinct_members)
    _require_unclaimed_members(db, distinct_members, allow_group_id=None)

    group = Group(label=data.label, color=data.color)
    db.add(group)
    db.flush()  # populate group.id + group.created_at without a full commit
    for todo_id in distinct_members:
        db.add(GroupMembership(group_id=group.id, todo_id=todo_id))
    db.commit()
    db.refresh(group)
    return _build_response(db, group)


def get_group(db: Session, group_id: uuid.UUID) -> Group:
    """Fetch a group by id or raise GroupNotFoundError."""
    group = db.query(Group).filter(Group.id == group_id).first()
    if not group:
        raise GroupNotFoundError(str(group_id))
    return group


def update_group(
    db: Session,
    group_id: uuid.UUID,
    data: GroupUpdate,
) -> GroupResponse:
    """Partially update a group's label and/or membership set.

    When `data.member_ids` is present it REPLACES the membership
    set — any existing member not in the new list is removed from
    the group, any new member is inserted. This is how pop-in /
    pop-out / Ungroup flow through from the frontend: they rebuild
    the desired list client-side and PATCH it here.
    """
    group = get_group(db, group_id)
    changed = False

    # Label update — allow explicitly clearing the label with
    # `{"label": null}`. model_dump(exclude_unset=True) keeps the
    # "absent" case distinct from the "explicitly null" case.
    fields = data.model_dump(exclude_unset=True)
    if "label" in fields:
        group.label = fields["label"]
        changed = True

    if "color" in fields:
        group.color = fields["color"]
        changed = True

    if data.member_ids is not None:
        distinct_members = list(dict.fromkeys(data.member_ids))
        if len(distinct_members) < 2:
            raise GroupTooSmallError()
        _require_todos_exist(db, distinct_members)
        _require_unclaimed_members(
            db,
            distinct_members,
            allow_group_id=group.id,
        )
        # Replace the set — delete current members, insert desired.
        db.query(GroupMembership).filter(GroupMembership.group_id == group.id).delete(
            synchronize_session=False
        )
        for todo_id in distinct_members:
            db.add(GroupMembership(group_id=group.id, todo_id=todo_id))
        changed = True

    if changed:
        db.commit()
        db.refresh(group)
    return _build_response(db, group)


def delete_group(db: Session, group_id: uuid.UUID) -> None:
    """Delete a group; CASCADE on GroupMembership drops memberships.

    Todos are NOT touched — deleting a group un-groups its members
    but keeps the pads on the pond. Raises GroupNotFoundError if
    the group doesn't exist (idempotency is the caller's problem —
    a 404 on a missing group is a useful signal).
    """
    group = get_group(db, group_id)
    db.delete(group)
    db.commit()
