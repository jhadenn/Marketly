from typing import Literal

from pydantic import BaseModel, Field, model_validator


LocationMode = Literal["manual", "gps"]


class LocationResolveRequest(BaseModel):
    city: str | None = Field(default=None, min_length=1, max_length=120)
    province: str | None = Field(default=None, min_length=2, max_length=80)
    latitude: float | None = Field(default=None, ge=-90, le=90)
    longitude: float | None = Field(default=None, ge=-180, le=180)

    @model_validator(mode="after")
    def validate_resolution_mode(self) -> "LocationResolveRequest":
        has_manual = bool((self.city or "").strip()) and bool((self.province or "").strip())
        has_coords = self.latitude is not None and self.longitude is not None
        if has_manual == has_coords:
            raise ValueError(
                "Provide either city and province for manual resolution or latitude and longitude for GPS resolution."
            )
        return self


class ResolvedLocation(BaseModel):
    display_name: str
    city: str
    province_code: str
    province_name: str
    country_code: str = "CA"
    latitude: float
    longitude: float
    mode: LocationMode


class LocationCitySuggestion(BaseModel):
    city: str
    province_code: str
    province_name: str
    display_name: str
