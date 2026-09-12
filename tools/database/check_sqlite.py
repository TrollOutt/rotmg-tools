"""Independent semantic checks for the Phase 1 SQLite migration."""
from __future__ import annotations

import hashlib
import json
import os
import re
import sqlite3
import subprocess
import sys
import tempfile
import uuid
from pathlib import Path

from signature import stable_signature

ROOT = Path(__file__).resolve().parents[2]
DB = ROOT / "data/Database/rotmg-tools.sqlite"
REPORT = ROOT / "data/Database/import-report.json"
BUILD = ROOT / "tools/database/build_sqlite.py"
EXPORT = ROOT / "tools/database/export_index.py"
NS = uuid.UUID("2a20c00e-0d71-5eb3-85f9-5d66c9a52768")


def u(*parts):
    return str(uuid.uuid5(NS, "\x1f".join(map(str, parts))))


def canon(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def rows(connection, query, args=()):
    return connection.execute(query, args).fetchall()


def decimal(value):
    try:
        return str(int(str(value), 0))
    except ValueError:
        return str(value)


def realmeye_slug(value):
    value = str(value or "").strip()
    value = re.sub(r"^https?://(?:www\.)?realmeye\.com/wiki/", "", value, flags=re.I)
    value = re.sub(r"^/wiki/", "", value, flags=re.I)
    return value.split("#", 1)[0].split("?", 1)[0].strip("/")


def expected_snapshot_scalars(path):
    if path.suffix.lower() != ".json":
        return None, None, None, None
    obj = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(obj, dict):
        return None, None, None, obj
    source_from = obj.get("from") if isinstance(obj.get("from"), dict) else {}
    version = source_from.get("build") or source_from.get("snapshot") or obj.get("version")
    date = (
        source_from.get("date")
        or obj.get("sourceDate")
        or obj.get("versionDate")
        or obj.get("built")
        or obj.get("generatedAt")
    )
    tool = obj.get("tool")
    return (
        str(version) if version is not None else None,
        str(date) if date is not None else None,
        str(tool) if tool is not None else None,
        obj,
    )


def parse_manual_rules_independently(path):
    out = []
    for position, raw in enumerate(path.read_text(encoding="utf-8").splitlines()):
        line = raw.strip()
        if not line:
            continue
        rule_type = None
        payload = None

        if path.name == "zone-names.txt":
            if line.startswith("#"):
                continue
            if line.startswith("join ") and " into " in line:
                source, target = line[5:].split(" into ", 1)
                rule_type, payload = "zone_join", {"from": source, "to": target}
            elif line.startswith("@") and "|" in line:
                coordinate, name = line.split("|", 1)
                rule_type, payload = "coordinate_name", {"coordinate": coordinate, "name": name}
            elif "|" in line:
                ground, place = line.split("|", 1)
                rule_type, payload = "ground_place", {"ground": ground, "place": place}

        elif path.name == "off-the-map.txt":
            command, _, value = line.partition(" ")
            if command in {"class", "id", "keep", "life", "creatures", "blank", "elsewhere"}:
                rule_type, payload = "off_map_" + command, {"value": value}

        elif path.name == "realm-biomes.txt":
            if re.match(r"^#[0-9a-fA-F]{6}\|", line) and line.count("|") == 3:
                colour, biome, when, who = line.split("|")
                rule_type, payload = "biome_colour", {
                    "colour": colour,
                    "biome": biome,
                    "when": when,
                    "who": who,
                }

        elif path.name == "realm-beacons.txt":
            if re.fullmatch(r"\d+\|\d+", line):
                x, y = line.split("|")
                rule_type, payload = "beacon_cell", {"column": int(x), "row": int(y)}

        elif path.name == "realm-terrain.txt":
            if line.startswith("legend|"):
                rule_type, payload = "terrain_legend", {"value": line}

        if rule_type is not None:
            out.append((position, rule_type, raw, canon(payload)))
    return out


def main():
    assert DB.exists(), f"missing database: {DB}"
    connection = sqlite3.connect(DB)
    connection.execute("PRAGMA foreign_keys=ON")
    assert rows(connection, "PRAGMA integrity_check") == [("ok",)]
    assert not rows(connection, "PRAGMA foreign_key_check")

    index = json.loads((ROOT / "data/Index/index.json").read_text(encoding="utf-8"))
    wiki = json.loads((ROOT / "data/Index/wiki.json").read_text(encoding="utf-8"))
    realmeye = json.loads((ROOT / "web/realmeye-data.json").read_text(encoding="utf-8"))
    files = index["files"]
    records = index["records"]

    entity = {
        legacy: entity_uid
        for legacy, entity_uid in rows(
            connection,
            "SELECT legacy_index_id,entity_uid FROM entities WHERE legacy_index_id IS NOT NULL",
        )
    }
    assert len(entity) == len(records)

    # Materialize the inspection view once. Querying v_entities separately for
    # every one of the ~19k Index records makes the checker quadratic in practice.
    entity_labels = dict(rows(
        connection,
        "SELECT entity_uid,display_name FROM v_entities",
    ))

    for record in records:
        source = record.get("from", [])
        document = files[source[0]] if len(source) > 1 else None
        typ = source[1] if len(source) > 1 else None
        identity_client = record.get("alias") or record.get("clientId")
        basis = (
            f'client|{record["kind"]}|{document}|{typ}|{identity_client}'
            if document and typ and identity_client
            else f'legacy-index|{record["kind"]}|{record["id"]}'
        )
        assert entity[record["id"]] == u("entity", basis)
        expected_label = record.get("said") or record.get("name")
        assert entity_labels.get(entity[record["id"]]) == expected_label

    expected_primary = set()
    expected_also = set()
    expected_refs = set()
    by_document_type = {}
    by_document_type_client = {}

    for record in records:
        source = record["from"]
        document = files[source[0]]
        typ = decimal(source[1])
        client_id = record.get("alias") or record.get("clientId") or record["name"]
        entity_uid = entity[record["id"]]
        key = f"{document}|{typ}|{client_id}"
        expected_primary.add((entity_uid, key))
        expected_refs.update({
            (entity_uid, "client_document", document),
            (entity_uid, "client_type", typ),
            (entity_uid, "client_id", client_id),
            (entity_uid, "client_source_key", key),
        })
        by_document_type.setdefault((document, typ), set()).add(entity_uid)
        by_document_type_client.setdefault((document, typ, str(client_id)), set()).add(entity_uid)

        for file_index in record.get("also", []):
            alternate_document = files[file_index]
            alternate_key = f"{alternate_document}|{typ}|{client_id}"
            expected_also.add((entity_uid, alternate_key))
            expected_refs.update({
                (entity_uid, "client_document", alternate_document),
                (entity_uid, "client_type", typ),
                (entity_uid, "client_id", client_id),
                (entity_uid, "client_source_key", alternate_key),
            })
            by_document_type.setdefault((alternate_document, typ), set()).add(entity_uid)
            by_document_type_client.setdefault(
                (alternate_document, typ, str(client_id)), set()
            ).add(entity_uid)

    assert set(rows(
        connection,
        "SELECT entity_uid,source_key FROM source_records WHERE record_type='index_record'",
    )) == expected_primary
    assert set(rows(
        connection,
        "SELECT entity_uid,source_key FROM source_records WHERE record_type='index_also'",
    )) == expected_also

    actual_refs = set(rows(
        connection,
        """
        SELECT entity_uid,ref_type,ref_value
        FROM external_refs
        WHERE source_code='client_data_index_source'
          AND ref_type IN ('client_document','client_type','client_id','client_source_key')
        """,
    ))
    assert actual_refs == expected_refs

    keys = [value for (value,) in rows(
        connection,
        "SELECT source_key FROM source_records WHERE record_type IN ('index_record','index_also')",
    )]
    assert not [value for value in keys if value.endswith("|") or "|0x" in value.lower()]

    page = dict(rows(
        connection,
        """
        SELECT json_extract(payload_json,'$.legacy_page_index'),record_uid
        FROM source_records
        WHERE record_type='realmeye_page'
        """,
    ))
    assert len(page) == len(wiki["pages"])

    expected_page_links = {
        (page[page_index], entity[wiki["ids"][id_index]])
        for id_index, page_index in wiki["page"]
    }
    assert set(rows(
        connection,
        """
        SELECT link.record_uid,link.entity_uid
        FROM source_record_entities link
        JOIN source_records record ON record.record_uid=link.record_uid
        WHERE link.link_type='about'
          AND record.record_type='realmeye_page'
        """,
    )) == expected_page_links

    def expected_page_pairs(field, relation_type):
        return {
            (page[source_page], relation_type, page[target_page])
            for source_page, target_page, *_ in wiki.get(field, [])
        }

    for field, relation_type in (
        ("drop", "drops"),
        ("spawn", "spawns"),
        ("dungeon", "dungeon_contains"),
        ("tierDungeon", "tier_dungeon"),
    ):
        assert set(rows(
            connection,
            """
            SELECT from_record_uid,relation_type,to_record_uid
            FROM source_record_relations
            WHERE source_field=?
            """,
            (field,),
        )) == expected_page_pairs(field, relation_type)

    expected_near = set()
    for id_index, page_index in wiki.get("near", []):
        legacy_id = wiki["ids"][id_index]
        record_uid = rows(
            connection,
            """
            SELECT record_uid
            FROM source_records
            WHERE entity_uid=? AND record_type='index_record'
            """,
            (entity[legacy_id],),
        )[0][0]
        expected_near.add((record_uid, "near", page[page_index]))
    assert set(rows(
        connection,
        """
        SELECT from_record_uid,relation_type,to_record_uid
        FROM source_record_relations
        WHERE source_field='near'
        """,
    )) == expected_near

    expected_evidence = {
        (page[source_page], page[target_page], wiki["dungeonSections"][section_index])
        for source_page, target_page, section_index in wiki.get("dungeonEvidence", [])
    }
    assert set(rows(
        connection,
        """
        SELECT relation.from_record_uid,relation.to_record_uid,evidence.evidence_key
        FROM source_relation_evidence evidence
        JOIN source_record_relations relation
          ON relation.relation_uid=evidence.source_relation_uid
        """,
    )) == expected_evidence

    expected_tier_drops = {
        (
            page[enemy_page],
            wiki["tierDropHands"][hand_index],
            tier,
            alternate,
            wiki["tierDropLists"][list_index],
        )
        for enemy_page, hand_index, tier, alternate, list_index in wiki.get("tierDrop", [])
    }
    assert set(rows(
        connection,
        """
        SELECT enemy_page_record_uid,hand,tier,alternate,evidence_list_slug
        FROM wiki_tier_drops
        """,
    )) == expected_tier_drops

    wine = next(i for i, value in enumerate(wiki["pages"]) if value[1] == "Wine Cellar")
    oryx = next(i for i, value in enumerate(wiki["pages"]) if value[1] == "Oryx the Mad God 2")
    assert (page[wine], "dungeon_contains", page[oryx]) in expected_page_pairs(
        "dungeon", "dungeon_contains"
    )

    expected_groups = set()
    expected_members = set()
    expected_fold_orders = set()
    for record in records:
        folds = record.get("folds")
        if not folds:
            continue
        group_uid = u("browse", record["id"])
        representative_uid = entity[record["id"]]
        expected_groups.add((
            group_uid,
            representative_uid,
            record.get("said") or record.get("name", record["id"]),
        ))
        representative_seen = False
        for position, fold in enumerate(folds):
            fold_from = fold["from"]
            document = files[fold_from[0]]
            typ = decimal(fold_from[1])
            candidates = set(by_document_type.get((document, typ), set()))
            method = "document_type"
            if len(candidates) != 1 and fold.get("was") is not None:
                candidates = set(by_document_type_client.get(
                    (document, typ, str(fold["was"])), set()
                ))
                method = "document_type_was"
            assert len(candidates) == 1, (record["id"], fold, candidates)
            member_uid = next(iter(candidates))
            is_representative = 1 if member_uid == representative_uid else 0
            representative_seen = representative_seen or bool(is_representative)
            expected_members.add((
                group_uid,
                member_uid,
                is_representative,
                fold.get("why"),
                canon({**fold, "match_method": method}),
            ))
            expected_fold_orders.add((group_uid, position, member_uid))
        assert representative_seen, record["id"]

    assert set(rows(
        connection,
        "SELECT group_uid,representative_entity_uid,display_name FROM browse_groups",
    )) == expected_groups
    assert set(rows(
        connection,
        """
        SELECT group_uid,entity_uid,is_representative,reason,diff_json
        FROM browse_group_members
        """,
    )) == expected_members
    assert not rows(connection, "SELECT 1 FROM unresolved_links WHERE relation_type='fold_member'")
    assert not rows(
        connection,
        "SELECT 1 FROM browse_group_members WHERE reason='representative_without_fold'",
    )

    assert set(rows(
        connection,
        "SELECT group_uid,position,entity_uid FROM index_fold_order",
    )) == expected_fold_orders

    expected_folded_targets = set()
    representative_by_legacy = {
        representative_uid: group_uid
        for group_uid, representative_uid, _display_name in expected_groups
    }
    for record in records:
        target = record.get("folded")
        if target is not None:
            expected_folded_targets.add((
                entity[record["id"]],
                representative_by_legacy[entity[target]],
            ))
    assert set(rows(
        connection,
        "SELECT entity_uid,target_group_uid FROM index_folded_targets",
    )) == expected_folded_targets

    expected_catalogues = set()
    expected_sections = set()
    expected_catalogue_members = set()
    all_client_candidates = {}
    for (_, _, client_id), candidates in by_document_type_client.items():
        all_client_candidates.setdefault(client_id, set()).update(candidates)

    for name, payload in sorted(index.get("catalogues", {}).items()):
        catalogue_uid = u("catalogue", name)
        expected_catalogues.add((catalogue_uid, name, canon({"source": "index.catalogues"})))
        if isinstance(payload, list):
            sections = [("root", payload)]
        elif isinstance(payload, dict):
            sections = sorted(payload.items())
        else:
            sections = [("root", payload)]

        for section, values in sections:
            section_uid = u("catalogue-section", catalogue_uid, section)
            expected_sections.add((section_uid, catalogue_uid, section, canon({})))
            if isinstance(values, list):
                normalized_values = values
            elif isinstance(values, dict):
                normalized_values = [
                    {"key": key, "value": value}
                    for key, value in sorted(values.items())
                ]
            else:
                normalized_values = [values]

            for position, value in enumerate(normalized_values):
                if isinstance(value, dict):
                    legacy_key = (
                        value.get("id")
                        or value.get("key")
                        or value.get("name")
                        or str(position)
                    )
                    candidate_set = (
                        set(all_client_candidates.get(str(value["id"]), set()))
                        if value.get("id")
                        else set()
                    )
                    member_entity = (
                        next(iter(candidate_set)) if len(candidate_set) == 1 else None
                    )
                else:
                    legacy_key = str(position)
                    member_entity = None
                expected_catalogue_members.add((
                    catalogue_uid,
                    section,
                    member_entity,
                    str(legacy_key),
                    position,
                    canon(value),
                ))

    assert set(rows(
        connection,
        "SELECT catalogue_uid,name,metadata_json FROM catalogues",
    )) == expected_catalogues
    assert set(rows(
        connection,
        """
        SELECT catalogue_section_uid,catalogue_uid,name,metadata_json
        FROM catalogue_sections
        """,
    )) == expected_sections
    assert set(rows(
        connection,
        """
        SELECT catalogue_uid,section,entity_uid,legacy_key,position,payload_json
        FROM catalogue_members
        """,
    )) == expected_catalogue_members

    index_snapshot = rows(
        connection,
        "SELECT snapshot_uid FROM source_snapshots WHERE relative_path='client-data/shared-index-source'",
    )
    assert len(index_snapshot) == 1
    index_snapshot_uid = index_snapshot[0][0]
    index_record_sources = {
        entity_uid: (record_uid, snapshot_uid, source_key)
        for record_uid, entity_uid, snapshot_uid, source_key in rows(
            connection,
            """
            SELECT record_uid,entity_uid,snapshot_uid,source_key
            FROM source_records
            WHERE record_type='index_record'
            """,
        )
    }
    assert len(index_record_sources) == len(records)
    expected_primary_declarations = set()
    expected_also_order = set()
    expected_field_order = set()
    expected_index_facts = set()
    for record in records:
        entity_uid = entity[record["id"]]
        record_uid, snapshot_uid, _source_key = index_record_sources[entity_uid]
        assert snapshot_uid == index_snapshot_uid
        file_position, public_type = record["from"]
        expected_primary_declarations.add((
            entity_uid,
            record_uid,
            index_snapshot_uid,
            file_position,
            canon(public_type),
        ))
        for position, field_name in enumerate(record):
            expected_field_order.add((entity_uid, position, field_name))
            if field_name not in {"id", "kind", "from", "also", "folds", "folded"}:
                expected_index_facts.add((
                    record_uid,
                    field_name,
                    canon(record[field_name]),
                    "migration",
                ))
        client = record.get("alias") or record.get("clientId") or record["name"]
        for position, also_file_position in enumerate(record.get("also", [])):
            also_key = f"{files[also_file_position]}|{decimal(public_type)}|{client}"
            matches = rows(
                connection,
                """
                SELECT record_uid
                FROM source_records
                WHERE entity_uid=? AND record_type='index_also' AND source_key=?
                """,
                (entity_uid, also_key),
            )
            assert len(matches) == 1, (record["id"], also_key)
            expected_also_order.add((
                index_snapshot_uid,
                entity_uid,
                position,
                matches[0][0],
                also_file_position,
            ))

    assert set(rows(
        connection,
        """
        SELECT entity_uid,source_record_uid,snapshot_uid,file_position,public_type_json
        FROM index_primary_declarations
        """,
    )) == expected_primary_declarations
    assert set(rows(
        connection,
        """
        SELECT snapshot_uid,entity_uid,position,source_record_uid,file_position
        FROM index_also_order
        """,
    )) == expected_also_order
    assert set(rows(
        connection,
        "SELECT entity_uid,position,field_name FROM index_record_field_order",
    )) == expected_field_order
    assert set(rows(
        connection,
        """
        SELECT fact.source_record_uid,fact.field_path,fact.value_json,fact.origin_type
        FROM facts fact
        JOIN source_records record ON record.record_uid=fact.source_record_uid
        WHERE record.record_type='index_record'
        """,
    )) == expected_index_facts
    contract = {
        key: value
        for key, value in index.items()
        if key not in {"files", "records", "catalogues", "views"}
    }
    contract_rows = rows(
        connection,
        "SELECT snapshot_uid,metadata_json FROM index_contract",
    )
    assert len(contract_rows) == 1
    contract_snapshot_uid, actual_contract_json = contract_rows[0]
    assert contract_snapshot_uid == index_snapshot_uid

    actual_contract = json.loads(actual_contract_json)
    source_date = (actual_contract.get("from") or {}).get("date")
    assert re.fullmatch(r"\d{4}-\d{2}-\d{2}", str(source_date or ""))
    assert actual_contract.get("built") == source_date + "T00:00:00.000Z"

    # Phase 2D intentionally replaces only the historical generation timestamp.
    # Every semantic/nonvolatile contract field must remain identical.
    assert {
        key: value for key, value in actual_contract.items() if key != "built"
    } == {
        key: value for key, value in contract.items() if key != "built"
    }
    assert rows(
        connection,
        "SELECT position,document FROM index_files WHERE snapshot_uid=? ORDER BY position",
        (index_snapshot_uid,),
    ) == list(enumerate(files))
    assert rows(
        connection,
        """
        SELECT ordering.position,entity.legacy_index_id
        FROM index_record_order ordering
        JOIN entities entity ON entity.entity_uid=ordering.entity_uid
        WHERE ordering.snapshot_uid=?
        ORDER BY ordering.position
        """,
        (index_snapshot_uid,),
    ) == [(position, record["id"]) for position, record in enumerate(records)]
    assert rows(
        connection,
        """
        SELECT view_uid,snapshot_uid,payload_json
        FROM stored_views
        WHERE view_name='theory'
        """,
    ) == [(
        u("view", "theory", index_snapshot_uid),
        index_snapshot_uid,
        canon(index.get("views", {}).get("theory")),
    )]

    for path in realmeye["creatures"]:
        page_row = rows(
            connection,
            "SELECT record_uid FROM source_records WHERE record_type='realmeye_page' AND source_key=?",
            (realmeye_slug(path),),
        )
        creature_row = rows(
            connection,
            "SELECT record_uid,entity_uid FROM source_records WHERE record_type='realmeye_creature' AND source_key=?",
            (path,),
        )
        assert len(creature_row) == 1
        if page_row:
            wanted = {
                entity_uid
                for page_record_uid, entity_uid in expected_page_links
                if page_record_uid == page_row[0][0]
            }
            got = {
                entity_uid
                for (entity_uid,) in rows(
                    connection,
                    "SELECT entity_uid FROM source_record_entities WHERE record_uid=?",
                    (creature_row[0][0],),
                )
            }
            assert got == wanted
            if wanted and creature_row[0][1]:
                status = rows(
                    connection,
                    "SELECT status FROM entities WHERE entity_uid=?",
                    (creature_row[0][1],),
                )[0][0]
                assert status != "provisional"

    assert not rows(
        connection,
        "SELECT 1 FROM unresolved_links WHERE relation_type='realmeye_creature' AND source_record_uid IS NULL",
    )
    assert not rows(
        connection,
        """
        SELECT 1
        FROM unresolved_links unresolved
        JOIN source_records record ON record.record_uid=unresolved.source_record_uid
        WHERE unresolved.relation_type='realmeye_creature'
          AND record.record_type!='realmeye_creature'
        """,
    )

    biome_record = dict(rows(
        connection,
        "SELECT source_key,record_uid FROM source_records WHERE record_type='realmeye_biome'",
    ))
    creature_record = dict(rows(
        connection,
        "SELECT source_key,record_uid FROM source_records WHERE record_type='realmeye_creature'",
    ))
    expected_memberships = set()
    for biome_id, biome in sorted(realmeye.get("biomes", {}).items()):
        for role, members in sorted((biome.get("groups") or {}).items()):
            for member in members:
                path = member.get("path")
                assert biome_id in biome_record
                assert path in creature_record
                expected_memberships.add((biome_record[biome_id], creature_record[path], role))

    assert set(rows(
        connection,
        "SELECT source_record_uid,member_source_record_uid,role FROM biome_memberships",
    )) == expected_memberships
    assert rows(connection, "SELECT COUNT(*) FROM v_biome_members")[0][0] == len(
        expected_memberships
    )
    assert not rows(
        connection,
        """
        SELECT membership.membership_uid
        FROM biome_memberships membership
        LEFT JOIN source_record_relations relation
          ON relation.relation_uid=membership.source_relation_uid
        WHERE membership.source_relation_uid IS NULL
           OR relation.relation_uid IS NULL
           OR relation.from_record_uid != membership.source_record_uid
           OR relation.to_record_uid != membership.member_source_record_uid
           OR relation.relation_type != 'biome_member'
           OR relation.source_field != 'groups'
        """,
    )

    expected_manual = set()
    for path in sorted((ROOT / "data/Realm").glob("*.txt")):
        snapshot_rows = rows(
            connection,
            "SELECT snapshot_uid FROM source_snapshots WHERE relative_path=?",
            (path.relative_to(ROOT).as_posix(),),
        )
        assert len(snapshot_rows) == 1
        snapshot_uid = snapshot_rows[0][0]
        for position, rule_type, raw_text, payload_json in parse_manual_rules_independently(path):
            expected_manual.add((snapshot_uid, rule_type, position, raw_text, payload_json))

    assert set(rows(
        connection,
        "SELECT snapshot_uid,rule_type,source_position,raw_text,payload_json FROM manual_rules",
    )) == expected_manual

    for (
        snapshot_uid,
        _source_code,
        relative_path,
        stored_sha,
        stored_size,
        source_version,
        source_date,
        producer_tool,
        metadata_json,
    ) in rows(
        connection,
        """
        SELECT snapshot_uid,source_code,relative_path,sha256,size_bytes,
               source_version,source_date,producer_tool,metadata_json
        FROM source_snapshots
        """,
    ):
        metadata = json.loads(metadata_json)
        if _source_code == "client_data_index_source":
            assert relative_path == "client-data/shared-index-source"
            assert metadata.get("generated_index_source") is True
            assert metadata.get("production_index_input_dependency") is False
            assert metadata.get("source_producer") == "tools/build-index.js"
            assert source_version == metadata["from"]["build"]
            assert source_date == metadata["from"]["date"]
            assert producer_tool == "tools/build-index.js"
            assert not rows(connection, "SELECT 1 FROM raw_documents WHERE snapshot_uid=?", (snapshot_uid,))
            continue
        path = ROOT / relative_path
        assert path.exists(), relative_path
        data = path.read_bytes()
        assert stored_sha == hashlib.sha256(data).hexdigest()
        assert stored_size == len(data)

        expected_version, expected_date, expected_tool, obj = expected_snapshot_scalars(path)
        assert source_version == expected_version, relative_path
        assert source_date == expected_date, relative_path
        assert producer_tool == expected_tool, relative_path

        if isinstance(obj, dict):
            if "from" in obj:
                assert metadata.get("from") == obj["from"], relative_path
            if isinstance(obj.get("from"), dict) and "joinedClient" in obj["from"]:
                assert metadata.get("from", {}).get("joinedClient") == obj["from"]["joinedClient"]

        raw = rows(
            connection,
            """
            SELECT relative_path,format,sha256,payload
            FROM raw_documents
            WHERE snapshot_uid=?
            """,
            (snapshot_uid,),
        )
        assert len(raw) == 1
        raw_path, raw_format, raw_sha, raw_payload = raw[0]
        assert raw_path == relative_path
        assert raw_sha == stored_sha
        assert raw_format == path.suffix.lstrip(".")
        if path.suffix.lower() in {".json", ".txt", ".js", ".md"}:
            assert raw_payload == data.decode("utf-8", errors="replace")

    assert rows(
        connection,
        "SELECT COUNT(*) FROM v_entities WHERE realmeye_slug IS NOT NULL",
    )[0][0] > 0
    assert not rows(
        connection,
        """
        SELECT 1
        FROM v_entities view
        JOIN entities entity ON entity.entity_uid=view.entity_uid
        WHERE entity.status='provisional'
          AND view.display_name IS NULL
        """,
    )

    runtime_assets = rows(
        connection,
        "SELECT asset_path,media_type,sha256,size_bytes,payload "
        "FROM runtime_assets ORDER BY asset_path",
    )
    assert {row[0] for row in runtime_assets} == {
        "web/assets/index/sheet.png",
        "web/assets/theory/sheet.png",
    }
    for asset_path, media_type, stored_sha, stored_size, payload in runtime_assets:
        assert media_type == "image/png", asset_path
        payload = bytes(payload)
        assert len(payload) == stored_size, asset_path
        assert hashlib.sha256(payload).hexdigest() == stored_sha, asset_path

    current_signature = stable_signature(connection)
    assert REPORT.exists(), f"missing report: {REPORT}"
    report = json.loads(REPORT.read_text(encoding="utf-8"))
    assert report.get("stable_signature") == current_signature
    connection.close()

    with tempfile.TemporaryDirectory() as directory:
        output = Path(directory) / "rotmg-tools-check.sqlite"
        candidate = Path(directory) / "candidate-index.json"
        production_index = ROOT / "data/Index/index.json"
        hidden_index = Path(directory) / "index.json.reference"
        print("[check_sqlite] Phase 2D: rebuilding with data/Index/index.json physically unavailable...", flush=True)
        os.replace(production_index, hidden_index)
        try:
            subprocess.run(
                [sys.executable, str(BUILD), "--output", str(output)],
                cwd=ROOT,
                check=True,
            )
        finally:
            os.replace(hidden_index, production_index)
        rebuilt = sqlite3.connect(output)
        rebuilt_signature = stable_signature(rebuilt)
        rebuilt.close()
        subprocess.run(
            [sys.executable, str(EXPORT), "--db", str(output), "--output", str(candidate)],
            cwd=ROOT,
            check=True,
        )
        rebuilt_candidate = json.loads(candidate.read_text(encoding="utf-8"))
        assert rebuilt_candidate["records"] == index["records"]
        assert {
            key: value for key, value in rebuilt_candidate.items() if key != "built"
        } == {
            key: value for key, value in index.items() if key != "built"
        }

    assert rebuilt_signature == current_signature

    print(json.dumps({
        "integrity_check": "ok",
        "foreign_key_check": 0,
        "idempotence": "ok",
        "stable_signature": current_signature,
        "report_signature": report["stable_signature"],
        "rebuild_signature": rebuilt_signature,
        "production_index_input_dependency": False,
        "temporary_rebuild_without_production_index": "ok",
        "catalogues": len(expected_catalogues),
        "catalogue_sections": len(expected_sections),
        "catalogue_members": len(expected_catalogue_members),
        "browse_groups": len(expected_groups),
        "browse_memberships": len(expected_members),
        "index_contract": 1,
        "index_files": len(files),
        "index_record_order": len(records),
        "index_fold_order": len(expected_fold_orders),
        "index_folded_targets": len(expected_folded_targets),
        "index_primary_declarations": len(expected_primary_declarations),
        "index_also_order": len(expected_also_order),
        "index_record_field_order": len(expected_field_order),
        "index_record_facts": len(expected_index_facts),
        "biome_memberships": len(expected_memberships),
        "manual_rules": len(expected_manual),
    }, ensure_ascii=False))


if __name__ == "__main__":
    main()
