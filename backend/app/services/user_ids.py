from __future__ import annotations


def normalize_user_id(user_id: object | None) -> str | None:
    if user_id is None:
        return None
    return str(user_id)
