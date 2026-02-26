from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    DATABASE_URL: str
    SUPABASE_JWT_SECRET: str | None = None
    SUPABASE_URL: str | None = None
    SUPABASE_ANON_KEY: str | None = None
    SUPABASE_SERVICE_ROLE_KEY: str | None = None
    SUPABASE_LISTINGS_TABLE: str = "listings"
    MARKETLY_ENABLE_FACEBOOK: bool = False
    MARKETLY_FACEBOOK_AUTH_MODE: str = "guest"
    MARKETLY_FACEBOOK_COOKIE_PATH: str = "secrets/fb_cookies.json"
    MARKETLY_CREDENTIALS_ENCRYPTION_KEY: str | None = None
    EBAY_ENV: str = "production"
    EBAY_CLIENT_ID: str | None = None
    EBAY_CLIENT_SECRET: str | None = None
    EBAY_MARKETPLACE_ID: str = "EBAY_CA"
    EBAY_ACCEPT_LANGUAGE: str = "en-CA"
    EBAY_SCOPE: str = "https://api.ebay.com/oauth/api_scope"

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="allow",
    )

    ENV: str = "dev"
    CACHE_TTL_SECONDS: int = 60


settings = Settings()
