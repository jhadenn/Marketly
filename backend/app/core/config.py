from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):
    DATABASE_URL: str
    SUPABASE_JWT_SECRET: str | None = None
    SUPABASE_URL: str | None = None
    SUPABASE_ANON_KEY: str | None = None

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="allow",   # ✅ allow unrelated env vars
    )

    ENV: str = "dev"
    CACHE_TTL_SECONDS: int = 60

settings = Settings()
