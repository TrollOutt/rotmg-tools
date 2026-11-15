from __future__ import annotations

import argparse
import json
import os
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

# The documents the Index cannot be built without (ROT-B-09).
KEY_DOCUMENTS = ("Enchantments.xml", "EnchantmentLists.xml", "EquipmentSets.xml")


def contract_problem(source: Path, origin: dict) -> str:
    """Why the XML and the textures of client-data do not make one source ("" when they do).

    The key documents must be there, and the textures must come from the same
    build as the XML: tools/extract-client-textures.js writes its own
    textures/provenance.json, last, for this comparison.
    """
    missing = [name for name in KEY_DOCUMENTS if not (source / name).is_file()]
    if not any(source.glob("Objects.*.xml")) and not (source / "Objects.xml").is_file():
        missing.insert(0, "Objects.*.xml")
    if missing:
        return "client-data lacks key documents: " + ", ".join(missing) + ". Run tools/extract-client.js."
    textures = source / "textures" / "provenance.json"
    if not textures.is_file():
        return f"no {textures}: run tools/extract-client-textures.js (it records the textures' build)"
    texture_origin = json.loads(textures.read_text(encoding="utf-8")).get("from") or {}
    if texture_origin.get("build") != origin.get("build"):
        return (f"textures come from build {texture_origin.get('build')!r}, the XML from {origin.get('build')!r}: "
                "run tools/extract-client.js and tools/extract-client-textures.js on the same client")
    return ""


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--client-data")
    args = parser.parse_args()

    source = (
        Path(args.client_data)
        if args.client_data
        else Path(os.environ["ROTMG_CLIENT_DATA"])
        if os.environ.get("ROTMG_CLIENT_DATA")
        else ROOT / "client-data"
    ).resolve()

    required = [
        source / "provenance.json",
        source / "spritesheet.bin",
        source / "textures/groundTiles.png",
        source / "textures/characters.png",
        source / "textures/mapObjects.png",
    ]

    missing = [str(path) for path in required if not path.is_file()]
    if missing:
        raise SystemExit(
            "Incomplete client-data source; missing:\n  "
            + "\n  ".join(missing)
            + "\nRun tools/extract-client.js and tools/extract-client-textures.js."
        )

    provenance = json.loads(
        (source / "provenance.json").read_text(encoding="utf-8")
    )

    origin = provenance.get("from")
    if not isinstance(origin, dict):
        raise SystemExit("client-data provenance has no from object")

    build = origin.get("build")
    date = origin.get("date")

    if not build or build == "unknown":
        raise SystemExit("client-data provenance has no verified build")

    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", str(date or "")):
        raise SystemExit(f"invalid client source date: {date!r}")

    xml = sorted(source.glob("*.xml"))
    if len(xml) < 100:
        raise SystemExit(
            f"client-data source looks incomplete: only {len(xml)} XML files"
        )

    problem = contract_problem(source, origin)
    if problem:
        raise SystemExit(problem)

    print(
        "Client source contract: ok"
        f" | build={build}"
        f" | date={date}"
        f" | xml={len(xml)}"
        " | sprite-registry=ok"
        " | groundTiles=ok"
        " | characters=ok"
        " | mapObjects=ok"
    )


if __name__ == "__main__":
    main()
