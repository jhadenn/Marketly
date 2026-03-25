from sqlalchemy.orm import Session

from app.models.user_location_preference import UserLocationPreference
from app.schemas.location import ResolvedLocation


def get_user_location_preference(db: Session, user_id: str) -> UserLocationPreference | None:
    return (
        db.query(UserLocationPreference)
        .filter(UserLocationPreference.user_id == user_id)
        .first()
    )


def upsert_user_location_preference(
    db: Session,
    *,
    user_id: str,
    resolved: ResolvedLocation,
) -> UserLocationPreference:
    row = get_user_location_preference(db, user_id)
    if row is None:
        row = UserLocationPreference(user_id=user_id)
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


def delete_user_location_preference(db: Session, user_id: str) -> bool:
    row = get_user_location_preference(db, user_id)
    if row is None:
        return False
    db.delete(row)
    db.commit()
    return True
