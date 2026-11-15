"""ROT-B-09: client-data is one source only when its key documents are there
and its textures come from the same build as its XML.

Offline: empty made-up files in a temporary folder, no game resource.
"""
import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "tools" / "database"))

from check_client_source import contract_problem  # noqa: E402

ORIGIN = {"kind": "client", "build": "aaaa", "date": "2026-11-05"}


class ContractTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.source = Path(self.tmp.name)
        for name in ("Objects.001.xml", "Enchantments.xml", "EnchantmentLists.xml", "EquipmentSets.xml"):
            (self.source / name).write_text("<x/>", encoding="utf-8")
        (self.source / "textures").mkdir()
        self.textures({"build": "aaaa"})

    def tearDown(self):
        self.tmp.cleanup()

    def textures(self, origin):
        (self.source / "textures" / "provenance.json").write_text(json.dumps({"from": origin}), encoding="utf-8")

    def test_one_build_passes(self):
        self.assertEqual(contract_problem(self.source, ORIGIN), "")

    def test_textures_of_another_build_fail(self):
        self.textures({"build": "bbbb"})
        self.assertIn("'bbbb'", contract_problem(self.source, ORIGIN))

    def test_textures_without_provenance_fail(self):
        (self.source / "textures" / "provenance.json").unlink()
        self.assertIn("extract-client-textures", contract_problem(self.source, ORIGIN))

    def test_a_missing_key_document_fails(self):
        (self.source / "EquipmentSets.xml").unlink()
        self.assertIn("EquipmentSets.xml", contract_problem(self.source, ORIGIN))
        (self.source / "Objects.001.xml").unlink()
        self.assertIn("Objects.*.xml", contract_problem(self.source, ORIGIN))


if __name__ == "__main__":
    unittest.main()
