"""Address to latitude/longitude conversion.

Uses Nominatim (free, no API key) by default.
Falls back to Google Geocoding API if GOOGLE_GEOCODING_API_KEY is set.
"""

import os
import requests
from geopy.geocoders import Nominatim


class GeocodingError(Exception):
    pass


def geocode(address: str) -> tuple[float, float]:
    """Convert a street address to (latitude, longitude).

    Args:
        address: Human-readable address, e.g. "1600 Amphitheatre Pkwy, Mountain View, CA"

    Returns:
        (latitude, longitude) as floats

    Raises:
        GeocodingError: If the address cannot be resolved
    """
    google_key = os.getenv("GOOGLE_GEOCODING_API_KEY")
    if google_key:
        return _geocode_google(address, google_key)
    return _geocode_nominatim(address)


def _geocode_nominatim(address: str) -> tuple[float, float]:
    geolocator = Nominatim(user_agent="solar-detector/0.1")
    location = geolocator.geocode(address, timeout=10)
    if location is None:
        raise GeocodingError(f"Could not geocode address: {address!r}")
    return location.latitude, location.longitude


def _geocode_google(address: str, api_key: str) -> tuple[float, float]:
    url = "https://maps.googleapis.com/maps/api/geocode/json"
    resp = requests.get(url, params={"address": address, "key": api_key}, timeout=10)
    resp.raise_for_status()
    data = resp.json()
    if data.get("status") != "OK" or not data.get("results"):
        raise GeocodingError(
            f"Google Geocoding failed for {address!r}: {data.get('status')}"
        )
    loc = data["results"][0]["geometry"]["location"]
    return loc["lat"], loc["lng"]
