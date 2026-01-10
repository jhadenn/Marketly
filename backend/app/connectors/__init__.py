from app.connectors.ebay_mock import EbayMockConnector
from app.connectors.kijiji_scrape import KijijiScrapeConnector

CONNECTORS = {
    "kijiji": KijijiScrapeConnector(region="canada"),
    "ebay": EbayMockConnector(),
}
