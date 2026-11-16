"""What RealmEye says a creature's life and defence are, for the Index build.

    python tools/database/export_realmeye_stats.py      # npm run wiki-stats

The client gives one display name to several objects: the creature, its
helpers and decoys, a harder copy, the copy a rework retired. The Index shows
them as one row and has to pick which object carries it, and nothing in the
client says which one players call by that name - so Cube God showed an old
16,000-life object, Avalon the Archivist a candle helper with no life at all.

RealmEye's page of that exact title states the life and defence of the
creature it means. This reads them from the local RealmEye archive and writes
data/Index/realmeye-stats.json: page title -> the (life, defence) pairs the
page states. tools/build-index.js lets the object matching a pair carry the
row; tools/database/export_realmeye_enrichment.py sends a page to the object
matching it. The values shown stay the client's: RealmEye only breaks the tie,
and a page that matches no object changes nothing.

Without the local archive the committed file is kept as it is.
"""
from __future__ import annotations

import argparse
import json
import re
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_ARCHIVE = ROOT / "local/realmeye-monitor/processed/realmeye.sqlite"
DEFAULT_OUTPUT = ROOT / "data/Index/realmeye-stats.json"


def stated(value):
    """'40,000 ( Boss Adaptive HP Scaling ) DEF: 25 EXP: ...' -> [40000, 25]; no life -> None."""
    text = str(value or "")
    life = re.match(r"\s*(\d[\d,]*)", text)
    if not life:
        return None
    defence = re.search(r"DEF:\s*(-?\d[\d,]*)", text)
    return [int(life.group(1).replace(",", "")), int(defence.group(1).replace(",", "")) if defence else None]


def read(archive: Path):
    con = sqlite3.connect(f"file:{archive.as_posix()}?mode=ro", uri=True)
    enemies = {}
    for title, value in con.execute(
        "SELECT p.title,f.value FROM facts f JOIN pages p ON p.url=f.page_url "
        "WHERE p.type_guess='enemy' AND f.key IN ('HP','Base HP') ORDER BY p.title,f.id"
    ):
        pair = stated(value)
        if pair and pair not in enemies.setdefault(title, []):
            enemies[title].append(pair)
    con.close()
    return {title: pairs for title, pairs in sorted(enemies.items()) if pairs}


def export(archive: Path, output: Path):
    if not archive.is_file():
        print(f"  No RealmEye archive at {archive}: {output.name} is kept as it is.")
        return None
    enemies = read(archive)
    if not enemies:
        raise RuntimeError("the RealmEye archive states no creature's life: refusing to write an empty file")
    payload = {
        "built": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "tool": "tools/database/export_realmeye_stats.py",
        "from": {"kind": "community", "source": "RealmEye", "home": "https://www.realmeye.com/wiki/"},
        "source": "RealmEye (community), not the client",
        "enemies": enemies,
    }
    output.write_text(json.dumps(payload, ensure_ascii=False, indent=1) + "\n", encoding="utf-8", newline="\n")
    print(f"  {len(enemies)} creatures with a stated life written to {output}")
    return payload


def main() -> None:
    parser = argparse.ArgumentParser(description="Publish the life and defence RealmEye states for each creature.")
    parser.add_argument("--archive", default=str(DEFAULT_ARCHIVE))
    parser.add_argument("--output", default=str(DEFAULT_OUTPUT))
    args = parser.parse_args()
    export(Path(args.archive), Path(args.output))


if __name__ == "__main__":
    main()
