from __future__ import annotations

from collections.abc import Iterable

from sqlalchemy.orm import Query

from app.core.config import settings
from app.models.saved_search import SavedSearch


def get_saved_search_max_per_user() -> int:
    return max(1, int(settings.MARKETLY_SAVED_SEARCH_MAX_PER_USER))


def ordered_saved_search_query(query: Query) -> Query:
    return query.order_by(SavedSearch.created_at.desc(), SavedSearch.id.desc())


def select_active_saved_searches(
    rows: Iterable[SavedSearch],
    *,
    per_user_limit: int | None = None,
) -> list[SavedSearch]:
    limit = get_saved_search_max_per_user() if per_user_limit is None else max(1, int(per_user_limit))
    active_rows: list[SavedSearch] = []
    counts_by_user: dict[str, int] = {}

    for row in rows:
        user_key = str(getattr(row, "user_id", "") or "")
        user_count = counts_by_user.get(user_key, 0)
        if user_count >= limit:
            continue
        counts_by_user[user_key] = user_count + 1
        active_rows.append(row)

    return active_rows
