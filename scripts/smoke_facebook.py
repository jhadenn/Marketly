import argparse
import asyncio
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BACKEND_DIR = ROOT / "backend"
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.connectors.facebook_marketplace import (  # noqa: E402
    FacebookConnectorError,
    FacebookMarketplaceConnector,
    FacebookSearchRequest,
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Smoke test for Facebook Marketplace connector.")
    parser.add_argument("--query", required=True, help="Search query")
    parser.add_argument("--location", default=None, help="Location text (city)")
    parser.add_argument("--limit", type=int, default=10, help="Max listings to fetch")
    parser.add_argument(
        "--auth-mode",
        default="guest",
        choices=["guest", "cookie"],
        help="Authentication mode",
    )
    parser.add_argument(
        "--cookie-path",
        default="secrets/fb_cookies.json",
        help="Cookie JSON path for cookie mode",
    )
    parser.add_argument("--radius-km", type=int, default=None, help="Search radius in km")
    parser.add_argument("--min-price", type=float, default=None, help="Minimum price")
    parser.add_argument("--max-price", type=float, default=None, help="Maximum price")
    parser.add_argument(
        "--sort",
        default="relevance",
        choices=["relevance", "newest", "price_low_to_high", "price_high_to_low"],
        help="Sort order",
    )
    return parser.parse_args()


async def run() -> int:
    args = parse_args()
    connector = FacebookMarketplaceConnector()
    request = FacebookSearchRequest(
        query=args.query,
        location_text=args.location,
        radius_km=args.radius_km,
        min_price=args.min_price,
        max_price=args.max_price,
        sort=args.sort,
        limit=max(1, min(args.limit, 100)),
        auth_mode=args.auth_mode,
        cookie_path=args.cookie_path,
        ingest=False,
    )

    try:
        records = await connector.search(request)
    except FacebookConnectorError as exc:
        print("Smoke test failed:")
        print(
            json.dumps(
                {
                    "code": exc.code.value,
                    "message": exc.message,
                    "retryable": exc.retryable,
                    "details": exc.details,
                },
                indent=2,
            )
        )
        return 1

    print(f"Fetched {len(records)} records.")
    for item in records[:5]:
        print(json.dumps(item.model_dump(mode="json"), indent=2))

    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(run()))
