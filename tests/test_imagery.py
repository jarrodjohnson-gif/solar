"""Tests for imagery.py"""

import io
import pytest
from unittest.mock import patch, MagicMock
from PIL import Image

from solar_detector.imagery import fetch_satellite_image, ImageryError


def _make_fake_image_response(width=640, height=640):
    """Create a fake HTTP response containing a small PNG image."""
    img = Image.new("RGB", (width, height), color=(100, 120, 80))
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    buf.seek(0)

    mock_resp = MagicMock()
    mock_resp.status_code = 200
    mock_resp.headers = {"Content-Type": "image/png"}
    mock_resp.content = buf.read()
    return mock_resp


def test_fetch_satellite_image_returns_pil_image(monkeypatch):
    monkeypatch.setenv("GOOGLE_MAPS_API_KEY", "fake-key")
    with patch("solar_detector.imagery.requests.get", return_value=_make_fake_image_response()):
        img = fetch_satellite_image(37.4224, -122.0840)

    assert isinstance(img, Image.Image)
    assert img.mode == "RGB"


def test_fetch_satellite_image_raises_without_api_key(monkeypatch):
    monkeypatch.delenv("GOOGLE_MAPS_API_KEY", raising=False)
    with pytest.raises(ImageryError, match="GOOGLE_MAPS_API_KEY"):
        fetch_satellite_image(37.4224, -122.0840)


def test_fetch_satellite_image_raises_on_403(monkeypatch):
    monkeypatch.setenv("GOOGLE_MAPS_API_KEY", "bad-key")
    mock_resp = MagicMock()
    mock_resp.status_code = 403

    with patch("solar_detector.imagery.requests.get", return_value=mock_resp):
        with pytest.raises(ImageryError, match="invalid"):
            fetch_satellite_image(37.4224, -122.0840)


def test_fetch_satellite_image_raises_on_non_image_response(monkeypatch):
    monkeypatch.setenv("GOOGLE_MAPS_API_KEY", "fake-key")
    mock_resp = MagicMock()
    mock_resp.status_code = 200
    mock_resp.headers = {"Content-Type": "application/json"}
    mock_resp.content = b'{"error": "something"}'

    with patch("solar_detector.imagery.requests.get", return_value=mock_resp):
        with pytest.raises(ImageryError, match="content type"):
            fetch_satellite_image(37.4224, -122.0840)
