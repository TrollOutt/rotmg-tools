"""Shared deterministic SQLite logical-signature contract.

This module deliberately contains no import/matching business logic.
Both build_sqlite.py and check_sqlite.py use the same table/column contract.
"""
from __future__ import annotations

import hashlib

STABLE_SIGNATURE_TABLES = [
    ("source_snapshots", "snapshot_uid,source_code,relative_path,sha256,size_bytes,source_version,source_date,producer_tool,metadata_json"),
    ("raw_documents", "document_uid,snapshot_uid,relative_path,format,sha256,metadata_json"),
    ("entities", "entity_uid,kind,status,uid_basis,legacy_index_id"),
    ("source_records", "record_uid,snapshot_uid,record_type,source_key,entity_uid,payload_json"),
    ("source_record_entities", "record_uid,entity_uid,link_type,match_method,metadata_json"),
    ("source_record_relations", "relation_uid,from_record_uid,relation_type,to_record_uid,source_field,source_position,attributes_json"),
    ("source_relation_evidence", "evidence_uid,source_relation_uid,evidence_type,evidence_key,payload_json"),
    ("external_refs", "entity_uid,source_code,ref_type,ref_value,metadata_json"),
    ("facts", "fact_uid,entity_uid,source_record_uid,field_path,value_json,origin_type"),
    ("relations", "relation_uid,from_entity_uid,relation_type,to_entity_uid,source_record_uid,origin_type,attributes_json"),
    ("relation_evidence", "evidence_uid,relation_uid,snapshot_uid,evidence_type,evidence_key,payload_json"),
    ("field_priority", "kind,field_path,source_code,priority"),
    ("browse_groups", "group_uid,representative_entity_uid,display_name,metadata_json"),
    ("browse_group_members", "group_uid,entity_uid,is_representative,reason,diff_json"),
    ("catalogues", "catalogue_uid,name,metadata_json"),
    ("catalogue_sections", "catalogue_section_uid,catalogue_uid,name,metadata_json"),
    ("catalogue_members", "catalogue_uid,section,entity_uid,legacy_key,position,payload_json"),
    ("stored_views", "view_uid,view_name,snapshot_uid,payload_json"),
    ("index_contract", "snapshot_uid,metadata_json"),
    ("index_files", "snapshot_uid,position,document"),
    ("index_record_order", "snapshot_uid,position,entity_uid"),
    ("index_primary_declarations", "entity_uid,source_record_uid,snapshot_uid,file_position,public_type_json"),
    ("index_also_order", "snapshot_uid,entity_uid,position,source_record_uid,file_position"),
    ("index_record_field_order", "entity_uid,position,field_name"),
    ("index_fold_order", "group_uid,position,entity_uid"),
    ("index_folded_targets", "entity_uid,target_group_uid"),
    ("wiki_tier_drops", "tier_drop_uid,enemy_page_record_uid,hand,tier,alternate,evidence_list_slug,source_position,payload_json"),
    ("manual_rules", "rule_uid,snapshot_uid,rule_type,source_position,raw_text,payload_json"),
    ("realm_maps", "map_uid,snapshot_uid,name,metadata_json"),
    ("realm_observations", "observation_uid,snapshot_uid,observation_type,observation_key,payload_json"),
    ("biome_memberships", "membership_uid,biome_entity_uid,entity_uid,role,source_record_uid,member_source_record_uid,source_relation_uid,payload_json"),
    ("realm_zones", "zone_uid,map_uid,legacy_zone_key,name,ground,biome_name,tile_count,position_json,rank,payload_json,source_record_uid"),
    ("realm_beacons", "beacon_uid,map_uid,legacy_beacon_key,zone_uid,name,state,position_json,payload_json,source_record_uid"),
    ("combat_profiles", "profile_uid,snapshot_uid,entity_uid,profile_type,legacy_key,payload_json,source_record_uid"),
    ("observed_behaviors", "behavior_uid,profile_uid,snapshot_uid,legacy_key,payload_json"),
    ("asset_refs", "asset_uid,snapshot_uid,entity_uid,asset_path,asset_type,metadata_json,source_record_uid"),
    ("runtime_assets", "asset_path,snapshot_uid,media_type,sha256,size_bytes"),
    ("unresolved_links", "link_uid,source_record_uid,relation_type,target_hint,reason,candidates_json"),
]


def stable_signature(connection) -> str:
    digest = hashlib.sha256()
    for table, columns in STABLE_SIGNATURE_TABLES:
        query = f"SELECT {columns} FROM {table} ORDER BY {columns}"
        for row in connection.execute(query):
            line = table + "|" + "|".join("" if value is None else str(value) for value in row) + "\n"
            digest.update(line.encode("utf-8"))
    return digest.hexdigest()
