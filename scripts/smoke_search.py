import argparse
import json
from collections import Counter

import requests


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Smoke test for unified /search endpoint.")
    parser.add_argument("--base-url", default="http://127.0.0.1:8000", help="API base URL")
    parser.add_argument("--query", required=True, help="Search query")
    parser.add_argument(
        "--sources",
        default="ebay,kijiji,facebook",
        help="Comma-separated sources list",
    )
    parser.add_argument("--limit", type=int, default=20, help="Page size")
    parser.add_argument("--offset", type=int, default=0, help="Page offset")
    parser.add_argument(
        "--include-facebook",
        action="store_true",
        help="Also set include_facebook=true query param",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()

    params: list[tuple[str, str]] = [
        ("q", args.query),
        ("limit", str(max(1, min(args.limit, 50)))),
        ("offset", str(max(0, args.offset))),
    ]
    for source in args.sources.split(","):
        cleaned = source.strip()
        if cleaned:
            params.append(("sources", cleaned))
    if args.include_facebook:
        params.append(("include_facebook", "true"))

    response = requests.get(f"{args.base_url}/search", params=params, timeout=45)
    print(f"HTTP {response.status_code}")
    response.raise_for_status()
    payload = response.json()

    results = payload.get("results", [])
    source_counts = Counter(item.get("source", "unknown") for item in results)

    print(f"query={payload.get('query')}")
    print(f"sources={payload.get('sources')}")
    print(f"count={payload.get('count')} total={payload.get('total')} next_offset={payload.get('next_offset')}")
    print(f"source_counts={dict(source_counts)}")

    source_errors = payload.get("source_errors") or {}
    if source_errors:
        print("source_errors=")
        print(json.dumps(source_errors, indent=2))
    else:
        print("source_errors={}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
