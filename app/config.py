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
    # Admin bearer token for the developer dashboard, sync trigger and maintenance endpoints.
    # Separate from heiz_api_key. Both secrets must be >= 24 characters or they are treated as unset.
    heiz_admin_token: SecretStr | None = None

    bmkg_base_url: str = "https://data.bmkg.go.id/DataMKG/TEWS/"
    bmkg_timeout_seconds: float = 10.0
    bmkg_max_response_bytes: int = 1_000_000
    # BMKG documents a 60 requests/minute/IP limit; we also throttle our own sync trigger.
    sync_min_interval_seconds: int = 60

    max_page_size: int = 100

    # Free-tier housekeeping (0 disables a rule). Applied by POST /api/admin/maintenance/prune.
    retention_raw_payload_days: int = 14      # null out raw_payload (normalized columns are kept)
    retention_event_updates_days: int = 90    # audit rows
    retention_sync_logs_days: int = 30
    retention_events_days: int = 365          # imported (non-MANUAL) events only
    stale_running_minutes: int = 10           # 'running' sync logs older than this become 'failed'
    prune_batch_size: int = 5000              # max rows touched per rule per run
    db_quota_mb: int = 500                    # Supabase Free database size, check your dashboard


@lru_cache
def get_settings() -> Settings:
    return Settings()
