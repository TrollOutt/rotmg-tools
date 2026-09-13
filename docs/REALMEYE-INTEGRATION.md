# RealmEye full data integration

This integration keeps the installed RotMG client authoritative for client-declared data and uses the complete local RealmEye archive as an observation/enrichment source. Historical/update pages and history sections remain excluded from the Index enrichment.

## Data flow

```text
RealmEye HTML archive
  -> tools/index-realmeye-archive.py
  -> local/realmeye-monitor/processed/realmeye.sqlite
  -> tools/database/build_sqlite.py
  -> data/Database/rotmg-tools.sqlite
  -> tools/database/export_realmeye_enrichment.py
  -> data/Index/realmeye-enrichment.json
  -> web/assets/index/realmeye-enrichment.json
  -> docs/assets/index/realmeye-enrichment.json (during npm run build)
```

`local/realmeye-monitor/` remains local/untracked. The raw HTML is never discarded, so extractors can be improved and the archive reprocessed without scraping RealmEye again.

## What is imported

The normalized archive contributes structured facts and exact relations for items, enemies, dungeons, sets, classes and biomes. Examples include acquisition/drop sources, Forge/Dust/Feed Power, Soulbound, item stats, set membership/bonuses, enemy attacks, dungeon roles, biome populations and biome Drops of Interest.

Entity-to-entity relations are created only when both ends resolve deterministically. There is no fuzzy name matching.

## Biome parser / presentation (v6)

Parser version 3 fixes two important RealmEye layout cases:

- roster grids (Regular Enemies, Heroes of Oryx, minions, encounters, beacon guardians) are read as relations, not accidental key/value facts;
- the site-wide `Biomes of the Realm` navigation table is discarded from the processed view, so labels such as `HIGH`, `LOW`, `MAIN`, `MID` do not leak into a biome card.

The raw HTML remains unchanged.

Biome intros are normalized into a short summary. When present, the biome rank (`Rookie`, `Adept`, `Veteran`) and recommended player level are promoted into the normal Index card presentation.

The UI no longer stacks separate client/RealmEye panels for a biome. It renders one coherent card:

```text
biome
  summary / rank / recommended level
  Enemies
    regular enemies
    Heroes of Oryx
    hero minions
    encounters
    encounter minions
    beacon guardian / minions
  Loot
    tiered loot
    untiered gear / set-tier gear
    Drops of Interest (item <- exact source enemies)
    dungeon entrances
```

Every resolved target is an internal Index button with the target's sprite. RealmEye is used as an external fallback only when the target truly cannot be resolved locally.

The row structure of `Drops of Interest` is preserved, so an item can be shown with the enemy or guardian RealmEye lists as its source instead of losing that association in a flat item list.

## High-confidence runtime merges

The archive layer keeps distinct pages. Runtime publication merges only deterministic identities:

- exact public `kind:name` identity;
- an explicit RealmEye/wiki slug already owned by a public Index biome (`Abandoned City` -> `Ancient City`, `Coral Reefs` -> `Coral Reef`);
- Low/Mid/High biome bands into an already-existing public broad parent when that parent is the Index identity (`Low Desert`, `Mid Desert`, `High Desert` -> `Desert`).

The source scope remains attached to the imported relations/facts, and the sub-biome names remain search aliases. No fuzzy merge is used.

Pages that merely look like biome pages but are actually list/mechanics pages (for example `Quest Monsters` and `Fishing`) remain searchable in the archive but are not published as Biome browse records.

## Sprites

Runtime artwork priority is:

1. existing client/Index artwork;
2. locally imported RealmEye biome beacon artwork under `web/assets/realm-biomes/`;
3. an exact RealmEye primary image cached under `web/assets/index/realmeye-sprites/`.

`npm run wiki-publish` exports once, downloads only missing sprite candidates, then exports again with local paths. The browser does not hotlink RealmEye images.

## History exclusion

Pages classified as `update-history`, history/change/release sections, legacy-version markers and similar historical fields are deliberately excluded. The raw archive still contains them for a later feature if desired.

## Commands

Full integration and publication:

```bash
npm run wiki-integrate
```

After the monitor is installed, end-to-end refresh:

```bash
npm run wiki-refresh
```

Search the exhaustive local archive:

```bash
npm run wiki-query -- search '"armor broken"'
npm run wiki-query -- fact "Drops From" --contains "Void Entity"
npm run wiki-query -- page bow-of-the-void
```

`wiki-integrate` runs archive indexing, authoritative SQLite rebuild, Index publication, RealmEye enrichment/sprite publication, integrity checks, sprite audit and the standalone build.

Parser v3 causes one intentional full archive reparse on the first run after this upgrade. Later runs return to incremental processing based on page hashes.

## Parallel RealmEye indexing

`tools/index-realmeye-archive.py` parallelizes the expensive archive work during
large reparses. Gzip reads, HTML/lxml parsing and fact extraction run in a
bounded `ProcessPoolExecutor`; SQLite remains single-writer in the parent
process to avoid lock contention.

By default `--workers 0` selects up to 8 worker processes. Small incremental
runs with fewer than 100 pages stay serial because process startup would cost
more than it saves. Override explicitly with e.g. `--workers 4` or use
`--workers 1` for debugging.

Parser upgrades are resumable. If a full parser-version upgrade is interrupted,
page rows committed after the previous completed catalog are reused on restart
when their raw HTML hash is unchanged. The next run prints `resume upgrade: N
pages already reparsed`.

## Fast archive parser (v6-fast)

Full parser-version rebuilds are optimized for multi-core CPUs. The indexer now:

- parses HTML in up to 8 worker processes by default;
- sends pages to workers in batches to reduce Windows multiprocessing overhead;
- performs table/fact classification and JSON serialization inside the workers;
- batches SQLite writes on the parent process;
- defers FTS5 maintenance during full rebuilds and rebuilds FTS once in bulk;
- uses a single DOM walk rather than annotating every HTML node and rescanning it several times;
- preserves interrupted parser-upgrade resume state.

The normalized output is intentionally unchanged; these are execution-path optimizations only.
On the supplied 6,691-page archive, the optimized indexer completed a full v3 rebuild in about 10 seconds in the validation environment with 8 workers. Actual Windows timing depends on storage, antivirus scanning and CPU scheduling.

Use the automatic setting:

```bash
npm run wiki-index
```

Or force the physical-core count explicitly:

```bash
python tools/index-realmeye-archive.py --workers 8
```

`--workers 1` keeps the serial path for diagnostics.


## V7 presentation policy

Biome cards now choose one presentation role per linked entity. The visible population is limited to Enemies, Heroes of Oryx and Encounters; beacon guardians move beside the biome title. Minion-specific source categories are preserved in SQLite but collapse into Enemies in the UI. Loot entities are deduplicated across notable/set-tier/untiered observations, and drop-source monsters are kept as hover evidence instead of being repeated inside Loot. Sub-biome scope remains stored but is no longer repeated as a badge after every chip.

## V8 presentation/navigation polish

- Relationship chips hide a trailing working-name suffix such as `(New)`, while the opened record keeps its exact name and duplicate/same-name diagnostics.
- Merged Low/Mid/High biome bands remain absent from the main browse rail but are exported as `scopeOnly` navigation records, so Sub-biomes are clickable and open their scoped data.
- Consecutive tier lists are compacted (`T3, T4, T5` -> `T3–T5`; `T7..T11` -> `T7–T11`).
- RealmEye intro prose is imported for enemy pages as well as biome/dungeon pages and appears in a collapsed Description panel.
- Description is collapsed by default; Population, Loot, Sub-biomes and generic Details panels are individually collapsible and start open.

## V9 - source links and descriptions

The complete archive is now the primary authority for whether an Index record has a RealmEye page. The old `wiki.json` join remains only as a fallback.

`wiki-publish` derives a concise description directly from archived section 0 for every useful domain page. This export-time fallback is deliberate: a page can map to several exact client declarations, which should prevent an unsafe semantic merge but should not hide the page's introduction from the public Index record.

Every runtime record with an archived page receives `sourcePage`; the Index shows a small `RealmEye ↗` source link on biomes as well as other records. Descriptions stay in the normal collapsed `Description` section and are not branded as a separate RealmEye UI block.

The SQLite importer also stores `community.realmeye.summary` for item, enemy, dungeon, set, biome, class and pet pages on future database rebuilds.


## V10 description quality

Runtime descriptions now come from section-0 prose paragraphs rather than the whole section text. RealmEye maintenance chrome such as `Last updated`, `work in progress`, and temporary generation-status notices is excluded from player-facing descriptions. Pages with no genuine descriptive prose simply omit the Description box; the source link remains available.

## V11 — Desert aggregate and real sub-biomes

`Desert` is a browse umbrella. `Low Desert`, `Mid Desert`, and `High Desert`
remain distinct internal destinations with their own scoped population, loot,
source page, and (when present in the walked/client data) ground/tile/rank facts.
The parent is the union and is never copied back into a child.

Each sub-biome now carries a population count. The parent card shows those
counts on the three sub-biome buttons. A zero population is kept as zero rather
than silently inheriting the broad Desert roster. RealmEye currently marks Low
Desert as not generating in the Realm; when that status exists in the archived
page it is shown as status, not as a Description.

V11 also fixes the V10 integration checker regression where the sidecar was
referenced through an undefined `records` variable.


## v13 - generated artifact provenance

`data/Index/realmeye-enrichment.json` now carries the repository-standard
`built`, `tool`, and `from.kind` provenance fields. This makes the generated
RealmEye runtime projection pass `tools/check-artifacts.js` without changing
the browser-facing `source` block.
