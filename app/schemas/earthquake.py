"""Pydantic request/response schemas for earthquake events."""
from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

LOCATION = Field(min_length=1, max_length=500)


def _aware(v: datetime | None) -> datetime | None:
    if v is not None and v.tzinfo is None:
        raise ValueError("datetime must include a timezone offset, e.g. 2026-10-16T03:21:55Z")
    return v


class _EditableBase(BaseModel):
    # extra="forbid": clients cannot set source_id, attribution, imported_at, etc.
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    occurred_at: datetime | None = None
    source_reported_at: datetime | None = None
    latitude: float | None = Field(default=None, ge=-90, le=90)
    longitude: float | None = Field(default=None, ge=-180, le=180)
    magnitude: float | None = Field(default=None, ge=0, le=10)
    depth_km: float | None = Field(default=None, ge=0, le=99999)
    tsunami_potential: bool | None = None
    source_url: str | None = Field(default=None, max_length=2000)

    _check_tz = field_validator("occurred_at", "source_reported_at")(_aware)

    @field_validator("source_url")
    @classmethod
    def _http_url(cls, v):
        if v is not None and not v.lower().startswith(("http://", "https://")):
            raise ValueError("source_url must start with http:// or https://")
        return v

    @model_validator(mode="after")
    def _coords_together(self):
        sent = self.model_fields_set
        if {"latitude", "longitude"} & sent:
            if (self.latitude is None) != (self.longitude is None):
                raise ValueError("latitude and longitude must be provided together")
        return self


class EarthquakeCreate(_EditableBase):
    """POST body and PUT body (PUT replaces every editable field; omitted ones become null)."""
    location_description: str = LOCATION


class EarthquakePatch(_EditableBase):
    """PATCH body: only the fields sent are changed."""
    location_description: str | None = Field(default=None, min_length=1, max_length=500)

    @model_validator(mode="after")
    def _not_empty(self):
        if not self.model_fields_set:
            raise ValueError("at least one field must be provided")
        if "location_description" in self.model_fields_set and self.location_description is None:
            raise ValueError("location_description cannot be null")
        return self


class EarthquakeOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    source_code: str
    source_event_id: str | None
    occurred_at: datetime | None
    source_reported_at: datetime | None
    location_description: str
    latitude: float | None
    longitude: float | None
    magnitude: float | None
    depth_km: float | None
    tsunami_potential: bool | None
    source_url: str | None
    source_attribution: str
    imported_at: datetime
    created_at: datetime
    updated_at: datetime


class EarthquakeDetail(EarthquakeOut):
    raw_payload: dict[str, Any] | None


class Pagination(BaseModel):
    limit: int
    offset: int
    total: int


class EarthquakeList(BaseModel):
    data: list[EarthquakeOut]
    pagination: Pagination
