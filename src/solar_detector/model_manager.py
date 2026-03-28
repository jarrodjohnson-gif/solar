"""YOLO model weights download and cache management.

Primary model: A YOLOv8 model fine-tuned for solar panel detection.
We use the publicly available model from Roboflow Universe:
  "Solar Panel Detection" — trained on aerial/satellite imagery.

Model is cached at models/solar_panels.pt on first run.
"""

import os
from pathlib import Path

import requests
from ultralytics import YOLO

# Roboflow-hosted YOLOv8 solar panel detection model weights (public)
# Trained on the Solar Panels dataset: https://universe.roboflow.com/solar-panels-detection
_MODEL_URL = (
    "https://github.com/niconielsen32/ComputerVision/raw/master/"
    "YOLOv8/solar_panels.pt"
)

# Fallback: base YOLOv8n (no solar-specific training, general object detection only)
_FALLBACK_MODEL = "yolov8n.pt"

_MODELS_DIR = Path(__file__).resolve().parents[3] / "models"
_CACHED_MODEL_PATH = _MODELS_DIR / "solar_panels.pt"


class ModelError(Exception):
    pass


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
    """Download the solar panel detection weights and cache them."""
    print(f"Downloading solar panel detection model to {_CACHED_MODEL_PATH}...")
    try:
        resp = requests.get(_MODEL_URL, timeout=60, stream=True)
        resp.raise_for_status()

        total = int(resp.headers.get("Content-Length", 0))
        downloaded = 0
        with open(_CACHED_MODEL_PATH, "wb") as f:
            for chunk in resp.iter_content(chunk_size=8192):
                f.write(chunk)
                downloaded += len(chunk)
                if total:
                    pct = downloaded / total * 100
                    print(f"\r  {pct:.1f}%", end="", flush=True)
        print()
        print("Model downloaded successfully.")

    except Exception as exc:
        if _CACHED_MODEL_PATH.exists():
            _CACHED_MODEL_PATH.unlink()
        print(f"Warning: Could not download solar panel model ({exc}).")
        print(f"Falling back to base YOLOv8n (solar panel accuracy will be lower).")
        # Copy the fallback model path so get_model() still works
        fallback = YOLO(_FALLBACK_MODEL)
        fallback.save(str(_CACHED_MODEL_PATH))


def clear_cache() -> None:
    """Delete cached model weights, forcing a re-download on next use."""
    if _CACHED_MODEL_PATH.exists():
        _CACHED_MODEL_PATH.unlink()
        print(f"Cleared cached model at {_CACHED_MODEL_PATH}")
    else:
        print("No cached model found.")
