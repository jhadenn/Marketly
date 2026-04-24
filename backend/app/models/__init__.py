# Import models so Alembic can discover them
from app.models.facebook_sync_client import FacebookSyncClient  # noqa: F401
from app.models.facebook_sync_pairing_session import FacebookSyncPairingSession  # noqa: F401
from app.models.listing_snapshot import ListingSnapshot  # noqa: F401
from app.models.saved_search import SavedSearch  # noqa: F401
from app.models.saved_search_notification import SavedSearchNotification  # noqa: F401
from app.models.user_facebook_credential import UserFacebookCredential  # noqa: F401
from app.models.user_location_preference import UserLocationPreference  # noqa: F401
