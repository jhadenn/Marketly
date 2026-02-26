# Marketly Backend

## Facebook BYOC (Stage 1)

- Facebook unified search now uses per-user BYOC (bring your own cookies) instead of a shared server cookie.
- Configure `MARKETLY_CREDENTIALS_ENCRYPTION_KEY` (Fernet key) before using BYOC endpoints.
- Logged-in users manage cookies via:
  - `GET /me/connectors/facebook`
  - `PUT /me/connectors/facebook/cookies`
  - `POST /me/connectors/facebook/verify`
  - `DELETE /me/connectors/facebook`
- `GET /search` accepts optional `latitude`, `longitude`, and `radius_km` query params for better Facebook region relevance.
