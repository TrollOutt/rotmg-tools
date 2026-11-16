"""Unit tests for the cross-source validator (tools/database/validate_sources.py).

Standard library only, no network, no repo data files: every source is a tiny
in-memory fixture, so they run on a clean clone with `python -m unittest`.
"""
import contextlib
import io
import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "tools" / "database"))

import validate_sources as vs  # noqa: E402
from validate_sources import Sources  # noqa: E402


def enemy(rid, name=None, **extra):
    return {"id": rid, "kind": "enemy", "name": name or rid, **extra}


def item(rid, **extra):
    return {"id": rid, "kind": "item", "name": rid, **extra}


def make(records, pages=None, enrichment_records=None, archive=None, client=None, build="b1"):
    index = {"from": {"build": build}, "records": records}
    enrichment = {"pageIndex": pages or {}, "records": enrichment_records or {}}
    return Sources(index, enrichment, archive, client)


def hp_archive(slug, *values):
    return {"facts": {slug: {"HP": list(values)}}, "attacks": {}}


def client_of(objects, build="b1"):
    return {"build": build, "objects": objects}


def thing(name, shots=(), enemy_=True, hp=None, defence=None):
    return {"id": name, "enemy": enemy_, "hp": hp, "def": defence, "shots": set(shots)}


class ParsersTest(unittest.TestCase):
    def test_number(self):
        self.assertEqual(vs.number("40,000 ( Boss Adaptive HP Scaling )"), 40000)
        self.assertEqual(vs.number("  -5 x"), -5)
        self.assertIsNone(vs.number("-"))
        self.assertIsNone(vs.number(None))
        self.assertIsNone(vs.number(""))

    def test_enemy_stats_formats(self):
        self.assertEqual(vs.enemy_stats("40,000 ( Boss Adaptive HP Scaling ) DEF: 25 EXP: 2,500"), (40000, 25))
        self.assertEqual(vs.enemy_stats("1,600 DEF: 0 EXP: 400"), (1600, 0))
        self.assertEqual(vs.enemy_stats("- DEF: - EXP: -"), (None, None))
        self.assertEqual(vs.enemy_stats(None), (None, None))

    def test_on_equip(self):
        self.assertEqual(vs.on_equip("+80 HP, +5 DEX"), {"MAXHP": 80, "DEX": 5})
        self.assertEqual(vs.on_equip("-3 DEF"), {"DEF": -3})
        self.assertEqual(vs.on_equip("+5 HP, +5 HP"), {"MAXHP": 10})
        self.assertEqual(vs.on_equip(""), {})

    def test_on_equip_unreadable_part_is_none(self):
        self.assertIsNone(vs.on_equip("+5 DEX, bonus"))
        self.assertIsNone(vs.on_equip("+5 Foo"))
        self.assertIsNone(vs.on_equip("5 HP"))


class EnemyStatsTest(unittest.TestCase):
    FACT = "1,600 DEF: 0 EXP: 400"

    def test_shown_record_agrees(self):
        src = make([enemy("a", hp=1600, **{"def": 0})], {"boss": ["a"]}, archive=hp_archive("boss", self.FACT))
        self.assertEqual(vs.check_enemy_stats(src), [])
        self.assertTrue(any("1 enemy pages" in note for note in src.notes))

    def test_folded_plain_record_is_judged_by_its_carrier(self):
        src = make([enemy("plain", hp=5, folded="carrier"), enemy("carrier", hp=1600, **{"def": 0})],
                   {"boss": ["plain", "carrier"]}, archive=hp_archive("boss", self.FACT))
        self.assertEqual(vs.check_enemy_stats(src), [])

    def test_a_page_with_one_record_is_judged_by_that_record_even_folded(self):
        src = make([enemy("five", hp=1600, folded="row", **{"def": 0}), enemy("row", hp=5)],
                   {"boss": ["five"]}, archive=hp_archive("boss", self.FACT))
        self.assertEqual(vs.check_enemy_stats(src), [])

    def test_twin_on_the_same_page_agrees_is_an_error(self):
        src = make([enemy("a", hp=1000), enemy("twin", hp=1600, folded="c"), enemy("c", hp=1000)],
                   {"boss": ["a", "twin"]}, archive=hp_archive("boss", self.FACT))
        found = vs.check_enemy_stats(src)
        self.assertEqual(len(found), 1)
        level, check, key, message, data = found[0]
        self.assertEqual((level, check, key), ("ERROR", "enemy-stats", "boss|a"))
        self.assertIn("twin", message)
        self.assertEqual(data["page"], "boss")
        self.assertEqual(data["stated"], [[1600, 0]])
        self.assertEqual(data["shown"], ["a", "c"])
        self.assertEqual(data["candidates"], ["twin"])

    def test_the_prefixed_name_elsewhere_agrees_is_an_error(self):
        src = make([enemy("oryx", "Oryx", hp=1000), enemy("theoryx", "The Oryx", hp=1600)],
                   {"boss": ["oryx"]}, archive=hp_archive("boss", self.FACT))
        found = vs.check_enemy_stats(src)
        self.assertEqual([f[0] for f in found], ["ERROR"])
        self.assertIn("theoryx", found[0][3])

    def test_nobody_agrees_is_a_warning(self):
        src = make([enemy("a", hp=1000)], {"boss": ["a"]}, archive=hp_archive("boss", self.FACT))
        found = vs.check_enemy_stats(src)
        self.assertEqual([f[0] for f in found], ["WARN"])
        self.assertIn("No client record", found[0][3])

    def test_page_without_hp_fact_is_ignored(self):
        archive = {"facts": {"boss": {"Location": ["X"]}}, "attacks": {}}
        src = make([enemy("a", hp=1000)], {"boss": ["a"]}, archive=archive)
        self.assertEqual(vs.check_enemy_stats(src), [])
        archive = hp_archive("boss", "- DEF: - EXP: -")
        src = make([enemy("a", hp=1000)], {"boss": ["a"]}, archive=archive)
        self.assertEqual(vs.check_enemy_stats(src), [])

    def test_defence_is_compared_only_when_both_sides_state_it(self):
        src = make([enemy("a", hp=1600, **{"def": 9})], {"boss": ["a"]}, archive=hp_archive("boss", self.FACT))
        self.assertEqual([f[0] for f in vs.check_enemy_stats(src)], ["WARN"])
        src = make([enemy("a", hp=1600)], {"boss": ["a"]}, archive=hp_archive("boss", self.FACT))
        self.assertEqual(vs.check_enemy_stats(src), [])

    def test_without_archive_the_check_is_skipped_and_says_so(self):
        src = make([enemy("a", hp=1000)], {"boss": ["a"]},
                   enrichment_records={"a": {"facts": {"HP": self.FACT}}})
        self.assertEqual(vs.check_enemy_stats(src), [])
        self.assertTrue(any("enemy-stats: skipped" in note for note in src.notes))

    def test_item_stats_without_archive_is_skipped_too(self):
        src = make([item("sword", tier=5)], {"sword": ["sword"]})
        self.assertEqual(vs.check_item_stats(src), [])
        self.assertTrue(any("item-stats: skipped" in note for note in src.notes))


class EnemyAttacksTest(unittest.TestCase):
    def setUp(self):
        self.records = [enemy("wrong", **{"from": [0, "0x2"]}), enemy("right", **{"from": [0, "0x1"]})]
        self.pages = {"boss": ["wrong"]}
        self.pictured = {"boss": {"Shot A", "Shot B"}}

    def archive(self, attacks=None):
        return {"facts": {}, "attacks": attacks if attacks is not None else self.pictured}

    def test_skipped_without_archive_or_client(self):
        client = client_of({1: thing("Right", {"Shot A", "Shot B"})})
        for archive, cl in ((None, client), (self.archive(), None)):
            src = make(self.records, self.pages, archive=archive, client=cl)
            self.assertEqual(vs.check_enemy_attacks(src), [])
            self.assertTrue(any("enemy-attacks: skipped" in note for note in src.notes))

    def test_error_when_another_enemy_fires_all_the_pictured_shots(self):
        client = client_of({1: thing("Right", {"Shot A", "Shot B"}), 2: thing("Wrong")})
        src = make(self.records, self.pages, archive=self.archive(), client=client)
        found = vs.check_enemy_attacks(src)
        self.assertEqual(len(found), 1)
        level, check, key, message, _ = found[0]
        self.assertEqual((level, check, key), ("ERROR", "enemy-attacks", "boss|wrong"))
        self.assertIn("right (2 of 2)", message)

    def test_no_finding_when_the_record_fires_one_of_them(self):
        client = client_of({1: thing("Right", {"Shot A", "Shot B"}), 2: thing("Wrong", {"Shot A"})})
        src = make(self.records, self.pages, archive=self.archive(), client=client)
        self.assertEqual(vs.check_enemy_attacks(src), [])

    def test_no_finding_with_fewer_than_two_known_shots(self):
        client = client_of({1: thing("Right", {"Shot A", "Shot B"}), 2: thing("Wrong")})
        src = make(self.records, self.pages, archive=self.archive({"boss": {"Shot A", "Mystery"}}), client=client)
        self.assertEqual(vs.check_enemy_attacks(src), [])

    def test_non_enemy_shot_owners_are_not_counted(self):
        client = client_of({1: thing("Right", {"Shot A", "Shot B"}, enemy_=False), 2: thing("Wrong")})
        src = make(self.records, self.pages, archive=self.archive(), client=client)
        self.assertEqual(vs.check_enemy_attacks(src), [])


class ItemStatsTest(unittest.TestCase):
    def src(self, **facts):
        record = item("sword", tier=5, worn={"MAXHP": 80, "DEX": 5, "unrelated": 1})
        return make([record], {"sword": ["sword"]}, archive={"facts": {"sword": facts}, "attacks": {}})

    def test_tier_mismatch_warns(self):
        found = vs.check_item_stats(self.src(Tier=["T6"]))
        self.assertEqual([(f[0], f[1], f[2]) for f in found], [("WARN", "item-stats", "sword|sword")])
        self.assertIn("tier T6", found[0][3])

    def test_matching_tier_and_on_equip_are_quiet(self):
        self.assertEqual(vs.check_item_stats(self.src(Tier=["T5"], **{"On Equip": ["+80 HP, +5 DEX"]})), [])

    def test_on_equip_mismatch_warns(self):
        found = vs.check_item_stats(self.src(**{"On Equip": ["+80 HP"]}))
        self.assertEqual([f[0] for f in found], ["WARN"])
        self.assertIn("On Equip", found[0][3])

    def test_unreadable_on_equip_is_not_a_mismatch(self):
        self.assertEqual(vs.check_item_stats(self.src(**{"On Equip": ["+80 Foo"]})), [])


class FoldedTargetsTest(unittest.TestCase):
    RELATION = {"x": {"relations": [{"to": "ghost", "type": "drops"}, {"type": "no-target"}]}}

    def test_folded_target_that_looks_different_warns(self):
        src = make([enemy("carrier", art="a1", hp=10), enemy("ghost", art="a2", hp=10, folded="carrier")],
                   enrichment_records=self.RELATION)
        found = vs.check_folded_targets(src)
        self.assertEqual([(f[0], f[1], f[2]) for f in found], [("WARN", "folded-target", "ghost")])
        self.assertIn("art", found[0][3])

    def test_identical_folded_target_is_quiet(self):
        src = make([enemy("carrier", art="a1", hp=10), enemy("ghost", art="a1", hp=10, folded="carrier")],
                   enrichment_records=self.RELATION)
        self.assertEqual(vs.check_folded_targets(src), [])

    def test_unfolded_or_unknown_targets_are_ignored(self):
        src = make([enemy("ghost", art="a2")], enrichment_records=self.RELATION)
        self.assertEqual(vs.check_folded_targets(src), [])


class ClientDriftTest(unittest.TestCase):
    RECORDS = [enemy("Boss", hp=100, **{"from": [0, "0x1"]})]

    def client(self, build):
        return client_of({1: thing("Boss", hp=200)}, build)

    def test_same_build_and_different_hp_is_an_error(self):
        src = make(self.RECORDS, client=self.client("b1"))
        found = vs.check_client_drift(src)
        self.assertEqual([(f[0], f[1], f[2]) for f in found], [("ERROR", "client-drift", "Boss")])
        self.assertIn("hp 100 in the Index, 200 in the scrape", found[0][3])

    def test_different_build_is_only_info(self):
        src = make(self.RECORDS, client=self.client("b2"))
        found = vs.check_client_drift(src)
        self.assertEqual([f[0] for f in found], ["INFO"])
        self.assertTrue(any("build b2" in note for note in src.notes))

    def test_no_client_adds_a_note_and_no_finding(self):
        src = make(self.RECORDS)
        self.assertEqual(vs.check_client_drift(src), [])
        self.assertTrue(any("client-drift: skipped" in note for note in src.notes))

    def test_missing_client_type_and_renamed_id(self):
        records = [enemy("Gone", **{"from": [0, "0x9"]}), enemy("Renamed", **{"from": [0, "0x1"]})]
        src = make(records, client=client_of({1: thing("Other")}))
        found = {f[2]: f for f in vs.check_client_drift(src)}
        self.assertIn("does not hold", found["Gone"][3])
        self.assertIn("client id 'Other'", found["Renamed"][3])


class FoldedTargetPageTest(unittest.TestCase):
    def src(self, relations):
        return make([enemy("carrier", art="a1"), enemy("ghost", art="a2", folded="carrier")],
                    enrichment_records={"x": {"relations": relations}})

    def test_page_is_the_most_frequent_slug(self):
        found = vs.check_folded_targets(self.src([
            {"to": "ghost", "toRealmEye": "minor"}, {"to": "ghost", "toRealmEye": "major"},
            {"to": "ghost", "toRealmEye": "major"}]))
        self.assertEqual(found[0][4]["page"], "major")

    def test_a_tie_is_broken_by_slug(self):
        found = vs.check_folded_targets(self.src([
            {"to": "ghost", "toRealmEye": "alpha"}, {"to": "ghost", "toRealmEye": "beta"}]))
        self.assertEqual(found[0][4]["page"], "beta")   # max over (count, slug)

    def test_no_slug_means_no_page(self):
        found = vs.check_folded_targets(self.src([{"to": "ghost"}]))
        self.assertNotIn("page", found[0][4])


def art_src(arts, **kwargs):
    """One page 'boss' joined to records r0, r1, ... with the given arts (None = no art)."""
    records = [enemy(f"r{n}", **({"art": art} if art is not None else {})) for n, art in enumerate(arts)]
    return make(records, {"boss": [r["id"] for r in records]}, **kwargs)


class PagePicturesTest(unittest.TestCase):
    def test_different_pictures_give_one_info_with_candidates(self):
        src = art_src(["A", "B", "A", "C"])
        found = vs.check_page_pictures(src)
        self.assertEqual(len(found), 1)
        level, check, key, _, data = found[0]
        self.assertEqual((level, check, key), ("INFO", "page-pictures", "boss|r0"))
        self.assertEqual(data, {"page": "boss", "shown": ["r0"], "candidates": ["r1", "r3"]})
        self.assertTrue(any(note.startswith("page-pictures: 1 pages") for note in src.notes))

    def test_identical_pictures_are_quiet(self):
        src = art_src(["A", "A"])
        self.assertEqual(vs.check_page_pictures(src), [])
        self.assertTrue(any(note.startswith("page-pictures: 0 pages") for note in src.notes))

    def test_a_single_record_is_quiet(self):
        self.assertEqual(vs.check_page_pictures(art_src(["A"])), [])

    def test_shown_record_without_art_is_quiet(self):
        self.assertEqual(vs.check_page_pictures(art_src([None, "B"])), [])

    def test_candidates_are_capped_at_six(self):
        found = vs.check_page_pictures(art_src([str(n) for n in range(10)]))
        self.assertEqual(found[0][4]["candidates"], [f"r{n}" for n in range(1, 7)])

    def test_raised_and_picked_pages_are_skipped(self):
        src = art_src(["A", "B"])
        src.raised_pages.add("boss")
        self.assertEqual(vs.check_page_pictures(src), [])
        src = art_src(["A", "B"])
        src.picks = {"boss": "r0"}
        self.assertEqual(vs.check_page_pictures(src), [])

    def test_kinds_are_judged_apart(self):
        records = [enemy("e", art="A"), item("i", art="B")]
        src = make(records, {"boss": ["e", "i"]})
        self.assertEqual(vs.check_page_pictures(src), [])

    def test_run_skips_a_page_an_earlier_check_raised(self):
        records = [enemy("a", hp=1000, art="A"), enemy("twin", hp=1600, art="B", folded="c"), enemy("c", hp=1000, art="A")]
        pages = {"boss": ["a", "twin"]}
        archive = {"facts": {"boss": {"HP": ["1,600 DEF: 0"]}}, "attacks": {}}
        with_archive = vs.run(make(records, pages, archive=archive))
        self.assertEqual([f["check"] for f in with_archive], ["enemy-stats"])
        without = vs.run(make(records, pages))
        self.assertEqual([f["check"] for f in without], ["page-pictures"])


class PicksTest(unittest.TestCase):
    def test_picks_of_counts_only_complete_error_verdicts(self):
        verdicts = {
            "1": {"verdict": "error", "pick": "x", "page": "p1"},
            "2": {"verdict": "ok", "pick": "x", "page": "p2"},
            "3": {"verdict": "error", "page": "p3"},
            "4": {"verdict": "error", "pick": "x"},
            "5": {"verdict": "error", "pick": "", "page": "p5"},
        }
        self.assertEqual(vs.picks_of(verdicts), {"p1": "x"})
        self.assertEqual(vs.picks_of(None), {})

    @staticmethod
    def pick(page, record):
        return {"k": {"verdict": "error", "pick": record, "page": page}}

    def picked(self, found):
        return [f for f in found if f["key"].endswith("|picked")]

    def test_a_pick_that_is_not_shown_is_an_error_not_for_review(self):
        records = [enemy("r0", art="A"), enemy("r1", art="B", folded="r0")]
        found = vs.run(make(records, {"boss": ["r0", "r1"]}), self.pick("boss", "r1"))
        picked = self.picked(found)
        self.assertEqual(len(picked), 1)
        one = picked[0]
        self.assertEqual((one["level"], one["check"], one["key"]), ("ERROR", "page-pictures", "boss|picked"))
        self.assertFalse(one["review"])
        self.assertEqual(one["data"], {"page": "boss", "shown": ["r0"], "candidates": ["r1"]})
        # the page is no longer asked as an INFO picture check
        self.assertEqual([f["level"] for f in found if f["key"] != "boss|picked"], [])

    def test_a_pick_of_an_unknown_record_is_an_error(self):
        found = vs.run(art_src(["A", "B"]), self.pick("boss", "ghost"))
        picked = self.picked(found)
        self.assertEqual([(f["level"], f["review"]) for f in picked], [("ERROR", False)])
        self.assertEqual(picked[0]["data"]["candidates"], [])
        self.assertIn("no longer holds", picked[0]["message"])

    def test_a_pick_that_is_shown_gives_nothing(self):
        src = art_src(["A", "B"])
        shown = src.shown("boss", "enemy")[0]["id"]
        self.assertEqual(self.picked(vs.run(src, self.pick("boss", shown))), [])

    def test_a_pick_of_the_shown_records_fold_carrier_gives_nothing(self):
        records = [enemy("a", art="A", folded="c"), enemy("c", art="A")]
        relations = {"x": {"relations": [{"to": "a", "toRealmEye": "boss"}]}}
        src = make(records, {"boss": ["a", "c"]}, enrichment_records=relations)
        self.assertEqual([r["id"] for r in src.shown("boss", "enemy")], ["a"])
        self.assertEqual(vs.run(src, self.pick("boss", "c")), [])

    def test_review_flags(self):
        found = vs.run(drift_src())
        flags = {f["check"]: f["review"] for f in found}
        self.assertTrue(flags["enemy-stats"])
        self.assertFalse(flags["client-drift"])
        for check in ("enemy-attacks", "item-stats", "folded-target", "page-pictures"):
            self.assertIn(check, vs.REVIEWED)

    def test_an_error_verdict_with_a_pick_copies_it_onto_the_finding(self):
        key = "enemy-stats|boss|a"
        message = {f["check"] + "|" + f["key"]: f for f in vs.run(drift_src())}[key]["message"]
        verdicts = {key: {"verdict": "error", "pick": "twin", "page": "boss", "message": message}}
        one = {f["check"] + "|" + f["key"]: f for f in vs.run(drift_src(), verdicts)}[key]
        self.assertEqual(one["pick"], "twin")
        self.assertEqual(one["level"], "ERROR")
        self.assertTrue(one["review"])


def drift_src():
    """One ERROR (twin agrees), one WARN (nobody agrees), one INFO (other build)."""
    records = [
        enemy("a", hp=1000, **{"from": [0, "0x1"]}), enemy("twin", hp=1600, folded="c"), enemy("c", hp=1000),
        enemy("lonely", hp=5),
    ]
    pages = {"boss": ["a", "twin"], "solo": ["lonely"]}
    archive = {"facts": {"boss": {"HP": ["1,600 DEF: 0"]}, "solo": {"HP": ["9,999"]}}, "attacks": {}}
    return make(records, pages, archive=archive, client=client_of({1: thing("a", hp=1)}, "b2"))


class RunTest(unittest.TestCase):
    def test_findings_are_sorted_error_warn_info(self):
        levels = [f["level"] for f in vs.run(drift_src())]
        self.assertEqual(levels, ["ERROR", "WARN", "INFO"])

    KEY = "enemy-stats|boss|a"

    def by_key(self, found):
        return {f["check"] + "|" + f["key"]: f for f in found}

    def message(self):
        return self.by_key(vs.run(drift_src()))[self.KEY]["message"]

    def test_findings_carry_their_data(self):
        one = self.by_key(vs.run(drift_src()))[self.KEY]
        self.assertEqual(one["data"]["page"], "boss")

    def test_ok_verdict_on_the_same_message_is_accepted(self):
        verdicts = {self.KEY: {"verdict": "ok", "note": "known twin", "message": self.message()}}
        by_key = self.by_key(vs.run(drift_src(), verdicts))
        self.assertEqual(by_key[self.KEY]["accepted"], "known twin")
        self.assertEqual(by_key[self.KEY]["verdict"], "ok")
        self.assertIsNone(by_key["enemy-stats|solo|lonely"]["accepted"])

    def test_ok_verdict_without_a_note_gets_a_default_reason(self):
        verdicts = {self.KEY: {"verdict": "ok", "message": self.message()}}
        self.assertEqual(self.by_key(vs.run(drift_src(), verdicts))[self.KEY]["accepted"], "reviewed: no error")

    def test_error_verdict_turns_a_warning_into_a_confirmed_error(self):
        key = "enemy-stats|solo|lonely"
        warn = self.by_key(vs.run(drift_src()))[key]
        self.assertEqual(warn["level"], "WARN")
        verdicts = {key: {"verdict": "error", "note": "wrong", "message": warn["message"]}}
        one = self.by_key(vs.run(drift_src(), verdicts))[key]
        self.assertEqual(one["level"], "ERROR")
        self.assertEqual(one["confirmed"], "wrong")
        self.assertIsNone(one["accepted"])

    def test_verdict_on_a_different_message_is_stale_and_not_accepted(self):
        verdicts = {self.KEY: {"verdict": "ok", "note": "old", "message": "an older message"}}
        one = self.by_key(vs.run(drift_src(), verdicts))[self.KEY]
        self.assertEqual(one["stale"], "ok")
        self.assertIsNone(one["accepted"])
        self.assertEqual(one["level"], "ERROR")
        self.assertNotIn("verdict", one)


class MainTest(unittest.TestCase):
    """`main` without an archive: the ERROR comes from client-drift (needs no archive)."""

    def run_main(self, *extra, verdict=None):
        with tempfile.TemporaryDirectory() as tmp:
            tmp = Path(tmp)
            records = [enemy("Boss", hp=100, **{"from": [0, "0x1"]})]
            (tmp / "index.json").write_text(json.dumps({"from": {"build": "b1"}, "records": records}), encoding="utf-8")
            (tmp / "enrichment.json").write_text(json.dumps({"pageIndex": {}, "records": {}}), encoding="utf-8")
            client = tmp / "client"
            client.mkdir()
            (client / "provenance.json").write_text(json.dumps({"from": {"build": "b1"}}), encoding="utf-8")
            (client / "Objects.001.xml").write_text(
                '<Objects><Object type="0x1" id="Boss"><Enemy/><MaxHitPoints>200</MaxHitPoints></Object></Objects>',
                encoding="utf-8")
            review = tmp / "review.json"
            if verdict is not None:
                review.write_text(json.dumps({"verdicts": {"client-drift|Boss": verdict}}), encoding="utf-8")
            argv = ["--index", str(tmp / "index.json"), "--enrichment", str(tmp / "enrichment.json"),
                    "--archive", str(tmp / "missing.sqlite"), "--client-data", str(client),
                    "--review", str(review), "--report-dir", str(tmp / "report"), *extra]
            out = io.StringIO()
            with contextlib.redirect_stdout(out):
                code = vs.main(argv)
            report = json.loads((tmp / "report" / "report.json").read_text(encoding="utf-8"))
            return code, out.getvalue(), report

    def test_unaccepted_error_fails(self):
        code, out, report = self.run_main()
        self.assertEqual(code, 1)
        self.assertIn("1 error(s) to fix or accept", out)
        self.assertEqual([f["level"] for f in report["findings"]], ["ERROR"])
        self.assertEqual(report["sources"], {"index": {"build": "b1"}, "client": "b1"})
        self.assertEqual(report["pages"], {})

    def test_no_fail_flag_exits_zero(self):
        code, _, _ = self.run_main("--no-fail")
        self.assertEqual(code, 0)

    def test_ok_verdict_from_the_review_file_does_not_fail(self):
        first = self.run_main()[2]["findings"][0]
        verdict = {"verdict": "ok", "note": "known", "message": first["message"]}
        code, out, report = self.run_main(verdict=verdict)
        self.assertEqual(code, 0)
        self.assertEqual(report["findings"][0]["accepted"], "known")
        self.assertIn("0 error(s)", out)

    def test_verdict_on_an_older_message_still_fails_and_is_reported(self):
        code, out, report = self.run_main(verdict={"verdict": "ok", "note": "x", "message": "older"})
        self.assertEqual(code, 1)
        self.assertEqual(report["findings"][0]["stale"], "ok")
        self.assertIn("1 verdict(s) given on an older message", out)


if __name__ == "__main__":
    unittest.main()
