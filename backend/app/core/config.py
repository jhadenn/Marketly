from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")

    ENV: str = "dev"
    CACHE_TTL_SECONDS: int = 60
    DATABASE_URL: str = "postgresql+psycopg2://marketly:marketly@localhost:5432/marketly"


settings = Settings()
