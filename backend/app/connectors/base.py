from abc import ABC, abstractmethod
from app.models.listing import Listing, SearchSort


class MarketplaceConnector(ABC):
    source_name: str  # "ebay", "kijiji"

    @abstractmethod
    async def search(
        self,
        query: str,
        limit: int = 20,
        *,
        sort: SearchSort = "relevance",
    ) -> list[Listing]:
        raise NotImplementedError
