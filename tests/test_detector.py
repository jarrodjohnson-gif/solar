"""Tests for detector.py"""

import pytest
from unittest.mock import patch, MagicMock
from PIL import Image

from solar_detector.detector import detect_solar_panels, DetectionResult


def _blank_image(width=640, height=640):
    return Image.new("RGB", (width, height), color=(80, 100, 60))


def _mock_yolo_result(boxes_data: list[tuple[list[float], float]]):
    """Build a mock YOLO result list.

    boxes_data: list of ([x1,y1,x2,y2], confidence)
    """
    mock_boxes = []
    for xyxy, conf in boxes_data:
        box = MagicMock()
        box.xyxy = [xyxy]
        box.conf = [conf]
        mock_boxes.append(box)

    mock_result = MagicMock()
    mock_result.boxes = mock_boxes
    return [mock_result]


def test_detect_no_panels(monkeypatch):
    mock_model = MagicMock()
    mock_model.predict.return_value = _mock_yolo_result([])

    with patch("solar_detector.detector._model", mock_model):
        result = detect_solar_panels(_blank_image(), annotate=False)

    assert result.has_solar_panels is False
    assert result.confidence == 0.0
    assert result.num_panels == 0


def test_detect_with_panels(monkeypatch):
    mock_model = MagicMock()
    mock_model.predict.return_value = _mock_yolo_result([
        ([100, 100, 300, 300], 0.87),
        ([350, 150, 500, 280], 0.72),
    ])

    with patch("solar_detector.detector._model", mock_model):
        result = detect_solar_panels(_blank_image(), annotate=False)

    assert result.has_solar_panels is True
    assert result.confidence == pytest.approx(0.87)
    assert result.num_panels == 2
    assert len(result.boxes) == 2


def test_detect_below_threshold_excluded(monkeypatch):
    mock_model = MagicMock()
    # YOLO's predict() already filters by conf threshold internally,
    # so results with conf < threshold won't appear
    mock_model.predict.return_value = _mock_yolo_result([])

    with patch("solar_detector.detector._model", mock_model):
        result = detect_solar_panels(_blank_image(), conf_threshold=0.5, annotate=False)

    assert result.has_solar_panels is False


def test_annotated_image_returned(monkeypatch):
    mock_model = MagicMock()
    mock_model.predict.return_value = _mock_yolo_result([
        ([50, 50, 200, 200], 0.91),
    ])

    with patch("solar_detector.detector._model", mock_model):
        result = detect_solar_panels(_blank_image(), annotate=True)

    assert result.annotated_image is not None
    assert isinstance(result.annotated_image, Image.Image)


def test_summary_with_panels():
    result = DetectionResult(
        has_solar_panels=True,
        confidence=0.87,
        num_panels=2,
    )
    summary = result.summary()
    assert "DETECTED" in summary
    assert "87.0%" in summary
    assert "2" in summary


def test_summary_without_panels():
    result = DetectionResult(
        has_solar_panels=False,
        confidence=0.0,
        num_panels=0,
    )
    assert "NO SOLAR PANELS" in result.summary()
