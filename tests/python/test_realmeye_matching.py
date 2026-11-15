"""Unit tests for pure helpers of the RealmEye pipeline (ROT-B-11).

Standard library only, no network, no local archive: they run on a clean
clone, in CI, with `npm run test:python` (python -m unittest).
"""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "tools" / "database"))

from export_realmeye_availability import listed  # noqa: E402
from realmeye_archive_import import exact_title_candidates, name_key  # noqa: E402


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


if __name__ == "__main__":
    unittest.main()
