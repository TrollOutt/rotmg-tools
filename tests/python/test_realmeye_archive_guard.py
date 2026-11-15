"""ROT-B-01: the RealmEye archive indexer never removes pages in bulk on the
word of one crawl.

Offline: a tiny archive of made-up pages is built in a temporary folder, then
indexed by tools/index-realmeye-archive.py exactly as the update does.
"""
import gzip
import hashlib
import importlib.util
import json
import sqlite3
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "tools" / "index-realmeye-archive.py"

spec = importlib.util.spec_from_file_location("index_realmeye_archive", SCRIPT)
indexer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(indexer)


def html(slug):
    return (f"<!doctype html><html><head><title>{slug} - RealmEye</title></head><body>"
            f"<div class=\"wiki-page\"><h1>{slug}</h1><p>Made-up page {slug}.</p></div></body></html>")


class MassRemovalRuleTest(unittest.TestCase):
    def test_small_removals_pass(self):
        self.assertEqual(indexer.mass_removal_problem(50, 5600, 50, 0.02), "")
        self.assertEqual(indexer.mass_removal_problem(112, 5600, 50, 0.02), "")

    def test_bulk_removal_is_refused(self):
        self.assertIn("5598 of 5600", indexer.mass_removal_problem(5598, 5600, 50, 0.02))
        self.assertIn("limit 112", indexer.mass_removal_problem(113, 5600, 50, 0.02))


class ArchiveGuardTest(unittest.TestCase):
    PAGES = [f"page-{n:02d}" for n in range(60)]

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.db = self.root / "realmeye.sqlite"
        self.hashes = {}
        for slug in self.PAGES:
            body = html(slug).encode("utf-8")
            digest = hashlib.sha256(body).hexdigest()
            target = self.root / "monitor" / "objects" / digest[:2] / f"{digest}.html.gz"
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(gzip.compress(body))
            self.hashes[slug] = digest

    def tearDown(self):
        self.tmp.cleanup()

    def snapshot(self, slugs, complete=True):
        pages = [{
            "url": f"https://www.realmeye.com/wiki/{slug}",
            "finalUrl": f"https://www.realmeye.com/wiki/{slug}",
            "status": 200,
            "rawHash": self.hashes[slug],
            "contentHash": self.hashes[slug],
            "fetchedAt": "2026-11-15T00:00:00Z",
        } for slug in slugs]
        (self.root / "monitor" / "latest.json").write_text(
            json.dumps({"complete": complete, "pages": pages}), encoding="utf-8")

    def index(self, *extra):
        return subprocess.run(
            [sys.executable, "-B", str(SCRIPT), "--monitor-dir", str(self.root / "monitor"),
             "--db", str(self.db), "--catalog", str(self.root / "catalog.json"),
             "--changes", str(self.root / "changes.json"), "--workers", "1", *extra],
            capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=300)

    def archived(self):
        con = sqlite3.connect(self.db)
        try:
            return con.execute("SELECT COUNT(*) FROM pages").fetchone()[0]
        finally:
            con.close()

    def test_a_crawl_that_lost_almost_everything_removes_nothing(self):
        self.snapshot(self.PAGES)
        self.assertEqual(self.index().returncode, 0)
        self.assertEqual(self.archived(), 60)

        # A "complete" crawl in which only the two home pages came back.
        self.snapshot(self.PAGES[:2])
        run = self.index()
        self.assertEqual(run.returncode, 3, run.stderr)
        self.assertIn("would remove 58 of 60", run.stderr)
        self.assertEqual(self.archived(), 60)

        # Someone who checked the crawl by hand can still accept it.
        self.assertEqual(self.index("--allow-mass-removal").returncode, 0)
        self.assertEqual(self.archived(), 2)

    def test_an_ordinary_removal_still_goes_through(self):
        self.snapshot(self.PAGES)
        self.assertEqual(self.index().returncode, 0)
        self.snapshot(self.PAGES[:42])  # 18 pages gone (30 %), under the 50-page limit
        self.assertEqual(self.index().returncode, 0)
        self.assertEqual(self.archived(), 42)


if __name__ == "__main__":
    unittest.main()
