from abc import ABC, abstractmethod
from app.models.listing import Listing


class MarketplaceConnector(ABC):
    source_name: str  # "ebay", "kijiji"

    @abstractmethod
    async def search(self, query: str, limit: int = 20) -> list[Listing]:
        raise NotImplementedError
