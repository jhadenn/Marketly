from sqlalchemy.orm import Session

from app.models.user_location_preference import UserLocationPreference
from app.schemas.location import ResolvedLocation
from app.services.user_ids import normalize_user_id


def get_user_location_preference(db: Session, user_id: object | None) -> UserLocationPreference | None:
    normalized_user_id = normalize_user_id(user_id)
    if not normalized_user_id:
        return None
    return (
        db.query(UserLocationPreference)
        .filter(UserLocationPreference.user_id == normalized_user_id)
        .first()
    )


def upsert_user_location_preference(
    db: Session,
    *,
    user_id: object,
    resolved: ResolvedLocation,
) -> UserLocationPreference:
    normalized_user_id = normalize_user_id(user_id)
    if not normalized_user_id:
        raise ValueError("user_id is required")

    row = get_user_location_preference(db, normalized_user_id)
    if row is None:
        row = UserLocationPreference(user_id=normalized_user_id)
        db.add(row)

    row.display_name = resolved.display_name
    row.city = resolved.city
    row.province_code = resolved.province_code
    row.province_name = resolved.province_name
    row.country_code = resolved.country_code
    row.latitude = resolved.latitude
    row.longitude = resolved.longitude
    row.mode = resolved.mode

    db.commit()
    db.refresh(row)
    return row


def delete_user_location_preference(db: Session, user_id: object | None) -> bool:
    row = get_user_location_preference(db, user_id)
    if row is None:
        return False
    db.delete(row)
    db.commit()
    return True
