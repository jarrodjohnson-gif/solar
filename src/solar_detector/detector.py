"""YOLO inference for solar panel detection."""

from __future__ import annotations

import io
from dataclasses import dataclass, field

import cv2
import numpy as np
from PIL import Image

from .model_manager import get_model


@dataclass
class DetectionResult:
    """Result of a solar panel detection run."""

    has_solar_panels: bool
    confidence: float
    num_panels: int
    boxes: list[list[float]] = field(default_factory=list)
    annotated_image: Image.Image | None = None

    def summary(self) -> str:
        if self.has_solar_panels:
            return (
                f"SOLAR PANELS DETECTED\n"
                f"Confidence: {self.confidence * 100:.1f}%\n"
                f"Panel regions found: {self.num_panels}"
            )
        return "NO SOLAR PANELS DETECTED"


# Module-level model cache so we only load weights once per process
_model = None


def detect_solar_panels(
    image: Image.Image,
    conf_threshold: float = 0.3,
    annotate: bool = True,
) -> DetectionResult:
    """Run YOLOv8 inference on a satellite image to detect solar panels.

    Args:
        image: PIL Image (RGB) of the roof/property
        conf_threshold: Minimum confidence to count a detection (0–1)
        annotate: If True, draw bounding boxes on a copy of the image

    Returns:
        DetectionResult with detection status, confidence, count, and annotated image
    """
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

    annotated: Image.Image | None = None
    if annotate:
        annotated = _draw_boxes(image, boxes, confidences)

    return DetectionResult(
        has_solar_panels=has_panels,
        confidence=max_conf,
        num_panels=len(boxes),
        boxes=boxes,
        annotated_image=annotated,
    )


def _draw_boxes(
    image: Image.Image,
    boxes: list[list[float]],
    confidences: list[float],
) -> Image.Image:
    """Draw bounding boxes on the image and return the annotated copy."""
    img_array = cv2.cvtColor(np.array(image), cv2.COLOR_RGB2BGR)

    for box, conf in zip(boxes, confidences):
        x1, y1, x2, y2 = (int(v) for v in box)
        cv2.rectangle(img_array, (x1, y1), (x2, y2), (0, 255, 0), 2)
        label = f"Solar Panel {conf * 100:.0f}%"
        label_y = max(y1 - 8, 15)
        cv2.putText(
            img_array,
            label,
            (x1, label_y),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.55,
            (0, 255, 0),
            2,
            cv2.LINE_AA,
        )

    return Image.fromarray(cv2.cvtColor(img_array, cv2.COLOR_BGR2RGB))
