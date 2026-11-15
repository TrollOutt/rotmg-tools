"""ROT-B-12: the regrouped lookups of build_sqlite.py give exactly what the
full scans they replace gave. Offline, on a made-up table."""
import random
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "tools" / "database"))

from build_sqlite import entities_by_part  # noqa: E402


def scan(table, part, wanted):
    """The expression build_sqlite.py used before, for one key."""
    return (set().union(*[v for k, v in table.items() if k[part] == wanted])
            if any(k[part] == wanted for k in table) else set())


class LookupTest(unittest.TestCase):
    def test_same_candidates_as_the_scan(self):
        rng = random.Random(7)
        table = {}
        for _ in range(400):
            key = (f"Objects.{rng.randint(1, 5):03d}", str(rng.randint(1, 40)), f"Thing {rng.randint(1, 60)}")
            table.setdefault(key, set()).add(f"entity-{rng.randint(1, 300)}")
        imp = SimpleNamespace(entities_by_document_type_client=table)
        by_type = entities_by_part(imp, 1)
        by_client = entities_by_part(imp, 2)
        for wanted in [str(n) for n in range(0, 45)]:
            self.assertEqual(set(by_type.get(wanted, ())), scan(table, 1, wanted))
        for wanted in [f"Thing {n}" for n in range(0, 65)]:
            self.assertEqual(set(by_client.get(wanted, ())), scan(table, 2, wanted))

    def test_the_table_is_not_changed(self):
        table = {("Objects.001", "1", "A"): {"e1"}, ("Objects.002", "1", "B"): {"e2"}}
        before = {k: set(v) for k, v in table.items()}
        grouped = entities_by_part(SimpleNamespace(entities_by_document_type_client=table), 1)
        grouped["1"].add("e3")
        self.assertEqual(table, before)


if __name__ == "__main__":
    unittest.main()
