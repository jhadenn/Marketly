from marketly.collectors.kijiji import search
from marketly.storage.db import init_db, save_or_update_listing

# Paste your Kijiji search URL here:
SEARCH_URL = "https://www.kijiji.ca/b-buy-sell/canada/iphone/k0c10l0"

def main():
    init_db()

    listings = search(SEARCH_URL)
    created = updated = 0

    for l in listings:
        _, was_created = save_or_update_listing(l)
        created += int(was_created)
        updated += int(not was_created)

    print(f"Fetched {len(listings)} listings. Inserted: {created}. Updated: {updated}.")

if __name__ == "__main__":
    main()
