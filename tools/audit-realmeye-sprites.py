#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import sqlite3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DB = ROOT / "data/Database/rotmg-tools.sqlite"
DEFAULT_OUT = ROOT / "local/realmeye-monitor/processed/sprite-audit.json"
SIDECAR = ROOT / "data/Index/realmeye-enrichment.json"


def main():
    parser = argparse.ArgumentParser(description="Compare Index artwork with RealmEye sprite fallbacks.")
    parser.add_argument("--db", default=str(DEFAULT_DB))
    parser.add_argument("--output", default=str(DEFAULT_OUT))
    args = parser.parse_args()

    con = sqlite3.connect(args.db)
    rows = con.execute(
        """
        SELECT e.legacy_index_id, v.display_name, a.asset_path,
               EXISTS(
                 SELECT 1 FROM asset_refs local
                 WHERE local.entity_uid=e.entity_uid
                   AND local.asset_type IN ('art','benchArt','benchPic','pic','icon')
               ) AS has_local
        FROM entities e
        JOIN v_entities v ON v.entity_uid=e.entity_uid
        JOIN asset_refs a ON a.entity_uid=e.entity_uid AND a.asset_type='realmeye_primary_image'
        WHERE e.legacy_index_id IS NOT NULL
        ORDER BY e.legacy_index_id,a.asset_path
        """
    ).fetchall()
    by_id = {}
    for legacy, name, url, has_local in rows:
        item = by_id.setdefault(
            legacy,
            {"id": legacy, "name": name or legacy, "hasLocalArt": bool(has_local), "realmeye": []},
        )
        if url not in item["realmeye"]:
            item["realmeye"].append(url)
    con.close()

    sidecar = {}
    if SIDECAR.is_file():
        try:
            sidecar = json.loads(SIDECAR.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            sidecar = {}
    runtime = sidecar.get("records", {}) if isinstance(sidecar, dict) else {}

    missing_core = [x for x in by_id.values() if not x["hasLocalArt"]]
    cached_core = [x for x in missing_core if (runtime.get(x["id"]) or {}).get("sprite")]
    still_missing_core = [x for x in missing_core if not (runtime.get(x["id"]) or {}).get("sprite")]

    community = [
        {"id": rid, "name": rec.get("name") or rid, "sprite": rec.get("sprite")}
        for rid, rec in runtime.items()
        if rec.get("communityOnly")
    ]
    community_with_sprite = [x for x in community if x.get("sprite")]
    community_without_sprite = [x for x in community if not x.get("sprite")]

    payload = {
        "counts": {
            "entitiesWithRealmEyeCandidate": len(by_id),
            "alreadyCoveredLocally": len(by_id) - len(missing_core),
            "missingLocalButRealmEyeAvailable": len(missing_core),
            "coveredByRealmEyeCache": len(cached_core),
            "stillMissingAfterRealmEyeCache": len(still_missing_core),
            "communityOnlyRecords": len(community),
            "communityOnlyWithSprite": len(community_with_sprite),
            "communityOnlyWithoutSprite": len(community_without_sprite),
        },
        "missingCore": still_missing_core,
        "communityWithoutSprite": community_without_sprite,
    }
    out = Path(args.output)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(payload["counts"], ensure_ascii=False))


if __name__ == "__main__":
    main()
