"""Generate tiny, faithful animated monster portraits for the Realm Atlas.

The installed Exalt client declares the object -> animated sheet/index relation,
but its local data does not retain the large gameplay atlases' pixels.  This
tool accepts an exported current-build atlas set (characters.png, mapObjects.png
and spritesheet.json), crops only the movement frames used by atlas creatures,
and writes lossless animated WebP files.  The browser therefore loads a few
small frames per visible monster instead of a multi-megabyte atlas.

Usage (the atlas directory is read-only):
  py tools/generate-realm-animations.py --atlas-dir <exported-assets-directory>
  node tools/generate-realm.js
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from collections import defaultdict
from pathlib import Path

try:
    from PIL import Image
except ImportError as exc:
    raise SystemExit("Pillow is required: py -m pip install Pillow") from exc


ROOT = Path(__file__).resolve().parent.parent
DATA_PATH = ROOT / "web" / "realm-data.js"
OUT_DIR = ROOT / "web" / "assets" / "realm-monster-animations"
INDEX_PATH = OUT_DIR / "index.json"
ATLAS_FILES = {1: "groundTiles.png", 2: "characters.png", 4: "mapObjects.png"}


def realm_data() -> dict:
    source = DATA_PATH.read_text(encoding="utf-8")
    found = re.search(r"var RealmData = ([\s\S]*);\s*$", source)
    if not found:
        raise ValueError("web/realm-data.js is not a RealmData payload; run generate-realm.js first.")
    return json.loads(found.group(1))


def sprite_records(data: dict) -> dict[str, dict]:
    records: dict[str, dict] = {}
    for terrain in data.get("terrains", []):
        for monster in terrain.get("monsters", []):
            records[monster["id"]] = monster
    return records


def animation_lookup(sheet: dict) -> dict[tuple[str, int], list[dict]]:
    """Use the forward-facing, movement animation in direction zero.

    The atlas records a sequence as repeated (sheet, index, set, direction,
    action) entries.  Action 1 is the walking/idle loop for normal creatures;
    selecting it avoids presenting attack flashes as the default portrait.
    """
    grouped: dict[tuple[str, int], list[dict]] = defaultdict(list)
    for entry in sheet.get("animatedSprites", []):
        if entry.get("set") != 0 or entry.get("direction") != 0 or entry.get("action") != 1:
            continue
        name = entry.get("spriteSheetName")
        try:
            index = int(entry.get("index"))
        except (TypeError, ValueError):
            continue
        if name and entry.get("spriteData", {}).get("position"):
            grouped[(name, index)].append(entry["spriteData"])
    return grouped


def crop_frame(atlases: dict[int, Image.Image], frame: dict) -> Image.Image | None:
    try:
        atlas = atlases[int(frame["aId"])]
        pos = frame["position"]
        x, y, width, height = (int(pos[key]) for key in ("x", "y", "w", "h"))
    except (KeyError, TypeError, ValueError):
        return None
    if width < 1 or height < 1 or x < 0 or y < 0 or x + width > atlas.width or y + height > atlas.height:
        return None
    return atlas.crop((x, y, x + width, y + height)).convert("RGBA")


def unique_frames(frames: list[Image.Image]) -> list[Image.Image]:
    seen: set[bytes] = set()
    output: list[Image.Image] = []
    for frame in frames:
        fingerprint = frame.tobytes()
        if fingerprint not in seen:
            seen.add(fingerprint)
            output.append(frame)
    return output


def main() -> None:
    parser = argparse.ArgumentParser(description="Crop AnimatedTexture frames into Realm Atlas WebP portraits.")
    parser.add_argument(
        "--atlas-dir",
        default=os.environ.get("ROTMG_ATLAS_DIR"),
        help="Read-only directory containing spritesheet.json and the exported PNG atlases (or set ROTMG_ATLAS_DIR).",
    )
    args = parser.parse_args()
    if not args.atlas_dir:
        parser.error("--atlas-dir (or ROTMG_ATLAS_DIR) is required")
    atlas_dir = Path(args.atlas_dir)
    sheet_path = atlas_dir / "spritesheet.json"
    if not sheet_path.is_file():
        raise SystemExit(f"Missing spritesheet.json in {atlas_dir}")

    sheet = json.loads(sheet_path.read_text(encoding="utf-8"))
    lookup = animation_lookup(sheet)
    atlas_ids = {frame.get("aId") for frames in lookup.values() for frame in frames}
    atlases: dict[int, Image.Image] = {}
    for atlas_id, filename in ATLAS_FILES.items():
        if atlas_id not in atlas_ids:
            continue
        filename_path = atlas_dir / filename
        if filename_path.is_file():
            atlases[atlas_id] = Image.open(filename_path).convert("RGBA")

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    records = sprite_records(realm_data())
    index: dict[str, str] = {}
    created = cached = unavailable = 0
    for monster in records.values():
        sprite = monster.get("sprite") or {}
        if not sprite.get("animated"):
            continue
        try:
            texture_index = int(str(sprite.get("index", -1)), 0)
        except (TypeError, ValueError):
            unavailable += 1
            continue
        key = (sprite.get("file"), texture_index)
        sprite_frames = unique_frames([frame for raw in lookup.get(key, []) if (frame := crop_frame(atlases, raw)) is not None])
        # A one-frame entry is a static client asset. Keep its existing PNG
        # fallback rather than write a misleading "animation" file.
        if len(sprite_frames) < 2:
            unavailable += 1
            continue
        filename = re.sub(r"[^a-z0-9]+", "-", monster["id"].lower()).strip("-") + ".webp"
        target = OUT_DIR / filename
        if target.is_file() and target.stat().st_size:
            cached += 1
        else:
            first, *rest = sprite_frames
            first.save(target, format="WEBP", save_all=True, append_images=rest, duration=180, loop=0, lossless=True, method=6)
            created += 1
        index[monster["id"]] = filename

    INDEX_PATH.write_text(json.dumps(index, separators=(",", ":")) + "\n", encoding="utf-8")
    print(f"Realm animations -> {OUT_DIR.relative_to(ROOT)} ({created} created, {cached} cached, {unavailable} static/unavailable)")


if __name__ == "__main__":
    main()
