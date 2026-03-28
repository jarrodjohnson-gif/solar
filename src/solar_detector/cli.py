"""Command-line interface for solar panel detection."""

import os
import re
import sys
from pathlib import Path

import click
from dotenv import load_dotenv

load_dotenv()


@click.command()
@click.argument("address", required=False)
@click.option("--lat", type=float, default=None, help="Latitude (skip geocoding)")
@click.option("--lng", type=float, default=None, help="Longitude (skip geocoding)")
@click.option("--zoom", type=int, default=20, show_default=True, help="Map zoom level (19-21)")
@click.option("--conf", type=float, default=0.3, show_default=True, help="Detection confidence threshold (0-1)")
@click.option("--output", "-o", type=click.Path(), default=None, help="Path to save annotated image")
@click.option("--no-image", is_flag=True, default=False, help="Skip saving annotated image")
@click.option("--clear-cache", is_flag=True, default=False, help="Delete cached model weights and exit")
@click.option("--image", "local_image", type=click.Path(exists=True), default=None, help="Use a local image file instead of fetching from Google Maps")
def main(
    address: str | None,
    lat: float | None,
    lng: float | None,
    zoom: int,
    conf: float,
    output: str | None,
    no_image: bool,
    clear_cache: bool,
    local_image: str | None,
) -> None:
    """Detect solar panels on a home using satellite imagery and YOLOv8.

    Provide an ADDRESS, --lat/--lng coordinates, or a local --image file.

    \b
    Examples:
      solar-finder-3000 "1600 Amphitheatre Pkwy, Mountain View, CA"
      solar-finder-3000 --lat 37.4224 --lng -122.0840
      solar-finder-3000 --image screenshot.png
      solar-finder-3000 "123 Main St, Austin TX" --output result.jpg --conf 0.25
    """
    # Lazy imports so startup is fast for --help
    from .geocoder import geocode, GeocodingError
    from .imagery import fetch_satellite_image, ImageryError
    from .detector import detect_solar_panels
    from .model_manager import clear_cache as _clear_cache

    if clear_cache:
        _clear_cache()
        return

    # --- Load image (local file or fetch from API) ---
    if local_image:
        from PIL import Image as PILImage
        click.echo(f"Loading local image: {local_image}")
        image = PILImage.open(local_image).convert("RGB")
        location_label = Path(local_image).stem
    else:
        # --- Resolve coordinates ---
        if lat is not None and lng is not None:
            coords = (lat, lng)
            location_label = f"{lat:.6f}, {lng:.6f}"
        elif address:
            click.echo(f"Geocoding: {address}")
            try:
                coords = geocode(address)
            except GeocodingError as e:
                click.echo(f"Error: {e}", err=True)
                sys.exit(1)
            location_label = address
            click.echo(f"Coordinates: {coords[0]:.6f}, {coords[1]:.6f}")
        else:
            click.echo(
                "Error: Provide an ADDRESS, --lat/--lng coordinates, or --image path.\n"
                "Run with --help for usage.",
                err=True,
            )
            sys.exit(1)

        # --- Fetch satellite image ---
        click.echo(f"Fetching satellite image (zoom={zoom})...")
        try:
            image = fetch_satellite_image(coords[0], coords[1], zoom=zoom)
        except ImageryError as e:
            click.echo(f"Error: {e}", err=True)
            sys.exit(1)

    # --- Run detection ---
    click.echo("Running solar panel detection...")
    annotate = not no_image
    result = detect_solar_panels(image, conf_threshold=conf, annotate=annotate)

    # --- Print result ---
    click.echo()
    if result.has_solar_panels:
        click.echo(click.style("Result: SOLAR PANELS DETECTED", fg="green", bold=True))
    else:
        click.echo(click.style("Result: NO SOLAR PANELS DETECTED", fg="yellow", bold=True))

    if result.has_solar_panels:
        click.echo(f"Confidence: {result.confidence * 100:.1f}%")
        click.echo(f"Panel regions found: {result.num_panels}")

    # --- Save annotated image ---
    if annotate and result.annotated_image is not None:
        if output:
            save_path = Path(output)
        else:
            safe_label = re.sub(r"[^\w\-]", "_", location_label)[:50]
            save_path = Path("output") / f"annotated_{safe_label}.jpg"

        save_path.parent.mkdir(parents=True, exist_ok=True)
        result.annotated_image.save(str(save_path), quality=92)
        click.echo(f"Annotated image saved: {save_path}")
