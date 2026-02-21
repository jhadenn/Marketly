from app.connectors.ebay_connector import EbayConnector
from app.connectors.facebook_marketplace import FacebookUnifiedConnector
from app.connectors.kijiji_scrape import KijijiScrapeConnector

CONNECTORS = {
    "kijiji": KijijiScrapeConnector(region="canada"),
    "ebay": EbayConnector(),
    "facebook": FacebookUnifiedConnector(),
}
