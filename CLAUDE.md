# CLAUDE.md — Solar Finder 3000

This file gives Claude full context about this project so you can pick up exactly where we left off.

---

## What This Project Does

**Solar Finder 3000** is a Python CLI tool and library that:
1. Accepts a home address or lat/lng coordinates
2. Fetches a satellite image via the **Google Maps Static API**
3. Runs a **YOLOv8** model trained on solar panel satellite imagery
4. Returns whether solar panels are present, with confidence score, panel count, and an annotated image

---

## Project Structure

```
solar/
├── src/solar_detector/
│   ├── __init__.py          # Public API: detect_address(), detect_coordinates()
│   ├── cli.py               # Click CLI: solar-finder-3000 command
│   ├── detector.py          # YOLO inference + colour/shape fallback detector
│   ├── geocoder.py          # Address → lat/lng (Nominatim free or Google)
│   ├── imagery.py           # Google Maps Static API satellite image fetch
│   └── model_manager.py     # YOLO weights download/cache logic
├── models/                  # Cached .pt weights (gitignored)
├── solartestimages/         # Test satellite images
├── tests/                   # pytest unit tests (all API calls mocked)
├── pyproject.toml
├── requirements.txt
└── .env.example
```

---

## CLI Usage

```bash
# By address (geocodes automatically via Nominatim, no key needed)
solar-finder-3000 "1600 Amphitheatre Pkwy, Mountain View, CA"

# By coordinates
solar-finder-3000 --lat 37.4224 --lng -122.0840

# From a local image file (skips Google Maps API — useful for testing)
solar-finder-3000 --image path/to/satellite.jpg

# Options
--conf 0.25          # Lower confidence threshold (catch more, less precise)
--zoom 19            # Map zoom level (19-21 recommended)
--output result.jpg  # Custom output path for annotated image
--no-image           # Skip saving annotated image
--clear-cache        # Delete cached model and re-download
```

---

## Python API

```python
from solar_detector import detect_address, detect_coordinates

result = detect_address("123 Main St, Austin TX")
print(result.has_solar_panels)   # True / False
print(result.confidence)         # 0.87
print(result.num_panels)         # 3
result.annotated_image.save("out.jpg")  # PIL Image with bounding boxes
```

---

## Environment Variables

Create a `.env` file (see `.env.example`):

```
GOOGLE_MAPS_API_KEY=your_key_here           # Required for satellite imagery
GOOGLE_GEOCODING_API_KEY=your_key_here      # Optional (defaults to free Nominatim)
```

**Google Maps setup:**
- Enable the **Maps Static API** at console.cloud.google.com
- Billing must be linked (free $200/month credit covers thousands of requests)

---

## Detection Strategy

The tool uses a two-tier detection approach:

### Tier 1 — YOLOv8 (primary, when model is available)
- Model source: [ArielDrabkin/Solar-Panel-Detector](https://github.com/ArielDrabkin/Solar-Panel-Detector)
- Trained on Roboflow satellite solar panel dataset
- Single class: `solar-panel`
- Auto-downloaded to `models/solar_panels.pt` on first run
- Falls back to next URL if download fails (3 candidate URLs in `model_manager.py`)

### Tier 2 — Colour + Shape (fallback, no model needed)
- OpenCV HSV masking for dark-blue/navy panel colour signature
- Contour analysis filters by area and aspect ratio
- Activated automatically when YOLO model is unavailable
- Confidence scores 50–95% based on colour fill ratio

---

## Known Issues / Status

- **Google Maps API**: requires billing enabled + Maps Static API enabled
- **Model download**: works on normal internet; blocked in sandboxed environments
- **Colour detector**: tested and working; detects panels in aerial test image at 95% confidence
- **YOLO detector**: correct code, needs network access to download `detector.pt` on first run

---

## Installation

```bash
git clone <repo-url>
cd solar
pip install -e .
cp .env.example .env
# Add your GOOGLE_MAPS_API_KEY to .env
solar-finder-3000 "your address here"
```

---

## Running Tests

```bash
pytest tests/
```

All tests mock external API calls — no API keys or network needed.

---

## Branch

Active development branch: `claude/rename-solar-rep-HaWcF`

---

## Key Design Decisions

- **geopy Nominatim** used for free geocoding by default (no API key needed)
- **YOLOv8 via ultralytics** — simplest inference API, widest model compatibility
- **PIL + OpenCV** for image handling and annotation
- **click** for CLI — supports `--help`, option types, coloured output
- Model weights are gitignored (downloaded at runtime, not stored in repo)
- `--image` flag added to bypass Google Maps API for local testing
