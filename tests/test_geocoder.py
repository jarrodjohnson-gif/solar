"""Tests for geocoder.py"""

import pytest
from unittest.mock import patch, MagicMock

from solar_detector.geocoder import geocode, GeocodingError, _geocode_nominatim, _geocode_google


def test_geocode_uses_nominatim_when_no_google_key(monkeypatch):
    monkeypatch.delenv("GOOGLE_GEOCODING_API_KEY", raising=False)
    mock_location = MagicMock()
    mock_location.latitude = 37.4224
    mock_location.longitude = -122.0840

    with patch("solar_detector.geocoder.Nominatim") as MockNominatim:
        MockNominatim.return_value.geocode.return_value = mock_location
        lat, lng = geocode("1600 Amphitheatre Pkwy, Mountain View, CA")

    assert lat == pytest.approx(37.4224)
    assert lng == pytest.approx(-122.0840)


def test_geocode_raises_when_address_not_found(monkeypatch):
    monkeypatch.delenv("GOOGLE_GEOCODING_API_KEY", raising=False)
    with patch("solar_detector.geocoder.Nominatim") as MockNominatim:
        MockNominatim.return_value.geocode.return_value = None
        with pytest.raises(GeocodingError, match="Could not geocode"):
            geocode("this address does not exist xyz123")


def test_geocode_uses_google_when_key_set(monkeypatch):
    monkeypatch.setenv("GOOGLE_GEOCODING_API_KEY", "fake-key")
    mock_response = MagicMock()
    mock_response.json.return_value = {
        "status": "OK",
        "results": [{"geometry": {"location": {"lat": 30.2672, "lng": -97.7431}}}],
    }
    mock_response.raise_for_status = MagicMock()

    with patch("solar_detector.geocoder.requests.get", return_value=mock_response):
        lat, lng = geocode("Austin, TX")

    assert lat == pytest.approx(30.2672)
    assert lng == pytest.approx(-97.7431)


def test_geocode_google_raises_on_bad_status(monkeypatch):
    monkeypatch.setenv("GOOGLE_GEOCODING_API_KEY", "fake-key")
    mock_response = MagicMock()
    mock_response.json.return_value = {"status": "ZERO_RESULTS", "results": []}
    mock_response.raise_for_status = MagicMock()

    with patch("solar_detector.geocoder.requests.get", return_value=mock_response):
        with pytest.raises(GeocodingError, match="ZERO_RESULTS"):
            geocode("nowhere place xyz")
