"""Environment-based settings."""
from functools import lru_cache

from pydantic import SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict

MANUAL_SOURCE_CODE = "MANUAL"
BMKG_SOURCE_CODE = "BMKG"
BMKG_FEED_NAMES = ("gempaterkini", "gempadirasakan", "autogempa")


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # Supabase/PostgreSQL connection string (use the pooler URI on Vercel).
    database_url: SecretStr | None = None
    # Shared secret required (X-API-Key header) for POST/PUT/PATCH/DELETE and /api/sync.
    # If unset, those endpoints are disabled (fail closed).
    heiz_api_key: SecretStr | None = None

    bmkg_base_url: str = "https://data.bmkg.go.id/DataMKG/TEWS/"
    bmkg_timeout_seconds: float = 10.0
    bmkg_max_response_bytes: int = 1_000_000
    # BMKG documents a 60 requests/minute/IP limit; we also throttle our own sync trigger.
    sync_min_interval_seconds: int = 60

    max_page_size: int = 100


@lru_cache
def get_settings() -> Settings:
    return Settings()
