"""ROT-B-03: an Unreleased list that comes back empty or halved is not published.

Offline: a made-up archive with one made-up Unreleased page, in a temporary folder.
"""
import gzip
import json
import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "tools" / "database"))

import export_realmeye_availability as availability  # noqa: E402


def page(slugs):
    rows = "".join(f'<tr><td><a href="/wiki/{s}">{s}</a></td></tr>' for s in slugs)
    return f'<html><div class="wiki-page"><table>{rows}</table></div></html>'


class DropRuleTest(unittest.TestCase):
    def test_rules(self):
        self.assertEqual(availability.drop_problem(37, 36, 37), "")
        self.assertEqual(availability.drop_problem(37, 20, 19), "")
        self.assertEqual(availability.drop_problem(0, 3, 3), "")
        self.assertIn("lists nothing", availability.drop_problem(37, 0, 0))
        self.assertIn("none joins", availability.drop_problem(37, 5, 0))
        self.assertIn("more than half", availability.drop_problem(37, 20, 18))


class ExportGuardTest(unittest.TestCase):
    THINGS = [f"thing-{n}" for n in range(10)]

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        root = Path(self.tmp.name)
        self.archive = root / "realmeye.sqlite"
        self.enrichment = root / "enrichment.json"
        self.output = root / "availability.json"
        self.enrichment.write_text(json.dumps({"pageIndex": {s: [f"item:{s}"] for s in self.THINGS}}), encoding="utf-8")
        self.page_file = root / "unreleased.html.gz"
        con = sqlite3.connect(self.archive)
        con.execute("CREATE TABLE pages (slug TEXT, raw_hash TEXT, source_file TEXT)")
        con.execute("INSERT INTO pages VALUES ('unreleased-content', 'h', ?)", (str(self.page_file),))
        con.commit()
        con.close()

    def tearDown(self):
        self.tmp.cleanup()

    def run_with(self, slugs, accept=False):
        self.page_file.write_bytes(gzip.compress(page(slugs).encode("utf-8")))
        availability.export(self.archive, self.enrichment, self.output, accept)
        return json.loads(self.output.read_text(encoding="utf-8"))

    def test_normal_update_is_written(self):
        self.assertEqual(len(self.run_with(self.THINGS)["records"]), 10)
        self.assertEqual(len(self.run_with(self.THINGS[:7])["records"]), 7)

    def test_empty_page_is_refused_and_keeps_the_file(self):
        self.run_with(self.THINGS)
        before = self.output.read_bytes()
        with self.assertRaises(SystemExit):
            self.run_with([])
        self.assertEqual(self.output.read_bytes(), before)

    def test_halved_list_is_refused_unless_accepted(self):
        self.run_with(self.THINGS)
        with self.assertRaises(SystemExit):
            self.run_with(self.THINGS[:4])
        self.assertEqual(len(self.run_with(self.THINGS[:4], accept=True)["records"]), 4)


if __name__ == "__main__":
    unittest.main()
