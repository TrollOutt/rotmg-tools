#!/usr/bin/env python3
"""
Index a RealmEye monitor archive into SQLite.

No third-party dependency is required. The script understands the object store
created by tools/watch-realmeye.js (objects/<sha-prefix>/<sha>.html.gz) and, when
available, local/realmeye-monitor/latest.json.

It deliberately extracts generic structures instead of hard-coding one parser
per RealmEye page type: sections, tables, key/value facts, lists, internal links,
images and searchable text. This makes the index resilient when RealmEye adds a
new item, dungeon, enemy, mechanic or page template.
"""
from __future__ import annotations

import argparse
import collections
import concurrent.futures
import datetime as dt
import gzip
import hashlib
import html as html_lib
import json
import os
from pathlib import Path
import re
import sqlite3
import sys
from html.parser import HTMLParser
from typing import Any, Dict, Iterable, List, Optional, Tuple
from urllib.parse import urljoin, urlparse

try:
    from lxml import etree as _lxml_etree
    from lxml import html as _lxml_html
except Exception:
    _lxml_etree = None
    _lxml_html = None

HOST = "https://www.realmeye.com"
WIKI_PREFIX = "/wiki/"
SCHEMA_VERSION = 4
PARSER_VERSION = 4

# Tables under these headings are rosters/relationship grids, not key/value
# facts. Treating a two-cell Heroes row as "Deathmage = Lich" was one of the
# main sources of nonsense in the runtime Index.
RELATION_GRID_HEADINGS = {
    "monsters", "regular enemies", "minions", "heroes of oryx",
    "heroes of oryx minions", "encounters", "realm encounters",
    "encounter minions", "beacon guardian", "beacon guardians",
    "beacon guardian minions", "boss", "bosses", "final boss",
    "miniboss", "minibosses", "boss minions", "treasure room boss",
    "environmental hazards", "drops of interest",
}

WS_RE = re.compile(r"\s+")
TOKEN_RE = re.compile(r"[a-z][a-z0-9'+.-]{2,}", re.I)
VERSION_RE = re.compile(r"\b(?:Exalt\s+)?Version\s+([0-9]+(?:\.[0-9]+){1,4})\b", re.I)
DATE_RE = re.compile(r"\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{4}\b", re.I)

STOPWORDS = {
    "the","and","for","that","with","this","from","are","was","were","have","has","had","not","but","you","your","their","its","into","when","where","which","while","will","can","may","also","all","any","each","other","than","then","there","these","those","been","being","they","them","our","out","use","used","using","one","two","three","more","most","some","such","only","over","under","per","after","before","during","through","about","wiki","realmeye","realm","rotmg","game","page","back","contents","updated","last","version","exalt","item","items","enemy","enemies"
}

HIGH_VALUE_FAMILIES = {
    "combat": {
        "headings": ["stats", "combat", "attacks", "behavior", "phase", "segments", "strengths", "weaknesses"],
        "facts": ["damage", "range", "shots", "projectile speed", "rate of fire", "effect(s)", "cooldown", "duration", "targets", "radius", "attack interval", "defense ignored"],
    },
    "loot_sources": {
        "headings": ["drops", "drops of interest", "historical drops", "loot and purpose", "rewards"],
        "facts": ["drops from", "obtained through", "loot bag", "blueprint",
                  "blueprint drops from", "blueprint obtained through",
                  "drop location", "soulbound"],
    },
    "item_economy": {
        "headings": ["set bonuses", "reskins"],
        "facts": ["tier", "feed power", "forging cost", "dismantling value", "dust type", "dust cost", "power level", "xp bonus", "stack limit", "reskin of", "reskin(s)"],
    },
    "dungeons_world": {
        "headings": ["boss", "bosses", "boss minions", "minions", "enemies", "treasure room boss", "layout", "location", "environmental hazards", "dungeon events", "realm events", "encounters", "heroes of oryx", "beacon guardian"],
        "facts": ["enemy", "type", "event"],
    },
    "progression": {
        "headings": ["quests", "daily quests", "missions", "mission tree", "battle pass", "rewards", "token exchange", "crucible"],
        "facts": ["requirements", "reward", "campaign points", "released"],
    },
    "history_updates": {
        "headings": ["history", "changes", "fixes", "quality of life", "added content", "other changes", "item balance", "gameplay changes"],
        "facts": ["released", "legacy version", "legacy version of"],
    },
}


def now_iso() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat().replace("+00:00", "Z")


def clean_text(value: str) -> str:
    return WS_RE.sub(" ", html_lib.unescape(value or "")).strip()


def sha256_text(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8", "replace")).hexdigest()


def canonical_wiki_url(value: Optional[str]) -> Optional[str]:
    if not value:
        return None
    absolute = urljoin(HOST, value)
    parsed = urlparse(absolute)
    if parsed.netloc.lower() not in {"realmeye.com", "www.realmeye.com"}:
        return None
    if not parsed.path.startswith(WIKI_PREFIX):
        return None
    slug = parsed.path[len(WIKI_PREFIX):].strip("/")
    if not slug:
        return HOST + "/wiki"
    return HOST + WIKI_PREFIX + slug


def slug_from_url(url: str) -> str:
    parsed = urlparse(url)
    path = parsed.path
    return path[len(WIKI_PREFIX):] if path.startswith(WIKI_PREFIX) else path.strip("/")


class RealmEyeParser(HTMLParser):
    """Streaming parser focused on RealmEye's `.wiki-page` content."""

    IGNORE = {"script", "style", "noscript", "template"}
    VOID = {"area","base","br","col","embed","hr","img","input","link","meta","param","source","track","wbr"}

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.tag_stack: List[str] = []
        self.wiki_depth = 0
        self.wiki_started = False
        self.ignore_depth = 0
        self.title_depth = 0
        self.title_parts: List[str] = []
        self.canonical: Optional[str] = None

        self.page_text_parts: List[str] = []
        self.sections: List[Dict[str, Any]] = [{
            "ord": 0, "level": 0, "heading": "", "heading_id": "", "path": "", "text_parts": []
        }]
        self.current_section = 0
        self.heading_path: Dict[int, str] = {}
        self.active_heading: Optional[Dict[str, Any]] = None

        self.tables: List[Dict[str, Any]] = []
        self.table_stack: List[Dict[str, Any]] = []
        self.active_row: Optional[List[Dict[str, Any]]] = None
        self.active_cell: Optional[Dict[str, Any]] = None

        self.lists: List[Dict[str, Any]] = []
        self.active_li: Optional[Dict[str, Any]] = None
        self.links: List[Dict[str, Any]] = []
        self.link_stack: List[Dict[str, Any]] = []
        self.images: List[Dict[str, Any]] = []
        self.paragraphs: List[Dict[str, Any]] = []
        self.active_p: Optional[Dict[str, Any]] = None
        self.strong_stack: List[Dict[str, Any]] = []
        self.labels: List[Dict[str, Any]] = []

    @staticmethod
    def attrs_dict(attrs: List[Tuple[str, Optional[str]]]) -> Dict[str, str]:
        return {k.lower(): (v or "") for k, v in attrs}

    def in_wiki(self) -> bool:
        return self.wiki_depth > 0

    def handle_starttag(self, tag: str, attrs: List[Tuple[str, Optional[str]]]) -> None:
        tag = tag.lower()
        a = self.attrs_dict(attrs)
        self.tag_stack.append(tag)

        if tag == "title":
            self.title_depth += 1
        if tag == "link" and "canonical" in a.get("rel", "").lower().split():
            self.canonical = a.get("href") or self.canonical

        classes = set(a.get("class", "").split())
        if not self.wiki_started and "wiki-page" in classes:
            self.wiki_started = True
            self.wiki_depth = 1
        elif self.wiki_depth > 0 and tag not in self.VOID:
            self.wiki_depth += 1

        if not self.in_wiki():
            return

        if tag in self.IGNORE:
            self.ignore_depth += 1
            return
        if self.ignore_depth:
            return

        if re.fullmatch(r"h[1-6]", tag):
            self.active_heading = {"level": int(tag[1]), "id": a.get("id", ""), "parts": []}
        elif tag == "table":
            table = {"section_ord": self.current_section, "caption": "", "rows": [], "class": a.get("class", "")}
            self.table_stack.append(table)
        elif tag == "tr" and self.table_stack:
            self.active_row = []
        elif tag in {"td", "th"} and self.table_stack and self.active_row is not None:
            self.active_cell = {"tag": tag, "text_parts": [], "links": [], "images": [], "colspan": a.get("colspan", ""), "rowspan": a.get("rowspan", "")}
        elif tag == "caption" and self.table_stack:
            self.table_stack[-1]["caption_parts"] = []
        elif tag == "li":
            self.active_li = {"section_ord": self.current_section, "text_parts": [], "links": []}
        elif tag == "p":
            self.active_p = {"section_ord": self.current_section, "text_parts": [], "links": []}
        elif tag == "a":
            link = {"section_ord": self.current_section, "href": a.get("href", ""), "parts": []}
            self.link_stack.append(link)
        elif tag == "img":
            image = {
                "section_ord": self.current_section,
                "src": a.get("src", ""),
                "alt": clean_text(a.get("alt", "")),
                "title": clean_text(a.get("title", "")),
            }
            self.images.append(image)
            if self.active_cell is not None:
                self.active_cell.setdefault("images", []).append({"src": image["src"], "alt": image["alt"], "title": image["title"]})
        elif tag in {"strong", "b", "dt"}:
            self.strong_stack.append({"section_ord": self.current_section, "parts": [], "tag": tag})

    def handle_startendtag(self, tag: str, attrs: List[Tuple[str, Optional[str]]]) -> None:
        self.handle_starttag(tag, attrs)
        self.handle_endtag(tag)

    def handle_data(self, data: str) -> None:
        if self.title_depth:
            self.title_parts.append(data)
        if not self.in_wiki() or self.ignore_depth:
            return
        value = clean_text(data)
        if not value:
            return
        self.page_text_parts.append(value)
        self.sections[self.current_section]["text_parts"].append(value)
        if self.active_heading is not None:
            self.active_heading["parts"].append(value)
        if self.active_cell is not None:
            self.active_cell["text_parts"].append(value)
        if self.active_li is not None:
            self.active_li["text_parts"].append(value)
        if self.active_p is not None:
            self.active_p["text_parts"].append(value)
        if self.link_stack:
            self.link_stack[-1]["parts"].append(value)
        if self.strong_stack:
            self.strong_stack[-1]["parts"].append(value)
        if self.table_stack and "caption_parts" in self.table_stack[-1]:
            self.table_stack[-1]["caption_parts"].append(value)

    def handle_endtag(self, tag: str) -> None:
        tag = tag.lower()
        was_in_wiki = self.in_wiki()

        if was_in_wiki and tag in self.IGNORE and self.ignore_depth:
            self.ignore_depth -= 1
        elif was_in_wiki and not self.ignore_depth:
            if re.fullmatch(r"h[1-6]", tag) and self.active_heading is not None:
                level = self.active_heading["level"]
                heading = clean_text(" ".join(self.active_heading["parts"]))
                if heading and heading.lower() != "contents":
                    for k in list(self.heading_path):
                        if k >= level:
                            del self.heading_path[k]
                    self.heading_path[level] = heading
                    path = " > ".join(self.heading_path[k] for k in sorted(self.heading_path))
                    self.sections.append({
                        "ord": len(self.sections), "level": level, "heading": heading,
                        "heading_id": self.active_heading["id"], "path": path, "text_parts": []
                    })
                    self.current_section = len(self.sections) - 1
                self.active_heading = None
            elif tag in {"td", "th"} and self.active_cell is not None and self.active_row is not None:
                self.active_cell["text"] = clean_text(" ".join(self.active_cell.pop("text_parts")))
                self.active_row.append(self.active_cell)
                self.active_cell = None
            elif tag == "tr" and self.active_row is not None and self.table_stack:
                if self.active_row:
                    self.table_stack[-1]["rows"].append(self.active_row)
                self.active_row = None
            elif tag == "caption" and self.table_stack:
                parts = self.table_stack[-1].pop("caption_parts", [])
                self.table_stack[-1]["caption"] = clean_text(" ".join(parts))
            elif tag == "table" and self.table_stack:
                table = self.table_stack.pop()
                if table["rows"]:
                    table["ord"] = len(self.tables)
                    self.tables.append(table)
            elif tag == "li" and self.active_li is not None:
                self.active_li["text"] = clean_text(" ".join(self.active_li.pop("text_parts")))
                if self.active_li["text"]:
                    self.lists.append(self.active_li)
                self.active_li = None
            elif tag == "p" and self.active_p is not None:
                self.active_p["text"] = clean_text(" ".join(self.active_p.pop("text_parts")))
                if self.active_p["text"]:
                    self.paragraphs.append(self.active_p)
                self.active_p = None
            elif tag == "a" and self.link_stack:
                link = self.link_stack.pop()
                link["anchor"] = clean_text(" ".join(link.pop("parts")))
                if link["href"]:
                    self.links.append(link)
                    if self.active_cell is not None:
                        self.active_cell["links"].append({"href": link["href"], "anchor": link["anchor"]})
                    if self.active_li is not None:
                        self.active_li["links"].append({"href": link["href"], "anchor": link["anchor"]})
                    if self.active_p is not None:
                        self.active_p["links"].append({"href": link["href"], "anchor": link["anchor"]})
            elif tag in {"strong", "b", "dt"} and self.strong_stack:
                label = self.strong_stack.pop()
                text_value = clean_text(" ".join(label.pop("parts"))).rstrip(":")
                if text_value and len(text_value) <= 100:
                    label["text"] = text_value
                    self.labels.append(label)

        if tag == "title" and self.title_depth:
            self.title_depth -= 1

        if self.wiki_depth > 0 and tag not in self.VOID:
            self.wiki_depth -= 1
        if self.tag_stack:
            self.tag_stack.pop()

    def result(self) -> Dict[str, Any]:
        title = clean_text(" ".join(self.title_parts))
        title = re.sub(r"\s*-\s*the RotMG Wiki\s*\|\s*RealmEye\.com\s*$", "", title, flags=re.I)
        for section in self.sections:
            section["text"] = clean_text(" ".join(section.pop("text_parts")))
        return {
            "title": title,
            "canonical": self.canonical,
            "text": clean_text(" ".join(self.page_text_parts)),
            "sections": self.sections,
            "tables": self.tables,
            "lists": self.lists,
            "links": self.links,
            "images": self.images,
            "paragraphs": self.paragraphs,
            "labels": self.labels,
        }


def _lxml_class_xpath(name: str) -> str:
    return f'contains(concat(" ", normalize-space(@class), " "), " {name} ")'


def _tag_name(elem) -> str:
    return elem.tag.lower() if isinstance(elem.tag, str) else ""


_HEAD_LEVEL = {"h1": 1, "h2": 2, "h3": 3, "h4": 4, "h5": 5, "h6": 6}
_DIRECT_ROW_PARENTS = {"thead", "tbody", "tfoot"}
_CAPTURE_TAGS = {"table", "a", "img", "li", "p", "strong", "b", "dt"}


def _direct_rows(table):
    for child in table:
        tag = _tag_name(child)
        if tag == "tr":
            yield child
        elif tag in _DIRECT_ROW_PARENTS:
            for row in child:
                if _tag_name(row) == "tr":
                    yield row


def _direct_cells(row):
    for child in row:
        if _tag_name(child) in {"th", "td"}:
            yield child


def _node_text(node) -> str:
    return clean_text(" ".join(node.itertext()))


def _text_prefix(node, limit: int = 320) -> str:
    parts = []
    size = 0
    for text in node.itertext():
        if not text:
            continue
        parts.append(text)
        size += len(text)
        if size >= limit:
            break
    return clean_text(" ".join(parts))[:limit]


def parse_html_document_lxml(raw: str) -> Dict[str, Any]:
    """Parse a RealmEye page with one DOM walk and no per-node annotations.

    The old implementation wrote a synthetic section attribute onto every DOM
    node, then rediscovered tables/links/images with several XPath passes. Large
    RealmEye pages contain thousands of nodes, so that bookkeeping dominated a
    full archive rebuild. Here section ownership is captured during one walk and
    the exact node references are retained for the structures we actually use.
    """
    doc = _lxml_html.fromstring(raw)
    titles = doc.xpath("//title/text()")
    title = clean_text(" ".join(str(x) for x in titles))
    title = re.sub(r"\s*-\s*the RotMG Wiki\s*\|\s*RealmEye\.com\s*$", "", title, flags=re.I)
    canonical_nodes = doc.xpath('//link[contains(concat(" ", normalize-space(@rel), " "), " canonical ")]/@href')
    canonical = canonical_nodes[0] if canonical_nodes else None
    mains = doc.xpath(f'//*[{_lxml_class_xpath("wiki-page")}]')
    body = doc.xpath("//body")
    main = mains[0] if mains else (body[0] if body else doc)

    # Drop repeated page-wide navigation/taxonomy tables before the main walk.
    # Avoid materialising/normalising table text unless a table is large enough
    # to plausibly be one of the repeated RealmEye navigation blocks.
    for table in list(main.iter("table")):
        parent = table.getparent()
        if parent is None:
            continue
        all_rows = list(table.iter("tr"))
        if len(all_rows) < 8:
            continue
        direct_rows = list(_direct_rows(table))
        links_count = sum(1 for a in table.iter("a") if "href" in a.attrib)
        realm_biome_taxonomy = False
        if links_count >= 8:
            prefix = _text_prefix(table).lower()
            realm_biome_taxonomy = prefix.startswith("biomes of the realm") or " biomes of the realm " in (" " + prefix + " ")

        repeated_nested_nav = False
        repeated_flat_nav = False
        if len(all_rows) >= 20:
            repeated_nested_nav = links_count >= 30 and len(all_rows) >= max(12, len(direct_rows) * 3)
            pairs = 0
            empty_left = 0
            for tr in all_rows:
                cells = list(_direct_cells(tr))
                if len(cells) != 2:
                    continue
                pairs += 1
                left = _node_text(cells[0])
                if not left and _node_text(cells[1]):
                    empty_left += 1
            repeated_flat_nav = bool(pairs) and empty_left / len(all_rows) > 0.55
        if repeated_nested_nav or repeated_flat_nav or realm_biome_taxonomy:
            parent.remove(table)

    sections: List[Dict[str, Any]] = [{
        "ord": 0, "level": 0, "heading": "", "heading_id": "", "path": "", "text_parts": []
    }]
    current_section = 0
    heading_path: Dict[int, str] = {}
    page_parts: List[str] = []
    ignore_depth = 0
    heading_depth = 0
    captured: Dict[str, List[Tuple[Any, int]]] = {tag: [] for tag in _CAPTURE_TAGS}

    for event, elem in _lxml_etree.iterwalk(main, events=("start", "end")):
        tag = _tag_name(elem)
        if event == "start":
            if tag in RealmEyeParser.IGNORE:
                ignore_depth += 1
            if ignore_depth:
                continue

            level = _HEAD_LEVEL.get(tag)
            if level is not None:
                heading = _node_text(elem)
                if heading and heading.lower() != "contents":
                    for k in tuple(heading_path):
                        if k >= level:
                            del heading_path[k]
                    heading_path[level] = heading
                    path = " > ".join(heading_path[k] for k in sorted(heading_path))
                    sections.append({
                        "ord": len(sections), "level": level, "heading": heading,
                        "heading_id": elem.get("id", ""), "path": path, "text_parts": []
                    })
                    current_section = len(sections) - 1
                heading_depth += 1

            if tag in captured:
                captured[tag].append((elem, current_section))

            # lxml already decodes character references. Defer whitespace
            # normalisation until the whole section/page is assembled instead
            # of running a regex for every tiny text node.
            if elem.text and not heading_depth:
                page_parts.append(elem.text)
                sections[current_section]["text_parts"].append(elem.text)
        else:
            if tag in RealmEyeParser.IGNORE:
                if ignore_depth:
                    ignore_depth -= 1
                continue
            if ignore_depth:
                continue
            if tag in _HEAD_LEVEL and heading_depth:
                heading_depth -= 1
            if elem.tail and not heading_depth:
                page_parts.append(elem.tail)
                sections[current_section]["text_parts"].append(elem.tail)

    for section in sections:
        section["text"] = clean_text(" ".join(section.pop("text_parts")))

    tables: List[Dict[str, Any]] = []
    for table, section_ord in captured["table"]:
        rows = []
        for tr in _direct_rows(table):
            cells = []
            for cell in _direct_cells(tr):
                links = [
                    {"href": a.get("href", ""), "anchor": _node_text(a)}
                    for a in cell.iter("a") if "href" in a.attrib
                ]
                cell_images = [
                    {"src": img.get("src", ""), "alt": clean_text(img.get("alt", "")),
                     "title": clean_text(img.get("title", ""))}
                    for img in cell.iter("img")
                ]
                cells.append({
                    "tag": _tag_name(cell), "text": _node_text(cell), "links": links,
                    "images": cell_images, "colspan": cell.get("colspan", ""),
                    "rowspan": cell.get("rowspan", "")
                })
            if cells:
                rows.append(cells)
        if not rows:
            continue
        caption = ""
        for child in table:
            if _tag_name(child) == "caption":
                caption = _node_text(child)
                break
        tables.append({
            "section_ord": section_ord, "caption": caption, "rows": rows,
            "class": table.get("class", ""), "ord": len(tables)
        })

    links = [
        {"section_ord": section_ord, "href": node.get("href", ""), "anchor": _node_text(node)}
        for node, section_ord in captured["a"] if "href" in node.attrib
    ]
    images = [
        {"section_ord": section_ord, "src": node.get("src", ""),
         "alt": clean_text(node.get("alt", "")), "title": clean_text(node.get("title", ""))}
        for node, section_ord in captured["img"]
    ]

    lists = []
    for node, section_ord in captured["li"]:
        text = _node_text(node)
        if not text:
            continue
        li_links = [
            {"href": a.get("href", ""), "anchor": _node_text(a)}
            for a in node.iter("a") if "href" in a.attrib
        ]
        lists.append({"section_ord": section_ord, "text": text, "links": li_links})

    paragraphs = []
    for node, section_ord in captured["p"]:
        text = _node_text(node)
        if not text:
            continue
        p_links = [
            {"href": a.get("href", ""), "anchor": _node_text(a)}
            for a in node.iter("a") if "href" in a.attrib
        ]
        paragraphs.append({"section_ord": section_ord, "text": text, "links": p_links})

    labels = []
    for tag in ("strong", "b", "dt"):
        for node, section_ord in captured[tag]:
            text = _node_text(node).rstrip(":")
            if text and len(text) <= 100:
                labels.append({"section_ord": section_ord, "text": text, "tag": tag})

    return {
        "title": title, "canonical": canonical, "text": clean_text(" ".join(page_parts)),
        "sections": sections, "tables": tables, "lists": lists, "links": links,
        "images": images, "paragraphs": paragraphs, "labels": labels,
    }

def parse_html_document(raw: str) -> Dict[str, Any]:
    if _lxml_html is not None:
        try:
            return parse_html_document_lxml(raw)
        except Exception:
            pass
    parser = RealmEyeParser()
    parser.feed(raw)
    parser.close()
    return parser.result()


def table_rows_as_text(table: Dict[str, Any]) -> List[List[str]]:
    return [[cell.get("text", "") for cell in row] for row in table.get("rows", [])]


def classify_table(table: Dict[str, Any]) -> Tuple[str, List[str]]:
    rows = table_rows_as_text(table)
    if not rows:
        return "empty", []
    if len(rows) == 1 and len(rows[0]) == 1 and rows[0][0].lower().startswith("last updated:"):
        return "update-marker", []

    header: List[str] = []
    first = table["rows"][0]
    if any(cell.get("tag") == "th" for cell in first):
        header = [cell.get("text", "") for cell in first]
    elif len(rows[0]) > 2 and all(len(v) <= 100 for v in rows[0]):
        header = rows[0]

    pair_rows = [r for r in rows if len(r) == 2 and r[0] and len(r[0]) <= 100]
    empty_left = [r for r in rows if len(r) == 2 and not r[0] and r[1]]
    if len(rows) >= 8 and len(empty_left) / len(rows) > 0.55:
        return "navigation", header
    if pair_rows and len(pair_rows) / len(rows) >= 0.55:
        return "key-value", header
    if header and len(header) >= 2:
        return "matrix", header
    return "content", header


def extract_facts(parsed: Dict[str, Any]) -> List[Dict[str, Any]]:
    facts: List[Dict[str, Any]] = []
    section_heading = {
        int(section.get("ord", 0)): str(section.get("heading") or "").strip().lower()
        for section in parsed.get("sections", [])
    }
    for table in parsed["tables"]:
        kind, _ = classify_table(table)
        heading = section_heading.get(int(table.get("section_ord", 0)), "")
        # Roster/drop grids express relationships through their links. They are
        # not dictionaries, even when a one-row grid happens to have 2 cells.
        if kind == "navigation" or heading in RELATION_GRID_HEADINGS:
            continue
        # Key/value extraction belongs to key/value tables only. Matrix/content
        # tables are preserved separately where useful and must never leak row
        # pairs into generic facts.
        if kind != "key-value":
            continue
        blueprint_sources = False
        for row_idx, row in enumerate(table.get("rows", [])):
            if len(row) != 2:
                continue
            key = clean_text(row[0].get("text", "")).rstrip(":")
            value = clean_text(row[1].get("text", ""))
            if not value:
                visual = []
                for image in row[1].get("images", []):
                    visual.append(image.get("alt") or image.get("title") or "")
                for link in row[1].get("links", []):
                    visual.append(link.get("anchor") or "")
                value = clean_text(" ".join(v for v in visual if v))
            if not key or len(key) > 100:
                continue
            if key.lower().startswith("last updated"):
                continue
            if not value and key.lower() not in {"soulbound", "consumed with use"}:
                continue

            # RealmEye renders Blueprint as a small subsection of an item's
            # source table. The following Drops From / Obtained Through rows
            # describe the blueprint, not the equipment above it.
            low_key = key.lower()
            if low_key == "blueprint":
                blueprint_sources = True
            elif blueprint_sources and low_key in {"drops from", "obtained through"}:
                key = "Blueprint " + key
            elif blueprint_sources:
                blueprint_sources = False

            facts.append({
                "section_ord": table["section_ord"],
                "key": key,
                "value": value,
                "source": "table",
                "table_ord": table["ord"],
                "row_ord": row_idx,
                "links": row[1].get("links", []),
            })

    # Conservative prose key:value extraction. Only start-of-paragraph labels are used.
    for p in parsed["paragraphs"]:
        m = re.match(r"^([A-Za-z][A-Za-z0-9 /()'’+._-]{1,60}):\s+(.+)$", p["text"])
        if not m:
            continue
        facts.append({
            "section_ord": p["section_ord"], "key": m.group(1), "value": m.group(2),
            "source": "paragraph", "table_ord": None, "row_ord": None, "links": p.get("links", [])
        })
    return facts


def extract_version_date_markers(parsed: Dict[str, Any]) -> Tuple[str, str]:
    candidates: List[str] = []
    for table in parsed.get("tables", []):
        rows = table_rows_as_text(table)
        for row in rows[:2]:
            if len(row) == 1 and row[0].lower().startswith("last updated:"):
                candidates.append(row[0])
    candidates.append(parsed.get("text", ""))
    version = ""
    date = ""
    for text in candidates:
        if not version:
            m = VERSION_RE.search(text)
            if m:
                version = m.group(1)
        if not date:
            m = DATE_RE.search(text)
            if m:
                date = m.group(0)
        if version and date:
            break
    return version, date


def infer_page_type(url: str, parsed: Dict[str, Any], facts: List[Dict[str, Any]]) -> Tuple[str, float, List[str]]:
    slug = slug_from_url(url).lower()
    title = parsed["title"].lower()
    headings = {s["heading"].lower() for s in parsed["sections"] if s["heading"]}
    keys = {f["key"].lower() for f in facts}
    score: Dict[str, float] = collections.defaultdict(float)
    why: Dict[str, List[str]] = collections.defaultdict(list)

    def add(kind: str, points: float, reason: str) -> None:
        score[kind] += points
        why[kind].append(reason)

    if {"stats", "combat", "attacks"}.issubset(headings): add("enemy", 8, "stats+combat+attacks")
    if "behavior" in headings and "drops" in headings: add("enemy", 3, "behavior+drops")
    if {"damage", "range"}.issubset(keys) and ("feed power" in keys or "tier" in keys): add("item", 8, "damage/range + item fields")
    if keys & {"feed power", "forging cost", "dismantling value", "dust type", "obtained through", "drops from"}: add("item", 5, "item economy/source fields")
    if headings & {"boss", "bosses", "boss minions", "treasure room boss", "layout", "environmental hazards"}: add("dungeon", 6, "dungeon sections")
    if "drops of interest" in headings and "enemies" in headings: add("dungeon", 4, "enemies+drops of interest")
    if {"regular enemies", "heroes of oryx", "encounters"} & headings: add("biome", 6, "realm biome sections")
    if "beacon guardian" in headings: add("biome", 4, "beacon guardian")
    if "maximum achievable stats" in headings or "character skins" in headings: add("class", 8, "class-specific sections")
    if "set bonuses" in headings or keys & {"2nd piece bonus", "3rd piece bonus", "4th piece bonus", "set generation"}: add("set", 8, "set bonuses")
    if headings & {"unlockable skins", "exclusive skins", "special themed set skins"}: add("skin-list", 7, "skin sections")
    if slug.startswith("list-"): add("list", 10, "list-* URL")
    if "release-history" in slug or title.startswith("release history"): add("update-history", 10, "release history")
    if headings & {"fixes", "quality of life", "added content"} and headings & {"battle pass", "missions", "events", "quests"}: add("update-history", 5, "update sections")
    if headings == {"usage"} or "mandatory parameters" in headings: add("template/documentation", 8, "template usage sections")
    if "pet" in title and ("skins" in title or "eggs" in title): add("pet", 3, "pet title")

    if not score:
        return "other", 0.25, []
    kind, top = max(score.items(), key=lambda x: x[1])
    ordered = sorted(score.values(), reverse=True)
    margin = top - (ordered[1] if len(ordered) > 1 else 0)
    confidence = min(0.99, 0.50 + top * 0.045 + max(0, margin) * 0.02)
    return kind, round(confidence, 2), why[kind]


def read_gzip_text(path: Path) -> str:
    with gzip.open(path, "rt", encoding="utf-8", errors="replace") as fh:
        return fh.read()


def object_path(objects_dir: Path, raw_hash: str) -> Path:
    return objects_dir / raw_hash[:2] / f"{raw_hash}.html.gz"


def prepare_source(src: Dict[str, Any]) -> Dict[str, Any]:
    """Parse one archive object and return SQLite-ready row tuples.

    Everything CPU-heavy (DOM parsing, classification, URL normalization and
    JSON serialization) happens in the worker process. The parent process only
    performs batched SQLite writes, which keeps all parser workers busy instead
    of making them wait for Python work on the single database writer.
    """
    work = dict(src)
    parsed = work.pop("_parsed", None) or parse_html_document(
        read_gzip_text(Path(work["path"]))
    )
    url = (
        canonical_wiki_url(work.get("canonical_url"))
        or canonical_wiki_url(parsed.get("canonical"))
        or work.get("url")
        or ""
    )
    work["url"] = url
    if not url or "missing wiki page" in parsed["title"].lower():
        return {"skip": True, "url": url}

    facts = extract_facts(parsed)
    page_type, confidence, reasons = infer_page_type(url, parsed, facts)
    version_marker, date_marker = extract_version_date_markers(parsed)
    indexed = now_iso()
    content_hash = work.get("content_hash") or sha256_text(parsed["text"])
    text_hash = work.get("text_hash") or sha256_text(parsed["text"])

    page_row = (
        url, slug_from_url(url), parsed["title"], work["raw_hash"], work.get("status", 200),
        work.get("final_url", ""), work.get("canonical_url", "") or parsed.get("canonical") or "",
        work.get("fetched_at", ""), content_hash, text_hash, str(work["path"]), page_type,
        confidence, json.dumps(reasons, ensure_ascii=False), version_marker,
        date_marker, indexed, parsed["text"],
    )
    section_rows = [
        (url, sec["ord"], sec["level"], sec["heading"], sec.get("heading_id", ""), sec.get("path", ""), sec["text"])
        for sec in parsed["sections"]
    ]

    table_rows = []
    for table in parsed["tables"]:
        kind, headers = classify_table(table)
        serial_rows = [[{k: v for k, v in cell.items() if k != "tag"} for cell in row] for row in table["rows"]]
        if kind == "navigation" and len(serial_rows) > 20:
            serial_rows = serial_rows[:2]
        table_rows.append((
            url, table["ord"], table["section_ord"], kind, table.get("caption", ""),
            json.dumps(headers, ensure_ascii=False), json.dumps(serial_rows, ensure_ascii=False),
        ))

    fact_rows = [
        (url, fact["section_ord"], fact["key"], fact["value"], fact["source"],
         fact.get("table_ord"), fact.get("row_ord"), json.dumps(fact.get("links", []), ensure_ascii=False))
        for fact in facts
    ]

    link_rows = []
    for link in parsed["links"]:
        target = canonical_wiki_url(link["href"])
        if not target and not link.get("anchor"):
            continue
        link_rows.append((
            url, link["section_ord"], link["href"], target or "",
            slug_from_url(target) if target else "", link.get("anchor", ""),
        ))

    return {
        "skip": False,
        "url": url,
        "page": page_row,
        "sections": section_rows,
        "tables": table_rows,
        "facts": fact_rows,
        "links": link_rows,
        "images": [
            (url, image["section_ord"], image["src"], image.get("alt", ""), image.get("title", ""))
            for image in parsed["images"]
        ],
        "lists": [
            (url, item["section_ord"], item["text"], json.dumps(item.get("links", []), ensure_ascii=False))
            for item in parsed["lists"]
        ],
        "labels": [
            (url, label["section_ord"], label.get("tag", ""), label["text"])
            for label in parsed.get("labels", [])
        ],
    }


def prepare_batch(batch: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    return [prepare_source(src) for src in batch]

def sources_from_snapshot(snapshot: Path, objects_dir: Path) -> Tuple[List[Dict[str, Any]], bool]:
    payload = json.loads(snapshot.read_text(encoding="utf-8"))
    out = []
    for page in payload.get("pages", []):
        raw_hash = page.get("rawHash") or ""
        p = object_path(objects_dir, raw_hash) if raw_hash else None
        out.append({
            "url": page.get("url") or page.get("canonicalUrl") or "",
            "raw_hash": raw_hash,
            "path": p if p is not None and p.exists() else None,
            "status": int(page.get("status") or 0),
            "transport_status": int(page.get("transportStatus") or page.get("status") or 0),
            "final_url": page.get("finalUrl") or "",
            "canonical_url": page.get("canonicalUrl") or "",
            "fetched_at": page.get("fetchedAt") or "",
            "content_hash": page.get("contentHash") or "",
            "text_hash": page.get("textHash") or "",
            "gone_hint": bool(page.get("goneHint")),
            "error": page.get("error") or "",
        })
    return out, bool(payload.get("complete"))


def sources_from_objects(objects_dir: Path) -> List[Dict[str, Any]]:
    """Fallback when only the object store was supplied: infer canonical URL cheaply."""
    latest: Dict[str, Dict[str, Any]] = {}
    files = sorted(objects_dir.glob("*/*.html.gz"))
    total = len(files)
    canonical_re = re.compile(r'<link\b[^>]*\brel=["\'][^"\']*\bcanonical\b[^"\']*["\'][^>]*\bhref=["\']([^"\']+)["\']|<link\b[^>]*\bhref=["\']([^"\']+)["\'][^>]*\brel=["\'][^"\']*\bcanonical\b[^"\']*["\']', re.I)
    title_re = re.compile(r'<title\b[^>]*>(.*?)</title>', re.I | re.S)
    for i, p in enumerate(files, 1):
        raw_hash = p.name[:-8] if p.name.endswith(".html.gz") else p.stem
        try:
            raw = read_gzip_text(p)
        except Exception:
            continue
        tm = title_re.search(raw)
        title = clean_text(re.sub(r'<[^>]+>', ' ', tm.group(1))) if tm else ""
        if "missing wiki page" in title.lower():
            continue
        cm = canonical_re.search(raw)
        href = (cm.group(1) or cm.group(2)) if cm else None
        url = canonical_wiki_url(href)
        if not url:
            continue
        item = {"url": url, "raw_hash": raw_hash, "path": p, "status": 200, "final_url": url,
                "canonical_url": url, "fetched_at": "", "content_hash": "", "text_hash": "", "_mtime": p.stat().st_mtime}
        if url not in latest or item["_mtime"] > latest[url]["_mtime"]:
            latest[url] = item
        if i % 500 == 0:
            print(f"  discover {i}/{total} objects -> {len(latest)} canonical pages", flush=True)
    return sorted(latest.values(), key=lambda x: x["url"])


def ensure_schema(con: sqlite3.Connection) -> None:
    con.executescript("""
    PRAGMA journal_mode=WAL;
    PRAGMA synchronous=NORMAL;
    PRAGMA foreign_keys=ON;
    PRAGMA temp_store=MEMORY;
    PRAGMA cache_size=-131072;
    PRAGMA mmap_size=268435456;

    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY, value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS pages (
      url TEXT PRIMARY KEY,
      slug TEXT NOT NULL,
      title TEXT NOT NULL,
      raw_hash TEXT NOT NULL,
      status INTEGER NOT NULL,
      final_url TEXT,
      canonical_url TEXT,
      fetched_at TEXT,
      content_hash TEXT,
      text_hash TEXT,
      source_file TEXT,
      type_guess TEXT NOT NULL,
      type_confidence REAL NOT NULL,
      type_reasons_json TEXT NOT NULL,
      version_marker TEXT,
      date_marker TEXT,
      last_indexed_at TEXT NOT NULL,
      text TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_pages_type ON pages(type_guess);
    CREATE INDEX IF NOT EXISTS idx_pages_hash ON pages(raw_hash);

    CREATE TABLE IF NOT EXISTS sections (
      page_url TEXT NOT NULL REFERENCES pages(url) ON DELETE CASCADE,
      ord INTEGER NOT NULL,
      level INTEGER NOT NULL,
      heading TEXT NOT NULL,
      heading_id TEXT,
      path TEXT,
      text TEXT NOT NULL,
      PRIMARY KEY(page_url, ord)
    );
    CREATE INDEX IF NOT EXISTS idx_sections_heading ON sections(heading);

    CREATE TABLE IF NOT EXISTS tables_data (
      page_url TEXT NOT NULL REFERENCES pages(url) ON DELETE CASCADE,
      ord INTEGER NOT NULL,
      section_ord INTEGER NOT NULL,
      kind TEXT NOT NULL,
      caption TEXT,
      headers_json TEXT NOT NULL,
      rows_json TEXT NOT NULL,
      PRIMARY KEY(page_url, ord)
    );

    CREATE TABLE IF NOT EXISTS facts (
      id INTEGER PRIMARY KEY,
      page_url TEXT NOT NULL REFERENCES pages(url) ON DELETE CASCADE,
      section_ord INTEGER NOT NULL,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      source TEXT NOT NULL,
      table_ord INTEGER,
      row_ord INTEGER,
      links_json TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_facts_key ON facts(key);
    CREATE INDEX IF NOT EXISTS idx_facts_page ON facts(page_url);

    CREATE TABLE IF NOT EXISTS links (
      id INTEGER PRIMARY KEY,
      page_url TEXT NOT NULL REFERENCES pages(url) ON DELETE CASCADE,
      section_ord INTEGER NOT NULL,
      href TEXT NOT NULL,
      target_url TEXT,
      target_slug TEXT,
      anchor TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_links_target ON links(target_slug);

    CREATE TABLE IF NOT EXISTS images (
      id INTEGER PRIMARY KEY,
      page_url TEXT NOT NULL REFERENCES pages(url) ON DELETE CASCADE,
      section_ord INTEGER NOT NULL,
      src TEXT NOT NULL,
      alt TEXT,
      title TEXT
    );

    CREATE TABLE IF NOT EXISTS list_items (
      id INTEGER PRIMARY KEY,
      page_url TEXT NOT NULL REFERENCES pages(url) ON DELETE CASCADE,
      section_ord INTEGER NOT NULL,
      text TEXT NOT NULL,
      links_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS labels (
      id INTEGER PRIMARY KEY,
      page_url TEXT NOT NULL REFERENCES pages(url) ON DELETE CASCADE,
      section_ord INTEGER NOT NULL,
      tag TEXT NOT NULL,
      text TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_labels_text ON labels(text);

    CREATE TABLE IF NOT EXISTS keywords (
      term TEXT NOT NULL,
      source TEXT NOT NULL,
      document_count INTEGER NOT NULL,
      occurrence_count INTEGER NOT NULL,
      PRIMARY KEY(term, source)
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS pages_fts USING fts5(url, title, type_guess, text, tokenize='unicode61 remove_diacritics 2');
    CREATE VIRTUAL TABLE IF NOT EXISTS sections_fts USING fts5(page_url, heading, path, text, tokenize='unicode61 remove_diacritics 2');
    CREATE VIRTUAL TABLE IF NOT EXISTS facts_fts USING fts5(page_url, key, value, tokenize='unicode61 remove_diacritics 2');
    """)
    con.execute("INSERT OR REPLACE INTO meta(key,value) VALUES('schema_version',?)", (str(SCHEMA_VERSION),))


def delete_page(con: sqlite3.Connection, url: str, update_fts: bool = True) -> None:
    if update_fts:
        con.execute("DELETE FROM pages_fts WHERE url=?", (url,))
        con.execute("DELETE FROM sections_fts WHERE page_url=?", (url,))
        con.execute("DELETE FROM facts_fts WHERE page_url=?", (url,))
    con.execute("DELETE FROM pages WHERE url=?", (url,))


def insert_prepared_batch(con: sqlite3.Connection, results: List[Dict[str, Any]], update_fts: bool = True) -> int:
    rows = [result for result in results if not result.get("skip")]
    if not rows:
        return 0
    urls = [(result["url"],) for result in rows]
    if update_fts:
        con.executemany("DELETE FROM pages_fts WHERE url=?", urls)
        con.executemany("DELETE FROM sections_fts WHERE page_url=?", urls)
        con.executemany("DELETE FROM facts_fts WHERE page_url=?", urls)
    con.executemany("DELETE FROM pages WHERE url=?", urls)

    con.executemany("""INSERT INTO pages(url,slug,title,raw_hash,status,final_url,canonical_url,fetched_at,content_hash,text_hash,source_file,type_guess,type_confidence,type_reasons_json,version_marker,date_marker,last_indexed_at,text)
                     VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""", [r["page"] for r in rows])

    def merged(key: str):
        return [row for result in rows for row in result[key]]

    section_rows = merged("sections")
    table_rows = merged("tables")
    fact_rows = merged("facts")
    link_rows = merged("links")
    image_rows = merged("images")
    list_rows = merged("lists")
    label_rows = merged("labels")

    if section_rows:
        con.executemany("INSERT INTO sections(page_url,ord,level,heading,heading_id,path,text) VALUES(?,?,?,?,?,?,?)", section_rows)
    if table_rows:
        con.executemany("INSERT INTO tables_data(page_url,ord,section_ord,kind,caption,headers_json,rows_json) VALUES(?,?,?,?,?,?,?)", table_rows)
    if fact_rows:
        con.executemany("INSERT INTO facts(page_url,section_ord,key,value,source,table_ord,row_ord,links_json) VALUES(?,?,?,?,?,?,?,?)", fact_rows)
    if link_rows:
        con.executemany("INSERT INTO links(page_url,section_ord,href,target_url,target_slug,anchor) VALUES(?,?,?,?,?,?)", link_rows)
    if image_rows:
        con.executemany("INSERT INTO images(page_url,section_ord,src,alt,title) VALUES(?,?,?,?,?)", image_rows)
    if list_rows:
        con.executemany("INSERT INTO list_items(page_url,section_ord,text,links_json) VALUES(?,?,?,?)", list_rows)
    if label_rows:
        con.executemany("INSERT INTO labels(page_url,section_ord,tag,text) VALUES(?,?,?,?)", label_rows)

    if update_fts:
        con.executemany("INSERT INTO pages_fts(url,title,type_guess,text) VALUES(?,?,?,?)",
                        [(r["page"][0], r["page"][2], r["page"][11], r["page"][17]) for r in rows])
        if section_rows:
            con.executemany("INSERT INTO sections_fts(page_url,heading,path,text) VALUES(?,?,?,?)",
                            [(r[0], r[3], r[5], r[6]) for r in section_rows])
        if fact_rows:
            con.executemany("INSERT INTO facts_fts(page_url,key,value) VALUES(?,?,?)",
                            [(r[0], r[2], r[3]) for r in fact_rows])
    return len(rows)

def rebuild_fts(con: sqlite3.Connection) -> None:
    con.executescript("""
    DROP TABLE IF EXISTS pages_fts;
    DROP TABLE IF EXISTS sections_fts;
    DROP TABLE IF EXISTS facts_fts;
    CREATE VIRTUAL TABLE pages_fts USING fts5(url, title, type_guess, text, tokenize='unicode61 remove_diacritics 2');
    CREATE VIRTUAL TABLE sections_fts USING fts5(page_url, heading, path, text, tokenize='unicode61 remove_diacritics 2');
    CREATE VIRTUAL TABLE facts_fts USING fts5(page_url, key, value, tokenize='unicode61 remove_diacritics 2');
    INSERT INTO pages_fts(url,title,type_guess,text) SELECT url,title,type_guess,text FROM pages;
    INSERT INTO sections_fts(page_url,heading,path,text) SELECT page_url,heading,path,text FROM sections;
    INSERT INTO facts_fts(page_url,key,value) SELECT page_url,key,value FROM facts;
    """)


def rebuild_keywords(con: sqlite3.Connection, top_terms: int = 3000) -> None:
    con.execute("DELETE FROM keywords")
    # High-signal structural vocabulary.
    for source, sql in [
        ("heading", "SELECT lower(heading), count(DISTINCT page_url), count(*) FROM sections WHERE heading<>'' GROUP BY lower(heading)"),
        ("fact-key", "SELECT lower(key), count(DISTINCT page_url), count(*) FROM facts GROUP BY lower(key)"),
        ("label", "SELECT lower(text), count(DISTINCT page_url), count(*) FROM labels WHERE text<>'' GROUP BY lower(text)"),
    ]:
        for term, docs, occurrences in con.execute(sql):
            con.execute("INSERT INTO keywords(term,source,document_count,occurrence_count) VALUES(?,?,?,?)", (term, source, docs, occurrences))

    header_docs: Dict[str, set] = collections.defaultdict(set)
    header_count: collections.Counter = collections.Counter()
    for page_url, headers_json in con.execute("SELECT page_url,headers_json FROM tables_data"):
        for term in json.loads(headers_json or "[]"):
            t = clean_text(term).lower()
            if t:
                header_docs[t].add(page_url)
                header_count[t] += 1
    for term, count in header_count.items():
        con.execute("INSERT OR REPLACE INTO keywords(term,source,document_count,occurrence_count) VALUES(?,?,?,?)",
                    (term, "table-header", len(header_docs[term]), count))

    # Corpus terms: broad discoverability, intentionally filtered to avoid boilerplate.
    term_count: collections.Counter = collections.Counter()
    term_docs: collections.Counter = collections.Counter()
    for (text,) in con.execute("SELECT text FROM pages"):
        tokens = [t.lower() for t in TOKEN_RE.findall(text) if len(t) >= 3 and t.lower() not in STOPWORDS]
        c = collections.Counter(tokens)
        term_count.update(c)
        term_docs.update(c.keys())
    ranked = sorted(term_count, key=lambda t: (term_docs[t], term_count[t]), reverse=True)[:top_terms]
    for term in ranked:
        con.execute("INSERT OR REPLACE INTO keywords(term,source,document_count,occurrence_count) VALUES(?,?,?,?)",
                    (term, "corpus-term", term_docs[term], term_count[term]))


def build_catalog(con: sqlite3.Connection) -> Dict[str, Any]:
    def rows(sql: str, args: Tuple[Any, ...] = ()) -> List[Dict[str, Any]]:
        cur = con.execute(sql, args)
        names = [d[0] for d in cur.description]
        return [dict(zip(names, row)) for row in cur]

    counts = {
        "pages": con.execute("SELECT count(*) FROM pages").fetchone()[0],
        "sections": con.execute("SELECT count(*) FROM sections WHERE heading<>''").fetchone()[0],
        "tables": con.execute("SELECT count(*) FROM tables_data").fetchone()[0],
        "facts": con.execute("SELECT count(*) FROM facts").fetchone()[0],
        "links": con.execute("SELECT count(*) FROM links").fetchone()[0],
        "images": con.execute("SELECT count(*) FROM images").fetchone()[0],
        "list_items": con.execute("SELECT count(*) FROM list_items").fetchone()[0],
        "labels": con.execute("SELECT count(*) FROM labels").fetchone()[0],
    }
    return {
        "generatedAt": now_iso(),
        "schema": SCHEMA_VERSION,
        "counts": counts,
        "pageTypes": rows("SELECT type_guess AS type,count(*) AS pages,round(avg(type_confidence),2) AS avgConfidence FROM pages GROUP BY type_guess ORDER BY pages DESC"),
        "topHeadings": rows("SELECT lower(heading) AS term,count(DISTINCT page_url) AS pages,count(*) AS occurrences FROM sections WHERE heading<>'' GROUP BY lower(heading) ORDER BY pages DESC,occurrences DESC LIMIT 300"),
        "topFactKeys": rows("SELECT lower(key) AS term,count(DISTINCT page_url) AS pages,count(*) AS occurrences FROM facts GROUP BY lower(key) ORDER BY pages DESC,occurrences DESC LIMIT 300"),
        "topLabels": rows("SELECT lower(text) AS term,count(DISTINCT page_url) AS pages,count(*) AS occurrences FROM labels GROUP BY lower(text) ORDER BY pages DESC,occurrences DESC LIMIT 300"),
        "topTableHeaders": rows("SELECT term,document_count AS pages,occurrence_count AS occurrences FROM keywords WHERE source='table-header' ORDER BY pages DESC,occurrences DESC LIMIT 300"),
        "topCorpusTerms": rows("SELECT term,document_count AS pages,occurrence_count AS occurrences FROM keywords WHERE source='corpus-term' ORDER BY pages DESC,occurrences DESC LIMIT 500"),
        "tableKinds": rows("SELECT kind,count(*) AS tables FROM tables_data GROUP BY kind ORDER BY tables DESC"),
        "highValueFamilies": HIGH_VALUE_FAMILIES,
    }


def export_json_pages(con: sqlite3.Connection, out_dir: Path) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)
    urls = [r[0] for r in con.execute("SELECT url FROM pages ORDER BY url")]
    for url in urls:
        page = con.execute("SELECT * FROM pages WHERE url=?", (url,)).fetchone()
        cols = [d[1] for d in con.execute("PRAGMA table_info(pages)")]
        payload = dict(zip(cols, page))
        payload["type_reasons"] = json.loads(payload.pop("type_reasons_json"))
        payload["sections"] = [dict(zip(["ord","level","heading","heading_id","path","text"], r)) for r in con.execute("SELECT ord,level,heading,heading_id,path,text FROM sections WHERE page_url=? ORDER BY ord", (url,))]
        payload["facts"] = [dict(zip(["section_ord","key","value","source","table_ord","row_ord","links"], [*r[:-1], json.loads(r[-1])])) for r in con.execute("SELECT section_ord,key,value,source,table_ord,row_ord,links_json FROM facts WHERE page_url=? ORDER BY id", (url,))]
        payload["tables"] = [{"ord":r[0],"section_ord":r[1],"kind":r[2],"caption":r[3],"headers":json.loads(r[4]),"rows":json.loads(r[5])} for r in con.execute("SELECT ord,section_ord,kind,caption,headers_json,rows_json FROM tables_data WHERE page_url=? ORDER BY ord", (url,))]
        payload["links"] = [dict(zip(["section_ord","href","target_url","target_slug","anchor"], r)) for r in con.execute("SELECT section_ord,href,target_url,target_slug,anchor FROM links WHERE page_url=?", (url,))]
        payload["images"] = [dict(zip(["section_ord","src","alt","title"], r)) for r in con.execute("SELECT section_ord,src,alt,title FROM images WHERE page_url=?", (url,))]
        payload["list_items"] = [dict(zip(["section_ord","text","links"], [r[0], r[1], json.loads(r[2])])) for r in con.execute("SELECT section_ord,text,links_json FROM list_items WHERE page_url=?", (url,))]
        payload["labels"] = [dict(zip(["section_ord","tag","text"], r)) for r in con.execute("SELECT section_ord,tag,text FROM labels WHERE page_url=?", (url,))]
        name = re.sub(r"[^a-z0-9._-]+", "-", slug_from_url(url).lower()).strip("-") or "wiki"
        (out_dir / f"{name}.json").write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def main() -> int:
    ap = argparse.ArgumentParser(description="Index the complete RealmEye HTML archive into SQLite + FTS5.")
    ap.add_argument("--monitor-dir", default="local/realmeye-monitor", help="RealmEye monitor root")
    ap.add_argument("--objects-dir", help="Override objects directory")
    ap.add_argument("--snapshot", help="Override latest.json/snapshot path")
    ap.add_argument("--db", default="local/realmeye-monitor/processed/realmeye.sqlite", help="SQLite output")
    ap.add_argument("--catalog", default="local/realmeye-monitor/processed/catalog.json", help="Catalog JSON output")
    ap.add_argument("--changes", default="local/realmeye-monitor/processed/changes.json", help="Changed/removed/unavailable page list for downstream jobs")
    ap.add_argument("--export-json-dir", help="Optional directory for one normalized JSON document per page")
    ap.add_argument("--rebuild", action="store_true", help="Reparse every page even when rawHash is unchanged")
    ap.add_argument("--from-objects-only", action="store_true", help="Ignore latest.json and infer canonical URLs from object HTML")
    ap.add_argument("--top-terms", type=int, default=3000)
    ap.add_argument(
        "--workers", type=int, default=0,
        help="Parallel parser processes; 0=auto (default), 1=serial",
    )
    ap.add_argument(
        "--no-resume-upgrade", action="store_true",
        help="Do not reuse pages already reparsed during an interrupted parser upgrade",
    )
    args = ap.parse_args()

    monitor = Path(args.monitor_dir)
    objects = Path(args.objects_dir) if args.objects_dir else monitor / "objects"
    snapshot = Path(args.snapshot) if args.snapshot else monitor / "latest.json"
    db_path = Path(args.db)
    catalog_path = Path(args.catalog)
    if not objects.exists():
        print(f"Objects directory not found: {objects}", file=sys.stderr)
        return 2

    using_snapshot = snapshot.exists() and not args.from_objects_only
    snapshot_complete = False
    if using_snapshot:
        print(f"RealmEye index: snapshot {snapshot}")
        all_sources, snapshot_complete = sources_from_snapshot(snapshot, objects)
    else:
        print(f"RealmEye index: no snapshot; inferring canonical URLs from {objects}")
        all_sources = sources_from_objects(objects)
    print(f"  source pages: {len(all_sources)}")

    db_path.parent.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(db_path)
    con.row_factory = sqlite3.Row
    ensure_schema(con)
    fts_dirty_row = con.execute("SELECT value FROM meta WHERE key='fts_dirty'").fetchone()
    fts_dirty = bool(fts_dirty_row and str(fts_dirty_row[0]) == "1")
    stored_parser = con.execute("SELECT value FROM meta WHERE key='parser_version'").fetchone()
    parser_upgrade = not stored_parser or str(stored_parser[0]) != str(PARSER_VERSION)
    if parser_upgrade and con.execute("SELECT COUNT(*) FROM pages").fetchone()[0]:
        args.rebuild = True
        print(f"  parser upgrade -> reparsing archive (v{stored_parser[0] if stored_parser else 'none'} -> v{PARSER_VERSION})")

    existing_rows = {
        row["url"]: {"raw_hash": row["raw_hash"], "last_indexed_at": row["last_indexed_at"]}
        for row in con.execute("SELECT url,raw_hash,last_indexed_at FROM pages")
    }
    existing = {url: row["raw_hash"] for url, row in existing_rows.items()}

    # Parser upgrades can be interrupted safely. The previous completed catalog
    # timestamp is written only after a successful indexing pass, while page
    # rows are committed in batches during parsing. Therefore rows newer than
    # that timestamp are the already-completed part of an interrupted upgrade.
    # This is particularly useful on Windows when a full 6k-page reparse is
    # stopped to install a faster indexer.
    completed_catalog = con.execute("SELECT value FROM meta WHERE key='generated_at'").fetchone()
    completed_catalog_at = str(completed_catalog[0]) if completed_catalog else ""
    resumable_upgrade: set[str] = set()
    if parser_upgrade and completed_catalog_at and not args.no_resume_upgrade:
        resumable_upgrade = {
            url for url, row in existing_rows.items()
            if str(row.get("last_indexed_at") or "") > completed_catalog_at
        }
        if resumable_upgrade:
            print(f"  resume upgrade: {len(resumable_upgrade)} pages already reparsed")

    explicit_removed: set[str] = set()
    unavailable: List[Dict[str, Any]] = []
    sources: List[Dict[str, Any]] = []
    present_urls: set[str] = set()
    for src in all_sources:
        url = canonical_wiki_url(src.get("canonical_url")) or src.get("url") or ""
        if url:
            present_urls.add(url)
        status = int(src.get("status") or 0)
        gone = bool(src.get("gone_hint"))
        if gone or status in {404, 410}:
            if url:
                explicit_removed.add(url)
            continue
        if using_snapshot and (status == 0 or status == 429 or status >= 500 or src.get("path") is None):
            unavailable.append({"url": url, "status": status, "error": src.get("error") or ""})
            continue
        if not using_snapshot or 200 <= status < 300:
            if src.get("path") is not None:
                sources.append(src)

    removed = set(explicit_removed)
    if using_snapshot and snapshot_complete:
        # A complete snapshot may omit a formerly known page. Do not turn a transient
        # network/server failure into deletion: those URLs are explicitly preserved above.
        transient_urls = {x["url"] for x in unavailable if x.get("url")}
        removed |= (set(existing) - present_urls) - transient_urls
    for url in removed:
        if url in existing:
            delete_page(con, url)

    changed_urls: List[str] = []
    parsed_count = skipped = errors = 0

    # Filter unchanged/resumed pages before creating worker tasks. During a
    # parser-version rebuild, rows completed by an interrupted upgrade are safe
    # to reuse when their archived HTML hash is unchanged.
    work_sources: List[Dict[str, Any]] = []
    for src in sources:
        preliminary_url = canonical_wiki_url(src.get("canonical_url")) or src["url"]
        same_raw = existing.get(preliminary_url) == src["raw_hash"]
        if not args.rebuild and same_raw:
            skipped += 1
            continue
        if args.rebuild and parser_upgrade and same_raw and preliminary_url in resumable_upgrade:
            skipped += 1
            continue
        work_sources.append(src)

    cpu = os.cpu_count() or 4
    workers = args.workers if args.workers > 0 else min(8, max(2, cpu - 1))
    workers = max(1, workers)
    # Starting worker processes costs more than parsing a handful of pages.
    # Normal incremental crawls therefore stay serial; full reparses fan out.
    if len(work_sources) < 100:
        workers = 1
    print(
        f"  parser workers: {workers}"
        + (" (serial)" if workers == 1 else " processes")
    )

    bulk_fts = bool(args.rebuild and len(work_sources) >= 100)
    if bulk_fts:
        con.execute("INSERT OR REPLACE INTO meta(key,value) VALUES('fts_dirty','1')")
        con.commit()
        fts_dirty = True
    completed = 0
    write_buffer: List[Dict[str, Any]] = []
    write_batch_size = 64

    def flush_buffer() -> None:
        nonlocal parsed_count
        if not write_buffer:
            return
        parsed_count += insert_prepared_batch(con, write_buffer, update_fts=not bulk_fts)
        changed_urls.extend(result["url"] for result in write_buffer if not result.get("skip"))
        write_buffer.clear()

    def consume(result: Dict[str, Any], src_for_error: Dict[str, Any]) -> None:
        nonlocal errors, completed
        completed += 1
        try:
            if result.get("skip"):
                return
            write_buffer.append(result)
            if len(write_buffer) >= write_batch_size:
                flush_buffer()
        except Exception as exc:
            errors += 1
            print(f"\n  ERROR {src_for_error.get('url')}: {exc}", file=sys.stderr)

    def show_progress() -> None:
        done = skipped + completed
        print(
            f"\r  pages {done}/{len(sources)} | parsed {parsed_count + len(write_buffer)} | "
            f"unchanged/resumed {skipped} | errors {errors}",
            end="", flush=True,
        )

    if workers == 1:
        for src in work_sources:
            try:
                consume(prepare_source(src), src)
            except Exception as exc:
                completed += 1
                errors += 1
                print(f"\n  ERROR {src.get('url')}: {exc}", file=sys.stderr)
            if completed % 100 == 0:
                flush_buffer()
                con.commit()
                show_progress()
    else:
        # Send several pages per IPC task. This matters on Windows: spawning is
        # expensive and pickling thousands of individual page dictionaries can
        # otherwise erase much of the gain from parallel parsing.
        worker_batch_size = 8
        batches = [work_sources[i:i + worker_batch_size] for i in range(0, len(work_sources), worker_batch_size)]
        with concurrent.futures.ProcessPoolExecutor(max_workers=workers) as pool:
            future_map = {pool.submit(prepare_batch, batch): batch for batch in batches[:workers * 2]}
            next_batch = workers * 2
            while future_map:
                done_set, _ = concurrent.futures.wait(future_map, return_when=concurrent.futures.FIRST_COMPLETED)
                for future in done_set:
                    batch = future_map.pop(future)
                    try:
                        results = future.result()
                        for result, src in zip(results, batch):
                            consume(result, src)
                    except Exception as exc:
                        # A batch-level exception is rare; retry each page in the
                        # parent so one malformed page does not lose its siblings.
                        for src in batch:
                            try:
                                consume(prepare_source(src), src)
                            except Exception as inner:
                                completed += 1
                                errors += 1
                                print(f"\n  ERROR {src.get('url')}: {inner}", file=sys.stderr)
                    if next_batch < len(batches):
                        more = batches[next_batch]
                        future_map[pool.submit(prepare_batch, more)] = more
                        next_batch += 1
                    if completed and completed % 100 < worker_batch_size:
                        flush_buffer()
                        con.commit()
                        show_progress()
    flush_buffer()
    # Make progress durable before updating the parser-version marker.
    con.commit()
    if bulk_fts or fts_dirty:
        print("\n  rebuilding full-text search index in bulk...")
        rebuild_fts(con)
        con.execute("INSERT OR REPLACE INTO meta(key,value) VALUES('fts_dirty','0')")
        con.commit()
        fts_dirty = False
    con.execute("INSERT OR REPLACE INTO meta(key,value) VALUES('parser_version',?)", (str(PARSER_VERSION),))
    con.commit()
    print()

    catalog_path.parent.mkdir(parents=True, exist_ok=True)
    if parsed_count or removed or not catalog_path.exists():
        print("  rebuilding keyword/catalog aggregates...")
        rebuild_keywords(con, max(100, args.top_terms))
        catalog = build_catalog(con)
        catalog_path.write_text(json.dumps(catalog, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        con.execute("INSERT OR REPLACE INTO meta(key,value) VALUES('generated_at',?)", (catalog["generatedAt"],))
        con.execute("INSERT OR REPLACE INTO meta(key,value) VALUES('catalog_json',?)", (str(catalog_path),))
        con.commit()
    else:
        print("  no indexed data changed; keeping existing keyword/catalog aggregates")

    changes_path = Path(args.changes)
    changes_path.parent.mkdir(parents=True, exist_ok=True)
    changes_payload = {
        "generatedAt": now_iso(),
        "parsed": changed_urls,
        "removed": sorted(removed),
        "unavailable": unavailable,
        "unchanged": skipped,
        "errors": errors,
    }
    changes_path.write_text(json.dumps(changes_payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    if args.export_json_dir:
        print("  exporting normalized per-page JSON...")
        export_json_pages(con, Path(args.export_json_dir))

    con.execute("PRAGMA optimize")
    con.commit()
    con.close()
    print(f"  database: {db_path}")
    print(f"  catalog:  {catalog_path}")
    print(f"  changes:  {changes_path}")
    print(f"  parsed {parsed_count}, unchanged {skipped}, removed {len(removed)}, unavailable {len(unavailable)}, errors {errors}")
    return 0 if errors == 0 else 1


if __name__ == "__main__":
    # Harmless on POSIX; required by some Windows multiprocessing launchers.
    import multiprocessing
    multiprocessing.freeze_support()
    raise SystemExit(main())
