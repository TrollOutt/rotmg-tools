"""Unit tests for pure helpers of the RealmEye pipeline (ROT-B-11).

Standard library only, no network, no local archive: they run on a clean
clone, in CI, with `npm run test:python` (python -m unittest).
"""
import sqlite3
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "tools" / "database"))

from export_realmeye_availability import listed  # noqa: E402
from export_realmeye_enrichment import described_records, row_carriers  # noqa: E402
from realmeye_archive_import import exact_title_candidates, name_key, page_owners, reworked_entities  # noqa: E402


def name_map(entries, shown=None, titles=()):
    """(kind, name) -> uids, keyed the way the importer keys them."""
    table = {}
    for kind, name, uid in entries:
        table.setdefault((kind, name_key(name)), set()).add(uid)
    table["shown"] = {(kind, name_key(name)): {uid} for kind, name, uid in (shown or [])}
    table["titles"] = {name_key(t) for t in titles}
    return table


class ListedTest(unittest.TestCase):
    PAGE = (
        '<ul class="nav"><a href="/wiki/menu-only">Menu</a></ul>'
        '<div class="wiki-page"><p><a href="/wiki/prose-link">Prose</a></p>'
        '<table><tr><td><a href="/wiki/rock-dragon"><img alt="Rock Dragon"></a></td>'
        '<td><a href="/wiki/marble-colossus">Marble &amp; Colossus</a></td></tr></table>'
        '<ul class="nav nav-stacked"><table><a href="/wiki/sidebar">Sidebar</a></table></ul></div>'
    )

    def test_reads_only_the_tables_of_the_page_body(self):
        self.assertEqual(listed(self.PAGE), [("rock-dragon", "Rock Dragon"), ("marble-colossus", "Marble & Colossus")])

    def test_a_page_without_body_lists_nothing(self):
        self.assertEqual(listed("<html><table><a href=\"/wiki/x\">X</a></table></html>"), [])


class ExactTitleCandidatesTest(unittest.TestCase):
    def test_exact_name_wins(self):
        names = name_map([("item", "Doom Bow", "a"), ("item", "Doom Bow x1", "b")], shown=[("item", "Doom Bow", "c")])
        self.assertEqual(exact_title_candidates(names, "item", "Doom Bow"), {"a"})

    def test_shown_name_when_no_record_has_the_title(self):
        names = name_map([], shown=[("item", "Forgotten Relics", "s")])
        self.assertEqual(exact_title_candidates(names, "item", "Forgotten Relics"), {"s"})

    def test_kind_must_match_the_page_type(self):
        names = name_map([("enemy", "Oryx", "e")])
        self.assertEqual(exact_title_candidates(names, "item", "Oryx"), set())

    def test_a_dungeon_page_names_its_portal(self):
        names = name_map([("portal", "Time Chamber Portal", "p")])
        self.assertEqual(exact_title_candidates(names, "dungeon", "Time Chamber"), {"p"})

    def test_original_dungeon_is_the_legacy_portal(self):
        names = name_map([("portal", "Legacy Snake Pit Portal", "l")])
        self.assertEqual(exact_title_candidates(names, "dungeon", "Snake Pit (Original)"), {"l"})

    def test_plain_legacy_portal_only_without_its_own_page(self):
        names = name_map([("portal", "Legacy Abyss", "l")])
        self.assertEqual(exact_title_candidates(names, "dungeon", "Abyss (Original)"), {"l"})
        names = name_map([("portal", "Legacy Abyss", "l")], titles=["Legacy Abyss"])
        self.assertEqual(exact_title_candidates(names, "dungeon", "Abyss (Original)"), set())

    def test_original_enemy_is_the_retro_creature(self):
        names = name_map([("enemy", "Retro Oryx", "r")])
        self.assertEqual(exact_title_candidates(names, "enemy", "Oryx (Original)"), {"r"})

    def test_no_guess_beyond_the_rules(self):
        names = name_map([("item", "Doom Bow", "a")])
        self.assertEqual(exact_title_candidates(names, "item", "Doom Bow (Original)"), set())
        self.assertEqual(exact_title_candidates(names, "item", "Doom"), set())


class ReworkedTest(unittest.TestCase):
    """A page about a creature a rework replaced goes to the one played now."""

    def setUp(self):
        self.con = sqlite3.connect(":memory:")
        self.con.execute("CREATE TABLE entities(entity_uid TEXT, legacy_index_id TEXT)")
        self.con.executemany("INSERT INTO entities VALUES(?,?)", [
            ("old", "enemy:Masquarerader"), ("new", "enemy:The Masquarerader"), ("other", "enemy:Cubyte"),
        ])

    def test_the_retired_record_gives_its_page_to_its_replacement(self):
        table = {"enemy:Masquarerader": "enemy:The Masquarerader"}
        self.assertEqual(reworked_entities(self.con, table), {"old": "new"})

    def test_an_entry_the_index_no_longer_holds_is_left_out(self):
        table = {"enemy:Gone": "enemy:Cubyte", "enemy:Cubyte": "enemy:Never There"}
        self.assertEqual(reworked_entities(self.con, table), {})

    def test_a_page_is_given_to_the_record_named_for_it(self):
        self.assertEqual(page_owners(self.con, {"cubyte": "enemy:Cubyte", "gone": "enemy:Never There"}), {"cubyte": "other"})

    def test_the_shipped_table_reads(self):
        self.assertEqual(reworked_entities(self.con), {"old": "new"})


class RowCarrierTest(unittest.TestCase):
    """A page several creatures answer to resolves to the record carrying the row, or the one it describes."""

    def setUp(self):
        self.con = sqlite3.connect(":memory:")
        self.con.executescript(
            "CREATE TABLE entities(entity_uid TEXT, kind TEXT, legacy_index_id TEXT);"
            "CREATE TABLE facts(entity_uid TEXT, field_path TEXT, value_json TEXT);"
            "CREATE TABLE browse_groups(group_uid TEXT, representative_entity_uid TEXT);"
            "CREATE TABLE browse_group_members(group_uid TEXT, entity_uid TEXT, is_representative INTEGER);"
        )

    def group(self, carrier, *members, kind="enemy"):
        """Each record is (uid, Index id, life, defence); the first carries the row."""
        self.con.execute("INSERT INTO browse_groups VALUES(?,?)", (carrier[0], carrier[0]))
        for uid, legacy, life, defence in (carrier, *members):
            self.con.execute("INSERT INTO entities VALUES(?,?,?)", (uid, kind, legacy))
            for field, value in (("hp", life), ("def", defence)):
                if value is not None:
                    self.con.execute("INSERT INTO facts VALUES(?,?,?)", (uid, field, str(value)))
            self.con.execute("INSERT INTO browse_group_members VALUES(?,?,?)", (carrier[0], uid, int(uid == carrier[0])))

    def test_a_folded_creature_follows_the_record_carrying_its_row(self):
        self.group(("n", "enemy:Cube God#New Cube God", 45000, 40), ("o", "enemy:Cube God", 16000, 40))
        self.assertEqual(row_carriers(self.con), {"enemy:Cube God": "enemy:Cube God#New Cube God"})

    def test_items_are_left_alone(self):
        self.group(("a", "item:Doom Bow", None, None), ("b", "item:Doom Bow#Retro", None, None), kind="item")
        self.assertEqual(row_carriers(self.con), {})

    def test_the_page_names_the_creature_whose_life_it_states(self):
        self.group(("o2", "enemy:Oryx the Mad God#Oryx the Mad God 2", 100000, 60),
                   ("o3", "enemy:Oryx the Mad God#Oryx the Mad God 3", 562500, 75),
                   ("h", "enemy:Oryx the Mad God#Helper", None, None))
        stated = {"Oryx the Mad God 3": [[562500, 75]], "Nobody": [[1, None]], "Loose": [[100000, None]]}
        found = described_records(self.con, stated)
        self.assertEqual(found["Oryx the Mad God 3"], {"enemy:Oryx the Mad God#Oryx the Mad God 3"})
        self.assertEqual(found["Loose"], {"enemy:Oryx the Mad God#Oryx the Mad God 2"})
        self.assertNotIn("Nobody", found)

    def test_a_different_defence_is_not_a_match(self):
        self.group(("a", "enemy:Fate", 7500, 30))
        self.assertEqual(dict(described_records(self.con, {"Fate": [[7500, 15]]})), {})


if __name__ == "__main__":
    unittest.main()
