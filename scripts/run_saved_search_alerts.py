from __future__ import annotations

import argparse
import asyncio
import json
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
BACKEND_ROOT = ROOT / "backend"
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app.core.config import settings  # noqa: E402
from app.db import SessionLocal  # noqa: E402
from app.services.alerts import run_saved_search_alert_job  # noqa: E402


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run Marketly saved-search alert digests.")
    parser.add_argument(
        "--limit",
        type=int,
        default=int(settings.MARKETLY_ALERTS_SEARCH_LIMIT),
        help="How many listings to evaluate per saved search.",
    )
    parser.add_argument(
        "--user-id",
        type=str,
        default=None,
        help="Optional user filter for targeted runs.",
    )
    parser.add_argument(
        "--saved-search-id",
        type=int,
        default=None,
        help="Optional saved search id for targeted runs.",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    db = SessionLocal()
    try:
        result = asyncio.run(
            run_saved_search_alert_job(
                db,
                limit_per_search=max(1, args.limit),
                user_id=args.user_id,
                saved_search_id=args.saved_search_id,
            )
        )
    finally:
        db.close()

    print(json.dumps(result))


if __name__ == "__main__":
    main()
