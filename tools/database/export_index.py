"""Generate a non-runtime candidate Index strictly from the SQLite database."""
from __future__ import annotations

import argparse
import json
import sqlite3
from pathlib import Path

from signature import stable_signature

ROOT = Path(__file__).resolve().parents[2]


def dump(value):
    return json.dumps(value, ensure_ascii=False, indent=2) + "\n"


def public_fold(value):
    return {key: item for key, item in value.items() if key != "match_method"}


def fold_key(value):
    return json.dumps(
        public_fold(value), ensure_ascii=False, sort_keys=True, separators=(",", ":")
    )


def normalized_type(value):
    try:
        return str(int(str(value), 0))
    except ValueError:
        return str(value)


def export(db, output, report_path=None):
    con = sqlite3.connect(db)
    try:
        snapshots=con.execute("SELECT snapshot_uid FROM index_contract").fetchall()
        if len(snapshots) != 1:
            raise RuntimeError(f"SQLite must contain exactly one index_contract, found {len(snapshots)}")
        snapshot=snapshots[0][0]
        contract=json.loads(con.execute("SELECT metadata_json FROM index_contract WHERE snapshot_uid=?",(snapshot,)).fetchone()[0])
        files=[row[0] for row in con.execute("SELECT document FROM index_files WHERE snapshot_uid=? ORDER BY position",(snapshot,))]
        file_index = {name: position for position, name in enumerate(files)}
        if len(file_index) != len(files):
            raise RuntimeError("legacy Index files array contains duplicate document names")

        by_legacy = {}
        entity_to_legacy = {}
        for legacy, entity_uid, kind, record_uid, source_key in con.execute(
            """
            SELECT e.legacy_index_id,e.entity_uid,e.kind,s.record_uid,s.source_key
            FROM entities e
            JOIN source_records s ON s.entity_uid=e.entity_uid
            WHERE s.record_type='index_record'
              AND e.legacy_index_id IS NOT NULL
            """
        ):
            if legacy in by_legacy:
                raise RuntimeError(f"duplicate Index legacy id in SQLite: {legacy}")
            by_legacy[legacy] = (entity_uid, kind, record_uid, source_key)
            entity_to_legacy[entity_uid] = legacy

        groups = {}
        group_by_representative = {}
        for group_uid, representative_uid in con.execute(
            "SELECT group_uid,representative_entity_uid FROM browse_groups"
        ):
            groups[group_uid] = representative_uid
            if representative_uid in group_by_representative:
                raise RuntimeError(
                    f"entity represents multiple browse groups: {representative_uid}"
                )
            group_by_representative[representative_uid] = group_uid

        members = {}
        folded_targets = {entity:group for entity,group in con.execute("SELECT entity_uid,target_group_uid FROM index_folded_targets")}
        for group_uid, entity_uid, is_representative, reason, diff_json in con.execute(
            """
            SELECT group_uid,entity_uid,is_representative,reason,diff_json
            FROM browse_group_members
            """
        ):
            fold = json.loads(diff_json)
            if fold.get("fallback") is True:
                raise RuntimeError(
                    f"browse group {group_uid} still contains a fallback representative"
                )
            members.setdefault(group_uid, []).append(
                (entity_uid, bool(is_representative), reason, fold)
            )

        field_orders = {}
        for entity_uid, position, field_name in con.execute(
            "SELECT entity_uid,position,field_name FROM index_record_field_order ORDER BY entity_uid,position"
        ):
            field_orders.setdefault(entity_uid, []).append((position, field_name))
        facts_by_record = {}
        for record_uid, field_name, value_json in con.execute(
            """
            SELECT fact.source_record_uid,fact.field_path,fact.value_json
            FROM facts fact
            JOIN source_records source ON source.record_uid=fact.source_record_uid
            WHERE source.record_type='index_record'
            """
        ):
            facts_by_record.setdefault(record_uid, []).append((field_name, value_json))
        primary_declarations = {}
        for row in con.execute(
            "SELECT entity_uid,source_record_uid,snapshot_uid,file_position,public_type_json FROM index_primary_declarations"
        ):
            primary_declarations.setdefault(row[0], []).append(row[1:])
        also_orders = {}
        for row in con.execute(
            """
            SELECT ordering.entity_uid,ordering.position,ordering.source_record_uid,
                   ordering.file_position,source.snapshot_uid,source.entity_uid,
                   source.record_type,source.source_key
            FROM index_also_order ordering
            JOIN source_records source ON source.record_uid=ordering.source_record_uid
            WHERE ordering.snapshot_uid=?
            ORDER BY ordering.entity_uid,ordering.position
            """,
            (snapshot,),
        ):
            also_orders.setdefault(row[0], []).append(row[1:])
        also_counts = dict(con.execute(
            "SELECT entity_uid,COUNT(*) FROM source_records WHERE record_type='index_also' GROUP BY entity_uid"
        ))

        records = []
        seen = set()
        for order, entity_uid in con.execute("SELECT position,entity_uid FROM index_record_order WHERE snapshot_uid=? ORDER BY position",(snapshot,)):
            legacy=entity_to_legacy.get(entity_uid)
            if legacy is None: raise RuntimeError(f'ordered entity has no public Index id: {entity_uid}')
            if legacy in seen:
                raise RuntimeError(f"duplicate record id in legacy order snapshot: {legacy}")
            seen.add(legacy)
            if legacy not in by_legacy:
                raise RuntimeError(f"ordered Index record missing from SQLite: {legacy}")

            entity_uid, kind, record_uid, primary_key = by_legacy[legacy]
            field_rows = field_orders.get(entity_uid, [])
            if not field_rows or [position for position, _ in field_rows] != list(range(len(field_rows))):
                raise RuntimeError(f"invalid field order for {legacy}")
            field_names = [field for _, field in field_rows]
            if len(set(field_names)) != len(field_names):
                raise RuntimeError(f"duplicate public field in order for {legacy}")
            fact_rows = facts_by_record.get(record_uid, [])
            facts = {}
            for field_name, value_json in fact_rows:
                if field_name in facts:
                    raise RuntimeError(f"duplicate fact for {legacy}.{field_name}")
                facts[field_name] = json.loads(value_json)
            structural = {"id", "kind", "from", "also", "folds", "folded"}
            ordinary = set(field_names) - structural
            if set(facts) != ordinary:
                raise RuntimeError(f"ordinary facts mismatch for {legacy}: expected={sorted(ordinary)} actual={sorted(facts)}")

            primary = primary_declarations.get(entity_uid, [])
            if len(primary) != 1:
                raise RuntimeError(f"missing or duplicate primary declaration for {legacy}")
            declaration_record, declaration_snapshot, file_position, public_type_json = primary[0]
            if declaration_record != record_uid or declaration_snapshot != snapshot:
                raise RuntimeError(f"primary declaration ownership mismatch for {legacy}")
            if not 0 <= file_position < len(files):
                raise RuntimeError(f"invalid public file index for {legacy}: {file_position!r}")
            public_type = json.loads(public_type_json)
            primary_parts = primary_key.split("|")
            if len(primary_parts) < 2:
                raise RuntimeError(f"invalid normalized source key for {legacy}: {primary_key}")
            if files[file_position] != primary_parts[0]:
                raise RuntimeError(
                    f"primary document mismatch for {legacy}: "
                    f"{files[file_position]!r} != {primary_parts[0]!r}"
                )
            if normalized_type(public_type) != primary_parts[1]:
                raise RuntimeError(
                    f"primary type mismatch for {legacy}: "
                    f"{normalized_type(public_type)!r} != {primary_parts[1]!r}"
                )

            also = []
            also_rows = also_orders.get(entity_uid, [])
            if [position for position, *_ in also_rows] != list(range(len(also_rows))):
                raise RuntimeError(f"invalid also order for {legacy}")
            also_count = also_counts.get(entity_uid, 0)
            if also_count != len(also_rows):
                raise RuntimeError(f"index_also order coverage mismatch for {legacy}")
            for _position, also_record_uid, also_file_position, also_snapshot, also_entity, also_type, source_key in also_rows:
                if also_snapshot != snapshot or also_entity != entity_uid or also_type != "index_also":
                    raise RuntimeError(f"also declaration ownership mismatch for {legacy}: {also_record_uid}")
                if not 0 <= also_file_position < len(files):
                    raise RuntimeError(f"invalid also file index for {legacy}: {also_file_position}")
                document = source_key.split("|", 1)[0]
                if files[also_file_position] != document:
                    raise RuntimeError(
                        f"index_also file mismatch for {legacy}: {document}"
                    )
                also.append(also_file_position)

            # Public `folded` is explicit Phase 2B contract data. Some entities can
            # belong to multiple browse groups, so the chosen public target is stored
            # explicitly instead of being inferred from membership.
            group_uid = group_by_representative.get(entity_uid)
            folds = []
            if group_uid is not None:
                for member_uid, _is_rep, reason, fold in members.get(group_uid, []):
                    if reason != public_fold(fold).get("why"):
                        raise RuntimeError(f"normalized fold reason mismatch in group {group_uid}")
                for _,member_uid in con.execute("SELECT position,entity_uid FROM index_fold_order WHERE group_uid=? ORDER BY position",(group_uid,)):
                    matches=[public for uid,_,_,fold in members[group_uid] if uid==member_uid for public in [public_fold(fold)]]
                    if len(matches)!=1: raise RuntimeError(f'fold order cannot select member for {legacy}')
                    folds.append(matches[0])
                if len(folds)!=len(members.get(group_uid, [])):
                    raise RuntimeError(f"normalized fold count mismatch for {legacy}")

            if bool(also_rows) != ("also" in field_names):
                raise RuntimeError(f"also field presence mismatch for {legacy}")
            if (group_uid is not None) != ("folds" in field_names):
                raise RuntimeError(f"folds field presence mismatch for {legacy}")
            if (entity_uid in folded_targets) != ("folded" in field_names):
                raise RuntimeError(f"folded field presence mismatch for {legacy}")

            record = {}
            for field_name in field_names:
                if field_name == "id":
                    record[field_name] = legacy
                elif field_name == "kind":
                    record[field_name] = kind
                elif field_name == "from":
                    record[field_name] = [file_position, public_type]
                elif field_name == "also":
                    record[field_name] = also
                elif field_name == "folds":
                    if group_uid is None:
                        raise RuntimeError(f"folds declared without browse group for {legacy}")
                    record[field_name] = folds
                elif field_name == "folded":
                    target_group = folded_targets.get(entity_uid)
                    if target_group not in groups:
                        raise RuntimeError(f"invalid folded target for {legacy}")
                    target_entity = groups[target_group]
                    if target_entity not in entity_to_legacy:
                        raise RuntimeError(f"folded target lacks public id for {legacy}")
                    record[field_name] = entity_to_legacy[target_entity]
                else:
                    if field_name not in facts:
                        raise RuntimeError(f"missing ordinary fact for {legacy}.{field_name}")
                    record[field_name] = facts[field_name]

            records.append(record)

        if set(by_legacy) != seen:
            missing_from_order = sorted(set(by_legacy) - seen)
            raise RuntimeError(
                f"{len(missing_from_order)} SQLite Index records are absent from "
                f"the legacy order snapshot; first={missing_from_order[:3]}"
            )

        # Catalogue structure is rebuilt from normalized catalogue tables.
        catalogues = {}
        for catalogue_uid, name in con.execute(
            "SELECT catalogue_uid,name FROM catalogues ORDER BY name"
        ):
            sections = {}
            for (section,) in con.execute(
                """
                SELECT name
                FROM catalogue_sections
                WHERE catalogue_uid=?
                ORDER BY name
                """,
                (catalogue_uid,),
            ):
                values = [
                    json.loads(payload_json)
                    for (payload_json,) in con.execute(
                        """
                        SELECT payload_json
                        FROM catalogue_members
                        WHERE catalogue_uid=? AND section=?
                        ORDER BY position
                        """,
                        (catalogue_uid, section),
                    )
                ]
                sections[section] = values

            def restore(values):
                if values and all(
                    isinstance(value, dict) and set(value) == {"key", "value"}
                    for value in values
                ):
                    return {value["key"]: value["value"] for value in values}
                return values

            if list(sections) == ["root"]:
                catalogues[name] = restore(sections["root"])
            else:
                catalogues[name] = {
                    section: restore(values) for section, values in sections.items()
                }

        candidate=dict(contract)
        candidate["files"] = files
        candidate["records"] = records
        candidate["catalogues"] = catalogues
        candidate["views"] = {
            name: json.loads(payload)
            for name, payload in con.execute(
                "SELECT view_name,payload_json FROM stored_views ORDER BY view_name"
            )
        }

        output = Path(output)
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(dump(candidate), encoding="utf-8")

        report = {
            "database_signature": stable_signature(con),
            "candidate": str(output),
            "reference": "data/Index/index.json",
            "records": {"candidate": len(records)},
            "normalization_coverage": {
                "identity": "entities",
                "ordinary_fields": "facts",
                "field_presence_and_order": "index_record_field_order",
                "from": "index_primary_declarations + index_files",
                "also": "source_records(index_also) + index_also_order",
                "folded": "index_folded_targets",
                "folds": "browse_group_members.diff_json + index_fold_order",
                "record_order": "index_record_order",
                "root_metadata": "index_contract",
                "catalogues": "catalogues + catalogue_sections + catalogue_members",
                "views": "stored_views",
            },
            "raw_fallbacks": {},
            "raw_index_document_dependency": False,
            "index_record_payload_dependency": False,
            "status": "generated",
        }
        if report_path:
            report_path = Path(report_path)
            report_path.parent.mkdir(parents=True, exist_ok=True)
            report_path.write_text(dump(report), encoding="utf-8")
        return candidate, report
    finally:
        con.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--db", default=ROOT / "data/Database/rotmg-tools.sqlite"
    )
    parser.add_argument(
        "--output", default=ROOT / "data/Database/candidate-index.json"
    )
    parser.add_argument(
        "--report", default=ROOT / "data/Database/index-projection-report.json"
    )
    args = parser.parse_args()
    export(args.db, args.output, args.report)
