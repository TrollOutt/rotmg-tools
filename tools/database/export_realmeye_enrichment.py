from __future__ import annotations

import argparse
import hashlib
import json
import mimetypes
import os
import re
import sqlite3
import uuid
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_DB = ROOT / "data/Database/rotmg-tools.sqlite"
DEFAULT_OUTPUT = ROOT / "data/Index/realmeye-enrichment.json"
DEFAULT_SERVED = ROOT / "web/assets/index/realmeye-enrichment.json"
SPRITE_CACHE = ROOT / "web/assets/index/realmeye-sprites"
BIOME_ASSETS = ROOT / "web/assets/realm-biomes"

PROVISIONAL_RUNTIME_KIND = {
    "biome": "place",
    "realmeye_creature": "enemy",
    "realmeye_item": "item",
    "realmeye_enemy": "enemy",
    "realmeye_dungeon": "portal",
    "realmeye_set": "set",
    "realmeye_biome_page": "place",
    "realmeye_class": "class",
    "realmeye_pet": "pet",
}

# These names are already an explicit boundary in tools/biome-art.js.  Reuse
# the same meaning here instead of creating duplicate community-only records.
BIOME_NAME_TO_REALMEYE = {
    "Ancient City": "Abandoned City",
    "Coral Reef": "Coral Reefs",
}

# RealmEye's low/mid/high pages are sub-regions of a broader client/Atlas biome
# when that broader record actually exists.  Keep the source distinction in a
# scope, but publish one Index record rather than four competing biome chips.
BAND = re.compile(r"^(Low|Mid|High)\s+(.+)$", re.I)

# Beacon art exposed by RealmEye's The Realm page is broad for these families.
BIOME_ICON_FAMILY = {
    "Low Desert": "Desert",
    "Mid Desert": "Desert",
    "High Desert": "Desert",
    "Low Forest": "Forest",
    "High Forest": "Forest",
    "Mid Plains": "Plains",
    "High Plains": "Plains",
}

LOCAL_ART_TYPES = {"art", "benchArt", "benchPic", "pic", "icon"}

# These pages share the biome-page layout but are lists/mechanics, not places.
# Keep them in the archive/SQLite layer; do not pollute the Biome browse rail.
NON_BIOME_PLACE_PAGES = {"quest-monsters", "fishing", "fishing-enemies"}


BOILERPLATE_SUMMARY_PATTERNS = [
    re.compile(r"^this (?:page|article) is currently (?:a )?work in progress\.?$", re.I),
    re.compile(r"^this (?:page|article) is (?:a )?work in progress\.?$", re.I),
    re.compile(r"^(?:work in progress|under construction|stub)\.?$", re.I),
    re.compile(r"^last updated\s*:", re.I),
    re.compile(r"^this (?:biome|dungeon|enemy|item|page) currently (?:doesn['’]?t|does not) generate\b", re.I),
    re.compile(r"^this (?:biome|dungeon|enemy|item|page) is currently unavailable\b", re.I),
]

def _summary_boilerplate(text):
    value = re.sub(r"\s+", " ", str(text or "")).strip()
    if not value:
        return True
    return any(pattern.search(value) for pattern in BOILERPLATE_SUMMARY_PATTERNS)

def concise_page_intro(payload):
    """Return player-facing introductory prose, not wiki maintenance chrome.

    RealmEye section 0 also contains update tables, WIP notices and sometimes
    navigation. Prefer the actual introductory paragraphs captured by the
    archive parser and drop maintenance/status notices. Fall back to section 0
    only for older snapshots that have no paragraph records.
    """
    paragraphs = []
    for paragraph in payload.get("paragraphs", []) or []:
        try:
            order = int(paragraph.get("section_ord", 0))
        except (TypeError, ValueError):
            order = 0
        if order != 0:
            continue
        text = re.sub(r"\s+", " ", str(paragraph.get("text") or "")).strip()
        if text and not _summary_boilerplate(text):
            paragraphs.append(text)
    intro = " ".join(paragraphs).strip()

    if not intro:
        sections = payload.get("sections", []) or []
        for section in sections:
            try:
                order = int(section.get("ord", 0))
            except (TypeError, ValueError):
                order = 0
            if order == 0:
                intro = str(section.get("text") or "").strip()
                break
        if not intro:
            return ""
        intro = re.sub(r"^Last updated:\s*.*?(?:\([A-Za-z]{3,9}\s+\d{4}\)|(?=[A-Z]))\s*", "", intro, flags=re.I)
        # Strip well-known maintenance notices from a legacy section-text fallback.
        for pattern in BOILERPLATE_SUMMARY_PATTERNS:
            intro = pattern.sub("", intro).strip()

    intro = re.sub(r"\s+([,.;:!?])", r"\1", intro)
    sentences = [part.strip() for part in re.split(r"(?<=[.!?])\s+", intro) if part.strip()]
    sentences = [part for part in sentences if not _summary_boilerplate(part)]
    return " ".join(sentences[:3])[:1200].strip()



GENERATION_STATUS_PATTERNS = [
    (re.compile(r"(?:doesn['’]?t|does not)\s+generate\s+in\s+the\s+realm", re.I),
     {"code": "not-generating", "label": "Does not currently generate in the Realm"}),
    (re.compile(r"currently\s+not\s+generated\s+in\s+the\s+realm", re.I),
     {"code": "not-generating", "label": "Does not currently generate in the Realm"}),
]


def page_generation_status(payload):
    """Keep gameplay-status notices separately from the prose description.

    A WIP banner should not become a Description, but a statement such as
    "this biome currently doesn't generate in the Realm" is still useful
    structured state.  Search the normalized payload rather than one parser
    field so this also works with older archive snapshots.
    """
    text = json.dumps(payload or {}, ensure_ascii=False)
    text = re.sub(r"\\u2019", "’", text)
    for pattern, value in GENERATION_STATUS_PATTERNS:
        if pattern.search(text):
            return dict(value)
    return None


POPULATION_RELATION_TYPES = {
    "biome_regular_enemy",
    "biome_minion",
    "biome_hero",
    "biome_hero_minion",
    "biome_encounter",
    "biome_encounter_minion",
    "biome_beacon_minion",
}


def relation_identity(relation):
    return relation.get("to") or relation.get("toRealmEye") or relation.get("label") or ""


def place_population_summary(item):
    """Count the public population once, regardless of raw source categories."""
    by_role = {
        "enemies": set(),
        "heroes": set(),
        "encounters": set(),
        "guardians": set(),
    }
    for relation in item.get("relations", []) or []:
        relation_type = relation.get("type") or ""
        identity = relation_identity(relation)
        if not identity:
            continue
        if relation_type == "biome_beacon_guardian":
            by_role["guardians"].add(identity)
        elif relation_type == "biome_encounter":
            by_role["encounters"].add(identity)
        elif relation_type == "biome_hero":
            by_role["heroes"].add(identity)
        elif relation_type in POPULATION_RELATION_TYPES:
            by_role["enemies"].add(identity)
    # A thing with a more specific role should not inflate the broad enemy total.
    specific = by_role["heroes"] | by_role["encounters"] | by_role["guardians"]
    by_role["enemies"] -= specific
    return {
        "total": len(by_role["enemies"] | by_role["heroes"] | by_role["encounters"]),
        "enemies": len(by_role["enemies"]),
        "heroes": len(by_role["heroes"]),
        "encounters": len(by_role["encounters"]),
        "guardians": len(by_role["guardians"]),
    }


def exact_zone_profiles(con):
    """Small client/Atlas facts for navigable sub-biome destinations.

    Desert is a presentation aggregate.  Mid Desert and High Desert are still
    real generated zones in the walked/client data and should keep their own
    ground/tile/rank facts when opened. Low Desert currently has no generated
    zone, which is a meaningful absence rather than a reason to inherit the
    parent's population.
    """
    found = {}
    try:
        rows = con.execute(
            "SELECT name,ground,biome_name,tile_count,rank,payload_json FROM realm_zones"
        )
    except sqlite3.OperationalError:
        return found
    for row in rows:
        name = str(row["name"] or "").strip()
        if name not in {"Low Desert", "Mid Desert", "High Desert"}:
            continue
        payload = load_json(row["payload_json"], {}) or {}
        profile = {
            "ground": row["ground"] or payload.get("ground") or "",
            "tiles": row["tile_count"] or payload.get("tiles") or 0,
            "rank": row["rank"] or payload.get("rank") or "",
        }
        # Prefer the row whose actual ground is the same named desert band.
        expected_ground = name.replace(" ", "")
        score = (
            0 if str(profile["ground"]).lower() == expected_ground.lower() else 1,
            0 if str(row["biome_name"] or "").lower() in {"", "desert"} else 1,
            -int(profile["tiles"] or 0),
        )
        current = found.get(name)
        if current is None or score < current[0]:
            found[name] = (score, profile)
    return {name: profile for name, (_, profile) in found.items()}


def load_json(value, default=None):
    try:
        return json.loads(value)
    except (TypeError, json.JSONDecodeError):
        return default


def atomic_write(path: Path, data: bytes):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + ".tmp-" + uuid.uuid4().hex)
    try:
        temporary.write_bytes(data)
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def compact(value) -> bytes:
    return (json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n").encode("utf-8")


def page_summary(payload):
    """Return the clean player-facing introduction from the archived page."""
    return concise_page_intro(payload)


def preferred_source_page(pages, display_name=""):
    choices = [page for page in (pages or []) if page.get("slug")]
    if not choices:
        return None

    wanted = re.sub(r"[^a-z0-9]+", "", str(display_name or "").lower())
    def score(page):
        title = re.sub(r"[^a-z0-9]+", "", str(page.get("title") or "").lower())
        slug = str(page.get("slug") or "")
        return (
            0 if wanted and title == wanted else 1,
            0 if not page.get("scope") else 1,
            0 if not slug.endswith("-enemies") else 1,
            len(slug),
            slug,
        )
    return min(choices, key=score)


def clean_cell(cell):
    if not isinstance(cell, dict):
        return str(cell or "")
    text = str(cell.get("text") or "").strip()
    if text:
        return text
    for image in cell.get("images", []) or []:
        label = str(image.get("alt") or image.get("title") or "").strip()
        if label:
            return label
    return ""


def compact_table(value):
    if not isinstance(value, dict):
        return value
    headers = [str(x or "") for x in value.get("headers", [])]
    rows = value.get("rows", []) or []
    drop = {i for i, h in enumerate(headers) if h.strip().lower() in {"comments"}}
    out_rows = []
    for row in rows:
        cells = [clean_cell(cell) for cell in row]
        if drop:
            cells = [cell for i, cell in enumerate(cells) if i not in drop]
        out_rows.append(cells)
    out_headers = [h for i, h in enumerate(headers) if i not in drop]
    return {
        "kind": value.get("kind") or "",
        "caption": value.get("caption") or "",
        "headers": out_headers,
        "rows": out_rows,
    }


def nested_set(root, dotted, value):
    parts = dotted.split(".") if dotted else []
    here = root
    for part in parts[:-1]:
        here = here.setdefault(part, {})
    if not parts:
        return
    key = parts[-1]
    if key in here:
        current = here[key]
        if not isinstance(current, list):
            current = [current]
        if value not in current:
            current.append(value)
        here[key] = current
    else:
        here[key] = value


def page_candidates(con):
    pages = defaultdict(list)
    for row in con.execute(
        """
        SELECT link.entity_uid,page.source_key,page.payload_json
        FROM source_record_entities link
        JOIN source_records page ON page.record_uid=link.record_uid
        WHERE link.link_type='about' AND page.record_type='realmeye_archive_page'
        ORDER BY link.entity_uid,page.source_key
        """
    ):
        pages[row["entity_uid"]].append((row["source_key"], load_json(row["payload_json"], {}) or {}))
    return pages


def public_wiki_slugs(con):
    """The existing Index already says which RealmEye biome page names it.

    This is stronger than title matching and fixes the two known naming
    boundaries (Ancient/Abandoned City and Coral Reef/Reefs) without fuzzy
    matching.
    """
    found = defaultdict(set)
    for row in con.execute(
        """
        SELECT entity.legacy_index_id,fact.value_json
        FROM entities entity
        JOIN facts fact ON fact.entity_uid=entity.entity_uid
        WHERE entity.legacy_index_id IS NOT NULL
          AND entity.kind='place'
          AND fact.field_path='wiki'
        """
    ):
        slug = load_json(row["value_json"], "")
        if isinstance(slug, str) and slug:
            found[slug].add(row["legacy_index_id"])
    return {slug: next(iter(ids)) for slug, ids in found.items() if len(ids) == 1}


def runtime_entities(con: sqlite3.Connection):
    """Map semantic entities to navigable Index IDs, merging only high-confidence aliases."""
    runtime = {}
    meta = {}
    public_ids = {
        row[0] for row in con.execute(
            "SELECT legacy_index_id FROM entities WHERE legacy_index_id IS NOT NULL"
        )
    }
    public_wiki = public_wiki_slugs(con)

    for row in con.execute("SELECT entity_uid,kind,status,legacy_index_id FROM entities"):
        if row["legacy_index_id"]:
            runtime[row["entity_uid"]] = row["legacy_index_id"]
            meta[row["entity_uid"]] = {"id": row["legacy_index_id"], "communityOnly": False}

    pages = page_candidates(con)
    for row in con.execute(
        "SELECT entity_uid,kind,status,legacy_index_id FROM entities WHERE legacy_index_id IS NULL AND status='provisional'"
    ):
        kind = PROVISIONAL_RUNTIME_KIND.get(row["kind"])
        candidates = pages.get(row["entity_uid"], [])
        if not kind or not candidates:
            continue
        slug, payload = sorted(
            candidates,
            key=lambda one: (one[0].endswith("-enemies"), len(one[0]), one[0]),
        )[0]
        title = str(payload.get("title") or slug).strip()
        if kind == "place" and title.lower().endswith(" enemies"):
            title = title[: -len(" enemies")].strip()
        if not title:
            continue
        base_slug = slug[:-len("-enemies")] if slug.endswith("-enemies") else slug
        if kind == "place" and (slug in NON_BIOME_PLACE_PAGES or base_slug in NON_BIOME_PLACE_PAGES):
            continue

        natural = f"{kind}:{title}"
        rid = natural
        alias = None
        scope = None
        reason = None

        # Exact public identity wins first.
        if natural in public_ids:
            reason = "exact-public-id"
        # Then the Index's own explicit wiki slug, never a fuzzy name guess.
        elif kind == "place" and (slug[:-len("-enemies")] if slug.endswith("-enemies") else slug) in public_wiki:
            lookup_slug = slug[:-len("-enemies")] if slug.endswith("-enemies") else slug
            rid = public_wiki[lookup_slug]
            alias = title
            reason = "index-wiki-slug"
        # Finally, merge tiered sub-regions only when a broad public record
        # truly exists (today: Desert). The scope is preserved on every row.
        elif kind == "place":
            match = BAND.match(title)
            parent = f"place:{match.group(2)}" if match else None
            if parent and parent in public_ids:
                rid = parent
                alias = title
                scope = title
                reason = "band-into-public-parent"

        community_only = rid not in public_ids
        runtime[row["entity_uid"]] = rid
        entry = {
            "id": rid,
            "communityOnly": community_only,
            "source": "RealmEye",
            "mergeReason": reason or "community-only",
        }
        if community_only:
            entry.update({"kind": kind, "name": title})
        if alias and alias != rid.split(":", 1)[-1]:
            entry["searchAlias"] = alias
        if scope:
            entry["scope"] = scope
        meta[row["entity_uid"]] = entry

    return runtime, meta


def sprite_filename(url: str):
    path = urlparse(url).path
    ext = Path(path).suffix.lower()
    if ext not in {".png", ".gif", ".webp", ".jpg", ".jpeg"}:
        ext = ".png"
    return hashlib.sha256(url.encode("utf-8")).hexdigest()[:24] + ext


def cached_sprite(url: str):
    if not url:
        return None
    file = SPRITE_CACHE / sprite_filename(url)
    if not file.is_file():
        return None
    return "assets/index/realmeye-sprites/" + file.name


def biome_sprites():
    manifest = BIOME_ASSETS / "index.json"
    if not manifest.is_file():
        return {}
    data = load_json(manifest.read_text(encoding="utf-8"), {}) or {}
    out = {}
    for name, entry in (data.get("beacons") or {}).items():
        file = str((entry or {}).get("file") or "")
        if file and Path(file).name == file and (BIOME_ASSETS / file).is_file():
            out[name] = "assets/realm-biomes/" + file
    return out


def biome_sprite_for(name: str, sprites):
    realm_name = BIOME_NAME_TO_REALMEYE.get(name, name)
    realm_name = BIOME_ICON_FAMILY.get(realm_name, realm_name)
    return sprites.get(realm_name)


def flatten_biome_drop_rows(value):
    """Flatten nested_set's possible list-of-lists into semantic drop rows.

    A biome can have both its main page and an ``-enemies`` companion linked
    to the same runtime record.  Both may carry the same compact row list, and
    ``nested_set`` deliberately preserves repeated observations.  Presentation
    wants one row per item/source pairing, not the storage shape.
    """
    out = []

    def walk(node):
        if isinstance(node, dict) and "items" in node:
            items = [str(x) for x in (node.get("items") or []) if x]
            sources = [str(x) for x in (node.get("sources") or []) if x]
            if items:
                row = {"items": items, "sources": sources}
                if row not in out:
                    out.append(row)
            return
        if isinstance(node, list):
            for child in node:
                walk(child)

    walk(value)
    return out


def export(db: Path, output: Path, served: Path | None):
    if not db.exists():
        raise RuntimeError(f"database not found: {db}")
    con = sqlite3.connect(db)
    con.row_factory = sqlite3.Row

    snapshot = con.execute(
        "SELECT snapshot_uid,relative_path,sha256 FROM source_snapshots WHERE source_code='realmeye_archive' ORDER BY rowid DESC LIMIT 1"
    ).fetchone()
    archive_pages = con.execute(
        "SELECT COUNT(*) FROM source_records WHERE record_type='realmeye_archive_page'"
    ).fetchone()[0]
    runtime, entity_meta = runtime_entities(con)

    local_art_runtime = set()
    for row in con.execute(
        "SELECT DISTINCT entity_uid FROM asset_refs WHERE asset_type IN ('art','benchArt','benchPic','pic','icon')"
    ):
        rid = runtime.get(row["entity_uid"])
        if rid:
            local_art_runtime.add(rid)

    records = {}
    page_index = defaultdict(set)
    page_scope = {}
    page_runtime_count = defaultdict(int)
    aliases = defaultdict(set)
    scopes = defaultdict(set)
    scoped_facts = defaultdict(lambda: defaultdict(dict))

    for row in con.execute(
        """
        SELECT link.entity_uid,page.record_uid,page.source_key,page.payload_json
        FROM source_records page
        JOIN source_record_entities link ON link.record_uid=page.record_uid AND link.link_type='about'
        WHERE page.record_type='realmeye_archive_page'
        ORDER BY link.entity_uid,page.source_key
        """
    ):
        rid = runtime.get(row["entity_uid"])
        if not rid:
            continue
        payload = load_json(row["payload_json"], {}) or {}
        emeta = entity_meta.get(row["entity_uid"], {"id": rid, "communityOnly": False})
        base = {k: v for k, v in emeta.items() if k not in {"scope", "searchAlias", "mergeReason"}}
        item = records.setdefault(
            rid,
            {**base, "pages": [], "facts": {}, "relations": [], "images": []},
        )
        scope = emeta.get("scope")
        alias = emeta.get("searchAlias")
        if alias:
            aliases[rid].add(alias)
        if scope:
            scopes[rid].add(scope)
        page = {
            "slug": row["source_key"],
            "title": payload.get("title") or row["source_key"],
            "type": payload.get("type") or "other",
            "rawHash": payload.get("raw_hash") or "",
            "url": payload.get("url") or ("https://www.realmeye.com/wiki/" + row["source_key"]),
        }
        summary = page_summary(payload)
        if summary:
            page["summary"] = summary
        generation_status = page_generation_status(payload)
        if generation_status:
            page["generationStatus"] = generation_status
        if scope:
            page["scope"] = scope
            page_scope[row["source_key"]] = scope
        if page not in item["pages"]:
            item["pages"].append(page)
        page_index[row["source_key"]].add(rid)
        page_runtime_count[row["record_uid"]] += 1

    def resolve_page_slug(slug):
        ids = sorted(page_index.get(str(slug or ""), set()))
        if len(ids) == 1:
            return ids[0]
        public = [candidate for candidate in ids
                  if candidate in records and not records[candidate].get("communityOnly")]
        if len(public) == 1:
            return public[0]
        # A RealmEye page can answer to the plain public record plus exact
        # client working-name twins. Prefer the unique unsuffixed public
        # identity; the source page itself supplies the identity, so this is
        # deterministic and not fuzzy matching.
        plain = [candidate for candidate in public if "#" not in candidate]
        return plain[0] if len(plain) == 1 else None

    for row in con.execute(
        """
        SELECT fact.entity_uid,fact.field_path,fact.value_json
        FROM facts fact
        JOIN source_records page ON page.record_uid=fact.source_record_uid
        WHERE page.record_type='realmeye_archive_page'
          AND fact.field_path LIKE 'community.realmeye.%'
        ORDER BY fact.entity_uid,fact.field_path
        """
    ):
        rid = runtime.get(row["entity_uid"])
        if rid not in records:
            continue
        field = row["field_path"][len("community.realmeye.") :]
        value = load_json(row["value_json"], row["value_json"])
        if field.startswith("table."):
            value = compact_table(value)
        scope = entity_meta.get(row["entity_uid"], {}).get("scope")
        if scope:
            nested_set(scoped_facts[rid][scope], field, value)
        else:
            nested_set(records[rid]["facts"], field, value)

    slug_cache = {}

    def target_slug(entity_uid):
        if not entity_uid:
            return ""
        if entity_uid not in slug_cache:
            found = con.execute(
                "SELECT ref_value FROM external_refs WHERE entity_uid=? AND ref_type='realmeye_slug' ORDER BY ref_value LIMIT 1",
                (entity_uid,),
            ).fetchone()
            slug_cache[entity_uid] = found[0] if found else ""
        return slug_cache[entity_uid]

    for row in con.execute(
        """
        SELECT relation.from_entity_uid,relation.relation_type,relation.to_entity_uid,relation.attributes_json
        FROM relations relation
        WHERE json_extract(relation.attributes_json,'$.source')='realmeye_archive'
        ORDER BY relation.from_entity_uid,relation.relation_type,relation.to_entity_uid
        """
    ):
        source_id = runtime.get(row["from_entity_uid"])
        if source_id not in records:
            continue
        attrs = load_json(row["attributes_json"], {}) or {}
        relation = {"type": row["relation_type"]}
        to_id = runtime.get(row["to_entity_uid"])
        if to_id:
            relation["to"] = to_id
        slug = attrs.get("target_slug") or target_slug(row["to_entity_uid"])
        if slug:
            relation["toRealmEye"] = slug
        scope = entity_meta.get(row["from_entity_uid"], {}).get("scope")
        if scope:
            relation["scope"] = scope
        if len(relation) > 1 and relation not in records[source_id]["relations"]:
            records[source_id]["relations"].append(relation)

    # Entity relations deliberately stay conservative when a RealmEye page
    # maps to more than one exact client declaration. The page-to-page source
    # relation is still unambiguous, however, and the runtime Index can often
    # choose the unique unsuffixed public browse record. Project those source
    # relations as a presentation fallback so rich grids (biome rosters in
    # particular) do not disappear merely because an enemy has a client twin.
    for row in con.execute(
        """
        SELECT source.source_key AS source_slug, relation.relation_type,
               target.source_key AS target_slug
        FROM source_record_relations relation
        JOIN source_records source ON source.record_uid=relation.from_record_uid
        JOIN source_records target ON target.record_uid=relation.to_record_uid
        WHERE source.record_type='realmeye_archive_page'
          AND target.record_type='realmeye_archive_page'
          AND json_extract(relation.attributes_json,'$.source')='realmeye_archive'
        ORDER BY source.source_key,relation.relation_type,relation.source_position,target.source_key
        """
    ):
        source_id = resolve_page_slug(row["source_slug"])
        if source_id not in records:
            continue
        relation = {"type": row["relation_type"], "toRealmEye": row["target_slug"]}
        target_id = resolve_page_slug(row["target_slug"])
        if target_id:
            relation["to"] = target_id
        scope = page_scope.get(row["source_slug"])
        if scope:
            relation["scope"] = scope
        if relation not in records[source_id]["relations"]:
            records[source_id]["relations"].append(relation)

    for row in con.execute(
        """
        SELECT asset.entity_uid,asset.asset_path,asset.metadata_json
        FROM asset_refs asset
        WHERE asset.asset_type='realmeye_primary_image'
        ORDER BY asset.entity_uid,asset.asset_path
        """
    ):
        rid = runtime.get(row["entity_uid"])
        if rid not in records:
            continue
        meta = load_json(row["metadata_json"], {}) or {}
        image = {"source": row["asset_path"], "alt": meta.get("alt") or ""}
        scope = entity_meta.get(row["entity_uid"], {}).get("scope")
        if scope:
            image["scope"] = scope
        if image not in records[rid]["images"]:
            records[rid]["images"].append(image)

    def runtime_drop_rows(raw_rows, scope=None):
        result = []
        for row in flatten_biome_drop_rows(raw_rows):
            cooked = {"items": [], "sources": []}
            if scope:
                cooked["scope"] = scope
            for side in ("items", "sources"):
                for slug in row.get(side, []):
                    ref = {"slug": slug}
                    target = resolve_page_slug(slug)
                    if target:
                        ref["to"] = target
                    if ref not in cooked[side]:
                        cooked[side].append(ref)
            if cooked["items"] and cooked not in result:
                result.append(cooked)
        return result

    def presentation_from_facts(facts):
        presentation = {}
        for fact_key, out_key in (("summary", "summary"), ("rank", "rank"),
                                  ("recommended_level", "recommendedLevel")):
            value = facts.pop(fact_key, None)
            if isinstance(value, list) and value:
                value = value[0]
            if fact_key == "summary" and value not in (None, "", []):
                # Older imports may already contain RealmEye maintenance chrome
                # in community.realmeye.summary. Never let a stale fact outrank
                # the freshly cleaned archived page introduction. If every
                # sentence is boilerplate, drop it entirely so primary_page can
                # supply a clean summary (or leave Description absent).
                text = re.sub(r"\s+", " ", str(value)).strip()
                parts = [part.strip() for part in re.split(r"(?<=[.!?])\s+", text) if part.strip()]
                parts = [part for part in parts if not _summary_boilerplate(part)]
                value = " ".join(parts).strip()
            if value not in (None, "", []):
                presentation[out_key] = value
        for internal_key in ("page_type", "title", "slug"):
            facts.pop(internal_key, None)
        return presentation

    biome_icons = biome_sprites()
    for rid, item in list(records.items()):
        display_name = item.get("name") or rid.split(":", 1)[-1]
        if aliases[rid]:
            item["searchAliases"] = sorted(aliases[rid])
        # Drops of Interest are a relation table, not a generic fact. Preserve
        # its row semantics (item <- enemy) and resolve both sides onto Index
        # records wherever the archive/page join is unambiguous.
        drop_rows = runtime_drop_rows((item.get("facts") or {}).pop("biome_drop_rows", []))
        for scope in sorted(scopes[rid]):
            scoped = scoped_facts[rid][scope]
            drop_rows.extend(runtime_drop_rows(scoped.pop("biome_drop_rows", []), scope))
        if drop_rows:
            unique_drop_rows = []
            seen_drop_rows = set()
            for row in drop_rows:
                key = json.dumps(row, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
                if key in seen_drop_rows:
                    continue
                seen_drop_rows.add(key)
                unique_drop_rows.append(row)
            item["dropRows"] = unique_drop_rows

        if scopes[rid]:
            item["subBiomes"] = sorted(scopes[rid])
            item["aggregateBiome"] = True
            item["subBiomeData"] = {
                name: scoped_facts[rid][name] for name in sorted(scopes[rid])
            }
        if rid.startswith("place:"):
            sprite = biome_sprite_for(display_name, biome_icons)
            # A broad merged biome should use the broad beacon even though its
            # source pages are named Low/Mid/High.
            if not sprite and scopes[rid]:
                sprite = biome_sprite_for(display_name, biome_icons)
            if sprite:
                item["sprite"] = sprite
        if not item.get("sprite"):
            for image in item.get("images", []):
                sprite = cached_sprite(image.get("source") or "")
                if sprite:
                    item["sprite"] = sprite
                    break
        if not item.get("sprite") and item.get("images") and (
            item.get("communityOnly") or rid not in local_art_runtime
        ):
            item["needsSprite"] = True

        # Data-source provenance stays in SQLite/sidecar metadata, while the
        # presentation payload exposes the useful content in the same shape as
        # ordinary Index facts. The UI should not need a second "RealmEye data"
        # card just because this field came from an observation source.
        facts = item.get("facts") or {}
        presentation = presentation_from_facts(facts)
        # Entity facts intentionally stay conservative when a page maps to
        # several exact client declarations.  The source page itself is not
        # ambiguous, though: if it resolves to this public runtime record, its
        # archived introduction is still the right card description.
        source_choices = item.get("pages") or []
        if item.get("aggregateBiome"):
            source_choices = [page for page in source_choices if not page.get("scope")]
        primary_page = preferred_source_page(source_choices, display_name)
        if primary_page:
            item["sourcePage"] = {
                key: primary_page[key]
                for key in ("slug", "title", "url") if primary_page.get(key)
            }
            if len(item.get("pages") or []) > 1:
                item["sourcePageCount"] = len(item["pages"])
            if not presentation.get("summary") and primary_page.get("summary"):
                presentation["summary"] = primary_page["summary"]
        if presentation:
            item["presentation"] = presentation

    # Merged banded biomes (for example Low/Mid/High Desert) should not become
    # duplicate browse entries, but they are still meaningful destinations.
    # Publish small scope-only records so the parent card can navigate into the
    # exact source area while the browse rail keeps one broad biome.
    scope_only = {}
    zone_profiles = exact_zone_profiles(con)
    for parent_id, parent in list(records.items()):
        if not parent_id.startswith("place:"):
            continue
        names = list(parent.get("subBiomes") or [])
        if not names:
            continue
        for name in names:
            child_id = f"place:{name}"
            if child_id in records or child_id in scope_only:
                target_id = child_id
            else:
                child_facts = json.loads(json.dumps((parent.get("subBiomeData") or {}).get(name, {}), ensure_ascii=False))
                child = {
                    "communityOnly": True,
                    "scopeOnly": True,
                    "kind": "place",
                    "name": name,
                    "parentBiome": parent_id,
                    "pages": [dict(page) for page in parent.get("pages", []) if page.get("scope") == name],
                    "facts": child_facts,
                    "relations": [],
                    "images": [],
                }
                for relation in parent.get("relations", []):
                    if relation.get("scope") != name:
                        continue
                    cooked = dict(relation)
                    cooked.pop("scope", None)
                    if cooked not in child["relations"]:
                        child["relations"].append(cooked)
                child["relations"].append({"type": "part_of_biome", "to": parent_id})
                child_rows = []
                for row in parent.get("dropRows", []) or []:
                    if row.get("scope") != name:
                        continue
                    cooked = dict(row)
                    cooked.pop("scope", None)
                    if cooked not in child_rows:
                        child_rows.append(cooked)
                if child_rows:
                    child["dropRows"] = child_rows
                presentation = presentation_from_facts(child["facts"])
                primary_page = preferred_source_page(child.get("pages"), name)
                if primary_page:
                    child["sourcePage"] = {
                        key: primary_page[key]
                        for key in ("slug", "title", "url") if primary_page.get(key)
                    }
                    if not presentation.get("summary") and primary_page.get("summary"):
                        presentation["summary"] = primary_page["summary"]
                statuses = [page.get("generationStatus") for page in child.get("pages", [])
                            if page.get("generationStatus")]
                if statuses:
                    child["generationStatus"] = statuses[0]
                profile = zone_profiles.get(name)
                if profile:
                    child["clientZone"] = profile
                    if profile.get("rank") and not presentation.get("rank"):
                        presentation["rank"] = profile["rank"]
                if presentation:
                    child["presentation"] = presentation
                scoped_images = []
                for image in parent.get("images", []):
                    if image.get("scope") != name:
                        continue
                    cooked = dict(image)
                    cooked.pop("scope", None)
                    scoped_images.append(cooked)
                child["images"] = scoped_images
                sprite = biome_sprite_for(name, biome_icons)
                if sprite:
                    child["sprite"] = sprite
                if not child.get("sprite"):
                    for image in scoped_images:
                        sprite = cached_sprite(image.get("source") or "")
                        if sprite:
                            child["sprite"] = sprite
                            break
                scope_only[child_id] = child
                target_id = child_id
            relation = {"type": "contains_biome", "to": target_id}
            if relation not in parent["relations"]:
                parent["relations"].append(relation)

    records.update(scope_only)

    # Desert is one browse umbrella with three real sub-biome destinations.
    # Each destination keeps only its own scoped population/loot and receives
    # a compact count; the parent is the union, never copied back into children.
    for rid, item in records.items():
        if not rid.startswith("place:"):
            continue
        item["population"] = place_population_summary(item)
        if item.get("scopeOnly"):
            item["subBiome"] = True
    for parent_id, parent in records.items():
        names = parent.get("subBiomes") or []
        if not names:
            continue
        parent["subBiomeSummary"] = {}
        for name in names:
            child = records.get(f"place:{name}") or {}
            summary = {"id": f"place:{name}", "population": child.get("population", {"total": 0})}
            if child.get("generationStatus"):
                summary["generationStatus"] = child["generationStatus"]
            if child.get("clientZone"):
                summary["clientZone"] = child["clientZone"]
            parent["subBiomeSummary"][name] = summary

    unresolved = []
    for row in con.execute(
        "SELECT record_uid,source_key,payload_json FROM source_records WHERE record_type='realmeye_archive_page' ORDER BY source_key"
    ):
        if page_runtime_count.get(row["record_uid"], 0):
            continue
        payload = load_json(row["payload_json"], {}) or {}
        unresolved.append(
            {
                "slug": row["source_key"],
                "title": payload.get("title") or row["source_key"],
                "type": payload.get("type") or "other",
            }
        )

    for rid, item in records.items():
        item["pages"].sort(key=lambda x: (x.get("scope", ""), x["slug"]))
        item["relations"].sort(
            key=lambda x: (x.get("scope", ""), x["type"], x.get("to", ""), x.get("toRealmEye", ""))
        )
        item["images"].sort(key=lambda x: (x.get("scope", ""), x["source"], x["alt"]))
        if not item["images"]:
            item.pop("images")

    linked = sum(1 for item in records.values() if not item.get("communityOnly"))
    community_only = sum(1 for item in records.values() if item.get("communityOnly"))
    merged_aliases = sum(len(item.get("searchAliases", [])) for item in records.values())
    sprite_records = sum(bool(item.get("sprite")) for item in records.values())
    needs_sprite = sum(bool(item.get("needsSprite")) for item in records.values())
    description_records = sum(bool((item.get("presentation") or {}).get("summary")) for item in records.values())
    source_link_records = sum(bool(item.get("sourcePage")) for item in records.values())
    snapshot_hash = snapshot["sha256"] if snapshot else None
    snapshot_path = snapshot["relative_path"] if snapshot else None
    provenance = {
        "kind": "community",
        "source": "RealmEye",
        "snapshot": snapshot_hash,
        "path": snapshot_path,
        "home": "https://www.realmeye.com/wiki/",
        "historyIncluded": False,
    }
    payload = {
        "schema": 6,
        # Every tracked generated JSON under data/ must satisfy the repository's
        # provenance contract (tools/provenance.js / tools/check-artifacts.js).
        "built": datetime.now(timezone.utc).isoformat(),
        "tool": "tools/database/export_realmeye_enrichment.py",
        "from": provenance,
        # Keep the runtime-friendly source block for existing browser consumers.
        "source": {
            "name": "RealmEye",
            "historyIncluded": False,
            "snapshot": snapshot_hash,
            "path": snapshot_path,
            "home": "https://www.realmeye.com/wiki/",
        },
        "counts": {
            "archivePages": archive_pages,
            "linkedIndexRecords": linked,
            "communityOnlyRecords": community_only,
            "unresolvedPages": len(unresolved),
            "mergedAliases": merged_aliases,
            "recordsWithSprite": sprite_records,
            "recordsNeedingSprite": needs_sprite,
            "recordsWithDescription": description_records,
            "recordsWithSourcePage": source_link_records,
        },
        "records": dict(sorted(records.items())),
        "pageIndex": {slug: sorted(ids) for slug, ids in sorted(page_index.items())},
        "unresolved": unresolved,
    }
    con.close()
    data = compact(payload)
    atomic_write(output, data)
    if served is not None:
        atomic_write(served, data)
    print(json.dumps(payload["counts"], ensure_ascii=False))
    return payload


def main():
    parser = argparse.ArgumentParser(description="Publish structured RealmEye enrichment from the main SQLite Index database.")
    parser.add_argument("--db", default=str(DEFAULT_DB))
    parser.add_argument("--output", default=str(DEFAULT_OUTPUT))
    parser.add_argument("--served", default=str(DEFAULT_SERVED))
    parser.add_argument("--no-served", action="store_true")
    args = parser.parse_args()
    export(Path(args.db), Path(args.output), None if args.no_served else Path(args.served))


if __name__ == "__main__":
    main()
