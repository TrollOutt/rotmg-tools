# SQLite data pipeline

SQLite is now the build-time publication authority for the Index runtime
artifacts. Browser consumers still read the existing JSON/PNG runtime contract,
but those files are published from `data/Database/rotmg-tools.sqlite` rather
than written directly by the legacy Index production path.

## Inspection note

The inspected Node pipeline builds `data/Index/index.json` from client data and
all current projections continue to read that JSON. `wiki.json` is a compact
RealmEye join/evidence snapshot, while `realmeye-data.json` is the Realm
reference used by the Atlas. `atlas.json` and `combat.json` are existing
consumer-state snapshots. `data/Realm/*.txt` supplies captured/editorial map
material. `web/realm-data.js` is not present in this checkout and is reported
as missing rather than manufactured.

```sh
python tools/database/build_sqlite.py
python tools/database/check_sqlite.py
```

The build writes a temporary database and only replaces the final database after
foreign-key and integrity checks succeed. `check_sqlite.py` also rebuilds to a
temporary location and compares a stable logical signature.

## Model and provenance

`sources` describes where a class of input comes from and `source_snapshots`
identifies each imported file by relative path, hash, size, producer metadata
and import date. `raw_documents` keeps textual input unchanged as an audit and
migration safety net. Atlas and combat are explicitly `migration` snapshots:
they are not asserted to be canonical sources.

An `entity` is a semantic candidate; a `source_record` is one declaration in
one snapshot; a `browse_group` is a presentation fold. These are intentionally
separate. Every Index record gets its own entity and legacy Index id. Entity
UIDs are UUIDv5 under a project namespace. Index declarations use
`client|kind|document|type|client-id` when all client anchors exist, otherwise
`legacy-index|kind|legacy-index-id`. Other IDs similarly use deterministic
UUIDv5 seeds. This is a Phase-1 bootstrap strategy, not a permanent matching
claim.

Biomes are logical RealmEye groupings; `realm_zones` are physical patches in a
captured/legacy Atlas map. Observations (captured/RealmEye/Atlas state) are not
rules: their source and origin type remain visible. Ambiguous joins are written
to `unresolved_links`, and unrepresented RealmEye creatures become provisional
entities rather than being fuzzy-matched.

RealmEye has two independent index spaces: `wiki.ids` points at Index records
and `wiki.pages` points at RealmEye pages. `wiki.page` is `[idIndex,pageIndex]`
and is represented by `source_record_entities`; it is intentionally
many-to-many. `drop`, `spawn`, `dungeon`, and `tierDungeon` are page-to-page
relations in `source_record_relations`; `near` is Index-record-to-page.
`source_relation_evidence` preserves dungeon section citations and
`wiki_tier_drops` preserves the tier-drop tuple. A page relation is not an
entity relation, so ambiguous page mappings never fan out into guessed entity
relations.

Folding is browse presentation, never entity identity. The importer first
resolves a fold by exact client document/type, then uses `was` only to break a
remaining exact collision. `manual_rules` contains only the explicitly parsed
forms consumed by the Realm tools, while every manual file also remains raw.

## Main tables and DB Browser views

The core tables are `entities`, `source_records`, `external_refs`, `facts`,
`relations`, `relation_evidence`, `browse_groups`, `catalogues`, and
`stored_views`. Realm and simulation tables are `realm_maps`, `realm_zones`,
`realm_beacons`, `biome_memberships`, `combat_profiles`, and
`observed_behaviors`.

Use `v_entities`, `v_entity_sources`, `v_source_comparison`,
`v_browse_groups`, `v_biome_members`, `v_realm_zones`, and
`v_unresolved_links` for inspection in DB Browser for SQLite.

## Phase-1 limits and next step

A SQLite-to-JSON ghost projection now exists, but there is still no runtime
SQLite consumer, no ORM, and no automatic fuzzy reconciliation. Manual Realm
files are retained as snapshots; generated `web/realm-data.js` is recorded as
missing when it is absent. Phase 2B makes the Index projection independent of
the raw `data/Index/index.json` document stored in SQLite; runtime consumers
remain unchanged.

## Generated SQLite database

`data/Database/rotmg-tools.sqlite` and `data/Database/import-report.json` are generated outputs. Do not correct the SQLite file manually in DB Browser or with ad-hoc `UPDATE` / `INSERT` / `DELETE` statements: those changes would disappear on the next rebuild.

The correction workflow is:

```bash
python tools/database/build_sqlite.py
python tools/database/check_sqlite.py
python tools/database/export_index.py
python tools/database/check_index_projection.py
npm test
```

Fix the actual source data, schema, or importer first, then rebuild. `build_sqlite.py` is the Phase 1 database builder and `check_sqlite.py` is its non-regression contract. Both use `tools/database/signature.py` for the same deterministic logical-signature definition; non-deterministic import timestamps are intentionally excluded.

## Phase 2A ghost projection

`export_index.py` writes `data/Database/candidate-index.json` from SQLite only;
it never opens the production `data/Index/index.json`. Secondary declarations,
folds, catalogues, and Theory view come from normalized SQLite tables. The
legacy root metadata, file-index table, and record order were initially
retained as an explicitly reported SQLite raw-snapshot fallback. The checker
compares the candidate with production but never replaces it.

Phase 2B moves those remaining public-contract pieces into `index_contract`,
`index_files`, `index_record_order`, `index_fold_order`, and
`index_folded_targets`. The ghost exporter no longer reads the raw Index
document; its checker proves this by exporting from a temporary DB whose raw
Index payload has been neutralized.

Phase 2C stores each remaining public record field in `facts`, preserves
presence and key order in `index_record_field_order`, retains the exact primary
declaration in `index_primary_declarations`, and retains `also` ordering in
`index_also_order`. The candidate exporter does not read Index-record
`payload_json`; its checker proves this after deleting the raw Index document
and replacing every Index-record payload with `{}` in a temporary database. Index-facing
inspection labels now read `name`/`said` from `facts`; the projection checker also proves
`v_entities`, `v_browse_groups`, `v_biome_members`, and `v_realmeye_pages` are unchanged
after those payloads are neutralized.

Phase 2D builds SQLite from a temporary, deterministic Index source produced
by the same `tools/build-index.js` client-data logic as the production writer.
It does not require `data/Index/index.json`; that file remains a migration
reference and runtime input only. Runtime consumers remain unchanged.

## Phase 2E SQLite publication rehearsal

`publish_index.py` turns the normalized SQLite Index projection into the three
runtime publication artifacts currently owned by `tools/build-index.js`:
`data/Index/index.json`, `data/Index/search.json`, and the byte-identical served
copy `web/assets/index/index.json`.

Phase 2E is still a rehearsal: `check_index_publication.py` publishes only into
temporary roots and verifies that the real runtime files are unchanged. The
publisher refuses to target the repository root unless `--allow-production` is
given explicitly.

The publication check requires semantic parity with the historical Index and
search files, allowing only the already documented Phase 2D `built` difference.
It also executes the publisher from a sandbox containing no production
`data/Index/index.json`, proving that publication consumes SQLite rather than
the legacy runtime file.

The SQLite exporter remains the semantic reconstruction layer. The publisher
only owns runtime serialization, the compact search projection, atomic writes,
and the served byte-for-byte copy. Phase 2F can switch the production scrape
pipeline only after this rehearsal remains green.

## Phase 2F complete client source

Phase 2D proved that SQLite can be rebuilt without the production Index, and
Phase 2E proved that SQLite can reproduce the runtime Index publication.

Before switching the production pipeline, the client extraction contract must
also be complete. SQLite source mode reconstructs artwork independently, so it
requires not only the XML documents written by `tools/extract-client.js`, but
also `spritesheet.bin` and the packed texture sheets written by
`tools/extract-client-textures.js`.

`npm run extract-client-data` now runs both extractors. During Phase 2F,
`npm run scrape` uses this complete extraction but deliberately continues to
call the legacy production `tools/build-index.js`; runtime authority is not
switched in this phase.

`check_client_source.py` verifies the complete source contract. Phase 2G may
replace the direct `build-index.js` production step with SQLite build +
publication only after this contract and the Phase 2E publication rehearsal
remain green.

## Phase 2G runtime cutover

The production Index publication path is SQLite-owned.

`npm run scrape` now performs:

1. complete client extraction,
2. client-source validation,
3. deterministic SQLite rebuild,
4. SQLite publication of the runtime Index and sheets,
5. the existing downstream data projections,
6. the installed-client change snapshot/news pass.

`tools/build-index.js` remains the shared upstream model constructor through
`--sqlite-source`; it is no longer invoked by `scrape` as the production Index
writer.

SQLite publishes these runtime artifacts:

- `data/Index/index.json`
- `data/Index/search.json`
- `web/assets/index/index.json`
- `web/assets/index/sheet.png`
- `web/assets/theory/sheet.png`

The PNG payloads are stored in `runtime_assets` with SHA-256 metadata, so the
art coordinates and their exact sheet bytes are rebuilt and published as one
contract.

`check_runtime_publication.py` proves that the database alone can reproduce
all five artifacts from a sandbox containing neither the production Index nor
`client-data`.
