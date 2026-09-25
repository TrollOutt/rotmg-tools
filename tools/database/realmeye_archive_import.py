from __future__ import annotations

import json
import re
import sqlite3
import uuid
from collections import defaultdict
from pathlib import Path
from urllib.parse import urljoin

NAMESPACE = uuid.UUID("2a20c00e-0d71-5eb3-85f9-5d66c9a52768")
HOST = "https://www.realmeye.com"

HISTORY_PAGE_TYPES = {"update-history"}
HISTORY_FACT_KEYS = {
    "released", "release", "legacy version", "legacy version of",
    "last updated", "version", "date",
}
HISTORY_HEADING_WORDS = (
    "history", "historical", "release history", "changes", "change log",
    "changelog", "fixes", "quality of life", "added content",
)
DOMAIN_PAGE_TYPES = {"item", "enemy", "dungeon", "set", "biome", "class", "pet"}
PROVISIONAL_KIND = {
    "item": "realmeye_item", "enemy": "realmeye_enemy",
    "dungeon": "realmeye_dungeon", "set": "realmeye_set",
    "biome": "realmeye_biome_page", "class": "realmeye_class",
    "pet": "realmeye_pet",
}
FACT_RELATIONS = {
    "drops from": "dropped_by",
    "obtained through": "obtained_through",
    "reskin of": "reskin_of",
    "reskin(s)": "has_reskin",
    "spawns": "spawns",
    "spawns from": "spawned_by",
    "class": "class",
}
DUNGEON_HEADINGS = {
    "boss": "dungeon_boss", "bosses": "dungeon_boss",
    "final boss": "dungeon_boss", "miniboss": "dungeon_miniboss",
    "minibosses": "dungeon_miniboss", "boss minions": "dungeon_boss_minion",
    "minions": "dungeon_minion", "enemies": "dungeon_enemy",
    "treasure room boss": "dungeon_treasure_boss",
    "environmental hazards": "dungeon_hazard",
    "drops of interest": "dungeon_drop_interest",
}
BIOME_HEADINGS = {
    "monsters": "biome_regular_enemy",
    "regular enemies": "biome_regular_enemy",
    "minions": "biome_minion",
    "heroes of oryx": "biome_hero",
    "heroes of oryx minions": "biome_hero_minion",
    "encounters": "biome_encounter",
    "realm encounters": "biome_encounter",
    "encounter minions": "biome_encounter_minion",
    "beacon guardian": "biome_beacon_guardian",
    "beacon guardians": "biome_beacon_guardian",
    "beacon guardian minions": "biome_beacon_minion",
}
BIOME_DROP_HEADINGS = {"drops of interest"}
INDEX_KIND_FOR_PAGE = {
    "biome": {"place"},
    "dungeon": {"portal"},
    "set": {"set"},
    "class": {"class"},
    "enemy": {"enemy"},
    "item": {"item"},
}


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


def uid(*parts) -> str:
    return str(uuid.uuid5(NAMESPACE, "\x1f".join(map(str, parts))))


def canon(value) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def json_load(value, default):
    if value is None:
        return default
    try:
        return json.loads(value)
    except (TypeError, json.JSONDecodeError):
        return default


def slug_of(value: str | None) -> str:
    value = str(value or "").strip()
    value = re.sub(r"^https?://(?:www\.)?realmeye\.com/wiki/", "", value, flags=re.I)
    value = re.sub(r"^/wiki/", "", value, flags=re.I)
    return value.split("#", 1)[0].split("?", 1)[0].strip("/")


def field_key(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", str(value).lower()).strip("_") or "value"


def name_key(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", str(value).lower())


def is_history_heading(heading: str, path: str = "") -> bool:
    text = (str(heading) + " " + str(path)).lower()
    return any(word in text for word in HISTORY_HEADING_WORDS)


def is_history_fact(key: str) -> bool:
    lowered = re.sub(r"\s+", " ", str(key).strip().lower())
    return (lowered in HISTORY_FACT_KEYS or lowered.startswith("released ") or lowered.startswith("history ") or " before release" in lowered)


def _preload(source: sqlite3.Connection):
    pages = [dict(row) for row in source.execute("SELECT * FROM pages ORDER BY slug")]
    page_type = {row["slug"]: row["type_guess"] for row in pages}
    url_to_slug = {row["url"]: row["slug"] for row in pages}

    sections = defaultdict(list)
    allowed_section = defaultdict(set)
    section_name = {}
    for row in source.execute("SELECT page_url,ord,level,heading,heading_id,path,text FROM sections ORDER BY page_url,ord"):
        page_url, order, level, heading, heading_id, path, text = row
        heading = heading or ""; path = path or ""; text = text or ""
        if order != 0 and is_history_heading(heading, path):
            continue
        obj = {"ord": order, "level": level, "heading": heading, "heading_id": heading_id or "", "path": path, "text": text}
        sections[page_url].append(obj)
        allowed_section[page_url].add(order)
        section_name[(page_url, order)] = (heading, path)

    facts = defaultdict(list)
    for row in source.execute("SELECT page_url,section_ord,key,value,source,table_ord,row_ord,links_json FROM facts ORDER BY page_url,id"):
        page_url, section_ord, key, value, source_kind, table_ord, row_ord, links_json = row
        if section_ord not in allowed_section.get(page_url, {0}) or is_history_fact(key):
            continue
        heading, path = section_name.get((page_url, section_ord), ("", ""))
        links = []
        for link in json_load(links_json, []):
            target = slug_of(link.get("href"))
            if target.startswith("release-history-"):
                continue
            links.append(link)
        facts[page_url].append({
            "section_ord": section_ord, "section": heading, "section_path": path,
            "key": key, "value": value, "source": source_kind,
            "table_ord": table_ord, "row_ord": row_ord, "links": links,
        })

    # Only tables that add material not already represented by key/value facts:
    # enemy attack matrices and class stat matrices. Set piece tables are read
    # separately to make relations but are not copied wholesale into the Index DB.
    structured_tables = defaultdict(list)
    set_piece_targets = defaultdict(list)
    table_semantic_links = defaultdict(list)
    biome_drop_rows = defaultdict(list)
    title_by_url = {row["url"]: row["title"] for row in pages}
    for row in source.execute("SELECT page_url,ord,section_ord,kind,caption,headers_json,rows_json FROM tables_data ORDER BY page_url,ord"):
        page_url, order, section_ord, kind, caption, headers_json, rows_json = row
        if section_ord not in allowed_section.get(page_url, {0}) or kind == "update-marker":
            continue
        slug = url_to_slug.get(page_url, "")
        typ = page_type.get(slug, "")
        heading, path = section_name.get((page_url, section_ord), ("", ""))
        headers = json_load(headers_json, [])
        rows = json_load(rows_json, [])

        # Relationship grids are much more reliable when read from the table
        # cells themselves. A biome roster can be a 4-column image grid and
        # a one-row Heroes grid can look like a key/value table by accident.
        # Preserve every link here; semantic_section_relation() later keeps
        # only targets of the appropriate entity kind (enemy/item/etc.).
        low_heading = heading.strip().lower()
        semantic_grid = False
        if typ == "biome":
            semantic_grid = low_heading in (set(BIOME_HEADINGS) | BIOME_DROP_HEADINGS)
        elif typ == "dungeon":
            semantic_grid = low_heading in DUNGEON_HEADINGS or "enemies" in low_heading or "hazard" in low_heading
        if semantic_grid:
            for table_row in rows if isinstance(rows, list) else []:
                for cell in table_row if isinstance(table_row, list) else []:
                    if not isinstance(cell, dict):
                        continue
                    for link in cell.get("links", []) or []:
                        target = slug_of(link.get("href"))
                        if not target or target.startswith("release-history-"):
                            continue
                        table_semantic_links[slug].append({
                            "section_ord": section_ord, "section": heading, "section_path": path,
                            "href": link.get("href") or "", "target_slug": target,
                            "anchor": link.get("anchor") or "",
                        })

        # Keep the row-level meaning of biome Drops of Interest: not just which
        # items are notable, but which enemies on this biome page are shown as
        # dropping them. This is compact and lets the Index render the table
        # locally with internal entity links instead of sending the reader out.
        if typ == "biome" and low_heading in BIOME_DROP_HEADINGS:
            for table_row in rows if isinstance(rows, list) else []:
                if not isinstance(table_row, list) or len(table_row) < 2:
                    continue
                def cell_targets(cell):
                    found = []
                    if not isinstance(cell, dict):
                        return found
                    for link in cell.get("links", []) or []:
                        target = slug_of(link.get("href"))
                        if target and target not in found:
                            found.append(target)
                    return found
                items = [target for target in cell_targets(table_row[0])
                         if page_type.get(target) == "item"]
                sources = []
                for cell in table_row[1:]:
                    for target in cell_targets(cell):
                        if page_type.get(target) == "enemy" and target not in sources:
                            sources.append(target)
                if not items:
                    continue
                row_value = {"items": items, "sources": sources}
                if row_value not in biome_drop_rows[slug]:
                    biome_drop_rows[slug].append(row_value)
        if typ == "set" and len(headers) == 1 and name_key(headers[0]) == name_key(title_by_url.get(page_url, "")):
            for table_row in rows[1:]:
                for cell in table_row if isinstance(table_row, list) else []:
                    if not isinstance(cell, dict):
                        continue
                    for link in cell.get("links", []):
                        target = slug_of(link.get("href"))
                        if target and target != slug and target not in set_piece_targets[slug]:
                            set_piece_targets[slug].append(target)
        wanted = False
        if typ == "enemy" and ("attack" in heading.lower() or "attack" in path.lower()):
            wanted = True
        elif typ == "class" and kind == "matrix" and ("stats" in heading.lower() or "stats" in path.lower()):
            wanted = True
        if wanted:
            sanitized = []
            for table_row in rows:
                first = ""
                if table_row and isinstance(table_row[0], dict):
                    first = str(table_row[0].get("text") or "")
                if is_history_fact(first) or first.strip().lower().startswith("last updated"):
                    continue
                sanitized.append(table_row)
            if sanitized:
                structured_tables[page_url].append({
                    "ord": order, "section_ord": section_ord, "section": heading,
                    "section_path": path, "kind": kind, "caption": caption or "",
                    "headers": headers, "rows": sanitized,
                })

    semantic_links = table_semantic_links
    for row in source.execute("SELECT page_url,section_ord,href,target_url,target_slug,anchor FROM links ORDER BY page_url,id"):
        page_url, section_ord, href, target_url, target_slug, anchor = row
        slug = url_to_slug.get(page_url, "")
        typ = page_type.get(slug, "")
        if typ not in {"dungeon", "biome"} or section_ord not in allowed_section.get(page_url, {0}):
            continue
        heading, path = section_name.get((page_url, section_ord), ("", ""))
        if typ == "dungeon":
            low = heading.strip().lower()
            if low not in DUNGEON_HEADINGS and "enemies" not in low and "hazard" not in low:
                continue
        elif typ == "biome" and heading.strip().lower() not in (set(BIOME_HEADINGS) | BIOME_DROP_HEADINGS):
            continue
        target = slug_of(target_slug or target_url or href)
        if not target or target.startswith("release-history-"):
            continue
        semantic_links[slug].append({
            "section_ord": section_ord, "section": heading, "section_path": path,
            "href": href, "target_slug": target, "anchor": anchor or "",
        })

    # The table walk and generic link walk intentionally overlap. Collapse the
    # duplicate evidence now so full-site imports do not do every roster edge
    # twice. Section + target is the semantic identity here.
    for slug, links in list(semantic_links.items()):
        unique = []
        seen_links = set()
        for link in links:
            key = (link.get("section_ord"), link.get("target_slug"))
            if key in seen_links:
                continue
            seen_links.add(key)
            unique.append(link)
        semantic_links[slug] = unique

    exact_images = defaultdict(list)
    wanted_title = {url: name_key(title) for url, title in title_by_url.items()}
    for page_url, section_ord, src, alt, title in source.execute("SELECT page_url,section_ord,src,alt,title FROM images ORDER BY page_url,id"):
        if section_ord not in allowed_section.get(page_url, {0}):
            continue
        label = alt or title or ""
        if src and wanted_title.get(page_url) and name_key(label) == wanted_title[page_url]:
            item = {"src": src, "url": urljoin(HOST, src), "alt": alt or "", "title": title or "", "section_ord": section_ord}
            if item["url"] not in {x["url"] for x in exact_images[page_url]}:
                exact_images[page_url].append(item)

    return {
        "pages": pages,
        "page_type": page_type,
        "sections": sections,
        "facts": facts,
        "tables": structured_tables,
        "set_pieces": set_piece_targets,
        "semantic_links": semantic_links,
        "biome_drop_rows": biome_drop_rows,
        "images": exact_images,
    }


def current_entity_candidates(con: sqlite3.Connection, slug: str):
    candidates = set()
    for record_uid, entity_uid in con.execute(
        "SELECT record_uid,entity_uid FROM source_records WHERE record_type='realmeye_page' AND source_key=?",
        (slug,),
    ):
        if entity_uid:
            candidates.add(entity_uid)
        candidates.update(row[0] for row in con.execute(
            "SELECT entity_uid FROM source_record_entities WHERE record_uid=? AND link_type='about'", (record_uid,)
        ))
    candidates.update(row[0] for row in con.execute(
        "SELECT entity_uid FROM external_refs WHERE ref_type='realmeye_slug' AND ref_value=?", (slug,)
    ))
    return candidates


def index_name_candidates(con: sqlite3.Connection):
    """Exact Index name map. This is deliberately not fuzzy matching."""
    out = defaultdict(set)
    for entity_uid, kind, legacy in con.execute(
        "SELECT entity_uid,kind,legacy_index_id FROM entities WHERE legacy_index_id IS NOT NULL"
    ):
        if not legacy or ":" not in legacy:
            continue
        name = legacy.split(":", 1)[1].split("#", 1)[0]
        out[(kind, name_key(name))].add(entity_uid)
    return out


def exact_title_candidates(name_map, page_type: str, title: str):
    found = set()
    key = name_key(title)
    for kind in INDEX_KIND_FOR_PAGE.get(page_type, set()):
        found.update(name_map.get((kind, key), set()))
    return found


def companion_base_slug(slug: str, page_type: str, known_slugs: set[str]):
    if page_type == "biome" and slug.endswith("-enemies"):
        base = slug[:-len("-enemies")]
        if base in known_slugs:
            return base
    return None


def grouped_fact_values(facts):
    grouped = defaultdict(list)
    for fact in facts:
        key = field_key(fact["key"])
        value = fact.get("value")
        if value is not None and value not in grouped[key]:
            grouped[key].append(value)
    return grouped


def cleaned_intro(payload):
    return concise_page_intro(payload)


def add_entity_facts(imp, entity_uid: str, record_uid: str, payload):
    imp.fact(entity_uid, record_uid, "community.realmeye.page_type", payload["type"], "observation")
    imp.fact(entity_uid, record_uid, "community.realmeye.title", payload["title"], "observation")
    imp.fact(entity_uid, record_uid, "community.realmeye.slug", payload["slug"], "observation")
    # Descriptions are useful on every domain record, not only biomes,
    # dungeons and enemies.  The archive already has section 0 for items,
    # classes, sets and pets too, so keep the concise introduction whenever it
    # exists.  Biome-only fields remain biome-only.
    if payload.get("type") in DOMAIN_PAGE_TYPES:
        intro = cleaned_intro(payload)
        if intro:
            imp.fact(entity_uid, record_uid, "community.realmeye.summary", intro, "observation")
            if payload.get("type") == "biome":
                rank = re.search(r"\b(Rookie|Adept|Veteran)\s+biome\b", intro, flags=re.I)
                if rank:
                    imp.fact(entity_uid, record_uid, "community.realmeye.rank", rank.group(1).title(), "observation")
                level = re.search(r"recommended for players level\s+(\d+)\s+and up", intro, flags=re.I)
                if level:
                    imp.fact(entity_uid, record_uid, "community.realmeye.recommended_level", int(level.group(1)), "observation")
    for key, values in grouped_fact_values(payload["facts"]).items():
        imp.fact(entity_uid, record_uid, "community.realmeye." + key, values[0] if len(values) == 1 else values, "observation")
    if payload.get("biome_drop_rows"):
        imp.fact(entity_uid, record_uid, "community.realmeye.biome_drop_rows", payload["biome_drop_rows"], "observation")
    for table in payload["tables"]:
        section = field_key(table.get("section") or table.get("section_path") or "root")
        imp.fact(entity_uid, record_uid, f"community.realmeye.table.{section}.{table['ord']}", {
            "kind": table["kind"], "caption": table["caption"],
            "headers": table["headers"], "rows": table["rows"],
        }, "observation")
    phase_names = []
    for section in payload["sections"]:
        heading = section.get("heading") or ""; path = section.get("path") or ""
        if heading.lower().startswith("phase") or "phases >" in path.lower():
            if heading and heading not in phase_names:
                phase_names.append(heading)
    if phase_names:
        imp.fact(entity_uid, record_uid, "community.realmeye.combat.phases", phase_names, "observation")


def add_asset_candidates(imp, snap, record_uid, entity_uid, images):
    for position, image in enumerate(images[:4]):
        imp.con.execute("INSERT OR IGNORE INTO asset_refs VALUES(?,?,?,?,?,?,?)", (
            uid("asset", snap, record_uid, "realmeye_primary_image", position, image["url"]),
            snap, entity_uid, image["url"], "realmeye_primary_image",
            canon({"remote": True, "alt": image["alt"], "title": image["title"], "source": "realmeye_archive"}),
            record_uid,
        ))


def add_evidence(imp, source_relation_uid, snapshot_uid, entity_relation_uid, evidence_type, evidence_key, payload):
    imp.con.execute("INSERT OR IGNORE INTO source_relation_evidence VALUES(?,?,?,?,?)", (
        uid("archive-source-evidence", source_relation_uid, evidence_type, evidence_key),
        source_relation_uid, evidence_type, evidence_key, canon(payload),
    ))
    if entity_relation_uid:
        imp.con.execute("INSERT OR IGNORE INTO relation_evidence VALUES(?,?,?,?,?,?)", (
            uid("archive-entity-evidence", entity_relation_uid, evidence_type, evidence_key),
            entity_relation_uid, snapshot_uid, evidence_type, evidence_key, canon(payload),
        ))


def semantic_section_relation(page_type: str, heading: str, target_type: str):
    key = str(heading or "").strip().lower()
    if page_type == "dungeon":
        relation = DUNGEON_HEADINGS.get(key)
        if relation:
            if relation == "dungeon_drop_interest":
                return relation if target_type == "item" else None
            return relation if target_type in {"enemy", "other"} else None
        if "enemies" in key and target_type == "enemy": return "dungeon_enemy"
        if "hazard" in key and target_type in {"enemy", "other"}: return "dungeon_hazard"
    if page_type == "biome":
        if key in BIOME_HEADINGS and target_type == "enemy":
            return BIOME_HEADINGS[key]
        if key in BIOME_DROP_HEADINGS and target_type == "item":
            return "biome_drop_interest"
    return None


def import_realmeye_archive(imp, snapshot_uid: str, archive_path: str | Path):
    archive_path = Path(archive_path)
    source = sqlite3.connect(archive_path)
    source.row_factory = sqlite3.Row
    required = {"pages", "sections", "facts", "tables_data", "links", "images"}
    present = {row[0] for row in source.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    missing = sorted(required - present)
    if missing:
        source.close(); raise RuntimeError("RealmEye processed database missing tables: " + ", ".join(missing))

    pre = _preload(source)
    all_pages = pre["pages"]
    pages = [row for row in all_pages if (row.get("type_guess") or "") not in HISTORY_PAGE_TYPES]
    history_count = len(all_pages) - len(pages)
    page_records = {}; page_entities = {}; payloads = {}
    exact_mapped = multi_mapped = provisional = unmapped_generic = 0
    name_map = index_name_candidates(imp.con)
    known_slugs = {row["slug"] for row in pages}

    for page in pages:
        slug = page["slug"]; url = page["url"]; typ = page["type_guess"] or "other"
        payload = {
            "slug": slug, "url": url, "title": page["title"], "status": page["status"],
            "final_url": page.get("final_url"), "canonical_url": page.get("canonical_url"),
            "raw_hash": page["raw_hash"], "content_hash": page.get("content_hash"), "text_hash": page.get("text_hash"),
            "version_marker": page.get("version_marker"), "date_marker": page.get("date_marker"),
            "type": typ, "type_confidence": page["type_confidence"],
            "type_reasons": json_load(page["type_reasons_json"], []),
            "sections": pre["sections"].get(url, []), "facts": pre["facts"].get(url, []),
            "tables": pre["tables"].get(url, []),
            "biome_drop_rows": pre["biome_drop_rows"].get(slug, []),
            "primary_images": pre["images"].get(url, []),
        }
        candidates = current_entity_candidates(imp.con, slug)
        base_slug = companion_base_slug(slug, typ, known_slugs)
        # Companion roster pages ("*-enemies") describe the same biome, not a
        # second place. Reuse the base page entity when it has already been seen.
        if not candidates and base_slug and page_entities.get(base_slug):
            candidates = set(page_entities[base_slug])
        # Many biome/dungeon pages were never part of the legacy wiki join.
        # Exact kind + exact displayed title is safe and makes those pages enrich
        # the existing Index record instead of creating an unnecessary provisional.
        if not candidates:
            exact_title = page["title"]
            if base_slug and exact_title.lower().endswith(" enemies"):
                exact_title = exact_title[:-len(" enemies")]
            candidates = exact_title_candidates(name_map, typ, exact_title)
        entity_uid = None
        if len(candidates) == 1:
            entity_uid = next(iter(candidates)); exact_mapped += 1
        elif len(candidates) > 1:
            multi_mapped += 1
        elif typ in DOMAIN_PAGE_TYPES:
            entity_uid = imp.entity(PROVISIONAL_KIND[typ], f"realmeye-archive|{typ}|{slug}", snapshot_uid, status="provisional")
            candidates = {entity_uid}; provisional += 1
        else:
            unmapped_generic += 1
        record_uid = imp.record(snapshot_uid, "realmeye_archive_page", slug, entity_uid, payload)
        page_records[slug] = record_uid; page_entities[slug] = set(candidates); payloads[slug] = payload
        for candidate in sorted(candidates):
            imp.link_entity(record_uid, candidate, "about", "realmeye_archive_slug", {"slug": slug, "type": typ})
            imp.ref(candidate, "realmeye_archive", "realmeye_slug", slug, {"via": "archive"})
            imp.ref(candidate, "realmeye_archive", "realmeye_url", url, {"via": "archive"})
            imp.ref(candidate, "realmeye_archive", "display_name", page["title"], {"via": "archive"})
        if len(candidates) == 1:
            candidate = next(iter(candidates)); add_entity_facts(imp, candidate, record_uid, payload)
            add_asset_candidates(imp, snapshot_uid, record_uid, candidate, payload["primary_images"])

    counters = defaultdict(int); seen = set(); relation_counts = defaultdict(int)
    def add_relation(source_slug, relation_type, target_slug, source_field, evidence_type, evidence_key, evidence_payload):
        target_slug = slug_of(target_slug)
        if not target_slug or source_slug == target_slug or source_slug not in page_records or target_slug not in page_records: return
        dedupe = (source_slug, relation_type, target_slug, source_field, evidence_key)
        if dedupe in seen: return
        seen.add(dedupe); pos_key = (source_slug, source_field); position = counters[pos_key]; counters[pos_key] += 1
        sr = imp.source_relation(snapshot_uid, page_records[source_slug], relation_type, page_records[target_slug], source_field, position, {
            "source": "realmeye_archive", "source_slug": source_slug, "target_slug": target_slug, "evidence": evidence_payload,
        })
        er = None; se = page_entities.get(source_slug,set()); te = page_entities.get(target_slug,set())
        if len(se) == len(te) == 1:
            er = imp.relation(next(iter(se)), relation_type, next(iter(te)), page_records[source_slug], "observation", {
                "source": "realmeye_archive", "source_relation_uid": sr, "source_slug": source_slug, "target_slug": target_slug,
            })
        add_evidence(imp, sr, snapshot_uid, er, evidence_type, evidence_key, evidence_payload); relation_counts[relation_type] += 1

    def fact_targets(fact):
        targets = []
        for link in fact.get("links", []):
            target = slug_of(link.get("href"))
            if target and target not in targets:
                targets.append(target)
        return targets

    def blueprint_entity_for(payload):
        candidates = set()
        hints = []
        for fact in payload.get("facts", []):
            if str(fact.get("key") or "").strip().lower() != "blueprint":
                continue
            value = str(fact.get("value") or "").strip()
            if value:
                hints.append(value)
                candidates.update(name_map.get(("item", name_key(value)), set()))
            for target in fact_targets(fact):
                candidates.update(current_entity_candidates(imp.con, target))
        return (next(iter(candidates)) if len(candidates) == 1 else None), hints

    def add_blueprint_relation(evidence_slug, blueprint_entity, relation_type,
                               target_slug, source_field, evidence_key, evidence_payload):
        target_slug = slug_of(target_slug)
        if not target_slug or evidence_slug not in page_records or target_slug not in page_records:
            return

        raw_type = "blueprint_" + relation_type
        dedupe = ("blueprint", blueprint_entity, raw_type, target_slug, source_field, evidence_key)
        if dedupe in seen:
            return
        seen.add(dedupe)

        pos_key = (evidence_slug, source_field)
        position = counters[pos_key]
        counters[pos_key] += 1

        sr = imp.source_relation(
            snapshot_uid,
            page_records[evidence_slug],
            raw_type,
            page_records[target_slug],
            source_field,
            position,
            {
                "source": "realmeye_archive",
                "evidence_slug": evidence_slug,
                "target_slug": target_slug,
                "blueprint_entity_uid": blueprint_entity,
                "evidence": evidence_payload,
            },
        )

        er = None
        targets = page_entities.get(target_slug, set())
        if len(targets) == 1:
            er = imp.relation(
                blueprint_entity,
                relation_type,
                next(iter(targets)),
                page_records[evidence_slug],
                "observation",
                {
                    "source": "realmeye_archive",
                    "source_relation_uid": sr,
                    "evidence_slug": evidence_slug,
                    "target_slug": target_slug,
                },
            )

        add_evidence(
            imp, sr, snapshot_uid, er,
            "realmeye_fact", evidence_key, evidence_payload
        )
        relation_counts[raw_type] += 1

    blueprint_relations = {
        "blueprint drops from": "dropped_by",
        "blueprint obtained through": "obtained_through",
    }

    for slug, payload in payloads.items():
        blueprint_entity, blueprint_hints = blueprint_entity_for(payload)

        for fact in payload["facts"]:
            fact_key = str(fact["key"]).strip().lower()

            if fact_key in blueprint_relations:
                # No exact Blueprint identity means no relation. Keep the fact
                # as evidence, but never infer a Blueprint from the gear name.
                if not blueprint_entity:
                    continue
                for target in fact_targets(fact):
                    add_blueprint_relation(
                        slug,
                        blueprint_entity,
                        blueprint_relations[fact_key],
                        target,
                        "archive:fact:" + field_key(fact["key"]),
                        fact["key"],
                        {
                            "key": fact["key"],
                            "value": fact["value"],
                            "section": fact.get("section") or "",
                            "section_path": fact.get("section_path") or "",
                            "blueprint": blueprint_hints,
                        },
                    )
                continue

            relation_type = FACT_RELATIONS.get(fact_key)
            if not relation_type:
                continue

            for target in fact_targets(fact):
                add_relation(
                    slug,
                    relation_type,
                    target,
                    "archive:fact:" + field_key(fact["key"]),
                    "realmeye_fact",
                    fact["key"],
                    {
                        "key": fact["key"],
                        "value": fact["value"],
                        "section": fact.get("section") or "",
                        "section_path": fact.get("section_path") or "",
                    },
                )

        for link in pre["semantic_links"].get(slug, []):
            target = link["target_slug"]
            relation_type = semantic_section_relation(payload["type"], link.get("section") or "", pre["page_type"].get(target, ""))
            if relation_type:
                add_relation(slug, relation_type, target, "archive:section:" + field_key(link.get("section") or "root"), "realmeye_section", link.get("section") or "", {
                    "section": link.get("section") or "", "section_path": link.get("section_path") or "", "anchor": link.get("anchor") or "",
                })
        if payload["type"] == "set":
            for target in pre["set_pieces"].get(slug, []):
                add_relation(slug, "set_piece", target, "archive:set-piece", "realmeye_set_table", payload["title"], {"set": payload["title"]})

    source.close()
    report = {
        "archive": str(archive_path), "pages": len(page_records), "history_pages_excluded": history_count,
        "mapped_unique": exact_mapped, "mapped_multiple": multi_mapped, "provisional": provisional,
        "companion_pages": sum(1 for slug, payload in payloads.items() if companion_base_slug(slug, payload["type"], known_slugs)),
        "unmapped_generic": unmapped_generic, "relations": dict(sorted(relation_counts.items())),
        "facts": imp.con.execute("SELECT COUNT(*) FROM facts f JOIN source_records r ON r.record_uid=f.source_record_uid WHERE r.record_type='realmeye_archive_page'").fetchone()[0],
        "asset_candidates": imp.con.execute("SELECT COUNT(*) FROM asset_refs WHERE snapshot_uid=? AND asset_type='realmeye_primary_image'", (snapshot_uid,)).fetchone()[0],
    }
    imp.report["realmeye_archive"] = report
    return report
