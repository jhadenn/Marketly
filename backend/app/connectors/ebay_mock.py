from app.connectors.base import MarketplaceConnector
from app.models.listing import Listing, Money


class EbayMockConnector(MarketplaceConnector):
    source_name = "ebay"

    async def search(self, query: str, limit: int = 20) -> list[Listing]:
        # Mock data (replace with real eBay API later)
        return [
            Listing(
                source="ebay",
                source_listing_id="ebay-123",
                title=f"{query} - eBay listing example",
                price=Money(amount=249.99, currency="CAD"),
                url="https://www.ebay.ca/itm/123",
                image_urls=["https://via.placeholder.com/300"],
                location="Canada",
                condition="Used",
                snippet="Example snippet from eBay mock connector.",
            )
        ][:limit]
