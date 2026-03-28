"""YOLO inference for solar panel detection, with colour-based fallback."""

from __future__ import annotations

from dataclasses import dataclass, field

import cv2
import numpy as np
from PIL import Image

from .model_manager import get_model, is_solar_model_available


@dataclass
class DetectionResult:
    """Result of a solar panel detection run."""

    has_solar_panels: bool
    confidence: float
    num_panels: int
    method: str = "yolo"
    boxes: list[list[float]] = field(default_factory=list)
    annotated_image: Image.Image | None = None

    def summary(self) -> str:
        if self.has_solar_panels:
            return (
                f"SOLAR PANELS DETECTED  [{self.method}]\n"
                f"Confidence: {self.confidence * 100:.1f}%\n"
                f"Panel regions found: {self.num_panels}"
            )
        return f"NO SOLAR PANELS DETECTED  [{self.method}]"


# Module-level model cache so we only load weights once per process
_model = None


def detect_solar_panels(
    image: Image.Image,
    conf_threshold: float = 0.3,
    annotate: bool = True,
) -> DetectionResult:
    """Detect solar panels in a satellite image.

    Uses YOLOv8 with a solar-panel-specific model when available.
    Falls back to an OpenCV colour/shape detector when the YOLO model
    is only the generic COCO base (which has no solar panel class).

    Args:
        image: PIL Image (RGB) of the roof/property
        conf_threshold: Minimum confidence for YOLO detections (0–1)
        annotate: If True, draw bounding boxes on a copy of the image

    Returns:
        DetectionResult
    """
    if is_solar_model_available():
        return _detect_yolo(image, conf_threshold, annotate)
    return _detect_colour(image, annotate)


# ---------------------------------------------------------------------------
# YOLO detector
# ---------------------------------------------------------------------------

def _detect_yolo(
    image: Image.Image,
    conf_threshold: float,
    annotate: bool,
) -> DetectionResult:
    global _model
    if _model is None:
        _model = get_model()

    results = _model.predict(image, conf=conf_threshold, verbose=False)

    boxes: list[list[float]] = []
    confidences: list[float] = []

    for result in results:
        if result.boxes is None:
            continue
        for box in result.boxes:
            conf = float(box.conf[0])
            xyxy = box.xyxy[0].tolist()
            boxes.append(xyxy)
            confidences.append(conf)

    has_panels = len(boxes) > 0
    max_conf = max(confidences) if confidences else 0.0
    annotated = _draw_boxes(image, boxes, confidences) if annotate else None

    return DetectionResult(
        has_solar_panels=has_panels,
        confidence=max_conf,
        num_panels=len(boxes),
        method="yolo",
        boxes=boxes,
        annotated_image=annotated,
    )


# ---------------------------------------------------------------------------
# Colour + shape fallback detector
# ---------------------------------------------------------------------------

def _detect_colour(image: Image.Image, annotate: bool) -> DetectionResult:
    """Detect solar panels by their distinctive dark-blue/black colour and
    rectangular shape using OpenCV contour analysis."""

    img_bgr = cv2.cvtColor(np.array(image), cv2.COLOR_RGB2BGR)
    img_hsv = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2HSV)

    # Solar panels appear dark blue/navy in satellite imagery
    # HSV range for dark blue-grey (panels vary by angle/light)
    masks = []

    # Dark blue range
    masks.append(cv2.inRange(img_hsv, np.array([90, 30, 10]), np.array([140, 255, 100])))
    # Very dark near-black (panels in shadow or steep angle)
    masks.append(cv2.inRange(img_hsv, np.array([0, 0, 0]), np.array([180, 50, 50])))

    mask = cv2.bitwise_or(masks[0], masks[1])

    # Clean up noise
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (5, 5))
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel, iterations=3)
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, kernel, iterations=2)

    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

    img_area = image.width * image.height
    boxes: list[list[float]] = []
    confidences: list[float] = []

    for cnt in contours:
        area = cv2.contourArea(cnt)
        # Filter: must be at least 0.3% of image and not more than 20%
        if area < img_area * 0.003 or area > img_area * 0.20:
            continue

        x, y, w, h = cv2.boundingRect(cnt)
        aspect = max(w, h) / max(min(w, h), 1)

        # Solar panel arrays are roughly rectangular (aspect ratio < 6)
        if aspect > 6:
            continue

        # Estimate confidence from how well it matches expected panel colour density
        roi_mask = mask[y:y+h, x:x+w]
        fill_ratio = np.count_nonzero(roi_mask) / max(w * h, 1)
        conf = min(0.5 + fill_ratio * 0.5, 0.95)

        boxes.append([float(x), float(y), float(x + w), float(y + h)])
        confidences.append(conf)

    has_panels = len(boxes) > 0
    max_conf = max(confidences) if confidences else 0.0
    annotated = _draw_boxes(image, boxes, confidences) if annotate else None

    return DetectionResult(
        has_solar_panels=has_panels,
        confidence=max_conf,
        num_panels=len(boxes),
        method="colour+shape",
        boxes=boxes,
        annotated_image=annotated,
    )


# ---------------------------------------------------------------------------
# Shared drawing helper
# ---------------------------------------------------------------------------

def _draw_boxes(
    image: Image.Image,
    boxes: list[list[float]],
    confidences: list[float],
) -> Image.Image:
    img_array = cv2.cvtColor(np.array(image), cv2.COLOR_RGB2BGR)

    for box, conf in zip(boxes, confidences):
        x1, y1, x2, y2 = (int(v) for v in box)
        cv2.rectangle(img_array, (x1, y1), (x2, y2), (0, 255, 0), 2)
        label = f"Solar Panel {conf * 100:.0f}%"
        label_y = max(y1 - 8, 15)
        cv2.putText(
            img_array, label, (x1, label_y),
            cv2.FONT_HERSHEY_SIMPLEX, 0.55, (0, 255, 0), 2, cv2.LINE_AA,
        )

    return Image.fromarray(cv2.cvtColor(img_array, cv2.COLOR_BGR2RGB))
