"""Solar panel detection via satellite imagery and YOLOv8.

Public API:
    detect_address(address, **kwargs) -> DetectionResult
    detect_coordinates(lat, lng, **kwargs) -> DetectionResult
"""

from dotenv import load_dotenv

load_dotenv()

from .detector import DetectionResult, detect_solar_panels
from .geocoder import geocode, GeocodingError
from .imagery import fetch_satellite_image, ImageryError


def detect_address(
    address: str,
    zoom: int = 20,
    conf_threshold: float = 0.3,
    annotate: bool = True,
) -> DetectionResult:
    """Detect solar panels at a given street address.

    Args:
        address: Street address, e.g. "123 Main St, Austin TX"
        zoom: Satellite image zoom level (19-21 recommended)
        conf_threshold: YOLO confidence threshold (0-1)
        annotate: Whether to include annotated image in result

    Returns:
        DetectionResult
    """
    lat, lng = geocode(address)
    image = fetch_satellite_image(lat, lng, zoom=zoom)
    return detect_solar_panels(image, conf_threshold=conf_threshold, annotate=annotate)


def detect_coordinates(
    lat: float,
    lng: float,
    zoom: int = 20,
    conf_threshold: float = 0.3,
    annotate: bool = True,
) -> DetectionResult:
    """Detect solar panels at the given lat/lng coordinates.

    Args:
        lat: Latitude
        lng: Longitude
        zoom: Satellite image zoom level (19-21 recommended)
        conf_threshold: YOLO confidence threshold (0-1)
        annotate: Whether to include annotated image in result

    Returns:
        DetectionResult
    """
    image = fetch_satellite_image(lat, lng, zoom=zoom)
    return detect_solar_panels(image, conf_threshold=conf_threshold, annotate=annotate)


__all__ = [
    "detect_address",
    "detect_coordinates",
    "DetectionResult",
    "GeocodingError",
    "ImageryError",
]
