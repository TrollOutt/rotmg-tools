PRAGMA foreign_keys = ON;

CREATE TABLE sources (
  source_code TEXT PRIMARY KEY,
  source_type TEXT NOT NULL,
  category TEXT NOT NULL CHECK(category IN ('authoritative','observation','manual','migration','derived')),
  description TEXT NOT NULL
);
CREATE TABLE source_snapshots (
  snapshot_uid TEXT PRIMARY KEY,
  source_code TEXT NOT NULL REFERENCES sources(source_code),
  relative_path TEXT NOT NULL, sha256 TEXT NOT NULL, size_bytes INTEGER NOT NULL,
  source_version TEXT, source_date TEXT, producer_tool TEXT, imported_at TEXT NOT NULL,
  metadata_json TEXT NOT NULL, UNIQUE(source_code, relative_path, sha256)
);
CREATE TABLE raw_documents (
  document_uid TEXT PRIMARY KEY, snapshot_uid TEXT NOT NULL REFERENCES source_snapshots(snapshot_uid),
  relative_path TEXT NOT NULL, format TEXT NOT NULL, sha256 TEXT NOT NULL, payload TEXT,
  metadata_json TEXT NOT NULL
);
CREATE TABLE entities (
  entity_uid TEXT PRIMARY KEY, kind TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('normal','provisional','unresolved')),
  uid_basis TEXT NOT NULL, created_from_snapshot TEXT REFERENCES source_snapshots(snapshot_uid), legacy_index_id TEXT UNIQUE
);
CREATE TABLE source_records (
  record_uid TEXT PRIMARY KEY, snapshot_uid TEXT NOT NULL REFERENCES source_snapshots(snapshot_uid),
  record_type TEXT NOT NULL, source_key TEXT NOT NULL, entity_uid TEXT REFERENCES entities(entity_uid),
  payload_json TEXT NOT NULL, UNIQUE(snapshot_uid, record_type, source_key)
);
CREATE TABLE external_refs (
  ref_uid TEXT PRIMARY KEY, entity_uid TEXT NOT NULL REFERENCES entities(entity_uid), source_code TEXT NOT NULL REFERENCES sources(source_code),
  ref_type TEXT NOT NULL, ref_value TEXT NOT NULL, metadata_json TEXT NOT NULL,
  UNIQUE(entity_uid, source_code, ref_type, ref_value)
);
CREATE TABLE facts (
  fact_uid TEXT PRIMARY KEY, entity_uid TEXT NOT NULL REFERENCES entities(entity_uid), source_record_uid TEXT REFERENCES source_records(record_uid),
  field_path TEXT NOT NULL, value_json TEXT NOT NULL, origin_type TEXT NOT NULL CHECK(origin_type IN ('source','manual','derived','migration','observation')),
  UNIQUE(entity_uid, source_record_uid, field_path)
);
CREATE TABLE field_priority (kind TEXT NOT NULL, field_path TEXT NOT NULL, source_code TEXT NOT NULL REFERENCES sources(source_code), priority INTEGER NOT NULL, PRIMARY KEY(kind,field_path,source_code));
CREATE TABLE relations (
  relation_uid TEXT PRIMARY KEY, from_entity_uid TEXT NOT NULL REFERENCES entities(entity_uid), relation_type TEXT NOT NULL,
  to_entity_uid TEXT REFERENCES entities(entity_uid), source_record_uid TEXT REFERENCES source_records(record_uid),
  origin_type TEXT NOT NULL CHECK(origin_type IN ('source','manual','derived','migration','observation')), attributes_json TEXT NOT NULL,
  UNIQUE(from_entity_uid,relation_type,to_entity_uid,source_record_uid,attributes_json)
);
CREATE TABLE relation_evidence (
  evidence_uid TEXT PRIMARY KEY, relation_uid TEXT NOT NULL REFERENCES relations(relation_uid), snapshot_uid TEXT NOT NULL REFERENCES source_snapshots(snapshot_uid),
  evidence_type TEXT NOT NULL, evidence_key TEXT NOT NULL, payload_json TEXT NOT NULL
);
CREATE TABLE unresolved_links (
  link_uid TEXT PRIMARY KEY, source_record_uid TEXT REFERENCES source_records(record_uid), relation_type TEXT NOT NULL, target_hint TEXT NOT NULL,
  reason TEXT NOT NULL, candidates_json TEXT NOT NULL
);
CREATE TABLE browse_groups (group_uid TEXT PRIMARY KEY, representative_entity_uid TEXT NOT NULL REFERENCES entities(entity_uid), display_name TEXT NOT NULL, metadata_json TEXT NOT NULL);
CREATE TABLE browse_group_members (group_uid TEXT NOT NULL REFERENCES browse_groups(group_uid), entity_uid TEXT NOT NULL REFERENCES entities(entity_uid), is_representative INTEGER NOT NULL, reason TEXT, diff_json TEXT NOT NULL, PRIMARY KEY(group_uid,entity_uid));
CREATE TABLE catalogues (catalogue_uid TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, metadata_json TEXT NOT NULL);
CREATE TABLE catalogue_members (catalogue_uid TEXT NOT NULL REFERENCES catalogues(catalogue_uid), entity_uid TEXT REFERENCES entities(entity_uid), legacy_key TEXT NOT NULL, position INTEGER NOT NULL, payload_json TEXT NOT NULL, section TEXT NOT NULL DEFAULT 'root', PRIMARY KEY(catalogue_uid,section,position));
CREATE TABLE stored_views (view_uid TEXT PRIMARY KEY, view_name TEXT NOT NULL, snapshot_uid TEXT NOT NULL REFERENCES source_snapshots(snapshot_uid), payload_json TEXT NOT NULL, UNIQUE(view_name,snapshot_uid));
CREATE TABLE index_contract (snapshot_uid TEXT PRIMARY KEY REFERENCES source_snapshots(snapshot_uid), metadata_json TEXT NOT NULL);
CREATE TABLE index_files (snapshot_uid TEXT NOT NULL REFERENCES source_snapshots(snapshot_uid), position INTEGER NOT NULL, document TEXT NOT NULL, PRIMARY KEY(snapshot_uid,position), UNIQUE(snapshot_uid,document));
CREATE TABLE index_record_order (snapshot_uid TEXT NOT NULL REFERENCES source_snapshots(snapshot_uid), position INTEGER NOT NULL, entity_uid TEXT NOT NULL REFERENCES entities(entity_uid), PRIMARY KEY(snapshot_uid,position), UNIQUE(snapshot_uid,entity_uid));
CREATE TABLE index_primary_declarations (
  entity_uid TEXT PRIMARY KEY REFERENCES entities(entity_uid),
  source_record_uid TEXT NOT NULL UNIQUE REFERENCES source_records(record_uid),
  snapshot_uid TEXT NOT NULL,
  file_position INTEGER NOT NULL,
  public_type_json TEXT NOT NULL,
  FOREIGN KEY(snapshot_uid,file_position) REFERENCES index_files(snapshot_uid,position)
);
CREATE TABLE index_also_order (
  snapshot_uid TEXT NOT NULL,
  entity_uid TEXT NOT NULL REFERENCES entities(entity_uid),
  position INTEGER NOT NULL,
  source_record_uid TEXT NOT NULL UNIQUE REFERENCES source_records(record_uid),
  file_position INTEGER NOT NULL,
  PRIMARY KEY(snapshot_uid,entity_uid,position),
  FOREIGN KEY(snapshot_uid,file_position) REFERENCES index_files(snapshot_uid,position)
);
CREATE TABLE index_record_field_order (
  entity_uid TEXT NOT NULL REFERENCES entities(entity_uid),
  position INTEGER NOT NULL,
  field_name TEXT NOT NULL,
  PRIMARY KEY(entity_uid,position),
  UNIQUE(entity_uid,field_name)
);
CREATE TABLE index_fold_order (group_uid TEXT NOT NULL REFERENCES browse_groups(group_uid), position INTEGER NOT NULL, entity_uid TEXT NOT NULL REFERENCES entities(entity_uid), PRIMARY KEY(group_uid,position), UNIQUE(group_uid,entity_uid));
CREATE TABLE index_folded_targets (entity_uid TEXT PRIMARY KEY REFERENCES entities(entity_uid), target_group_uid TEXT NOT NULL REFERENCES browse_groups(group_uid));
CREATE TABLE realm_maps (map_uid TEXT PRIMARY KEY, snapshot_uid TEXT NOT NULL REFERENCES source_snapshots(snapshot_uid), name TEXT NOT NULL, metadata_json TEXT NOT NULL);
CREATE TABLE realm_zones (zone_uid TEXT PRIMARY KEY, map_uid TEXT NOT NULL REFERENCES realm_maps(map_uid), legacy_zone_key TEXT NOT NULL, name TEXT, ground TEXT, biome_name TEXT, tile_count INTEGER, position_json TEXT NOT NULL, rank TEXT, payload_json TEXT NOT NULL, UNIQUE(map_uid,legacy_zone_key));
CREATE TABLE realm_beacons (beacon_uid TEXT PRIMARY KEY, map_uid TEXT NOT NULL REFERENCES realm_maps(map_uid), legacy_beacon_key TEXT NOT NULL, zone_uid TEXT REFERENCES realm_zones(zone_uid), name TEXT, state TEXT, position_json TEXT NOT NULL, payload_json TEXT NOT NULL);
CREATE TABLE realm_observations (observation_uid TEXT PRIMARY KEY, snapshot_uid TEXT NOT NULL REFERENCES source_snapshots(snapshot_uid), observation_type TEXT NOT NULL, observation_key TEXT NOT NULL, payload_json TEXT NOT NULL, UNIQUE(snapshot_uid,observation_type,observation_key));
CREATE TABLE biome_memberships (membership_uid TEXT PRIMARY KEY, biome_entity_uid TEXT REFERENCES entities(entity_uid), entity_uid TEXT REFERENCES entities(entity_uid), zone_uid TEXT REFERENCES realm_zones(zone_uid), role TEXT NOT NULL, source_record_uid TEXT REFERENCES source_records(record_uid), payload_json TEXT NOT NULL);
CREATE TABLE combat_profiles (profile_uid TEXT PRIMARY KEY, snapshot_uid TEXT NOT NULL REFERENCES source_snapshots(snapshot_uid), entity_uid TEXT REFERENCES entities(entity_uid), profile_type TEXT NOT NULL, legacy_key TEXT NOT NULL, payload_json TEXT NOT NULL, UNIQUE(snapshot_uid,profile_type,legacy_key));
CREATE TABLE observed_behaviors (behavior_uid TEXT PRIMARY KEY, profile_uid TEXT REFERENCES combat_profiles(profile_uid), snapshot_uid TEXT NOT NULL REFERENCES source_snapshots(snapshot_uid), legacy_key TEXT NOT NULL, payload_json TEXT NOT NULL);
CREATE TABLE asset_refs (asset_uid TEXT PRIMARY KEY, snapshot_uid TEXT NOT NULL REFERENCES source_snapshots(snapshot_uid), entity_uid TEXT REFERENCES entities(entity_uid), asset_path TEXT NOT NULL, asset_type TEXT NOT NULL, metadata_json TEXT NOT NULL);
CREATE TABLE source_record_entities (
  record_uid TEXT NOT NULL REFERENCES source_records(record_uid), entity_uid TEXT NOT NULL REFERENCES entities(entity_uid),
  link_type TEXT NOT NULL, match_method TEXT NOT NULL, metadata_json TEXT NOT NULL,
  PRIMARY KEY(record_uid,entity_uid,link_type)
);
CREATE TABLE source_record_relations (
  relation_uid TEXT PRIMARY KEY, snapshot_uid TEXT NOT NULL REFERENCES source_snapshots(snapshot_uid),
  from_record_uid TEXT NOT NULL REFERENCES source_records(record_uid), relation_type TEXT NOT NULL,
  to_record_uid TEXT NOT NULL REFERENCES source_records(record_uid), source_field TEXT NOT NULL,
  source_position INTEGER NOT NULL, attributes_json TEXT NOT NULL,
  UNIQUE(snapshot_uid,from_record_uid,relation_type,to_record_uid,source_field,source_position)
);
CREATE TABLE source_relation_evidence (
  evidence_uid TEXT PRIMARY KEY, source_relation_uid TEXT NOT NULL REFERENCES source_record_relations(relation_uid),
  evidence_type TEXT NOT NULL, evidence_key TEXT NOT NULL, payload_json TEXT NOT NULL
);
CREATE TABLE wiki_tier_drops (
  tier_drop_uid TEXT PRIMARY KEY, snapshot_uid TEXT NOT NULL REFERENCES source_snapshots(snapshot_uid),
  enemy_page_record_uid TEXT NOT NULL REFERENCES source_records(record_uid), hand TEXT NOT NULL, tier INTEGER NOT NULL,
  alternate INTEGER NOT NULL, evidence_list_slug TEXT NOT NULL, source_position INTEGER NOT NULL, payload_json TEXT NOT NULL
);
CREATE TABLE manual_rules (
  rule_uid TEXT PRIMARY KEY, snapshot_uid TEXT NOT NULL REFERENCES source_snapshots(snapshot_uid), rule_type TEXT NOT NULL,
  source_position INTEGER NOT NULL, raw_text TEXT NOT NULL, payload_json TEXT NOT NULL,
  UNIQUE(snapshot_uid,source_position,rule_type)
);
CREATE TABLE catalogue_sections (catalogue_section_uid TEXT PRIMARY KEY, catalogue_uid TEXT NOT NULL REFERENCES catalogues(catalogue_uid), name TEXT NOT NULL, metadata_json TEXT NOT NULL, UNIQUE(catalogue_uid,name));
ALTER TABLE realm_zones ADD COLUMN source_record_uid TEXT REFERENCES source_records(record_uid);
ALTER TABLE realm_beacons ADD COLUMN source_record_uid TEXT REFERENCES source_records(record_uid);
ALTER TABLE combat_profiles ADD COLUMN source_record_uid TEXT REFERENCES source_records(record_uid);
ALTER TABLE asset_refs ADD COLUMN source_record_uid TEXT REFERENCES source_records(record_uid);
ALTER TABLE biome_memberships ADD COLUMN member_source_record_uid TEXT REFERENCES source_records(record_uid);
ALTER TABLE biome_memberships ADD COLUMN source_relation_uid TEXT REFERENCES source_record_relations(relation_uid);

CREATE INDEX idx_entities_kind ON entities(kind); CREATE INDEX idx_entities_legacy ON entities(legacy_index_id);
CREATE INDEX idx_source_records_snapshot ON source_records(snapshot_uid); CREATE INDEX idx_source_records_entity ON source_records(entity_uid); CREATE INDEX idx_source_records_key ON source_records(source_key);
CREATE INDEX idx_refs_entity ON external_refs(entity_uid); CREATE INDEX idx_refs_source_value ON external_refs(source_code,ref_value);
CREATE INDEX idx_facts_entity_path ON facts(entity_uid,field_path); CREATE INDEX idx_rel_from_type ON relations(from_entity_uid,relation_type); CREATE INDEX idx_rel_to ON relations(to_entity_uid);
CREATE INDEX idx_browse_member_entity ON browse_group_members(entity_uid); CREATE INDEX idx_biome_member_entity ON biome_memberships(entity_uid); CREATE INDEX idx_zone_map ON realm_zones(map_uid); CREATE INDEX idx_unresolved_record ON unresolved_links(source_record_uid);
CREATE INDEX idx_sre_record ON source_record_entities(record_uid); CREATE INDEX idx_sre_entity ON source_record_entities(entity_uid); CREATE INDEX idx_sre_type ON source_record_entities(link_type);
CREATE INDEX idx_srr_from ON source_record_relations(from_record_uid); CREATE INDEX idx_srr_to ON source_record_relations(to_record_uid); CREATE INDEX idx_srr_type ON source_record_relations(relation_type);
CREATE INDEX idx_tier_drop_page ON wiki_tier_drops(enemy_page_record_uid); CREATE INDEX idx_manual_rules_snapshot ON manual_rules(snapshot_uid);
CREATE INDEX idx_index_record_order_entity ON index_record_order(entity_uid); CREATE INDEX idx_index_primary_record ON index_primary_declarations(source_record_uid); CREATE INDEX idx_index_also_entity ON index_also_order(entity_uid); CREATE INDEX idx_index_field_order_entity ON index_record_field_order(entity_uid); CREATE INDEX idx_index_fold_order_entity ON index_fold_order(entity_uid);

CREATE VIEW v_index_record_labels AS
SELECT sr.record_uid,sr.entity_uid,
       MAX(CASE WHEN f.field_path='name' THEN json_extract(f.value_json,'$') END) AS name,
       MAX(CASE WHEN f.field_path='said' THEN json_extract(f.value_json,'$') END) AS said
FROM source_records sr
LEFT JOIN facts f ON f.source_record_uid=sr.record_uid AND f.field_path IN ('name','said')
WHERE sr.record_type='index_record'
GROUP BY sr.record_uid,sr.entity_uid;

CREATE VIEW v_entities AS
SELECT e.entity_uid,e.kind,e.status,e.legacy_index_id,
       COALESCE(MAX(il.said),MAX(il.name),MAX(CASE WHEN x.ref_type='display_name' THEN x.ref_value END),MAX(json_extract(rc.payload_json,'$.name')),MAX(rb.source_key),e.legacy_index_id,e.entity_uid) AS display_name,
       GROUP_CONCAT(DISTINCT CASE WHEN x.ref_type='client_id' THEN x.ref_value END) AS client_id,
       GROUP_CONCAT(DISTINCT CASE WHEN x.ref_type='realmeye_slug' THEN x.ref_value END) AS realmeye_slug,
       GROUP_CONCAT(DISTINCT bg.display_name) AS browse_group
FROM entities e
LEFT JOIN v_index_record_labels il ON il.entity_uid=e.entity_uid
LEFT JOIN external_refs x ON x.entity_uid=e.entity_uid
LEFT JOIN source_records rc ON rc.entity_uid=e.entity_uid AND rc.record_type='realmeye_creature'
LEFT JOIN source_records rb ON rb.entity_uid=e.entity_uid AND rb.record_type='realmeye_biome'
LEFT JOIN browse_group_members bm ON bm.entity_uid=e.entity_uid
LEFT JOIN browse_groups bg ON bg.group_uid=bm.group_uid
GROUP BY e.entity_uid;

CREATE VIEW v_entity_sources AS
SELECT DISTINCT e.entity_uid,e.kind,s.source_code,sr.record_type,sr.source_key,ss.relative_path AS snapshot_path
FROM entities e
JOIN (
  SELECT record_uid,entity_uid FROM source_records WHERE entity_uid IS NOT NULL
  UNION
  SELECT record_uid,entity_uid FROM source_record_entities
) l ON l.entity_uid=e.entity_uid
JOIN source_records sr ON sr.record_uid=l.record_uid
JOIN source_snapshots ss ON ss.snapshot_uid=sr.snapshot_uid
JOIN sources s ON s.source_code=ss.source_code;

CREATE VIEW v_source_comparison AS
SELECT e.entity_uid,e.kind,e.legacy_index_id,f.field_path,s.source_code,f.origin_type,f.value_json
FROM facts f
JOIN entities e ON e.entity_uid=f.entity_uid
LEFT JOIN source_records sr ON sr.record_uid=f.source_record_uid
LEFT JOIN source_snapshots ss ON ss.snapshot_uid=sr.snapshot_uid
LEFT JOIN sources s ON s.source_code=ss.source_code;

CREATE VIEW v_browse_groups AS
SELECT bg.group_uid,bg.display_name AS group_name,re.entity_uid AS representative_uid,
       COALESCE(rl.said,rl.name) AS representative_name,
       me.entity_uid AS member_uid,COALESCE(ml.said,ml.name) AS member_name,
       COALESCE(json_extract(bm.diff_json,'$.as'),ml.said,ml.name) AS member_label,
       bm.is_representative,bm.reason,bm.diff_json
FROM browse_groups bg
JOIN entities re ON re.entity_uid=bg.representative_entity_uid
LEFT JOIN v_index_record_labels rl ON rl.entity_uid=re.entity_uid
JOIN browse_group_members bm ON bm.group_uid=bg.group_uid
JOIN entities me ON me.entity_uid=bm.entity_uid
LEFT JOIN v_index_record_labels ml ON ml.entity_uid=me.entity_uid;

CREATE VIEW v_biome_members AS
SELECT br.entity_uid AS biome_uid,br.source_key AS biome_id,json_extract(br.payload_json,'$.slug') AS biome_slug,
       m.member_source_record_uid,m.entity_uid,
       COALESCE(il.name,json_extract(cr.payload_json,'$.name')) AS entity_name,m.role,s.source_code,
       CASE WHEN m.entity_uid IS NOT NULL THEN 'exact'
            WHEN (SELECT COUNT(*) FROM source_record_entities x WHERE x.record_uid=m.member_source_record_uid)>1 THEN 'multiple'
            ELSE 'unavailable' END AS resolution_status
FROM biome_memberships m
JOIN source_records br ON br.record_uid=m.source_record_uid
LEFT JOIN source_records cr ON cr.record_uid=m.member_source_record_uid
LEFT JOIN v_index_record_labels il ON il.entity_uid=m.entity_uid
LEFT JOIN source_snapshots ss ON ss.snapshot_uid=br.snapshot_uid
LEFT JOIN sources s ON s.source_code=ss.source_code;

CREATE VIEW v_realm_zones AS
SELECT rm.name AS map,rz.legacy_zone_key AS zone,rz.name,rz.ground,rz.biome_name,rz.tile_count AS tiles,rz.position_json AS position,rz.rank
FROM realm_zones rz JOIN realm_maps rm ON rm.map_uid=rz.map_uid;

CREATE VIEW v_unresolved_links AS
SELECT ul.link_uid,ss.relative_path AS snapshot_path,sr.record_type,sr.source_key,ul.relation_type,ul.target_hint,ul.reason,ul.candidates_json
FROM unresolved_links ul
LEFT JOIN source_records sr ON sr.record_uid=ul.source_record_uid
LEFT JOIN source_snapshots ss ON ss.snapshot_uid=sr.snapshot_uid;

CREATE VIEW v_realmeye_pages AS
SELECT p.record_uid AS page_record_uid,json_extract(p.payload_json,'$.legacy_page_index') AS page_index,
       p.source_key AS slug,json_extract(p.payload_json,'$.title') AS title,
       COUNT(l.entity_uid) OVER (PARTITION BY p.record_uid) AS linked_entity_count,
       l.entity_uid,e.legacy_index_id,e.kind,il.name AS display_name
FROM source_records p
LEFT JOIN source_record_entities l ON l.record_uid=p.record_uid AND l.link_type='about'
LEFT JOIN entities e ON e.entity_uid=l.entity_uid
LEFT JOIN v_index_record_labels il ON il.entity_uid=e.entity_uid
WHERE p.record_type='realmeye_page';

CREATE VIEW v_source_relations AS
SELECT r.relation_uid,r.relation_type,r.source_field,r.source_position,
       fr.source_key AS from_source_key,json_extract(fr.payload_json,'$.title') AS from_title,
       tr.source_key AS to_source_key,json_extract(tr.payload_json,'$.title') AS to_title,r.attributes_json
FROM source_record_relations r
JOIN source_records fr ON fr.record_uid=r.from_record_uid
JOIN source_records tr ON tr.record_uid=r.to_record_uid;

CREATE TABLE runtime_assets (
  asset_path TEXT PRIMARY KEY,
  snapshot_uid TEXT NOT NULL REFERENCES source_snapshots(snapshot_uid) ON DELETE CASCADE,
  media_type TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  size_bytes INTEGER NOT NULL CHECK(size_bytes >= 0),
  payload BLOB NOT NULL
);

CREATE INDEX idx_runtime_assets_snapshot
  ON runtime_assets(snapshot_uid);
