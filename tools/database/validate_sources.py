"""Cross-source validation: the published Index, RealmEye, and the client scrape.

    npm run validate            # or: python tools/database/validate_sources.py

The Index is built from the client; RealmEye pages are joined to its records by
name. A join can land on the wrong client object - a retired copy a rework left
behind, a helper carrying the same display name - and nothing in the build
notices: every file is well formed and the card simply shows the wrong creature.
This reads the three sources side by side and reports where they disagree.

Sources (the first two are required, the others widen the checks when present):
  data/Index/index.json, data/Index/realmeye-enrichment.json   what the site shows
  local/realmeye-monitor/processed/realmeye.sqlite              what RealmEye says
  client-data/Objects.*.xml                                     the last client scrape

Checks:
  enemy-stats    RealmEye's HP/DEF against the record that carries its page
  enemy-attacks  the shots RealmEye pictures against the shots the client gives that record
  item-stats     RealmEye's tier and "On Equip" against the item record
  folded-target  a wiki relation pointing at a record folded into a different-looking one
  client-drift   Index records against the scraped client objects they were read from

Severity: ERROR = the site shows the wrong thing and the sources say which is
right; WARN = the sources disagree and a person has to say who is right; INFO =
context. A person's verdict on a finding lives in tools/validation-review.json
(npm run review shows each finding beside the site and records it): "ok" keeps
the finding quiet, "error" makes it an ERROR until the data is fixed. A verdict
holds for the exact message it was given on; when the finding changes, it is
asked again. Exit code 1 while an ERROR is not answered "ok".
"""
from __future__ import annotations

import argparse
import json
import re
import sqlite3
import sys
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
INDEX = ROOT / "data/Index/index.json"
ENRICHMENT = ROOT / "data/Index/realmeye-enrichment.json"
ARCHIVE = ROOT / "local/realmeye-monitor/processed/realmeye.sqlite"
CLIENT = ROOT / "client-data"
REVIEW = ROOT / "tools/validation-review.json"
REPORT_DIR = ROOT / "local/validation"

ORDER = {"ERROR": 0, "WARN": 1, "INFO": 2}


def number(text):
    """'40,000 ( Boss ...' -> 40000; '-' or nothing -> None."""
    found = re.match(r"\s*(-?\d[\d,]*)", str(text or ""))
    return int(found.group(1).replace(",", "")) if found else None


def enemy_stats(value):
    """RealmEye's 'HP' / 'Base HP' fact -> (hp, def), either None when not stated."""
    text = str(value or "")
    defence = re.search(r"DEF:\s*(-?\d[\d,]*)", text)
    return number(text), (int(defence.group(1).replace(",", "")) if defence else None)


STAT = {"HP": "MAXHP", "MP": "MAXMP", "ATT": "ATT", "DEF": "DEF", "SPD": "SPD", "DEX": "DEX", "VIT": "VIT", "WIS": "WIS"}


def on_equip(value):
    """'+80 HP, +5 DEX' -> {'MAXHP': 80, 'DEX': 5}; None when a part cannot be read."""
    out = {}
    for part in re.split(r",", str(value or "")):
        part = part.strip()
        if not part:
            continue
        found = re.fullmatch(r"([+-]\s*\d+)\s*([A-Za-z]+)", part)
        if not found or found.group(2).upper() not in STAT:
            return None
        out[STAT[found.group(2).upper()]] = out.get(STAT[found.group(2).upper()], 0) + int(found.group(1).replace(" ", ""))
    return out


def name_key(value):
    return re.sub(r"[^a-z0-9]+", "", str(value or "").lower())


def plain_name(value):
    """A name without its leading article: "The Masquarerader" and "Masquarerader" are one name."""
    return name_key(re.sub(r"^\s*the\s+", "", str(value or ""), flags=re.I))


class Sources:
    def __init__(self, index, enrichment, archive=None, client=None):
        self.index = index
        self.records = {one["id"]: one for one in index["records"]}
        self.enrichment = enrichment
        self.page_ids = {slug: list(ids) for slug, ids in (enrichment.get("pageIndex") or {}).items()}
        self.archive = archive          # {"facts": {slug: {key: [values]}}, "attacks": {slug: set}, "types": {slug: type}}
        self.client = client            # {"build": str, "objects": {type int: {...}}}
        self.notes = []
        self._linked = None

    def final(self, record):
        """The record whose row a folded record is shown under."""
        seen = set()
        while record and record.get("folded") and record["id"] not in seen:
            seen.add(record["id"])
            carrier = self.records.get(record["folded"])
            if carrier is None:
                break                     # folded into a record the Index no longer holds: it stands for itself
            record = carrier
        return record

    def shown(self, slug, kind):
        """The records of `kind` the site shows for a page (normally one).

        A card draws the record a wiki relation names (a dungeon's stop, a
        drop's source); where no relation names the page, its row in the
        browse list, which is the record the others are folded into.
        """
        if self._linked is None:
            self._linked = defaultdict(list)
            for item in self.enrichment["records"].values():
                refs = [(one.get("toRealmEye"), one.get("to")) for one in item.get("relations") or []]
                refs += [(ref.get("slug"), ref.get("to")) for row in item.get("dropRows") or []
                         for side in ("items", "sources") for ref in row.get(side, [])]
                for page, rid in refs:
                    if page and rid in self.records and self.records[rid] not in self._linked[page]:
                        self._linked[page].append(self.records[rid])
        linked = [record for record in self._linked.get(slug, []) if record.get("kind") == kind]
        if linked:
            return linked
        own = self.page_records(slug, kind)
        if len(own) == 1:
            return own                    # the page's one record: its own card, even folded under a wider row
        out = []
        for rid in self.page_ids.get(slug, []):
            record = self.final(self.records.get(rid))
            if record and record.get("kind") == kind and record not in out:
                out.append(record)
        return out

    def page_records(self, slug, kind):
        return [self.records[rid] for rid in self.page_ids.get(slug, [])
                if rid in self.records and self.records[rid].get("kind") == kind]

    def facts(self, slug):
        """RealmEye's facts for a page, from the archive (empty without it)."""
        return (self.archive or {}).get("facts", {}).get(slug, {})

    def fact(self, slug, *keys):
        facts = self.facts(slug)
        wanted = {name_key(key) for key in keys}
        return [value for key, values in facts.items() if name_key(key) in wanted for value in values]

    def client_object(self, record):
        if not self.client or not record.get("from"):
            return None
        return self.client["objects"].get(int(record["from"][1], 16))


def label(record):
    alias = record.get("alias")
    return record["id"] + (f" [client id {alias}]" if alias else "")


# ---------------------------------------------------------------- checks

def check_enemy_stats(src):
    """RealmEye's HP/DEF against the record carrying the page."""
    if src.archive is None:
        src.notes.append("enemy-stats: skipped (needs the RealmEye archive: the published enrichment merges a record's pages)")
        return []
    findings = []
    by_name = defaultdict(list)
    for record in src.records.values():
        if record.get("kind") == "enemy" and record.get("hp") is not None:
            by_name[plain_name(record["name"])].append(record)
    compared = 0
    for slug in sorted(src.page_ids):
        shown = src.shown(slug, "enemy")
        if not shown:
            continue
        stated = [enemy_stats(value) for value in src.fact(slug, "HP", "Base HP")]
        stated = [one for one in stated if one[0] is not None]
        if not stated:
            continue
        compared += 1
        agrees = lambda record: any(record.get("hp") == hp and (defence is None or record.get("def") is None
                                                               or record.get("def") == defence) for hp, defence in stated)
        if any(agrees(record) for record in shown):
            continue
        said = " / ".join(f"{hp:,} HP" + (f", {defence} DEF" if defence is not None else "") for hp, defence in stated)
        has = "; ".join(label(r) + ": " + (f"{r['hp']:,} HP" if r.get("hp") is not None else "no HP")
                        + (f", {r['def']} DEF" if r.get("def") is not None else "") for r in shown)
        others = [r for r in src.page_records(slug, "enemy") if r not in shown and agrees(r)]
        if not others:
            keys = {plain_name(r["name"]) for r in shown}
            others = [r for key in keys for r in by_name.get(key, []) if r not in shown and agrees(r)]
        data = {"page": slug, "stated": [list(one) for one in stated],
                "shown": [r["id"] for r in shown], "candidates": [r["id"] for r in others[:4]]}
        if others:
            findings.append(("ERROR", "enemy-stats", f"{slug}|{shown[0]['id']}",
                             f"RealmEye '{slug}' says {said}. The site shows {has}. "
                             f"Another client record matches RealmEye: {', '.join(label(r) for r in others[:4])}.", data))
        else:
            findings.append(("WARN", "enemy-stats", f"{slug}|{shown[0]['id']}",
                             f"RealmEye '{slug}' says {said}. The site shows {has}. No client record of that name matches.", data))
    src.notes.append(f"enemy-stats: {compared} enemy pages state HP and were compared")
    return findings


def check_enemy_attacks(src):
    """The shots RealmEye pictures against the client's projectiles for the shown record."""
    if src.archive is None or src.client is None:
        src.notes.append("enemy-attacks: skipped (needs the RealmEye archive and client-data)")
        return []
    findings = []
    owners = defaultdict(set)             # projectile name -> client enemy types firing it
    for kind, one in src.client["objects"].items():
        if one["enemy"]:
            for shot in one["shots"]:
                owners[shot].add(kind)
    by_type = {}
    for record in src.records.values():
        if record.get("kind") == "enemy" and record.get("from"):
            by_type.setdefault(int(record["from"][1], 16), record)
    compared = 0
    for slug in sorted(src.archive["attacks"]):
        pictured = {name for name in src.archive["attacks"][slug] if name in owners}
        if len(pictured) < 2:
            continue                      # too little to tell objects apart
        candidates = src.page_records(slug, "enemy")
        if not candidates:
            continue
        compared += 1
        fired = set()
        for record in candidates:
            thing = src.client_object(record)
            if thing:
                fired |= thing["shots"]
        if fired & pictured:
            continue
        tally = defaultdict(int)
        for shot in pictured:
            for kind in owners[shot]:
                tally[kind] += 1
        best = sorted(tally.items(), key=lambda item: (-item[1], item[0]))[:3]
        strong = [(kind, count) for kind, count in best if count >= max(2, len(pictured) // 2)]
        named = ", ".join((label(by_type[kind]) if kind in by_type else src.client["objects"][kind]["id"]) + f" ({count} of {len(pictured)})"
                          for kind, count in (strong or best))
        findings.append(("ERROR" if strong else "WARN", "enemy-attacks", f"{slug}|{candidates[0]['id']}",
                         f"RealmEye '{slug}' pictures shots ({', '.join(sorted(pictured)[:4])}...) that none of its "
                         f"{len(candidates)} record(s) fires ({label(src.final(candidates[0]))}). They belong to: {named}.",
                         {"page": slug, "shots": sorted(pictured), "shown": [src.final(candidates[0])["id"]],
                          "candidates": [by_type[kind]["id"] for kind, _ in (strong or best) if kind in by_type]}))
    src.notes.append(f"enemy-attacks: {compared} enemy pages picture client shots and were compared")
    return findings


def check_item_stats(src):
    """RealmEye's tier and On Equip against the item record."""
    if src.archive is None:
        src.notes.append("item-stats: skipped (needs the RealmEye archive)")
        return []
    findings = []
    compared = 0
    for slug in sorted(src.page_ids):
        shown = src.shown(slug, "item")
        if len(shown) != 1:
            continue
        record = shown[0]
        problems = []
        tiers = src.fact(slug, "Tier")
        if tiers and record.get("tier") is not None:
            stated = re.fullmatch(r"T?(\d+)", tiers[0].strip())
            if stated and int(stated.group(1)) != record["tier"]:
                problems.append(f"tier {tiers[0].strip()} on RealmEye, {record['tier']} in the client")
        equips = src.fact(slug, "On Equip")
        if len(equips) == 1 and record.get("worn") is not None:
            stated = on_equip(equips[0])
            worn = {key: value for key, value in record["worn"].items() if key in STAT.values()}
            if stated is not None and stated != worn:
                problems.append(f"On Equip '{equips[0].strip()}' on RealmEye, {json.dumps(worn, sort_keys=True)} in the client")
        if tiers or equips:
            compared += 1
        if problems:
            others = [r for r in src.page_records(slug, "item") if r is not record]
            findings.append(("WARN", "item-stats", f"{slug}|{record['id']}",
                             f"RealmEye '{slug}' vs {label(record)}: " + "; ".join(problems)
                             + (f". The page also answers to {len(others)} other record(s)." if others else "."),
                             {"page": slug, "shown": [record["id"]], "candidates": [r["id"] for r in others[:4]],
                              "problems": problems}))
    src.notes.append(f"item-stats: {compared} item pages state a tier or On Equip and were compared")
    return findings


def check_folded_targets(src):
    """A wiki relation that points at a folded record which does not look like its carrier."""
    findings = []
    targets = defaultdict(set)
    for rid, item in src.enrichment["records"].items():
        for relation in item.get("relations") or []:
            if relation.get("to"):
                targets[relation["to"]].add(rid)
    for target in sorted(targets):
        record = src.records.get(target)
        if not record or not record.get("folded"):
            continue
        carrier = src.final(record)
        differs = [field for field in ("art", "hp", "def") if record.get(field) != carrier.get(field)]
        if not differs:
            continue
        findings.append(("WARN", "folded-target", target,
                         f"{len(targets[target])} wiki relation(s) point at {label(record)}, which is folded into "
                         f"{label(carrier)} and differs from it in {', '.join(differs)}: cards show the folded one.",
                         {"shown": [target], "candidates": [carrier["id"]], "from": sorted(targets[target])[:8]}))
    return findings


def check_client_drift(src):
    """Index records against the scraped client objects they were read from."""
    if src.client is None:
        src.notes.append("client-drift: skipped (no client-data)")
        return []
    same_build = src.client.get("build") == (src.index.get("from") or {}).get("build")
    level = "ERROR" if same_build else "INFO"
    if not same_build:
        src.notes.append(f"client-drift: client-data is build {src.client.get('build')} and the Index is build "
                         f"{(src.index.get('from') or {}).get('build')}: differences are reported as INFO, not errors")
    findings = []
    compared = 0
    for record in src.index["records"]:
        if record.get("kind") != "enemy":
            continue
        thing = src.client_object(record)
        if thing is None:
            if record.get("from"):
                findings.append((level, "client-drift", record["id"],
                                 f"{label(record)} names client type {record['from'][1]}, which the scrape does not hold.",
                                 {"shown": [record["id"]]}))
            continue
        compared += 1
        problems = []
        if thing["id"] != (record.get("alias") or record["name"]):
            problems.append(f"client id '{thing['id']}' in the scrape")
        for field, key in (("hp", "hp"), ("def", "def")):
            if record.get(field) is not None and thing[key] is not None and record[field] != thing[key]:
                problems.append(f"{field} {record[field]:,} in the Index, {thing[key]:,} in the scrape")
        if problems:
            findings.append((level, "client-drift", record["id"], f"{label(record)}: " + "; ".join(problems) + ".",
                             {"shown": [record["id"]]}))
    src.notes.append(f"client-drift: {compared} enemy records compared with the scrape")
    return findings


CHECKS = [check_enemy_stats, check_enemy_attacks, check_item_stats, check_folded_targets, check_client_drift]


# ---------------------------------------------------------------- loading

def load_archive(path: Path):
    con = sqlite3.connect(f"file:{path.as_posix()}?mode=ro", uri=True)
    facts = defaultdict(lambda: defaultdict(list))
    for slug, key, value in con.execute(
        "SELECT p.slug,f.key,f.value FROM facts f JOIN pages p ON p.url=f.page_url ORDER BY f.id"
    ):
        facts[slug][key].append(value)
    attacks = defaultdict(set)
    for slug, rows in con.execute(
        "SELECT p.slug,t.rows_json FROM tables_data t JOIN pages p ON p.url=t.page_url "
        "WHERE p.type_guess='enemy' AND t.headers_json LIKE '[\"Aesthetics\"%'"
    ):
        for row in json.loads(rows)[1:]:
            if not row:
                continue
            cell = row[0]
            for image in cell.get("images") or []:
                name = (image.get("alt") or image.get("title") or "").strip() if isinstance(image, dict) else ""
                if name:
                    attacks[slug].add(name)
            if (cell.get("text") or "").strip():
                attacks[slug].add(cell["text"].strip())
    con.close()
    return {"facts": facts, "attacks": attacks}


def load_client(directory: Path):
    origin = {}
    if (directory / "provenance.json").is_file():
        origin = json.loads((directory / "provenance.json").read_text(encoding="utf-8")).get("from") or {}
    objects = {}
    for file in sorted(directory.glob("Objects.*.xml")):
        text = file.read_text(encoding="utf-8", errors="replace")
        for found in re.finditer(r"<Object\b([^>]*)>(.*?)</Object>", text, re.S):
            head, body = found.group(1), found.group(2)
            kind = re.search(r'\btype="(0x[0-9a-fA-F]+|\d+)"', head)
            name = re.search(r'\bid="([^"]*)"', head)
            if not kind or not name:
                continue
            number_of = int(kind.group(1), 16) if kind.group(1).lower().startswith("0x") else int(kind.group(1))
            if number_of in objects:
                continue
            hp = re.search(r"<MaxHitPoints>\s*(-?\d+)", body)
            defence = re.search(r"<Defense>\s*(-?\d+)", body)
            objects[number_of] = {
                "id": name.group(1),
                "enemy": bool(re.search(r"<Enemy\s*/>", body)),
                "hp": int(hp.group(1)) if hp else None,
                "def": int(defence.group(1)) if defence else None,
                "shots": set(re.findall(r"<Projectile\b[^>]*>\s*(?:<[^>]+>[^<]*</[^>]+>\s*)*?<ObjectId>([^<]+)</ObjectId>", body)),
            }
    return {"build": origin.get("build"), "objects": objects}


def load(index=INDEX, enrichment=ENRICHMENT, archive=ARCHIVE, client=CLIENT):
    src = Sources(
        json.loads(Path(index).read_text(encoding="utf-8")),
        json.loads(Path(enrichment).read_text(encoding="utf-8")),
        load_archive(Path(archive)) if archive and Path(archive).is_file() else None,
        load_client(Path(client)) if client and any(Path(client).glob("Objects.*.xml")) else None,
    )
    if src.archive is None:
        src.notes.append("RealmEye archive not found: stats come from the published enrichment only (fewer pages)")
    return src


# ---------------------------------------------------------------- report

def run(src, verdicts=None):
    """Every finding, with a person's verdict applied where it was given on this exact message.

    "ok" makes it `accepted` (kept quiet); "error" makes it an ERROR marked
    `confirmed`. A verdict given on another message is reported as `stale`.
    """
    verdicts = verdicts or {}
    findings = []
    for check in CHECKS:
        for level, name, key, message, *rest in check(src):
            one = {"level": level, "check": name, "key": key, "message": message,
                   "data": rest[0] if rest else {}, "accepted": None}
            verdict = verdicts.get(f"{name}|{key}")
            if verdict and verdict.get("message") == message:
                one["verdict"] = verdict.get("verdict")
                if verdict.get("verdict") == "ok":
                    one["accepted"] = verdict.get("note") or "reviewed: no error"
                elif verdict.get("verdict") == "error":
                    one["level"] = "ERROR"
                    one["confirmed"] = verdict.get("note") or "reviewed: error"
            elif verdict:
                one["stale"] = verdict.get("verdict")
            findings.append(one)
    findings.sort(key=lambda one: (ORDER[one["level"]], one["check"], one["key"]))
    return findings


def page_details(archive, slugs):
    """Title, address, date, stated facts and pictures of the RealmEye pages the findings name."""
    if not archive or not Path(archive).is_file() or not slugs:
        return {}
    con = sqlite3.connect(f"file:{Path(archive).as_posix()}?mode=ro", uri=True)
    out = {}
    for slug in sorted(slugs):
        page = con.execute("SELECT url,title,version_marker,date_marker FROM pages WHERE slug=?", (slug,)).fetchone()
        if not page:
            continue
        url, title, version, date = page
        stem = str(title).lower().split(" (")[0]
        images, seen = [], set()
        for source, alt in con.execute("SELECT src,alt FROM images WHERE page_url=? ORDER BY id", (url,)):
            alt = (alt or "").strip()
            if source in seen or not alt.lower().startswith(stem):
                continue
            seen.add(source)
            images.append({"src": source if source.startswith("http") else "https://www.realmeye.com" + source, "alt": alt})
            if len(images) == 8:
                break
        facts = [{"key": key, "value": value} for key, value in con.execute(
            "SELECT key,value FROM facts WHERE page_url=? AND key IN ('HP','Base HP','Tier','On Equip') ORDER BY id",
            (url,))]
        out[slug] = {"title": title, "url": url, "version": version, "date": date, "images": images, "facts": facts}
    con.close()
    return out


def read_verdicts(path):
    path = Path(path)
    return json.loads(path.read_text(encoding="utf-8")).get("verdicts", {}) if path.is_file() else {}


def summary(findings):
    counts = defaultdict(lambda: defaultdict(int))
    for one in findings:
        counts[one["check"]]["accepted" if one["accepted"] else one["level"]] += 1
    return counts


def markdown(findings, notes):
    lines = ["# Cross-source validation", "", "Index vs RealmEye vs client scrape.", ""]
    lines += ["## What was compared", ""] + [f"- {note}" for note in notes] + [""]
    for level in ("ERROR", "WARN", "INFO"):
        rows = [one for one in findings if one["level"] == level and not one["accepted"]]
        if not rows:
            continue
        lines += [f"## {level} ({len(rows)})", ""]
        for one in rows:
            said = f" (confirmed: {one['confirmed']})" if one.get("confirmed") else ""
            lines.append(f"- `{one['check']}` {one['message']}{said}  \n  key: `{one['check']}|{one['key']}`")
        lines.append("")
    kept = [one for one in findings if one["accepted"]]
    if kept:
        lines += [f"## Accepted ({len(kept)})", ""] + [f"- `{one['check']}|{one['key']}`: {one['accepted']}" for one in kept] + [""]
    return "\n".join(lines) + "\n"


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--index", default=str(INDEX))
    parser.add_argument("--enrichment", default=str(ENRICHMENT))
    parser.add_argument("--archive", default=str(ARCHIVE))
    parser.add_argument("--client-data", default=str(CLIENT))
    parser.add_argument("--review", default=str(REVIEW), help="the verdicts file npm run review writes")
    parser.add_argument("--report-dir", default=str(REPORT_DIR), help="where report.md and report.json go ('' for none)")
    parser.add_argument("--show", type=int, default=12, help="findings printed per level")
    parser.add_argument("--no-fail", action="store_true", help="exit 0 even with errors")
    args = parser.parse_args(argv)

    src = load(args.index, args.enrichment, args.archive, args.client_data)
    findings = run(src, read_verdicts(args.review))

    print("\n  Cross-source validation: Index vs RealmEye vs client scrape\n")
    for note in src.notes:
        print("  - " + note)
    print()
    counts = summary(findings)
    for name in sorted(counts):
        print(f"  {name:14}" + "  ".join(f"{counts[name].get(level, 0):5} {level}" for level in ("ERROR", "WARN", "INFO", "accepted")))
    for level in ("ERROR", "WARN"):
        rows = [one for one in findings if one["level"] == level and not one["accepted"]]
        if rows:
            print(f"\n  {level} ({len(rows)}), first {min(len(rows), args.show)}:")
            for one in rows[: args.show]:
                print(f"    [{one['check']}] {one['message']}")
    if args.report_dir:
        out = Path(args.report_dir)
        out.mkdir(parents=True, exist_ok=True)
        (out / "report.md").write_text(markdown(findings, src.notes), encoding="utf-8")
        pages = page_details(args.archive, {one["data"].get("page") for one in findings if one["data"].get("page")})
        sources = {"index": src.index.get("from"), "client": (src.client or {}).get("build")}
        (out / "report.json").write_text(json.dumps({"notes": src.notes, "sources": sources, "findings": findings,
                                                     "pages": pages}, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
        print(f"\n  full report: {out / 'report.md'}")
    errors = [one for one in findings if one["level"] == "ERROR" and not one["accepted"]]
    waiting = [one for one in findings if one["level"] == "WARN" and not one["accepted"] and not one.get("verdict")]
    stale = [one for one in findings if one.get("stale")]
    print(f"\n  {len(errors)} error(s) to fix or accept, {len(waiting)} warning(s) nobody has looked at"
          + (f", {len(stale)} verdict(s) given on an older message" if stale else "") + ".")
    print("  Look at them beside the site: npm run review\n")
    return 1 if errors and not args.no_fail else 0


if __name__ == "__main__":
    sys.exit(main())
