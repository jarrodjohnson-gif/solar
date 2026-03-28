"""Satellite imagery fetching via Google Maps Static API."""

import io
import os

import requests
from PIL import Image


MAPS_STATIC_URL = "https://maps.googleapis.com/maps/api/staticmap"


class ImageryError(Exception):
    pass


def fetch_satellite_image(
    lat: float,
    lng: float,
    zoom: int = 20,
    size: int = 640,
) -> Image.Image:
    """Fetch a satellite image centered on the given coordinates.

    Args:
        lat: Latitude
        lng: Longitude
        zoom: Map zoom level (19-21 recommended for roof-level detail)
        size: Image width and height in pixels (max 640 for free tier)

    Returns:
        PIL Image in RGB mode

    Raises:
        ImageryError: If the API key is missing or the request fails
    """
    api_key = os.getenv("GOOGLE_MAPS_API_KEY")
    if not api_key:
        raise ImageryError(
            "GOOGLE_MAPS_API_KEY environment variable is not set. "
            "Set it in your .env file or export it in your shell."
        )

    params = {
        "center": f"{lat},{lng}",
        "zoom": zoom,
        "size": f"{size}x{size}",
        "maptype": "satellite",
        "key": api_key,
    }

    resp = requests.get(MAPS_STATIC_URL, params=params, timeout=15)

    if resp.status_code == 403:
        raise ImageryError("Google Maps API key is invalid or the Static Maps API is not enabled.")
    if resp.status_code != 200:
        raise ImageryError(f"Google Maps Static API returned HTTP {resp.status_code}")

    content_type = resp.headers.get("Content-Type", "")
    if "image" not in content_type:
        raise ImageryError(
            f"Unexpected response content type: {content_type}. "
            "Check that the Static Maps API is enabled for your key."
        )

    image = Image.open(io.BytesIO(resp.content)).convert("RGB")
    return image
