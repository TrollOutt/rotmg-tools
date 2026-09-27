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
local archive the committed file is kept as it is.
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


def export(archive: Path, enrichment: Path, output: Path) -> None:
    if not archive.exists():
        print(f"  no local RealmEye archive at {archive}; keeping {output.relative_to(ROOT)}")
        return
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
    if (previous
            and previous.get("records") == out["records"]
            and previous.get("pages") == out["pages"]
            and previous.get("from") == out["from"]
            and previous.get("source") == out["source"]):
        print(f"  {output.relative_to(ROOT)} unchanged")
        return
    output.write_text(json.dumps(out, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"  {len(records)} records written to {output.relative_to(ROOT)}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Publish what RealmEye lists as unreleased, testing, admin or scrapped.")
    parser.add_argument("--archive", default=str(DEFAULT_ARCHIVE))
    parser.add_argument("--enrichment", default=str(DEFAULT_ENRICHMENT))
    parser.add_argument("--output", default=str(DEFAULT_OUTPUT))
    args = parser.parse_args()
    export(Path(args.archive), Path(args.enrichment), Path(args.output))


if __name__ == "__main__":
    main()
