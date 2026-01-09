from datetime import datetime
from sqlmodel import SQLModel, Session, create_engine, select

from marketly.models.listing import Listing

engine = create_engine("sqlite:///marketly.db", echo=False)

def init_db() -> None:
    SQLModel.metadata.create_all(engine)

def save_or_update_listing(new_listing: Listing) -> tuple[Listing, bool]:
    """
    Returns (listing, created)
    created=True if inserted, False if updated.
    """
    now = datetime.utcnow()

    with Session(engine) as session:
        existing = session.exec(
            select(Listing).where(Listing.url == new_listing.url)
        ).first()

        if existing is None:
            new_listing.first_seen = now
            new_listing.last_seen = now
            session.add(new_listing)
            session.commit()
            session.refresh(new_listing)
            return new_listing, True

        existing.title = new_listing.title
        existing.location = new_listing.location
        existing.price_cents = new_listing.price_cents
        existing.currency = new_listing.currency
        existing.last_seen = now

        session.add(existing)
        session.commit()
        session.refresh(existing)
        return existing, False
