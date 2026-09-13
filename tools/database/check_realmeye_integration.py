from __future__ import annotations

import argparse
import json
import re
import sqlite3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_DB = ROOT / "data/Database/rotmg-tools.sqlite"


def main():
    parser = argparse.ArgumentParser(description="Validate RealmEye archive integration in the main SQLite database.")
    parser.add_argument("--db", default=str(DEFAULT_DB))
    args = parser.parse_args()
    db = Path(args.db)
    if not db.exists():
        raise SystemExit(f"missing database: {db}")
    con = sqlite3.connect(db)
    con.execute("PRAGMA foreign_keys=ON")
    integrity = con.execute("PRAGMA integrity_check").fetchone()[0]
    fk = con.execute("PRAGMA foreign_key_check").fetchall()
    if integrity != "ok" or fk:
        raise SystemExit(f"database invalid: integrity={integrity}, foreign_keys={len(fk)}")

    pages = con.execute("SELECT COUNT(*) FROM source_records WHERE record_type='realmeye_archive_page'").fetchone()[0]
    if not pages:
        print(json.dumps({"status": "skipped", "reason": "no RealmEye archive imported"}))
        con.close()
        return

    history_pages = con.execute(
        "SELECT COUNT(*) FROM source_records WHERE record_type='realmeye_archive_page' AND json_extract(payload_json,'$.type')='update-history'"
    ).fetchone()[0]
    history_fields = con.execute(
        """
        SELECT COUNT(*)
        FROM facts fact JOIN source_records page ON page.record_uid=fact.source_record_uid
        WHERE page.record_type='realmeye_archive_page'
          AND (fact.field_path LIKE 'community.realmeye.released%'
               OR fact.field_path LIKE 'community.realmeye.legacy_version%'
               OR fact.field_path LIKE 'community.realmeye.history%'
               OR fact.field_path LIKE 'community.realmeye.%before_release%')
        """
    ).fetchone()[0]
    if history_pages or history_fields:
        raise SystemExit(f"history exclusion failed: pages={history_pages}, fields={history_fields}")

    def mapped_entities(slug):
        return {
            row[0]
            for row in con.execute(
                """
                SELECT link.entity_uid
                FROM source_records page
                JOIN source_record_entities link ON link.record_uid=page.record_uid AND link.link_type='about'
                WHERE page.record_type='realmeye_archive_page' AND page.source_key=?
                """,
                (slug,),
            )
        }

    floral = mapped_entities("floral-escape")
    floral_companion = mapped_entities("floral-escape-enemies")
    floral_entities = floral | floral_companion
    if floral and len(floral) != 1:
        raise SystemExit(f"Floral Escape mapping is ambiguous: {len(floral)} entities")
    floral_relations = 0
    for entity_uid in floral_entities:
        floral_relations += con.execute(
            "SELECT COUNT(*) FROM relations WHERE from_entity_uid=? AND relation_type LIKE 'biome_%' AND json_extract(attributes_json,'$.source')='realmeye_archive'",
            (entity_uid,),
        ).fetchone()[0]
    if floral_entities and floral_relations == 0:
        raise SystemExit("Floral Escape has no structured biome relations after archive import")

    mid = mapped_entities("mid-desert")
    mid_relations = 0
    if mid:
        mid_relations = (
            con.execute(
                "SELECT COUNT(*) FROM relations WHERE from_entity_uid=? AND relation_type LIKE 'biome_%' AND json_extract(attributes_json,'$.source')='realmeye_archive'",
                (next(iter(mid)),),
            ).fetchone()[0]
            if len(mid) == 1
            else 0
        )
        if len(mid) == 1 and mid_relations == 0:
            raise SystemExit("Mid Desert has no structured biome relations after archive import")

    # Mid Plains is the regression fixture for the richer biome pages: the page
    # contains a four-column regular-enemy grid, a two-cell Heroes row, hero
    # minions, a guardian and a Drops of Interest table. All of those used to
    # collapse into either bogus text facts or disappear entirely.
    mid_plains_entities = mapped_entities("mid-plains") | mapped_entities("mid-plains-enemies")
    # Completeness belongs to the page-to-page evidence graph. Some target
    # pages intentionally map to more than one exact client declaration, so an
    # entity relation is not created until runtime can pick the public browse
    # representative. Counting only `relations` made a complete roster look
    # incomplete merely because an enemy had a twin.
    mid_plains_by_type = {}
    for relation_type, count in con.execute(
        """
        SELECT relation.relation_type,COUNT(*)
        FROM source_record_relations relation
        JOIN source_records source ON source.record_uid=relation.from_record_uid
        WHERE source.record_type='realmeye_archive_page'
          AND source.source_key IN ('mid-plains','mid-plains-enemies')
          AND relation.relation_type LIKE 'biome_%'
          AND json_extract(relation.attributes_json,'$.source')='realmeye_archive'
        GROUP BY relation.relation_type
        """
    ):
        mid_plains_by_type[relation_type] = count
    if mid_plains_entities:
        minimum = {
            "biome_regular_enemy": 8,
            "biome_hero": 2,
            "biome_hero_minion": 5,
            "biome_beacon_guardian": 1,
            "biome_drop_interest": 4,
        }
        missing = {key: (mid_plains_by_type.get(key, 0), wanted)
                   for key, wanted in minimum.items() if mid_plains_by_type.get(key, 0) < wanted}
        if missing:
            raise SystemExit(f"Mid Plains structured roster incomplete: {missing}")

    enemy_summaries = con.execute(
        """
        SELECT COUNT(DISTINCT fact.entity_uid)
        FROM facts fact
        JOIN source_records page ON page.record_uid=fact.source_record_uid
        WHERE page.record_type='realmeye_archive_page'
          AND json_extract(page.payload_json,'$.type')='enemy'
          AND fact.field_path='community.realmeye.summary'
        """
    ).fetchone()[0]
    if enemy_summaries == 0:
        raise SystemExit("RealmEye enemy descriptions were not imported")

    bad_mid_plains_facts = con.execute(
        """
        SELECT COUNT(*)
        FROM facts fact
        JOIN source_records page ON page.record_uid=fact.source_record_uid
        WHERE page.record_type='realmeye_archive_page'
          AND page.source_key IN ('mid-plains','mid-plains-enemies')
          AND fact.field_path IN (
            'community.realmeye.low','community.realmeye.mid','community.realmeye.high',
            'community.realmeye.main','community.realmeye.deathmage','community.realmeye.item'
          )
        """
    ).fetchone()[0]
    if bad_mid_plains_facts:
        raise SystemExit(f"Mid Plains still contains navigation/roster pseudo-facts: {bad_mid_plains_facts}")

    sidecar_path = ROOT / "data/Index/realmeye-enrichment.json"
    sidecar_checks = {}
    if sidecar_path.is_file():
        sidecar = json.loads(sidecar_path.read_text(encoding="utf-8"))
        exported = sidecar.get("records", {})
        page_index = sidecar.get("pageIndex", {})

        floral_export = exported.get("place:Floral Escape")
        if floral_entities and not floral_export:
            raise SystemExit("Floral Escape is integrated in SQLite but missing from RealmEye runtime enrichment")
        mid_plains_export = exported.get("place:Mid Plains") or {}
        if mid_plains_entities and not mid_plains_export:
            raise SystemExit("Mid Plains is integrated in SQLite but missing from runtime enrichment")

        # Sprite Forest is a regression fixture for source-page-driven card
        # descriptions. Its archived page has a clear introduction and a public
        # Index record, so neither an ambiguous client declaration nor the old
        # wiki join may make the description/source link disappear.
        sprite_forest_export = exported.get("place:Sprite Forest") or {}
        if sprite_forest_export:
            if not (sprite_forest_export.get("presentation") or {}).get("summary"):
                raise SystemExit("Sprite Forest archived description is missing from runtime presentation")

        # Wiki maintenance chrome is provenance/status, not a player-facing description.
        low_desert_export = exported.get("place:Low Desert") or {}
        low_summary = str((low_desert_export.get("presentation") or {}).get("summary") or "")
        if re.search(r"work in progress|last updated", low_summary, flags=re.I):
            raise SystemExit("RealmEye maintenance text leaked into Low Desert description")
        if sprite_forest_export and not sprite_forest_export.get("sourcePage"):
            raise SystemExit("Sprite Forest has an archived RealmEye page but no runtime source link")
        if mid_plains_export:
            presentation = mid_plains_export.get("presentation") or {}
            if presentation.get("rank") != "Rookie":
                raise SystemExit(f"Mid Plains rank was not recovered from the archived page: {presentation.get('rank')!r}")
            if not presentation.get("summary"):
                raise SystemExit("Mid Plains archived overview was not promoted into runtime presentation")
            bad = set((mid_plains_export.get("facts") or {})) & {"low", "mid", "high", "main", "deathmage", "item", "biome_drop_rows"}
            if bad:
                raise SystemExit(f"Mid Plains runtime still exposes pseudo/internal facts: {sorted(bad)}")
            drop_rows = mid_plains_export.get("dropRows") or []
            if len(drop_rows) < 4:
                raise SystemExit(f"Mid Plains Drops of Interest rows are incomplete: {len(drop_rows)}")
            resolved_items = sum(1 for row in drop_rows for ref in (row.get("items") or []) if ref.get("to"))
            resolved_sources = sum(1 for row in drop_rows for ref in (row.get("sources") or []) if ref.get("to"))
            if resolved_items < 4 or resolved_sources < 3:
                raise SystemExit(
                    "Mid Plains drop rows are not resolving onto Index records: "
                    f"items={resolved_items} sources={resolved_sources}"
                )
            runtime_counts = {}
            for relation in mid_plains_export.get("relations") or []:
                relation_type = relation.get("type")
                if relation_type:
                    runtime_counts[relation_type] = runtime_counts.get(relation_type, 0) + 1
            runtime_minimum = {
                "biome_regular_enemy": 8,
                "biome_hero": 2,
                "biome_hero_minion": 5,
                "biome_beacon_guardian": 1,
            }
            missing_runtime = {key: (runtime_counts.get(key, 0), wanted)
                               for key, wanted in runtime_minimum.items()
                               if runtime_counts.get(key, 0) < wanted}
            if missing_runtime:
                raise SystemExit(f"Mid Plains runtime roster incomplete: {missing_runtime}")
        for slug in ("floral-escape", "floral-escape-enemies"):
            if mapped_entities(slug) and "place:Floral Escape" not in (page_index.get(slug) or []):
                raise SystemExit(f"{slug} is not merged into the Floral Escape runtime record")

        desert = exported.get("place:Desert") or {}
        desert_scopes = set(desert.get("subBiomes") or [])
        expected_desert = {"Low Desert", "Mid Desert", "High Desert"}
        if not expected_desert.issubset(desert_scopes):
            raise SystemExit(
                "Desert merge is incomplete: "
                f"expected={sorted(expected_desert)} got={sorted(desert_scopes)}"
            )
        scope_deserts = [f"place:{name}" for name in expected_desert]
        missing_scope_records = [rid for rid in scope_deserts
                                 if not (exported.get(rid) or {}).get("scopeOnly")]
        if missing_scope_records:
            raise SystemExit(f"Desert sub-biomes are not navigable scope records: {missing_scope_records}")

        # Desert is a browse aggregate, not a replacement for its three real
        # bands. Every child must keep its own scoped roster/count and must not
        # inherit the parent's union. Mid/High are currently generated and have
        # known populations; Low Desert is a valid biome page but RealmEye marks
        # it as not currently generated, so zero is meaningful there.
        child_population = {}
        child_targets = {}
        for rid in scope_deserts:
            child = exported.get(rid) or {}
            if child.get("parentBiome") != "place:Desert":
                raise SystemExit(f"{rid} lost its Desert parent relationship")
            population = child.get("population") or {}
            if "total" not in population:
                raise SystemExit(f"{rid} has no independent population count")
            child_population[rid] = int(population.get("total") or 0)
            child_targets[rid] = {
                relation.get("to") or relation.get("toRealmEye")
                for relation in child.get("relations") or []
                if str(relation.get("type") or "").startswith("biome_")
                   and relation.get("type") != "biome_beacon_guardian"
                   and (relation.get("to") or relation.get("toRealmEye"))
            }
        if child_population.get("place:Mid Desert", 0) <= 0:
            raise SystemExit("Mid Desert lost its own population during Desert aggregation")
        if child_population.get("place:High Desert", 0) <= 0:
            raise SystemExit("High Desert lost its own population during Desert aggregation")
        if child_targets.get("place:Mid Desert") == child_targets.get("place:High Desert"):
            raise SystemExit("Mid Desert and High Desert were flattened into the same roster")
        low = exported.get("place:Low Desert") or {}
        low_status = (low.get("generationStatus") or {}).get("code")
        if child_population.get("place:Low Desert", 0) == 0 and low_status not in {None, "not-generating"}:
            raise SystemExit(f"Low Desert has no population but an inconsistent generation status: {low_status}")
        parent_population = int(((desert.get("population") or {}).get("total")) or 0)
        if parent_population < max(child_population.values() or [0]):
            raise SystemExit("Desert aggregate population is smaller than one of its child biomes")
        contains_targets = {relation.get("to") for relation in desert.get("relations") or []
                            if relation.get("type") == "contains_biome"}
        if not set(scope_deserts).issubset(contains_targets):
            raise SystemExit(
                "Desert does not link to every scoped sub-biome: "
                f"expected={scope_deserts} got={sorted(x for x in contains_targets if x)}"
            )
        false_biomes = [rid for rid in ("place:Quest Monsters", "place:Fishing") if rid in exported]
        if false_biomes:
            raise SystemExit(f"non-biome list pages leaked into Biome runtime records: {false_biomes}")
        for slug in ("low-desert", "mid-desert", "high-desert"):
            if "place:Desert" not in (page_index.get(slug) or []):
                raise SystemExit(f"{slug} no longer resolves internally to place:Desert")

        # Existing Index names must absorb RealmEye's naming variants.
        public_ids = {
            row[0]
            for row in con.execute(
                "SELECT legacy_index_id FROM entities WHERE legacy_index_id IS NOT NULL"
            )
        }
        alias_expect = {
            "abandoned-city": ("place:Ancient City", "place:Abandoned City"),
            "coral-reefs": ("place:Coral Reef", "place:Coral Reefs"),
        }
        merged_aliases = 0
        for slug, (target, duplicate) in alias_expect.items():
            if target not in public_ids:
                continue
            if target not in (page_index.get(slug) or []):
                raise SystemExit(f"RealmEye alias {slug} is not merged into {target}")
            if duplicate in exported:
                raise SystemExit(f"RealmEye alias leaked as duplicate record: {duplicate}")
            merged_aliases += 1

        # If the local biome beacon cache exists, Floral Escape should use it.
        biome_manifest = ROOT / "web/assets/realm-biomes/index.json"
        floral_sprite = bool((floral_export or {}).get("sprite"))
        if biome_manifest.is_file():
            try:
                manifest = json.loads(biome_manifest.read_text(encoding="utf-8"))
                entry = (manifest.get("beacons") or {}).get("Floral Escape")
                if entry and (biome_manifest.parent / entry.get("file", "")).is_file() and not floral_sprite:
                    raise SystemExit("Floral Escape has local RealmEye beacon art but no runtime sprite")
            except json.JSONDecodeError:
                raise SystemExit("invalid web/assets/realm-biomes/index.json")

        sidecar_checks = {
            "floral_escape_exported": bool(floral_export),
            "floral_escape_sprite": floral_sprite,
            "desert_merged_sub_biomes": len(desert_scopes),
            "desert_clickable_sub_biomes": sum(1 for rid in scope_deserts if (exported.get(rid) or {}).get("scopeOnly")),
            "desert_population": int(((desert.get("population") or {}).get("total")) or 0),
            "low_desert_population": int((((exported.get("place:Low Desert") or {}).get("population") or {}).get("total")) or 0),
            "mid_desert_population": int((((exported.get("place:Mid Desert") or {}).get("population") or {}).get("total")) or 0),
            "high_desert_population": int((((exported.get("place:High Desert") or {}).get("population") or {}).get("total")) or 0),
            "low_desert_generation_status": ((exported.get("place:Low Desert") or {}).get("generationStatus") or {}).get("code"),
            "runtime_alias_merges_checked": merged_aliases,
            "runtime_records_with_sprite": sidecar.get("counts", {}).get("recordsWithSprite", 0),
            "runtime_records_needing_sprite": sidecar.get("counts", {}).get("recordsNeedingSprite", 0),
            "mid_plains_exported": bool(mid_plains_export),
            "mid_plains_rank": (mid_plains_export.get("presentation") or {}).get("rank"),
            "mid_plains_drop_rows": len(mid_plains_export.get("dropRows") or []),
            "sprite_forest_description": bool((sprite_forest_export.get("presentation") or {}).get("summary")),
            "sprite_forest_source_page": bool(sprite_forest_export.get("sourcePage")),
            "runtime_records_with_description": sidecar.get("counts", {}).get("recordsWithDescription", 0),
            "runtime_records_with_source_page": sidecar.get("counts", {}).get("recordsWithSourcePage", 0),
        }

    stats = {
        "status": "ok",
        "pages": pages,
        "linked_pages": con.execute(
            """
            SELECT COUNT(DISTINCT page.record_uid)
            FROM source_records page JOIN source_record_entities link ON link.record_uid=page.record_uid
            WHERE page.record_type='realmeye_archive_page' AND link.link_type='about'
            """
        ).fetchone()[0],
        "facts": con.execute(
            "SELECT COUNT(*) FROM facts fact JOIN source_records page ON page.record_uid=fact.source_record_uid WHERE page.record_type='realmeye_archive_page'"
        ).fetchone()[0],
        "relations": con.execute(
            "SELECT COUNT(*) FROM source_record_relations WHERE source_field LIKE 'archive:%'"
        ).fetchone()[0],
        "entity_relations": con.execute(
            "SELECT COUNT(*) FROM relations WHERE json_extract(attributes_json,'$.source')='realmeye_archive'"
        ).fetchone()[0],
        "sprite_candidates": con.execute(
            "SELECT COUNT(*) FROM asset_refs WHERE asset_type='realmeye_primary_image'"
        ).fetchone()[0],
        "provisional_entities": con.execute(
            "SELECT COUNT(*) FROM entities WHERE status='provisional' AND uid_basis LIKE 'realmeye-archive|%'"
        ).fetchone()[0],
        "history_pages": history_pages,
        "history_fields": history_fields,
        "floral_escape_relations": floral_relations,
        "mid_desert_relations": mid_relations,
        "mid_plains_relations": sum(mid_plains_by_type.values()),
        "mid_plains_regular_enemies": mid_plains_by_type.get("biome_regular_enemy", 0),
        "mid_plains_heroes": mid_plains_by_type.get("biome_hero", 0),
        "mid_plains_hero_minions": mid_plains_by_type.get("biome_hero_minion", 0),
        "mid_plains_drops": mid_plains_by_type.get("biome_drop_interest", 0),
        "enemy_descriptions": enemy_summaries,
        "internal_relation_targets": con.execute(
            """
            SELECT COUNT(*) FROM relations relation
            JOIN entities target ON target.entity_uid=relation.to_entity_uid
            WHERE json_extract(relation.attributes_json,'$.source')='realmeye_archive'
              AND target.legacy_index_id IS NOT NULL
            """
        ).fetchone()[0],
    }
    stats.update(sidecar_checks)
    con.close()
    print(json.dumps(stats, ensure_ascii=False))


if __name__ == "__main__":
    main()
