"""YOLO model weights download and cache management.

Primary model: A YOLOv8 model fine-tuned for solar panel detection.
Tries multiple well-known public sources in order.

Model is cached at models/solar_panels.pt on first run.
"""

import os
from pathlib import Path

import requests
from ultralytics import YOLO

# Candidate URLs tried in order — first success wins.
# Primary: ArielDrabkin/Solar-Panel-Detector — YOLOv8 trained specifically on
# satellite solar panel imagery via Roboflow (single class: solar-panel).
# https://github.com/ArielDrabkin/Solar-Panel-Detector
_MODEL_URLS = [
    # Deployment-ready model (recommended by the repo)
    "https://github.com/ArielDrabkin/Solar-Panel-Detector/raw/main/deployment/detector.pt",
    # Best training run with mosaic augmentation
    "https://github.com/ArielDrabkin/Solar-Panel-Detector/raw/main/models/final-mosaic-augmentation.pt",
    # keremberke YOLOv8 solar panel model (GitHub releases)
    "https://github.com/keremberke/awesome-yolov8-models/releases/download/v1.0.0/solar-panel-detection-best.pt",
]

# Fallback: base YOLOv8n (no solar-specific training, general object detection only)
_FALLBACK_MODEL = "yolov8n.pt"

_MODELS_DIR = Path(__file__).resolve().parents[3] / "models"
_CACHED_MODEL_PATH = _MODELS_DIR / "solar_panels.pt"
_IS_SOLAR_MODEL = _MODELS_DIR / "solar_panels.verified"


class ModelError(Exception):
    pass


def is_solar_model_available() -> bool:
    """Return True if a solar-specific model (not the COCO fallback) is cached."""
    return _IS_SOLAR_MODEL.exists()


def get_model() -> YOLO:
    """Return a loaded YOLO model for solar panel detection.

    Downloads and caches the model weights on first call.
    Falls back to base YOLOv8n if the solar-specific weights cannot be fetched.

    Returns:
        Loaded ultralytics YOLO model
    """
    _MODELS_DIR.mkdir(parents=True, exist_ok=True)

    if not _CACHED_MODEL_PATH.exists():
        _download_model()

    return YOLO(str(_CACHED_MODEL_PATH))


def _download_model() -> None:
    """Try each candidate URL in order; fall back to YOLOv8n COCO if all fail."""
    _MODELS_DIR.mkdir(parents=True, exist_ok=True)

    for url in _MODEL_URLS:
        print(f"Downloading solar panel model from:\n  {url}")
        try:
            resp = requests.get(url, timeout=60, stream=True)
            resp.raise_for_status()

            total = int(resp.headers.get("Content-Length", 0))
            downloaded = 0
            with open(_CACHED_MODEL_PATH, "wb") as f:
                for chunk in resp.iter_content(chunk_size=8192):
                    f.write(chunk)
                    downloaded += len(chunk)
                    if total:
                        print(f"\r  {downloaded/total*100:.1f}%", end="", flush=True)
            print()

            # Mark as a verified solar model
            _IS_SOLAR_MODEL.touch()
            print("Solar panel model downloaded successfully.")
            return

        except Exception as exc:
            if _CACHED_MODEL_PATH.exists():
                _CACHED_MODEL_PATH.unlink()
            print(f"  Failed: {exc}")

    print("Warning: Could not download any solar panel model.")
    print("Using colour+shape detector instead (no YOLO weights needed).")
    # Write a dummy file so get_model() doesn't re-attempt every run
    # (is_solar_model_available() returns False — colour fallback will be used)
    YOLO("yolov8n.pt").save(str(_CACHED_MODEL_PATH))


def clear_cache() -> None:
    """Delete cached model weights, forcing a re-download on next use."""
    if _CACHED_MODEL_PATH.exists():
        _CACHED_MODEL_PATH.unlink()
        print(f"Cleared cached model at {_CACHED_MODEL_PATH}")
    else:
        print("No cached model found.")
