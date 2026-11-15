"""What RealmEye says a player cannot get, for the Index to tell the tools.

    python tools/database/export_realmeye_availability.py

The client declares everything it ships, including things no player can
obtain: abilities of a tier still to come, admin gear, test objects, things
taken out of the game. Nothing in the client says which is which - the tier 8
abilities are labelled LOOTABLE like any other - so the tools offered them,
and a best-possible build came back wearing an ability nobody can have.

RealmEye keeps a page of exactly that: Unreleased Content. This reads it from
the local RealmEye archive and writes data/Index/availability.json: each Index
record it lists, and which page listed it. tools/build-index.js reads that file, files those records as hidden
with the page as the reason, and keeps them out of Theory Crafting, the Enchant
Calculator and the fights; the Index still shows them, tagged.

The records are found through the RealmEye enrichment's page index (page slug
to Index record), so only pages the Index already joins are used. Without the
local archive it stops with an error: keeping the committed file would let a
new build's unreleased content into the tools.

A list that comes back empty, or with less than half the records of the
committed file, means the page changed shape rather than RealmEye releasing
everything at once (ROT-B-03): the export stops and writes nothing, unless
--accept-drop.
"""
from __future__ import annotations

import argparse
import gzip
import html
import json
import re
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_ARCHIVE = ROOT / "local/realmeye-monitor/processed/realmeye.sqlite"
DEFAULT_ENRICHMENT = ROOT / "data/Index/realmeye-enrichment.json"
DEFAULT_OUTPUT = ROOT / "data/Index/availability.json"

# Only the Unreleased page. RealmEye's Testing, Admin and Scrapped pages link
# the test or old copy of a thing to the live thing's page, so read through the
# page index they name Rock Dragon, the Lost Halls, the Nexus and the Marble
# Colossus - all very much in the game. Admin and test objects are already kept
# out of the tools by what the client itself says (AdminOnly, test names).
PAGES = [
    ("unreleased", "unreleased-content"),
]


def listed(page_html: str) -> list[tuple[str, str]]:
    """The (slug, name) of every thing in the page's tables - not its menus."""
    start = page_html.find('class="wiki-page"')
    if start < 0:
        return []
    end = page_html.find('<ul class="nav nav-stacked"', start)
    body = page_html[start:end if end > 0 else None]
    out = []
    for table in re.findall(r"<table\b.*?</table>", body, re.S):
        for slug, inner in re.findall(r'<a href="/wiki/([^"#?]+)"[^>]*>(.*?)</a>', table, re.S):
            said = re.search(r'(?:alt|title)="([^"]+)"', inner)
            name = html.unescape(said.group(1) if said else re.sub(r"<[^>]+>", "", inner)).strip()
            out.append((slug, name))
    return out


MIN_KEPT_SHARE = 0.5


def drop_problem(previous: int, listed: int, found: int) -> str:
    """Why a new Unreleased list may not replace the committed one ("" when it may)."""
    if listed == 0:
        return "the Unreleased page lists nothing (has its layout changed?)"
    if found == 0:
        return f"{listed} things listed but none joins an Index record"
    if previous and found < previous * MIN_KEPT_SHARE:
        return f"{found} records against {previous} in the committed file (more than half gone)"
    return ""


def shown(path: Path) -> str:
    try:
        return str(path.resolve().relative_to(ROOT))
    except ValueError:
        return str(path)


def export(archive: Path, enrichment: Path, output: Path, accept_drop: bool = False) -> None:
    if not archive.exists():
        # Keeping the old list would let a new build's unreleased content into the tools.
        raise SystemExit(f"  no local RealmEye archive at {archive}; the Unreleased list cannot be refreshed")
    page_index = json.loads(enrichment.read_text(encoding="utf-8")).get("pageIndex", {})
    con = sqlite3.connect(archive)
    con.row_factory = sqlite3.Row
    records: dict[str, str] = {}
    sources = {}
    for status, slug in PAGES:
        row = con.execute("SELECT slug, raw_hash, source_file FROM pages WHERE slug = ?", (slug,)).fetchone()
        if row is None:
            raise SystemExit(f"the archive has no {slug} page; refresh it before publishing availability")
        page_html = gzip.open(ROOT / row["source_file"]).read().decode("utf-8", "replace")
        things = listed(page_html)
        found = 0
        for thing_slug, _name in things:
            for record_id in page_index.get(thing_slug, []):
                if record_id not in records:
                    records[record_id] = status
                    found += 1
        sources[status] = {"page": f"https://www.realmeye.com/wiki/{slug}", "rawHash": row["raw_hash"],
                           "listed": len(things), "records": found}
        print(f"  {status:<10} {len(things):>4} listed on {slug}, {found} Index records")
    con.close()
    out = {
        "built": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "tool": "tools/database/export_realmeye_availability.py",
        "from": {
            "kind": "community",
            "source": "RealmEye",
            "home": "https://www.realmeye.com/wiki/",
        },
        "source": "RealmEye (community), not the client",
        "pages": sources,
        "records": dict(sorted(records.items())),
    }
    previous = json.loads(output.read_text(encoding="utf-8")) if output.exists() else None
    problem = drop_problem(len((previous or {}).get("records") or {}),
                           sum(page["listed"] for page in sources.values()), len(records))
    if problem and not accept_drop:
        raise SystemExit(f"  availability not written: {problem}. Check the page, or pass --accept-drop.")
    if problem:
        print(f"  warning: {problem}; written anyway (--accept-drop)")
    if (previous
            and previous.get("records") == out["records"]
            and previous.get("pages") == out["pages"]
            and previous.get("from") == out["from"]
            and previous.get("source") == out["source"]):
        print(f"  {shown(output)} unchanged")
        return
    output.write_text(json.dumps(out, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"  {len(records)} records written to {shown(output)}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Publish what RealmEye lists as unreleased, testing, admin or scrapped.")
    parser.add_argument("--archive", default=str(DEFAULT_ARCHIVE))
    parser.add_argument("--enrichment", default=str(DEFAULT_ENRICHMENT))
    parser.add_argument("--output", default=str(DEFAULT_OUTPUT))
    parser.add_argument("--accept-drop", action="store_true",
                        help="Write the list even if it is empty or lost more than half its records")
    args = parser.parse_args()
    export(Path(args.archive), Path(args.enrichment), Path(args.output), args.accept_drop)


if __name__ == "__main__":
    main()
