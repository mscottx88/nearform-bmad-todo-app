import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict


class GroupCreate(BaseModel):
    """Request payload for POST /api/groups.

    `member_ids` must contain at least two entries — a group of one
    is meaningless UI (no shared halo, no "inside the halo"
    threshold). The service additionally validates that none of the
    member todos is already in a different group.
    """

    member_ids: list[uuid.UUID]
    label: str | None = None
    color: str | None = None


class GroupUpdate(BaseModel):
    """Request payload for PATCH /api/groups/{id}.

    All fields optional. When `member_ids` is present the service
    treats it as a full replacement of the group's membership set
    (delete old `GroupMembership` rows, insert new ones). Omitting
    `member_ids` leaves membership untouched, allowing a pure label
    or color update to flow through without a round-trip on the members.
    """

    label: str | None = None
    color: str | None = None
    member_ids: list[uuid.UUID] | None = None


class GroupResponse(BaseModel):
    """Canonical group representation returned by every group route.

    `member_ids` is flattened from the join table into a list so the
    frontend doesn't need a second request to build the cluster. The
    list order is not guaranteed by the backend — clients must not
    rely on membership ordering for UI (e.g., do NOT key visual
    indices off this list).
    """

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    label: str | None
    color: str | None
    member_ids: list[uuid.UUID]
    created_at: datetime
