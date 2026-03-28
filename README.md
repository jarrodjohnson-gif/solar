# Solar Finder 3000

Detect solar panels on homes using satellite imagery and YOLOv8.

Provide an address or coordinates — Solar Finder 3000 fetches a satellite image, runs a YOLO model trained on aerial solar panel data, and tells you if panels are present with a confidence score and annotated image.

---

## Quick Start

```bash
git clone <repo-url>
cd solar
pip install -e .
cp .env.example .env
# Add your GOOGLE_MAPS_API_KEY to .env

solar-finder-3000 "1600 Amphitheatre Pkwy, Mountain View, CA"
```

**Output:**
```
Geocoding: 1600 Amphitheatre Pkwy, Mountain View, CA
Coordinates: 37.422400, -122.084000
Fetching satellite image (zoom=20)...
Running solar panel detection...

Result: SOLAR PANELS DETECTED
Confidence: 87.3%
Panel regions found: 3
Annotated image saved: output/annotated_1600_Amphitheatre_Pkwy.jpg
```

---

## Installation

Requires Python 3.10+

```bash
pip install -e .
```

Dependencies: `ultralytics`, `Pillow`, `opencv-python`, `click`, `requests`, `geopy`, `python-dotenv`

---

## API Keys

### Google Maps Static API (required)
Used to fetch satellite imagery.

1. Go to [console.cloud.google.com](https://console.cloud.google.com)
2. Enable the **Maps Static API**
3. Link a billing account (free $200/month credit — thousands of requests)
4. Add to `.env`:
   ```
   GOOGLE_MAPS_API_KEY=your_key_here
   ```

### Geocoding (optional)
By default, addresses are geocoded for free using [Nominatim](https://nominatim.org/) — no key needed. To use Google's geocoder instead:
```
GOOGLE_GEOCODING_API_KEY=your_key_here
```

---

## CLI Reference

```
Usage: solar-finder-3000 [OPTIONS] [ADDRESS]

Options:
  --lat FLOAT       Latitude (skip geocoding)
  --lng FLOAT       Longitude (skip geocoding)
  --image PATH      Use a local image file instead of fetching from Google Maps
  --zoom INT        Map zoom level, 19-21 recommended  [default: 20]
  --conf FLOAT      Detection confidence threshold 0-1  [default: 0.3]
  -o, --output PATH Path to save annotated image
  --no-image        Skip saving annotated image
  --clear-cache     Delete cached model weights and re-download
  --help            Show this message and exit.
```

### Examples

```bash
# Street address
solar-finder-3000 "123 Main St, Austin TX"

# Coordinates
solar-finder-3000 --lat 30.2672 --lng -97.7431

# Local image (no API key needed)
solar-finder-3000 --image my_satellite_screenshot.jpg

# Lower threshold to catch more detections
solar-finder-3000 "123 Main St" --conf 0.2 --output result.jpg
```

---

## Python API

```python
from solar_detector import detect_address, detect_coordinates

# By address
result = detect_address("123 Main St, Austin TX")

# By coordinates
result = detect_coordinates(37.4224, -122.0840)

# Result fields
result.has_solar_panels   # bool
result.confidence         # float (0–1)
result.num_panels         # int
result.boxes              # list of [x1, y1, x2, y2]
result.annotated_image    # PIL Image with bounding boxes drawn
result.method             # "yolo" or "colour+shape"

print(result.summary())
```

---

## Detection Model

Solar Finder 3000 uses **YOLOv8** with weights from [ArielDrabkin/Solar-Panel-Detector](https://github.com/ArielDrabkin/Solar-Panel-Detector) — trained on aerial satellite imagery via Roboflow.

The model is automatically downloaded on first run and cached at `models/solar_panels.pt`.

**Fallback:** If the YOLO model cannot be downloaded, the tool switches to a colour+shape detector (OpenCV HSV masking for the dark-blue solar panel signature). Accuracy is lower but no model file is needed.

---

## Testing

```bash
pytest tests/
```

All tests mock external API calls — runs without any API keys or network access.

---

## How It Works

```
Address / Coordinates
        │
        ▼
   Geocoder (Nominatim / Google)
        │
        ▼
 Google Maps Static API
 (satellite, zoom 20, 640×640px)
        │
        ▼
   YOLOv8 Inference
   (solar-panel class)
        │
        ▼
  DetectionResult
  ├── has_solar_panels: bool
  ├── confidence: float
  ├── num_panels: int
  └── annotated_image: PIL Image
```

---

## License

MIT
